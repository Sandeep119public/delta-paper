/**
 * Delta Paper Trading - Market Data Module (REAL-TIME)
 * Direct WebSocket connection to Delta Exchange India for live prices
 * Supports multiple message formats and automatic reconnection
 *
 * Patched: fixed apiGet proxy-chain application, correct Delta WS
 * subscription protocol, full ticker/trades/ob_l1/funding/mark_price
 * parsing, heartbeat watchdog, and missing notifyListeners() in
 * the REST fallback path.
 */

class MarketDataManager {
  constructor(config) {
    this.config = config;
    this.markets = {};
    this.sockets = [];
    this.dataSource = 'boot';     // 'boot' | 'rest' | 'live' | 'sim'
    this.lastRestPoll = 0;
    this.listeners = new Set();
    this.updateCount = 0;
    this.lastUpdateTime = 0;
    this.lastHeartbeat = 0;
    this.notifyRAF = null;
    this.hbWatchRAF = null;
  }

  /** Initialize market data manager */
  async init() {
    this.config.SYMBOLS.forEach(sym => {
      this.markets[sym] = this.createMarketEntry(sym);
    });

    // Boot: lot sizes + initial tickers in parallel
    await Promise.all([this.bootLots(), this.bootREST()]);

    // Live WS feed (multiple endpoint fallbacks)
    this.connectAllWS();

    // REST polling as WS backup
    setInterval(() => this.restPoll(), this.config.PERF && this.config.PERF.REST_POLL_INTERVAL || 3000);

    // Heartbeat watchdog — reconnect if feed stalls
    setInterval(() => this.checkHeartbeat(), 10000);

    DELTA_LOGGER.log('[Market] Initialized with', Object.keys(this.markets).length, 'symbols');
  }

  createMarketEntry(symbol) {
    return {
      symbol: symbol,
      price: null,
      prevPrice: null,
      open24: null,
      chg24: null,
      funding: null,
      lot: (this.config.LOT_SIZES && this.config.LOT_SIZES[symbol]) || 0.001,
      gotLive: false,
      dec: 2,
      decLocked: false
    };
  }

  buildMarketsFromTickers(tickers) {
    if (!Array.isArray(tickers)) return;
    tickers.forEach(t => {
      if (t && t.symbol && this.markets[t.symbol]) this.applyTickerObj(t);
    });
    this.notifyListeners();
  }

  /** Apply a ticker-shaped object to a market entry */
  applyTickerObj(t) {
    if (!t) return;
    const sym = t.symbol;
    const m = this.markets[sym];
    if (!m) return;

    // Priority: mark_price > close > last_price > mid(best_ask, best_bid)
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
      // Keep gotLive flag true only if set externally; REST fallbacks leave it false
    }

    // 24h % change
    let ch = parseFloat(t.mark_change_24h);
    if (!isFinite(ch)) ch = parseFloat(t.ltp_change_24h);
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

  async bootLots() {
    try {
      const products = await this.apiGet('/v2/products?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
      if (Array.isArray(products)) {
        products.forEach(p => {
          const sym = p && p.underlying_asset_symbol;
          if (sym && this.markets[sym]) {
            const cv = parseFloat(p.contract_value);
            if (isFinite(cv) && cv > 0) {
              this.markets[sym].lot = cv;
              if (this.config.LOT_SIZES) this.config.LOT_SIZES[sym] = cv;
            }
          }
        });
        DELTA_LOGGER.log('[Market] ✓ Lot sizes updated:', this.config.LOT_SIZES);
      }
    } catch (e) {
      DELTA_LOGGER.warn('[Market] ✗ Lot fetch failed, using defaults:', e.message);
    }
  }

  async bootREST() {
    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
      if (Array.isArray(tickers) && tickers.length) {
        this.buildMarketsFromTickers(tickers);
        this.dataSource = 'rest';
        DELTA_LOGGER.log('[Market] ✓ Bootstrapped via REST - got', tickers.length, 'tickers');
      } else {
        throw new Error('Empty ticker response');
      }
    } catch (e) {
      DELTA_LOGGER.warn('[Market] ✗ REST boot failed, using simulation:', e.message);
      this.config.SYMBOLS.forEach(sym => {
        if (!this.markets[sym].price) {
          const simPrice = this.getSimulatedPrice(sym);
          this.applyTickerObj({ symbol: sym, close: simPrice, mark_price: simPrice });
          this.markets[sym].gotLive = false;
        }
      });
      this.dataSource = 'sim';
      this.notifyListeners();   // <-- FIX: repaint UI with simulated prices
    }
  }

  getSimulatedPrice(symbol) {
    const basePrices = { BTCUSD: 78000, ETHUSD: 2450, SOLUSD: 96 };
    return basePrices[symbol] || 100;
  }

  async restPoll() {
    if (Date.now() - this.lastRestPoll < 3000) return;
    this.lastRestPoll = Date.now();

    try {
      const tickers = await this.apiGet('/v2/tickers?contract_types=perpetual_futures&underlying_asset_symbols=' + this.config.SYMBOLS.join(','));
      if (Array.isArray(tickers)) {
        tickers.forEach(t => {
          if (t && t.symbol && this.markets[t.symbol]) this.applyTickerObj(t);
        });
        if (!Object.values(this.markets).some(m => m.gotLive)) {
          this.dataSource = 'rest';
        }
        this.notifyListeners();
      }
    } catch (e) {
      // Silent fail for polling
    }
  }

  connectAllWS() {
    (this.config.WS_ENDPOINTS || []).forEach(url => this.openWS(url));
  }

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

      if (sock.hb) clearInterval(sock.hb);
      sock.hb = setInterval(() => {
        try {
          if (ws.readyState === 1) ws.send('{"type":"ping"}');
        } catch (e) {}
      }, (this.config.PERF && this.config.PERF.WS_HEARTBEAT) || 20000);
    };

    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      this.handleWsMsg(msg, sock);
    };

    ws.onclose = () => {
      if (sock.hb) { clearInterval(sock.hb); sock.hb = null; }
      this.scheduleReconnect(url);
    };

    ws.onerror = (e) => {
      DELTA_LOGGER.warn('[Market] WS error:', url, e);
      try { ws.close(); } catch (e) {}
    };
  }

  scheduleReconnect(url) {
    const sock = this.sockets.find(s => s.url === url);
    if (sock) sock.retries = Math.min(sock.retries + 1, 8);

    const base = (this.config.PERF && this.config.PERF.RECONNECT_BASE_DELAY) || 100;
    const max  = (this.config.PERF && this.config.PERF.MAX_RECONNECT_DELAY)  || 30000;
    const delay = Math.min(max, base * Math.pow(2, (sock ? sock.retries : 1)));

    setTimeout(() => {
      const idx = this.sockets.findIndex(s => s.url === url);
      if (idx >= 0) this.sockets.splice(idx, 1);
      this.openWS(url);
    }, delay);
  }

  /** Subscribe using the correct Delta Exchange WS protocol */
  sendSubscriptions(sock) {
    const w = sock.ws;
    if (!w || w.readyState !== 1) return;
    const syms = this.config.SYMBOLS;

    try {
      // Enable server-side heartbeat (Delta-specific)
      w.send(JSON.stringify({ type: 'enable_heartbeat' }));

      // Official subscribe: channel name + symbols array.
      // Docs: "If you subscribe to the ticker channel without specifying a
      // symbols list, you will not receive any data."
      w.send(JSON.stringify({
        type: 'subscribe',
        payload: { channels: [
          { name: 'ticker',       symbols: syms },
          { name: 'trades',       symbols: syms },
          { name: 'ob_l1',        symbols: syms },
          { name: 'funding_rate', symbols: syms }
        ]}
      }));

      // Legacy/alternate formats as harmless fallbacks (server ignores unknowns)
      syms.forEach(sym => {
        w.send(JSON.stringify({ type: 'subscribe', payload: { channels: [{ name: 'ticker:' + sym }] } }));
        w.send(JSON.stringify({ type: 'subscribe', payload: { channels: [{ name: 'l2_' + sym   }] } }));
        w.send(JSON.stringify({ type: 'subscribe', payload: { channels: [{ name: 'trade:' + sym}] } }));
      });

      DELTA_LOGGER.log('[Market] Subscribed to:', syms.join(', '));
    } catch (e) {
      DELTA_LOGGER.warn('[Market] Subscription failed:', e.message);
    }
  }

  /**
   * Handle a WebSocket message. Supports both the official Delta shapes
   * (ticker/trades/ob_l1/funding_rate/mark_price/heartbeat) and legacy
   * shapes for backward compatibility.
   */
  handleWsMsg(msg, sock) {
    if (!msg || typeof msg !== 'object') return;
    const tp = msg.type;

    // Non-data messages
    if (!tp || tp === 'subscriptions' || tp === 'success') return;

    // Heartbeat/pong — track liveness and bail
    if (tp === 'heartbeat' || tp === 'pong') {
      this.lastHeartbeat = Date.now();
      return;
    }

    sock.hadData = true;
    this.lastHeartbeat = Date.now();

    // ---- Official Delta ticker channel ----
    // {type:'ticker', sy:'BTCUSD',
    //  d:[{m:'72124', m24hc:'1.5', q:['72101','822','72100','2123',null], ...}]}
    if (tp === 'ticker' && msg.sy && Array.isArray(msg.d) && msg.d.length > 0) {
      const d = msg.d[0];
      this.applyTickerObj({
        symbol: msg.sy,
        mark_price: d.m,
        mark_change_24h: d.m24hc,
        quotes: {
          best_ask: (d.q && d.q[0]),
          best_bid: (d.q && d.q[2])
        }
      });
      this.markets[msg.sy].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Official Delta trades channel ----
    // {type:'trades', sy:'BTCUSD', p:'72141.5', s:1.0, ...}
    if (tp === 'trades' && msg.sy && msg.p) {
      this.applyTickerObj({
        symbol: msg.sy,
        last_price: msg.p,
        close: msg.p
      });
      this.markets[msg.sy].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Official Delta ob_l1 channel ----
    // {type:'ob_l1', sy:'BTCUSD', ap:'68519.0', bp:'68518.0', ...}
    if (tp === 'ob_l1' && msg.sy) {
      this.applyTickerObj({
        symbol: msg.sy,
        quotes: { best_ask: msg.ap, best_bid: msg.bp }
      });
      this.markets[msg.sy].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Official funding_rate channel ----
    // {type:'funding_rate', sy:'BTCUSD', fr:'0.01', fi:28800, nfr:..., ...}
    if (tp === 'funding_rate' && msg.sy) {
      const m = this.markets[msg.sy];
      if (m) {
        const fr = parseFloat(msg.fr);
        if (isFinite(fr)) m.funding = fr;
        m.gotLive = true;
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }

    // ---- Official mark_price channel ----
    // {type:'mark_price', sy:'MARK:BTCUSD' | 'BTCUSD', p:'72124.5', ...}
    if (tp === 'mark_price' && msg.sy && msg.p) {
      const sym = (typeof msg.sy === 'string' && msg.sy.startsWith('MARK:'))
        ? msg.sy.substring(5) : msg.sy;
      this.applyTickerObj({ symbol: sym, mark_price: msg.p });
      if (this.markets[sym]) this.markets[sym].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Legacy Format 1: channel-based ticker "ticker:SYMBOL" ----
    if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('ticker:')) {
      const sym = msg.channel.split(':')[1];
      if (this.markets[sym] && msg.data) {
        this.applyTickerObj({ ...msg.data, symbol: sym });
        this.markets[sym].gotLive = true;
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }

    // ---- Legacy Format 2: channel-based trade "trade:SYMBOL" ----
    if (msg.channel && typeof msg.channel === 'string' && msg.channel.startsWith('trade:')) {
      const sym = msg.channel.split(':')[1];
      if (this.markets[sym] && Array.isArray(msg.data)) {
        msg.data.forEach(trade => {
          if (trade && trade.price) {
            this.applyTickerObj({ symbol: sym, last_price: trade.price, close: trade.price });
          }
        });
        if (this.markets[sym]) this.markets[sym].gotLive = true;
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }

    // ---- Legacy Format 3: full ticker with symbol in msg.data ----
    if (msg.data && msg.data.symbol) {
      this.applyTickerObj(msg.data);
      if (this.markets[msg.data.symbol]) this.markets[msg.data.symbol].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Legacy Format 4: direct ticker with symbol field ----
    if (msg.symbol && (msg.mark_price !== undefined || msg.close !== undefined || msg.last_price !== undefined)) {
      this.applyTickerObj(msg);
      if (this.markets[msg.symbol]) this.markets[msg.symbol].gotLive = true;
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Legacy Format 5: top-level array of tickers ----
    if (Array.isArray(msg)) {
      msg.forEach(t => { if (t && t.symbol) this.applyTickerObj(t); });
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Legacy Format 6: nested data array ----
    if (msg.data && Array.isArray(msg.data)) {
      msg.data.forEach(t => { if (t && t.symbol) this.applyTickerObj(t); });
      this.dataSource = 'live';
      this.notifyListeners();
      return;
    }

    // ---- Legacy Format 7: compact shape {sy, d:[{m},...]} (same as official ticker) ----
    if (msg.sy && Array.isArray(msg.d)) {
      const sym = msg.sy;
      const d = msg.d && msg.d[0];
      if (this.markets[sym] && d) {
        this.applyTickerObj({
          symbol: sym,
          mark_price: d.m,
          mark_change_24h: d.m24hc,
          quotes: { best_ask: (d.q && d.q[0]), best_bid: (d.q && d.q[2]) }
        });
        this.markets[sym].gotLive = true;
        this.dataSource = 'live';
        this.notifyListeners();
      }
      return;
    }
  }

  /**
   * Generic API GET with proxy-fallback chain.
   * Each PROXY_CHAIN entry is a function `url => finalUrl` so direct,
   * proxied, and CORS-proxied hops can coexist in config.js.
   */
  async apiGet(path) {
    const url = this.config.API_BASE + path;
    const chain = Array.isArray(this.config.PROXY_CHAIN) && this.config.PROXY_CHAIN.length
      ? this.config.PROXY_CHAIN
      : [u => u];
    let lastErr = null;

    for (let i = 0; i < chain.length; i++) {
      let finalUrl;
      try {
        const hop = chain[i];
        finalUrl = (typeof hop === 'function') ? hop(url) : (String(hop) + url);
      } catch (e) {
        lastErr = e;
        continue;
      }

      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(finalUrl, { signal: ctrl.signal });
        clearTimeout(to);

        if (!r.ok) {
          lastErr = new Error('HTTP ' + r.status);
          continue;
        }

        let j;
        try { j = await r.json(); }
        catch (e) { lastErr = new Error('Invalid JSON'); continue; }

        if (j && j.success === false) {
          lastErr = new Error('API error: ' + (j.message || 'unknown'));
          continue;
        }

        return (j && j.result !== undefined) ? j.result : j;
      } catch (e) {
        DELTA_LOGGER.warn('[Market] API attempt', i + 1, 'failed:', e.message);
        lastErr = e;
      }
    }

    throw lastErr || new Error('Fetch failed');
  }

  checkHeartbeat() {
    if (this.dataSource !== 'live') return;
    if (!this.lastHeartbeat) return;
    if (Date.now() - this.lastHeartbeat > 40000) {
      DELTA_LOGGER.warn('[Market] No data for 40s, forcing reconnect...');
      this.sockets.forEach(s => { try { s.ws && s.ws.close(); } catch (e) {} });
      this.sockets = [];
      this.connectAllWS();
    }
  }

  decFor(p) {
    if (p >= 10000) return 0;
    if (p >= 1000)  return 1;
    if (p >= 100)   return 2;
    if (p >= 10)    return 3;
    if (p >= 1)     return 4;
    return 6;
  }

  getMarket(symbol) { return this.markets[symbol] || null; }
  getAllMarkets()  { return this.markets; }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Throttle to requestAnimationFrame (≈60 fps) */
  notifyListeners() {
    if (this.notifyRAF) return;
    this.notifyRAF = requestAnimationFrame(() => {
      this.notifyRAF = null;
      this.listeners.forEach(cb => { try { cb(this.markets); } catch (e) {} });
    });
  }

  getDataSource() { return this.dataSource; }

  getStats() {
    const liveSockets = this.sockets.filter(s => s.ws && s.ws.readyState === 1).length;
    const anyGotLive = Object.values(this.markets).some(m => m.gotLive);
    return {
      updates: this.updateCount,
      lastUpdate: this.lastUpdateTime,
      latency: this.lastUpdateTime ? Date.now() - this.lastUpdateTime : null,
      lastHeartbeat: this.lastHeartbeat,
      source: this.dataSource,
      anyGotLive,
      sockets: liveSockets
    };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MarketDataManager;
}
