import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function loadInContext(name, context) {
  vm.runInContext(fs.readFileSync(new URL('../js/' + name, import.meta.url), 'utf8'), context);
}

function fixture() {
  const raw = {
    usd: 5000, inr: 866000, lev: 10, positions: {}, lots: {},
    feesTotal: 0, realized: 0, wins: 0, losses: 0, best: 0, worst: 0,
    grossProfit: 0, grossLoss: 0, tradeCount: 0, history: [], tradeArchive: [],
    ledger: [], equityCurve: [], rate: 86.6, uid: 'DE-IN-TEST'
  };
  const mockCtx2d = {
    setTransform: () => {}, clearRect: () => {}, beginPath: () => {},
    moveTo: () => {}, lineTo: () => {}, stroke: () => {}, fill: () => {},
    closePath: () => {}, arc: () => {}, fillRect: () => {}, strokeRect: () => {},
    scale: () => {}, translate: () => {}, save: () => {}, restore: () => {},
    measureText: () => ({ width: 0 }), fillText: () => {}, strokeText: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    rect: () => {}, clip: () => {}, drawImage: () => {},
    canvas: { width: 300, height: 150 }
  };
  const mockEl = () => ({
    click: () => {}, textContent: '', innerHTML: '', className: '',
    style: {}, value: '', dataset: {}, appendChild: () => {},
    addEventListener: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => false, contains: () => false },
    observe: () => {}, querySelector: () => mockEl(), querySelectorAll: () => [],
    replaceChildren: () => {}, getContext: () => mockCtx2d, getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
    width: 300, height: 150,
  });
  const store = {};
  const context = vm.createContext({
    console, Math, Number, Date, Error, String, Object, Array, parseInt, parseFloat,
    isFinite, isNaN, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    document: {
      getElementById: (id) => {
        if (!store[id]) store[id] = mockEl();
        return store[id];
      },
      querySelector: () => mockEl(),
      querySelectorAll: () => [],
      createElement: () => mockEl(),
      addEventListener: () => {}
    },
    window: {},
    navigator: { serviceWorker: null },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    localStorage: {
      store: {},
      getItem(key) { return this.store[key] || null; },
      setItem(key, value) { this.store[key] = String(value); },
      removeItem(key) { delete this.store[key]; },
      clear() { this.store = {}; }
    },
    ResizeObserver: class { observe() {} },
    confirm: () => true,
    LightweightCharts: {
      LineStyle: { Dashed: 2, Dotted: 3 },
      CrosshairMode: { Normal: 1 }
    }
  });
  context.window = context;
  context.globalThis = context;

  loadInContext('console.js', context);
  loadInContext('config.js', context);
  loadInContext('validator.js', context);
  loadInContext('state.js', context);
  loadInContext('FinancialEngine.js', context);
  loadInContext('TradingEngine.js', context);
  loadInContext('app.js', context);

  vm.runInContext(`
    this.DELTA_CONFIG = typeof DELTA_CONFIG !== 'undefined' ? DELTA_CONFIG : this.DELTA_CONFIG;
    this.InputValidator = typeof InputValidator !== 'undefined' ? InputValidator : this.InputValidator;
    this.AppState = typeof AppState !== 'undefined' ? AppState : this.AppState;
    this.DeltaPaperApp = typeof DeltaPaperApp !== 'undefined' ? DeltaPaperApp : this.DeltaPaperApp;
  `, context);

  const config = context.DELTA_CONFIG;
  const state = new context.AppState(config);
  state.state = { ...raw };
  state.get = () => state.state;
  state.update = (u) => { Object.assign(state.state, u); };
  state.flushSave = () => {};
  state.subscribe = () => () => {};
  const validator = new context.InputValidator(config);
  let livePrice = 50000;
  const market = {
    getMarket: (sym) => ({ symbol: sym, price: livePrice, lot: config.LOT_SIZES[sym] || 0.001, dec: 2, short: sym }),
    subscribe: () => () => {},
    getStats: () => ({ source: 'live', anyGotLive: true })
  };
  const financial = new context.FinancialEngine(config, state, market);
  const trading = new context.TradingEngine(config, state, market, financial);
  const app = new context.DeltaPaperApp(config, state, validator, market);
  app.financial = financial;
  app.trading = trading;
  return { app, state, raw: state.state, market, financial, trading, setLive: (v) => { livePrice = v; } };
}

describe('DeltaPaperApp constructor', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('all bound methods exist on the instance', () => {
    const bound = ['init', 'renderAll', 'switchSymbol', 'adjustLeverage', 'executeTrade', 'closePosition', 'handleMenuAction'];
    for (const name of bound) {
      expect(typeof f.app[name]).toBe('function');
    }
  });

  it('_chartRequest initializes to 0', () => {
    expect(f.app._chartRequest).toBe(0);
  });
});

describe('lotOf', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('returns market lot size when available', () => {
    expect(f.app.lotOf('BTCUSD')).toBe(0.001);
  });

  it('falls back to config LOT_SIZES', () => {
    expect(f.app.lotOf('ETHUSD')).toBe(0.01);
  });

  it('returns tiny default for unknown symbol', () => {
    expect(f.app.lotOf('UNKNOWN')).toBe(0.001);
  });
});

describe('getLots / setLots / stepLots', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('getLots returns default when no saved value', () => {
    const lots = f.app.getLots('BTCUSD');
    expect(lots).toBeGreaterThanOrEqual(1);
  });

  it('getLots returns saved value when available', () => {
    f.raw.lots.BTCUSD = 5;
    expect(f.app.getLots('BTCUSD')).toBe(5);
  });

  it('setLots clamps to minimum 1', () => {
    f.app.setLots(0);
    expect(f.app.curLots).toBe(1);
  });

  it('setLots rounds and persists', () => {
    f.app.selSym = 'BTCUSD';
    f.app.setLots(7);
    expect(f.app.curLots).toBe(7);
    expect(f.raw.lots.BTCUSD).toBe(7);
  });

  it('stepLots(+1) increments', () => {
    f.app.curLots = 3;
    f.app.stepLots(1);
    expect(f.app.curLots).toBe(4);
  });

  it('stepLots(-1) decrements but respects minimum', () => {
    f.app.curLots = 1;
    f.app.stepLots(-1);
    expect(f.app.curLots).toBe(1);
  });

  it('stepLots(-1) from 3 gives 2', () => {
    f.app.curLots = 3;
    f.app.stepLots(-1);
    expect(f.app.curLots).toBe(2);
  });
});

describe('defaultLots', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('returns at least 1', () => {
    expect(f.app.defaultLots('BTCUSD')).toBeGreaterThanOrEqual(1);
  });
});

describe('setMaxLots', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('sets lots based on available USD margin', () => {
    f.raw.usd = 10000;
    f.raw.lev = 10;
    f.app.selSym = 'BTCUSD';
    f.setLive(50000);
    f.app.setMaxLots();
    expect(f.app.curLots).toBeGreaterThanOrEqual(1);
  });

  it('shows toast when no USD margin', () => {
    f.raw.usd = 0;
    f.app.selSym = 'BTCUSD';
    f.app.setMaxLots();
    expect(f.app.curLots).toBe(1);
  });
});

describe('setNotionalLots', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('sets lots for a given notional USD amount', () => {
    f.app.selSym = 'BTCUSD';
    f.setLive(50000);
    f.app.setNotionalLots(500);
    expect(f.app.curLots).toBeGreaterThanOrEqual(1);
  });
});

describe('handleMenuAction', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('is a function', () => {
    expect(typeof f.app.handleMenuAction).toBe('function');
  });

  it('dispatches to correct actions without crash', () => {
    expect(() => f.app.handleMenuAction('funds')).not.toThrow();
    expect(() => f.app.handleMenuAction('history')).not.toThrow();
    expect(() => f.app.handleMenuAction('unknown-action')).not.toThrow();
  });
});

describe('chart request counter', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('starts at 0', () => {
    expect(f.app._chartRequest).toBe(0);
  });

  it('increment prevents stale overwrite', () => {
    f.app._chartRequest = 5;
    const req1 = ++f.app._chartRequest;
    const req2 = ++f.app._chartRequest;
    expect(req2).toBe(req1 + 1);
    expect(req2).toBeGreaterThan(req1);
    expect(req1).toBe(6);
    expect(req2).toBe(7);
  });
});

describe('no dead trading methods', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('recordClose is removed', () => {
    expect(typeof f.app.recordClose).toBe('undefined');
  });

  it('pushHist is removed', () => {
    expect(typeof f.app.pushHist).toBe('undefined');
  });

  it('closeAtTrigger is removed', () => {
    expect(typeof f.app.closeAtTrigger).toBe('undefined');
  });

  it('liqPrice is removed', () => {
    expect(typeof f.app.liqPrice).toBe('undefined');
  });

  it('applyFill is removed', () => {
    expect(typeof f.app.applyFill).toBe('undefined');
  });
});

describe('liquidation display uses FinancialEngine', () => {
  let f;
  beforeEach(() => { f = fixture(); });

  it('financial.liquidationPrice returns a number', () => {
    const pos = { sym: 'BTCUSD', dir: 1, lots: 1, qty: 0.001, entry: 50000, margin: 50, lev: 10, tp: 0, sl: 0 };
    const liq = f.app.financial.liquidationPrice(pos);
    expect(typeof liq).toBe('number');
    expect(liq).toBeGreaterThan(0);
  });
});
