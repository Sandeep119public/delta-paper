/* HistoricalDataManager: centralized history orchestration. */
(function(global){
'use strict';
class HistoricalDataManager {
  constructor(config, storage, verifier, downloader, exchangeTime){
    this.config=config||{};
    this.storage=storage;
    this.verifier=verifier||global.DataVerifier;
    this.downloader=downloader||new global.DataDownloader(config, storage);
    this.exchangeTime=exchangeTime|| (global.ExchangeTime? new global.ExchangeTime(config): null);
    this.baseInterval='1m';
    this.baseMs=60000;
    this.maxRetries=3;
    this.baseDelay=500;
    this._pending=new Map(); // dedup concurrent getCandles
    this.diagnostics={ lastRemoteFetch:null, lastError:null, lastRequest:null, timeSync: null };
    this.symbolMap=config.BINANCE_SYMBOL_MAP||{BTCUSD:'BTCUSDT',ETHUSD:'ETHUSDT',SOLUSD:'SOLUSDT'};
  }
  intervalMs(i){ return this.verifier.intervalMs(i); }
  _clampToCompleted(from,to,interval){
    if(!this.exchangeTime) return {from,to, truncated:false};
    try{
      const r=this.exchangeTime.clampRangeToCompleted(from,to,interval);
      return r;
    }catch(e){ return {from,to, truncated:false}; }
  }
  estimateCandles(from,to,interval){
    const ms=this.intervalMs(interval);
    return Math.max(0, Math.floor((to-from)/ms)+1);
  }
  async getStorageEstimate(){ return this.storage.getStorageEstimate(); }

  // Normalize once: delegates to verifier
  normalize(rows){ return this.verifier.normalizeCandles(rows); }

  aggregate(rows, interval){
    const ms=this.intervalMs(interval);
    const out=new Map();
    for(const r of rows){
      const t=Math.floor(r.openTime/ms)*ms;
      const x=out.get(t);
      if(!x) out.set(t,{ symbol:r.symbol, interval, openTime:t, open:r.open, high:r.high, low:r.low, close:r.close, volume:r.volume, trades:r.trades||0 });
      else { x.high=Math.max(x.high,r.high); x.low=Math.min(x.low,r.low); x.close=r.close; x.volume+=r.volume; x.trades+=(r.trades||0); }
    }
    return [...out.values()].sort((a,b)=>a.openTime-b.openTime);
  }

  async ensureBase(symbol, start, end){
    const step=this.baseMs;
    let have=await this.storage.getRange(symbol,'1m', start, end, 200000);
    const localCount=have.length;
    let gaps=this.verifier.findGaps(have, start, end, step);
    let remoteReceived=0, validAfter=0;
    let error=null;
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(!gaps.length){
      const norm=this.verifier.normalizeCandles(have.map(r=>({...r,symbol,interval:'1m'})));
      have=norm.candles;
      this.diagnostics.lastRemoteFetch={ localCandles:localCount, remoteCandles:0, validCandles:have.length, gaps:[], error:null };
      return have;
    }
    // Offline mode: never fetch, return local immediately (cache-first)
    if(mode==='offline'){
      const norm=this.verifier.normalizeCandles(have.map(r=>({...r,symbol,interval:'1m'})));
      have=norm.candles;
      error='Offline mode: This historical range has not been downloaded.';
      this.diagnostics.lastRemoteFetch={ localCandles:localCount, remoteCandles:0, validCandles:have.length, gaps, error };
      this.diagnostics.lastError=error;
      return have;
    }
    for(const [from,to] of gaps){
      let cursor=Math.max(0,from);
      let safety=0;
      while(cursor<=to && safety++<2000){
        if(this.downloader.active && this.downloader.active.cancelled) break;
        let batch;
        try{
          batch=await this.downloader.fetchBatch(symbol,'1m', cursor, Math.min(to, cursor+1000*step-1 + step-1));
          this.diagnostics.lastRemoteFetch={ at:Date.now(), endpoint:`${symbol} 1m ${new Date(cursor).toISOString()}` , count: batch.length };
        }catch(e){
          error=e.message;
          this.diagnostics.lastError=error;
          break;
        }
        if(!Array.isArray(batch)||!batch.length) break;
        remoteReceived+=batch.length;
        const saved=await this.storage.putMany(symbol,'1m', batch);
        validAfter+=saved;
        const last=Number(batch[batch.length-1][0]);
        if(!Number.isFinite(last)||last<cursor) break;
        cursor=last+step;
        if(batch.length<1000) break;
        await new Promise(r=>setTimeout(r,120));
      }
      if(error) break;
    }
    have=await this.storage.getRange(symbol,'1m', start, end, 200000);
    const norm=this.verifier.normalizeCandles(have.map(r=>({...r,symbol,interval:'1m'})));
    have=norm.candles;
    this.diagnostics.lastRemoteFetch={ localCandles:localCount, remoteCandles:remoteReceived, validCandles:have.length, gaps, error };
    // Graceful fallback: if we have some local data, return it even when remote failed
    if(error){
      if(have.length>=10) return have;
      throw new Error(error);
    }
    return have;
  }

  async gapRepair(symbol, interval, start, end){
    // Only repair 1m gaps; higher TF aggregated from 1m
    if(interval!=='1m'){
      await this.ensureBase(symbol, Math.floor(start/this.baseMs)*this.baseMs, end);
      return;
    }
    await this.ensureBase(symbol, start, end);
  }

  async getCandles({symbol, interval='1m', from, to, minRequired=100}){
    const key=`${symbol}|${interval}|${from}|${to}`;
    if(this._pending.has(key)) return this._pending.get(key);
    const p=this._getCandlesInternal({symbol, interval, from, to, minRequired});
    this._pending.set(key,p);
    try{ return await p; } finally { this._pending.delete(key); }
  }

  async _getCandlesInternal({symbol, interval, from, to, minRequired}){
    let start=Number(from), end=Number(to);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end) throw new Error('Invalid range: from/to must be valid timestamps with from < to');
    if(!symbol) throw new Error('Symbol required');
    // Clamp to latest completed candle to avoid future-range false gaps
    const clamped=this._clampToCompleted(start,end,interval);
    if(clamped.truncated){
      end=clamped.to;
      if(start>=end) throw new Error('Range is in the future: latest completed candle is '+new Date(end).toISOString());
    } else { start=clamped.from; end=clamped.to; }
    this.diagnostics.lastRequest={ symbol, interval, from:start, to:end, at:Date.now() };
    this.diagnostics.lastError=null;
    if(this.exchangeTime) this.diagnostics.timeSync=this.exchangeTime.getSource();
    let retries=0;
    while(retries<=this.maxRetries){
      try{
        if(interval==='1m'){
          const rows=await this.ensureBase(symbol, start, end);
          const filtered=rows.filter(c=>c.openTime>=start && c.openTime<=end).sort((a,b)=>a.openTime-b.openTime);
          const mode=this.config.REMOTE_DATA_MODE||'direct';
          if(filtered.length < minRequired){
            if(mode==='offline' && filtered.length>0){
              this._touchAccess(symbol, interval);
              return filtered;
            }
            if(this.diagnostics.lastRemoteFetch?.error && filtered.length>0 && filtered.length>=Math.min(20, minRequired)){
              this._touchAccess(symbol, interval);
              return filtered;
            }
            const reason=`Insufficient candles: have ${filtered.length}, need ${minRequired}. Range ${new Date(start).toISOString()}..${new Date(end).toISOString()}. ` + (this.diagnostics.lastRemoteFetch?.error? 'Remote error: '+this.diagnostics.lastRemoteFetch.error : 'Try extending range or downloading more history.');
            const err=new Error(reason);
            err.code='INSUFFICIENT_CANDLES';
            err.details={ localCandles: filtered.length, remoteCandles: this.diagnostics.lastRemoteFetch?.remoteCandles||0, validCandles: filtered.length, required: minRequired, gaps: this.diagnostics.lastRemoteFetch?.gaps||[] };
            throw err;
          }
          this._touchAccess(symbol, interval);
          return filtered;
        } else {
          const baseStart=Math.floor(start/this.baseMs)*this.baseMs;
          const base=await this.ensureBase(symbol, baseStart, end);
          const agg=this.aggregate(base, interval).filter(c=>c.openTime>=start && c.openTime<=end);
          if(agg.length < Math.min(minRequired, Math.ceil((end-start)/this.intervalMs(interval)))){
            if(agg.length===0){
              const err=new Error(`No candles after aggregation for ${interval}. Base had ${base.length} 1m candles.`);
              err.code='AGG_EMPTY';
              throw err;
            }
          }
          this._touchAccess(symbol, interval);
          return agg;
        }
      }catch(e){
        this.diagnostics.lastError=e.message;
        if(e.code==='INSUFFICIENT_CANDLES' || e.code==='AGG_EMPTY'){
          if(retries===this.maxRetries) throw e;
          // exponential backoff before retry (maybe gap repair will fill)
          await new Promise(r=>setTimeout(r, this.baseDelay*Math.pow(2,retries)));
          retries++;
          continue;
        }
        // Network errors: retry with backoff
        if(retries < this.maxRetries && /Binance|fetch|network|HTTP/i.test(e.message)){
          await new Promise(r=>setTimeout(r, this.baseDelay*Math.pow(2,retries)));
          retries++;
          continue;
        }
        throw e;
      }
    }
  }

  // Public helpers for UI
  async getDiagnostics(symbol, interval){
    const meta=await this.storage.getMeta(symbol, interval);
    const range= meta? { earliest: meta.earliestTimestamp, latest: meta.latestTimestamp }: {earliest:null, latest:null};
    const diag={
      symbol, interval,
      local: meta? { count: meta.candleCount, earliest: range.earliest, latest: range.latest, health: meta.healthScore, status: meta.status, missing: meta.missingCandleCount }: {count:0, earliest:null, latest:null, health:0, status:'EMPTY', missing:0},
      remote: this.diagnostics.lastRemoteFetch||null,
      lastError: this.diagnostics.lastError,
      lastRequest: this.diagnostics.lastRequest,
      chart: { minRequired:100 }
    };
    return diag;
  }

  _touchAccess(symbol, interval){
    if(!this._lastTouch) this._lastTouch=new Map();
    const key=symbol+'|'+interval;
    const now=Date.now();
    if(this._lastTouch.get(key) && now - this._lastTouch.get(key) < 30000) return;
    this._lastTouch.set(key, now);
    // debounce meta write
    if(this._touchTimer) clearTimeout(this._touchTimer);
    this._touchTimer=setTimeout(async()=>{
      try{
        const meta=await this.storage.getMeta(symbol, interval);
        if(meta){
          meta.lastAccessed=now;
          if(this.storage.db){
            await new Promise(res=>{ const tx=this.storage.db.transaction('meta','readwrite'); tx.objectStore('meta').put(meta); tx.oncomplete=res; tx.onerror=res; });
          }
          this.storage.metaMemory.set(this.storage.metaKey(symbol,interval), meta);
        }
      }catch(e){}
    }, 2000);
  }
  async verify(symbol, interval){
    const rows=await this.storage.getRange(symbol, interval||'1m', 0, Date.now(), 500000);
    const norm=this.verifier.normalizeCandles(rows.map(r=>({...r})));
    const step=this.verifier.intervalMs(interval||'1m');
    const gaps= rows.length? this.verifier.findGaps(norm.candles, norm.candles[0].openTime, norm.candles[norm.candles.length-1].openTime, step):[];
    const missing=gaps.reduce((a,[s,e])=>a+Math.round((e-s)/step)+1,0);
    const health=this.verifier.healthScore({ totalExpected: norm.candles.length+missing, missing, invalid:norm.invalid, duplicates:norm.duplicates });
    return { total:norm.candles.length, invalid:norm.invalid, duplicates:norm.duplicates, missing, gaps, health, status:this.verifier.statusFor(health) };
  }

  async repair(symbol, interval){
    const v=await this.verify(symbol, interval);
    if(!v.gaps.length && v.invalid===0 && v.duplicates===0) return v;
    // For missing, fetch each gap
    for(const [from,to] of v.gaps){
      try{ await this.downloader.downloadRange({symbol, interval, from, to}); }catch(e){ if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Manager] repair gap failed',e); }
    }
    return this.verify(symbol, interval);
  }

  async deleteRange(symbol, interval){
    await this.storage.deleteMany(symbol, interval);
  }

  async estimateDownload(from,to,interval){
    const n=this.estimateCandles(from,to,interval);
    const size=this.storage.estimateDownloadSize(n);
    const est=await this.getStorageEstimate();
    const available=est.supported? Math.max(0, est.quota - est.usage): Infinity;
    return { candles:n, estimatedBytes:size, availableBytes:available, enough: size < available, estimate:est };
  }
  async downloadRange(opts){
    // Pre-flight quota check
    const est=await this.estimateDownload(opts.from, opts.to, opts.interval||'1m');
    if(!est.enough && est.estimate.supported){
      const err=new Error(`Estimated download ${Math.round(est.estimatedBytes/1048576)} MB exceeds available ${Math.round(est.availableBytes/1048576)} MB. Free storage and try again.`);
      err.code='QUOTA_WARNING'; err.estimate=est;
      throw err;
    }
    // Warn thresholds
    if(est.estimate.supported){
      if(est.estimate.percentage>=90) DELTA_LOGGER.warn('[Storage] CRITICAL 90%');
      else if(est.estimate.percentage>=75) DELTA_LOGGER.warn('[Storage] WARNING 75%');
    }
    try{
      return await this.downloader.downloadRange(opts);
    }catch(e){
      if(e && e.code==='QUOTA_EXCEEDED'){
        // preserve cursor already saved by downloader
        throw new Error('Storage full: quota exceeded. Downloaded data is safe. Manage storage and resume. Details: '+e.message);
      }
      throw e;
    }
  }
  pauseDownload(){ this.downloader.pause(); }
  resumeDownload(){ this.downloader.resume(); }
  cancelDownload(){ this.downloader.cancel(); }
}

global.HistoricalDataManager=HistoricalDataManager;
if(typeof module!=='undefined'&&module.exports) module.exports=HistoricalDataManager;
})(typeof window!=='undefined'?window:globalThis);
