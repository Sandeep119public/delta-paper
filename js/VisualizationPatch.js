/* Visualization correctness fixes. */
(function (global) {
  'use strict';
  if (global.VwapIndicator) {
    VwapIndicator.prototype.update = function (price, volume, timestamp) {
      if (!this.enabled || !(price > 0) || !isFinite(price) || !(volume > 0) || !isFinite(volume)) return;
      const d = new Date(timestamp * 1000);
      const utcKey = d.getUTCFullYear() + '-' + String(d.getUTCMonth()+1).padStart(2,'0') + '-' + String(d.getUTCDate()).padStart(2,'0');
      if (this._lastUTCDate !== null && utcKey !== this._lastUTCDate) this._resetAccumulators();
      this._lastUTCDate = utcKey;
      this.cumPV += price * volume; this.cumVol += volume;
      const oldVwap = this.vwap; this.vwap = this.cumPV / this.cumVol;
      this.varianceSum += (price - oldVwap) * (price - this.vwap);
      const time = Math.floor(timestamp);
      this.vwapSeries.update({ time, value: this.vwap });
      if (this.showBands && this.cumVol > 1) {
        const sd = Math.sqrt(Math.max(0, this.varianceSum) / this.cumVol);
        if (isFinite(sd)) { this.upper1.update({time,value:this.vwap+sd}); this.lower1.update({time,value:this.vwap-sd}); this.upper2.update({time,value:this.vwap+2*sd}); this.lower2.update({time,value:this.vwap-2*sd}); }
      }
    };
  }
  if (global.DeltaPaperApp) {
    DeltaPaperApp.prototype._feedTick = function (price) {
      if (!this._tvCandle || !(price > 0)) return;
      const bucket = Math.floor(Date.now()/1000/this._tfSec)*this._tfSec;
      let c = this._curCandle;
      if (!c || c.time !== bucket) c = this._curCandle = {time:bucket,open:price,high:price,low:price,close:price,volume:0};
      c.high=Math.max(c.high,price); c.low=Math.min(c.low,price); c.close=price; c.volume=(c.volume||0)+1;
      try { this._tvCandle.update(c); if(this._tvVol)this._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,0.35)':'rgba(239,68,68,0.35)'}); }
      catch(e) { if(this._historyCache.length){const last=this._historyCache[this._historyCache.length-1]; if(last.time===bucket)this._historyCache[this._historyCache.length-1]={...last,...c}; else if(bucket>last.time)this._historyCache.push({...c}); this._tvCandle.setData(this._historyCache);} }
      const m = this.market.getMarket(this.selSym), v = m && Number(m.volume);
      if (this.vwap) this.vwap.update(price, Number.isFinite(v) && v > 0 ? v : 1, Math.floor(Date.now()/1000));
    };
  }
})(window);
