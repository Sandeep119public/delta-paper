/* State migration + risk analytics only. FinancialEngine/PaperAccountPatch own trading mutations. */
(function(global){
'use strict';
if(global.AppState){
 const oldDefault=AppState.prototype.createDefault;
 AppState.prototype.createDefault=function(){const s=oldDefault.call(this);s.grossProfit=0;s.grossLoss=0;s.tradeCount=0;s.tradeArchive=[];s.peakEquity=0;s.fundingNet=0;return s;};
 const oldMigrate=AppState.prototype.migrateState;
 AppState.prototype.migrateState=function(){oldMigrate.call(this);const s=this.state;s.tradeArchive=Array.isArray(s.tradeArchive)?s.tradeArchive:[];s.grossProfit=Number.isFinite(s.grossProfit)?s.grossProfit:0;s.grossLoss=Number.isFinite(s.grossLoss)?s.grossLoss:0;s.tradeCount=Number.isFinite(s.tradeCount)?s.tradeCount:(s.wins||0)+(s.losses||0);s.peakEquity=Number.isFinite(s.peakEquity)?s.peakEquity:0;s.fundingNet=Number.isFinite(s.fundingNet)?s.fundingNet:0;};
}
if(global.RiskMetrics){
 const Risk=RiskMetrics.prototype;
 Risk.calculate=function(){const s=this.state.getState(),trades=Array.isArray(s.tradeArchive)?s.tradeArchive:[],curve=Array.isArray(s.equityCurve)?s.equityCurve:[],wins=trades.filter(t=>Number(t.pnl)>0),losses=trades.filter(t=>Number(t.pnl)<0),total=wins.length+losses.length,gp=trades.reduce((a,t)=>a+Math.max(0,Number(t.grossPnl??t.pnl??0)),0),gl=trades.reduce((a,t)=>a+Math.max(0,-Number(t.grossPnl??t.pnl??0)),0),avgWin=wins.length?wins.reduce((a,t)=>a+Number(t.pnl),0)/wins.length:0,avgLoss=losses.length?losses.reduce((a,t)=>a+Number(t.pnl),0)/losses.length:0,wr=total?wins.length/total:0,rs=this.calculateReturns(curve),n=this._periodsPerYear(curve),dd=this.calculateMaxDrawdown(curve),years=this._years(curve),annual=years>0&&curve[0].e>0?Math.pow(curve[curve.length-1].e/curve[0].e,1/years)-1:0;return{maxDrawdown:dd.amount,maxDrawdownPercent:dd.percent,sharpeRatio:this._ratio(rs,n,0.06),sortinoRatio:this._sortino(rs,n),calmarRatio:dd.percent?annual/(dd.percent/100):(annual>0?Infinity:0),winRate:wr*100,profitFactor:gl?gp/gl:(gp?Infinity:0),expectancy:wr*avgWin+(1-wr)*avgLoss,totalTrades:total,winningTrades:wins.length,losingTrades:losses.length,averageWin:avgWin,averageLoss:avgLoss,bestTrade:trades.length?Math.max(...trades.map(t=>Number(t.pnl))):0,worstTrade:trades.length?Math.min(...trades.map(t=>Number(t.pnl))):0,totalFees:s.feesTotal||0,netPnl:trades.reduce((a,t)=>a+Number(t.pnl||0),0),grossProfit:gp,grossLoss:gl};};
 Risk.calculateReturns=function(c){const r=[];for(let i=1;i<c.length;i++)if(c[i-1].e>0&&c[i].t>c[i-1].t)r.push(c[i].e/c[i-1].e-1);return r;};
 Risk._periodsPerYear=function(c){if(c.length<2)return 365;const dt=(c[c.length-1].t-c[0].t)/Math.max(1,c.length-1);return dt>0?(365.25*86400000)/dt:365;};
 Risk._years=function(c){return c.length>1?Math.max(0,(c[c.length-1].t-c[0].t)/(365.25*86400000)):0;};
 Risk._ratio=function(rs,n,rf){if(rs.length<2)return 0;const prf=Math.pow(1+rf,1/n)-1,e=rs.map(x=>x-prf),m=e.reduce((a,b)=>a+b,0)/e.length,sd=Math.sqrt(e.reduce((a,x)=>a+x*x,0)/(e.length-1));return sd?m/sd*Math.sqrt(n):0;};
 Risk._sortino=function(rs,n){if(rs.length<2)return 0;const m=rs.reduce((a,b)=>a+b,0)/rs.length,d=Math.sqrt(rs.map(x=>Math.min(0,x)**2).reduce((a,b)=>a+b,0)/rs.length);return d?m/d*Math.sqrt(n):(m>0?Infinity:0);};
}
})(window);
