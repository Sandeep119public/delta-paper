/**
 * Delta Paper Trading - Slippage & Latency Simulator
 * Simulates realistic market conditions for paper trading
 * Includes Poisson-distributed network jitter and Bernoulli packet loss
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
      enableLatency: true,
      packetLossRate: 0.015,  // 1.5% packet drop rate
      jitterLambda: 3,        // Mean congestion spikes per event
      enablePacketLoss: true,
      enableJitter: true
    };
    this.pendingActions = new Map();
  }

  init() {
    this.loadSettings();
    DELTA_LOGGER.log('[SimulationEngine] Initialized (Poisson jitter + packet loss)');
  }

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

  saveSettings() {
    localStorage.setItem('deltaPaper_simulation', JSON.stringify(this.settings));
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.saveSettings();
    DELTA_LOGGER.log('[SimulationEngine] Settings updated:', this.settings);
  }

  getSettings() {
    return { ...this.settings };
  }

  /**
   * Inject realistic network latency (Poisson distribution) and packet loss.
   * During high volatility the lambda is scaled up to simulate congestion spikes.
   *
   * @param {Function} callback - The tick emission function
   * @param {Object}  [opts]    - Optional overrides { volatility }
   */
  injectNetworkConditions(callback, opts) {
    if (!this.settings.enableLatency) return callback();

    // 1. Packet Loss Simulation (Bernoulli trial)
    if (this.settings.enablePacketLoss) {
      const packetLossRate = this.settings.packetLossRate || 0.015;
      if (Math.random() < packetLossRate) {
        this.events.emit('network:packetDropped');
        return; // Tick is dropped, strategy must handle stale data
      }
    }

    // 2. Poisson Jitter Injection
    const baseLatency = this.settings.latency || 50;
    let lambda = this.settings.jitterLambda || 3;

    // Scale jitter during high volatility
    if (opts && opts.volatility && opts.volatility > 0.03) {
      lambda *= (1 + opts.volatility * 10); // Spike congestion during crashes
    }

    const poissonJitter = this._getPoissonRandom(lambda);
    const totalLatency = baseLatency + (poissonJitter * 15);

    this.events.emit('network:latency', {
      baseLatency,
      poissonJitter,
      totalLatency
    });

    setTimeout(() => {
      callback();
    }, totalLatency);
  }

  /**
   * Knuth's algorithm for Poisson random variable generation.
   * Models the number of events (congestion spikes) in a fixed interval.
   *
   * @param {number} lambda - Expected number of events
   * @returns {number} Random Poisson-distributed integer
   */
  _getPoissonRandom(lambda) {
    let L = Math.exp(-lambda), k = 0, p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
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
        slippageAmount = price * this.settings.slippage * Math.random();
        break;

      case 'volume':
        const sizeFactor = Math.min(quantity / 100, 2);
        slippageAmount = price * this.settings.slippage * sizeFactor;
        break;

      default:
        slippageAmount = price * this.settings.slippage;
    }

    if (volatility > 0) {
      slippageAmount *= (1 + volatility);
    }

    if (side === 1) {
      return price + slippageAmount;
    } else {
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

  cancelPendingAction(actionId) {
    const pending = this.pendingActions.get(actionId);
    if (pending) {
      clearTimeout(pending.timeoutId);
      this.pendingActions.delete(actionId);
      return true;
    }
    return false;
  }

  getPendingActions() {
    return Array.from(this.pendingActions.entries()).map(([id, action]) => ({
      id,
      age: Date.now() - action.createdAt,
      latency: action.latency
    }));
  }

  simulateOrderBook(midPrice, depth = 10) {
    const spread = midPrice * 0.001;
    const asks = [];
    const bids = [];

    for (let i = 0; i < depth; i++) {
      const askPrice = midPrice + (spread / 2) + (midPrice * 0.0001 * i);
      const bidPrice = midPrice - (spread / 2) - (midPrice * 0.0001 * i);

      const askVolume = Math.random() * (10 - i) + 0.1;
      const bidVolume = Math.random() * (10 - i) + 0.1;

      asks.push({ price: askPrice, volume: askVolume });
      bids.push({ price: bidPrice, volume: bidVolume });
    }

    return { asks, bids, spread };
  }

  calculateMarketImpact(orderSize, averageVolume) {
    if (averageVolume === 0) return 0;

    const participationRate = orderSize / averageVolume;
    return Math.sqrt(participationRate) * 0.1;
  }

  calculateFillProbability({ price, currentPrice, side, size, volatility }) {
    let probability = 1.0;

    const distance = Math.abs(price - currentPrice) / currentPrice;
    if (distance > 0.01) {
      probability *= Math.max(0, 1 - distance * 10);
    }

    if (volatility > 0.02) {
      probability *= 0.9;
    }

    if (size > 10000) {
      probability *= 0.95;
    }

    return Math.max(0, Math.min(1, probability));
  }

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
