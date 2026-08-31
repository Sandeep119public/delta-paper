/* Market-data status and provenance extension. */
(function(global){
  'use strict';
  if(!global.MarketDataService) return;
  const oldCtor=MarketDataService.prototype.createMarketEntry;
  MarketDataService.prototype.createMarketEntry=function(symbol){
    const m=oldCtor.call(this,symbol);
    m.lastWsUpdate=0;m.lastRestUpdate=0;m.lastTradeSize=0;m.lastTradeTime=0;
    return m;
  };
  const oldHandle=MarketDataService.prototype.handleMessage;
  MarketDataService.prototype.handleMessage=function(msg){
    this._ingestSource='ws';
    try{return oldHandle.call(this,msg);}finally{this._ingestSource=null;}
  };
  const oldApply=MarketDataService.prototype.applyTickerObj;
  MarketDataService.prototype.applyTickerObj=function(t){
    oldApply.call(this,t);
    const m=this.markets[t && t.symbol];
    if(!m) return;
    const now=Date.now();
    if(this._ingestSource==='ws') m.lastWsUpdate=now;
    else if(this._ingestSource==='rest') m.lastRestUpdate=now;
    const size=Number(t.last_trade_size ?? t.trade_size ?? t.size ?? t.q ?? t.last_size);
    if(Number.isFinite(size)&&size>0){m.lastTradeSize=size;m.lastTradeTime=now;}
  };
  const oldPoll=MarketDataService.prototype.restPoll;
  MarketDataService.prototype.restPoll=async function(){this._ingestSource='rest';try{return await oldPoll.call(this);}finally{this._ingestSource=null;}};
  const oldBoot=MarketDataService.prototype.bootREST;
  MarketDataService.prototype.bootREST=async function(){this._ingestSource='rest';try{return await oldBoot.call(this);}finally{this._ingestSource=null;}};
  MarketDataService.prototype.getStats=function(){
    const now=Date.now(), markets=Object.values(this.markets||{}), live=markets.filter(m=>m.lastWsUpdate&&now-m.lastWsUpdate<=10000).length;
    const rest=markets.filter(m=>m.lastRestUpdate&&now-m.lastRestUpdate<=10000).length;
    const sockets=this.ws&&this.ws.getStatus?this.ws.getStatus().active:0;
    let source='offline'; if(live>0&&sockets>0)source='live'; else if(rest>0)source='rest'; else if(markets.some(m=>m.price>0))source='stale';
    return {updates:this.updateCount,lastUpdate:this.lastUpdateTime,latency:this.lastUpdateTime?now-this.lastUpdateTime:null,source,sockets,liveSymbols:live,restSymbols:rest};
  };
})(window);
