/**
 * Local historical candle store.
 * IndexedDB cache with Binance-compatible kline normalization.
 */
class CandleStore {
  constructor(options={}){this.dbName=options.dbName||'delta-paper-market-data';this.version=1;this.db=null;this.memory=new Map();this.maxMemory=options.maxMemory||50000;}
  async init(){if(!('indexedDB'in window))return;this.db=await new Promise((resolve,reject)=>{const req=indexedDB.open(this.dbName,this.version);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('candles')){const s=db.createObjectStore('candles',{keyPath:['symbol','interval','openTime']});s.createIndex('range',['symbol','interval','openTime']);}};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);}).catch(()=>null);}
  key(c){return `${c.symbol}|${c.interval}|${c.openTime}`;}
  normalize(symbol,interval,row){const c=Array.isArray(row)?{openTime:+row[0],open:+row[1],high:+row[2],low:+row[3],close:+row[4],volume:+row[5],closeTime:+row[6],trades:+(row[8]||0)}:{openTime:+(row.openTime??row.time??row.t),open:+row.open,high:+row.high,low:+row.low,close:+row.close,volume:+(row.volume??0),closeTime:+(row.closeTime??0),trades:+(row.trades??0)};if(!Number.isFinite(c.openTime)||![c.open,c.high,c.low,c.close].every(v=>Number.isFinite(v)&&v>0))return null;return{symbol,interval,...c,updatedAt:Date.now()};}
  async putMany(symbol,interval,rows){const cs=rows.map(r=>this.normalize(symbol,interval,r)).filter(Boolean);cs.forEach(c=>{this.memory.set(this.key(c),c);if(this.memory.size>this.maxMemory)this.memory.delete(this.memory.keys().next().value);});if(!this.db||!cs.length)return cs.length;await new Promise((resolve,reject)=>{const tx=this.db.transaction('candles','readwrite'),s=tx.objectStore('candles');cs.forEach(c=>s.put(c));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});return cs.length;}
  async getRange(symbol,interval,start,end,limit=10000){const map=new Map();for(const c of this.memory.values())if(c.symbol===symbol&&c.interval===interval&&c.openTime>=start&&c.openTime<=end)map.set(this.key(c),c);if(this.db)await new Promise(resolve=>{const tx=this.db.transaction('candles','readonly'),idx=tx.objectStore('candles').index('range'),req=idx.openCursor(IDBKeyRange.bound([symbol,interval,start],[symbol,interval,end]));req.onsuccess=()=>{const cur=req.result;if(cur){map.set(this.key(cur.value),cur.value);cur.continue();}else resolve();};req.onerror=resolve;});return[...map.values()].sort((a,b)=>a.openTime-b.openTime).slice(-limit);}
  async latest(symbol,interval,limit=1000){const ms=interval==='1m'?60000:60000;return this.getRange(symbol,interval,Date.now()-ms*limit*2,Date.now(),limit);}
}
window.CandleStore=CandleStore;
