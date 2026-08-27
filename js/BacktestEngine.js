/**
 * Delta Paper Trading - Historical Replay / Paper Backtesting
 * Allows replaying historical market data at variable speeds
 */

class BacktestEngine {
  constructor(config, stateManager, eventBus) {
    this.config = config;
    this.state = stateManager;
    this.events = eventBus;
    this.isPlaying = false;
    this.isPaused = false;
    this.speed = 1;
    this.currentIndex = 0;
    this.historicalData = [];
    this.replayStartTime = null;
    this.replayInterval = null;
    this.initialBalance = 0;
    this.trades = [];
  }

  /**
   * Initialize backtest engine
   */
  init() {
    DELTA_LOGGER.log('[BacktestEngine] Initialized');
  }

  /**
   * Load historical data for backtesting
   * @param {Array} data - Array of historical tick data
   */
  loadData(data) {
    if (!Array.isArray(data) || data.length === 0) {
      DELTA_LOGGER.warn('[BacktestEngine] Invalid or empty data');
      return;
    }

    this.historicalData = data.sort((a, b) => a.timestamp - b.timestamp);
    this.currentIndex = 0;
    
    DELTA_LOGGER.log('[BacktestEngine] Loaded', data.length, 'data points');
    DELTA_LOGGER.log('[BacktestEngine] Time range:', 
      new Date(data[0].timestamp).toISOString(),
      'to',
      new Date(data[data.length - 1].timestamp).toISOString());
  }

  /**
   * Load data from IndexedDB
   * @param {string} symbol - Trading symbol
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Promise<boolean>} Success
   */
  async loadDataFromDB(symbol, startTime, endTime) {
    try {
      const data = await storage.getByTimeRange('ticks', startTime, endTime);
      const symbolData = data.filter(t => t.symbol === symbol);
      
      if (symbolData.length === 0) {
        DELTA_LOGGER.warn('[BacktestEngine] No data found for', symbol);
        return false;
      }

      this.loadData(symbolData);
      return true;
    } catch (e) {
      DELTA_LOGGER.error('[BacktestEngine] Failed to load data from DB:', e);
      return false;
    }
  }

  /**
   * Start backtesting
   * @param {Object} options - Backtest options
   */
  start(options = {}) {
    if (this.historicalData.length === 0) {
      DELTA_LOGGER.warn('[BacktestEngine] No data loaded');
      return;
    }

    this.isPlaying = true;
    this.isPaused = false;
    this.currentIndex = 0;
    this.speed = options.speed || 1;
    this.replayStartTime = Date.now();
    
    // Save initial balance
    const state = this.state.getState();
    this.initialBalance = state.inr + (state.usd * this.config.BASE_RATE);
    this.trades = [];

    // Start replay loop
    const interval = Math.max(10, 1000 / this.speed);
    this.replayInterval = setInterval(() => this.tick(), interval);

    this.events.emit('backtest:started', {
      dataPoints: this.historicalData.length,
      speed: this.speed
    });

    DELTA_LOGGER.log('[BacktestEngine] Started with speed:', this.speed + 'x');
  }

  /**
   * Pause backtesting
   */
  pause() {
    this.isPaused = true;
    if (this.replayInterval) {
      clearInterval(this.replayInterval);
    }
    this.events.emit('backtest:paused');
  }

  /**
   * Resume backtesting
   */
  resume() {
    if (!this.isPlaying) return;
    
    this.isPaused = false;
    const interval = Math.max(10, 1000 / this.speed);
    this.replayInterval = setInterval(() => this.tick(), interval);
    this.events.emit('backtest:resumed');
  }

  /**
   * Stop backtesting
   */
  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    
    if (this.replayInterval) {
      clearInterval(this.replayInterval);
      this.replayInterval = null;
    }

    const results = this.getResults();
    this.events.emit('backtest:stopped', results);
    
    DELTA_LOGGER.log('[BacktestEngine] Stopped. Results:', results);
  }

  /**
   * Set replay speed
   * @param {number} speed - Speed multiplier (1, 2, 5, 10)
   */
  setSpeed(speed) {
    this.speed = Math.max(0.5, Math.min(100, speed));
    
    if (this.isPlaying && !this.isPaused) {
      clearInterval(this.replayInterval);
      const interval = Math.max(10, 1000 / this.speed);
      this.replayInterval = setInterval(() => this.tick(), interval);
    }

    this.events.emit('backtest:speedChanged', { speed: this.speed });
  }

  /**
   * Tick - process next data point
   */
  tick() {
    if (!this.isPlaying || this.isPaused) return;
    if (this.currentIndex >= this.historicalData.length) {
      this.stop();
      return;
    }

    const dataPoint = this.historicalData[this.currentIndex];
    
    // Emit price update
    this.events.emit(EVENTS.PRICE_UPDATE, {
      symbol: dataPoint.symbol,
      price: dataPoint.price,
      timestamp: dataPoint.timestamp
    });

    this.currentIndex++;

    // Emit progress
    const progress = (this.currentIndex / this.historicalData.length) * 100;
    this.events.emit('backtest:progress', {
      current: this.currentIndex,
      total: this.historicalData.length,
      percent: progress
    });
  }

  /**
   * Get backtest results
   * @returns {Object} Backtest results
   */
  getResults() {
    const state = this.state.getState();
    const finalBalance = state.inr + (state.usd * this.config.BASE_RATE);
    const totalReturn = ((finalBalance - this.initialBalance) / this.initialBalance) * 100;

    // Calculate metrics
    const riskMetrics = new RiskMetrics(this.config, this.state);
    const metrics = riskMetrics.calculate();

    return {
      initialBalance: this.initialBalance,
      finalBalance,
      totalReturn,
      totalTrades: state.wins + state.losses,
      winningTrades: state.wins,
      losingTrades: state.losses,
      winRate: metrics.winRate,
      maxDrawdown: metrics.maxDrawdownPercent,
      sharpeRatio: metrics.sharpeRatio,
      profitFactor: metrics.profitFactor,
      dataPointsProcessed: this.currentIndex,
      totalDataPoints: this.historicalData.length,
      speed: this.speed,
      duration: this.currentIndex / this.speed // seconds
    };
  }

  /**
   * Skip forward N data points
   * @param {number} n - Number of points to skip
   */
  skipForward(n = 100) {
    this.currentIndex = Math.min(this.currentIndex + n, this.historicalData.length - 1);
    this.events.emit('backtest:skip', { index: this.currentIndex });
  }

  /**
   * Skip backward N data points
   * @param {number} n - Number of points to skip
   */
  skipBackward(n = 100) {
    this.currentIndex = Math.max(this.currentIndex - n, 0);
    this.events.emit('backtest:skip', { index: this.currentIndex });
  }

  /**
   * Jump to specific time
   * @param {number} timestamp - Target timestamp
   */
  jumpTo(timestamp) {
    const index = this.historicalData.findIndex(d => d.timestamp >= timestamp);
    if (index !== -1) {
      this.currentIndex = index;
      this.events.emit('backtest:skip', { index });
    }
  }

  /**
   * Get current position in replay
   * @returns {Object} Current position info
   */
  getPosition() {
    const current = this.historicalData[this.currentIndex];
    return {
      index: this.currentIndex,
      total: this.historicalData.length,
      percent: (this.currentIndex / this.historicalData.length) * 100,
      timestamp: current ? current.timestamp : null,
      price: current ? current.price : null,
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      speed: this.speed
    };
  }

  /**
   * Export backtest results
   * @returns {Object} Exportable results
   */
  exportResults() {
    const results = this.getResults();
    const state = this.state.getState();

    return {
      ...results,
      tradeHistory: state.history,
      equityCurve: state.equityCurve,
      exportTime: Date.now()
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stop();
    this.historicalData = [];
  }
}

