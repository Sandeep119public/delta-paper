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
    this.renderAll();
    this.startSimulationLoop();
    DELTA_LOGGER.log('[App] Initialized successfully');
  }

  _initChart() {
    const container = this.$('tv-chart-container');
    if (!container || typeof LightweightCharts === 'undefined') return;

    this._tvChart = LightweightCharts.createChart(container, {
      autoSize: true,
      layout: { background: { color: '#111827' }, textColor: '#94a3b8', fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
      grid: { vertLines: { color: 'rgba(36, 52, 72, 0.5)' }, horzLines: { color: 'rgba(36, 52, 72, 0.5)' } },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#243448', scaleMargins: { top: 0.1, bottom: 0.25 } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#243448' },
    });

    const opts = {
      upColor: '#10b981', downColor: '#ef4444', borderVisible: false,
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    };
    this._tvCandle = (typeof this._tvChart.addSeries === 'function')
      ? this._tvChart.addSeries(LightweightCharts.CandlestickSeries, opts)
      : this._tvChart.addCandlestickSeries(opts);

    this._tvVol = (typeof this._tvChart.addSeries === 'function')
      ? this._tvChart.addSeries(LightweightCharts.HistogramSeries, {
          priceFormat: { type: 'volume' }, priceScaleId: '',
          color: 'rgba(59,130,246,0.2)',
        })
      : this._tvChart.addHistogramSeries({
          priceFormat: { type: 'volume' }, priceScaleId: '',
        });
    if (this._tvVol.priceScale) this._tvVol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    this._loadCandles();

    this.market.subscribe(() => {
      const m = this.market.getMarket(this.selSym);
      if (m && m.price > 0) this._feedTick(m.price);
    });

    const tfBtns = document.querySelectorAll('.tf-row button');
    tfBtns.forEach(b => {
      b.addEventListener('click', () => {
        tfBtns.forEach(x => x.classList.remove('on'));
        b.classList.add('on');
        this._loadCandles(this.selSym, b.dataset.tf);
      });
    });

    this._tvChart.timeScale().subscribeVisibleLogicalRangeChange(async (range) => {
      if (range && range.from < 50 && !this._loadingOlder && this._historyCache.length) {
        this._loadingOlder = true;
        const first = this._historyCache[0].time;
        const end = first - 1;
        const start = end - this._tfSec * 500;
        const url = 'https://api.india.delta.exchange/v2/history/candles'
          + `?resolution=${this._tf}&symbol=${this.selSym}&start=${start}&end=${end}`;
        try {
          const json = await (await fetch(url)).json();
          if (json.success && Array.isArray(json.result) && json.result.length) {
            const older = json.result
              .map(c => ({ time: c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
              .sort((a, b) => a.time - b.time);
            this._historyCache = older.concat(this._historyCache);
            if (this._tvCandle) this._tvCandle.setData(this._historyCache);
          }
        } catch (e) { /* ignore */ }
        this._loadingOlder = false;
      }
    });
  }

  _loadCandles(sym, tf) {
    if (sym) this.selSym = sym;
    if (tf) this._tf = tf;
    this._tfSec = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }[this._tf] || 60;
    this._curCandle = null;
    this._historyCache = [];

    const end = Math.floor(Date.now() / 1000);
    const start = end - this._tfSec * 500;

    const url = 'https://api.india.delta.exchange/v2/history/candles'
      + `?resolution=${this._tf}&symbol=${this.selSym}&start=${start}&end=${end}`;

    fetch(url)
      .then(r => r.json())
      .then(json => {
        if (!json.success || !Array.isArray(json.result) || !json.result.length) return;
        const data = json.result
          .map(c => ({ time: c.time, open: +c.open, high: +c.high, low: +c.low, close: +c.close }))
          .sort((a, b) => a.time - b.time);
        this._historyCache = data;
        if (this._tvCandle) this._tvCandle.setData(data);
        this._curCandle = { ...data[data.length - 1] };
        if (this._tvChart) this._tvChart.timeScale().scrollToRealTime();
      })
      .catch(e => {
        DELTA_LOGGER.log('[Chart] candle load failed', e);
        setTimeout(() => this._loadCandles(this.selSym, this._tf), 5000);
      });
  }

  _feedTick(price) {
    if (!this._tvCandle || !(price > 0)) return;
    const bucket = Math.floor(Date.now() / 1000 / this._tfSec) * this._tfSec;
    const c = this._curCandle;

    if (!c || c.time !== bucket) {
      this._curCandle = { time: bucket, open: price, high: price, low: price, close: price };
    } else {
      c.high = Math.max(c.high, price);
      c.low = Math.min(c.low, price);
      c.close = price;
    }
    this._tvCandle.update(this._curCandle);

    if (this._tvVol) {
      const vol = c._vol = (c._vol || 0) + 1;
      this._tvVol.update({ time: bucket, value: vol, color: 'rgba(59,130,246,0.2)' });
    }

    this._updateTpSlLines(this.market.getMarket(this.selSym));
  }

  _updateTpSlLines(m) {
    if (!this._tvCandle) return;

    this._tvPriceLines.forEach(line => {
      try { this._tvCandle.removePriceLine(line); } catch (e) {}
    });
    this._tvPriceLines = [];

    const S = this.state.get();
    const pos = S.positions[this.selSym];
    if (!pos) return;

    if (pos.tp && pos.tp > 0) {
      const tpLine = this._tvCandle.createPriceLine({
        price: pos.tp,
        color: '#10b981',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'TP',
      });
      this._tvPriceLines.push(tpLine);
    }
    if (pos.sl && pos.sl > 0) {
      const slLine = this._tvCandle.createPriceLine({
        price: pos.sl,
        color: '#ef4444',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'SL',
      });
      this._tvPriceLines.push(slLine);
    }

    const entryLine = this._tvCandle.createPriceLine({
      price: pos.entry,
      color: pos.dir === 1 ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: true,
      title: 'Entry',
    });
    this._tvPriceLines.push(entryLine);
  }

  _clearTpSlLines() {
    if (!this._tvCandle) return;
    this._tvPriceLines.forEach(line => {
      try { this._tvCandle.removePriceLine(line); } catch (e) {}
    });
    this._tvPriceLines = [];
  }

  setupEventListeners() {
    this.$('buyBtn').addEventListener('click', () => this.placeOrder(1));
    this.$('sellBtn').addEventListener('click', () => this.placeOrder(-1));
    this.$('closeAllBtn').addEventListener('click', () => this.closeAll());

    this.$('qtyMinus').addEventListener('click', () => this.stepLots(-1));
    this.$('qtyPlus').addEventListener('click', () => this.stepLots(1));

    document.querySelectorAll('.qk button[data-q]').forEach(b => {
      b.addEventListener('click', () => {
        const q = b.dataset.q;
        if (q === 'max') this.setMaxLots();
        else this.setNotionalLots(parseFloat(q));
      });
    });

    this.$('qtyIn').addEventListener('input', () => {
      const v = parseInt(this.$('qtyIn').value, 10);
      if (isFinite(v) && v >= 1) {
        this.curLots = v;
        this.state.update({ lots: { ...this.state.get().lots, [this.selSym]: v } });
      }
    });

    this.$('qtyIn').addEventListener('blur', () => {
      this.$('qtyIn').value = this.curLots >= 1 ? this.curLots : '';
    });

    this.$('qtyLevRt').addEventListener('click', () => {
      this.renderMenu();
      this.openModal('menuOverlay');
    });

    this.$('menuBtn').addEventListener('click', () => {
      this.renderMenu();
      this.openModal('menuOverlay');
    });

    this.$('levRange').addEventListener('input', () => {
      const lev = parseInt(this.$('levRange').value, 10);
      this.state.update({ lev });
      this.$('levVal').textContent = lev + 'x';
    });

    this.$('mFunds').addEventListener('click', () => {
      this.closeModal('menuOverlay');
      this.renderFunds();
      this.openModal('fundsOverlay');
    });

    this.$('mHistory').addEventListener('click', () => {
      this.closeModal('menuOverlay');
      this.hisLen = -1;
      this.renderHistory();
      this.openModal('hisOverlay');
    });

    this.$('mAccount').addEventListener('click', () => {
      this.closeModal('menuOverlay');
      this.renderAcct();
      this.openModal('acctOverlay');
    });

    // Menu overlay duplicates (for desktop menu)
    if (this.$('mFundsMenu')) {
      this.$('mFundsMenu').addEventListener('click', () => {
        this.closeModal('menuOverlay');
        this.renderFunds();
        this.openModal('fundsOverlay');
      });
    }
    if (this.$('mHistoryMenu')) {
      this.$('mHistoryMenu').addEventListener('click', () => {
        this.closeModal('menuOverlay');
        this.hisLen = -1;
        this.renderHistory();
        this.openModal('hisOverlay');
      });
    }
    if (this.$('mAccountMenu')) {
      this.$('mAccountMenu').addEventListener('click', () => {
        this.closeModal('menuOverlay');
        this.renderAcct();
        this.openModal('acctOverlay');
      });
    }

    this.$('mInstall').addEventListener('click', async () => {
      if (window.deferredInstall) {
        window.deferredInstall.prompt();
        const choice = await window.deferredInstall.userChoice;
        window.deferredInstall = null;
        if (choice.outcome === 'accepted') {
          this.toast('Installed ✓', 'App added to home screen', 'ok');
        }
      } else {
        this.toast('Install', 'Chrome ⋮ → "Install app" / "Add to Home screen"', '');
      }
    });

    this.$('mReset').addEventListener('click', () => {
      this.closeModal('menuOverlay');
      this.resetAccount();
    });

    this.$('pdSave').addEventListener('click', () => this.saveTpSl());
    this.$('pdClear').addEventListener('click', () => this.clearTpSl());
    this.$('pdClose').addEventListener('click', () => {
      if (this.posDetailSym) {
        this.closePosition(this.posDetailSym);
        this.posDetailSym = null;
        this.closeModal('posOverlay');
      }
    });

    this.$('convHintBtn').addEventListener('click', () => {
      this.renderCvt();
      this.openModal('cvtOverlay');
    });

    this.$('openDep').addEventListener('click', () => this.openModal('depOverlay'));
    this.$('openWd').addEventListener('click', () => {
      this.renderFunds();
      this.openModal('wdOverlay');
    });

    this.$('openCvt').addEventListener('click', () => {
      this.renderCvt();
      this.openModal('cvtOverlay');
    });

    document.querySelectorAll('[data-close-m]').forEach(b => {
      b.addEventListener('click', () => this.closeModal(b.dataset.closeM));
    });

    document.querySelectorAll('.overlay').forEach(ov => {
      ov.addEventListener('click', (e) => {
        if (e.target === ov) {
          ov.classList.remove('show');
          if (ov.id === 'posOverlay') this.posDetailSym = null;
        }
      });
    });

    document.querySelectorAll('#depMethods label').forEach(l => {
      l.addEventListener('click', () => {
        document.querySelectorAll('#depMethods label').forEach(x => x.classList.remove('on'));
        l.classList.add('on');
      });
    });

    document.querySelectorAll('#depOverlay .q-row button').forEach(b => {
      b.addEventListener('click', () => {
        this.$('depAmt').value = b.dataset.d;
      });
    });

    this.$('depConfirm').addEventListener('click', () => this.doDeposit());
    this.$('wdMax').addEventListener('click', () => {
      this.$('wdAmt').value = Math.floor(this.state.get().inr || 0);
    });
    this.$('wdConfirm').addEventListener('click', () => this.doWithdraw());

    this.$('flipBtn').addEventListener('click', () => this.flipCvt());

    this.$('cvtMax').addEventListener('click', () => {
      this.$('cvtAmt').value = (this.cvtDir === 'i2u' ? this.state.get().inr : this.state.get().usd).toFixed(2);
      this.renderCvtPreview();
    });

    this.$('cvtAmt').addEventListener('input', () => this.renderCvtPreview());
    this.$('cvtConfirm').addEventListener('click', () => this.doConvert());

    this.$('aNameSave').addEventListener('click', () => {
      const v = this.$('aNameInput').value.trim();
      if (!v) return this.toast('Invalid name', 'Name cannot be empty', 'err');
      this.state.update({ name: v });
      this.renderAcct();
      this.toast('Saved', 'Display name updated', 'ok');
    });

    this.$('resetBtn2').addEventListener('click', () => this.resetAccount());

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.market.getDataSource() === 'live') {
        // WS reconnect is automatic; nothing else to do
      }
    });

    const eqBody = document.querySelector('.eq-body');
    if (eqBody) {
      new ResizeObserver(() => this.drawEquityCurve()).observe(eqBody);
    }
  }

  switchSymbol(sym) {
    if (this.selSym === sym) return;
    this.selSym = sym;
    this.curLots = this.getLots(sym);
    if (document.activeElement !== this.$('qtyIn')) this.$('qtyIn').value = this.curLots;
    this._clearTpSlLines();
    this.markDirty();
    this._loadCandles(sym);
  }

  adjustLeverage(delta) {
    const S = this.state.get();
    const newLev = Math.max(1, Math.min(this.config.MAX_LEVERAGE, S.lev + delta));
    this.state.update({ lev: newLev });
    this.renderMenu();
    this.markDirty();
  }

  executeTrade(side) { this.placeOrder(side); }

  closePosition(sym, price) {
    const pos = this.state.get().positions[sym];
    if (!pos) return;

    const m = this.market.getMarket(sym);
    if (!m) return;
    const fill = pos.dir === 1 ? m.price * 0.9997 : m.price * 1.0003;
    const fee = pos.qty * fill * this.config.TAKER_FEE;

    this.applyFill(sym, -pos.dir, fill, pos.qty, pos.lev, fee, pos.lots);
    const shortName = this.config.SYM_META[sym] ? this.config.SYM_META[sym].short : sym;
    this.toast('Closed', shortName + ' @ ' + this.fmtPrice(fill, m.dec), 'ok');
    this.flushSave(true);
    this.markDirty();
  }

  handleMenuAction(action) {
    switch (action) {
      case 'funds':
        this.closeModal('menuOverlay');
        this.renderFunds();
        this.openModal('fundsOverlay');
        break;
      case 'history':
        this.closeModal('menuOverlay');
        this.hisLen = -1;
        this.renderHistory();
        this.openModal('hisOverlay');
        break;
      case 'account':
        this.closeModal('menuOverlay');
        this.renderAcct();
        this.openModal('acctOverlay');
        break;
    }
  }

  lotOf(sym) {
    const m = this.market.getMarket(sym);
    return m ? m.lot : (this.config.LOT_SIZES[sym] || 0.001);
  }

  defaultLots(sym) {
    const m = this.market.getMarket(sym);
    if (m && m.price > 0) {
      return Math.max(1, Math.round(100 / (this.lotOf(sym) * m.price)));
    }
    return 1;
  }

  getLots(sym) {
    const S = this.state.get();
    if (S.lots[sym] && S.lots[sym] >= 1) return Math.round(S.lots[sym]);
    return this.defaultLots(sym);
  }

  setLots(l) {
    l = Math.max(1, Math.round(l));
    this.curLots = l;
    const S = this.state.get();
    const lots = { ...S.lots, [this.selSym]: l };
    this.state.update({ lots });
    if (document.activeElement !== this.$('qtyIn')) this.$('qtyIn').value = l;
    this.markDirty();
  }

  stepLots(d) { this.setLots(this.curLots + d); }

  setMaxLots() {
    const m = this.market.getMarket(this.selSym);
    if (!m || !(m.price > 0)) return;

    const S = this.state.get();
    if (!(S.usd > 0)) return this.toast('No margin', 'Convert INR → USD first', 'err');

    const lots = Math.floor((S.usd * 0.99 * S.lev) / (this.lotOf(this.selSym) * m.price));
    this.setLots(Math.max(1, lots));
  }

  setNotionalLots(usd) {
    const m = this.market.getMarket(this.selSym);
    if (!m || !(m.price > 0)) return;
    this.setLots(Math.max(1, Math.round(usd / (this.lotOf(this.selSym) * m.price))));
  }

  placeOrder(side) {
    const m = this.market.getMarket(this.selSym);
    if (!m) return;

    if (!(m.price > 0)) {
      return this.toast('No live price yet', 'Waiting for Delta India feed…', 'err');
    }

    const v = this.validator.validateLots(this.curLots, this.selSym);
    if (!v.isValid) return this.toast('Set quantity', v.error, 'err');
    const lots = v.value;

    const S = this.state.get();
    const lev = S.lev;
    const lot = this.lotOf(this.selSym);
    const qty = lots * lot;
    const fill = side === 1 ? m.price * 1.0003 : m.price * 0.9997;
    const notional = qty * fill;
    const margin = notional / lev;
    const fee = notional * this.config.TAKER_FEE;

    if (margin + fee > S.usd) {
      return this.toast('Insufficient USD', 'Need ' + this.fmtUsd(margin + fee) + ' $ — ☰ → Funds', 'err');
    }

    if (this.applyFill(this.selSym, side, fill, qty, lev, fee, lots)) {
      const shortName = this.config.SYM_META[this.selSym] ? this.config.SYM_META[this.selSym].short : this.selSym;
      this.toast(
        'Filled ✓',
        (side === 1 ? 'Long' : 'Short') + ' ' + lots + ' lot' + (lots > 1 ? 's' : '') +
        ' (' + this.fmtQty(qty) + ' ' + shortName + ') @ ' + this.fmtPrice(fill, m.dec),
        'ok'
      );
      this.flushSave(true);
      this.markDirty();
    }
  }

  applyFill(sym, side, price, qty, lev, fee, lots) {
    const S = this.state.get();
    let usd = S.usd;
    let feesTotal = S.feesTotal;

    usd -= fee;
    feesTotal += fee;

    const positions = { ...S.positions };
    const pos = positions[sym];

    if (!pos) {
      const margin = price * qty / lev;
      if (usd < margin) {
        usd += fee; feesTotal -= fee;
        this.toast('Rejected', 'Insufficient USD margin', 'err');
        return false;
      }
      usd -= margin;
      positions[sym] = { sym, dir: side, lots, qty, entry: price, margin, lev, tp: 0, sl: 0 };
      this.pushHist(sym, side === 1 ? 'Open Long' : 'Open Short', qty, price, -fee);
      this.state.update({ usd, feesTotal, positions });
      return true;
    }

    if (side === pos.dir) {
      const addM = price * qty / lev;
      if (usd < addM) {
        usd += fee; feesTotal -= fee;
        this.toast('Rejected', 'Insufficient USD margin', 'err');
        return false;
      }
      usd -= addM;
      const nq = pos.qty + qty;
      const entry = (pos.entry * pos.qty + price * qty) / nq;
      const newMargin = pos.margin + addM;
      const newLev = Math.max(1, (entry * nq) / newMargin);

      positions[sym] = {
        ...pos,
        qty: nq,
        entry,
        lots: pos.lots + lots,
        margin: newMargin,
        lev: newLev
      };
      this.pushHist(sym, side === 1 ? 'Add Long' : 'Add Short', qty, price, -fee);
      this.state.update({ usd, feesTotal, positions });
      return true;
    }

    const closeQty = Math.min(qty, pos.qty);
    const ratio = closeQty / pos.qty;
    const realized = (price - pos.entry) * closeQty * pos.dir;
    const mRel = pos.margin * ratio;

    usd += mRel + realized;

    const remainingQty = pos.qty - closeQty;
    const remainingMargin = pos.margin - mRel;
    const remainingLots = Math.max(0, pos.lots - Math.round(pos.lots * ratio));

    const net = realized - fee;
    this.recordClose(net);
    this.pushHist(sym, pos.dir === 1 ? 'Close Long' : 'Close Short', closeQty, price, net);

    let finalPositions = positions;
    if (remainingQty < 1e-9) {
      delete finalPositions[sym];
    } else {
      finalPositions[sym] = {
        ...pos,
        qty: remainingQty,
        margin: remainingMargin,
        lots: remainingLots
      };
    }

    const remaining = qty - closeQty;
    if (remaining > 1e-9) {
      const margin = price * remaining / lev;
      if (usd >= margin) {
        usd -= margin;
        finalPositions[sym] = {
          sym, dir: side,
          lots: Math.max(1, remainingLots),
          qty: remaining,
          entry: price,
          margin, lev,
          tp: 0, sl: 0
        };
        this.pushHist(sym, side === 1 ? 'Flip Long' : 'Flip Short', remaining, price, 0);
      }
    }

    this.state.update({ usd, feesTotal, positions: finalPositions });
    return true;
  }

  closeAll() {
    const S = this.state.get();
    const syms = Object.keys(S.positions);
    if (!syms.length) return this.toast('Nothing to close', 'No open positions', 'err');
    syms.slice().forEach(sym => this.closePosition(sym));
  }

  recordClose(net) {
    const S = this.state.get();
    let realized = S.realized, wins = S.wins, losses = S.losses;
    let best = S.best, worst = S.worst;
    realized += net;
    if (net > 0) wins++;
    else if (net < 0) losses++;
    best = Math.max(best, net);
    worst = Math.min(worst, net);
    this.state.update({ realized, wins, losses, best, worst });
  }

  pushHist(sym, label, qty, price, pnl) {
    const S = this.state.get();
    const history = S.history;
    history.unshift({ t: Date.now(), sym, label, qty, price, pnl });
    if (history.length > 100) history.length = 100;
    this.state.update({ history });
  }

  checkTPSL() {
    const S = this.state.get();
    for (const k in S.positions) {
      const pos = S.positions[k];
      const m = this.market.getMarket(k);
      if (!m || !(m.price > 0)) continue;

      if (pos.dir === 1) {
        if (pos.tp && m.price >= pos.tp) { this.closeAtTrigger(pos, 'TP hit', pos.tp); continue; }
        if (pos.sl && m.price <= pos.sl) { this.closeAtTrigger(pos, 'SL hit', pos.sl); }
      } else {
        if (pos.tp && m.price <= pos.tp) { this.closeAtTrigger(pos, 'TP hit', pos.tp); continue; }
        if (pos.sl && m.price >= pos.sl) { this.closeAtTrigger(pos, 'SL hit', pos.sl); }
      }
    }
  }

  checkLiquidations() {
    const S = this.state.get();
    const hits = [];
    for (const k in S.positions) {
      if (!this.market.getMarket(k)) continue;
      const pos = S.positions[k];
      const lp = this.liqPrice(pos);
      const p  = this.market.getMarket(k).price;
      if ((pos.dir === 1 && p <= lp) || (pos.dir === -1 && p >= lp)) hits.push(k);
    }
    if (!hits.length) return;

    // Batch updates
    let positions = { ...S.positions };
    let losses = S.losses;
    let worst = S.worst;
    let history = [...S.history];

    hits.forEach(k => {
      const pos = positions[k];
      delete positions[k];

      losses += 1;
      worst = Math.min(worst, -pos.margin);

      const shortName = this.config.SYM_META[k] ? this.config.SYM_META[k].short : k;
      history.unshift({ t: Date.now(), sym: k, label: '⚡ Liquidated', qty: pos.qty, price: this.liqPrice(pos), pnl: -pos.margin });
      if (history.length > 100) history.length = 100;

      this.toast('LIQUIDATED', '⚡ ' + shortName + ' — ' + this.fmtUsd(pos.margin) + ' USD lost', 'err');
    });

    // Single state update for all liquidations in this tick
    this.state.update({ positions, losses, worst, history });
    this.flushSave(true);

    if (this.posDetailSym && !S.positions[this.posDetailSym]) {
      this.posDetailSym = null;
      this.closeModal('posOverlay');
    }
  }

  liqPrice(pos) {
    const mm = 0.005;
    return pos.dir === 1
      ? pos.entry * (1 - 1 / pos.lev + mm)
      : pos.entry * (1 + 1 / pos.lev - mm);
  }

  closeAtTrigger(pos, label, price) {
    const m = this.market.getMarket(pos.sym);
    const fee = pos.qty * price * this.config.TAKER_FEE;
    this.applyFill(pos.sym, -pos.dir, price, pos.qty, pos.lev, fee, pos.lots);

    const S = this.state.get();
    if (S.history.length) {
      const history = [...S.history];
      history[0].label = label;
      this.state.update({ history });
    }

    const shortName = this.config.SYM_META[pos.sym] ? this.config.SYM_META[pos.sym].short : pos.sym;
    this.toast(label, shortName + ' closed @ ' + this.fmtPrice(price, m.dec),
      label === 'TP hit' ? 'ok' : 'err');
    this.flushSave(true);
  }

  openPosDetail(sym) {
    const S = this.state.get();
    if (!S.positions[sym]) return;

    this.posDetailSym = sym;
    const pos = S.positions[sym];
    const m = this.market.getMarket(sym);

    const t = this.$('pdTitle');
    // Safely construct the title
    t.innerHTML = '';
    const sideTag = document.createElement('span');
    sideTag.className = 'side-tag ' + (pos.dir === 1 ? 'long' : 'short');
    sideTag.textContent = (pos.dir === 1 ? 'LONG' : 'SHORT') + ' ' + pos.lev + 'x';
    const symText = document.createTextNode(' ' + m.short);
    t.appendChild(sideTag);
    t.appendChild(symText);

    this.$('pdEntry').textContent = this.fmtPrice(pos.entry, m.dec);
    this.$('pdQty').textContent  = pos.lots + ' lot' + (pos.lots > 1 ? 's' : '') + ' • ' + this.fmtQty(pos.qty);
    this.$('pdMargin').textContent = this.fmtUsd(pos.margin) + ' $';
    this.$('pdLiq').textContent    = this.fmtPrice(this.liqPrice(pos), m.dec);

    this.$('pdTpIn').value = pos.tp ? pos.tp : '';
    this.$('pdSlIn').value = pos.sl ? pos.sl : '';

    this.renderPosDetailLive();
    this.openModal('posOverlay');
  }

  renderPosDetailLive() {
    if (!this.posDetailSym || !this.$('posOverlay').classList.contains('show')) return;

    const S = this.state.get();
    const pos = S.positions[this.posDetailSym];
    if (!pos) {
      this.posDetailSym = null;
      this.closeModal('posOverlay');
      return;
    }

    const m = this.market.getMarket(this.posDetailSym);
    const up = (m.price - pos.entry) * pos.qty * pos.dir;

    this.$('pdMark').textContent = m.price > 0 ? this.fmtPrice(m.price, m.dec) : '…';
    this.$('pdUpnl').textContent = this.fmtSign(up) + ' $';
    this.$('pdUpnl').className = up >= 0 ? 'pos' : 'neg';
  }

  saveTpSl() {
    const S = this.state.get();
    const pos = S.positions[this.posDetailSym];
    if (!pos) return;

    const m = this.market.getMarket(this.posDetailSym);
    const tpRaw = parseFloat(this.$('pdTpIn').value);
    const slRaw = parseFloat(this.$('pdSlIn').value);
    const hasTp = isFinite(tpRaw) && tpRaw > 0;
    const hasSl = isFinite(slRaw) && slRaw > 0;
    const mark  = m.price;

    if (!(mark > 0)) return this.toast('No live price', 'Waiting for feed…', 'err');

    if (hasTp) {
      if ((pos.dir === 1 && tpRaw <= mark) || (pos.dir === -1 && tpRaw >= mark)) {
        return this.toast('Invalid TP', 'Long TP must be above mark (' + this.fmtPxShort(mark) + ')', 'err');
      }
    }
    if (hasSl) {
      if ((pos.dir === 1 && slRaw >= mark) || (pos.dir === -1 && slRaw <= mark)) {
        return this.toast('Invalid SL', 'Long SL must be below mark (' + this.fmtPxShort(mark) + ')', 'err');
      }
    }
    if (hasTp && hasSl && tpRaw === slRaw) {
      return this.toast('Invalid TP/SL', 'TP and SL cannot be equal', 'err');
    }

    const positions = { ...S.positions };
    positions[this.posDetailSym] = {
      ...pos,
      tp: hasTp ? tpRaw : 0,
      sl: hasSl ? slRaw : 0
    };

    this.state.update({ positions });
    this.flushSave(true);

    const txt = (pos.tp ? 'TP ' + this.fmtPxShort(pos.tp) : '') +
      (pos.tp && pos.sl ? ' • ' : '') +
      (pos.sl ? 'SL ' + this.fmtPxShort(pos.sl) : '');

    this.toast('Saved ✓', txt || 'TP/SL cleared', 'ok');
    this.markDirty();
  }

  clearTpSl() {
    const S = this.state.get();
    const pos = S.positions[this.posDetailSym];
    if (!pos) return;

    const positions = { ...S.positions };
    positions[this.posDetailSym] = { ...pos, tp: 0, sl: 0 };
    this.state.update({ positions });
    this.$('pdTpIn').value = '';
    this.$('pdSlIn').value = '';
    this.flushSave(true);
    this.toast('Cleared', 'TP/SL removed', '');
    this.markDirty();
  }

  doDeposit() {
    const v = this.validator.validateDeposit(this.$('depAmt').value);
    if (!v.isValid) return this.toast('Invalid amount', v.error, 'err');

    const amt = v.value;
    const method = document.querySelector('#depMethods label.on').dataset.m;
    const S = this.state.get();

    this.state.update({ inr: S.inr + amt });
    this.ledgerPush('Deposit', method, amt, 0);
    this.sampleEq();
    this.flushSave(true);
    this.renderFunds();
    this.markDirty();

    this.toast('Deposit ✓', this.fmtInr(amt) + ' credited via ' + method, 'ok');
    this.closeModal('depOverlay');
    this.$('depAmt').value = '';
  }

  doWithdraw() {
    const S = this.state.get();
    const v = this.validator.validateWithdrawal(this.$('wdAmt').value, S.inr);
    if (!v.isValid) return this.toast('Invalid amount', v.error, 'err');

    const amt = v.value;

    this.state.update({ inr: S.inr - amt });
    this.ledgerPush('Withdraw', 'HDFC ••1234', -amt, 0);
    this.sampleEq();
    this.flushSave(true);
    this.renderFunds();
    this.markDirty();

    this.toast('Withdrawal ✓', this.fmtInr(amt) + ' sent to HDFC ••1234', 'ok');
    this.closeModal('wdOverlay');
    this.$('wdAmt').value = '';
  }

  flipCvt() {
    this.cvtDir = this.cvtDir === 'i2u' ? 'u2i' : 'i2u';
    this.$('cvtAmt').value = '';
    this.renderCvt();
  }

  renderCvt() {
    const i2u = this.cvtDir === 'i2u';
    const S = this.state.get();

    this.$('cvtFromL').textContent = i2u ? '₹ INR' : 'USD';
    this.$('cvtToL').textContent   = i2u ? 'USD' : '₹ INR';
    this.$('cvtCur').textContent   = i2u ? 'INR' : 'USD';
    this.$('cvtAvail').textContent = i2u ? this.fmtInr(S.inr) : this.fmtUsd(S.usd) + ' USD';

    this.renderCvtPreview();
  }

  renderCvtPreview() {
    const amt  = parseFloat(this.$('cvtAmt').value) || 0;
    const rate = this.state.rate || this.config.BASE_RATE;
    const i2u  = this.cvtDir === 'i2u';

    this.$('cvtRate').textContent = '1 USD = ₹' + rate.toFixed(2);

    let recv = 0, fee = 0;
    if (amt > 0) {
      if (i2u) {
        fee = amt * this.config.CONVERT_FEE;
        recv = (amt - fee) / rate;
      } else {
        fee = amt * this.config.CONVERT_FEE;
        recv = amt * rate * (1 - this.config.CONVERT_FEE);
      }
    }

    this.$('cvtFee').textContent = i2u ? this.fmtInr(fee) : this.fmtUsd(fee) + ' USD';
    this.$('cvtRecv').textContent = recv > 0
      ? (i2u ? this.fmtUsd(recv) + ' USD' : this.fmtInr(recv))
      : '—';
  }

  doConvert() {
    const rate = this.state.rate || this.config.BASE_RATE;
    const S = this.state.get();
    const fromCurrency = this.cvtDir === 'i2u' ? 'INR' : 'USD';
    const available = this.cvtDir === 'i2u' ? S.inr : S.usd;
    const v = this.validator.validateConversion(this.$('cvtAmt').value, available, fromCurrency);
    if (!v.isValid) return this.toast('Invalid amount', v.error, 'err');

    const amt = v.value;

    if (this.cvtDir === 'i2u') {
      if (amt > S.inr) return this.toast('Insufficient INR', 'Available: ' + this.fmtInr(S.inr), 'err');
      const recv = (amt - amt * this.config.CONVERT_FEE) / rate;
      this.state.update({ inr: S.inr - amt, usd: S.usd + recv });
      this.ledgerPush('Convert', 'INR→USD', -amt, recv);
      this.toast('Converted ✓', this.fmtInr(amt) + ' → ' + this.fmtUsd(recv) + ' USD', 'ok');
    } else {
      if (amt > S.usd) return this.toast('Insufficient USD', 'Available: ' + this.fmtUsd(S.usd) + ' USD', 'err');
      const recv = amt * rate * (1 - this.config.CONVERT_FEE);
      this.state.update({ usd: S.usd - amt, inr: S.inr + recv });
      this.ledgerPush('Convert', 'USD→INR', recv, -amt);
      this.toast('Converted ✓', this.fmtUsd(amt) + ' USD → ' + this.fmtInr(recv), 'ok');
    }

    this.sampleEq();
    this.flushSave(true);
    this.renderCvt();
    this.markDirty();
    this.closeModal('cvtOverlay');
  }

  ledgerPush(type, detail, dInr, dUsd) {
    const S = this.state.get();
    const ledger = S.ledger;
    ledger.unshift({ t: Date.now(), type, detail, dInr, dUsd });
    if (ledger.length > 200) ledger.length = 200;
    this.state.update({ ledger });
  }

  resetAccount() {
    if (!confirm('Reset account? Everything will be wiped.')) return;
    this.state.reset();
    this.hisLen = -1;
    this.flushSave(true);
    this.renderAcct();
    this.markDirty();
    this.toast('Reset ✓', 'Balance: ' + this.fmtInr(this.config.START_INR), 'ok');
  }

  sampleEq() {
    const S = this.state.get();
    const rate = this.state.rate || this.config.BASE_RATE;
    const eqInr = (S.inr || 0) + (this.totals().equity || 0) * rate;
    const equityCurve = S.equityCurve;
    equityCurve.push({ t: Date.now(), e: eqInr });
    if (equityCurve.length > 200) equityCurve.shift();
    this.state.update({ equityCurve });
  }

  totals() {
    const S = this.state.get();
    let equity = 0;
    for (const k in S.positions) {
      const m = this.market.getMarket(k);
      if (m && m.price > 0) {
        const pos = S.positions[k];
        equity += (m.price - pos.entry) * pos.qty * pos.dir;
      }
    }
    return { equity };
  }

  lockedUsd() {
    const S = this.state.get();
    let locked = 0;
    for (const k in S.positions) locked += S.positions[k].margin;
    return locked;
  }

  _fmtCommas(n) {
    const s = Math.abs(n).toFixed(2);
    const [int, dec] = s.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + grouped + '.' + dec;
  }

  _fmtCommas0(n) {
    const s = Math.abs(Math.round(n)).toString();
    const grouped = s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + grouped;
  }

  _fmtCommasDec(n, d) {
    const s = Math.abs(n).toFixed(d);
    const [int, dec] = s.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-' : '') + grouped + '.' + dec;
  }

  fmtUsd(x)    { return this._fmtCommas(x); }
  fmtUsd0(x)   { return this._fmtCommas0(x); }
  fmtSign(x)   { return (x >= 0 ? '+' : '') + this._fmtCommas(x); }
  fmtInr(x)    { return '₹' + this._fmtCommas0(x); }
  fmtInrS(x)   { return (x >= 0 ? '+' : '-') + '₹' + this._fmtCommas0(Math.abs(x)); }
  fmtPrice(p, d){ return this._fmtCommasDec(p, d); }
  fmtPxShort(p){ if (p >= 1000) return (p/1000).toFixed(2)+'k'; if (p >= 1) return p.toFixed(2); return p.toFixed(4); }
  fmtQty(q)    { let s = q.toFixed(6); return s.replace(/0+$/, '').replace(/\.$/, ''); }
  fmtLot(lot)  { let s = lot.toFixed(6); return s.replace(/0+$/, '').replace(/\.$/, ''); }

  toast(title, msg, type) {
    const container = this.$('toasts');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'toast' + (type ? ' ' + type : '');
    const titleEl = document.createElement('b');
    titleEl.textContent = title;
    const msgEl = document.createElement('small');
    msgEl.textContent = msg;
    div.appendChild(titleEl);
    div.appendChild(document.createElement('br'));
    div.appendChild(msgEl);
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  openModal(id)  { if (this.$(id)) this.$(id).classList.add('show'); }
  closeModal(id) { if (this.$(id)) this.$(id).classList.remove('show'); if (id === 'posOverlay') this.posDetailSym = null; }

  markDirty() {
    if (this._isRendering) return;
    this._isRendering = true;
    requestAnimationFrame(() => {
      this._isRendering = false;
      this.renderAll();
    });
  }
  flushSave(force) { this.state.flushSave(); }

  startSimulationLoop() {
    setInterval(() => {
      this.checkTPSL();
      this.checkLiquidations();
      this.markDirty();
    }, 1000);
  }

  renderAll() {
    this.renderStatus();
    this.renderHeader();
    this.renderMarkets();
    this.renderQty();
    this.renderEntry();
    this.renderPositions();

    if (this.posDetailSym && this.$('posOverlay') && this.$('posOverlay').classList.contains('show')) {
      this.renderPosDetailLive();
    }
    if (this.$('hisOverlay') && this.$('hisOverlay').classList.contains('show')) {
      this.renderHistory();
    }
    if (this.$('fundsOverlay') && this.$('fundsOverlay').classList.contains('show')) {
      this.renderFunds();
    }
    if (this.$('menuOverlay') && this.$('menuOverlay').classList.contains('show')) {
      this.renderMenu();
    }
    if (this.$('eqCanvas') && this.$('eqCanvas').closest('.show')) {
      this.drawEquityCurve();
    }
    if (this.$('cvtOverlay') && this.$('cvtOverlay').classList.contains('show')) {
      this.renderCvtPreview();
    }
  }

  /** NEW: drive the header chip ("SYNC…"/"LIVE"/"REST"/"SIM") and the
   *  market-panel feed badge from live market-data state. Inline colors
   *  are applied so it works regardless of styles.css coverage. */
  renderStatus() {
    const stats = (typeof this.market.getStats === 'function') ? this.market.getStats() : {};
    const src   = stats.source || 'boot';
    const live  = stats.anyGotLive === true || src === 'live';

    let label, cls, color;
    if (live)                 { label = 'LIVE';   cls = 'live'; color = '#22c55e'; }
    else if (src === 'rest')  { label = 'REST';   cls = 'rest'; color = '#f59e0b'; }
    else if (src === 'sim')   { label = 'SIM';    cls = 'sim';  color = '#a78bfa'; }
    else                      { label = 'SYNC…';  cls = 'boot'; color = '#94a3b8'; }

    const apply = (dotId, textId) => {
      const d = this.$(dotId);
      const t = this.$(textId);
      if (d) {
        d.className = 'feed-dot ' + cls;
        d.style.background = color;
        d.style.boxShadow  = '0 0 6px ' + color;
      }
      if (t) t.textContent = label;
    };

    apply('chipDot', 'chipText');
    apply('feedDot',     'feedText');
  }

  renderHeader() {
    const S = this.state.get();
    const t = this.totals();
    const rate = this.state.rate || this.config.BASE_RATE;
    const eqInr = (S.inr || 0) + (t.equity || 0) * rate;
    this.$('hEquity').textContent = this.fmtInr(eqInr);
    this.$('hBalSub').textContent = 'Free ' + this.fmtUsd(S.usd || 0) + ' $';
  }

  renderMarkets() {
    const wrap = this.$('symRow');
    if (wrap.childElementCount !== this.config.SYMBOLS.length) {
      wrap.innerHTML = '';
      this.config.SYMBOLS.forEach(sym => {
        const b = document.createElement('button');
        b.className = 'sym-btn';
        b.dataset.sym = sym;
        b.innerHTML = '<span class="sym-name">' + this.config.SYM_META[sym].short + '</span><span class="price mono">…</span>';
        b.addEventListener('click', () => this.switchSymbol(sym));
        wrap.appendChild(b);
      });
    }

    const buttons = wrap.querySelectorAll('.sym-btn');
    buttons.forEach(b => {
      const sym = b.dataset.sym;
      if (sym === this.selSym) { if (!b.classList.contains('on')) b.classList.add('on'); }
      else if (b.classList.contains('on')) { b.classList.remove('on'); }
    });

    const m = this.market.getMarket(this.selSym);
    if (!m) return;

    this.$('mktTitle').textContent = m.symbol + ' • PERP';
    if (this.$('chartTitle')) this.$('chartTitle').textContent = m.symbol + ' • 1m';
    this.$('lotLabel').textContent = '1 lot = ' + this.fmtLot(m.lot) + ' ' + this.config.SYM_META[this.selSym].short;

    const priceEl = this.$('psPrice');
    const oldPrice = this._prevPrice[this.selSym] || 0;
    priceEl.textContent = m.price > 0 ? this.fmtPrice(m.price, m.dec) : '…';
    priceEl.className = 'ps-price mono ' + (m.price >= (m.prevPrice || m.price) ? 'pos' : 'neg');

    if (oldPrice > 0 && m.price > 0 && m.price !== oldPrice) {
      priceEl.classList.remove('price-flash-up', 'price-flash-down');
      void priceEl.offsetWidth;
      priceEl.classList.add(m.price > oldPrice ? 'price-flash-up' : 'price-flash-down');
    }
    this._prevPrice[this.selSym] = m.price;

    const chg = this.chgOf(m);
    this.$('psChg').textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    this.$('psChg').className = 'ps-chg mono ' + (chg >= 0 ? 'up' : 'dn');

    this.$('psFund').textContent = m.funding
      ? 'Fund ' + (m.funding >= 0 ? '+' : '') + (m.funding * 100).toFixed(4) + '%'
      : '';

    this.config.SYMBOLS.forEach(sym => {
      const mkt = this.market.getMarket(sym);
      if (!mkt) return;
      const btn = wrap.querySelector('[data-sym="' + sym + '"]');
      if (btn) {
        const priceEl = btn.querySelector('.price');
        if (priceEl) {
          priceEl.textContent = mkt.price > 0 ? this.fmtPrice(mkt.price, mkt.dec) : '…';
          const c = this.chgOf(mkt);
          priceEl.className = 'price mono ' + (c >= 0 ? 'pos' : 'neg');
        }
      }
    });
  }

  chgOf(m) {
    if (m.chg24 != null && isFinite(m.chg24)) return m.chg24;
    if (m.open24 > 0 && m.price > 0) return (m.price - m.open24) / m.open24 * 100;
    return 0;
  }

  renderQty() {
    const S = this.state.get();
    this.$('qtyLevRt').textContent = S.lev + 'x ⚙';

    if (document.activeElement !== this.$('qtyIn')) {
      this.$('qtyIn').value = this.curLots >= 1 ? this.curLots : '';
    }

    const m = this.market.getMarket(this.selSym);
    if (!m || !(m.price > 0) || !(this.curLots >= 1)) {
      this.$('qtyInfo').textContent = '—';
      return;
    }

    const lot = this.lotOf(this.selSym);
    const qty = this.curLots * lot;
    const notional = qty * m.price;
    const margin = notional / S.lev;

    this.$('qtyInfo').textContent = this.curLots + ' lot' + (this.curLots > 1 ? 's' : '') +
      ' = ' + this.fmtQty(qty) + ' ' + this.config.SYM_META[this.selSym].short +
      ' ≈ $' + this.fmtUsd0(notional) + ' • margin $' + this.fmtUsd(margin);
  }

  renderEntry() {
    const S = this.state.get();
    const sub = (this.curLots >= 1) ? (this.curLots + ' lot' + (this.curLots > 1 ? 's' : '') + ' • ' + S.lev + 'x') : '—';
    this.$('buySub').textContent = sub;
    this.$('sellSub').textContent = sub;
    this.$('convHint').style.display = (S.usd < 5 && S.inr >= 1) ? 'flex' : 'none';
  }

  renderPositions() {
    const S = this.state.get();
    const keys = Object.keys(S.positions);

    this.$('cntPos').textContent = String(keys.length);
    this.$('posEmpty').style.display = keys.length ? 'none' : 'block';

    const list = this.$('posList');
    if (keys.length === 0) {
      if (this._posKeyStr) {
        list.replaceChildren();
        this._posCards = {};
        this._posKeyStr = '';
      }
      return;
    }

    const keyStr = keys.join(',');
    const structureChanged = keyStr !== this._posKeyStr;

    if (structureChanged) {
      list.replaceChildren();
      this._posCards = {};
      const fragment = document.createDocumentFragment();
      keys.forEach(k => {
        const pos = S.positions[k];
        const m = this.market.getMarket(k);
        const shortName = this.config.SYM_META[k] ? this.config.SYM_META[k].short : k;

        const card = document.createElement('div');
        card.className = 'pos-card ' + (pos.dir === 1 ? 'long' : 'short');
        card.dataset.sym = k;

        const row1 = document.createElement('div');
        row1.className = 'pc-row1';

        const sideTag = document.createElement('span');
        sideTag.className = 'side-tag ' + (pos.dir === 1 ? 'long' : 'short');
        sideTag.textContent = (pos.dir === 1 ? 'LONG' : 'SHORT') + ' ' + pos.lev + 'x';

        const symEl = document.createElement('span');
        symEl.className = 'pc-sym';
        symEl.textContent = shortName;

        const qtyEl = document.createElement('span');
        qtyEl.className = 'pc-qty';
        qtyEl.textContent = pos.lots + ' lot' + (pos.lots > 1 ? 's' : '') + ' • ' + this.fmtQty(pos.qty);

        const upnlEl = document.createElement('span');
        upnlEl.className = 'pc-upnl';
        upnlEl.textContent = '—';

        row1.append(sideTag, symEl, qtyEl, upnlEl);

        const row2 = document.createElement('div');
        row2.className = 'pc-row2';

        const inEl = document.createElement('span');
        inEl.dataset.in = '';
        inEl.textContent = 'In ' + this.fmtPxShort(pos.entry);

        const mkEl = document.createElement('span');
        mkEl.dataset.mk = '';
        mkEl.textContent = 'Mk —';

        const tpSlEl = document.createElement('span');
        tpSlEl.className = 'pc-tpsl';
        const tpSlTxt = (pos.tp || pos.sl)
          ? ((pos.tp ? 'TP ' + this.fmtPxShort(pos.tp) : '') +
             (pos.tp && pos.sl ? ' • ' : '') +
             (pos.sl ? 'SL ' + this.fmtPxShort(pos.sl) : ''))
          : '';
        tpSlEl.textContent = tpSlTxt;

        const arrowEl = document.createElement('span');
        arrowEl.className = 'pc-arrow';
        arrowEl.textContent = '›';

        row2.append(inEl, mkEl, tpSlEl, arrowEl);
        card.append(row1, row2);
        card.addEventListener('click', () => this.openPosDetail(k));
        this._posCards[k] = { card, upnlEl, mkEl };
        fragment.appendChild(card);
      });
      list.appendChild(fragment);
      this._posKeyStr = keyStr;
    }

    keys.forEach(k => {
      const pos = S.positions[k];
      const m = this.market.getMarket(k);
      if (!m) return;
      const up = (m.price - pos.entry) * pos.qty * pos.dir;
      const roe = up / pos.margin * 100;
      const refs = this._posCards[k];
      if (!refs) return;
      refs.mkEl.textContent = 'Mk ' + (m.price > 0 ? this.fmtPxShort(m.price) : '…');
      refs.upnlEl.textContent = this.fmtSign(up) + ' (' + (roe >= 0 ? '+' : '') + roe.toFixed(1) + '%)';
      refs.upnlEl.className = 'pc-upnl mono ' + (up >= 0 ? 'pos' : 'neg');
    });
  }

  renderHistory() {
    const S = this.state.get();
    this.$('mHisCnt').textContent = String(S.history.length);

    if (!this.$('hisOverlay').classList.contains('show')) return;

    this.$('hisEmpty').style.display = S.history.length ? 'none' : 'block';

    if (S.history.length === this.hisLen) return;
    this.hisLen = S.history.length;

    const tbody = this.$('hisBody');
    const fragment = document.createDocumentFragment();

    S.history.forEach(h => {
      const tr = document.createElement('tr');

      const tdTime = document.createElement('td');
      tdTime.textContent = new Date(h.t).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });

      const tdSym = document.createElement('td');
      tdSym.className = 'sym-c';
      tdSym.textContent = (this.config.SYM_META[h.sym] || { short: h.sym }).short;

      const tdLabel = document.createElement('td');
      tdLabel.textContent = h.label;

      const tdPrice = document.createElement('td');
      tdPrice.textContent = this.fmtPrice(h.price, 2);

      const tdPnl = document.createElement('td');
      tdPnl.className = h.pnl > 0 ? 'pos' : (h.pnl < 0 ? 'neg' : '');
      tdPnl.textContent = h.pnl ? this.fmtSign(h.pnl) : '—';

      tr.append(tdTime, tdSym, tdLabel, tdPrice, tdPnl);
      fragment.appendChild(tr);
    });

    tbody.replaceChildren(fragment);
  }

  renderFunds() {
    const S = this.state.get();
    const rate = this.state.rate || this.config.BASE_RATE;

    // Always update sidebar wallet display
    const updateEl = (id, val) => { const el = this.$(id); if (el) el.textContent = val; };
    updateEl('fwInr', this.fmtInr(S.inr));
    updateEl('fwUsd', this.fmtUsd(S.usd) + ' USD');
    updateEl('fwUsdSub', '≈ ' + this.fmtInr(S.usd * rate) + ' • Locked ' + this.fmtUsd(this.lockedUsd()));
    updateEl('fwInr2', this.fmtInr(S.inr));
    updateEl('fwUsd2', this.fmtUsd(S.usd) + ' USD');
    updateEl('fwUsdSub2', '≈ ' + this.fmtInr(S.usd * rate) + ' • Locked ' + this.fmtUsd(this.lockedUsd()));

    if (!this.$('fundsOverlay').classList.contains('show')) return;

    this.$('fRate').textContent = '₹' + rate.toFixed(2);
    this.$('wdAvail').textContent = this.fmtInr(S.inr);

    const sig = S.ledger.length + ':' + (S.ledger[0] ? S.ledger[0].t : '');
    if (this.$('ledgerBody')._sig === sig) return;
    this.$('ledgerBody')._sig = sig;

    this.$('ledgerEmpty').style.display = S.ledger.length ? 'none' : 'block';

    const tbody = this.$('ledgerBody');
    const fragment = document.createDocumentFragment();

    S.ledger.forEach(l => {
      const tr = document.createElement('tr');

      const tdTime = document.createElement('td');
      tdTime.textContent = new Date(l.t).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });

      const tdType = document.createElement('td');
      tdType.className = 'sym-c';
      tdType.textContent = l.type;

      const tdInr = document.createElement('td');
      tdInr.className = l.dInr ? (l.dInr > 0 ? 'pos' : 'neg') : '';
      tdInr.textContent = l.dInr ? this.fmtInrS(l.dInr) : '—';

      const tdUsd = document.createElement('td');
      tdUsd.className = l.dUsd ? (l.dUsd > 0 ? 'pos' : 'neg') : '';
      tdUsd.textContent = l.dUsd ? this.fmtSign(l.dUsd) : '—';

      tr.append(tdTime, tdType, tdInr, tdUsd);
      fragment.appendChild(tr);
    });

    tbody.replaceChildren(fragment);
  }

  renderMenu() {
    const S = this.state.get();
    if (!this.$('menuOverlay').classList.contains('show')) return;

    const range = this.$('levRange') || this.$('levRange2');
    if (range && document.activeElement !== range) {
      range.value = S.lev;
    }
    this.$('levVal').textContent = S.lev + 'x';
  }

  renderAcct() {
    const S = this.state.get();

    this.$('aAvatar').textContent = (S.name || 'T').trim().charAt(0).toUpperCase() || 'T';
    this.$('aNameInput').value = S.name;
    this.$('aUid').textContent = S.uid;
    this.$('aSince').textContent = new Date(S.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

    const closed = S.wins + S.losses;
    this.$('stTrades').textContent = String(closed);
    this.$('stWin').textContent = closed ? ((S.wins / closed) * 100).toFixed(1) + '%' : '—';

    const re = this.$('stReal');
    re.textContent = this.fmtSign(S.realized) + ' $';
    re.className = 'sv ' + (S.realized >= 0 ? 'pos' : 'neg');

    this.$('stFees').textContent = this.fmtUsd(S.feesTotal) + ' $';
    this.$('stBest').textContent = S.best > 0 ? this.fmtSign(S.best) + ' $' : '—';
    this.$('stWorst').textContent = S.worst < 0 ? this.fmtSign(S.worst) + ' $' : '—';

    this.drawEquityCurve();
  }

  drawEquityCurve(targetCanvas) {
    const ids = targetCanvas ? [targetCanvas] : ['eqCanvas', 'eqCanvas2'];
    ids.forEach(id => this._drawCurveOn(this.$(id)));
  }

  _drawCurveOn(cv) {
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const S = this.state.get();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = cv.clientWidth, H = cv.clientHeight;
    if (W === 0 || H === 0) return;

    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const pts = S.equityCurve;
    if (pts.length < 2) {
      ctx.fillStyle = '#5a6a80';
      ctx.font = '11px Inter';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Equity curve appears as you trade', W / 2, H / 2);
      return;
    }

    let mn = Infinity, mx = -Infinity;
    pts.forEach(p => { mn = Math.min(mn, p.e); mx = Math.max(mx, p.e); });
    if (mx === mn) { mx += 1; mn -= 1; }
    const padV = (mx - mn) * 0.08;
    mn -= padV; mx += padV;

    const x = i => i / (pts.length - 1) * W;
    const y = v => H - (v - mn) / (mx - mn) * H;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(59,130,246,.30)');
    grad.addColorStop(1, 'rgba(59,130,246,0)');

    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].e));
    pts.forEach((p, i) => ctx.lineTo(x(i), y(p.e)));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(x(0), y(pts[0].e));
    pts.forEach((p, i) => ctx.lineTo(x(i), y(p.e)));
    ctx.strokeStyle = '#4f8cff';
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
}

