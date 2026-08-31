/* TradingView-style chart integration. */
(function(global){
  'use strict';
  if(!global.DeltaPaperApp) return;
  const oldInit=DeltaPaperApp.prototype._initChart;
  DeltaPaperApp.prototype._initChart=function(){
    const container=this.$('tv-chart-container');
    if(!container||typeof LightweightCharts==='undefined') return oldInit.call(this);
    this._tvChart=LightweightCharts.createChart(container,{autoSize:true,layout:{background:{color:'#111827'},textColor:'#94a3b8',fontFamily:"'JetBrains Mono',monospace",fontSize:11},grid:{vertLines:{color:'rgba(36,52,72,.5)'},horzLines:{color:'rgba(36,52,72,.5)'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},rightPriceScale:{borderColor:'#243448',scaleMargins:{top:.08,bottom:.25}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#243448',rightOffset:8,minBarSpacing:5,shiftVisibleRangeOnNewBar:true}});
    const opts={upColor:'#10b981',downColor:'#ef4444',borderVisible:false,wickUpColor:'#10b981',wickDownColor:'#ef4444'};
    this._tvCandle=this._tvChart.addSeries?this._tvChart.addSeries(LightweightCharts.CandlestickSeries,opts):this._tvChart.addCandlestickSeries(opts);
    this._tvVol=this._tvChart.addSeries?this._tvChart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''}):this._tvChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
    if(this._tvVol.priceScale)this._tvVol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
    this._chartData=global.chartDataService;
    this._loadCandles(this.selSym,this._tf);
    this.market.subscribe(()=>{const m=this.market.getMarket(this.selSym);if(m&&m.price>0)this._feedTick(m.price);});
    const btns=document.querySelectorAll('.tf-row button[data-tf]');
    btns.forEach(b=>b.addEventListener('click',()=>{btns.forEach(x=>x.classList.remove('on'));b.classList.add('on');this._loadCandles(this.selSym,b.dataset.tf);}));
    this._tvChart.timeScale().subscribeVisibleLogicalRangeChange(range=>{
      if(!range||range.from>80||this._loadingOlder||!this._historyCache.length)return;
      this._loadOlder();
    });
  };
  DeltaPaperApp.prototype._setChartData=function(data,keepRange){
    this._historyCache=data.slice().sort((a,b)=>a.time-b.time);
    if(this._tvCandle)this._tvCandle.setData(this._historyCache);
    if(this._tvVol)this._tvVol.setData(this._historyCache.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));
    if(this.vwap)this.vwap.setData(this._historyCache);
    if(keepRange&&this._tvChart){try{this._tvChart.timeScale().setVisibleRange(keepRange);}catch(e){}}
  };
  DeltaPaperApp.prototype._loadCandles=async function(sym,tf){
    if(sym)this.selSym=sym;if(tf)this._tf=tf;
    this._tfSec={ '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400}[this._tf]||60;
    this._curCandle=null;this._historyCache=[];this._loadingOlder=false;
    const svc=this._chartData||global.chartDataService;if(!svc)return;
    const end=Date.now(),start=end-this._tfSec*500*1000;
    try{const data=await svc.getCandles(this.selSym,this._tf,start,end);if(!data.length)return;const clean=data.map(c=>({time:Math.floor(c.time||c.openTime/1000),open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume||0}));this._setChartData(clean);this._curCandle={...clean[clean.length-1]};if(this._tvChart)this._tvChart.timeScale().scrollToRealTime();}
    catch(e){DELTA_LOGGER.warn('[Chart] historical load failed',e);}
  };
  DeltaPaperApp.prototype._loadOlder=async function(){
    const svc=this._chartData||global.chartDataService;if(!svc||!this._historyCache.length)return;
    this._loadingOlder=true;const oldRange=this._tvChart.timeScale().getVisibleRange();const first=this._historyCache[0].time*1000;const span=this._tfSec*500*1000;
    try{const older=await svc.getCandles(this.selSym,this._tf,Math.max(0,first-span),first-1);const clean=older.map(c=>({time:Math.floor(c.time||c.openTime/1000),open:+c.open,high:+c.high,low:+c.low,close:+c.close,volume:+c.volume||0}));const map=new Map(this._historyCache.map(c=>[c.time,c]));clean.forEach(c=>map.set(c.time,c));this._setChartData([...map.values()],oldRange);}
    catch(e){DELTA_LOGGER.warn('[Chart] older history failed',e);}finally{this._loadingOlder=false;}
  };
  DeltaPaperApp.prototype._feedTick=function(price){
    if(!this._tvCandle||!(price>0))return;const bucket=Math.floor(Date.now()/1000/this._tfSec)*this._tfSec;let c=this._curCandle;
    if(!c||c.time!==bucket)c=this._curCandle={time:bucket,open:price,high:price,low:price,close:price,volume:0};
    c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume=(c.volume||0)+1;
    this._tvCandle.update(c);if(this._tvVol)this._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'});
    if(this.vwap)this.vwap.update(price,1,Math.floor(Date.now()/1000));
  };
})(window);
