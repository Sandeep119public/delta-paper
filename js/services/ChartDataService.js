/**
 * TradingView-style historical chart data service.
 * IndexedDB first; Binance Futures is used only to fill missing 1m history.
 * Higher intervals are aggregated locally from the 1m source of truth.
 */
class ChartDataService {
  constructor(config,candleStore){this.config=config;this.store=candleStore;this.baseInterval='1m';this.baseMs=60000;this.binanceBase=(config.BINANCE_KLINES_BASE||'https://fapi.binance.com/fapi/v1/klines').replace(/\/$/,'');this.symbolMap=config.BINANCE_SYMBOL_MAP||{BTCUSD:'BTCUSDT',ETHUSD:'ETHUSDT',SOLUSD:'SOLUSDT'};}
  binanceSymbol(symbol){return this.symbolMap[symbol]||symbol;}
  intervalMs(i){const m=String(i).match(/^(\d+)([mhdw])$/i);if(!m)throw Error('Unsupported interval: '+i);const n=+m[1],u=m[2].toLowerCase();return n*(u==='m'?6e4:u==='h'?36e5:u==='d'?864e5:6048e5);}
  async fetchBinance(symbol,start,end,limit=1000){const u=`${this.binanceBase}?symbol=${encodeURIComponent(this.binanceSymbol(symbol))}&interval=1m&startTime=${Math.floor(start)}&endTime=${Math.floor(end)}&limit=${Math.min(1000,limit)}`;const r=await fetch(u);if(!r.ok)throw Error('Binance Futures klines HTTP '+r.status);return r.json();}
  coverageGaps(rows,start,end,step=this.baseMs){const alignedStart=Math.floor(start/step)*step,alignedEnd=Math.floor(end/step)*step;const have=new Set(rows.map(r=>r.openTime));const gaps=[];let gapStart=null;for(let t=alignedStart;t<=alignedEnd;t+=step){if(!have.has(t)){if(gapStart===null)gapStart=t;}else if(gapStart!==null){gaps.push([gapStart,t-step]);gapStart=null;}}if(gapStart!==null)gaps.push([gapStart,alignedEnd]);return gaps;}
  async ensureBase(symbol,start,end){let have=await this.store.getRange(symbol,'1m',start,end,100000),step=this.baseMs;let gaps=this.coverageGaps(have,start,end,step);for(const [from,to] of gaps){let cursor=Math.max(0,from),safety=0;while(cursor<=to&&safety++<10000){const batch=await this.fetchBinance(symbol,cursor,Math.min(to,cursor+1000*step-1));if(!Array.isArray(batch)||!batch.length)break;await this.store.putMany(symbol,'1m',batch);const last=Number(batch[batch.length-1][0]);if(!Number.isFinite(last)||last<cursor)break;cursor=last+step;if(batch.length<1000)break;}}have=await this.store.getRange(symbol,'1m',start,end,100000);return have;}
  aggregate(rows,interval){const ms=this.intervalMs(interval),out=new Map();for(const r of rows){const t=Math.floor(r.openTime/ms)*ms,x=out.get(t);if(!x)out.set(t,{time:t,open:r.open,high:r.high,low:r.low,close:r.close,volume:r.volume,trades:r.trades||0});else{x.high=Math.max(x.high,r.high);x.low=Math.min(x.low,r.low);x.close=r.close;x.volume+=r.volume;x.trades+=(r.trades||0);}}return [...out.values()].sort((a,b)=>a.time-b.time);}
  async getCandles(symbol,interval='1m',start=Date.now()-864e5,end=Date.now()){if(interval==='1m')return this.ensureBase(symbol,start,end);const base=await this.ensureBase(symbol,Math.floor(start/this.baseMs)*this.baseMs,end);return this.aggregate(base,interval).filter(c=>c.time>=start&&c.time<=end);}
  async latest(symbol,interval='1m',limit=1000){const end=Date.now(),rows=await this.getCandles(symbol,interval,end-this.intervalMs(interval)*limit*1.1,end);return rows.slice(-limit);}
}
window.ChartDataService=ChartDataService;
