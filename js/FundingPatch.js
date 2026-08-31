/* Funding accounting hardening. */
(function(global){
  'use strict';
  if(!global.FundingSimulator)return;
  const H=8*60*60*1000;
  const anchor=t=>Math.floor(t/H)*H;
  FundingSimulator.prototype.init=function(){
    const s=this.state.getState(); this.lastFundingTime=Number.isFinite(s.lastFundingTime)?s.lastFundingTime:anchor(Date.now());
    this.checkInterval=setInterval(()=>this.checkFunding(),60000); this.checkFunding();
    DELTA_LOGGER.log('[FundingSimulator] Initialized on fixed 8h UTC funding boundaries');
  };
  FundingSimulator.prototype.checkFunding=function(){
    const now=Date.now(), next=anchor(now);
    if(next>this.lastFundingTime){
      // Apply every missed interval once per boundary, so sleep/resume cannot silently skip funding.
      let cursor=this.lastFundingTime;
      while(cursor<next){cursor+=H; if(cursor<=now)this.applyFunding(cursor);}
      this.lastFundingTime=next; this.state.update({lastFundingTime:next});
    }
  };
  FundingSimulator.prototype.applyFunding=function(fundingTimestamp=Date.now()){
    const S=this.state.getState(); let usd=S.usd, realized=S.realized||0, fundingNet=S.fundingNet||0;
    for(const [symbol,pos] of Object.entries(S.positions||{})){
      const m=this.market.getMarket(symbol); if(!m||!(m.price>0))continue;
      const rate=Number(m.funding||0); if(!Number.isFinite(rate)||rate===0)continue;
      const value=pos.qty*m.price, cashflow=pos.dir===1?-value*rate:value*rate;
      usd+=cashflow; realized+=cashflow; fundingNet+=cashflow;
      this.pushLedgerEntry({type:'Funding',detail:symbol,dInr:0,dUsd:cashflow,fundingRate:rate,positionValue:value,t:fundingTimestamp});
      this.events.emit(EVENTS.FUNDING_ACCRUED,{symbol,funding:cashflow,fundingRate:rate,positionValue:value,direction:pos.dir,timestamp:fundingTimestamp});
      if(usd<0){
        usd=0; if(global.financialEngine)global.financialEngine.liquidate(symbol,m.price,'FUNDING_MARGIN_EXHAUSTED');
      }
    }
    this.state.update({usd:Math.max(0,usd),realized,fundingNet}); this.state.flushSave();
  };
  FundingSimulator.prototype.getNextFundingTime=function(){return new Date(anchor(Date.now()+H));};
  FundingSimulator.prototype.getTimeUntilFunding=function(){return Math.max(0,this.getNextFundingTime().getTime()-Date.now());};
})(window);
