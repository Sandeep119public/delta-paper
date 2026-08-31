import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';

describe('FinancialEngine invariants', () => {
  let FinancialEngine;
  const config = { LOT_SIZES: { BTCUSD: 0.001 }, TAKER_FEE: 0.0005, BASE_RATE: 86.6, MAX_LEVERAGE: 20 };
  let state;
  const market = { prices: { BTCUSD: 50000 }, getMarket(s) { return { price: this.prices[s] }; } };

  beforeAll(() => {
    window.eval(fs.readFileSync(new URL('../js/FinancialEngine.js', import.meta.url), 'utf8'));
    FinancialEngine = window.FinancialEngine;
  });

  function makeState() {
    return {
      state: { inr: 0, usd: 1000, positions: {}, feesTotal: 0, realized: 0, wins: 0, losses: 0, best: 0, worst: 0, grossProfit: 0, grossLoss: 0, tradeCount: 0, history: [], tradeArchive: [] },
      get() { return this.state; },
      update(u) { Object.assign(this.state, u); }
    };
  }

  it('opens a position and locks margin plus fee', () => {
    state = makeState(); const e = new FinancialEngine(config, state, market);
    e.fill('BTCUSD', 1, 50000, 0.001, 10, 0.025, 1);
    expect(state.state.usd).toBeCloseTo(994.975, 8);
    expect(state.state.positions.BTCUSD.margin).toBeCloseTo(5, 8);
  });

  it('realizes close PnL and releases proportional margin', () => {
    state = makeState(); const e = new FinancialEngine(config, state, market);
    e.fill('BTCUSD', 1, 50000, 0.001, 10, 0.025, 1);
    e.fill('BTCUSD', -1, 51000, 0.001, 10, 0.0255, 1);
    expect(state.state.positions.BTCUSD).toBeUndefined();
    expect(state.state.realized).toBeCloseTo(0.9745, 6);
    expect(state.state.tradeArchive).toHaveLength(1);
  });

  it('liquidation consumes locked margin exactly once', () => {
    state = makeState(); const e = new FinancialEngine(config, state, market);
    e.fill('BTCUSD', 1, 50000, 0.001, 10, 0.025, 1);
    const before = state.state.usd;
    const p = state.state.positions.BTCUSD;
    e.liquidate('BTCUSD', e.liquidationPrice(p));
    expect(state.state.usd).toBeCloseTo(before, 8);
    expect(state.state.realized).toBeCloseTo(-5, 8);
    expect(state.state.positions.BTCUSD).toBeUndefined();
  });
});
