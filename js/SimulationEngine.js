/**
 * Delta Paper Trading - Slippage & Latency Simulator
 * Simulates realistic market conditions for paper trading
 */

class SimulationEngine {
  constructor(config, eventBus) {
    this.config = config;
    this.events = eventBus;
    this.settings = {
      slippage: 0.001,        // 0.1% default slippage
      latency: 200,           // 200ms default latency
      slippageModel: 'fixed', // 'fixed', 'random', 'volume'
      enableSlippage: true,
      enableLatency: true
    };
    this.pendingActions = new Map();
  }

  /**
   * Initialize simulation engine
   */
  init() {
    this.loadSettings();
    DELTA_LOGGER.log('[SimulationEngine] Initialized');
  }

  /**
   * Load settings from localStorage
   */
  loadSettings() {
    try {
      const stored = localStorage.getItem('deltaPaper_simulation');
      if (stored) {
        this.settings = { ...this.settings, ...JSON.parse(stored) };
      }
    } catch (e) {
      DELTA_LOGGER.warn('[SimulationEngine] Failed to load settings:', e);
    }
  }

  /**
   * Save settings to localStorage
   */
  saveSettings() {
    localStorage.setItem('deltaPaper_simulation', JSON.stringify(this.settings));
  }

  /**
   * Update simulation settings
   * @param {Object} newSettings - Settings to update
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    DELTA_LOGGER.log('[SimulationEngine] Settings updated:', this.settings);
  }

  /**
   * Get current settings
   * @returns {Object} Current settings
   */
  getSettings() {
    return { ...this.settings };
  }

  /**
   * Calculate slippage for an order
   * @param {Object} params - Order parameters
   * @returns {number} Slippage-adjusted price
   */
  applySlippage({ price, side, quantity, volatility = 0 }) {
    if (!this.settings.enableSlippage || this.settings.slippage === 0) {
      return price;
    }

    let slippageAmount = 0;

    switch (this.settings.slippageModel) {
      case 'fixed':
        slippageAmount = price * this.settings.slippage;
        break;

      case 'random':
        // Random slippage between 0 and configured max
        slippageAmount = price * this.settings.slippage * Math.random();
        break;

      case 'volume':
        // Higher slippage for larger orders (simplified model)
        const sizeFactor = Math.min(quantity / 100, 2); // Cap at 2x
        slippageAmount = price * this.settings.slippage * sizeFactor;
        break;

      default:
        slippageAmount = price * this.settings.slippage;
    }

    // Apply volatility adjustment
    if (volatility > 0) {
      slippageAmount *= (1 + volatility);
    }

    // Apply slippage in correct direction
    if (side === 1) {
      // Buy - price goes up
      return price + slippageAmount;
    } else {
      // Sell - price goes down
      return price - slippageAmount;
    }
  }

  /**
   * Apply latency delay to an action
   * @param {string} actionId - Unique action ID
   * @param {Function} action - Action to execute
   * @param {number} [customLatency] - Custom latency override
   * @returns {Promise} Promise that resolves when action executes
   */
  applyLatency(actionId, action, customLatency = null) {
    if (!this.settings.enableLatency || this.settings.latency === 0) {
      return Promise.resolve(action());
    }

    const latency = customLatency || this.settings.latency;

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingActions.delete(actionId);
        const result = action();
        resolve(result);
      }, latency);

      this.pendingActions.set(actionId, {
        timeoutId,
        createdAt: Date.now(),
        latency
      });
    });
  }

  /**
   * Cancel a pending delayed action
   * @param {string} actionId - Action ID to cancel
   * @returns {boolean} True if cancelled
   */
  cancelPendingAction(actionId) {
    const pending = this.pendingActions.get(actionId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingActions.delete(actionId);
      return true;
    }
    return false;
  }

  /**
   * Get all pending delayed actions
   * @returns {Array} List of pending actions
   */
  getPendingActions() {
    return Array.from(this.pendingActions.entries()).map(([id, action]) => ({
      id,
      age: Date.now() - action.createdAt,
      latency: action.latency
    }));
  }

  /**
   * Simulate order book depth
   * @param {number} midPrice - Mid-market price
   * @param {number} depth - Number of levels
   * @returns {Object} Simulated order book
   */
  simulateOrderBook(midPrice, depth = 10) {
    const spread = midPrice * 0.001; // 0.1% spread
    const asks = [];
    const bids = [];

    for (let i = 0; i < depth; i++) {
      const askPrice = midPrice + (spread / 2) + (midPrice * 0.0001 * i);
      const bidPrice = midPrice - (spread / 2) - (midPrice * 0.0001 * i);
      
      // Simulate volume (decreases away from mid)
      const askVolume = Math.random() * (10 - i) + 0.1;
      const bidVolume = Math.random() * (10 - i) + 0.1;

      asks.push({ price: askPrice, volume: askVolume });
      bids.push({ price: bidPrice, volume: bidVolume });
    }

    return { asks, bids, spread };
  }

  /**
   * Calculate market impact
   * @param {number} orderSize - Order size in USD
   * @param {number} averageVolume - Average daily volume
   * @returns {number} Market impact as decimal
   */
  calculateMarketImpact(orderSize, averageVolume) {
    if (averageVolume === 0) return 0;
    
    // Simplified market impact model
    const participationRate = orderSize / averageVolume;
    return Math.sqrt(participationRate) * 0.1; // Square root model
  }

  /**
   * Simulate fill probability based on market conditions
   * @param {Object} params - Order parameters
   * @returns {number} Fill probability (0-1)
   */
  calculateFillProbability({ price, currentPrice, side, size, volatility }) {
    let probability = 1.0;

    // Distance from market affects fill probability
    const distance = Math.abs(price - currentPrice) / currentPrice;
    if (distance > 0.01) { // More than 1% away
      probability *= Math.max(0, 1 - distance * 10);
    }

    // Volatility affects fill probability
    if (volatility > 0.02) { // High volatility
      probability *= 0.9;
    }

    // Large orders have lower fill probability
    if (size > 10000) {
      probability *= 0.95;
    }

    return Math.max(0, Math.min(1, probability));
  }

  /**
   * Generate realistic trade execution
   * @param {Object} order - Original order
   * @param {Object} market - Current market data
   * @returns {Object} Execution details
   */
  simulateExecution(order, market) {
    const slippage = this.applySlippage({
      price: market.price,
      side: order.side,
      quantity: order.qty || order.lots
    });

    const fillProbability = this.calculateFillProbability({
      price: slippage,
      currentPrice: market.price,
      side: order.side,
      size: order.lots * market.price,
      volatility: Math.abs((market.price - market.prevPrice) / market.prevPrice)
    });

    return {
      requestedPrice: market.price,
      actualPrice: slippage,
      slippage: slippage - market.price,
      slippagePercent: ((slippage - market.price) / market.price) * 100,
      fillProbability,
      willFill: Math.random() < fillProbability,
      timestamp: Date.now()
    };
  }
}

