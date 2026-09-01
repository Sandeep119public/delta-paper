/* Chart controller: uses HistoricalDataManager exclusively; no direct Binance calls. */
(function(global){
'use strict';
const TF={ '1m':60,'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400 };
const cleanRows=data=>data.map(c=>{
  const raw=Number(c.time ?? c.openTime);
  const time=Math.floor(raw>1e11?raw/1000:raw);
  return { time, open:+c.open, high:+c.high, low:+c.low, close:+c.close, volume:+c.volume||0 };
}).filter(c=>c.time>0 && [c.open,c.high,c.low,c.close].every(Number.isFinite) && c.high>=c.low && c.high>=c.open && c.high>=c.close && c.low<=c.open && c.low<=c.close);

class ChartController {
  constructor(app){ this.app=app; this.TF=TF; this._chartReady=false; this._retryCount=0; }
  _chartPrecision(symbol){
    const m=this.app.market.getMarket(symbol);
    if(m && Number.isFinite(m.dec)) return Math.max(0, Math.min(6, m.dec));
    if(symbol==='BTCUSD') return 1;
    if(symbol==='ETHUSD') return 2;
    if(symbol==='SOLUSD') return 3;
    return 2;
  }
  _applyPrecision(symbol){
    const prec=this._chartPrecision(symbol);
    if(this.app._tvCandle && this.app._tvCandle.applyOptions){
      try{ this.app._tvCandle.applyOptions({priceFormat:{type:'price',precision:prec, minMove: Math.pow(10,-prec)}});}catch(e){}
    }
  }
  init(){ try{ return this._init(); }catch(e){ DELTA_LOGGER.error('[Chart] init fatal',e); this._showLibraryError(e); throw e; } }
  _showLibraryError(err){
    try{
      const app=this.app, c=app.$('tv-chart-container');
      if(!c) return;
      this._ensureErrorOverlay(c);
      const overlay=document.getElementById('chartErrorOverlay');
      const det=document.getElementById('chartErrorDetails');
      if(overlay) overlay.style.display='flex';
      if(det) det.innerHTML='Chart library failed to load (Lightweight Charts 4.1.3).<br>Trading continues below.<br><span style="color:#94a3b8">'+String(err.message||err)+'</span>';
      if(global.DELTA_LOGGER) DELTA_LOGGER.error('[Chart] library unavailable',err);
    }catch(e){}
  }
  _init(){
    const app=this.app;
    const container=app.$('tv-chart-container');
    if(!container){
      DELTA_LOGGER.warn('[Chart] container missing — chart disabled, trading active');
      return;
    }
    if(typeof LightweightCharts==='undefined'){
      DELTA_LOGGER.error('[Chart] Lightweight Charts not loaded — CDN failure, showing error state. Trading continues.');
      this._showLibraryError(new Error('LightweightCharts undefined — CDN load failed'));
      // Ensure overlay visible
      try{ this._ensureErrorOverlay(container); const o=document.getElementById('chartErrorOverlay'); if(o) o.style.display='flex'; }catch(e){}
      return;
    }
    // ensure overlay container styles
    this._ensureErrorOverlay(container);
    app._tvChart=LightweightCharts.createChart(container,{autoSize:true,layout:{background:{color:'#111827'},textColor:'#94a3b8',fontFamily:"'JetBrains Mono',monospace",fontSize:11},grid:{vertLines:{color:'rgba(36,52,72,.5)'},horzLines:{color:'rgba(36,52,72,.5)'}},crosshair:{mode:LightweightCharts.CrosshairMode.Normal},rightPriceScale:{borderColor:'#243448',scaleMargins:{top:.08,bottom:.25}},timeScale:{timeVisible:true,secondsVisible:false,borderColor:'#243448',rightOffset:8,minBarSpacing:5,shiftVisibleRangeOnNewBar:true}});
    const precision=this._chartPrecision(app.selSym);
    const opts={upColor:'#10b981',downColor:'#ef4444',borderVisible:false,wickUpColor:'#10b981',wickDownColor:'#ef4444',priceFormat:{type:'price',precision, minMove: Math.pow(10,-precision)}};
    app._tvCandle=app._tvChart.addSeries?app._tvChart.addSeries(LightweightCharts.CandlestickSeries,opts):app._tvChart.addCandlestickSeries(opts);
    app._tvVol=app._tvChart.addSeries?app._tvChart.addSeries(LightweightCharts.HistogramSeries,{priceFormat:{type:'volume'},priceScaleId:''}):app._tvChart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:''});
    if(app._tvVol.priceScale) app._tvVol.priceScale().applyOptions({scaleMargins:{top:.8,bottom:0}});
    // Prefer HistoricalDataManager, fallback to legacy chartDataService for tests
    app._chartData=global.historicalDataManager || global.chartDataService;
    app.replay=new global.ChartReplay(app);
    this._bindReplay();
    this.load(app.selSym, app._tf);
    app.market.subscribe(()=>{ const m=app.market.getMarket(app.selSym); if(m&&m.price>0) this.feedTick(m.price); });
    document.querySelectorAll('.tf-row button[data-tf]').forEach(b=>b.addEventListener('click',()=>{
      document.querySelectorAll('.tf-row button[data-tf]').forEach(x=>x.classList.remove('on'));
      b.classList.add('on'); this.load(app.selSym,b.dataset.tf);
    }));
    app._tvChart.timeScale().subscribeVisibleLogicalRangeChange(range=>{
      if(range&&range.from<80&&!app._loadingOlder&&app._historyCache.length) this.loadOlder();
    });
  }
  _bindReplay(){const a=this.app,rb=a.$('replayBtn'),rp=a.$('replayPlay'),rs=a.$('replayStop'),rz=a.$('replaySpeed');if(rb)rb.addEventListener('click',async()=>{try{rb.disabled=true;if(!a.replay.active)await a.replay.start();else a.replay.stop();}catch(e){if(a.toast)a.toast('Replay unavailable',e.message,'err');}finally{rb.disabled=false;}});if(rp)rp.addEventListener('click',()=>a.replay.playing?a.replay.pause():a.replay.play());if(rs)rs.addEventListener('click',()=>a.replay.stop());if(rz)rz.addEventListener('change',()=>a.replay.setSpeed(rz.value));}

  _ensureErrorOverlay(container){
    if(container.querySelector('#chartErrorOverlay')) return;
    container.style.position='relative';
    const overlay=document.createElement('div');
    overlay.id='chartErrorOverlay';
    overlay.style.cssText='position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(11,15,25,0.92);z-index:10;padding:16px;';
    overlay.innerHTML=`<div id="chartErrorBox" style="max-width:520px;width:100%;background:#111827;border:1px solid #243448;border-radius:12px;padding:16px;font-family:JetBrains Mono,monospace">`+
      `<div style="font-weight:800;color:#f8fafc;margin-bottom:6px" id="chartErrorTitle">Historical Data Unavailable</div>`+
      `<div style="font-size:11px;color:#94a3b8;margin-bottom:8px" id="chartErrorSub"></div>`+
      `<div style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.25);border:1px solid #243448;border-radius:8px;padding:8px;margin-bottom:10px;line-height:1.5" id="chartErrorDetails">Loading...</div>`+
      `<div style="font-size:11px;color:#f59e0b;margin-bottom:10px" id="chartErrorReason"></div>`+
      `<div style="display:flex;gap:8px;flex-wrap:wrap">`+
      `<button id="chartRetryBtn" class="mini-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6">Retry</button>`+
      `<button id="chartDownloadBtn" class="mini-btn">Download Historical Data</button>`+
      `<button id="chartDiagBtn" class="mini-btn">View Diagnostics</button>`+
      `</div></div>`;
    container.appendChild(overlay);
    // events delegated after init
    setTimeout(()=>{
      const rb=overlay.querySelector('#chartRetryBtn');
      const db=overlay.querySelector('#chartDownloadBtn');
      const vb=overlay.querySelector('#chartDiagBtn');
      if(rb) rb.addEventListener('click',()=> this.load(this.app.selSym,this.app._tf));
      if(db) db.addEventListener('click',()=> { if(this.app.openDataManager) this.app.openDataManager(); else if(global.historicalDataManager) this._triggerDownload(); });
      if(vb) vb.addEventListener('click',()=> { if(this.app.openDiagnostics) this.app.openDiagnostics(); else this._showDiagnostics(); });
    },0);
  }
  _triggerDownload(){
    const a=this.app;
    const end=Date.now(), start=end - 30*24*60*60*1000;
    if(global.historicalDataManager) global.historicalDataManager.downloadRange({symbol:a.selSym, interval:a._tf, from:start, to:end, onProgress:()=>{}}).then(()=>this.load(a.selSym,a._tf)).catch(e=>this._showError(e, {local:0, remote:0, valid:0, required:100}));
  }
  _showDiagnostics(){
    // fallback: log to console and toast
    if(global.historicalDataManager){
      global.historicalDataManager.getDiagnostics(this.app.selSym,this.app._tf).then(d=>{
        const msg=`Local ${d.local.count} | Health ${d.local.health}% | Missing ${d.local.missing} | Error ${d.lastError||'none'}`;
        if(this.app.toast) this.app.toast('Diagnostics', msg, '');
        console.log('[Chart Diagnostics]', d);
      });
    }
  }
  _showError(err, stats){
    const overlay=document.getElementById('chartErrorOverlay');
    const sub=document.getElementById('chartErrorSub');
    const det=document.getElementById('chartErrorDetails');
    const rea=document.getElementById('chartErrorReason');
    if(!overlay) return;
    overlay.style.display='flex';
    const a=this.app;
    const msg=String(err?.message||err||'Unknown error');
    const isCors = /CORS|Remote data unavailable|Network/i.test(msg);
    const hasLocal = (stats?.local ?? stats?.localCandles ?? 0) > 0;
    if(sub) sub.textContent=`${a.selSym} · ${a._tf}`;
    const local=stats?.local ?? stats?.localCandles ?? 0;
    const remote=stats?.remote ?? stats?.remoteCandles ?? 0;
    const valid=stats?.valid ?? stats?.validCandles ?? 0;
    const required=stats?.required ?? 100;
    if(det) det.innerHTML=`Local candles: ${local}<br>Remote candles received: ${remote}<br>Valid candles: ${valid}<br>Required candles: ${required}`+
      (isCors ? (hasLocal? `<br><span style="color:#10b981">Local historical data is still available.</span>` : `<br><span style="color:#ef4444">No local historical data available. Download cannot continue because the remote source is unavailable.</span>`) : '');
    if(rea) rea.textContent=`Reason: ${msg}`;
    if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Chart] load failed', err, stats);
  }
  _hideError(){
    const overlay=document.getElementById('chartErrorOverlay');
    if(overlay) overlay.style.display='none';
  }

  setData(data,keepRange){
    const a=this.app;
    // centralized normalization via DataVerifier
    let normalized=data;
    if(global.DataVerifier) normalized=global.DataVerifier.normalizeCandles(data.map(c=>({openTime:c.time*1000, open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume}))).candles.map(c=>({time:Math.floor(c.openTime/1000), open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume}));
    else normalized=data.slice().sort((x,y)=>x.time-y.time);
    // Deduplicate by time keeping last
    const map=new Map(); normalized.forEach(c=> map.set(c.time,c));
    const sorted=[...map.values()].sort((x,y)=>x.time-y.time);
    a._historyCache=sorted;
    if(a._tvCandle) a._tvCandle.setData(a._historyCache);
    if(a._tvVol) a._tvVol.setData(a._historyCache.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));
    if(a.vwap && a.vwap.enabled!==false) a.vwap.setData(a._historyCache);
    if(keepRange&&a._tvChart){ try{ a._tvChart.timeScale().setVisibleRange(keepRange);}catch(e){} }
    this._chartReady = a._historyCache.length>0;
    a._chartHistoryReady = this._chartReady;
    if(this._chartReady) this._hideError();
  }

  load=async function(sym,tf){
    const a=this.app;
    // Symbol/timeframe changes must invalidate any active replay to prevent price leaks
    if(a.replay && a.replay.active) try{ a.replay.stop(); }catch(e){}
    if(sym) a.selSym=sym;
    if(tf) a._tf=tf;
    a._tfSec=TF[a._tf]||60;
    this._applyPrecision(a.selSym);
    a._curCandle=null;
    a._historyCache=[];
    a._loadingOlder=false;
    this._chartReady=false;
    const request=++a._chartRequest;
    const svc=a._chartData || global.historicalDataManager || global.chartDataService;
    if(!svc){
      this._showError(new Error('No historical data service available'), {local:0,remote:0,valid:0,required:100});
      return;
    }
    // Ensure svc is HistoricalDataManager (unified)
    if(global.historicalDataManager) a._chartData=global.historicalDataManager;
    const now=(global.exchangeTime? global.exchangeTime.getAdjustedNow(): Date.now());
    const latest=(global.exchangeTime? global.exchangeTime.getLatestCompletedCandle(a._tf): Math.floor((now-1)/1000/a._tfSec)*a._tfSec*1000);
    const end=latest, start=end - a._tfSec*800*1000;
    // show loading placeholder
    const overlay=document.getElementById('chartErrorOverlay');
    if(overlay){
      overlay.style.display='flex';
      const det=document.getElementById('chartErrorDetails');
      const rea=document.getElementById('chartErrorReason');
      const sub=document.getElementById('chartErrorSub');
      if(sub) sub.textContent=`${a.selSym} · ${a._tf} — Loading...`;
      if(det) det.innerHTML=`Fetching historical candles...<br>Range: ${new Date(start).toLocaleDateString()} → ${new Date(end).toLocaleDateString()}`;
      if(rea) rea.textContent='';
    }
    try{
      let raw;
      if(svc.getCandles.length===1 || svc instanceof global.HistoricalDataManager){
        // HistoricalDataManager path
        raw=await svc.getCandles({symbol:a.selSym, interval:a._tf, from:start, to:end, minRequired:50});
        // map to time seconds
        raw=raw.map(c=>({ time: Math.floor(c.openTime/1000), open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume }));
      } else {
        raw=await svc.getCandles(a.selSym,a._tf,start,end);
        raw=raw.map(c=>({ time: Math.floor((c.openTime??c.time*1000)/1000) || Math.floor(c.time), open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume }));
      }
      const data=cleanRows(raw);
      if(request!==a._chartRequest) return;
      if(!data.length){
        const diag= svc.getDiagnostics ? await svc.getDiagnostics(a.selSym,a._tf) : null;
        throw Object.assign(new Error('No valid candles returned for range'), { details: diag });
      }
      this.setData(data);
      a._chartHistoryReady=true;
      const m=a.market.getMarket(a.selSym), last=data[data.length-1];
      a._curCandle={...last};
      if(m&&m.price>0) this.feedTick(m.price);
      if(a._tvChart){
        const to=data.length-1,from=Math.max(0,to-99);
        try{ a._tvChart.timeScale().setVisibleLogicalRange({from,to}); }catch(_){ a._tvChart.timeScale().scrollToRealTime(); }
      }
      this._retryCount=0;
    }catch(e){
      if(request!==a._chartRequest) return;
      // Controlled retry: max 2 auto-retries with backoff, then show error
      if(this._retryCount < 2 && !e.code){
        this._retryCount++;
        await new Promise(r=>setTimeout(r, 800*Math.pow(2,this._retryCount-1)));
        if(request===a._chartRequest) return this.load(sym,tf);
      }
      const svc2=a._chartData;
      let stats={ local:0, remote:0, valid:0, required:50 };
      if(e.details) stats={ local:e.details.localCandles||0, remote:e.details.remoteCandles||0, valid:e.details.validCandles||0, required:e.details.required||50 };
      else if(svc2 && svc2.diagnostics && svc2.diagnostics.lastRemoteFetch){
        const lr=svc2.diagnostics.lastRemoteFetch;
        stats={ local:lr.localCandles||0, remote:lr.remoteCandles||0, valid:lr.validCandles||0, required:50 };
      }
      this._showError(e, stats);
      if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Chart] historical load failed', e);
    }
  };

  loadOlder=async function(){
    const a=this.app, svc=a._chartData||global.historicalDataManager||global.chartDataService;
    if(!svc||!a._historyCache.length) return;
    a._loadingOlder=true;
    const oldRange=a._tvChart.timeScale().getVisibleRange(), first=a._historyCache[0].time*1000, span=a._tfSec*500*1000;
    try{
      let raw;
      const from=Math.max(0, first-span), to=first-1;
      if(svc.getCandles.length===1 || svc instanceof global.HistoricalDataManager){
        raw=await svc.getCandles({symbol:a.selSym, interval:a._tf, from, to, minRequired:0});
        raw=raw.map(c=>({ time: Math.floor(c.openTime/1000), open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume }));
      } else {
        raw=await svc.getCandles(a.selSym,a._tf,from,to);
        raw=raw.map(c=>({ time: Math.floor((c.openTime??c.time*1000)/1000) || Math.floor(c.time), open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume }));
      }
      const older=cleanRows(raw);
      const map=new Map(a._historyCache.map(c=>[c.time,c]));
      older.forEach(c=>map.set(c.time,c));
      this.setData([...map.values()], oldRange);
    }catch(e){ if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Chart] older history failed',e); }
    finally{ a._loadingOlder=false; }
  };

  feedTick(price){
    const a=this.app;
    if(a.replay&&a.replay.active) return;
    if(!this._chartReady && !a._chartHistoryReady) return;
    if(!a._tvCandle||!(price>0)) return;
    const now=(global.exchangeTime? global.exchangeTime.getAdjustedNow() : Date.now());
    const msNow=Math.floor(now/1000)*1000;
    const bucket=Math.floor(msNow/1000/a._tfSec)*a._tfSec;
    // Guard: no future candles (bucket beyond latest completed + 1 interval)
    const latestCompleted= global.exchangeTime? global.exchangeTime.getLatestCompletedCandle(a._tf) : Math.floor((Date.now()-1)/1000/a._tfSec)*a._tfSec*1000;
    if(bucket*1000 > latestCompleted + this.TF[a._tf]*1000){
      if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Chart] feedTick future bucket ignored',bucket);
      return;
    }
    const m=a.market.getMarket(a.selSym), size=Number(m&&m.lastTradeSize), volume=Number.isFinite(size)&&size>0?size:1;
    let c=a._curCandle;
    if(!c||c.time!==bucket){
      if(c && (bucket - c.time) > a._tfSec*10){
        if(global.DELTA_LOGGER) DELTA_LOGGER.warn('[Chart] large gap detected', {prev:c.time, bucket, gapBuckets:(bucket-c.time)/a._tfSec});
        // Do not fabricate intermediate candles — start fresh bucket
      }
      // No random gaps: only current bucket is created
      c=a._curCandle={time:bucket,open:price,high:price,low:price,close:price,volume:0};
    }
    c.high=Math.max(c.high,price);
    c.low=Math.min(c.low,price);
    c.close=price;
    c.volume=(c.volume||0)+volume;
    a._tvCandle.update(c);
    if(a._tvVol) a._tvVol.update({time:bucket,value:c.volume,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'});
    if(a.vwap) a.vwap.update(price,volume,Math.floor(now/1000));
    if(a.trading&&a.trading.mode!=='replay') try{ a.trading.onPrice(a.selSym,Number(price)); }catch(e){ if(global.DELTA_LOGGER) DELTA_LOGGER.error('[Trading] Trigger failed:',e); }
  }
}
global.ChartController=ChartController;
})(window);
