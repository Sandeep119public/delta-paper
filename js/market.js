/**
 * Delta Paper Trading - Market Data Module (REAL-TIME)
 * Direct WebSocket connection to Delta Exchange India for live prices
 * Supports multiple message formats and automatic reconnection
 */

class MarketDataManager {
  constructor(config) {
    this.config = config;
    this.markets = {};
    this.sockets = [];
    this.dataSource = 'boot';
    this.lastRestPoll = 0;
    this.listeners = new Set();
    this.updateCount = 0;
    this.lastUpdateTime = 0;
    this.notifyRAF = null;
  }

  /**
   * Initialize market data manager
   */
  async init() {
    // Initialize market entries
    this.config.SYMBOLS.forEach(sym => {
      this.markets[sym] = this.createMarketEntry(sym);
    });

    // Boot sequence: fetch lot sizes and initial ticker data
    await Promise.all([
      this.bootLots(),
      this.bootREST()
    ]);

    // Connect WebSocket for live updates
    this.connectAllWS();

    // Start REST polling as backup (3 second interval)
    setInterval(() => this.restPoll(), 3000);

    DELTA_LOGGER.log('[Market] Initialized with', Object.keys(this.markets).length, 'symbols');
  }

  /**
   * Create a market entry object
   */
  createMarketEntry(symbol) {
    return {
      symbol: symbol,
      price: null,
      prevPrice: null,
      open24: null,
      chg24: null,
      funding: null,
      lot: this.config.LOT_SIZES[symbol] || 0.001,
      gotLive: false,
      dec: 2,
      decLocked: false
    };
  }

  /**
   * Build markets from ticker data
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
   * Apply ticker object to market data - OPTIMIZED FOR SPEED
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
      const products = await this.apiGet('/v2/products?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
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
        DELTA_LOGGER.log('[Market] ✓ Lot sizes updated:', this.config.LOT_SIZES);
      }
    } catch (e) {
      DELTA_LOGGER.warn('[Market] ✗ Lot fetch failed, using defaults:', e.message);
    }
  }

  /**
   * Bootstrap via REST API
   */
  async bootREST() {
    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
      if (Array.isArray(tickers) && tickers.length) {
        this.buildMarketsFromTickers(tickers);
        DELTA_LOGGER.log('[Market] ✓ Bootstrapped via REST - got', tickers.length, 'tickers');
      }
    } catch (e) {
      DELTA_LOGGER.warn('[Market] ✗ REST boot failed:', e.message);
      // Fallback: set simulated prices based on config BASE_RATE
      this.config.SYMBOLS.forEach(sym => {
        if (!this.markets[sym].price) {
          const simPrice = this.getSimulatedPrice(sym);
          this.applyTickerObj({ symbol: sym, close: simPrice, mark_price: simPrice });
          this.markets[sym].gotLive = false;
        }
      });
    }
  }

  /**
   * Get simulated price for fallback (when API fails)
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
    if (Date.now() - this.lastRestPoll < 3000) return;
    this.lastRestPoll = Date.now();

    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
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
   * Connect to all WebSocket endpoints
   */
  connectAllWS() {
    this.config.WS_ENDPOINTS.forEach(url => this.openWS(url));
  }

  /**
   * Open WebSocket connection - DIRECT CONNECTION, NO PROXY
   */
  openWS(url) {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      DELTA_LOGGER.warn('[Market] WS connection failed:', url, e.message);
      this.scheduleReconnect(url);
      return;
    }

    const sock = { url, ws, hadData: false, hb: null, retries: 0 };
    this.sockets.push(sock);

    ws.onopen = () => {
      DELTA_LOGGER.log('[Market] WS connected:', url);
      this.sendSubscriptions(sock);

      // Heartbeat to keep connection alive
      if (sock.hb) clearInterval(sock.hb);
      sock.hb = setInterval(() => {
        try {
          if (ws.readyState === 1) {
            ws.send('{"type":"ping"}');
          }
        } catch (e) {}
      }, 20000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      this.handleWsMsg(msg, sock);
    };

    ws.onclose = () => {
      if (sock.hb) {
        clearInterval(sock.hb);
        sock.hb = null;
      }
      this.scheduleReconnect(url);
    };

    ws.onerror = (e) => {
      DELTA_LOGGER.warn('[Market] WS error:', url, e);
      try { ws.close(); } catch (e) {}
    };
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   */
  scheduleReconnect(url) {
    const sock = this.sockets.find(s => s.url === url);
    if (sock) {
      sock.retries = Math.min(sock.retries + 1, 8);
    }
    
    const delay = Math.min(30000, 100 * Math.pow(2, (sock ? sock.retries : 1)));
    setTimeout(() => {
      const idx = this.sockets.findIndex(s => s.url === url);
      if (idx >= 0) this.sockets.splice(idx, 1);
      this.openWS(url);
    }, delay);
  }

  /**
   * Send subscription messages - DELTA INDIA SPECIFIC FORMAT
   */
  sendSubscriptions(sock) {
    const w = sock.ws;
    if (!w || w.readyState !== 1) return;

    try {
      // Subscribe to individual ticker channels for each symbol
      this.config.SYMBOLS.forEach(sym => {
        // Format 1: Individual ticker subscription
        w.send(JSON.stringify({
          type: 'subscribe',
          payload: {
            channels: [{ name: 'ticker:' + sym }]
          }
        }));
        
        // Format 2: Alternative channel format (orderbook)
        w.send(JSON.stringify({
          type: 'subscribe',
          payload: {
            channels: [{ name: 'l2_' + sym }]
          }
        }));

        // Format 3: Trade stream
        w.send(JSON.stringify({
          type: 'subscribe',
          payload: {
            channels: [{ name: 'trade:' + sym }]
          }
        }));
      });

      // Also try bulk subscription
      w.send(JSON.stringify({
        type: 'subscribe',
        payload: {
          channels: this.config.SYMBOLS.map(sym => ({ name: 'ticker:' + sym }))
        }
      }));

      DELTA_LOGGER.log('[Market] Subscribed to:', this.config.SYMBOLS.join(', '));
    } catch (e) {
      DELTA_LOGGER.warn('[Market] Subscription failed:', e.message);
    }
  }

  /**
   * Handle WebSocket message - SUPPORTS ALL DELTA FORMATS
   */
  handleWsMsg(msg, sock) {
    const tp = msg.type;
    
    // Skip non-data messages
    if (!tp || tp === 'heartbeat' || tp === 'subscriptions' || tp === 'success' || tp === 'pong') {
      return;
    }

    sock.hadData = true;

    // Format 1: Channel-based ticker (ticker:SYMBOL)
    if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('ticker:')) {
      const sym = msg.channel.split(':')[1];
      if (this.markets[sym] && msg.data) {
        this.applyTickerObj({ ...msg.data, symbol: sym });
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }

    // Format 2: Channel-based trade (trade:SYMBOL)
    if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('trade:')) {
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
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }

    // Format 3: Full ticker with symbol field in data
    if (msg.data && msg.data.symbol) {
      this.applyTickerObj(msg.data);
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // Format 4: Direct message with symbol
    if (msg.symbol && (msg.mark_price !== undefined || msg.close !== undefined || msg.last_price !== undefined)) {
      this.applyTickerObj(msg);
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // Format 5: Array of tickers
    if (Array.isArray(msg)) {
      msg.forEach(t => this.applyTickerObj(t));
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // Format 6: Nested data structure with array
    if (msg.data && Array.isArray(msg.data)) {
      msg.data.forEach(t => {
        if (t.symbol) this.applyTickerObj(t);
      });
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // Format 7: Compact ticker with sy field
    if (msg.sy && Array.isArray(msg.d)) {
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
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }
  }

  /**
   * Generic API GET with proxy fallback chain
   */
  async apiGet(path) {
    const url = this.config.API_BASE + path;
    let lastErr = null;

    // Try direct connection only (proxies return HTML errors)
    for (let i = 0; i < this.config.PROXY_CHAIN.length; i++) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(this.config.PROXY_CHAIN[i](url), { signal: ctrl.signal });
        clearTimeout(to);

        if (!r.ok) {
          lastErr = new Error('HTTP ' + r.status);
          continue;
        }

        const j = await r.json();
        if (j && j.success === false) {
          lastErr = new Error('API error: ' + (j.message || 'unknown'));
          continue;
        }

        return j.result || j;
      } catch (e) {
        DELTA_LOGGER.warn('[Market] API attempt', i+1, 'failed:', e.message);
        lastErr = e;
      }
    }

    throw lastErr || new Error('Fetch failed');
  }

  /**
   * Determine decimal places for price display
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
   */
  getMarket(symbol) {
    return this.markets[symbol] || null;
  }

  /**
   * Get all markets
   */
  getAllMarkets() {
    return this.markets;
  }

  /**
   * Subscribe to market data updates
   */
  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners of data update - THROTTLED TO 60fps
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
   */
  getDataSource() {
    return this.dataSource;
  }

  /**
   * Get update statistics
   */
  getStats() {
    return {
      updates: this.updateCount,
      lastUpdate: this.lastUpdateTime,
      latency: this.lastUpdateTime ? Date.now() - this.lastUpdateTime : null,
      source: this.dataSource,
      sockets: this.sockets.filter(s => s.ws.readyState === 1).length
    };
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarketDataManager;
}
