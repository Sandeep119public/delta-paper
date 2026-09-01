/**
 * Delta Paper Trading - Market Data Service
 * Coordinator that consumes API and WebSocket services, normalizes data,
 * and exposes a clean subscribe interface
 */

class MarketDataService {
  constructor(config, apiService, wsService) {
    this.config = config;
    this.api = apiService;
    this.ws = wsService;
    this.markets = {};
    this.listeners = new Set();
    this.dataSource = 'boot';
    this.updateCount = 0;
    this.lastUpdateTime = 0;
    this.notifyRAF = null;
    this.restPollTimer = null;
    this.initPromise = null;

    // Bind methods
    this.handleMessage = this.handleMessage.bind(this);
  }

  /**
   * Initialize market data service
   */
  async init() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._init();
    return this.initPromise;
  }

  async _init() {
    this.config.SYMBOLS.forEach(sym => {
      if (!this.markets[sym]) this.markets[sym] = this.createMarketEntry(sym);
    });

    // Never let a slow or hanging REST endpoint keep the application in SYNC forever.
    const timeout = (promise, ms, label) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(label + ' timed out')), ms))
    ]);
    await Promise.allSettled([
      timeout(this.bootLots(), 8000, 'Lot bootstrap'),
      timeout(this.bootREST(), 8000, 'Ticker bootstrap')
    ]);

    this.ws.onMessage(this.handleMessage);
    this.ws.connectAll();

    if (!this.restPollTimer) this.restPollTimer = setInterval(() => this.restPoll(), 3000);

    // Guarantee a visible terminal state even when both network sources are unavailable.
    if (this.dataSource === 'boot') {
      this.config.SYMBOLS.forEach(sym => {
        const m = this.markets[sym];
        if (m && !(m.price > 0)) {
          const sim = this.getSimulatedPrice(sym);
          m.prevPrice = sim; m.price = sim; m.gotLive = false;
        }
      });
      this.dataSource = Object.values(this.markets).some(m => m.price > 0) ? 'sim' : 'offline';
      this.lastUpdateTime = Date.now();
      this.notifyListeners();
    }

    DELTA_LOGGER.log('[MarketDataService] Initialized with', Object.keys(this.markets).length, 'symbols; source=', this.dataSource);
  }

  /**
   * Create a market entry object
   * @param {string} symbol - Trading symbol
   * @returns {Object} Market entry
   */
  createMarketEntry(symbol) {
    return {
      symbol,
      price: null,
      prevPrice: null,
      open24: null,
      chg24: null,
      funding: null,
      lot: this.config.LOT_SIZES[symbol] || 0.001,
      gotLive: false,
      lastWsUpdate: 0,
      lastRestUpdate: 0,
      lastTradeSize: 0,
      lastTradeTime: 0,
      dec: 2,
      decLocked: false
    };
  }

  /**
   * Handle incoming WebSocket message
   * @param {Object} msg - Parsed message
   */
  handleMessage(msg) {
    this._ingestSource = 'ws';
    try {
    const msgType = msg.type;
    let updated = false;

    // Format: trades channel
    if (msgType === 'trades' && msg.sy && msg.p) {
      this.applyTickerObj({ symbol: msg.sy, last_price: msg.p, close: msg.p });
      updated = true;
    }
    // Format: mark_price channel
    else if (msgType === 'mark_price' && msg.sy && msg.p) {
      const sym = msg.sy.replace('MARK:', '');
      this.applyTickerObj({ symbol: sym, mark_price: msg.p });
      updated = true;
    }
    // Format: ticker channel with data array
    else if (msgType === 'ticker' && msg.sy && Array.isArray(msg.d)) {
      const sym = msg.sy;
      if (this.markets[sym] && msg.d.length > 0) {
        const d = msg.d[0];
        const mark = parseFloat(d.m);
        if (isFinite(mark) && mark > 0) {
          this.applyTickerObj({ symbol: sym, mark_price: mark });
        }
      }
      updated = true;
    }
    // Format: Channel-based ticker
    else if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('ticker:')) {
      const sym = msg.channel.split(':')[1];
      if (this.markets[sym] && msg.data) {
        this.applyTickerObj({ ...msg.data, symbol: sym });
        updated = true;
      }
    }
    // Format: Channel-based trade
    else if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('trade:')) {
      const sym = msg.channel.split(':')[1];
      if (this.markets[sym] && msg.data && Array.isArray(msg.data)) {
        msg.data.forEach(trade => {
          if (trade.price) {
            this.applyTickerObj({ 
              symbol: sym, 
              last_price: trade.price,
              close: trade.price
            });
          }
        });
        updated = true;
      }
    }
    // Format: Full ticker with symbol field in data
    else if (msg.data && msg.data.symbol) {
      this.applyTickerObj(msg.data);
      updated = true;
    }
    // Format: Direct message with symbol
    else if (msg.symbol && (msg.mark_price !== undefined || msg.close !== undefined || msg.last_price !== undefined)) {
      this.applyTickerObj(msg);
      updated = true;
    }
    // Format: Array of tickers
    else if (Array.isArray(msg)) {
      msg.forEach(t => this.applyTickerObj(t));
      updated = true;
    }
    // Format: Nested data structure with array
    else if (msg.data && Array.isArray(msg.data)) {
      msg.data.forEach(t => {
        if (t.symbol) this.applyTickerObj(t);
      });
      updated = true;
    }
    // Format: Compact ticker with sy field
    else if (msg.sy && Array.isArray(msg.d)) {
      const sym = msg.sy;
      if (this.markets[sym]) {
        const d = msg.d[0];
        if (d) {
          const mark = parseFloat(d.m);
          if (isFinite(mark) && mark > 0) {
            this.applyTickerObj({ symbol: sym, mark_price: mark });
          }
        }
      }
      updated = true;
    }

    if (updated) {
      this.dataSource = 'live';
      this.notifyListeners();
    }
    } finally { this._ingestSource = null; }
  }

  /**
   * Apply ticker object to market data
   * @param {Object} t - Ticker data
   */
  applyTickerObj(t) {
    const m = this.markets[t.symbol];
    if (!m) return;

    // Priority: mark_price > close > last_price > best_ask/best_bid mid
    let mark = parseFloat(t.mark_price);
    if (!isFinite(mark) || mark <= 0) mark = parseFloat(t.close);
    if (!isFinite(mark) || mark <= 0) mark = parseFloat(t.last_price);
    if ((!isFinite(mark) || mark <= 0) && t.quotes) {
      const ask = parseFloat(t.quotes.best_ask);
      const bid = parseFloat(t.quotes.best_bid);
      if (isFinite(ask) && isFinite(bid) && ask > 0 && bid > 0) {
        mark = (ask + bid) / 2;
      }
    }

    if (isFinite(mark) && mark > 0) {
      m.prevPrice = m.price || mark;
      m.price = mark;
      m.gotLive = true;
      if (this._ingestSource === 'ws') { m.lastWsUpdate = Date.now(); this.dataSource = 'live'; }
      else if (this._ingestSource === 'rest') { m.lastRestUpdate = Date.now(); if (this.dataSource !== 'live') this.dataSource = 'rest'; }
      
      // Auto-detect decimal precision
      if (!m.decLocked) {
        m.dec = this.decFor(mark);
        m.decLocked = true;
      }
    }

    // 24h change
    const ch = parseFloat(t.ltp_change_24h) || parseFloat(t.mark_change_24h);
    if (isFinite(ch)) m.chg24 = ch;

    // Funding rate
    const fr = parseFloat(t.funding_rate);
    if (isFinite(fr)) m.funding = fr;

    // Open interest
    const oi = parseFloat(t.open_interest) || parseFloat(t.oi);
    if (isFinite(oi)) m.open24 = oi;

    this.updateCount++;
    this.lastUpdateTime = Date.now();
  }

  /**
   * Fetch lot sizes from API
   */
  async bootLots() {
    try {
      const products = await this.api.get(
        '/v2/products?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(',')
      );
      if (Array.isArray(products)) {
        products.forEach(p => {
          const sym = p.underlying_asset_symbol;
          if (sym && this.markets[sym]) {
            const cv = parseFloat(p.contract_value);
            if (isFinite(cv) && cv > 0) {
              this.markets[sym].lot = cv;
              this.config.LOT_SIZES[sym] = cv;
            }
          }
        });
        DELTA_LOGGER.log('[MarketDataService] Lot sizes updated:', this.config.LOT_SIZES);
      }
    } catch (e) {
      DELTA_LOGGER.warn('[MarketDataService] Lot fetch failed, using defaults:', e.message);
    }
  }

  /**
   * Bootstrap via REST API
   */
  async bootREST() {
    this._ingestSource = 'rest';
    try {
      const tickers = await this.api.get(
        '/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(',')
      );
      if (Array.isArray(tickers) && tickers.length) {
        this.buildMarketsFromTickers(tickers);
        this.dataSource = 'rest';
        DELTA_LOGGER.log('[MarketDataService] Bootstrapped via REST - got', tickers.length, 'tickers');
      }
    } catch (e) {
      DELTA_LOGGER.warn('[MarketDataService] REST boot failed:', e.message);
      // Fallback: set simulated prices
      this.config.SYMBOLS.forEach(sym => {
        if (!this.markets[sym].price) {
          const simPrice = this.getSimulatedPrice(sym);
          this.applyTickerObj({ symbol: sym, close: simPrice, mark_price: simPrice });
          this.markets[sym].gotLive = false;
        }
      });
    } finally { this._ingestSource = null; }
  }

  /**
   * Build markets from ticker data
   * @param {Array} tickers - Array of ticker objects
   */
  buildMarketsFromTickers(tickers) {
    if (!Array.isArray(tickers)) return;

    tickers.forEach(t => {
      if (this.markets[t.symbol]) {
        this.applyTickerObj(t);
      }
    });

    this.notifyListeners();
  }

  /**
   * Get simulated price for fallback
   * @param {string} symbol - Trading symbol
   * @returns {number} Simulated price
   */
  getSimulatedPrice(symbol) {
    const basePrices = {
      BTCUSD: 78000,
      ETHUSD: 2450,
      SOLUSD: 96
    };
    return basePrices[symbol] || 100;
  }

  /**
   * Periodic REST polling as WebSocket backup
   */
  async restPoll() {
    this._ingestSource = 'rest';
    try {
      const tickers = await this.api.get(
        '/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(',')
      );
      if (Array.isArray(tickers)) {
        tickers.forEach(t => {
          if (this.markets[t.symbol]) {
            this.applyTickerObj(t);
          }
        });
        
        // Update data source if no WS yet
        if (!Object.values(this.markets).some(m => m.gotLive)) {
          this.dataSource = 'rest';
          this.notifyListeners();
        }
      }
    } catch (e) {
      // Silent fail for polling
    }
  }

  /**
   * Determine decimal places for price display
   * @param {number} p - Price
   * @returns {number} Decimal places
   */
  decFor(p) {
    if (p >= 10000) return 0;
    if (p >= 1000) return 1;
    if (p >= 100) return 2;
    if (p >= 10) return 3;
    if (p >= 1) return 4;
    return 6;
  }

  /**
   * Get market data for a symbol
   * @param {string} symbol - Trading symbol
   * @returns {Object|null} Market data
   */
  getMarket(symbol) {
    return this.markets[symbol] || null;
  }

  /**
   * Get all markets
   * @returns {Object} All market data
   */
  getAllMarkets() {
    return this.markets;
  }

  /**
   * Subscribe to market data updates
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of data update - throttled to 60fps
   */
  notifyListeners() {
    if (this.notifyRAF) return;
    
    this.notifyRAF = requestAnimationFrame(() => {
      this.notifyRAF = null;
      this.listeners.forEach(cb => cb(this.markets));
    });
  }

  /**
   * Get current data source status
   * @returns {string} Data source
   */
  getDataSource() {
    return this.dataSource;
  }

  /**
   * Get update statistics
   * @returns {Object} Statistics
   */
  getStats() {
    const now = Date.now(), markets = Object.values(this.markets || {});
    const ws = markets.filter(m => m.lastWsUpdate && now - m.lastWsUpdate <= 10000).length;
    const rest = markets.filter(m => m.lastRestUpdate && now - m.lastRestUpdate <= 10000).length;
    const sockets = this.ws?.getStatus ? this.ws.getStatus().active : 0;
    let source = this.dataSource;
    if (ws > 0 && sockets > 0) source = 'live';
    else if (rest > 0) source = 'rest';
    else if (markets.some(m => m.price > 0) && source === 'boot') source = 'sim';
    return { updates:this.updateCount,lastUpdate:this.lastUpdateTime,latency:this.lastUpdateTime ? now-this.lastUpdateTime : null,source,sockets,liveSymbols:ws,restSymbols:rest };
  }
}

