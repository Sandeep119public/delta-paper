/* Chart controller: one owner for history, live updates and replay. */
(function(global){
'use strict';
const TF={ '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 };
const cleanRows=data=>{
  const byTime=new Map();
  for(const c of (Array.isArray(data)?data:[])){
    const raw=Number(c.time??c.openTime),time=Math.floor(raw>1e11?raw/1000:raw);
    const row={time,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:Number(c.volume)||0};
    if(row.time>0&&[row.open,row.high,row.low,row.close].every(v=>Number.isFinite(v)&&v>0)&&row.high>=Math.max(row.open,row.close,row.low)&&row.low<=Math.min(row.open,row.close,row.high))byTime.set(row.time,row);
  }
  return [...byTime.values()].sort((a,b)=>a.time-b.time);
};
class ChartController {
 constructor(app){this.app=app;this.TF=TF;}
 init(){const app=this.app; return this._init();}
 _init(){const app=this.app;
 const container=app.$('tv-chart-container');
 if(!container||typeof LightweightCharts==='undefined')return;
 app._tvChart=LightweightCharts.createChart(container,{autoSize:true,layout:{background:{color:'#111827'},textColor:'#94a3b8',fontFamily:"'JetBrains Mono',monospace",fontSize:11},grid:{vertLines:{color:'rgba(36,52,72,.5)'},horzLines:{color:'rgba(36,52,72,.5)'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},rightPriceScale:{borderColor:'#243448',scaleMargins:{top:.08,bottom:.25}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#243448',rightOffset:8,minBarSpacing:5,shiftVisibleRangeOnNewBar:true}});
 const opts={upColor:'#10b981',downColor:'#ef4444',borderVisible:false,wickUpColor:'#10b981',wickDownColor:'#ef4444',priceFormat:{type:'price',precision:4,minMove:0.0001}};
 app._tvCandle=app._tvChart.addSeries?app._tvChart.addSeries(LightweightCharts.CandlestickSeries,opts):app._tvChart.addCandlestickSeries(opts);
 app._tvVol=app._tvChart.addSeries?app._tvChart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''}):app._tvChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
 if(app._tvVol.priceScale)app._tvVol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
 app._chartData=global.chartDataService;app.replay=new global.ChartReplay(app);this._bindReplay();this.load(app.selSym,app._tf);
 app.market.subscribe(()=>{const m=app.market.getMarket(app.selSym);if(m&&m.price>0)this.feedTick(m.price);});
 document.querySelectorAll('.tf-row button[data-tf]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tf-row button[data-tf]').forEach(x=>x.classList.remove('on'));b.classList.add('on');this.load(app.selSym,b.dataset.tf);}));
 app._tvChart.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(range&&range.from<80&&!app._loadingOlder&&app._historyCache.length)this.loadOlder();});
 }
 _bindReplay(){const a=this.app,rb=a.$('replayBtn'),rp=a.$('replayPlay'),rs=a.$('replayStop'),rz=a.$('replaySpeed');rb&&rb.addEventListener('click',async()=>{try{rb.disabled=true;if(!a.replay.active)await a.replay.start();else a.replay.stop();}catch(e){a.toast('Replay unavailable',e.message,'err');}finally{rb.disabled=false;}});rp&&rp.addEventListener('click',()=>a.replay.playing?a.replay.pause():a.replay.play());rs&&rs.addEventListener('click',()=>a.replay.stop());rz&&rz.addEventListener('change',()=>a.replay.setSpeed(rz.value));}
 setData(data,keepRange){
 const a=this.app,rows=cleanRows(data);
 a._historyCache=rows;
 if(a._tvCandle)a._tvCandle.setData(rows);
 if(a._tvVol)a._tvVol.setData(rows.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));
 if(a.vwap&&a.vwap.enabled)a.vwap.setData(rows);
 if(keepRange&&a._tvChart){try{a._tvChart.timeScale().setVisibleRange(keepRange);}catch(e){}}
}
 load=async function(sym,tf){const a=this.app;if(sym)a.selSym=sym;if(tf)a._tf=tf;a._tfSec=TF[a._tf]||60;a._curCandle=null;a._historyCache=[];a._chartHistoryReady=false;a._loadingOlder=false;const request=++a._chartRequest,svc=a._chartData||global.chartDataService;if(!svc)return;const end=Date.now(),start=end-a._tfSec*800;
 try{
   const data=cleanRows(await svc.getCandles(a.selSym,a._tf,start,end));
   if(request!==a._chartRequest)return;
   if(data.length<20)throw new Error('Only '+data.length+' valid candles received');
   this.setData(data);
   a._chartHistoryReady=true;
   const m=a.market.getMarket(a.selSym),last=data[data.length-1];
   a._curCandle={...last};
   if(m&&m.price>0)this.feedTick(m.price);
   if(a._tvChart){
     const to=data.length-1,from=Math.max(0,to-99);
     try{a._tvChart.timeScale().setVisibleLogicalRange({from,to});}catch(_){a._tvChart.timeScale().fitContent();}
   }
 }catch(e){
   if(request===a._chartRequest){
     DELTA_LOGGER.warn('[Chart] historical load failed',e);
     a.toast?.('Chart data unavailable','Unable to load enough historical candles. Retrying…','err');
     setTimeout(()=>{if(request===a._chartRequest)this.load(a.selSym,a._tf);},3000);
   }
 }};
 loadOlder=async function(){const a=this.app,svc=a._chartData||global.chartDataService;if(!svc||!a._historyCache.length)return;a._loadingOlder=true;const oldRange=a._tvChart.timeScale().getVisibleRange(),first=a._historyCache[0].time*1000,span=a._tfSec*500;try{const older=cleanRows(await svc.getCandles(a.selSym,a._tf,Math.max(0,first-span),first-1));const map=new Map(a._historyCache.map(c=>[c.time,c]));older.forEach(c=>map.set(c.time,c));this.setData([...map.values()],oldRange);}catch(e){DELTA_LOGGER.warn('[Chart] older history failed',e);}finally{a._loadingOlder=false;}};
 feedTick(price){const a=this.app;if(a.replay&&a.replay.active)return;if(!a._chartHistoryReady||!a._tvCandle||!(price>0))return;const now=Date.now(),bucket=Math.floor(now/1000/a._tfSec)*a._tfSec,m=a.market.getMarket(a.selSym),size=Number(m&&m.lastTradeSize),volume=Number.isFinite(size)&&size>0?size:1;let c=a._curCandle;if(!c||c.time!==bucket)c=a._curCandle={time:bucket,open:price,high:price,low:price,close:price,volume:0};c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume=(c.volume||0)+volume;a._tvCandle.update(c);if(a._tvVol)a._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'});if(a.vwap)a.vwap.update(price,volume,Math.floor(now/1000));if(a.trading&&a.trading.mode!=='replay')try{a.trading.onPrice(a.selSym,Number(price));}catch(e){DELTA_LOGGER.error('[Trading] Trigger processing failed:',e);}}
}
global.ChartController=ChartController;
})(window);
