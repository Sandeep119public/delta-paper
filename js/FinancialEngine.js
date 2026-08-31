/* Authoritative paper-accounting engine. All balance, margin and P&L changes flow through here. */
(function (global) {
  'use strict';
  const EPS = 1e-10;
  const round = (n, dp = 8) => {
    if (!Number.isFinite(n)) throw new Error('Non-finite financial value');
    const p = 10 ** dp;
    return Math.round((n + Number.EPSILON) * p) / p;
  };
  const positive = n => Number.isFinite(n) && n > 0;
  const sideOk = s => s === 1 || s === -1;

  class FinancialEngine {
    constructor(config, state, market) { this.config = config; this.state = state; this.market = market; }
    lotSize(symbol) { const v = Number(this.config.LOT_SIZES?.[symbol]); if (!positive(v)) throw Error('Unknown contract size for ' + symbol); return v; }
    fee(notional) { return round(Math.abs(notional) * Number(this.config.TAKER_FEE || 0)); }
    notional(price, qty) { return round(price * qty); }
    pnl(pos, price, qty = pos.qty) { return round((price - pos.entry) * qty * pos.dir); }
    liquidationPrice(pos) {
      const mm = Number.isFinite(this.config.MAINTENANCE_MARGIN) ? this.config.MAINTENANCE_MARGIN : 0.005;
      return round(pos.dir === 1 ? pos.entry * (1 - 1 / pos.lev + mm) : pos.entry * (1 + 1 / pos.lev - mm));
    }
    _validate(symbol, side, price, qty, lev) {
      if (!this.config.SYMBOLS.includes(symbol)) throw Error('Invalid symbol');
      if (!sideOk(side)) throw Error('Invalid side');
      if (!positive(price) || !positive(qty)) throw Error('Invalid price or quantity');
      if (!Number.isFinite(lev) || lev < 1 || lev > this.config.MAX_LEVERAGE) throw Error('Invalid leverage');
    }
    accountSnapshot(rate) {
      const S = this.state.get(); let unrealized = 0, locked = 0;
      for (const [symbol, p] of Object.entries(S.positions || {})) {
        locked += Number(p.margin) || 0;
        const m = this.market?.getMarket(symbol);
        if (m && positive(m.price)) unrealized += this.pnl(p, m.price);
      }
      locked = round(locked); unrealized = round(unrealized);
      const availableUsd = round(S.usd || 0), equityUsd = round(availableUsd + locked + unrealized);
      const fx = Number(rate || S.rate || this.config.BASE_RATE);
      return { inr: round(S.inr || 0), availableUsd, lockedMarginUsd: locked, unrealizedPnlUsd: unrealized, equityUsd, withdrawableUsd: availableUsd, withdrawableInr: round(S.inr || 0), totalInr: round((S.inr || 0) + equityUsd * fx), rate: fx };
    }
    equity(rate) { const a = this.accountSnapshot(rate); return { usd: a.availableUsd, unrealized: a.unrealizedPnlUsd, lockedMargin: a.lockedMarginUsd, totalUsd: a.equityUsd, inr: a.totalInr }; }
    open(symbol, side, price, qty, lev, feeAmount, lots) {
      this._validate(symbol, side, price, qty, lev);
      const S = this.state.get(), n = this.notional(price, qty), margin = round(n / lev), fee = round(feeAmount ?? this.fee(n)), required = round(margin + fee);
      if (fee < 0 || (S.usd || 0) + EPS < required) throw Error('Insufficient USD margin');
      const positions = { ...(S.positions || {}) }, old = positions[symbol], lotCount = Math.max(1, Math.round(lots || qty / this.lotSize(symbol)));
      if (!old) positions[symbol] = { sym: symbol, dir: side, lots: lotCount, qty: round(qty), entry: round(price), margin, lev, tp: 0, sl: 0, openedAt: Date.now(), positionId: 'POS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) };
      else {
        if (old.dir !== side) throw Error('Cannot add to opposite position through open()');
        const totalQty = round(old.qty + qty), entry = round((old.qty * old.entry + qty * price) / totalQty), totalMargin = round(old.margin + margin);
        positions[symbol] = { ...old, qty: totalQty, lots: Math.max(1, Math.round(totalQty / this.lotSize(symbol))), entry, margin: totalMargin, lev: round((entry * totalQty) / totalMargin, 8) };
      }
      this.state.update({ usd: round((S.usd || 0) - required), feesTotal: round((S.feesTotal || 0) + fee), positions });
      return { margin, fee, required };
    }
    fill(symbol, side, price, qty, lev, feeAmount, lots, reason = 'MARKET') {
      this._validate(symbol, side, price, qty, lev);
      const S = this.state.get(), pos = S.positions?.[symbol], orderFee = round(feeAmount ?? this.fee(this.notional(price, qty)));
      if (!pos || pos.dir === side) return this.open(symbol, side, price, qty, lev, orderFee, lots);
      const closeQty = Math.min(qty, pos.qty), flipQty = round(Math.max(0, qty - closeQty)), closeFee = round(orderFee * (closeQty / qty)), flipFee = round(orderFee - closeFee), gross = this.pnl(pos, price, closeQty), released = round(pos.margin * closeQty / pos.qty), net = round(gross - closeFee);
      let usd = round((S.usd || 0) + released + net);
      if (flipQty > EPS) { const flipMargin = round(this.notional(price, flipQty) / lev); if (usd + EPS < round(flipMargin + flipFee)) throw Error('Insufficient USD margin for reversal'); }
      const positions = { ...(S.positions || {}) };
      if (round(pos.qty - closeQty) <= EPS) delete positions[symbol];
      else positions[symbol] = { ...pos, qty: round(pos.qty - closeQty), lots: Math.max(1, Math.round((pos.qty - closeQty) / this.lotSize(symbol))), margin: round(pos.margin - released) };
      if (flipQty > EPS) { const flipMargin = round(this.notional(price, flipQty) / lev); positions[symbol] = { sym: symbol, dir: side, lots: Math.max(1, Math.round(flipQty / this.lotSize(symbol))), qty: flipQty, entry: round(price), margin: flipMargin, lev, tp: 0, sl: 0, openedAt: Date.now(), positionId: 'POS-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) }; usd = round(usd - flipMargin - flipFee); }
      const trade = { id: 'TRD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), positionId: pos.positionId || null, t: Date.now(), symbol, side: pos.dir === 1 ? 'LONG' : 'SHORT', qty: round(closeQty), entryPrice: round(pos.entry), exitPrice: round(price), grossPnl: gross, fee: closeFee, pnl: net, reason };
      const history = [{ t: trade.t, id: trade.id, sym: symbol, label: 'Close ' + trade.side, qty: trade.qty, price: trade.exitPrice, pnl: trade.pnl }, ...(S.history || [])].slice(0, 100);
      const archive = [...(S.tradeArchive || []), trade], wins = (S.wins || 0) + (net > EPS ? 1 : 0), losses = (S.losses || 0) + (net < -EPS ? 1 : 0);
      this.state.update({ usd, positions, realized: round((S.realized || 0) + net), wins, losses, best: Math.max(S.best || 0, net), worst: Math.min(S.worst || 0, net), grossProfit: round((S.grossProfit || 0) + Math.max(0, gross)), grossLoss: round((S.grossLoss || 0) + Math.max(0, -gross)), tradeCount: (S.tradeCount || 0) + 1, feesTotal: round((S.feesTotal || 0) + orderFee), history, tradeArchive: archive });
      return { realizedGross: gross, realizedNet: net, closeQty, flipQty, tradeId: trade.id };
    }
    liquidate(symbol, price, reason = 'LIQUIDATION') {
      const S = this.state.get(), pos = S.positions?.[symbol]; if (!pos) return null;
      const liq = this.liquidationPrice(pos), loss = round(-pos.margin), trade = { id: 'TRD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), positionId: pos.positionId || null, t: Date.now(), symbol, side: pos.dir === 1 ? 'LONG' : 'SHORT', qty: round(pos.qty), entryPrice: round(pos.entry), exitPrice: liq, grossPnl: loss, fee: 0, pnl: loss, reason };
      const positions = { ...(S.positions || {}) }; delete positions[symbol]; const history = [{ t: trade.t, id: trade.id, sym: symbol, label: '⚡ Liquidated', qty: trade.qty, price: liq, pnl: loss }, ...(S.history || [])].slice(0,100);
      this.state.update({ positions, realized: round((S.realized || 0) + loss), grossLoss: round((S.grossLoss || 0) + Math.abs(loss)), losses: (S.losses || 0) + 1, worst: Math.min(S.worst || 0, loss), tradeCount: (S.tradeCount || 0) + 1, history, tradeArchive: [...(S.tradeArchive || []), trade] });
      return trade;
    }
  }
  global.FinancialEngine = FinancialEngine;
  global.FINANCIAL_ROUND = round;
})(window);
