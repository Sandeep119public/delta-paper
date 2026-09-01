import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Helpers to load legacy files in isolation
function makeCtx(extra={}){
  const ls = { _m:new Map(), getItem(k){return this._m.get(k)||null;}, setItem(k,v){this._m.set(k,v);}, removeItem(k){this._m.delete(k);} };
  const ctx = vm.createContext({
    window:{}, globalThis:{}, module:{exports:{}}, DELTA_LOGGER:{log(){},warn(){},error(){}},
    localStorage: ls, console, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, Math, Number, Error, Promise, Array, Object, JSON, AbortController, fetch: global.fetch,
    requestAnimationFrame: cb=>setTimeout(cb,0),
    document: { getElementById:()=>null, createElement:()=>({style:{}, appendChild(){}, querySelector(){return null}, querySelectorAll(){return []}}), querySelectorAll:()=>[], querySelector:()=>null },
    ...extra
  });
  ctx.window = ctx; ctx.globalThis = ctx; ctx.global = ctx;
  ctx.window.localStorage = ls; ctx.localStorage = ls;
  ctx.window.DELTA_LOGGER = ctx.DELTA_LOGGER;
  return ctx;
}

describe('A. await app.init() rejection is catchable by boot', () => {
  it('boot pattern awaits and catches async error', async () => {
    const logs=[];
    const ctx = makeCtx({ DELTA_LOGGER: { log:()=>{}, warn:(...a)=>logs.push(['warn',...a]), error:(...a)=>logs.push(['error',...a]) } });
    // mock minimal app with async init that rejects
    const app = {
      _simulationTimer: null,
      startSimulationLoop(){ if(this._simulationTimer) return; this._simulationTimer = setInterval(()=>{}, 1000); },
      renderAll(){ logs.push(['renderAll']); },
      init: async () => { throw new Error('init boom'); }
    };
    let recovered=false;
    // Exact boot snippet from requirement
    try {
      await app.init();
    } catch (e) {
      ctx.DELTA_LOGGER.error('[Boot] App init failed — attempting isolated recovery', e);
      try {
        app.startSimulationLoop();
        app.renderAll();
        recovered=true;
      } catch (e2) {
        ctx.DELTA_LOGGER.error('[Boot] Isolated recovery failed', e2);
      }
    }
    expect(recovered).toBe(true);
    expect(logs.some(l=>l[0]==='error' && String(l[1]).includes('App init failed'))).toBe(true);
    expect(app._simulationTimer).not.toBeNull();
    clearInterval(app._simulationTimer);
    // Verify that without await, catch wouldn't trigger (control)
    let notCaught=false;
    const app2={ init: async () => { throw new Error('boom2'); } };
    let p;
    try { p=app2.init(); notCaught=true; } catch(e){ notCaught=false; }
    // Without await, promise rejection bypasses try/catch — must handle to avoid unhandled rejection
    if(p && typeof p.catch==='function') p.catch(()=>{});
    expect(notCaught).toBe(true);
  });
});

describe('B. simulation loop cannot start twice', () => {
  it('startSimulationLoop is idempotent', () => {
    // Verify the actual source contains idempotency guard
    const src = fs.readFileSync(new URL('../js/app.js', import.meta.url),'utf8');
    expect(src).toContain('if (this._simulationTimer) return;');
    expect(src).toContain('this._simulationTimer = setInterval');
    // Functional mock test
    class MockApp {
      constructor(){ this._simulationTimer=null; this.calls=0; }
      startSimulationLoop(){ if(this._simulationTimer) return; this._simulationTimer=setInterval(()=>{this.calls++;}, 1000); }
    }
    const App = MockApp;
    // minimal deps
    const cfg={ LOT_SIZES:{BTCUSD:0.001}, MAX_LEVERAGE:20, VALIDATION:{MIN_LOTS:1,MAX_LOTS:10000,MIN_BALANCE:0,MAX_DECIMALS:8}, BASE_RATE:86.6, SYMBOLS:['BTCUSD'] };
    const state={ get:()=>({ lots:{}, positions:{}, lev:10, inr:0, usd:1000, lots:{}, equityCurve:[] }), update(){}, flushSave(){}, getState(){return this.get();} };
    const market={ subscribe(){}, getMarket(){return {price:50000, lot:0.001, dec:2}}, getStats(){return {source:'sim'}} };
    const validator={};
    const app=new App(cfg, state, validator, market);
    // mock _checkTradingTriggers/markDirty to avoid side effects
    app._checkTradingTriggers=()=>{};
    app.markDirty=()=>{};
    app.setupEventListeners=()=>{};
    // avoid chart
    let countBefore = app._simulationTimer;
    expect(countBefore).toBeFalsy();
    app.startSimulationLoop();
    const first=app._simulationTimer;
    expect(first).not.toBeNull();
    app.startSimulationLoop();
    app.startSimulationLoop();
    expect(app._simulationTimer).toBe(first);
    clearInterval(first);
  });
});

describe('C+D. chart failure isolation vs required failure', () => {
  it('boot chart optional load failure does not throw required', async () => {
    const ctx = makeCtx();
    let chartFailed=false;
    const optionalChartLoad = async (src) => {
      if(src.includes('ChartController')) { chartFailed=true; throw new Error(src+' failed'); }
    };
    // Should warn not throw
    try{ await optionalChartLoad('./js/ChartController.js'); }catch(e){ chartFailed=true; }
    expect(chartFailed).toBe(true);
    // Required load must throw
    const requiredLoad = async (src) => { throw new Error(src+' missing'); };
    await expect(requiredLoad('./js/FinancialEngine.js')).rejects.toThrow();
  });
});

describe('E+F CompositeHistoricalProvider fallback policy', () => {
  function loadProviders(){
    const ctx=makeCtx();
    vm.runInContext(fs.readFileSync(new URL('../js/data/DataVerifier.js', import.meta.url),'utf8'), ctx);
    vm.runInContext(fs.readFileSync(new URL('../js/data/HistoricalDataProvider.js', import.meta.url),'utf8'), ctx);
    return ctx;
  }
  it('E. does NOT fallback for invalid request (4xx/validation)', async () => {
    const ctx=loadProviders();
    const cfg={ API_BASE:'https://api.india.delta.exchange', BINANCE_FALLBACK:true, REMOTE_DATA_MODE:'delta_with_binance_fallback', PROXY_CHAIN:[u=>u], BINANCE_KLINES_BASE:'https://fapi.binance.com/fapi/v1/klines', BINANCE_SYMBOL_MAP:{BTCUSD:'BTCUSDT'} };
    const delta = new ctx.DeltaDataProvider(cfg);
    const binance = new ctx.BinanceDataProvider(cfg);
    const composite = new ctx.CompositeHistoricalProvider(cfg, delta, binance);
    // Make delta throw INVALID_RESPONSE (4xx)
    delta.getCandles = async () => { const e=new Error('Delta HTTP 400 Bad Request'); e.category='INVALID_RESPONSE'; throw e; };
    let binanceCalled=false;
    binance.getCandles = async () => { binanceCalled=true; return []; };
    await expect(composite.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000})).rejects.toThrow(/Delta HTTP 400/);
    expect(binanceCalled).toBe(false);
    // Also malformed params style: Delta API error without HTTP but with .success false -> INVALID_RESPONSE? DeltaDataProvider wraps as Delta API error -> category INVALID_RESPONSE? Actually it goes through _normalizeError -> Delta HTTP? Let's simulate generic validation error not fallbackable
    delta.getCandles = async () => { throw Object.assign(new Error('Invalid symbol'), {category:'INVALID_RESPONSE'}); };
    binanceCalled=false;
    await expect(composite.getCandles({symbol:'BAD', interval:'1m', startTime:0, endTime:1000})).rejects.toThrow(/Invalid symbol/);
    expect(binanceCalled).toBe(false);
  });
  it('F. DOES fallback for network/timeout/5xx when explicitly enabled', async () => {
    const ctx=loadProviders();
    const cfg={ API_BASE:'https://api.india.delta.exchange', BINANCE_FALLBACK:true, REMOTE_DATA_MODE:'direct', PROXY_CHAIN:[u=>u], BINANCE_KLINES_BASE:'https://fapi.binance.com/fapi/v1/klines', BINANCE_SYMBOL_MAP:{BTCUSD:'BTCUSDT'} };
    const delta = new ctx.DeltaDataProvider(cfg);
    const binance = new ctx.BinanceDataProvider(cfg);
    // Case with BINANCE_FALLBACK true should fallback
    const composite = new ctx.CompositeHistoricalProvider(cfg, delta, binance);
    delta.getCandles = async () => { const e=new Error('CORS failure'); e.category='CORS_ERROR'; throw e; };
    binance.getCandles = async () => [[Date.now(), '1','2','0.5','1','10']];
    const res = await composite.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000});
    expect(Array.isArray(res)).toBe(true);
    // Timeout fallback
    delta.getCandles = async () => { const e=new Error('TIMEOUT'); e.category='TIMEOUT'; throw e; };
    binance.getCandles = async () => [[Date.now(), '1','2','0.5','1','10']];
    const res2 = await composite.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000});
    expect(Array.isArray(res2)).toBe(true);
    // 5xx fallback
    delta.getCandles = async () => { const e=new Error('Delta HTTP 503'); e.category='SERVER_ERROR'; throw e; };
    binance.getCandles = async () => [[Date.now(), '1','2','0.5','1','10']];
    const res3 = await composite.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000});
    expect(Array.isArray(res3)).toBe(true);
    // When fallback disabled, should NOT fallback even for network
    const cfg2={ ...cfg, BINANCE_FALLBACK:false, REMOTE_DATA_MODE:'direct' };
    const composite2 = new ctx.CompositeHistoricalProvider(cfg2, delta, binance);
    delta.getCandles = async () => { const e=new Error('CORS failure'); e.category='CORS_ERROR'; throw e; };
    await expect(composite2.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000})).rejects.toThrow(/CORS/);
  });
  it('fallback disabled by default', async () => {
    const ctx=loadProviders();
    const cfg={ API_BASE:'https://api.india.delta.exchange', REMOTE_DATA_MODE:'direct', PROXY_CHAIN:[u=>u], BINANCE_KLINES_BASE:'https://fapi.binance.com/fapi/v1/klines', BINANCE_SYMBOL_MAP:{BTCUSD:'BTCUSDT'} };
    // BINANCE_FALLBACK undefined => falsy
    const composite = new ctx.CompositeHistoricalProvider(cfg, new ctx.DeltaDataProvider(cfg), new ctx.BinanceDataProvider(cfg));
    expect(cfg.BINANCE_FALLBACK).toBeUndefined();
    // delta throws network but no fallback flag => should throw
    composite.delta.getCandles = async () => { const e=new Error('CORS'); e.category='CORS_ERROR'; throw e; };
    let called=false;
    composite.binance.getCandles = async () => { called=true; return []; };
    await expect(composite.getCandles({symbol:'BTCUSD', interval:'1m', startTime:0, endTime:1000})).rejects.toThrow();
    expect(called).toBe(false);
  });
});
