/**
 * Delta Paper Trading - Historical Replay / Paper Backtesting
 * Event-driven rAF loop for high-precision tick replay at 1x-1000x speeds
 * Integrates Tardis.dev API for historical tick-level data
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
    this._accumulatedTime = 0;
    this._lastFrameTime = 0;
    this._rafId = null;
  }

  init() {
    DELTA_LOGGER.log('[BacktestEngine] Initialized (rAF loop)');
  }

  /**
   * Fetch tick-level historical data from Tardis.dev API
   * @param {string} exchange - e.g., 'deribit', 'binance'
   * @param {string} symbol - e.g., 'BTC-PERPETUAL'
   * @param {string} date - e.g., '2020-03-12' (March Crash)
   */
  async loadHistoricalEvent(exchange, symbol, date) {
    try {
      const url = `https://api.tardis.dev/v1/exchanges/${exchange}/trades?symbol=${symbol}&date=${date}`;
      DELTA_LOGGER.log('[BacktestEngine] Fetching tick data from Tardis.dev...');

      const response = await fetch(url);
      const data = await response.json();

      const mappedData = (data.trades || []).map(trade => ({
        symbol: symbol,
        price: parseFloat(trade.price),
        quantity: parseFloat(trade.amount),
        timestamp: trade.timestamp,
        side: trade.side === 'buy' ? 1 : -1
      }));

      this.loadData(mappedData);
      this.events.emit('backtest:eventLoaded', { event: date, points: mappedData.length });
      return true;
    } catch (e) {
      DELTA_LOGGER.error('[BacktestEngine] Tardis fetch failed:', e);
      return false;
    }
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
   * Start backtesting with high-precision rAF loop
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
    this._accumulatedTime = 0;
    this._lastFrameTime = 0;

    const state = this.state.getState();
    this.initialBalance = state.inr + (state.usd * this.config.BASE_RATE);
    this.trades = [];

    this._startHighPrecisionLoop();

    this.events.emit('backtest:started', {
      dataPoints: this.historicalData.length,
      speed: this.speed
    });

    DELTA_LOGGER.log('[BacktestEngine] Started with speed:', this.speed + 'x');
  }

  /**
   * High-precision requestAnimationFrame loop for tick replay.
   * Scales historical time deltas rather than counting ticks, so it
   * won't skip timestamps at high speed (100x-1000x).
   */
  _startHighPrecisionLoop() {
    let lastFrameTime = performance.now();
    let accumulatedTime = 0;

    const loop = (currentTime) => {
      if (!this.isPlaying || this.isPaused) return;

      const deltaTime = currentTime - lastFrameTime;
      lastFrameTime = currentTime;

      // Scale real-world milliseconds by the replay speed
      accumulatedTime += deltaTime * this.speed;

      // Process as many ticks as the accumulated time allows
      while (this.currentIndex < this.historicalData.length) {
        const nextTick = this.historicalData[this.currentIndex];
        const timeDiff = this.currentIndex > 0
          ? nextTick.timestamp - this.historicalData[this.currentIndex - 1].timestamp
          : 0;

        if (accumulatedTime >= timeDiff) {
          accumulatedTime -= timeDiff;
          this._processTick(nextTick);
          this.currentIndex++;
        } else {
          break; // Wait for next frame
        }
      }

      if (this.currentIndex < this.historicalData.length) {
        this._rafId = requestAnimationFrame(loop);
      } else {
        this.stop();
      }
    };

    this._rafId = requestAnimationFrame(loop);
  }

  /**
   * Process a single tick through the engine pipeline
   * @param {Object} dataPoint - The tick to process
   */
  _processTick(dataPoint) {
    this.events.emit(EVENTS.PRICE_UPDATE, {
      symbol: dataPoint.symbol,
      price: dataPoint.price,
      timestamp: dataPoint.timestamp
    });

    const progress = (this.currentIndex / this.historicalData.length) * 100;
    this.events.emit('backtest:progress', {
      current: this.currentIndex,
      total: this.historicalData.length,
      percent: progress
    });
  }

  pause() {
    this.isPaused = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this.events.emit('backtest:paused');
  }

  resume() {
    if (!this.isPlaying) return;

    this.isPaused = false;
    this._lastFrameTime = performance.now();
    this._startHighPrecisionLoop();
    this.events.emit('backtest:resumed');
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;

    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    const results = this.getResults();
    this.events.emit('backtest:stopped', results);

    DELTA_LOGGER.log('[BacktestEngine] Stopped. Results:', results);
  }

  /**
   * Set replay speed (0.5x to 1000x)
   */
  setSpeed(speed) {
    this.speed = Math.max(0.5, Math.min(1000, speed));
    this.events.emit('backtest:speedChanged', { speed: this.speed });
  }

  /**
   * Legacy tick-based path (kept for compatibility, rarely used now)
   */
  tick() {
    if (!this.isPlaying || this.isPaused) return;
    if (this.currentIndex >= this.historicalData.length) {
      this.stop();
      return;
    }

    const dataPoint = this.historicalData[this.currentIndex];
    this._processTick(dataPoint);
    this.currentIndex++;
  }

  getResults() {
    const state = this.state.getState();
    const finalBalance = state.inr + (state.usd * this.config.BASE_RATE);
    const totalReturn = ((finalBalance - this.initialBalance) / this.initialBalance) * 100;

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
      duration: this.currentIndex / this.speed
    };
  }

  skipForward(n = 100) {
    this.currentIndex = Math.min(this.currentIndex + n, this.historicalData.length - 1);
    this.events.emit('backtest:skip', { index: this.currentIndex });
  }

  skipBackward(n = 100) {
    this.currentIndex = Math.max(this.currentIndex - n, 0);
    this.events.emit('backtest:skip', { index: this.currentIndex });
  }

  jumpTo(timestamp) {
    const index = this.historicalData.findIndex(d => d.timestamp >= timestamp);
    if (index !== -1) {
      this.currentIndex = index;
      this.events.emit('backtest:skip', { index });
    }
  }

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

  destroy() {
    this.stop();
    this.historicalData = [];
  }
}
