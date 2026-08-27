/**
 * Delta Paper Trading - Liquidation Heatmap Overlay
 * Visualizes liquidation price clusters as glowing horizontal bars
 * overlaid on the lightweight-charts price chart.
 *
 * Uses candleSeries.priceToCoordinate() for zoom/scroll synchronization.
 * Two layers:
 *   1. User positions → bright, crisp lines (personal risk)
 *   2. Simulated market clusters → soft glowing background (macro structure)
 *
 * Usage:
 *   const heatmap = new LiquidationHeatmap(chart, candleSeries, canvas, config, state);
 *   heatmap.refresh();   // call every 1s from simulation loop
 *   heatmap.toggle(on);  // show/hide
 */

class LiquidationHeatmap {
  /**
   * @param {IChartApi}      chart       - lightweight-charts instance
   * @param {ISeriesApi}     candleSeries - candlestick series (for priceToCoordinate)
   * @param {HTMLCanvasElement} canvas    - overlay canvas
   * @param {Object}         config      - DELTA_CONFIG
   * @param {Object}         state       - AppState instance (for positions)
   * @param {Object}         [simEngine] - SimulationEngine (for simulated clusters)
   */
  constructor(chart, candleSeries, canvas, config, state, simEngine) {
    this.chart = chart;
    this.candleSeries = candleSeries;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = config;
    this.state = state;
    this.simEngine = simEngine || null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.enabled = true;
    this._rafId = null;
    this._lastDraw = 0;
    this._fps = (config.VIS && config.VIS.HEATMAP_FPS) || 15;
    this._bucketSize = (config.VIS && config.VIS.HEATMAP_BUCKET_SIZE) || 50;

    // Cached cluster data
    this._userClusters = [];    // [{ price, volume, side }]
    this._marketClusters = [];  // [{ price, intensity }]

    // Subscribe to chart scroll/zoom to trigger redraw
    this._onRangeChange = () => this._scheduleDraw();
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(this._onRangeChange);

    // Sync canvas size with chart container
    this._ro = new ResizeObserver(() => this._syncSize());
    this._ro.observe(canvas.parentElement);
    this._syncSize();
  }

  /** Toggle visibility. */
  toggle(on) {
    this.enabled = on;
    this.canvas.style.display = on ? 'block' : 'none';
    if (on) this._scheduleDraw();
  }

  /** Recalculate clusters and trigger a redraw. Call every ~1s. */
  refresh() {
    if (!this.enabled) return;
    this._calculateUserClusters();
    this._calculateMarketClusters();
    this._scheduleDraw();
  }

  /** Dispose. */
  destroy() {
    if (this._ro) this._ro.disconnect();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    try {
      this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this._onRangeChange);
    } catch (e) {}
  }

  // ── Cluster Calculation ────────────────────────────────────

  _calculateUserClusters() {
    const S = this.state.get ? this.state.get() : this.state;
    const positions = S.positions || {};
    const clusters = {};

    for (const sym in positions) {
      const pos = positions[sym];
      if (!pos || !pos.entry || !pos.lev) continue;

      // Liquidation price (same formula as app.js liqPrice)
      const mm = 0.005;
      const lp = pos.dir === 1
        ? pos.entry * (1 - 1 / pos.lev + mm)
        : pos.entry * (1 + 1 / pos.lev - mm);

      // Bucket the price
      const bucket = Math.round(lp / this._bucketSize) * this._bucketSize;
      const key = bucket.toFixed(0);

      if (!clusters[key]) {
        clusters[key] = { price: bucket, volume: 0, side: pos.dir };
      }
      clusters[key].volume += (pos.margin || 0);
    }

    this._userClusters = Object.values(clusters);
  }

  _calculateMarketClusters() {
    if (!this.simEngine) {
      this._marketClusters = [];
      return;
    }

    // Use SimulationEngine to generate synthetic OI clusters
    // We simulate multiple leverage tiers and aggregate liquidation zones
    const S = this.state.get ? this.state.get() : this.state;
    const clusters = {};
    const leverageTiers = [2, 3, 5, 10, 20, 50, 100];
    const notionalPerTier = 5000; // synthetic $5k per tier

    // Get current price from any active market
    let currentPrice = 0;
    const symbols = this.config.SYMBOLS || ['BTCUSD'];
    // Try to get price from state or use a placeholder
    if (S.positions) {
      for (const sym in S.positions) {
        const pos = S.positions[sym];
        if (pos && pos.entry) {
          currentPrice = pos.entry;
          break;
        }
      }
    }

    if (currentPrice <= 0) return;

    leverageTiers.forEach(lev => {
      // Long liquidation cluster (below price)
      const longLiq = currentPrice * (1 - 1 / lev + 0.005);
      const shortLiq = currentPrice * (1 + 1 / lev - 0.005);

      [longLiq, shortLiq].forEach(lp => {
        const bucket = Math.round(lp / this._bucketSize) * this._bucketSize;
        const key = bucket.toFixed(0);
        if (!clusters[key]) {
          clusters[key] = { price: bucket, volume: 0 };
        }
        clusters[key].volume += notionalPerTier;
      });
    });

    // Normalize intensities
    const maxVol = Math.max(...Object.values(clusters).map(c => c.volume), 1);
    this._marketClusters = Object.values(clusters).map(c => ({
      price: c.price,
      intensity: c.volume / maxVol,
    }));
  }

  // ── Rendering ──────────────────────────────────────────────

  _syncSize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._scheduleDraw();
  }

  _scheduleDraw() {
    if (!this.enabled) return;
    const now = performance.now();
    const interval = 1000 / this._fps;
    if (now - this._lastDraw < interval) {
      if (!this._rafId) {
        this._rafId = requestAnimationFrame(() => {
          this._rafId = null;
          this._draw();
        });
      }
      return;
    }
    this._draw();
  }

  _draw() {
    this._lastDraw = performance.now();
    this._rafId = null;

    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (W === 0 || H === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const w = W / this.dpr;
    const h = H / this.dpr;
    ctx.clearRect(0, 0, w, h);

    // ── Draw simulated market clusters (soft glow, background) ──
    this._marketClusters.forEach(cluster => {
      const y = this.candleSeries.priceToCoordinate(cluster.price);
      if (y === null || y < 0 || y > h) return;

      const intensity = Math.min(cluster.intensity, 1);
      const bandHeight = 6 + intensity * 10;

      const gradient = ctx.createLinearGradient(0, y - bandHeight, 0, y + bandHeight);
      gradient.addColorStop(0, 'rgba(139, 92, 246, 0)');
      gradient.addColorStop(0.5, `rgba(139, 92, 246, ${intensity * 0.25})`);
      gradient.addColorStop(1, 'rgba(139, 92, 246, 0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, y - bandHeight, w, bandHeight * 2);
    });

    // ── Draw user position clusters (bright, crisp lines) ──
    this._userClusters.forEach(cluster => {
      const y = this.candleSeries.priceToCoordinate(cluster.price);
      if (y === null || y < 0 || y > h) return;

      const intensity = Math.min(cluster.volume / 5000, 1); // scale by $5k
      const isLong = cluster.side === 1;
      const color = isLong ? 'rgba(239, 68, 68, ' : 'rgba(239, 68, 68, ';
      const labelColor = isLong ? '#ef4444' : '#ef4444';

      // Glow
      const glowGrad = ctx.createLinearGradient(0, y - 8, 0, y + 8);
      glowGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      glowGrad.addColorStop(0.5, `rgba(239, 68, 68, ${0.15 + intensity * 0.3})`);
      glowGrad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, y - 8, w, 16);

      // Solid line
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.6 + intensity * 0.4})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = labelColor;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText('LIQ ' + this._fmtPrice(cluster.price), w - 4, y - 10);
    });
  }

  _fmtPrice(p) {
    return p > 100 ? p.toFixed(1) : p.toFixed(4);
  }
}
