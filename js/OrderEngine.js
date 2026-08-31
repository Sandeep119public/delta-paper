/**
 * Delta Paper Trading - Order Engine
 * Handles limit orders, stop orders, trailing stops, and order matching
 */

class OrderEngine {
  constructor(config, marketService, eventBus) {
    this.config = config;
    this.market = marketService;
    this.events = eventBus;
    this.pendingOrders = new Map();
    this.trailingStops = new Map();
    this.orderIdCounter = 0;
    this.tickInterval = null;
  }

  /**
   * Initialize the order engine
   */
  init() {
    // Listen for price updates to check orders
    this.events.on(EVENTS.PRICE_UPDATE, (data) => this.checkOrders(data));
    
    // Start order checking loop (every 100ms for responsive order matching)
    this.tickInterval = setInterval(() => this.tick(), 100);
    
    DELTA_LOGGER.log('[OrderEngine] Initialized');
  }

  /**
   * Generate unique order ID
   * @returns {string} Order ID
   */
  generateOrderId() {
    this.orderIdCounter++;
    return 'ORD-' + Date.now() + '-' + this.orderIdCounter;
  }

  /**
   * Place a market order (immediate fill)
   * @param {Object} params - Order parameters
   * @returns {Object} Order result
   */
  placeMarketOrder({ symbol, side, lots, leverage }) {
    const m = this.market.getMarket(symbol);
    if (!m || !(m.price > 0)) {
      return { success: false, error: 'No live price available' };
    }

    // Apply slippage
    const slippage = this.getSlippage();
    const price = side === 1 
      ? m.price * (1 + slippage) 
      : m.price * (1 - slippage);

    const order = {
      id: this.generateOrderId(),
      symbol,
      type: 'MARKET',
      side,
      lots,
      leverage,
      price,
      status: 'FILLED',
      filledAt: Date.now(),
      filledPrice: price
    };

    this.events.emit(EVENTS.ORDER_FILLED, order);
    return { success: true, order };
  }

  /**
   * Place a limit order
   * @param {Object} params - Order parameters
   * @returns {Object} Order result
   */
  placeLimitOrder({ symbol, side, lots, leverage, price, timeInForce = 'GTC' }) {
    const m = this.market.getMarket(symbol);
    if (!m) {
      return { success: false, error: 'Invalid symbol' };
    }

    // Validate price
    if (!(price > 0)) {
      return { success: false, error: 'Invalid price' };
    }

    // Check if order can be filled immediately
    if (m.price > 0) {
      const canFillImmediately = (side === 1 && m.price <= price) || 
                                  (side === -1 && m.price >= price);
      if (canFillImmediately) {
        const order = { id: this.generateOrderId(), symbol, type: 'LIMIT', side, lots, leverage, price, status: 'FILLED', filledAt: Date.now(), filledPrice: side === 1 ? Math.min(m.price, price) : Math.max(m.price, price) };\n        this.events.emit(EVENTS.ORDER_FILLED, order);\n        return { success: true, order };
      }
    }

    const order = {
      id: this.generateOrderId(),
      symbol,
      type: 'LIMIT',
      side,
      lots,
      leverage,
      price,
      timeInForce,
      status: 'PENDING',
      createdAt: Date.now()
    };

    this.pendingOrders.set(order.id, order);
    this.events.emit(EVENTS.ORDER_PLACED, order);
    
    return { success: true, order };
  }

  /**
   * Place a stop-loss order
   * @param {Object} params - Order parameters
   * @returns {Object} Order result
   */
  placeStopLoss({ symbol, side, lots, leverage, stopPrice, trailAmount = 0 }) {
    const order = {
      id: this.generateOrderId(),
      symbol,
      type: trailAmount > 0 ? 'TRAILING_STOP' : 'STOP',
      side,
      lots,
      leverage,
      stopPrice,
      trailAmount,
      highestPrice: 0,
      lowestPrice: Infinity,
      status: 'PENDING',
      createdAt: Date.now()
    };

    this.pendingOrders.set(order.id, order);
    
    if (trailAmount > 0) {
      this.trailingStops.set(order.id, order);
    }
    
    this.events.emit(EVENTS.ORDER_PLACED, order);
    return { success: true, order };
  }

  /**
   * Place a take-profit order
   * @param {Object} params - Order parameters
   * @returns {Object} Order result
   */
  takeProfit({ symbol, side, lots, leverage, tpPrice }) {
    const order = {
      id: this.generateOrderId(),
      symbol,
      type: 'TAKE_PROFIT',
      side: -side, // Opposite side to close
      lots,
      leverage,
      stopPrice: tpPrice,
      status: 'PENDING',
      createdAt: Date.now()
    };

    this.pendingOrders.set(order.id, order);
    this.events.emit(EVENTS.ORDER_PLACED, order);
    return { success: true, order };
  }

  /**
   * Cancel an order
   * @param {string} orderId - Order ID to cancel
   * @returns {boolean} Success
   */
  cancelOrder(orderId) {
    const order = this.pendingOrders.get(orderId);
    if (!order) return false;

    order.status = 'CANCELLED';
    this.pendingOrders.delete(orderId);
    this.trailingStops.delete(orderId);
    
    this.events.emit(EVENTS.ORDER_CANCELLED, order);
    return true;
  }

  /**
   * Cancel all pending orders
   * @param {string} [symbol] - Optional symbol filter
   * @returns {number} Number of cancelled orders
   */
  cancelAll(symbol = null) {
    let count = 0;
    
    for (const [id, order] of this.pendingOrders) {
      if (!symbol || order.symbol === symbol) {
        this.cancelOrder(id);
        count++;
      }
    }
    
    return count;
  }

  /**
   * Get pending orders for a symbol
   * @param {string} symbol - Trading symbol
   * @returns {Array} Pending orders
   */
  getPendingOrders(symbol = null) {
    const orders = Array.from(this.pendingOrders.values());
    if (symbol) {
      return orders.filter(o => o.symbol === symbol);
    }
    return orders;
  }

  /**
   * Tick - check all pending orders against current prices
   */
  tick() {
    for (const [id, order] of this.pendingOrders) {
      const m = this.market.getMarket(order.symbol);
      if (!m || !(m.price > 0)) continue;

      let shouldFill = false;

      switch (order.type) {
        case 'LIMIT':
          shouldFill = (order.side === 1 && m.price <= order.price) ||
                       (order.side === -1 && m.price >= order.price);
          break;

        case 'STOP':
          shouldFill = (order.side === 1 && m.price >= order.stopPrice) ||
                       (order.side === -1 && m.price <= order.stopPrice);
          break;

        case 'TAKE_PROFIT':
          shouldFill = (order.side === 1 && m.price >= order.stopPrice) ||
                       (order.side === -1 && m.price <= order.stopPrice);
          break;

        case 'TRAILING_STOP':
          shouldFill = this.checkTrailingStop(order, m.price);
          break;
      }

      if (shouldFill) {
        this.fillOrder(order, m.price);
      }
    }
  }

  /**
   * Check trailing stop order
   * @param {Object} order - Trailing stop order
   * @param {number} currentPrice - Current market price
   * @returns {boolean} Should fill
   */
  checkTrailingStop(order, currentPrice) {
    // Update tracked prices
    if (currentPrice > order.highestPrice) {
      order.highestPrice = currentPrice;
    }
    if (currentPrice < order.lowestPrice) {
      order.lowestPrice = currentPrice;
    }

    // For long positions (selling to close), trail from highest
    if (order.side === -1) {
      const trailPrice = order.highestPrice - order.trailAmount;
      return currentPrice <= trailPrice;
    }
    // For short positions (buying to close), trail from lowest
    else {
      const trailPrice = order.lowestPrice + order.trailAmount;
      return currentPrice >= trailPrice;
    }
  }

  /**
   * Fill an order
   * @param {Object} order - Order to fill
   * @param {number} fillPrice - Fill price
   */
  fillOrder(order, fillPrice) {
    order.status = 'FILLED';
    order.filledAt = Date.now();
    order.filledPrice = fillPrice;

    this.pendingOrders.delete(order.id);
    this.trailingStops.delete(order.id);

    this.events.emit(EVENTS.ORDER_FILLED, order);
  }

  /**
   * Get slippage based on settings
   * @returns {number} Slippage as decimal (e.g., 0.001 = 0.1%)
   */
  getSlippage() {
    const settings = this.getSettings();
    return settings.slippage || 0;
  }

  /**
   * Get simulation settings
   * @returns {Object} Settings
   */
  getSettings() {
    try {
      return JSON.parse(localStorage.getItem('deltaPaper_settings') || '{}');
    } catch (e) {
      return {};
    }
  }

  /**
   * Save simulation settings
   * @param {Object} settings - Settings to save
   */
  saveSettings(settings) {
    localStorage.setItem('deltaPaper_settings', JSON.stringify(settings));
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
  }
}

