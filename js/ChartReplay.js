/* Clean TradingView-style chart replay. No backtest engine required. */
class ChartReplay {
  constructor(app){this.app=app;this.active=false;this.playing=false;this.speed=1;this.cursor=0;this.candles=[];this.timer=null;this.snapshot=null;}
  async start(){
    const chart=this.app.chartIntegration;
    if(!chart||!chart.candleSeries) throw new Error('Chart not ready');
    this.snapshot=await window.chartDataService.latest(this.app.state.get().selectedSymbol,this.app.chartTf||'1m',1000);
    if(this.snapshot.length<20) throw new Error('Not enough history');
    this.active=true;this.playing=false;this.candles=this.snapshot.map(x=>({...x}));
    this.cursor=Math.max(10,this.candles.length-200);
    chart.candleSeries.setData(this.candles.slice(0,this.cursor).map(this.toChart));
    chart.volumeSeries&&chart.volumeSeries.setData(this.candles.slice(0,this.cursor).map(x=>({time:x.time/1000,value:x.volume||0})));
    this.app.toast('Replay started','Future candles are now hidden','ok');this.updateUI();
  }
  toChart(c){return {time:Math.floor(c.time/1000),open:+c.open,high:+c.high,low:+c.low,close:+c.close};}
  step(){if(!this.active||this.cursor>=this.candles.length)return this.pause();const c=this.candles[this.cursor++],chart=this.app.chartIntegration;chart.candleSeries.update(this.toChart(c));chart.volumeSeries&&chart.volumeSeries.update({time:c.time/1000,value:c.volume||0});this.updateUI();}
  play(){if(!this.active)return;this.playing=true;this.loop();this.updateUI();}
  loop(){clearTimeout(this.timer);if(!this.playing)return;this.step();if(this.cursor>=this.candles.length){this.pause();return;}this.timer=setTimeout(()=>this.loop(),Math.max(40,1000/this.speed));}
  pause(){this.playing=false;clearTimeout(this.timer);this.updateUI();}
  stop(){this.pause();this.active=false;const chart=this.app.chartIntegration;if(chart&&this.snapshot){chart.candleSeries.setData(this.snapshot.map(this.toChart));chart.volumeSeries&&chart.volumeSeries.setData(this.snapshot.map(x=>({time:x.time/1000,value:x.volume||0})));}this.updateUI();}
  setSpeed(v){this.speed=Math.max(1,Math.min(50,+v||1));if(this.playing){this.play();}this.updateUI();}
  updateUI(){const a=this.app.$('replayBtn'),p=this.app.$('replayPlay'),s=this.app.$('replayStop'),z=this.app.$('replaySpeed');if(a)a.classList.toggle('on',this.active);if(p)p.textContent=this.playing?'Pause':'Play';if(s)s.disabled=!this.active;if(z)z.value=this.speed;}
}
window.ChartReplay=ChartReplay;