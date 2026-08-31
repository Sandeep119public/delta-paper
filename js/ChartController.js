/* Chart controller: one owner for history, live updates and replay. */
(function(global){
'use strict';
if(!global.DeltaPaperApp)return;
const oldInit=DeltaPaperApp.prototype._initChart;
const TF={ '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 };
const cleanRows=data=>data.map(c=>{const raw=Number(c.time??c.openTime);const time=Math.floor(raw>1e11?raw/1000:raw);return {time,open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume||0};}).filter(c=>c.time>0&&[c.open,c.high,c.low,c.close].every(Number.isFinite));
DeltaPaperApp.prototype._initChart=function(){
 const container=this.$('tv-chart-container');
 if(!container||typeof LightweightCharts==='undefined')return oldInit.call(this);
 this._tvChart=LightweightCharts.createChart(container,{autoSize:true,layout:{background:{color:'#111827'},textColor:'#94a3b8',fontFamily:"'JetBrains Mono',monospace",fontSize:11},grid:{vertLines:{color:'rgba(36,52,72,.5)'},horzLines:{color:'rgba(36,52,72,.5)'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},rightPriceScale:{borderColor:'#243448',scaleMargins:{top:.08,bottom:.25}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#243448',rightOffset:8,minBarSpacing:5,shiftVisibleRangeOnNewBar:true}});
 const opts={upColor:'#10b981',downColor:'#ef4444',borderVisible:false,wickUpColor:'#10b981',wickDownColor:'#ef4444',priceFormat:{type:'price',precision:4,minMove:0.0001}};
 this._tvCandle=this._tvChart.addSeries?this._tvChart.addSeries(LightweightCharts.CandlestickSeries,opts):this._tvChart.addCandlestickSeries(opts);
 this._tvVol=this._tvChart.addSeries?this._tvChart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''}):this._tvChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
 if(this._tvVol.priceScale)this._tvVol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
 this._chartData=global.chartDataService;this.replay=new global.ChartReplay(this);const rb=this.$('replayBtn'),rp=this.$('replayPlay'),rs=this.$('replayStop'),rz=this.$('replaySpeed');rb&&rb.addEventListener('click',async()=>{try{rb.disabled=true;if(!this.replay.active)await this.replay.start();else this.replay.stop();}catch(e){this.toast('Replay unavailable',e.message,'err');}finally{rb.disabled=false;}});rp&&rp.addEventListener('click',()=>this.replay.playing?this.replay.pause():this.replay.play());rs&&rs.addEventListener('click',()=>this.replay.stop());rz&&rz.addEventListener('change',()=>this.replay.setSpeed(rz.value));this._chartRequest=0;this._loadCandles(this.selSym,this._tf);
 this.market.subscribe(()=>{const m=this.market.getMarket(this.selSym);if(m&&m.price>0)this._feedTick(m.price);});
 document.querySelectorAll('.tf-row button[data-tf]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tf-row button[data-tf]').forEach(x=>x.classList.remove('on'));b.classList.add('on');this._loadCandles(this.selSym,b.dataset.tf);}));
 this._tvChart.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(range&&range.from<80&&!this._loadingOlder&&this._historyCache.length)this._loadOlder();});
};
DeltaPaperApp.prototype._setChartData=function(data,keepRange){this._historyCache=data.slice().sort((a,b)=>a.time-b.time);if(this._tvCandle)this._tvCandle.setData(this._historyCache);if(this._tvVol)this._tvVol.setData(this._historyCache.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));if(this.vwap)this.vwap.setData(this._historyCache);if(keepRange&&this._tvChart){try{this._tvChart.timeScale().setVisibleRange(keepRange);}catch(e){}}};
DeltaPaperApp.prototype._loadCandles=async function(sym,tf){
 if(sym)this.selSym=sym;if(tf)this._tf=tf;this._tfSec=TF[this._tf]||60;this._curCandle=null;this._historyCache=[];this._loadingOlder=false;const request=++this._chartRequest,svc=this._chartData||global.chartDataService;if(!svc)return;
 const end=Date.now(),start=end-this._tfSec*500;
 try{const data=cleanRows(await svc.getCandles(this.selSym,this._tf,start,end));if(request!==this._chartRequest||!data.length)return;this._setChartData(data);const m=this.market.getMarket(this.selSym);const last=data[data.length-1];this._curCandle={...last};if(m&&m.price>0)this._feedTick(m.price);if(this._tvChart)this._tvChart.timeScale().scrollToRealTime();}
 catch(e){if(request===this._chartRequest)DELTA_LOGGER.warn('[Chart] historical load failed',e);}
};
DeltaPaperApp.prototype._loadOlder=async function(){const svc=this._chartData||global.chartDataService;if(!svc||!this._historyCache.length)return;this._loadingOlder=true;const oldRange=this._tvChart.timeScale().getVisibleRange(),first=this._historyCache[0].time*1000,span=this._tfSec*500;try{const older=cleanRows(await svc.getCandles(this.selSym,this._tf,Math.max(0,first-span),first-1));const map=new Map(this._historyCache.map(c=>[c.time,c]));older.forEach(c=>map.set(c.time,c));this._setChartData([...map.values()],oldRange);}catch(e){DELTA_LOGGER.warn('[Chart] older history failed',e);}finally{this._loadingOlder=false;}};
DeltaPaperApp.prototype._feedTick=function(price){
 if(this.replay&&this.replay.active)return;if(!this._tvCandle||!(price>0))return;const now=Date.now(),bucket=Math.floor(now/1000/this._tfSec)*this._tfSec,m=this.market.getMarket(this.selSym),size=Number(m&&m.lastTradeSize),volume=Number.isFinite(size)&&size>0?size:1;let c=this._curCandle;
 if(!c||c.time!==bucket)c=this._curCandle={time:bucket,open:price,high:price,low:price,close:price,volume:0};
 c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume=(c.volume||0)+volume;this._tvCandle.update(c);if(this._tvVol)this._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'});if(this.vwap)this.vwap.update(price,volume,Math.floor(now/1000));
};
})(window);
