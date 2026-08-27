/**
 * Delta Paper Trading - Depth Chart (L2 Order Book Visualization)
 * Renders cumulative bid/ask depth on an HTML5 Canvas.
 * Accepts both simulated (SimulationEngine) and real L2 data.
 *
 * Usage:
 *   const depth = new DepthChart(canvas, config);
 *   depth.updateBidsAsks(bids, asks, midPrice);   // real or simulated
 *   depth.updateFromMarket(market, simEngine);    // convenience: simulate from mid
 */

class DepthChart {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} config - DELTA_CONFIG
   */
  constructor(canvas, config) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Current state
    this.bids = [];  // [[price, cumVol], ...] sorted descending by price
    this.asks = [];  // [[price, cumVol], ...] sorted ascending by price
    this.midPrice = 0;

    // Throttle
    this._rafId = null;
    this._dirty = false;
    this._fps = (config.VIS && config.VIS.DEPTH_FPS) || 30;
    this._lastDraw = 0;

    // Resize observer
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas.parentElement);
    this._resize();
  }

  /**
   * Update with explicit bid/ask arrays.
   * @param {Array} bids - [{ price, volume }, ...] (unordered, will be sorted)
   * @param {Array} asks - [{ price, volume }, ...]
   * @param {number} midPrice
   */
  updateBidsAsks(bids, asks, midPrice) {
    this.midPrice = midPrice;

    // Sort and compute cumulative volume
    this.bids = bids
      .slice()
      .sort((a, b) => b.price - a.price)
      .reduce((acc, entry) => {
        const cumVol = acc.length > 0 ? acc[acc.length - 1][1] + entry.volume : entry.volume;
        acc.push([entry.price, cumVol]);
        return acc;
      }, []);

    this.asks = asks
      .slice()
      .sort((a, b) => a.price - b.price)
      .reduce((acc, entry) => {
        const cumVol = acc.length > 0 ? acc[acc.length - 1][1] + entry.volume : entry.volume;
        acc.push([entry.price, cumVol]);
        return acc;
      }, []);

    this._scheduleDraw();
  }

  /**
   * Convenience: generate simulated depth from current market price.
   * @param {Object} market - { price }
   * @param {Object} simEngine - SimulationEngine instance
   */
  updateFromMarket(market, simEngine) {
    if (!market || !(market.price > 0) || !simEngine) return;
    const levels = (this.config.VIS && this.config.VIS.DEPTH_LEVELS) || 25;
    const book = simEngine.simulateOrderBook(market.price, levels);
    this.updateBidsAsks(book.bids, book.asks, market.price);
  }

  /** Dispose resize observer. */
  destroy() {
    if (this._ro) this._ro.disconnect();
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }

  // ── Internal ──────────────────────────────────────────────

  _resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._dirty = true;
    this._draw();
  }

  _scheduleDraw() {
    this._dirty = true;
    if (!this._rafId) {
      this._rafId = requestAnimationFrame(() => {
        this._rafId = null;
        this._draw();
      });
    }
  }

  _draw() {
    if (!this._dirty) return;
    this._dirty = false;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = W / this.dpr;
    const h = H / this.dpr;
    ctx.clearRect(0, 0, w, h);

    if (this.bids.length === 0 && this.asks.length === 0) {
      ctx.fillStyle = '#5a6a80';
      ctx.font = '11px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Order book depth', w / 2, h / 2);
      return;
    }

    // Price range
    const bidMin = this.bids.length > 0 ? this.bids[this.bids.length - 1][0] : this.midPrice;
    const askMax = this.asks.length > 0 ? this.asks[this.asks.length - 1][0] : this.midPrice;
    const priceRange = Math.max(this.midPrice - bidMin, askMax - this.midPrice, this.midPrice * 0.001);
    const pMin = this.midPrice - priceRange * 1.05;
    const pMax = this.midPrice + priceRange * 1.05;

    // Cumulative volume range
    const maxCumVol = Math.max(
      this.bids.length > 0 ? this.bids[this.bids.length - 1][1] : 0,
      this.asks.length > 0 ? this.asks[this.asks.length - 1][1] : 0,
      1
    );

    const priceToX = (p) => ((p - pMin) / (pMax - pMin)) * w;
    const volToY = (v) => h - (v / maxCumVol) * (h * 0.85) - h * 0.05;
    const midX = priceToX(this.midPrice);

    // ── Draw Bids (green area) ──
    ctx.beginPath();
    ctx.moveTo(midX, h);
    this.bids.forEach(([price, cumVol]) => {
      ctx.lineTo(priceToX(price), volToY(cumVol));
    });
    ctx.lineTo(priceToX(pMin), volToY(0));
    ctx.lineTo(priceToX(pMin), h);
    ctx.closePath();

    const bidGrad = ctx.createLinearGradient(0, 0, 0, h);
    bidGrad.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
    bidGrad.addColorStop(1, 'rgba(16, 185, 129, 0.05)');
    ctx.fillStyle = bidGrad;
    ctx.fill();

    // Bid line
    ctx.beginPath();
    this.bids.forEach(([price, cumVol], i) => {
      const x = priceToX(price);
      const y = volToY(cumVol);
      i === 0 ? ctx.moveTo(midX, volToY(0)) : ctx.lineTo(priceToX(this.bids[i - 1][0]), volToY(this.bids[i - 1][1]));
      ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Draw Asks (red area) ──
    ctx.beginPath();
    ctx.moveTo(midX, h);
    this.asks.forEach(([price, cumVol]) => {
      ctx.lineTo(priceToX(price), volToY(cumVol));
    });
    ctx.lineTo(priceToX(pMax), volToY(0));
    ctx.lineTo(priceToX(pMax), h);
    ctx.closePath();

    const askGrad = ctx.createLinearGradient(0, 0, 0, h);
    askGrad.addColorStop(0, 'rgba(239, 68, 68, 0.35)');
    askGrad.addColorStop(1, 'rgba(239, 68, 68, 0.05)');
    ctx.fillStyle = askGrad;
    ctx.fill();

    // Ask line
    ctx.beginPath();
    this.asks.forEach(([price, cumVol], i) => {
      const x = priceToX(price);
      const y = volToY(cumVol);
      i === 0 ? ctx.moveTo(midX, volToY(0)) : ctx.lineTo(priceToX(this.asks[i - 1][0]), volToY(this.asks[i - 1][1]));
      ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ── Mid-price line ──
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Mid-price label ──
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.midPrice.toFixed(this.midPrice > 100 ? 1 : 4), midX, 12);

    // ── Spread label ──
    if (this.asks.length > 0 && this.bids.length > 0) {
      const bestBid = this.bids[0][0];
      const bestAsk = this.asks[0][0];
      const spread = bestAsk - bestBid;
      const spreadPct = ((spread / this.midPrice) * 100).toFixed(3);
      ctx.fillStyle = '#64748b';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText('Spread ' + spreadPct + '%', midX, h - 14);
    }
  }
}
