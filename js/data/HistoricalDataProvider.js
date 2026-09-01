/* HistoricalDataProvider abstraction */
(function(global){
'use strict';
class HistoricalDataProvider {
  async getCandles({symbol, interval, startTime, endTime, signal}){ throw new Error('Not implemented'); }
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
    if(mode==='direct') return [url];
    if(mode==='production'){
      if(!this.config.DATA_API_BASE) throw new Error('Production mode misconfigured: DATA_API_BASE is not set');
      // production provider owns URL – caller should use DATA_API_BASE directly, not binance
      return [url]; // will be overridden by production branch below
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
      // combine external signal with timeout
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
global.HistoricalDataProvider=HistoricalDataProvider;
global.BinanceDataProvider=BinanceDataProvider;
})(typeof window!=='undefined'?window:globalThis);
