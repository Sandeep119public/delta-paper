/* Paper account integrity patch: one authoritative accounting path. */
(function(global){
'use strict';
if(!global.DeltaPaperApp) return;
const EPS=1e-8;
const appProto=DeltaPaperApp.prototype;
appProto.applyFill=function(sym,side,price,qty,lev,fee,lots){
  try{
    this.financial=this.financial||global.financialEngine;
    this.financial.fill(sym,side,price,qty,lev,fee,lots,'MARKET');
    this.flushSave(true); this.markDirty(); return true;
  }catch(e){ this.toast('Order rejected',e.message,'err'); return false; }
};
appProto.closePosition=function(sym){
  const pos=this.state.get().positions[sym]; if(!pos) return false;
  const m=this.market.getMarket(sym); if(!m||!(m.price>0)) return this.toast('No live price','Waiting for market price…','err');
  const fill=pos.dir===1?m.price*(1-(this.config.CLOSE_SLIPPAGE||0.0003)):m.price*(1+(this.config.CLOSE_SLIPPAGE||0.0003));
  const fee=Math.abs(fill*pos.qty)*(this.config.TAKER_FEE||0);
  if(!this.applyFill(sym,-pos.dir,fill,pos.qty,pos.lev,fee,pos.lots)) return false;
  const shortName=(this.config.SYM_META[sym]||{short:sym}).short;
  this.toast('Closed',shortName+' @ '+this.fmtPrice(fill,m.dec),'ok');
  return true;
};
appProto.closeAtTrigger=function(pos,label,price){
  if(!pos||!this.state.get().positions[pos.sym]) return;
  const fee=Math.abs(pos.qty*price)*(this.config.TAKER_FEE||0);
  if(!this.applyFill(pos.sym,-pos.dir,price,pos.qty,pos.lev,fee,pos.lots)) return;
  const S=this.state.get(), h=[...(S.history||[])];
  if(h.length){h[0]={...h[0],label};this.state.update({history:h});}
  this.flushSave(true);
  const m=this.market.getMarket(pos.sym)||{};
  this.toast(label,(this.config.SYM_META[pos.sym]||{short:pos.sym}).short+' closed @ '+this.fmtPrice(price,m.dec||2),label==='TP hit'?'ok':'err');
};
appProto.checkLiquidations=function(){
  const S=this.state.get();
  for(const sym of Object.keys({...S.positions})){
    const p=this.state.get().positions[sym],m=this.market.getMarket(sym);
    if(!p||!m||!(m.price>0)) continue;
    const liq=this.financial.liquidationPrice(p);
    if((p.dir===1&&m.price<=liq)||(p.dir===-1&&m.price>=liq)){
      const t=this.financial.liquidate(sym,liq);
      if(t) this.toast('LIQUIDATED','⚡ '+(this.config.SYM_META[sym]||{short:sym}).short+' — '+this.fmtUsd(Math.abs(t.pnl))+' USD lost','err');
    }
  }
  this.flushSave(true);
};
appProto.totals=function(){
  const S=this.state.get(), e=this.financial.equity(this.state.rate||this.config.BASE_RATE);
  let locked=0; Object.values(S.positions||{}).forEach(p=>locked+=Number(p.margin)||0);
  return {equity:e.unrealized,lockedMargin:locked,totalEquityUsd:e.usd+locked+e.unrealized,accountEquityUsd:e.totalUsd};
};
appProto.sampleEq=function(){
  const S=this.state.get(),rate=this.state.rate||this.config.BASE_RATE,tot=this.totals(),e=Math.round(((S.inr||0)+tot.accountEquityUsd*rate)*1e8)/1e8;
  const curve=[...(S.equityCurve||[])],last=curve[curve.length-1],now=Date.now();
  if(!last||now-last.t>=1000) curve.push({t:now,e});
  if(curve.length>5000)curve.splice(0,curve.length-5000);
  this.state.update({equityCurve:curve,peakEquity:Math.max(Number(S.peakEquity)||0,e)});
};
appProto.startSimulationLoop=function(){
  if(this._financialTimer) clearInterval(this._financialTimer);
  this._financialTimer=setInterval(()=>{this.checkTPSL();this.checkLiquidations();this.sampleEq();if(this.heatmap)this.heatmap.refresh();this.markDirty();},1000);
};
const oldReset=appProto.resetAccount;
appProto.resetAccount=function(){
  if(!confirm('Reset paper account? Everything will be wiped.')) return;
  this.state.reset(); this.hisLen=-1; this.sampleEq(); this.flushSave(true); this.renderAcct(); this.markDirty();
  this.toast('Reset ✓','Paper account restored to starting balance','ok');
};
})(window);
