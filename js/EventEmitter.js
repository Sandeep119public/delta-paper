/**
 * Delta Paper Trading - Event Emitter
 * Decoupled pub/sub architecture for price updates, orders, and UI events
 */

class EventEmitter {
  constructor() {
    this.events = new Map();
    this.maxListeners = 100;
  }

  /**
   * Register an event listener
   * @param {string} event - Event name
   * @param {Function} listener - Callback function
   * @param {Object} options - Options (once, priority)
   * @returns {Function} Unsubscribe function
   */
  on(event, listener, options = {}) {
    if (typeof listener !== 'function') {
      throw new TypeError('Listener must be a function');
    }

    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const listeners = this.events.get(event);
    if (listeners.length >= this.maxListeners) {
      DELTA_LOGGER.warn('[EventEmitter] Max listeners exceeded for:', event);
    }

    const entry = {
      listener,
      once: options.once || false,
      priority: options.priority || 0
    };

    listeners.push(entry);
    listeners.sort((a, b) => b.priority - a.priority);

    return () => this.off(event, listener);
  }

  /**
   * Register a one-time event listener
   * @param {string} event - Event name
   * @param {Function} listener - Callback function
   * @returns {Function} Unsubscribe function
   */
  once(event, listener) {
    return this.on(event, listener, { once: true });
  }

  /**
   * Remove an event listener
   * @param {string} event - Event name
   * @param {Function} listener - Callback function to remove
   */
  off(event, listener) {
    if (!this.events.has(event)) return;

    const listeners = this.events.get(event);
    const index = listeners.findIndex(entry => entry.listener === listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      this.events.delete(event);
    }
  }

  /**
   * Emit an event with data
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @returns {boolean} True if listeners were called
   */
  emit(event, data) {
    if (!this.events.has(event)) return false;

    const listeners = this.events.get(event).slice();
    const toRemove = [];

    for (const entry of listeners) {
      try {
        entry.listener(data);
        if (entry.once) {
          toRemove.push(entry);
        }
      } catch (e) {
        DELTA_LOGGER.error('[EventEmitter] Listener error for', event + ':', e);
      }
    }

    // Remove one-time listeners
    if (toRemove.length > 0) {
      const remaining = this.events.get(event).filter(e => !toRemove.includes(e));
      if (remaining.length === 0) {
        this.events.delete(event);
      } else {
        this.events.set(event, remaining);
      }
    }

    return true;
  }

  /**
   * Emit event asynchronously
   * @param {string} event - Event name
   * @param {*} data - Event data
   */
  async emitAsync(event, data) {
    if (!this.events.has(event)) return;

    const listeners = this.events.get(event).slice();
    for (const entry of listeners) {
      try {
        await entry.listener(data);
        if (entry.once) {
          this.off(event, entry.listener);
        }
      } catch (e) {
        DELTA_LOGGER.error('[EventEmitter] Async listener error for', event + ':', e);
      }
    }
  }

  /**
   * Remove all listeners for an event
   * @param {string} [event] - Event name (optional, removes all if omitted)
   */
  removeAll(event) {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  /**
   * Get listener count for an event
   * @param {string} event - Event name
   * @returns {number} Listener count
   */
  listenerCount(event) {
    return this.events.has(event) ? this.events.get(event).length : 0;
  }

  /**
   * Get all event names
   * @returns {string[]} Array of event names
   */
  eventNames() {
    return Array.from(this.events.keys());
  }
}

// Singleton event bus for the application
const eventBus = new EventEmitter();

// Event name constants
const EVENTS = {
  // Market data events
  PRICE_UPDATE: 'price:update',
  TICKER_UPDATE: 'ticker:update',
  FUNDING_UPDATE: 'funding:update',
  
  // Order events
  ORDER_PLACED: 'order:placed',
  ORDER_FILLED: 'order:filled',
  ORDER_CANCELLED: 'order:cancelled',
  ORDER_REJECTED: 'order:rejected',
  
  // Position events
  POSITION_OPENED: 'position:opened',
  POSITION_CLOSED: 'position:closed',
  POSITION_UPDATED: 'position:updated',
  LIQUIDATION_WARNING: 'liquidation:warning',
  LIQUIDATION_TRIGGERED: 'liquidation:triggered',
  
  // TP/SL events
  TP_HIT: 'tp:hit',
  SL_HIT: 'sl:hit',
  TRAILING_STOP_TRIGGERED: 'trailing:triggered',
  
  // State events
  STATE_CHANGED: 'state:changed',
  STATE_SAVED: 'state:saved',
  STATE_LOADED: 'state:loaded',
  
  // UI events
  SYMBOL_CHANGED: 'symbol:changed',
  LEVERAGE_CHANGED: 'leverage:changed',
  MODAL_OPENED: 'modal:opened',
  MODAL_CLOSED: 'modal:closed',
  TOAST_SHOW: 'toast:show',
  
  // Funding events
  FUNDING_ACCRUED: 'funding:accrued',
  FUNDING_DEDUCTED: 'funding:deducted',
  
  // Risk events
  RISK_ALERT: 'risk:alert',
  MARGIN_CALL: 'margin:call',
  
  // System events
  WS_CONNECTED: 'ws:connected',
  WS_DISCONNECTED: 'ws:disconnected',
  API_ERROR: 'api:error',
  CIRCUIT_BREAKER: 'circuit:breaker',

  // Network simulation events
  NETWORK_PACKET_DROPPED: 'network:packetDropped',
  NETWORK_LATENCY: 'network:latency',

  // Monte Carlo stress test events
  MONTECARLO_PROGRESS: 'montecarlo:progress',
  MONTECARLO_COMPLETE: 'montecarlo:complete',

  // Backtest events
  BACKTEST_EVENT_LOADED: 'backtest:eventLoaded'
};

