/**
 * Delta Paper Trading - Market Data Module
 * Fetches real-time market data from Delta Exchange India API
 * Uses WebSocket for live updates with REST fallback
 */

class MarketDataManager {
  constructor(config) {
    this.config = config;
    this.markets = {};
    this.sockets = [];
    this.dataSource = 'boot';
    this.lastRestPoll = 0;
    this.listeners = new Set();
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

    // Start REST polling as backup
    setInterval(() => this.restPoll(), 8000);

    console.log('[Market] Initialized with', Object.keys(this.markets).length, 'symbols');
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
   * Apply ticker object to market data
   */
  applyTickerObj(t) {
    const m = this.markets[t.symbol];
    if (!m) return;

    const mark = parseFloat(t.mark_price || t.close);
    if (isFinite(mark) && mark > 0) {
      m.prevPrice = m.price || mark;
      m.price = mark;
      m.gotLive = true;
      if (!m.decLocked) {
        m.dec = this.decFor(mark);
        m.decLocked = true;
      }
    }

    const o = parseFloat(t.open_interest || t.open_24h);
    if (isFinite(o) && o > 0) m.open24 = o;

    const ch = parseFloat(t.ltp_change_24h);
    if (isFinite(ch)) m.chg24 = ch;

    const fr = parseFloat(t.funding_rate);
    if (isFinite(fr)) m.funding = fr;
  }

  /**
   * Fetch official lot sizes from products API
   */
  async bootLots() {
    try {
      const prods = await this.apiGet('/v2/products?contract_types=perpetual_futures&underlying_asset_symbols=BTC,ETH,SOL');
      if (Array.isArray(prods)) {
        prods.forEach(p => {
          if (this.markets[p.symbol]) {
            const cv = parseFloat(p.contract_value);
            if (isFinite(cv) && cv > 0) {
              this.markets[p.symbol].lot = cv;
              console.log(`[Market] ${p.symbol} lot size: ${cv}`);
            }
          }
        });
        this.notifyListeners();
      }
    } catch (e) {
      console.warn('[Market] Failed to fetch lot sizes:', e.message);
    }
  }

  /**
   * Fetch initial ticker data via REST
   */
  async bootREST() {
    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures');
      if (Array.isArray(tickers) && tickers.length) {
        this.buildMarketsFromTickers(tickers);
        console.log('[Market] Bootstrapped via REST');
      }
    } catch (e) {
      console.warn('[Market] REST boot failed:', e.message);
    }
  }

  /**
   * Periodic REST polling as WebSocket backup
   */
  async restPoll() {
    if (Date.now() - this.lastRestPoll < 8000) return;
    this.lastRestPoll = Date.now();

    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures');
      if (Array.isArray(tickers)) {
        // If no WebSocket data yet, rebuild from REST
        if (!Object.values(this.markets).some(m => m.gotLive)) {
          this.buildMarketsFromTickers(tickers);
        }
        tickers.forEach(t => {
          if (this.markets[t.symbol]) {
            this.applyTickerObj(t);
          }
        });
        this.notifyListeners();
      }
    } catch (e) {
      console.warn('[Market] REST poll failed:', e.message);
    }
  }

  /**
   * Connect to all WebSocket endpoints
   */
  connectAllWS() {
    this.config.WS_ENDPOINTS.forEach(url => this.openWS(url));
  }

  /**
   * Open WebSocket connection
   */
  openWS(url) {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      console.warn('[Market] WS connection failed:', url, e.message);
      return;
    }

    const sock = { url, ws, hadData: false, hb: null, retries: 0 };
    this.sockets.push(sock);

    ws.onopen = () => {
      console.log('[Market] WS connected:', url);
      this.sendSubscriptions(sock);
      
      if (sock.hb) clearInterval(sock.hb);
      sock.hb = setInterval(() => {
        try {
          if (ws.readyState === 1) {
            ws.send('{"type":"heartbeat"}');
          }
        } catch (e) {}
      }, 25000);
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
      if (this.dataSource === 'sim') return;

      sock.retries++;
      const delay = Math.min(30000, 1500 * Math.pow(2, Math.min(sock.retries, 5)));
      setTimeout(() => {
        const i = this.sockets.indexOf(sock);
        if (i >= 0) this.sockets.splice(i, 1);
        if (this.dataSource === 'live') {
          this.openWS(url);
        }
      }, delay);
    };

    ws.onerror = () => {
      try { ws.close(); } catch (e) {}
    };
  }

  /**
   * Send subscription messages
   */
  sendSubscriptions(sock) {
    const w = sock.ws;
    if (!w || w.readyState !== 1) return;

    try {
      w.send(JSON.stringify({
        type: 'subscribe',
        payload: {
          channels: [{ name: 'ticker', symbols: this.config.SYMBOLS }]
        }
      }));
      w.send(JSON.stringify({
        type: 'subscribe',
        payload: {
          channels: [{ name: 'v2/ticker', symbols: this.config.SYMBOLS }]
        }
      }));
    } catch (e) {
      console.warn('[Market] Subscription failed:', e.message);
    }
  }

  /**
   * Handle WebSocket message
   */
  handleWsMsg(msg, sock) {
    const tp = msg.type;
    if (!tp || tp === 'heartbeat' || tp === 'subscriptions' || tp === 'success') return;

    if (tp === 'ticker') {
      sock.hadData = true;

      if (msg.sy && Array.isArray(msg.d)) {
        this.parseCompactTicker(msg);
      } else if (msg.data && msg.data.symbol) {
        this.applyTickerObj(msg.data);
      } else if (msg.symbol && (msg.mark_price !== undefined || msg.close !== undefined)) {
        this.applyTickerObj(msg);
      }

      this.dataSource = 'live';
      this.notifyListeners();
    }
  }

  /**
   * Parse compact ticker format
   */
  parseCompactTicker(msg) {
    const sym = msg.sy;
    const m = this.markets[sym];
    if (!m) return;

    const d = msg.d && msg.d[0];
    if (d) {
      const mark = parseFloat(d.m);
      if (isFinite(mark) && mark > 0) {
        m.prevPrice = m.price || mark;
        m.price = mark;
        m.gotLive = true;
        if (!m.decLocked) {
          m.dec = this.decFor(mark);
          m.decLocked = true;
        }
      }

      if (Array.isArray(d.ohlc) && d.ohlc.length >= 3) {
        const o = +d.ohlc[0];
        if (isFinite(o) && o > 0) m.open24 = o;
      }

      const ch = parseFloat(d.m24hc);
      if (isFinite(ch)) m.chg24 = ch;
    }
  }

  /**
   * Generic API GET with proxy fallback
   */
  async apiGet(path) {
    const url = this.config.API_BASE + path;
    let lastErr = null;

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
          lastErr = new Error('API error');
          continue;
        }

        return j.result;
      } catch (e) {
        lastErr = e;
      }
    }

    throw lastErr || new Error('Fetch failed');
  }

  /**
   * Determine decimal places for price display
   */
  decFor(p) {
    if (p >= 1000) return 1;
    if (p >= 100) return 2;
    if (p >= 1) return 4;
    return 5;
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
   * Notify all listeners of data update
   */
  notifyListeners() {
    this.listeners.forEach(cb => cb(this.markets));
  }

  /**
   * Get current data source status
   */
  getDataSource() {
    return this.dataSource;
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarketDataManager;
}
