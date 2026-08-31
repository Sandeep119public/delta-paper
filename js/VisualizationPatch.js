/* Visualization correctness fixes. */
(function (global) {
  'use strict';
  if (global.VwapIndicator) {
    VwapIndicator.prototype.update = function (price, volume, timestamp) {
      if (!this.enabled || !(price > 0) || !isFinite(price) || !(volume > 0) || !isFinite(volume)) return;
      const d=new Date(timestamp*1000), key=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');
      if(this._lastUTCDate!==null&&key!==this._lastUTCDate)this._resetAccumulators(); this._lastUTCDate=key;
      this.cumPV+=price*volume; this.cumVol+=volume; const old=this.vwap; this.vwap=this.cumPV/this.cumVol; this.varianceSum+=(price-old)*(price-this.vwap);
      const time=Math.floor(timestamp); this.vwapSeries.update({time,value:this.vwap});
      if(this.showBands&&this.cumVol>1){const sd=Math.sqrt(Math.max(0,this.varianceSum)/this.cumVol);if(isFinite(sd)){this.upper1.update({time,value:this.vwap+sd});this.lower1.update({time,value:this.vwap-sd});this.upper2.update({time,value:this.vwap+2*sd});this.lower2.update({time,value:this.vwap-2*sd});}}
    };
  }
  if(global.DeltaPaperApp){
    DeltaPaperApp.prototype._feedTick=function(price){
      if(!this._tvCandle||!(price>0))return; const bucket=Math.floor(Date.now()/1000/this._tfSec)*this._tfSec; let c=this._curCandle;
      if(!c||c.time!==bucket)c=this._curCandle={time:bucket,open:price,high:price,low:price,close:price,volume:0}; c.high=Math.max(c.high,price);c.low=Math.min(c.low,price);c.close=price;c.volume=(c.volume||0)+1;
      try{this._tvCandle.update(c);if(this._tvVol)this._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,0.35)':'rgba(239,68,68,0.35)'});}catch(e){if(this._historyCache.length){const last=this._historyCache[this._historyCache.length-1];if(last.time===bucket)this._historyCache[this._historyCache.length-1]={...last,...c};else if(bucket>last.time)this._historyCache.push({...c});this._tvCandle.setData(this._historyCache);}}
      const m=this.market.getMarket(this.selSym), v=m&&Number(m.lastTradeSize); if(this.vwap)this.vwap.update(price,Number.isFinite(v)&&v>0?v:1,Math.floor(Date.now()/1000));
    };
    const oldInit=DeltaPaperApp.prototype._initVisualization; DeltaPaperApp.prototype._initVisualization=function(){oldInit.call(this);if(this.heatmap)this.heatmap.market=this.market;};
  }
  if(global.LiquidationHeatmap){
    LiquidationHeatmap.prototype._calculateMarketClusters=function(){
      if(!this.simEngine||!this.market){this._marketClusters=[];return;} const clusters={},maxLev=Math.max(1,Number(this.config.MAX_LEVERAGE)||20),tiers=[2,3,5,10,20].filter(x=>x<=maxLev),notional=5000; let currentPrice=0;
      for(const sym of(this.config.SYMBOLS||[])){const m=this.market.getMarket(sym);if(m&&m.price>0){currentPrice=m.price;break;}} if(!(currentPrice>0)){this._marketClusters=[];return;}
      tiers.forEach(lev=>[currentPrice*(1-1/lev+0.005),currentPrice*(1+1/lev-0.005)].forEach(lp=>{const b=Math.round(lp/this._bucketSize)*this._bucketSize,k=b.toFixed(0);if(!clusters[k])clusters[k]={price:b,volume:0};clusters[k].volume+=notional;}));
      const maxVol=Math.max(...Object.values(clusters).map(c=>c.volume),1);this._marketClusters=Object.values(clusters).map(c=>({price:c.price,intensity:c.volume/maxVol}));
    };
  }
})(window);
