/* HistoricalDataStorage: IndexedDB per-candle store with metadata tracking. */
(function(global){
'use strict';

class HistoricalDataStorage {
  constructor(options={}){
    this.dbName=options.dbName||'delta-paper-market-data';
    this.version=2;
    this.db=null;
    this.memory=new Map();
    this.maxMemory=options.maxMemory||50000;
    this.metaMemory=new Map(); // key: symbol|interval
  }
  metaKey(symbol,interval){ return `${symbol}|${interval}`; }
  key(c){ return `${c.symbol}|${c.interval}|${c.openTime}`; }

  async init(){
    if(typeof indexedDB==='undefined' || !('indexedDB' in global)) { this.db=null; return; }
    this.db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(this.dbName,this.version);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('candles')){
          const s=db.createObjectStore('candles',{keyPath:['symbol','interval','openTime']});
          s.createIndex('range',['symbol','interval','openTime']);
        } else {
          const s=req.transaction.objectStore('candles');
          if(!s.indexNames.contains('range')) s.createIndex('range',['symbol','interval','openTime']);
        }
        if(!db.objectStoreNames.contains('meta')){
          db.createObjectStore('meta',{keyPath:['symbol','interval']});
        }
        if(!db.objectStoreNames.contains('downloads')){
          db.createObjectStore('downloads',{keyPath:'id'});
        }
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
      req.onblocked=()=>resolve(req.result);
    }).catch(()=>null);
  }

  normalize(symbol,interval,row){
    if(!row) return null;
    let c;
    if(Array.isArray(row)){
      c={ openTime:+row[0], open:+row[1], high:+row[2], low:+row[3], close:+row[4], volume:+row[5], closeTime:+(row[6]||0), trades:+(row[8]||0) };
    } else {
      const ot= row.openTime!=null? +row.openTime : row.time!=null? (row.time>1e11? +row.time : +row.time*1000) : NaN;
      c={ openTime:ot, open:+row.open, high:+row.high, low:+row.low, close:+row.close, volume:+(row.volume??0), closeTime:+(row.closeTime??0), trades:+(row.trades??0) };
    }
    if(!Number.isFinite(c.openTime)||![c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0)) return null;
    if(c.volume<0||!Number.isFinite(c.volume)) return null;
    return { symbol, interval, ...c, updatedAt:Date.now() };
  }

  async putMany(symbol,interval,rows){
    const verifier=global.DataVerifier;
    const raw=rows.map(r=>this.normalize(symbol,interval,r)).filter(Boolean);
    // dedup via verifier
    const norm= verifier? verifier.normalizeCandles(raw.map(r=>({...r,symbol,interval}))) : {candles:raw};
    const cs=norm.candles||raw;
    cs.forEach(c=>{ c.symbol=symbol; c.interval=interval; this.memory.set(this.key(c),c); if(this.memory.size>this.maxMemory) this.memory.delete(this.memory.keys().next().value); });
    if(!this.db||!cs.length) { await this._updateMeta(symbol,interval); return cs.length; }
    await new Promise((resolve,reject)=>{
      const tx=this.db.transaction('candles','readwrite');
      const s=tx.objectStore('candles');
      cs.forEach(c=>s.put(c));
      tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    }).catch(e=>{ if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Storage] putMany failed',e); });
    await this._updateMeta(symbol,interval);
    return cs.length;
  }

  async deleteMany(symbol,interval){
    this.memory.forEach((v,k)=>{ if(v.symbol===symbol&&v.interval===interval) this.memory.delete(k); });
    if(!this.db) { this.metaMemory.delete(this.metaKey(symbol,interval)); return; }
    await new Promise(resolve=>{
      const tx=this.db.transaction('candles','readwrite');
      const store=tx.objectStore('candles');
      const idx=store.index('range');
      const range=IDBKeyRange.bound([symbol,interval,0],[symbol,interval,Number.MAX_SAFE_INTEGER]);
      const req=idx.openCursor(range);
      req.onsuccess=()=>{ const cur=req.result; if(cur){ cur.delete(); cur.continue(); } else resolve(); };
      req.onerror=resolve;
    });
    this.metaMemory.delete(this.metaKey(symbol,interval));
    if(this.db){
      await new Promise(res=>{ const tx=this.db.transaction('meta','readwrite'); tx.objectStore('meta').delete([symbol,interval]); tx.oncomplete=res; tx.onerror=res; });
    }
  }

  async getRange(symbol,interval,start,end,limit=100000){
    const map=new Map();
    for(const c of this.memory.values()) if(c.symbol===symbol&&c.interval===interval&&c.openTime>=start&&c.openTime<=end) map.set(this.key(c),c);
    if(this.db){
      await new Promise(resolve=>{
        try{
          const tx=this.db.transaction('candles','readonly');
          const idx=tx.objectStore('candles').index('range');
          const req=idx.openCursor(IDBKeyRange.bound([symbol,interval,start],[symbol,interval,end]));
          req.onsuccess=()=>{ const cur=req.result; if(cur){ map.set(this.key(cur.value),cur.value); cur.continue(); } else resolve(); };
          req.onerror=resolve;
        }catch(e){ resolve(); }
      });
    }
    const sorted=[...map.values()].sort((a,b)=>a.openTime-b.openTime);
    if(sorted.length>limit) return sorted.slice(-limit);
    return sorted;
  }

  async getMeta(symbol,interval){
    const k=this.metaKey(symbol,interval);
    if(this.metaMemory.has(k)) return this.metaMemory.get(k);
    if(!this.db) return null;
    let meta=await new Promise(resolve=>{
      try{
        const tx=this.db.transaction('meta','readonly');
        const req=tx.objectStore('meta').get([symbol,interval]);
        req.onsuccess=()=>resolve(req.result||null); req.onerror=()=>resolve(null);
      }catch(e){ resolve(null); }
    });
    if(meta){ this.metaMemory.set(k,meta); return meta; }
    // Recover from actual candles if meta missing/corrupted
    const rows=await this.getRange(symbol,interval,0,Date.now()+86400000, 1000000);
    if(rows.length){
      return this._updateMeta(symbol,interval);
    }
    return null;
  }

  async _updateMeta(symbol,interval){
    const verifier=global.DataVerifier;
    const rows=await this.getRange(symbol,interval,0,Date.now()+86400000,1000000);
    // Preserve existing lastAccessed if present
    const existing=this.metaMemory.get(this.metaKey(symbol,interval));
    if(!rows.length){
      const meta={ symbol, interval, earliestTimestamp:null, latestTimestamp:null, candleCount:0, lastVerified:Date.now(), lastAccessed: existing? existing.lastAccessed: null, healthScore:0, missingCandleCount:0, invalidCandleCount:0, duplicateCount:0, status:'EMPTY' };
      this.metaMemory.set(this.metaKey(symbol,interval),meta);
      if(this.db) await new Promise(res=>{ const tx=this.db.transaction('meta','readwrite'); tx.objectStore('meta').put(meta); tx.oncomplete=res; tx.onerror=res; });
      return meta;
    }
    const step= verifier? verifier.intervalMs(interval):60000;
    const gaps= verifier? verifier.findGaps(rows, rows[0].openTime, rows[rows.length-1].openTime, step):[];
    let missing=0; gaps.forEach(([a,b])=> missing += Math.round((b-a)/step)+1 );
    const invalid=0;
    const totalExpected=Math.round((rows[rows.length-1].openTime - rows[0].openTime)/step)+1;
    const score= verifier? verifier.healthScore({totalExpected, missing, invalid, duplicates:0}) : 100;
    const meta={ symbol, interval, earliestTimestamp:rows[0].openTime, latestTimestamp:rows[rows.length-1].openTime, candleCount:rows.length, lastVerified:Date.now(), lastAccessed: existing? existing.lastAccessed: null, healthScore:score, missingCandleCount:missing, invalidCandleCount:invalid, duplicateCount:0, status: verifier? verifier.statusFor(score):'GOOD' };
    this.metaMemory.set(this.metaKey(symbol,interval),meta);
    if(this.db) await new Promise(res=>{ const tx=this.db.transaction('meta','readwrite'); tx.objectStore('meta').put(meta); tx.oncomplete=res; tx.onerror=res; });
    return meta;
  }

  intervalMs(interval){
    if(global.DataVerifier) return global.DataVerifier.intervalMs(interval);
    const m=String(interval).match(/^(\d+)([mhdw])$/i); if(!m) return 60000;
    const n=+m[1],u=m[2].toLowerCase(); return n*(u==='m'?60000:u==='h'?3600000:u==='d'?86400000:604800000);
  }

  // Storage quota
  async getStorageEstimate(){
    if(!navigator.storage || !navigator.storage.estimate) return {supported:false};
    try{
      const est=await navigator.storage.estimate();
      const usage=Number(est.usage||0), quota=Number(est.quota||0);
      const percentage=quota? Math.round(usage/quota*100):0;
      let level='OK'; if(percentage>=90) level='CRITICAL'; else if(percentage>=75) level='WARNING';
      return {supported:true, usage, quota, percentage, level};
    }catch(e){ return {supported:false, error:e.message}; }
  }

  // Size estimation: ~120 bytes per candle (openTime, ohlcv + indexes)
  estimateDownloadSize(candleCount){ return candleCount * 120; }

  // Safe putMany with quota handling
  async safePutMany(symbol,interval,rows){
    try{
      return await this.putMany(symbol,interval,rows);
    }catch(e){
      if(e && (e.name==='QuotaExceededError' || /QuotaExceeded/i.test(e.message||''))){
        const est=await this.getStorageEstimate().catch(()=>({supported:false}));
        const err=new Error('Storage full: quota exceeded. Downloaded data is safe. Free space and resume.');
        err.code='QUOTA_EXCEEDED'; err.estimate=est;
        throw err;
      }
      throw e;
    }
  }

  async latest(symbol,interval,limit=1000){
    const ms=this.intervalMs(interval), end=Date.now();
    return this.getRange(symbol,interval,end-ms*limit*2,end,limit);
  }

  // For download resume persistence
  async saveDownloadState(state){
    if(!this.db) { try{ localStorage.setItem('delta-paper-download', JSON.stringify(state)); }catch(e){} return; }
    await new Promise(res=>{ const tx=this.db.transaction('downloads','readwrite'); tx.objectStore('downloads').put({id:'active', ...state}); tx.oncomplete=res; tx.onerror=res; });
  }
  async getDownloadState(){
    if(!this.db){ try{ const s=localStorage.getItem('delta-paper-download'); return s?JSON.parse(s):null;}catch(e){return null;} }
    return await new Promise(res=>{ const tx=this.db.transaction('downloads','readonly'); const req=tx.objectStore('downloads').get('active'); req.onsuccess=()=>res(req.result||null); req.onerror=()=>res(null); });
  }
  async clearDownloadState(){
    if(!this.db){ try{ localStorage.removeItem('delta-paper-download'); }catch(e){} return; }
    await new Promise(res=>{ const tx=this.db.transaction('downloads','readwrite'); tx.objectStore('downloads').delete('active'); tx.oncomplete=res; tx.onerror=res; });
  }
}
global.HistoricalDataStorage=HistoricalDataStorage;
if(typeof module!=='undefined'&&module.exports) module.exports=HistoricalDataStorage;
})(typeof window!=='undefined'?window:globalThis);
