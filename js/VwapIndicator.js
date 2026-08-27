/**
 * Delta Paper Trading - VWAP Indicator
 * Volume-Weighted Average Price with optional standard deviation bands.
 * Renders directly on the lightweight-charts instance (bypasses state.js).
 *
 * Usage:
 *   const vwap = new VwapIndicator(chart, config);
 *   vwap.update(price, volume, timestamp);  // call on every tick
 *   vwap.reset();                           // manual reset
 *   vwap.toggle(on);                        // show/hide
 */

class VwapIndicator {
  /**
   * @param {IChartApi} chart - lightweight-charts chart instance
   * @param {Object}    opts
   * @param {boolean}   [opts.showBands=true]  - draw ±1σ / ±2σ bands
   * @param {string}    [opts.vwapColor='#f59e0b']
   */
  constructor(chart, opts = {}) {
    this.chart = chart;
    this.showBands = opts.showBands !== false;
    this.enabled = true;

    // Accumulators (reset daily at UTC 00:00)
    this.cumPV = 0;   // cumulative price * volume
    this.cumVol = 0;   // cumulative volume
    this.vwap = 0;
    this.varianceSum = 0; // for standard deviation bands
    this._lastUTCDate = null;

    // --- Series ---
    const addSeries = (typeof chart.addSeries === 'function')
      ? (type, opts) => chart.addSeries(type, opts)
      : null;

    if (addSeries) {
      this.vwapSeries = addSeries(LightweightCharts.LineSeries, {
        color: opts.vwapColor || '#f59e0b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    } else {
      this.vwapSeries = chart.addLineSeries({
        color: opts.vwapColor || '#f59e0b',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
    }

    // Band colors
    const bandColor1 = 'rgba(245, 158, 11, 0.12)';
    const bandColor2 = 'rgba(245, 158, 11, 0.06)';
    const bandLineOpts = (color) => ({
      color,
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    if (this.showBands) {
      if (addSeries) {
        this.upper1 = addSeries(LightweightCharts.LineSeries, bandLineOpts(bandColor1));
        this.lower1 = addSeries(LightweightCharts.LineSeries, bandLineOpts(bandColor1));
        this.upper2 = addSeries(LightweightCharts.LineSeries, bandLineOpts(bandColor2));
        this.lower2 = addSeries(LightweightCharts.LineSeries, bandLineOpts(bandColor2));
      } else {
        this.upper1 = chart.addLineSeries(bandLineOpts(bandColor1));
        this.lower1 = chart.addLineSeries(bandLineOpts(bandColor1));
        this.upper2 = chart.addLineSeries(bandLineOpts(bandColor2));
        this.lower2 = chart.addLineSeries(bandLineOpts(bandColor2));
      }
    }

    this._history = [];
  }

  /**
   * Feed a tick. Automatically resets accumulators at UTC midnight.
   * @param {number} price     - Current trade price
   * @param {number} volume    - Tick volume (can be 1 for tick-count VWAP)
   * @param {number} timestamp - Unix seconds
   */
  update(price, volume, timestamp) {
    if (!this.enabled || !(price > 0) || !isFinite(price)) return;
    if (!(volume > 0) || !isFinite(volume)) return;

    const utcDate = new Date(timestamp * 1000).getUTCDate();
    if (this._lastUTCDate !== null && utcDate !== this._lastUTCDate) this._resetAccumulators();
    this._lastUTCDate = utcDate;

    const pv = price * volume;
    this.cumPV += pv;
    this.cumVol += volume;

    const delta = price - this.vwap;
    this.vwap = this.cumPV / this.cumVol;
    const delta2 = price - this.vwap;
    this.varianceSum += delta * delta2;

    const time = Math.floor(timestamp);
    this.vwapSeries.update({ time, value: this.vwap });

    if (this.showBands && this.cumVol > 1) {
      const stdDev = Math.sqrt(Math.max(0, this.varianceSum) / this.cumVol);
      if (isFinite(stdDev)) {
        this.upper1.update({ time, value: this.vwap + stdDev });
        this.lower1.update({ time, value: this.vwap - stdDev });
        this.upper2.update({ time, value: this.vwap + 2 * stdDev });
        this.lower2.update({ time, value: this.vwap - 2 * stdDev });
      }
    }
  }

  /**
   * Set full candle data for historical load (e.g., after timeframe switch).
   * Call this with the candle history array to pre-fill VWAP.
   * @param {Array} candles - [{ time, open, high, low, close, volume }]
   */
  setData(candles) {
    this.clear();
    candles.forEach(c => {
      if (!(c.close > 0) || !(c.volume > 0)) return;
      this.update(c.close, c.volume, c.time);
    });
  }

  clear() {
    this._resetAccumulators();
    this._lastUTCDate = null;
    try {
      this.vwapSeries.setData([]);
      if (this.showBands) {
        this.upper1.setData([]); this.lower1.setData([]);
        this.upper2.setData([]); this.lower2.setData([]);
      }
    } catch (e) { /* ignore */ }
  }

  /** Show or hide all VWAP series. */
  toggle(on) {
    this.enabled = on;
    const visible = on ? 'visible' : 'hidden';
    try {
      this.vwapSeries.applyOptions({ visible: on });
      if (this.showBands) {
        this.upper1.applyOptions({ visible: on });
        this.lower1.applyOptions({ visible: on });
        this.upper2.applyOptions({ visible: on });
        this.lower2.applyOptions({ visible: on });
      }
    } catch (e) { /* older lightweight-charts versions */ }
  }

  /** Current VWAP value. */
  getVwap() { return this.vwap; }

  /** Current ±1σ range. */
  getBands() {
    if (!this.showBands || this.cumVol <= 1) return null;
    const stdDev = Math.sqrt(this.varianceSum / this.cumVol);
    return {
      upper2: this.vwap + 2 * stdDev,
      upper1: this.vwap + stdDev,
      lower1: this.vwap - stdDev,
      lower2: this.vwap - 2 * stdDev,
    };
  }

  _resetAccumulators() {
    this.cumPV = 0;
    this.cumVol = 0;
    this.vwap = 0;
    this.varianceSum = 0;
  }
}
