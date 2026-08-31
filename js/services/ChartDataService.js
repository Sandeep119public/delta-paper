/**
 * TradingView-style historical chart data service.
 * Uses local IndexedDB first and fills missing history from Binance when configured.
 * Base storage is 1m; higher intervals are aggregated locally.
 */
class ChartDataService {
  constructor(config, candleStore, apiService) {
    this.config = config; this.store = candleStore; this.api = apiService;
    this.baseInterval = '1m';
    this.baseMs = 60000;
    this.binanceBase = (config.BINANCE_KLINES_BASE || 'https://api.binance.com/api/v3/klines').replace(/\/$/, '');
  }

  intervalMs(interval) {
    const m = String(interval).match(/^(\d+)([mhdw])$/i); if (!m) throw new Error('Unsupported interval: '+interval);
    const n=Number(m[1]), u=m[2].toLowerCase(); return n*(u==='m'?60000:u==='h'?3600000:u==='d'?86400000:604800000);
  }

  async fetchBinance(symbol, start, end, limit=1000) {
    const url = `${this.binanceBase}?symbol=${encodeURIComponent(symbol)}&interval=1m&startTime=${Math.floor(start)}&endTime=${Math.floor(end)}&limit=${Math.min(1000,limit)}`;
    const r = await fetch(url); if(!r.ok) throw new Error('Binance klines HTTP '+r.status); return r.json();
  }

  async ensureBase(symbol, start, end) {
    const existing = await this.store.getRange(symbol, this.baseInterval, start, end, 100000);
    const step = this.baseMs;
    if (existing.length && existing[0].openTime <= start + step && existing[existing.length-1].openTime >= end-step) return existing;
    let cursor = Math.max(0, Math.floor(start/step)*step), rows=[];
    while(cursor < end) {
      const batchEnd=Math.min(end, cursor+1000*step-1);
      const batch=await this.fetchBinance(symbol,cursor,batchEnd,1000);
      if(!batch.length) break;
      await this.store.putMany(symbol,this.baseInterval,batch);
      rows=rows.concat(batch);
      const last=Number(batch[batch.length-1][0]);
      if(last < cursor) break;
      cursor=last+step;
      if(batch.length<1000) break;
    }
    return this.store.getRange(symbol,this.baseInterval,start,end,100000);
  }

  aggregate(rows, interval) {
    const ms=this.intervalMs(interval), out=new Map();
    for(const r of rows) {
      const t=Math.floor(r.openTime/ms)*ms, old=out.get(t);
      if(!old) out.set(t,{time:t,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume,trades:r.trades||0});
      else { old.high=Math.max(old.high,r.high); old.low=Math.min(old.low,r.low); old.close=r.close; old.volume+=r.volume; old.trades+=(r.trades||0); }
    }
    return [...out.values()].sort((a,b)=>a.time-b.time);
  }

  async getCandles(symbol, interval='1m', start=Date.now()-86400000, end=Date.now()) {
    if(interval==='1m') return this.ensureBase(symbol,start,end);
    const factor=this.intervalMs(interval), baseStart=Math.floor(start/this.baseMs)*this.baseMs;
    const base=await this.ensureBase(symbol,baseStart,end);
    return this.aggregate(base,interval).filter(c=>c.time>=start && c.time<=end);
  }

  async latest(symbol, interval='1m', limit=1000) {
    const end=Date.now(), start=end-this.intervalMs(interval)*limit*1.1;
    return this.getCandles(symbol,interval,start,end);
  }
}
window.ChartDataService=ChartDataService;
