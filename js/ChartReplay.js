/* Chart replay controller. Designed to work even when history is still loading. */
(function(global){
'use strict';
class ChartReplay {
  constructor(app){
    this.app=app; this.active=false; this.playing=false; this.speed=1;
    this.index=0; this.timer=null; this.source=[]; this.startedAt=0;
  }
  async start(){
    const a=this.app;
    if((!a._historyCache || a._historyCache.length<20) && typeof a._loadCandles==='function'){
      this._status('Loading history…');
      await a._loadCandles(a.selSym,a._tf);
      await new Promise(resolve=>{
        const until=Date.now()+8000;
        const tick=()=>((a._historyCache||[]).length>=20||Date.now()>until)?resolve():setTimeout(tick,120);
        tick();
      });
    }
    if(!a._historyCache || a._historyCache.length<20) throw new Error('Not enough candle history yet. Wait for the chart to load and try again.');
    this.source=a._historyCache.slice().sort((x,y)=>Number(x.time)-Number(y.time));
    this.index=Math.max(19,Math.min(this.source.length-2,Math.floor(this.source.length*.70)));
    this.active=true; this.playing=false; this.startedAt=Date.now();
    this.render(); this.ui(); this._status('Replay ready');
    return true;
  }
  render(){
    const a=this.app, visible=this.source.slice(0,this.index+1);
    if(a._tvCandle) a._tvCandle.setData(visible);
    if(a._tvVol) a._tvVol.setData(visible.map(c=>({time:c.time,value:Number(c.volume)||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));
    a._curCandle=visible[visible.length-1]||null;
    if(a._tvChart){try{a._tvChart.timeScale().scrollToRealTime();}catch(_){}}
  }
  step(){
    if(!this.active)return;
    if(this.index>=this.source.length-1){this.pause();this._status('Replay finished');return;}
    this.index++; this.render(); this._status('Replay '+(this.index+1)+' / '+this.source.length);
  }
  play(){
    if(!this.active)return this.start().then(()=>this.play());
    this.playing=true; this.ui(); this._status('Playing • '+this.speed+'x'); this.loop();
  }
  loop(){
    clearTimeout(this.timer);
    if(!this.playing)return;
    this.step();
    if(!this.playing)return;
    this.timer=setTimeout(()=>this.loop(),Math.max(80,900/this.speed));
  }
  pause(){this.playing=false;clearTimeout(this.timer);this.ui();if(this.active)this._status('Paused');}
  stop(){
    this.pause();
    const a=this.app;
    this.active=false;
    if(a._historyCache && a._historyCache.length && a._setChartData) a._setChartData(a._historyCache);
    this.source=[]; this.ui(); this._status('');
  }
  setSpeed(v){this.speed=Math.max(1,Math.min(50,Number(v)||1));if(this.playing)this._status('Playing • '+this.speed+'x');}
  _status(text){const el=this.app.$('replayStatus');if(el)el.textContent=text;}
  ui(){
    const a=this.app,b=a.$('replayBtn'),p=a.$('replayPlay'),s=a.$('replayStop'),z=a.$('replaySpeed');
    if(b){b.textContent=this.active?'Exit':'Replay';b.classList.toggle('on',this.active);}
    if(p){p.textContent=this.playing?'Pause':'Play';p.hidden=!this.active;}
    if(s)s.hidden=!this.active;
    if(z){z.hidden=!this.active;z.value=String(this.speed);}
  }
}
global.ChartReplay=ChartReplay;
})(window);