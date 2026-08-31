/* Authoritative accounting engine for paper trading. */
(function (global) {
  'use strict';
  const EPS = 1e-10;
  const round = (n, dp = 8) => {
    if (!Number.isFinite(n)) throw new Error('Non-finite financial value');
    const p = 10 ** dp;
    return Math.round((n + Number.EPSILON) * p) / p;
  };
  const positive = n => Number.isFinite(n) && n > 0;

  class FinancialEngine {
    constructor(config, state, market) { this.config = config; this.state = state; this.market = market; }
    lotSize(symbol) {
      const size = this.config.LOT_SIZES && this.config.LOT_SIZES[symbol];
      if (!positive(size)) throw new Error('Unknown contract size for ' + symbol);
      return size;
    }
    fee(notional) { return round(Math.abs(notional) * (this.config.TAKER_FEE || 0)); }
    notional(price, qty) { return round(price * qty); }
    pnl(pos, price, qty = pos.qty) { return round((price - pos.entry) * qty * pos.dir); }
    liquidationPrice(pos) {
      const mm = Number.isFinite(this.config.MAINTENANCE_MARGIN) ? this.config.MAINTENANCE_MARGIN : 0.005;
      return round(pos.dir === 1 ? pos.entry * (1 - 1 / pos.lev + mm) : pos.entry * (1 + 1 / pos.lev - mm));
    }
    open(symbol, side, price, qty, lev, feeAmount, lots) {
      const S = this.state.get();
      const margin = round(this.notional(price, qty) / lev);
      const fee = round(feeAmount || this.fee(this.notional(price, qty)));
      const required = round(margin + fee);
      if (S.usd + EPS < required) throw new Error('Insufficient USD margin');
      const positions = { ...S.positions };
      const old = positions[symbol];
      if (!old) positions[symbol] = { sym: symbol, dir: side, lots: Math.max(1, Math.round(lots || qty / this.lotSize(symbol))), qty: round(qty), entry: round(price), margin, lev, tp: 0, sl: 0, openedAt: Date.now() };
      else {
        const totalQty = old.qty + qty;
        positions[symbol] = { ...old, qty: round(totalQty), lots: Math.max(1, Math.round(totalQty / this.lotSize(symbol))), entry: round((old.qty * old.entry + qty * price) / totalQty), margin: round(old.margin + margin), lev };
      }
      this.state.update({ usd: round(S.usd - required), feesTotal: round((S.feesTotal || 0) + fee), positions });
      return { margin, fee, required };
    }
    fill(symbol, side, price, qty, lev, feeAmount, lots, reason = 'MARKET') {
      if (!positive(price) || !positive(qty) || !Number.isFinite(lev) || lev < 1) throw new Error('Invalid fill parameters');
      const S = this.state.get();
      const pos = S.positions[symbol];
      const orderFee = round(feeAmount || this.fee(this.notional(price, qty)));
      if (!pos || pos.dir === side) return this.open(symbol, side, price, qty, lev, orderFee, lots);

      const closeQty = Math.min(qty, pos.qty);
      const flipQty = Math.max(0, qty - closeQty);
      const closeFee = round(orderFee * (closeQty / qty));
      const flipFee = round(orderFee - closeFee);
      const gross = this.pnl(pos, price, closeQty);
      const released = round(pos.margin * closeQty / pos.qty);
      const net = round(gross - closeFee);
      let usd = round(S.usd + released + net);
      let positions = { ...S.positions };
      if (pos.qty - closeQty <= EPS) delete positions[symbol];
      else positions[symbol] = { ...pos, qty: round(pos.qty - closeQty), lots: Math.max(1, Math.round((pos.qty - closeQty) / this.lotSize(symbol))), margin: round(pos.margin - released) };

      const wins = (S.wins || 0) + (net > EPS ? 1 : 0);
      const losses = (S.losses || 0) + (net < -EPS ? 1 : 0);
      const history = [...(S.history || [])];
      const archive = [...(S.tradeArchive || [])];
      const trade = { id: 'TRD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), positionId: pos.positionId || null, t: Date.now(), symbol, side: pos.dir === 1 ? 'LONG' : 'SHORT', qty: round(closeQty), entryPrice: round(pos.entry), exitPrice: round(price), grossPnl: gross, fee: closeFee, pnl: net, reason };
      history.unshift({ t: trade.t, sym: symbol, label: 'Close ' + trade.side, qty: trade.qty, price: trade.exitPrice, pnl: trade.pnl });
      if (history.length > 100) history.length = 100;
      archive.push(trade);

      if (flipQty > EPS) {
        const margin = round(this.notional(price, flipQty) / lev);
        const required = round(margin + flipFee);
        if (usd + EPS >= required) {
          usd = round(usd - required);
          positions[symbol] = { sym: symbol, dir: side, lots: Math.max(1, Math.round(flipQty / this.lotSize(symbol))), qty: round(flipQty), entry: round(price), margin, lev, tp: 0, sl: 0, openedAt: Date.now() };
        }
      }
      const grossProfit = round((S.grossProfit || 0) + Math.max(0, gross));
      const grossLoss = round((S.grossLoss || 0) + Math.max(0, -gross));
      this.state.update({ usd, positions, realized: round((S.realized || 0) + net), wins, losses, best: Math.max(S.best || 0, net), worst: Math.min(S.worst || 0, net), grossProfit, grossLoss, tradeCount: (S.tradeCount || 0) + 1, feesTotal: round((S.feesTotal || 0) + orderFee), history, tradeArchive: archive });
      return { realizedGross: gross, realizedNet: net, closeQty, flipQty };
    }
    liquidate(symbol, price, reason = 'LIQUIDATION') {
      const S = this.state.get(), pos = S.positions[symbol];
      if (!pos) return null;
      const loss = round(-pos.margin), liq = this.liquidationPrice(pos), positions = { ...S.positions };
      delete positions[symbol];
      const trade = { id: 'TRD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), positionId: pos.positionId || null, t: Date.now(), symbol, side: pos.dir === 1 ? 'LONG' : 'SHORT', qty: pos.qty, entryPrice: pos.entry, exitPrice: liq, grossPnl: loss, fee: 0, pnl: loss, reason };
      const history = [...(S.history || [])]; history.unshift({ t: trade.t, sym: symbol, label: '⚡ Liquidated', qty: pos.qty, price: liq, pnl: loss }); if (history.length > 100) history.length = 100;
      const archive = [...(S.tradeArchive || []), trade];
      this.state.update({ positions, realized: round((S.realized || 0) + loss), grossLoss: round((S.grossLoss || 0) + Math.abs(loss)), losses: (S.losses || 0) + 1, worst: Math.min(S.worst || 0, loss), tradeCount: (S.tradeCount || 0) + 1, history, tradeArchive: archive });
      return trade;
    }
    equity(rate) {
      const S = this.state.get(); let unrealized = 0;
      for (const symbol of Object.keys(S.positions || {})) { const p = S.positions[symbol], m = this.market && this.market.getMarket(symbol); if (m && positive(m.price)) unrealized += this.pnl(p, m.price); }
      return { usd: round(S.usd), unrealized: round(unrealized), totalUsd: round(S.usd + unrealized), inr: round(S.inr + (S.usd + unrealized) * (rate || this.config.BASE_RATE)) };
    }
  }
  global.FinancialEngine = FinancialEngine;
  global.FINANCIAL_ROUND = round;
})(window);
