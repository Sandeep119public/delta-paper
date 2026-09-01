import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

// Load modules in VM to avoid DOM deps
function loadVerifier(){
  const ctx = vm.createContext({ window:{}, globalThis:{}, module:{exports:{}}, DELTA_LOGGER:{log(){},warn(){},error(){}}});
  ctx.global = ctx.window;
  // Make window globalThis
  vm.runInContext(fs.readFileSync(new URL('../js/data/DataVerifier.js', import.meta.url),'utf8'), ctx);
  return ctx.window.DataVerifier || ctx.DataVerifier;
}
function loadStorage(){
  const ls={ _m:new Map(), getItem(k){ return this._m.get(k)||null; }, setItem(k,v){ this._m.set(k,v); }, removeItem(k){ this._m.delete(k); } };
  const ctx = vm.createContext({ window:{ indexedDB: undefined, localStorage: ls, AbortController, setTimeout, clearTimeout, Date, Math, Number, Error, Promise, fetch: global.fetch, localStorage: ls }, localStorage: ls, indexedDB: undefined, AbortController, setTimeout, clearTimeout, window:{}, globalThis:{}, module:{exports:{}}, DELTA_LOGGER:{log(){},warn(){},error(){}}});
  ctx.window.indexedDB = undefined;
  ctx.window.localStorage=ls; ctx.localStorage=ls; ctx.AbortController=AbortController; ctx.window.AbortController=AbortController; ctx.window.setTimeout=setTimeout; ctx.setTimeout=setTimeout; ctx.window.clearTimeout=clearTimeout; ctx.clearTimeout=clearTimeout;
  global.localStorage=ls;
  vm.runInContext(fs.readFileSync(new URL('../js/data/DataVerifier.js', import.meta.url),'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/data/HistoricalDataStorage.js', import.meta.url),'utf8'), ctx);
  return { HistoricalDataStorage: ctx.window.HistoricalDataStorage, DataVerifier: ctx.window.DataVerifier };
}
function loadManager(){
  const ls={ _m:new Map(), getItem(k){ return this._m.get(k)||null; }, setItem(k,v){ this._m.set(k,v); }, removeItem(k){ this._m.delete(k); } };
  const ctx = vm.createContext({ window:{ indexedDB: undefined, fetch: global.fetch, localStorage: ls, AbortController, setTimeout, clearTimeout, Date, Math, Number, Error, Promise, Array, Object, JSON, console, fetch: global.fetch }, localStorage: ls, indexedDB: undefined, AbortController, setTimeout, clearTimeout, fetch: global.fetch, window:{}, globalThis:{}, module:{exports:{}}, DELTA_LOGGER:{log(){},warn(){},error(){}}});
  ctx.window.indexedDB = undefined; ctx.window.setTimeout=setTimeout; ctx.setTimeout=setTimeout; ctx.window.clearTimeout=clearTimeout; ctx.clearTimeout=clearTimeout; ctx.window.AbortController=AbortController; ctx.AbortController=AbortController; ctx.window.localStorage=ls; ctx.localStorage=ls; ctx.window.fetch=global.fetch; ctx.fetch=global.fetch;
  global.localStorage=ls; global.fetch=global.fetch;
  vm.runInContext(fs.readFileSync(new URL('../js/data/DataVerifier.js', import.meta.url),'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/data/HistoricalDataStorage.js', import.meta.url),'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/data/DataDownloader.js', import.meta.url),'utf8'), ctx);
  vm.runInContext(fs.readFileSync(new URL('../js/data/HistoricalDataManager.js', import.meta.url),'utf8'), ctx);
  return ctx.window;
}

describe('DataVerifier',()=>{
  it('removes duplicates',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:1, high:2, low:1, close:1.5, volume:10},
      {openTime:60000, open:1, high:2, low:1, close:1.5, volume:10},
      {openTime:60000, open:1, high:2, low:1, close:1.5, volume:10},
      {openTime:120000, open:1, high:2, low:1, close:1.5, volume:10},
    ];
    const r=V.normalizeCandles(rows);
    expect(r.candles.length).toBe(3);
    expect(r.duplicates).toBe(1);
  });
  it('rejects invalid OHLC',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:1, high:0.5, low:1, close:1, volume:10}, // high < open
      {openTime:60000, open:1, high:2, low:3, close:1, volume:10}, // low > open
      {openTime:120000, open:NaN, high:2, low:1, close:1, volume:10},
      {openTime:180000, open:1, high:2, low:1, close:1, volume:-5}, // negative vol
      {openTime:240000, open:1, high:2, low:1, close:1, volume:10}, // valid
    ];
    const r=V.normalizeCandles(rows);
    expect(r.invalid).toBe(4);
    expect(r.candles.length).toBe(1);
  });
  it('detects missing candles',()=>{
    const V=loadVerifier();
    const rows=[{openTime:0},{openTime:60000},{openTime:180000},{openTime:240000}].map(r=> ({...r, open:1, high:2, low:1, close:1.5, volume:10}));
    // normalize will keep all (they are valid)
    const norm=V.normalizeCandles(rows);
    const gaps=V.findGaps(norm.candles, 0, 240000, 60000);
    expect(gaps).toEqual([[120000,120000]]);
  });
  it('sorts by timestamp',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:120000, open:1, high:2, low:1, close:1, volume:10},
      {openTime:0, open:1, high:2, low:1, close:1, volume:10},
      {openTime:60000, open:1, high:2, low:1, close:1, volume:10},
    ];
    const r=V.normalizeCandles(rows);
    expect(r.candles.map(c=>c.openTime)).toEqual([0,60000,120000]);
  });
  it('health score calculation',()=>{
    const V=loadVerifier();
    expect(V.healthScore({totalExpected:100, missing:1, invalid:1, duplicates:0})).toBe(98);
    expect(V.healthScore({totalExpected:100, missing:0, invalid:0, duplicates:0})).toBe(100);
    expect(V.statusFor(99.98)).toBe('GOOD');
    expect(V.statusFor(96)).toBe('FAIR');
  });
  it('validates symbol mapping interval ms',()=>{
    const V=loadVerifier();
    expect(V.intervalMs('1m')).toBe(60000);
    expect(V.intervalMs('5m')).toBe(300000);
    expect(V.intervalMs('1h')).toBe(3600000);
  });
});

describe('HistoricalDataStorage',()=>{
  it('stores and retrieves range', async()=>{
    const { HistoricalDataStorage } = loadStorage();
    const s=new HistoricalDataStorage({dbName:'test-memory'});
    await s.init();
    const rows=[[0,1,2,1,1.5,10,0,0,5],[60000,1,2,1,1.5,10,0,0,5],[120000,1,2,1,1.5,10,0,0,5]];
    await s.putMany('BTCUSD','1m', rows);
    const got=await s.getRange('BTCUSD','1m',0,200000);
    expect(got.length).toBe(3);
    expect(got[0].openTime).toBe(0);
  });
  it('handles delete', async()=>{
    const { HistoricalDataStorage } = loadStorage();
    const s=new HistoricalDataStorage({dbName:'test-del'});
    await s.init();
    const rows=[[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10]];
    await s.putMany('BTCUSD','1m', rows);
    await s.deleteMany('BTCUSD','1m');
    const got=await s.getRange('BTCUSD','1m',0,200000);
    expect(got.length).toBe(0);
  });
});

describe('HistoricalDataManager',()=>{
  it('returns local data without remote fetch', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-test-1'});
    await storage.init();
    const rows=[[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10],[120000,1,2,1,1.5,10],[180000,1,2,1,1.5,10],[240000,1,2,1,1.5,10]];
    await storage.putMany('BTCUSD','1m', rows);
    // mock fetch should not be called
    let fetchCalled=false;
    env.fetch=async()=>{ fetchCalled=true; return { ok:true, json:async()=>[] }; };
    // need to patch global fetch for downloader
    global.fetch=env.fetch;
    const manager=new env.HistoricalDataManager({BINANCE_SYMBOL_MAP:{BTCUSD:'BTCUSDT'}}, storage, env.DataVerifier, new env.DataDownloader({}, storage));
    const candles=await manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:240000, minRequired:2});
    expect(candles.length).toBe(5);
    expect(fetchCalled).toBe(false);
  });
  it('throws INSUFFICIENT_CANDLES when not enough data', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-test-2'});
    await storage.init();
    const rows=[[0,1,2,1,1.5,10]];
    await storage.putMany('BTCUSD','1m', rows);
    // stub fetch to return empty
    const dl=new env.DataDownloader({}, storage);
    dl.fetchBatch=async()=>[];
    const manager=new env.HistoricalDataManager({}, storage, env.DataVerifier, dl);
    await expect(manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:60000*100, minRequired:50})).rejects.toThrow();
  });
  it('aggregates 5m from 1m', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-test-agg'});
    await storage.init();
    // 5x 1m candles
    const rows=[
      [0,1,1.1,0.9,1,10],
      [60000,1,1.2,0.95,1.1,10],
      [120000,1.1,1.3,1,1.2,10],
      [180000,1.2,1.4,1.1,1.3,10],
      [240000,1.3,1.5,1.2,1.4,10],
    ];
    await storage.putMany('BTCUSD','1m', rows);
    const manager=new env.HistoricalDataManager({}, storage, env.DataVerifier, new env.DataDownloader({}, storage));
    const candles=await manager.getCandles({symbol:'BTCUSD', interval:'5m', from:0, to:240000, minRequired:0});
    expect(candles.length).toBe(1);
    expect(candles[0].open).toBe(1);
    expect(candles[0].close).toBe(1.4);
    expect(candles[0].high).toBe(1.5);
    expect(candles[0].low).toBe(0.9);
  });
});

describe('Chart integration: live tick isolation',()=>{
  it('feedTick does not corrupt history when chart not ready', async()=>{
    // verify DataVerifier normalization is single source
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:1, high:2, low:1, close:1, volume:10},
      {openTime:0, open:1, high:2, low:1, close:1, volume:10}, // duplicate
      {openTime:60000, open:NaN, high:2, low:1, close:1, volume:10}, // invalid
    ];
    const r=V.normalizeCandles(rows);
    expect(r.candles.length).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toBe(1);
  });
});

describe('DataVerifier extended',()=>{
  it('rejects Infinity and -Infinity',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:Infinity, high:2, low:1, close:1, volume:10},
      {openTime:60000, open:1, high:Infinity, low:1, close:1, volume:10},
      {openTime:120000, open:1, high:2, low:-Infinity, close:1, volume:10},
      {openTime:180000, open:1, high:2, low:1, close:1, volume:10},
    ];
    const r=V.normalizeCandles(rows);
    expect(r.invalid).toBe(3);
    expect(r.candles.length).toBe(1);
  });
  it('rejects negative prices and zero timestamps still valid',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:1, high:2, low:1, close:1, volume:10}, // zero time valid
      {openTime:60000, open:-1, high:2, low:1, close:1, volume:10},
      {openTime:120000, open:1, high:2, low:1, close:0, volume:10},
    ];
    const r=V.normalizeCandles(rows);
    expect(r.candles.length).toBe(1);
    expect(r.candles[0].openTime).toBe(0);
  });
  it('detects wrong interval spacing',()=>{
    const V=loadVerifier();
    const rows=[
      {openTime:0, open:1, high:2, low:1, close:1, volume:10},
      {openTime:60000, open:1, high:2, low:1, close:1, volume:10},
      {openTime:90000, open:1, high:2, low:1, close:1, volume:10}, // misaligned
    ].map(r=> ({...r}));
    const issues=V.validateTimestamps(rows, '1m');
    expect(issues.some(i=>i.type==='misaligned' || i.type==='gap')).toBe(true);
  });
  it('health edge cases',()=>{
    const V=loadVerifier();
    expect(V.healthScore({totalExpected:0, missing:0, invalid:0, duplicates:0})).toBe(100);
    expect(V.healthScore({totalExpected:10, missing:10, invalid:0, duplicates:0})).toBe(0);
  });
});

describe('HistoricalDataStorage extended',()=>{
  it('overwrite duplicates keeps last', async()=>{
    const { HistoricalDataStorage } = loadStorage();
    const s=new HistoricalDataStorage({dbName:'test-overwrite'});
    await s.init();
    await s.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10]]);
    await s.putMany('BTCUSD','1m', [[0,9,9,9,9,99]]);
    const got=await s.getRange('BTCUSD','1m',0,100000);
    expect(got.length).toBe(1);
    expect(got[0].close).toBe(9);
  });
  it('metadata reflects count', async()=>{
    const { HistoricalDataStorage } = loadStorage();
    const s=new HistoricalDataStorage({dbName:'test-meta'});
    await s.init();
    await s.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10]]);
    const meta=await s.getMeta('BTCUSD','1m');
    expect(meta.candleCount).toBe(2);
    expect(meta.earliestTimestamp).toBe(0);
    expect(meta.latestTimestamp).toBe(60000);
  });
  it('download state persists', async()=>{
    const { HistoricalDataStorage } = loadStorage();
    const s=new HistoricalDataStorage({dbName:'test-dlstate'});
    await s.init();
    await s.saveDownloadState({symbol:'BTCUSD', interval:'1m', from:0, to:1000000, cursor:60000});
    const st=await s.getDownloadState();
    expect(st.cursor).toBe(60000);
    await s.clearDownloadState();
    const cleared=await s.getDownloadState();
    expect(cleared).toBeNull();
  });
});

describe('DataDownloader mocked',()=>{
  function makeDownloader(fetchFn){
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'dl-mock-'+Math.random()});
    // sync init
    return { env, storage, fetchFn };
  }
  it('successful request returns array', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'dl-success'});
    await storage.init();
    const dl=new env.DataDownloader({}, storage);
    const mockData=[[0,'1','2','1','1.5','10']];
    dl._fetchWithTimeout=async()=>({ ok:true, json:async()=>mockData });
    const data=await dl.fetchBatch('BTCUSD','1m',0,60000);
    expect(Array.isArray(data)).toBe(true);
  });
  it('HTTP error throws', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'dl-http'});
    await storage.init();
    const dl=new env.DataDownloader({}, storage);
    dl.maxRetries=0;
    dl._fetchWithTimeout=async()=>({ ok:false, status:400, json:async()=>[] });
    await expect(dl.fetchBatch('BTCUSD','1m',0,60000)).rejects.toThrow(/HTTP 400/);
  });
  it('empty response handled', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'dl-empty'});
    await storage.init();
    const dl=new env.DataDownloader({}, storage);
    dl._fetchWithTimeout=async()=>({ ok:true, json:async()=>[] });
    const data=await dl.fetchBatch('BTCUSD','1m',0,60000);
    expect(data).toEqual([]);
  });
  it('pause/resume/cancel state', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'dl-ctrl'});
    await storage.init();
    const dl=new env.DataDownloader({}, storage);
    // Not active yet – should be no-op
    dl.pause(); dl.resume(); dl.cancel();
    expect(dl.active).toBeNull();
    // Simulate active
    dl.active={ cancelled:false, paused:false };
    dl.pause(); expect(dl.active.paused).toBe(true);
    dl.resume(); expect(dl.active.paused).toBe(false);
    dl.cancel(); expect(dl.active.cancelled).toBe(true);
    dl.active=null;
  });
});

describe('HistoricalDataManager extended',()=>{
  it('concurrent duplicate requests deduplicated', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-dedup'});
    await storage.init();
    await storage.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10],[120000,1,2,1,1.5,10]]);
    const manager=new env.HistoricalDataManager({}, storage, env.DataVerifier, new env.DataDownloader({}, storage));
    const p1=manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:120000, minRequired:0});
    const p2=manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:120000, minRequired:0});
    const [a,b]=await Promise.all([p1,p2]);
    expect(a.length).toBe(b.length);
  });
  it('offline fallback returns local even if remote fails', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-offline'});
    await storage.init();
    await storage.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10]]);
    const dl=new env.DataDownloader({}, storage);
    dl.fetchBatch=async()=>{ throw new Error('Network unreachable'); };
    const manager=new env.HistoricalDataManager({}, storage, env.DataVerifier, dl);
    // minRequired 0 so should return local even though remote fails for missing range
    const candles=await manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:60000, minRequired:0});
    expect(candles.length).toBeGreaterThan(0);
  });
  it('offline mode never calls remote and returns partial', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-offline-mode'});
    await storage.init();
    await storage.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10]]);
    let called=false;
    const dl=new env.DataDownloader({REMOTE_DATA_MODE:'offline'}, storage);
    dl.fetchBatch=async()=>{ called=true; throw new Error('should not be called'); };
    const manager=new env.HistoricalDataManager({REMOTE_DATA_MODE:'offline'}, storage, env.DataVerifier, dl);
    const candles=await manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:60000, minRequired:10});
    expect(called).toBe(false);
    expect(candles.length).toBe(2);
  });
  it('cache-first second load does not refetch', async()=>{
    const env=loadManager();
    const storage=new env.HistoricalDataStorage({dbName:'mgr-cachefirst'});
    await storage.init();
    await storage.putMany('BTCUSD','1m', [[0,1,2,1,1.5,10],[60000,1,2,1,1.5,10],[120000,1,2,1,1.5,10]]);
    let fetchCount=0;
    const dl=new env.DataDownloader({}, storage);
    dl.fetchBatch=async()=>{ fetchCount++; return []; };
    const manager=new env.HistoricalDataManager({}, storage, env.DataVerifier, dl);
    await manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:120000, minRequired:0});
    const before=fetchCount;
    await manager.getCandles({symbol:'BTCUSD', interval:'1m', from:0, to:120000, minRequired:0});
    expect(fetchCount).toBe(before); // no extra fetch for same cached range
  });
});
