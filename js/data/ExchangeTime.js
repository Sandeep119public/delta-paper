/* ExchangeTime: single authoritative time, completed-candle boundaries */
(function(global){
'use strict';
const INTERVAL_MS = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000 };
function intervalMs(iv){
  if(INTERVAL_MS[iv]) return INTERVAL_MS[iv];
  const m=String(iv).match(/^(\d+)([mhdw])$/i); if(!m) throw Error('interval '+iv);
  const n=+m[1], u=m[2].toLowerCase();
  return n*(u==='m'?6e4:u==='h'?36e5:u==='d'?864e5:6048e5);
}
class ExchangeTime {
  constructor(config){
    this.config=config||{};
    this.offset=0; // server - local
    this.source='device'; // exchange|device
    this.lastSync=0;
    this.syncInterval=5*60*1000;
  }
  async sync(){
    const mode=this.config.REMOTE_DATA_MODE||'direct';
    if(mode==='offline') { this.source='device'; return {offset:0, source:'device'}; }
    // Try Binance time endpoint; if fails keep device
    const base=(this.config.BINANCE_KLINES_BASE||'https://fapi.binance.com/fapi/v1/klines').replace(/\/klines.*$/,'').replace(/\/$/,'');
    const url= base + '/fapi/v1/time';
    try{
      const r=await fetch(url, {cache:'no-store'});
      if(!r.ok) throw new Error('time http '+r.status);
      const j=await r.json();
      const server=Number(j.serverTime);
      if(!Number.isFinite(server)) throw new Error('bad serverTime');
      this.offset=server - Date.now();
      this.source='exchange';
      this.lastSync=Date.now();
      try{ localStorage.setItem('delta-paper-time-offset', JSON.stringify({offset:this.offset, at:this.lastSync})); }catch(e){}
      return {offset:this.offset, source:'exchange'};
    }catch(e){
      // try restore cached
      try{
        const cached=JSON.parse(localStorage.getItem('delta-paper-time-offset')||'null');
        if(cached && Number.isFinite(cached.offset) && Date.now()-cached.at < 24*3600000){
          this.offset=cached.offset; this.source='exchange'; return {offset:this.offset, source:'exchange', stale:true};
        }
      }catch(_){}
      this.source='device'; this.offset=0;
      return {offset:0, source:'device', error:e.message};
    }
  }
  async ensureSync(){
    if(Date.now()-this.lastSync > this.syncInterval) await this.sync();
  }
  getAdjustedNow(){ return Date.now() + this.offset; }
  getTimeOffset(){ return this.offset; }
  getSource(){ return this.source; }
  alignToInterval(ts, interval){
    const ms=intervalMs(interval);
    return Math.floor(ts/ms)*ms;
  }
  getLatestCompletedCandle(interval){
    const now=this.getAdjustedNow();
    const ms=intervalMs(interval);
    // Completed means fully closed: floor(now/ms)*ms - ms
    // But if now is exactly on boundary, that boundary's candle just completed at now
    // So latest completed openTime = floor((now -1)/ms)*ms
    // Simpler: floor((now-1)/ms)*ms
    return Math.floor((now-1)/ms)*ms;
  }
  clampRangeToCompleted(from,to,interval){
    const latest=this.getLatestCompletedCandle(interval);
    const alignedLatest=this.alignToInterval(latest, interval);
    // Do not request beyond latest
    const clampedTo=Math.min(to, alignedLatest + intervalMs(interval)-1); // inclusive, but effectively latest
    // Actually inclusive end should be latest, not latest+interval-1 if we interpret to as inclusive openTime
    const safeTo=Math.min(to, latest);
    return {from, to: safeTo, truncated: to>latest};
  }
}
global.ExchangeTime=ExchangeTime;
global.intervalMsForTime=intervalMs;
})(typeof window!=='undefined'?window:globalThis);
