import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function loadEngine() {
  const context = {
    console,
    Math,
    Number,
    Date,
    Error,
    window: {}
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../js/FinancialEngine.js', import.meta.url), 'utf8'), context);
  return context.window.FinancialEngine;
}

function fixture() {
  const state = {
    usd: 1000, inr: 0, positions: {}, feesTotal: 0, realized: 0,
    wins: 0, losses: 0, best: 0, worst: 0, grossProfit: 0,
    grossLoss: 0, tradeCount: 0, history: [], tradeArchive: []
  };
  return {
    state: { get: () => state, update: (u) => Object.assign(state, u) },
    market: { getMarket: (symbol) => ({ symbol, price: symbol === 'BTCUSD' ? 110 : 220, funding: 0 }) },
    config: {
      SYMBOLS: ['BTCUSD'], LOT_SIZES: { BTCUSD: 1 }, MAX_LEVERAGE: 20,
      TAKER_FEE: 0.001, BASE_RATE: 86.6, MAINTENANCE_MARGIN: 0.005
    },
    raw: state
  };
}

describe('FinancialEngine', () => {
  let Engine, f, engine;
  beforeEach(() => { Engine = loadEngine(); f = fixture(); engine = new Engine(f.config, f.state, f.market); });

  it('keeps account equity invariant when margin is locked', () => {
    engine.open('BTCUSD', 1, 100, 2, 2);
    const s = engine.accountSnapshot();
    expect(s.availableUsd).toBeCloseTo(899.8, 6);
    expect(s.lockedMarginUsd).toBeCloseTo(100, 6);
    expect(s.equityUsd).toBeCloseTo(1000, 6);
  });

  it('realizes net PnL and releases margin on close', () => {
    engine.open('BTCUSD', 1, 100, 2, 2);
    engine.fill('BTCUSD', -1, 110, 2, 2);
    expect(f.raw.positions.BTCUSD).toBeUndefined();
    expect(f.raw.realized).toBeCloseTo(19.58, 6);
    expect(engine.accountSnapshot().equityUsd).toBeCloseTo(1019.58, 6);
    expect(f.raw.tradeArchive).toHaveLength(1);
  });

  it('rejects a reversal atomically when new margin is insufficient', () => {
    engine.open('BTCUSD', 1, 100, 10, 10);
    const before = structuredClone(f.raw);
    expect(() => engine.fill('BTCUSD', -1, 100, 200, 10)).toThrow(/reversal/);
    expect(f.raw.positions).toEqual(before.positions);
    expect(f.raw.usd).toBe(before.usd);
    expect(f.raw.tradeArchive).toHaveLength(0);
  });

  it('liquidation consumes locked margin without double-debiting available USD', () => {
    engine.open('BTCUSD', 1, 100, 2, 2);
    const availableBefore = f.raw.usd;
    const trade = engine.liquidate('BTCUSD', 50);
    expect(trade.pnl).toBeCloseTo(-100, 6);
    expect(f.raw.usd).toBeCloseTo(availableBefore, 6);
    expect(f.raw.positions.BTCUSD).toBeUndefined();
    expect(engine.accountSnapshot().equityUsd).toBeCloseTo(899.8, 6);
  });
});
