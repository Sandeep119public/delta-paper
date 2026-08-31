/* Backtest isolation. Historical replay must never mutate the live account. */
(function(global){
  'use strict';
  if(!global.BacktestEngine)return;
  BacktestEngine.prototype.start=function(options={}){
    if(!this.historicalData.length){DELTA_LOGGER.warn('[BacktestEngine] No data loaded');return;}
    this.isPlaying=true;this.isPaused=false;this.currentIndex=0;this.speed=Math.max(.5,Math.min(1000,Number(options.speed)||1));
    this.replayStartTime=Date.now();this._accumulatedTime=0;this._lastFrameTime=0;this.strategy=typeof options.strategy==='function'?options.strategy:null;
    const live=this.state.getState();
    this.session={initialInr:live.inr||0,initialUsd:live.usd||0,inr:live.inr||0,usd:live.usd||0,positions:{},history:[],equityCurve:[],wins:0,losses:0,realized:0,feesTotal:0};
    this.trades=[];this._startHighPrecisionLoop();this.events.emit('backtest:started',{dataPoints:this.historicalData.length,speed:this.speed,isolated:true});
  };
  BacktestEngine.prototype._processTick=function(tick){
    const event={...tick,backtest:true};
    this.events.emit('backtest:price',event);
    if(this.strategy){try{this.strategy(event,this.session);}catch(e){DELTA_LOGGER.error('[BacktestEngine] Strategy error:',e);this.stop();return;}}
    const progress=(this.currentIndex/Math.max(1,this.historicalData.length))*100;
    this.events.emit('backtest:progress',{current:this.currentIndex,total:this.historicalData.length,percent:progress});
  };
  BacktestEngine.prototype.getResults=function(){
    const s=this.session||{initialInr:0,initialUsd:0,inr:0,usd:0,history:[],wins:0,losses:0,realized:0,feesTotal:0};
    const finalBalance=s.inr+s.usd*this.config.BASE_RATE, initialBalance=s.initialInr+s.initialUsd*this.config.BASE_RATE;
    return {initialBalance,finalBalance,totalReturn:initialBalance?((finalBalance-initialBalance)/initialBalance)*100:0,totalTrades:s.wins+s.losses,winningTrades:s.wins,losingTrades:s.losses,winRate:(s.wins+s.losses)?s.wins/(s.wins+s.losses)*100:0,maxDrawdown:0,sharpeRatio:0,profitFactor:0,dataPointsProcessed:this.currentIndex,totalDataPoints:this.historicalData.length,speed:this.speed,durationMs:this.historicalData.length>1?this.historicalData[this.historicalData.length-1].timestamp-this.historicalData[0].timestamp:0,isolated:true,replayOnly:!this.strategy};
  };
  BacktestEngine.prototype.exportResults=function(){return {...this.getResults(),tradeHistory:(this.session&&this.session.history)||[],equityCurve:(this.session&&this.session.equityCurve)||[],exportTime:Date.now()};};
})(window);
