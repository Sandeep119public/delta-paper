/**
 * Delta Paper Trading - Main Application Module
 * Core application logic, UI rendering, and event handling
 */

class DeltaPaperApp {
  constructor(config, state, validator, market) {
    this.config = config;
    this.state = state;
    this.validator = validator;
    this.market = market;
    
    // DOM element cache
    this.$ = (id) => document.getElementById(id);
    
    // State references
    this.selSym = 'BTCUSD';
    this.curLots = 1;
    this.posDetailSym = null;
    this.cvtDir = 'i2u';
    this.hisLen = -1;
    
    // Bind methods
    this.init = this.init.bind(this);
    this.renderAll = this.renderAll.bind(this);
    this.switchSymbol = this.switchSymbol.bind(this);
    this.adjustLeverage = this.adjustLeverage.bind(this);
    this.executeTrade = this.executeTrade.bind(this);
    this.closePosition = this.closePosition.bind(this);
    this.handleMenuAction = this.handleMenuAction.bind(this);
  }

  /**
   * Initialize the application
   */
  async init() {
    DELTA_LOGGER.log('[App] Initializing...');
    
    // Subscribe to market data updates
    this.market.subscribe(() => this.markDirty());
    
    // Setup event listeners
    this.setupEventListeners();
    
    // Initial render
    this.curLots = this.getLots(this.selSym);
    if (this.state.get().equityCurve.length === 0) {
      this.sampleEq();
    }
    
    this.renderAll();
    
    // Start simulation loop
    this.startSimulationLoop();
    
    DELTA_LOGGER.log('[App] Initialized successfully');
  }

  /**
   * Setup all event listeners
   */
  setupEventListeners() {
    // Trade buttons
    this.$('buyBtn').addEventListener('click', () => this.placeOrder(1));
    this.$('sellBtn').addEventListener('click', () => this.placeOrder(-1));
    this.$('closeAllBtn').addEventListener('click', () => this.closeAll());

    // Quantity controls
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

    // Menu
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

    // Position detail
    this.$('pdSave').addEventListener('click', () => this.saveTpSl());
    this.$('pdClear').addEventListener('click', () => this.clearTpSl());
    this.$('pdClose').addEventListener('click', () => {
      if (this.posDetailSym) {
        this.closePosition(this.posDetailSym);
        this.posDetailSym = null;
        this.closeModal('posOverlay');
      }
    });

    // Funds navigation
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
      this.$('wdAmt').value = Math.floor(this.state.get().inr);
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
      if (!v) {
        return this.toast('Invalid name', 'Name cannot be empty', 'err');
      }
      this.state.update({ name: v });
      this.renderAcct();
      this.toast('Saved', 'Display name updated', 'ok');
    });
    
    this.$('resetBtn2').addEventListener('click', () => this.resetAccount());
    
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.market.getDataSource() === 'live') {
        // Reconnect WebSocket if needed
      }
    });
    
    window.addEventListener('resize', () => {
      if (this.$('acctOverlay').classList.contains('show')) {
        this.drawEquityCurve();
      }
    });
  }

  /**
   * Switch selected symbol
   */
  switchSymbol(sym) {
    if (this.selSym === sym) return;
    this.selSym = sym;
    this.curLots = this.getLots(sym);
    if (document.activeElement !== this.$('qtyIn')) {
      this.$('qtyIn').value = this.curLots;
    }
    this.markDirty();
  }

  /**
   * Adjust leverage
   */
  adjustLeverage(delta) {
    const S = this.state.get();
    const newLev = Math.max(1, Math.min(this.config.MAX_LEVERAGE, S.lev + delta));
    this.state.update({ lev: newLev });
    this.renderMenu();
    this.markDirty();
  }

  /**
   * Execute trade (buy/sell)
   */
  executeTrade(side) {
    this.placeOrder(side);
  }

  /**
   * Close position
   */
  closePosition(sym, price) {
    const pos = this.state.get().positions[sym];
    if (!pos) return;
    
    const m = this.market.getMarket(sym);
    const fill = pos.dir === 1 ? m.price * 0.9997 : m.price * 1.0003;
    const fee = pos.qty * fill * this.config.TAKER_FEE;
    
    this.applyFill(sym, -pos.dir, fill, pos.qty, pos.lev, fee, pos.lots);
    const shortName = this.config.SYM_META[sym] ? this.config.SYM_META[sym].short : sym;
    this.toast('Closed', shortName + ' @ ' + this.fmtPrice(fill, m.dec), 'ok');
    this.flushSave(true);
    this.markDirty();
  }

  /**
   * Handle menu actions
   */
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

  /**
   * Get lot size for symbol
   */
  lotOf(sym) {
    const m = this.market.getMarket(sym);
    return m ? m.lot : this.config.LOT_SIZES[sym] || 0.001;
  }

  /**
   * Get default lots for symbol
   */
  defaultLots(sym) {
    const m = this.market.getMarket(sym);
    if (m && m.price > 0) {
      return Math.max(1, Math.round(100 / (this.lotOf(sym) * m.price)));
    }
    return 1;
  }

  /**
   * Get current lots for symbol
   */
  getLots(sym) {
    const S = this.state.get();
    if (S.lots[sym] && S.lots[sym] >= 1) {
      return Math.round(S.lots[sym]);
    }
    return this.defaultLots(sym);
  }

  /**
   * Set lots
   */
  setLots(l) {
    l = Math.max(1, Math.round(l));
    this.curLots = l;
    const S = this.state.get();
    const lots = { ...S.lots, [this.selSym]: l };
    this.state.update({ lots });
    
    if (document.activeElement !== this.$('qtyIn')) {
      this.$('qtyIn').value = l;
    }
    this.markDirty();
  }

  /**
   * Step lots up/down
   */
  stepLots(d) {
    this.setLots(this.curLots + d);
  }

  /**
   * Set max lots based on available margin
   */
  setMaxLots() {
    const m = this.market.getMarket(this.selSym);
    if (!m || !(m.price > 0)) return;
    
    const S = this.state.get();
    if (!(S.usd > 0)) {
      return this.toast('No margin', 'Convert INR → USD first', 'err');
    }
    
    const lots = Math.floor((S.usd * 0.99 * S.lev) / (this.lotOf(this.selSym) * m.price));
    this.setLots(Math.max(1, lots));
  }

  /**
   * Set lots by notional value
   */
  setNotionalLots(usd) {
    const m = this.market.getMarket(this.selSym);
    if (!m || !(m.price > 0)) return;
    this.setLots(Math.max(1, Math.round(usd / (this.lotOf(this.selSym) * m.price))));
  }

  /**
   * Place order
   */
  placeOrder(side) {
    const m = this.market.getMarket(this.selSym);
    if (!m) return;
    
    if (!(m.price > 0)) {
      return this.toast('No live price yet', 'Waiting for Delta India feed…', 'err');
    }
    
    const lots = this.curLots;
    if (!(lots >= 1)) {
      return this.toast('Set quantity', 'Minimum 1 lot', 'err');
    }
    
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

  /**
   * Apply fill to position
   */
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
        usd += fee;
        feesTotal -= fee;
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
        usd += fee;
        feesTotal -= fee;
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
    
    // Closing/reducing position
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
          sym,
          dir: side,
          lots: Math.max(1, remainingLots),
          qty: remaining,
          entry: price,
          margin,
          lev,
          tp: 0,
          sl: 0
        };
        this.pushHist(sym, side === 1 ? 'Flip Long' : 'Flip Short', remaining, price, 0);
      }
    }
    
    this.state.update({ usd, feesTotal, positions: finalPositions });
    return true;
  }

  /**
   * Close all positions
   */
  closeAll() {
    const S = this.state.get();
    const syms = Object.keys(S.positions);
    if (!syms.length) {
      return this.toast('Nothing to close', 'No open positions', 'err');
    }
    syms.slice().forEach(sym => this.closePosition(sym));
  }

  /**
   * Record closed position stats
   */
  recordClose(net) {
    const S = this.state.get();
    let realized = S.realized;
    let wins = S.wins;
    let losses = S.losses;
    let best = S.best;
    let worst = S.worst;
    
    realized += net;
    if (net > 0) wins++;
    else if (net < 0) losses++;
    best = Math.max(best, net);
    worst = Math.min(worst, net);
    
    this.state.update({ realized, wins, losses, best, worst });
  }

  /**
   * Push history entry
   */
  pushHist(sym, label, qty, price, pnl) {
    const S = this.state.get();
    const history = [{ t: Date.now(), sym, label, qty, price, pnl }, ...S.history];
    if (history.length > 50) history.length = 50;
    this.state.update({ history });
  }

  /**
   * Check TP/SL triggers
   */
  checkTPSL() {
    const S = this.state.get();
    for (const k in S.positions) {
      const pos = S.positions[k];
      const m = this.market.getMarket(k);
      if (!m || !(m.price > 0)) continue;
      
      if (pos.dir === 1) {
        if (pos.tp && m.price >= pos.tp) {
          this.closeAtTrigger(pos, 'TP hit', pos.tp);
          continue;
        }
        if (pos.sl && m.price <= pos.sl) {
          this.closeAtTrigger(pos, 'SL hit', pos.sl);
        }
      } else {
        if (pos.tp && m.price <= pos.tp) {
          this.closeAtTrigger(pos, 'TP hit', pos.tp);
          continue;
        }
        if (pos.sl && m.price >= pos.sl) {
          this.closeAtTrigger(pos, 'SL hit', pos.sl);
        }
      }
    }
  }

  /**
   * Check liquidations
   */
  checkLiquidations() {
    const S = this.state.get();
    const hits = [];
    
    for (const k in S.positions) {
      if (!this.market.getMarket(k)) continue;
      const pos = S.positions[k];
      const lp = this.liqPrice(pos);
      const p = this.market.getMarket(k).price;
      
      if ((pos.dir === 1 && p <= lp) || (pos.dir === -1 && p >= lp)) {
        hits.push(k);
      }
    }
    
    if (!hits.length) return;
    
    hits.forEach(k => {
      const pos = S.positions[k];
      const positions = { ...S.positions };
      delete positions[k];
      
      const losses = S.losses + 1;
      const worst = Math.min(S.worst, -pos.margin);
      
      this.pushHist(k, '⚡ Liquidated', pos.qty, this.liqPrice(pos), -pos.margin);
      const m = this.market.getMarket(k);
      const shortName = this.config.SYM_META[k] ? this.config.SYM_META[k].short : k;
      this.toast('LIQUIDATED', '⚡ ' + shortName + ' — ' + this.fmtUsd(pos.margin) + ' USD lost', 'err');
      
      this.state.update({ positions, losses, worst });
    });
    
    this.flushSave(true);
    
    if (this.posDetailSym && !S.positions[this.posDetailSym]) {
      this.posDetailSym = null;
      this.closeModal('posOverlay');
    }
  }

  /**
   * Calculate liquidation price
   */
  liqPrice(pos) {
    const mm = 0.005;
    return pos.dir === 1 
      ? pos.entry * (1 - 1 / pos.lev + mm)
      : pos.entry * (1 + 1 / pos.lev - mm);
  }

  /**
   * Close position at trigger price
   */
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
    this.toast(label, shortName + ' closed @ ' + this.fmtPrice(price, m.dec), label === 'TP hit' ? 'ok' : 'err');
    this.flushSave(true);
  }

  /**
   * Open position detail modal
   */
  openPosDetail(sym) {
    const S = this.state.get();
    if (!S.positions[sym]) return;
    
    this.posDetailSym = sym;
    const pos = S.positions[sym];
    const m = this.market.getMarket(sym);
    
    const shortName = this.config.SYM_META[sym] ? this.config.SYM_META[sym].short : sym;
    const t = this.$('pdTitle');
    t.innerHTML = '<span class="side-tag ' + (pos.dir === 1 ? 'long' : 'short') + '">' + 
      (pos.dir === 1 ? 'LONG' : 'SHORT') + ' ' + pos.lev + 'x</span> ' + shortName;
    
    this.$('pdEntry').textContent = this.fmtPrice(pos.entry, m.dec);
    this.$('pdQty').textContent = pos.lots + ' lot' + (pos.lots > 1 ? 's' : '') + ' • ' + this.fmtQty(pos.qty);
    this.$('pdMargin').textContent = this.fmtUsd(pos.margin) + ' $';
    this.$('pdLiq').textContent = this.fmtPrice(this.liqPrice(pos), m.dec);
    
    this.$('pdTpIn').value = pos.tp ? pos.tp : '';
    this.$('pdSlIn').value = pos.sl ? pos.sl : '';
    
    this.renderPosDetailLive();
    this.openModal('posOverlay');
  }

  /**
   * Render position detail live data
   */
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

  /**
   * Save TP/SL settings
   */
  saveTpSl() {
    const S = this.state.get();
    const pos = S.positions[this.posDetailSym];
    if (!pos) return;
    
    const m = this.market.getMarket(this.posDetailSym);
    const tpRaw = parseFloat(this.$('pdTpIn').value);
    const slRaw = parseFloat(this.$('pdSlIn').value);
    const hasTp = isFinite(tpRaw) && tpRaw > 0;
    const hasSl = isFinite(slRaw) && slRaw > 0;
    const mark = m.price;
    
    if (!(mark > 0)) {
      return this.toast('No live price', 'Waiting for feed…', 'err');
    }
    
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

  /**
   * Clear TP/SL settings
   */
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

  /**
   * Do deposit
   */
  doDeposit() {
    const amt = parseFloat(this.$('depAmt').value);
    if (!isFinite(amt) || amt < this.config.MIN_DEPOSIT) {
      return this.toast('Invalid amount', 'Minimum deposit is ₹' + this.config.MIN_DEPOSIT, 'err');
    }
    
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

  /**
   * Do withdraw
   */
  doWithdraw() {
    const amt = parseFloat(this.$('wdAmt').value);
    const S = this.state.get();
    
    if (!isFinite(amt) || amt < this.config.MIN_WITHDRAW) {
      return this.toast('Invalid amount', 'Minimum withdrawal is ₹' + this.config.MIN_WITHDRAW, 'err');
    }
    if (amt > S.inr) {
      return this.toast('Insufficient INR', 'Available: ' + this.fmtInr(S.inr), 'err');
    }
    
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

  /**
   * Flip conversion direction
   */
  flipCvt() {
    this.cvtDir = this.cvtDir === 'i2u' ? 'u2i' : 'i2u';
    this.$('cvtAmt').value = '';
    this.renderCvt();
  }

  /**
   * Render conversion modal
   */
  renderCvt() {
    const i2u = this.cvtDir === 'i2u';
    const S = this.state.get();
    
    this.$('cvtFromL').textContent = i2u ? '₹ INR' : 'USD';
    this.$('cvtToL').textContent = i2u ? 'USD' : '₹ INR';
    this.$('cvtCur').textContent = i2u ? 'INR' : 'USD';
    this.$('cvtAvail').textContent = i2u ? this.fmtInr(S.inr) : this.fmtUsd(S.usd) + ' USD';
    
    this.renderCvtPreview();
  }

  /**
   * Render conversion preview
   */
  renderCvtPreview() {
    const amt = parseFloat(this.$('cvtAmt').value) || 0;
    const rate = this.state.rate || this.config.BASE_RATE;
    const i2u = this.cvtDir === 'i2u';
    
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

  /**
   * Do conversion
   */
  doConvert() {
    const amt = parseFloat(this.$('cvtAmt').value);
    const rate = this.state.rate || this.config.BASE_RATE;
    const S = this.state.get();
    
    if (!isFinite(amt) || amt <= 0) {
      return this.toast('Invalid amount', 'Enter an amount', 'err');
    }
    
    if (this.cvtDir === 'i2u') {
      if (amt > S.inr) {
        return this.toast('Insufficient INR', 'Available: ' + this.fmtInr(S.inr), 'err');
      }
      const recv = (amt - amt * this.config.CONVERT_FEE) / rate;
      this.state.update({ inr: S.inr - amt, usd: S.usd + recv });
      this.ledgerPush('Convert', 'INR→USD', -amt, recv);
      this.toast('Converted ✓', this.fmtInr(amt) + ' → ' + this.fmtUsd(recv) + ' USD', 'ok');
    } else {
      if (amt > S.usd) {
        return this.toast('Insufficient USD', 'Available: ' + this.fmtUsd(S.usd) + ' USD', 'err');
      }
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

  /**
   * Push ledger entry
   */
  ledgerPush(type, detail, dInr, dUsd) {
    const S = this.state.get();
    const ledger = [{ t: Date.now(), type, detail, dInr, dUsd }, ...S.ledger];
    if (ledger.length > 40) ledger.length = 40;
    this.state.update({ ledger });
  }

  /**
   * Reset account
   */
  resetAccount() {
    if (!confirm('Reset account? Everything will be wiped.')) return;
    
    this.state.reset();
    this.hisLen = -1;
    this.flushSave(true);
    this.renderAcct();
    this.markDirty();
    
    this.toast('Reset ✓', 'Balance: ' + this.fmtInr(this.config.START_INR), 'ok');
  }

  /**
   * Sample equity curve
   */
  sampleEq() {
    const S = this.state.get();
    const eqInr = S.inr + this.totals().equity * (this.state.rate || this.config.BASE_RATE);
    const equityCurve = [...S.equityCurve, { t: Date.now(), e: eqInr }];
    if (equityCurve.length > 100) equityCurve.shift();
    this.state.update({ equityCurve });
  }

  /**
   * Calculate totals
   */
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

  /**
   * Get locked USD
   */
  lockedUsd() {
    const S = this.state.get();
    let locked = 0;
    for (const k in S.positions) {
      locked += S.positions[k].margin;
    }
    return locked;
  }

  /**
   * Format helpers
   */
  fmtUsd(x) {
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  fmtUsd0(x) {
    return Number(x).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  
  fmtSign(x) {
    return (x >= 0 ? '+' : '') + this.fmtUsd(x);
  }
  
  fmtInr(x) {
    return '₹' + Number(x).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  
  fmtInrS(x) {
    return (x >= 0 ? '+' : '-') + '₹' + Math.abs(x).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  
  fmtPrice(p, dec) {
    return Number(p).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  
  fmtPxShort(p) {
    if (p >= 1000) return (p / 1000).toFixed(2) + 'k';
    if (p >= 1) return p.toFixed(2);
    return p.toFixed(4);
  }
  
  fmtQty(q) {
    let s = q.toFixed(6);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  
  fmtLot(lot) {
    let s = lot.toFixed(6);
    s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }

  /**
   * Toast notification
   */
  toast(title, msg, type) {
    const container = this.$('toasts');
    const div = document.createElement('div');
    div.className = 'toast' + (type ? ' ' + type : '');
    div.innerHTML = '<b>' + title + '</b><br><small>' + msg + '</small>';
    container.appendChild(div);
    setTimeout(() => div.remove(), 4000);
  }

  /**
   * Modal helpers
   */
  openModal(id) {
    this.$(id).classList.add('show');
  }
  
  closeModal(id) {
    this.$(id).classList.remove('show');
    if (id === 'posOverlay') this.posDetailSym = null;
  }

  /**
   * Mark dirty for render
   */
  markDirty() {
    requestAnimationFrame(() => this.renderAll());
  }

  /**
   * Flush save
   */
  flushSave(force) {
    this.state.save();
  }

  /**
   * Start simulation loop
   */
  startSimulationLoop() {
    setInterval(() => {
      this.checkTPSL();
      this.checkLiquidations();
      this.sampleEq();
      // Removed flushSave from loop - only save on user actions to improve performance
      this.markDirty();
    }, 1000);
  }

  /**
   * Render all UI components
   */
  renderAll() {
    this.renderHeader();
    this.renderMarkets();
    this.renderQty();
    this.renderEntry();
    this.renderPositions();
    this.renderPosDetailLive();
    this.renderFeedStatus();
    this.renderHistory();
    this.renderFunds();
    this.renderMenu();
    
    if (this.$('cvtOverlay').classList.contains('show')) {
      this.renderCvtPreview();
    }
  }

  /**
   * Render feed status indicators (SYNC/LIVE chips and dots)
   */
  renderFeedStatus() {
    const st = this.market.getStats();
    const markets = this.market.getAllMarkets();
    const live = Object.values(markets).some(m => m.gotLive);
    const fresh = st.lastUpdate && (Date.now() - st.lastUpdate < 10000);
    const txt = !fresh ? 'Connecting…' : (st.sockets > 0 ? 'LIVE • WS' : 'LIVE • REST');
    
    const feedText = this.$('feedText');
    const chipText = this.$('chipText');
    const feedDot = this.$('feedDot');
    const chipDot = this.$('chipDot');
    
    if (feedText) feedText.textContent = txt;
    if (chipText) chipText.textContent = live ? 'LIVE' : 'SYNC…';
    if (feedDot) feedDot.classList.toggle('on', !!fresh);
    if (chipDot) chipDot.classList.toggle('on', live);
  }

  /**
   * Render header
   */
  renderHeader() {
    const S = this.state.get();
    const t = this.totals();
    const eqInr = S.inr + t.equity * (this.state.rate || this.config.BASE_RATE);
    
    this.$('hEquity').textContent = this.fmtInr(eqInr);
    this.$('hBalSub').textContent = 'Free ' + this.fmtUsd(S.usd) + ' $';
  }

  /**
   * Render markets
   */
  renderMarkets() {
    const wrap = this.$('symRow');
    if (wrap.childElementCount !== this.config.SYMBOLS.length) {
      wrap.innerHTML = '';
      this.config.SYMBOLS.forEach(sym => {
        const b = document.createElement('button');
        b.className = 'sym-btn';
        b.textContent = this.config.SYM_META[sym].short;
        b.addEventListener('click', () => this.switchSymbol(sym));
        wrap.appendChild(b);
      });
    }
    
    const buttons = wrap.querySelectorAll('.sym-btn');
    buttons.forEach((b, i) => {
      const sym = this.config.SYMBOLS[i];
      if (sym === this.selSym) {
        if (!b.classList.contains('on')) b.classList.add('on');
      } else if (b.classList.contains('on')) {
        b.classList.remove('on');
      }
    });
    
    const m = this.market.getMarket(this.selSym);
    if (!m) return;
    
    this.$('mktTitle').textContent = m.symbol + ' • PERP';
    this.$('lotLabel').textContent = '1 lot = ' + this.fmtLot(m.lot) + ' ' + this.config.SYM_META[this.selSym].short;
    this.$('psPrice').textContent = m.price > 0 ? this.fmtPrice(m.price, m.dec) : '…';
    this.$('psPrice').className = 'ps-price ' + (m.price >= m.prevPrice ? 'pos' : 'neg');
    
    const chg = this.chgOf(m);
    this.$('psChg').textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    this.$('psChg').className = 'ps-chg ' + (chg >= 0 ? 'up' : 'dn');
    
    this.$('psFund').textContent = m.funding 
      ? 'Fund ' + (m.funding >= 0 ? '+' : '') + (m.funding * 100).toFixed(4) + '%'
      : '';
  }

  /**
   * Get change percentage
   */
  chgOf(m) {
    if (m.chg24 != null && isFinite(m.chg24)) return m.chg24;
    if (m.open24 > 0 && m.price > 0) return (m.price - m.open24) / m.open24 * 100;
    return 0;
  }

  /**
   * Render quantity section
   */
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

  /**
   * Render entry buttons
   */
  renderEntry() {
    const S = this.state.get();
    const sub = (this.curLots >= 1) ? (this.curLots + ' lot' + (this.curLots > 1 ? 's' : '') + ' • ' + S.lev + 'x') : '—';
    this.$('buySub').textContent = sub;
    this.$('sellSub').textContent = sub;
    this.$('convHint').style.display = (S.usd < 5 && S.inr >= 1) ? 'flex' : 'none';
  }

  /**
   * Render positions
   */
  renderPositions() {
    const S = this.state.get();
    const keys = Object.keys(S.positions);
    
    this.$('cntPos').textContent = String(keys.length);
    this.$('posEmpty').style.display = keys.length ? 'none' : 'block';
    
    const list = this.$('posList');
    if (keys.length === 0) {
      list.innerHTML = '';
      return;
    }
    
    list.innerHTML = '';
    keys.forEach(k => {
      const pos = S.positions[k];
      const m = this.market.getMarket(k);
      const shortName = this.config.SYM_META[k] ? this.config.SYM_META[k].short : k;
      
      const card = document.createElement('div');
      card.className = 'pos-card';
      card.dataset.sym = k;
      
      const tpSlTxt = (pos.tp || pos.sl)
        ? ((pos.tp ? 'TP ' + this.fmtPxShort(pos.tp) : '') + 
           (pos.tp && pos.sl ? ' • ' : '') + 
           (pos.sl ? 'SL ' + this.fmtPxShort(pos.sl) : ''))
        : '';
      
      card.innerHTML = 
        '<div class="pc-row1">' +
          '<span class="side-tag ' + (pos.dir === 1 ? 'long' : 'short') + '">' + 
            (pos.dir === 1 ? 'LONG' : 'SHORT') + ' ' + pos.lev + 'x</span>' +
          '<span class="pc-sym">' + shortName + '</span>' +
          '<span class="pc-qty">' + pos.lots + ' lot' + (pos.lots > 1 ? 's' : '') + ' • ' + this.fmtQty(pos.qty) + '</span>' +
          '<span class="pc-upnl">—</span>' +
        '</div>' +
        '<div class="pc-row2">' +
          '<span data-in>In ' + this.fmtPxShort(pos.entry) + '</span>' +
          '<span data-mk>Mk —</span>' +
          '<span class="pc-tpsl">' + tpSlTxt + '</span>' +
          '<span class="pc-arrow">›</span>' +
        '</div>';
      
      card.addEventListener('click', () => this.openPosDetail(k));
      list.appendChild(card);
    });
    
    // Update P&L
    keys.forEach(k => {
      const pos = S.positions[k];
      const m = this.market.getMarket(k);
      const up = (m.price - pos.entry) * pos.qty * pos.dir;
      const roe = up / pos.margin * 100;
      
      const card = list.querySelector(`[data-sym="${k}"]`);
      if (card) {
        const upEl = card.querySelector('.pc-upnl');
        const mkEl = card.querySelector('[data-mk]');
        
        mkEl.textContent = 'Mk ' + (m.price > 0 ? this.fmtPxShort(m.price) : '…');
        upEl.textContent = this.fmtSign(up) + ' (' + (roe >= 0 ? '+' : '') + roe.toFixed(1) + '%)';
        upEl.className = 'pc-upnl mono ' + (up >= 0 ? 'pos' : 'neg');
      }
    });
  }

  /**
   * Render history
   */
  renderHistory() {
    const S = this.state.get();
    this.$('mHisCnt').textContent = String(S.history.length);
    
    if (!this.$('hisOverlay').classList.contains('show')) return;
    
    this.$('hisEmpty').style.display = S.history.length ? 'none' : 'block';
    
    if (S.history.length === this.hisLen) return;
    this.hisLen = S.history.length;
    
    this.$('hisBody').innerHTML = S.history.map(h => {
      const t = new Date(h.t).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });
      const cls = h.pnl > 0 ? 'pos' : (h.pnl < 0 ? 'neg' : '');
      const short = (this.config.SYM_META[h.sym] || { short: h.sym }).short;
      return '<tr><td>' + t + '</td><td class="sym-c">' + short + '</td><td>' + h.label + '</td>' +
        '<td>' + this.fmtPrice(h.price, 2) + '</td>' +
        '<td class="' + cls + '">' + (h.pnl ? this.fmtSign(h.pnl) : '—') + '</td></tr>';
    }).join('');
  }

  /**
   * Render funds
   */
  renderFunds() {
    const S = this.state.get();
    const rate = this.state.rate || this.config.BASE_RATE;
    
    if (!this.$('fundsOverlay').classList.contains('show')) return;
    
    this.$('fRate').textContent = '₹' + rate.toFixed(2);
    this.$('fwInr').textContent = this.fmtInr(S.inr);
    this.$('fwUsd').textContent = this.fmtUsd(S.usd) + ' USD';
    this.$('fwUsdSub').textContent = '≈ ' + this.fmtInr(S.usd * rate) + ' • Locked ' + this.fmtUsd(this.lockedUsd());
    this.$('wdAvail').textContent = this.fmtInr(S.inr);
    
    const sig = S.ledger.length + ':' + (S.ledger[0] ? S.ledger[0].t : '');
    if (this.$('ledgerBody')._sig === sig) return;
    this.$('ledgerBody')._sig = sig;
    
    this.$('ledgerEmpty').style.display = S.ledger.length ? 'none' : 'block';
    this.$('ledgerBody').innerHTML = S.ledger.map(l => {
      const t = new Date(l.t).toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });
      const ic = l.dInr ? (l.dInr > 0 ? 'pos' : 'neg') : '';
      const uc = l.dUsd ? (l.dUsd > 0 ? 'pos' : 'neg') : '';
      return '<tr><td>' + t + '</td><td class="sym-c">' + l.type + '</td>' +
        '<td class="' + ic + '">' + (l.dInr ? this.fmtInrS(l.dInr) : '—') + '</td>' +
        '<td class="' + uc + '">' + (l.dUsd ? this.fmtSign(l.dUsd) : '—') + '</td></tr>';
    }).join('');
  }

  /**
   * Render menu
   */
  renderMenu() {
    const S = this.state.get();
    if (!this.$('menuOverlay').classList.contains('show')) return;
    
    if (document.activeElement !== this.$('levRange')) {
      this.$('levRange').value = S.lev;
    }
    this.$('levVal').textContent = S.lev + 'x';
  }

  /**
   * Render account
   */
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

  /**
   * Draw equity curve
   */
  drawEquityCurve() {
    const cv = this.$('eqCanvas');
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
    pts.forEach(p => {
      mn = Math.min(mn, p.e);
      mx = Math.max(mx, p.e);
    });
    
    if (mx === mn) { mx += 1; mn -= 1; }
    
    const padV = (mx - mn) * 0.08;
    mn -= padV;
    mx += padV;
    
    const x = i => i / (pts.length - 1) * W;
    const y = v => H - (v - mn) / (mx - mn) * H;
    
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(79,140,255,.30)');
    grad.addColorStop(1, 'rgba(79,140,255,0)');
    
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

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DeltaPaperApp;
}
