/* DataDownloader: batched provider fetch with backoff, timeout, proxy fallback, rate-limit. */
(function(global){
'use strict';
const DEFAULT_BATCH=1000;
class DataDownloader {
  constructor(config, storage, provider){
    this.config=config||{};
    this.storage=storage;
    this.provider=provider || (global.BinanceDataProvider? new global.BinanceDataProvider(config) : null);
    this.binanceBase=(config.BINANCE_KLINES_BASE||'https://fapi.binance.com/fapi/v1/klines').replace(/\/$/,'');
    this.symbolMap=config.BINANCE_SYMBOL_MAP||{BTCUSD:'BTCUSDT',ETHUSD:'ETHUSDT',SOLUSD:'SOLUSDT'};
    this.maxRetries=3;
    this.baseDelay=600;
    this.timeoutMs=12000;
    this.active=null; // {cancelled, paused, controller}
  }
  binanceSymbol(s){ return this.symbolMap[s]||s; }
  intervalMs(i){
    if(global.DataVerifier) return global.DataVerifier.intervalMs(i);
    const m=String(i).match(/^(\d+)([mhdw])$/i); if(!m) return 60000;
    const n=+m[1],u=m[2].toLowerCase(); return n*(u==='m'?6e4:u==='h'?36e5:u==='d'?864e5:6048e5);
  }

  async _fetchWithTimeout(url, signal){
    const controller=new AbortController();
    const id=setTimeout(()=>controller.abort(), this.timeoutMs);
    if(signal) signal.addEventListener('abort', ()=>controller.abort(), {once:true});
    if(this.active) this.active.controller=controller;
    try{
      const r=await fetch(url, { signal: controller.signal });
      return r;
    } finally {
      clearTimeout(id);
      if(this.active && this.active.controller===controller) this.active.controller=null;
    }
  }

  async fetchBatch(symbol, interval, start, end, limit=DEFAULT_BATCH){
    // Use provider abstraction if available
    if(this.provider && this.provider.getCandles){
      let lastErr;
      for(let attempt=0; attempt<=this.maxRetries; attempt++){
        if(this.active && this.active.cancelled) throw new Error('Download cancelled');
        while(this.active && this.active.paused){ await new Promise(r=>setTimeout(r,300)); if(this.active.cancelled) throw new Error('Download cancelled'); }
        try{
          const ac=new AbortController();
          if(this.active) this.active.controller=ac;
          const timer=setTimeout(()=>ac.abort(), this.timeoutMs);
          try{
            const data=await this.provider.getCandles({symbol, interval, startTime:start, endTime:end, signal: ac.signal});
            clearTimeout(timer);
            if(!Array.isArray(data)) throw new Error('Invalid provider response');
            return data;
          }finally{ clearTimeout(timer); if(this.active && this.active.controller===ac) this.active.controller=null; }
        }catch(e){
          lastErr=e;
          if(e.message && /Offline mode/i.test(e.message)) throw e;
          if(attempt===this.maxRetries) break;
          if(e.message && /HTTP 4[0-9][0-9]/.test(e.message) && !/429/.test(e.message)) throw e;
          const delay=this.baseDelay * Math.pow(2, attempt) + Math.random()*200;
          await new Promise(r=>setTimeout(r, delay));
        }
      }
      if(lastErr && /Failed to fetch|NetworkError/i.test(lastErr.message)){
        throw new Error('Remote data unavailable (CORS/network blocked). Local historical data is still available. Try configuring a proxy or use previously downloaded data. Details: '+lastErr.message);
      }
      throw lastErr;
    }
    // Fallback direct (legacy)
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') throw new Error('Offline mode: remote fetch disabled. This historical range has not been downloaded.');
    const buildUrl=(s,i,a,b,l)=> {
      const binSym=this.binanceSymbol(s);
      const useI=i==='1m'? '1m': i;
      return `${this.binanceBase}?symbol=${encodeURIComponent(binSym)}&interval=${encodeURIComponent(useI)}&startTime=${Math.floor(a)}&endTime=${Math.floor(b)}&limit=${Math.min(1000,l)}`;
    };
    const rawUrl=buildUrl(symbol, interval, start, end, limit);
    let lastErr;
    for(let attempt=0; attempt<=this.maxRetries; attempt++){
      if(this.active && this.active.cancelled) throw new Error('Download cancelled');
      while(this.active && this.active.paused){ await new Promise(r=>setTimeout(r,300)); if(this.active.cancelled) throw new Error('Download cancelled'); }
      try{
        const r=await this._fetchWithTimeout(rawUrl);
        if(!r.ok) throw new Error('Provider HTTP '+r.status);
        const data=await r.json();
        if(!Array.isArray(data)) throw new Error('Invalid provider response');
        return data;
      }catch(e){
        lastErr=e;
        if(attempt===this.maxRetries) break;
        const delay=this.baseDelay * Math.pow(2, attempt) + Math.random()*200;
        await new Promise(r=>setTimeout(r, delay));
      }
    }
    throw lastErr;
  }

  async downloadRange({symbol, interval='1m', from, to, onProgress}){
    if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to) throw new Error('Invalid range');
    const step=this.intervalMs(interval);
    const totalExpected=Math.max(1, Math.round((to-from)/step)+1);
    let downloaded=0;
    let cursor=Math.floor(from/step)*step;
    const alignedTo=Math.floor(to/step)*step;
    this.active={ cancelled:false, paused:false, controller:null, symbol, interval, from, to, cursor };
    if(this.storage) await this.storage.saveDownloadState({symbol, interval, from, to, cursor, totalExpected, startedAt:Date.now()});
    try{
      while(cursor<=alignedTo){
        if(this.active.cancelled) throw new Error('Download cancelled');
        while(this.active.paused){ await new Promise(r=>setTimeout(r,300)); }
        const batchEnd=Math.min(alignedTo, cursor + (DEFAULT_BATCH-1)*step);
        let batch;
        try{
          batch=await this.fetchBatch(symbol, interval, cursor, batchEnd + step -1);
        }catch(e){
          if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Downloader] batch failed', e);
          throw new Error('Provider fetch failed at '+ new Date(cursor).toISOString() + ': ' + e.message);
        }
        if(!batch.length){
          cursor = batchEnd + step;
          if(this.storage) await this.storage.saveDownloadState({symbol, interval, from, to, cursor, totalExpected, downloaded});
          await new Promise(r=>setTimeout(r, 180));
          continue;
        }
        if(this.storage){
          try{ await this.storage.safePutMany(symbol, interval, batch); }
          catch(e){
            if(e && e.code==='QUOTA_EXCEEDED'){
              // preserve cursor
              if(this.storage) await this.storage.saveDownloadState({symbol, interval, from, to, cursor, totalExpected, downloaded, error:'QUOTA_EXCEEDED'});
              throw e;
            }
            throw e;
          }
        }
        const lastTime=Number(batch[batch.length-1][0]);
        downloaded += batch.length;
        cursor = Number.isFinite(lastTime) ? lastTime + step : batchEnd + step;
        if(this.storage) await this.storage.saveDownloadState({symbol, interval, from, to, cursor, totalExpected, downloaded});
        if(onProgress) onProgress({ downloaded, totalExpected, percent: Math.min(99, Math.round(downloaded/totalExpected*100)), cursor, batchSize: batch.length });
        await new Promise(r=>setTimeout(r, 180));
        if(cursor>alignedTo) break;
      }
      if(this.storage) await this.storage.clearDownloadState();
      if(onProgress) onProgress({ downloaded, totalExpected, percent:100, cursor, done:true });
      return { downloaded, totalExpected };
    } finally {
      // abort any in-flight fetch
      if(this.active && this.active.controller) try{ this.active.controller.abort(); }catch(e){}
      this.active=null;
    }
  }

  pause(){ if(this.active) this.active.paused=true; }
  resume(){ if(this.active) this.active.paused=false; }
  cancel(){
    if(this.active){
      this.active.cancelled=true;
      if(this.active.controller) try{ this.active.controller.abort(); }catch(e){}
    }
    if(this.storage) this.storage.clearDownloadState();
  }
  async resumeInterrupted(onProgress){
    if(!this.storage) return null;
    const state=await this.storage.getDownloadState();
    if(!state||state.cursor==null) return null;
    return this.downloadRange({ symbol:state.symbol, interval:state.interval, from:state.cursor, to:state.to, onProgress });
  }
}
global.DataDownloader=DataDownloader;
if(typeof module!=='undefined'&&module.exports) module.exports=DataDownloader;
})(typeof window!=='undefined'?window:globalThis);
