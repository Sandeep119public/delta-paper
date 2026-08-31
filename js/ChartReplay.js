/* Lightweight chart replay controller compatible with ChartIntegrationPatch. */
(function(global){'use strict';
class ChartReplay{
constructor(app){this.app=app;this.active=false;this.playing=false;this.speed=1;this.index=0;this.timer=null;this.source=[];}
async start(){const a=this.app;if(!a._historyCache||a._historyCache.length<20)throw new Error('Historical candles are still loading');this.source=a._historyCache.slice().sort((x,y)=>x.time-y.time);this.index=Math.max(10,Math.floor(this.source.length*.7));this.active=true;this.playing=false;this.render();this.ui();a.toast('Replay ready','Future candles are hidden. Press Play to advance.','ok');}
render(){const a=this.app,v=this.source.slice(0,this.index+1);if(a._tvCandle)a._tvCandle.setData(v);if(a._tvVol)a._tvVol.setData(v.map(c=>({time:c.time,value:c.volume||0,color:c.close>=c.open?'rgba(16,185,129,.35)':'rgba(239,68,68,.35)'})));a._curCandle=v[v.length-1]||null;if(a._tvChart)a._tvChart.timeScale().scrollToRealTime();}
step(){if(!this.active)return;if(this.index>=this.source.length-1){this.pause();return;}this.index++;this.render();}
play(){if(!this.active)return;this.playing=true;this.ui();this.loop();}
loop(){clearTimeout(this.timer);if(!this.playing)return;this.step();if(!this.playing)return;this.timer=setTimeout(()=>this.loop(),Math.max(60,1000/this.speed));}
pause(){this.playing=false;clearTimeout(this.timer);this.ui();}
stop(){this.pause();if(!this.active)return;this.active=false;const a=this.app;this.source=[];if(a._historyCache)a._setChartData(a._historyCache);this.ui();}
setSpeed(v){this.speed=Math.max(1,Math.min(50,Number(v)||1));}
ui(){const a=this.app,b=a.$('replayBtn'),p=a.$('replayPlay'),s=a.$('replayStop'),z=a.$('replaySpeed');if(b){b.textContent=this.active?'Exit Replay':'Replay';b.classList.toggle('on',this.active);}if(p){p.textContent=this.playing?'Pause':'Play';p.style.display=this.active?'':'none';}if(s)s.style.display=this.active?'':'none';if(z){z.style.display=this.active?'':'none';z.value=this.speed;}}
}
global.ChartReplay=ChartReplay;})(window);