/* HistoricalDataProvider abstraction – Delta India primary, Binance fallback */
(function(global){
'use strict';
class HistoricalDataProvider {
  async getCandles({symbol, interval, startTime, endTime, signal}){ throw new Error('Not implemented'); }
}

/** Delta Exchange India — primary historical source */
class DeltaDataProvider extends HistoricalDataProvider {
  constructor(config){
    super();
    this.config=config||{};
    this.apiBase=(config.API_BASE||'https://api.india.delta.exchange').replace(/\/$/,'');
    this.timeoutMs=12000;
    // Cache product lookup (symbol -> product metadata)
    this._productCache=new Map();
    this._productCacheAt=0;
  }
  // Resolution passed to Delta: 1m, 5m, 15m, 1h, 4h, 1d (Delta uses 1m/5m/15m/60m? but 1h works)
  _deltaResolution(interval){
    // Delta accepts: 1m, 5m, 15m, 30m, 60m, 1h, 4h, 1d, 1w — normalize
    if(interval==='1h') return '1h';
    if(interval==='4h') return '4h';
    if(interval==='1d') return '1d';
    return interval;
  }
  _buildUrl(symbol, interval, startMs, endMs){
    const startSec=Math.floor(startMs/1000);
    const endSec=Math.floor(endMs/1000);
    const resolution=this._deltaResolution(interval);
    return `${this.apiBase}/v2/history/candles?symbol=${encodeURIComponent(symbol)}&resolution=${encodeURIComponent(resolution)}&start=${startSec}&end=${endSec}`;
  }
  _proxyUrls(url){
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') return [];
    const chain=this.config.PROXY_CHAIN||null;
    if(!chain || mode==='direct') return [url];
    const urls=[url];
    for(const fn of chain) try{ const u=fn(url); if(u!==url) urls.push(u);}catch(e){}
    return [...new Set(urls)];
  }
  _normalizeError(e){
    const msg=String(e.message||'');
    if(/AbortError/i.test(e.name||'')) return Object.assign(new Error('ABORTED: '+msg), {category:'ABORTED'});
    if(/Offline mode/i.test(msg)) return Object.assign(new Error(msg), {category:'OFFLINE'});
    if(/TIMEOUT|timed out/i.test(msg)) return Object.assign(new Error(msg), {category:'TIMEOUT'});
    if(/429|RATE_LIMIT/i.test(msg)) return Object.assign(new Error(msg), {category:'RATE_LIMIT'});
    if(/CORS|Failed to fetch|NetworkError/i.test(msg)) return Object.assign(new Error(msg), {category:'CORS_ERROR'});
    if(/HTTP 4/i.test(msg)) return Object.assign(new Error(msg), {category:'INVALID_RESPONSE'});
    if(/HTTP 5/i.test(msg)) return Object.assign(new Error(msg), {category:'SERVER_ERROR'});
    return Object.assign(new Error(msg), {category:'NETWORK_ERROR'});
  }
  async getCandles({symbol, interval, startTime, endTime, signal}){
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') throw this._normalizeError(new Error('Offline mode: remote fetch disabled. This historical range has not been downloaded.'));
    const rawUrl=this._buildUrl(symbol, interval, startTime, endTime);
    const urls=this._proxyUrls(rawUrl);
    if(!urls.length) throw new Error('Offline mode: no remote provider configured');
    let lastErr;
    for(const url of urls){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(), this.timeoutMs);
      if(signal){ signal.addEventListener('abort', ()=>controller.abort(), {once:true}); if(signal.aborted) controller.abort(); }
      try{
        const r=await fetch(url, {signal: controller.signal});
        if(!r.ok) throw this._normalizeError(new Error('Delta HTTP '+r.status));
        const j=await r.json();
        if(!j || j.success===false) throw this._normalizeError(new Error('Delta API error: '+(j?.error?.code||j?.message||'unknown')));
        const result=j.result || j.data || j;
        if(!Array.isArray(result)) throw this._normalizeError(new Error('Invalid Delta response'));
        // Normalize to Binance-like array rows: [openTimeMs, open, high, low, close, volume, closeTimeMs, ...]
        // Delta time is seconds; convert to ms
        const rows=result.map(c=>{
          const tMs=Number(c.time)>1e11? Number(c.time) : Number(c.time)*1000;
          return [tMs, String(c.open), String(c.high), String(c.low), String(c.close), String(c.volume ?? 0), tMs+this._intervalMs(interval)-1, '0', '0', '0', '0', '0'];
        }).filter(r=> Number.isFinite(r[0]));
        // Already sorted? Ensure ascending
        rows.sort((a,b)=>a[0]-b[0]);
        return rows;
      }catch(e){
        lastErr=this._normalizeError(e);
        if(lastErr.category==='ABORTED' && signal && signal.aborted) throw new Error('Download cancelled');
        const isNetwork=['CORS_ERROR','NETWORK_ERROR','TIMEOUT'].includes(lastErr.category);
        if(isNetwork && url!==urls[urls.length-1]) continue;
        throw lastErr;
      }finally{ clearTimeout(timeout); }
    }
    throw lastErr;
  }
  _intervalMs(interval){
    if(global.DataVerifier) return global.DataVerifier.intervalMs(interval);
    const m=String(interval).match(/^(\d+)([mhdw])$/i); if(!m) return 60000;
    const n=+m[1],u=m[2].toLowerCase(); return n*(u==='m'?6e4:u==='h'?36e5:u==='d'?864e5:6048e5);
  }
  // Optional: resolve product id for symbol (for future use, handles edge where symbol != product symbol)
  async resolveProduct(symbol){
    if(this._productCache.has(symbol) && Date.now()-this._productCacheAt < 3600000) return this._productCache.get(symbol);
    try{
      const r=await fetch(`${this.apiBase}/v2/products/${encodeURIComponent(symbol)}`);
      if(!r.ok) return null;
      const j=await r.json();
      const p=j.result || j;
      if(p && p.symbol===symbol){ this._productCache.set(symbol,p); this._productCacheAt=Date.now(); return p; }
    }catch(e){}
    return null;
  }
}

class BinanceDataProvider extends HistoricalDataProvider {
  constructor(config){
    super();
    this.config=config||{};
    this.binanceBase=(config.BINANCE_KLINES_BASE||'https://fapi.binance.com/fapi/v1/klines').replace(/\/$/,'');
    this.symbolMap=config.BINANCE_SYMBOL_MAP||{BTCUSD:'BTCUSDT',ETHUSD:'ETHUSDT',SOLUSD:'SOLUSDT'};
    this.timeoutMs=12000;
  }
  binanceSymbol(s){ return this.symbolMap[s]||s; }
  _buildUrl(symbol, interval, start, end, limit=1000){
    const binSym=this.binanceSymbol(symbol);
    const useInterval = interval==='1m'? '1m': interval;
    return `${this.binanceBase}?symbol=${encodeURIComponent(binSym)}&interval=${encodeURIComponent(useInterval)}&startTime=${Math.floor(start)}&endTime=${Math.floor(end)}&limit=${Math.min(1000,limit)}`;
  }
  _proxyUrls(url){
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') return [];
    if(mode==='production'){
      if(!this.config.DATA_API_BASE) throw new Error('Production mode misconfigured: DATA_API_BASE is not set');
      return [url];
    }
    const chain=this.config.BINANCE_PROXY_CHAIN||this.config.PROXY_CHAIN||null;
    if(mode==='proxy' && chain){
      const urls=[url];
      for(const fn of chain) try{ if(typeof fn==='function') urls.push(fn(url)); }catch(e){}
      return [...new Set(urls)];
    }
    if(mode==='custom-provider' && this.config.CUSTOM_PROVIDER_URL) return [this.config.CUSTOM_PROVIDER_URL+'?'+new URLSearchParams({symbol,interval,startTime:String(start),endTime:String(end)})];
    if(!chain) return [url];
    const urls=[url];
    for(const fn of chain) try{ if(typeof fn==='function'){ const u=fn(url); if(u!==url) urls.push(u); }}catch(e){}
    return [...new Set(urls)];
  }
  _productionUrl({symbol, interval, startTime, endTime}){
    const base=(this.config.DATA_API_BASE||'').replace(/\/$/,'');
    if(!base) throw new Error('Production mode misconfigured: DATA_API_BASE is not set');
    return `${base}/klines?symbol=${encodeURIComponent(this.binanceSymbol(symbol))}&interval=${encodeURIComponent(interval)}&startTime=${Math.floor(startTime)}&endTime=${Math.floor(endTime)}&limit=1000`;
  }
  _normalizeError(e){
    const msg=String(e.message||'');
    if(/AbortError/i.test(e.name||'')) return Object.assign(new Error('ABORTED: '+msg), {category:'ABORTED'});
    if(/Offline mode/i.test(msg)) return Object.assign(new Error(msg), {category:'OFFLINE'});
    if(/TIMEOUT|timed out/i.test(msg)) return Object.assign(new Error(msg), {category:'TIMEOUT'});
    if(/429|RATE_LIMIT/i.test(msg)) return Object.assign(new Error(msg), {category:'RATE_LIMIT'});
    if(/CORS|Failed to fetch|NetworkError/i.test(msg)) return Object.assign(new Error(msg), {category:'CORS_ERROR'});
    if(/HTTP 4/i.test(msg)) return Object.assign(new Error(msg), {category:'INVALID_RESPONSE'});
    if(/HTTP 5/i.test(msg)) return Object.assign(new Error(msg), {category:'SERVER_ERROR'});
    return Object.assign(new Error(msg), {category:'NETWORK_ERROR'});
  }
  async getCandles({symbol, interval, startTime, endTime, signal}){
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') throw this._normalizeError(new Error('Offline mode: remote fetch disabled. This historical range has not been downloaded.'));
    if(mode==='production'){
      const url=this._productionUrl({symbol, interval, startTime, endTime});
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(), this.timeoutMs);
      if(signal){ signal.addEventListener('abort', ()=>controller.abort(), {once:true}); if(signal.aborted) controller.abort(); }
      try{
        const r=await fetch(url, {signal: controller.signal});
        if(!r.ok) throw this._normalizeError(new Error('Production HTTP '+r.status));
        const data=await r.json();
        if(!Array.isArray(data)) throw this._normalizeError(new Error('Invalid production response'));
        return data;
      }catch(e){ throw this._normalizeError(e); } finally{ clearTimeout(timeout); }
    }
    const rawUrl=this._buildUrl(symbol, interval, startTime, endTime);
    const urls=this._proxyUrls(rawUrl);
    if(!urls.length) throw new Error('Offline mode: no remote provider configured');
    let lastErr;
    for(const url of urls){
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(), this.timeoutMs);
      if(signal){
        signal.addEventListener('abort', ()=>controller.abort(), {once:true});
        if(signal.aborted) controller.abort();
      }
      try{
        const r=await fetch(url, {signal: controller.signal});
        if(!r.ok) throw this._normalizeError(new Error('Binance HTTP '+r.status));
        const data=await r.json();
        if(!Array.isArray(data)) throw this._normalizeError(new Error('Invalid Binance response'));
        return data;
      }catch(e){
        lastErr=this._normalizeError(e);
        if(lastErr.category==='ABORTED' && signal && signal.aborted) throw new Error('Download cancelled');
        const isNetwork=['CORS_ERROR','NETWORK_ERROR','TIMEOUT'].includes(lastErr.category);
        if(isNetwork && url!==urls[urls.length-1]) continue;
        throw lastErr;
      }finally{ clearTimeout(timeout); }
    }
    throw lastErr;
  }
}

/** Composite: tries Delta first, falls back to Binance only if explicitly enabled */
class CompositeHistoricalProvider extends HistoricalDataProvider {
  constructor(config, deltaProvider, binanceProvider){
    super();
    this.config=config||{};
    this.delta=deltaProvider || new DeltaDataProvider(config);
    this.binance=binanceProvider || new BinanceDataProvider(config);
  }
  async getCandles(opts){
    const allowFallback = this.config.BINANCE_FALLBACK === true || this.config.REMOTE_DATA_MODE === 'delta_with_binance_fallback';
    try{
      return await this.delta.getCandles(opts);
    }catch(e){
      if(!allowFallback) throw e;
      // Never fall back for validation / malformed-request errors (4xx). Only for transient transport failures.
      // INVALID_RESPONSE (Delta HTTP 4xx / API validation) must NOT trigger Binance fallback — would silently proxy wrong-exchange data.
      const isFallbackable = e.category==='CORS_ERROR' || e.category==='NETWORK_ERROR' || e.category==='TIMEOUT' || e.category==='SERVER_ERROR' || /CORS|NETWORK|TIMEOUT|Delta HTTP 5/.test(e.message || '');
      if(!isFallbackable) throw e;
      if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Provider] Delta failed, falling back to Binance:', e.message);
      return await this.binance.getCandles(opts);
    }
  }
}

global.HistoricalDataProvider=HistoricalDataProvider;
global.DeltaDataProvider=DeltaDataProvider;
global.BinanceDataProvider=BinanceDataProvider;
global.CompositeHistoricalProvider=CompositeHistoricalProvider;
})(typeof window!=='undefined'?window:globalThis);
