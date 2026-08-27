/**
 * Delta Paper Trading - Console Logger Module
 * Conditional logging for development vs production
 * Set DELTA_DEBUG = true in browser console to enable debug logs
 */

const DELTA_LOGGER = {
  enabled: false, // Disabled by default in production
  
  /**
   * Enable debug logging (call from browser console: DELTA_LOGGER.enable())
   */
  enable() {
    this.enabled = true;
    if (typeof console !== 'undefined') {
      console.log('[Logger] Debug logging enabled');
    }
  },
  
  /**
   * Disable debug logging
   */
  disable() {
    this.enabled = false;
  },
  
  /**
   * Log message (only if enabled)
   */
  log(...args) {
    if (this.enabled && typeof console !== 'undefined') {
      console.log(...args);
    }
  },
  
  /**
   * Log error (always enabled for critical errors)
   */
  error(...args) {
    if (typeof console !== 'undefined') {
      console.error(...args);
    }
  },
  
  /**
   * Log warning (only if enabled)
   */
  warn(...args) {
    if (this.enabled && typeof console !== 'undefined') {
      console.warn(...args);
    }
  }
};

