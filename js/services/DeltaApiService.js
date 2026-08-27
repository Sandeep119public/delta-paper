/**
 * Delta Paper Trading - API Service
 * Handles REST API calls with rate limiting and circuit breaker pattern
 */

class DeltaApiService {
  constructor(config) {
    this.config = config;
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
    this.circuitOpenUntil = 0;
    this.lastRequestTime = 0;
    this.minRequestInterval = 100; // Minimum 100ms between requests
  }

  /**
   * Generic API GET with proxy fallback chain and circuit breaker
   * @param {string} path - API endpoint path
   * @returns {Promise<Object>} API response data
   */
  async get(path) {
    // Check circuit breaker
    if (this.circuitOpen) {
      if (Date.now() < this.circuitOpenUntil) {
        throw new Error('Circuit breaker open - API unavailable');
      }
      this.circuitOpen = false;
      this.consecutiveFailures = 0;
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
    }
    this.lastRequestTime = Date.now();

    const url = this.config.API_BASE + path;
    let lastErr = null;

    // Try proxy chain
    for (let i = 0; i < this.config.PROXY_CHAIN.length; i++) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 8000);

        const targetUrl = this.config.PROXY_CHAIN[i](url);
        const response = await fetch(targetUrl, { signal: ctrl.signal });
        clearTimeout(timeout);

        if (!response.ok) {
          lastErr = new Error('HTTP ' + response.status);
          continue;
        }

        const data = await response.json();
        if (data && data.success === false) {
          lastErr = new Error('API error: ' + (data.message || 'unknown'));
          continue;
        }

        // Success - reset circuit breaker
        this.consecutiveFailures = 0;
        return data.result || data;
      } catch (e) {
        DELTA_LOGGER.warn('[ApiService] Attempt', i + 1, 'failed:', e.message);
        lastErr = e;
      }
    }

    // All attempts failed
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= 3) {
      this.circuitOpen = true;
      this.circuitOpenUntil = Date.now() + 30000; // 30 second cooldown
      DELTA_LOGGER.error('[ApiService] Circuit breaker opened after', this.consecutiveFailures, 'failures');
    }

    throw lastErr || new Error('Fetch failed');
  }

  /**
   * Check if circuit breaker is open
   * @returns {boolean} True if circuit is open
   */
  isCircuitOpen() {
    return this.circuitOpen && Date.now() < this.circuitOpenUntil;
  }

  /**
   * Get circuit breaker status
   * @returns {Object} Circuit breaker status
   */
  getStatus() {
    return {
      consecutiveFailures: this.consecutiveFailures,
      circuitOpen: this.circuitOpen,
      circuitOpenUntil: this.circuitOpenUntil,
      isAvailable: !this.isCircuitOpen()
    };
  }

  /**
   * Reset circuit breaker manually
   */
  reset() {
    this.consecutiveFailures = 0;
    this.circuitOpen = false;
    this.circuitOpenUntil = 0;
  }
}

