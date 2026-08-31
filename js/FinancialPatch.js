/* Integration and analytics hardening. */
(function (global) {
  'use strict';
  const round = global.FINANCIAL_ROUND || (n => Number(n.toFixed(8)));
  if (global.AppState) {
    const oldDefault = AppState.prototype.createDefault;
    AppState.prototype.createDefault = function () {
      const s = oldDefault.call(this);
      s.grossProfit = 0; s.grossLoss = 0; s.tradeCount = 0; s.tradeArchive = []; s.peakEquity = 0;
      return s;
    };
    const oldMigrate = AppState.prototype.migrateState;
    AppState.prototype.migrateState = function () {
      oldMigrate.call(this); const s = this.state;
      s.tradeArchive = Array.isArray(s.tradeArchive) ? s.tradeArchive : [];
      s.grossProfit = Number.isFinite(s.grossProfit) ? s.grossProfit : 0;
      s.grossLoss = Number.isFinite(s.grossLoss) ? s.grossLoss : 0;
      s.tradeCount = Number.isFinite(s.tradeCount) ? s.tradeCount : (s.wins || 0) + (s.losses || 0);
      s.peakEquity = Number.isFinite(s.peakEquity) ? s.peakEquity : 0;
    };
  }
  if (!global.DeltaPaperApp) return;
  DeltaPaperApp.prototype.applyFill = function (sym, side, price, qty, lev, fee, lots) {
    try { this.financial = this.financial || global.financialEngine; this.financial.fill(sym, side, price, qty, lev, fee, lots, 'MARKET'); this.flushSave(true); this.markDirty(); return true; }
    catch (e) { this.toast('Order rejected', e.message, 'err'); return false; }
  };
  DeltaPaperApp.prototype.liqPrice = function (pos) { return this.financial.liquidationPrice(pos); };
  DeltaPaperApp.prototype.totals = function () {
    const S = this.state.get(); let unrealized = 0, lockedMargin = 0;
    for (const sym of Object.keys(S.positions || {})) { const p = S.positions[sym], m = this.market.getMarket(sym); lockedMargin += p.margin || 0; if (m && m.price > 0) unrealized += this.financial.pnl(p, m.price); }
    return { equity: round(unrealized), lockedMargin: round(lockedMargin), totalEquityUsd: round(S.usd + lockedMargin + unrealized) };
  };
  DeltaPaperApp.prototype.sampleEq = function () {
    const S = this.state.get(), rate = this.state.rate || this.config.BASE_RATE, t = Date.now(), totals = this.totals();
    const eq = round((S.inr || 0) + totals.totalEquityUsd * rate), curve = Array.isArray(S.equityCurve) ? [...S.equityCurve] : [], last = curve[curve.length - 1];
    if (!last || t - last.t >= 250) curve.push({ t, e: eq });
    if (curve.length > 5000) curve.shift();
    this.state.update({ equityCurve: curve, peakEquity: Math.max(S.peakEquity || 0, eq) });
  };
  DeltaPaperApp.prototype.checkLiquidations = function () {
    const S = this.state.get();
    for (const sym of Object.keys(S.positions || {})) { const p = S.positions[sym], m = this.market.getMarket(sym); if (!m || !(m.price > 0)) continue; const liq = this.financial.liquidationPrice(p); if ((p.dir === 1 && m.price <= liq) || (p.dir === -1 && m.price >= liq)) { const t = this.financial.liquidate(sym, liq); if (t) this.toast('LIQUIDATED', sym + ' — ' + this.fmtUsd(Math.abs(t.pnl)) + ' USD lost', 'err'); } }
    this.flushSave(true);
  };
  DeltaPaperApp.prototype.startSimulationLoop = function () {
    if (this._financialTimer) clearInterval(this._financialTimer);
    this._financialTimer = setInterval(() => { this.checkTPSL(); this.checkLiquidations(); this.sampleEq(); if (this.heatmap) this.heatmap.refresh(); this.markDirty(); }, 250);
  };
  if (global.RiskMetrics) {
    RiskMetrics.prototype.calculate = function () {
      const s = this.state.getState(), trades = Array.isArray(s.tradeArchive) ? s.tradeArchive : [], curve = Array.isArray(s.equityCurve) ? s.equityCurve : [];
      const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl < 0), total = wins.length + losses.length;
      const grossProfit = trades.reduce((a,t)=>a+Math.max(0, Number(t.grossPnl ?? t.pnl ?? 0)),0), grossLoss = trades.reduce((a,t)=>a+Math.max(0,-Number(t.grossPnl ?? t.pnl ?? 0)),0);
      const avgWin = wins.length ? wins.reduce((a,t)=>a+t.pnl,0)/wins.length : 0, avgLoss = losses.length ? losses.reduce((a,t)=>a+t.pnl,0)/losses.length : 0;
      const winRate = total ? wins.length/total : 0, returns = this.calculateReturns(curve), n = this._periodsPerYear(curve), dd = this.calculateMaxDrawdown(curve), years = this._years(curve);
      const pf = grossLoss ? grossProfit/grossLoss : (grossProfit ? Infinity : 0), expectancy = winRate*avgWin + (1-winRate)*avgLoss;
      const annualReturn = years > 0 && curve[0].e > 0 ? Math.pow(curve[curve.length-1].e/curve[0].e, 1/years)-1 : 0;
      return { maxDrawdown: dd.amount, maxDrawdownPercent: dd.percent, sharpeRatio: this._ratio(returns,n,0.06), sortinoRatio: this._sortino(returns,n), calmarRatio: dd.percent ? annualReturn/(dd.percent/100) : (annualReturn > 0 ? Infinity : 0), winRate: winRate*100, profitFactor: pf, expectancy, totalTrades: total, winningTrades: wins.length, losingTrades: losses.length, averageWin: avgWin, averageLoss: avgLoss, bestTrade: trades.length ? Math.max(...trades.map(t=>t.pnl)) : 0, worstTrade: trades.length ? Math.min(...trades.map(t=>t.pnl)) : 0, totalFees: s.feesTotal || 0, netPnl: trades.reduce((a,t)=>a+Number(t.pnl||0),0), grossProfit, grossLoss };
    };
    RiskMetrics.prototype.calculateReturns = function (curve) { const r=[]; for(let i=1;i<curve.length;i++) if(curve[i-1].e>0 && curve[i].t>curve[i-1].t) r.push(curve[i].e/curve[i-1].e-1); return r; };
    RiskMetrics.prototype._periodsPerYear = function (curve) { if(curve.length<2)return 365; const dt=(curve[curve.length-1].t-curve[0].t)/Math.max(1,curve.length-1); return dt>0?(365.25*86400000)/dt:365; };
    RiskMetrics.prototype._years = function (curve) { return curve.length>1?Math.max(0,(curve[curve.length-1].t-curve[0].t)/(365.25*86400000)):0; };
    RiskMetrics.prototype._ratio = function (rs,n,rf) { if(rs.length<2)return 0; const prf=Math.pow(1+rf,1/n)-1,e=rs.map(x=>x-prf),m=e.reduce((a,b)=>a+b,0)/e.length,sd=Math.sqrt(e.reduce((a,x)=>a+x*x,0)/(e.length-1)); return sd?m/sd*Math.sqrt(n):0; };
    RiskMetrics.prototype._sortino = function (rs,n) { if(rs.length<2)return 0; const m=rs.reduce((a,b)=>a+b,0)/rs.length,d=Math.sqrt(rs.map(x=>Math.min(0,x)**2).reduce((a,b)=>a+b,0)/rs.length); return d?m/d*Math.sqrt(n):(m>0?Infinity:0); };
  }
})(window);
