/**
 * Delta Paper Trading - Main Application Module
 * Core application logic, UI rendering, and event handling
 *
 * Patched: added renderStatus() that drives the header "SYNC…" / "LIVE"
 * chip and the market-panel feed badge from market.getStats(), and
 * hardened renderHeader() against undefined balances on first paint.
 */

class DeltaPaperApp {
  constructor(config, state, validator, market) {
    this.config = config;
    this.state = state;
    this.validator = validator;
    this.market = market;

    this.$ = (id) => document.getElementById(id);

    this.selSym = 'BTCUSD';
    this.curLots = 1;
    this.posDetailSym = null;
    this.cvtDir = 'i2u';
    this.hisLen = -1;

    this._tvChart = null;
    this._tvCandle = null;
    this._tvVol = null;
    this._tvPriceLines = [];
    this._prevPrice = {};
    this._tf = '1m';
    this._tfSec = 60;
    this._curCandle = null;
    this._historyCache = [];
    this._loadingOlder = false;
    this._isRendering = false;
    this._posCards = {};
    this._posKeyStr = '';

    // Visualization modules (initialized in _initChart)
    this.vwap = null;
    this.heatmap = null;

    this.init = this.init.bind(this);
    this.renderAll = this.renderAll.bind(this);
    this.switchSymbol = this.switchSymbol.bind(this);
    this.adjustLeverage = this.adjustLeverage.bind(this);
    this.executeTrade = this.executeTrade.bind(this);
    this.closePosition = this.closePosition.bind(this);
    this.handleMenuAction = this.handleMenuAction.bind(this);
  }

  async init() {
    DELTA_LOGGER.log('[App] Initializing...');
    this.market.subscribe(() => this.markDirty());
    this.setupEventListeners();

    this.curLots = this.getLots(this.selSym);
    if (this.state.get().equityCurve.length === 0) this.sampleEq();

    this._initChart();
    this._initVisualization();
    this.renderAll();
    this.startSimulationLoop();
    DELTA_LOGGER.log('[App] Initialized successfully');
  }

  _initChart() {
    if (!this.chartController) throw new Error('ChartController is not initialized');
    return this.chartController.init();
  }

  _setChartData(data, keepRange) {
    return this.chartController && this.chartController.setData(data, keepRange);
  }

  _loadCandles(sym, tf) {
    return this.chartController && this.chartController.load(sym, tf);
  }

  _loadOlder() {
    return this.chartController && this.chartController.loadOlder();
  }

  _feedTick(price) {
    return this.chartController && this.chartController.feedTick(price);
  }

  _initVisualization() {
    if (!this._tvChart || !this._tvCandle) return;

    // VWAP indicator
    try {
      this.vwap = new VwapIndicator(this._tvChart, {
        showBands: this.config.VIS && this.config.VIS.VWAP_BANDS,
      });
      const vwapBtn = this.$('vwapToggle');
      if (vwapBtn) {
        vwapBtn.addEventListener('click', () => {
          const on = vwapBtn.classList.toggle('on');
          this.vwap.toggle(on);
        });
      }
    } catch (e) { DELTA_LOGGER.warn('[App] VWAP init failed', e); }

    // Liquidation heatmap overlay
    try {
      const hmCanvas = this.$('heatmapCanvas');
      if (hmCanvas) {
        this.heatmap = new LiquidationHeatmap(
          this._tvChart, this._tvCandle, hmCanvas, this.config, this.state,
          window.simulationEngine || null
        );
        const hmBtn = this.$('heatmapToggle');
        if (hmBtn) {
          hmBtn.addEventListener('click', () => {
            const on = hmBtn.classList.toggle('on');
            this.heatmap.toggle(on);
          });
        }
      }
    } catch (e) { DELTA_LOGGER.warn('[App] Heatmap init failed', e); }
  }


