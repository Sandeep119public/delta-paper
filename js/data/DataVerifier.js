/* DataVerifier: single source of truth for candle validation, dedup, gaps, health. */
(function(global){
'use strict';
const INTERVAL_MS = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000 };

function intervalMs(interval){
  if(INTERVAL_MS[interval]) return INTERVAL_MS[interval];
  const m=String(interval).match(/^(\d+)([mhdw])$/i);
  if(!m) throw Error('Unsupported interval: '+interval);
  const n=+m[1],u=m[2].toLowerCase();
  return n*(u==='m'?6e4:u==='h'?36e5:u==='d'?864e5:6048e5);
}

function isValidOhlc(c){
  if(!c||typeof c!=='object') return false;
  const vals=[c.open,c.high,c.low,c.close,c.volume];
  // volume can be 0
  for(let i=0;i<4;i++){ const v=vals[i]; if(!Number.isFinite(v)||v<=0) return false; }
  if(!Number.isFinite(c.volume)||c.volume<0) return false;
  if(!Number.isFinite(c.openTime)||c.openTime<0) return false;
  if(c.high < c.open || c.high < c.close) return false;
  if(c.low > c.open || c.low > c.close) return false;
  if(c.high < c.low) return false;
  return true;
}

function normalizeCandles(rows){
  // rows expected as {openTime,open,high,low,close,volume} or time-based
  const map=new Map();
  let invalid=0, dup=0;
  for(const r of rows||[]){
    let t;
    if(Number.isFinite(r.openTime)) t=Number(r.openTime);
    else if(Number.isFinite(r.time)) t=Number(r.time)>1e11? Number(r.time): Number(r.time)*1000;
    else t=NaN;
    const c={ symbol:r.symbol, interval:r.interval, openTime:t, open:+r.open, high:+r.high, low:+r.low, close:+r.close, volume:+(r.volume??0), closeTime:+(r.closeTime??0), trades:+(r.trades??0) };
    if(!isValidOhlc(c)){ invalid++; continue; }
    if(map.has(t)){ dup++; continue; }
    map.set(t,c);
  }
  const sorted=[...map.values()].sort((a,b)=>a.openTime-b.openTime);
  return { candles:sorted, invalid, duplicates:dup };
}

function findGaps(sortedRows, start, end, step){
  const have=new Set(sortedRows.map(r=>r.openTime));
  const alignedStart=Math.floor(start/step)*step;
  const alignedEnd=Math.floor(end/step)*step;
  const gaps=[];
  let gapStart=null;
  for(let t=alignedStart;t<=alignedEnd;t+=step){
    if(!have.has(t)){ if(gapStart===null) gapStart=t; }
    else if(gapStart!==null){ gaps.push([gapStart,t-step]); gapStart=null; }
  }
  if(gapStart!==null) gaps.push([gapStart,alignedEnd]);
  return gaps;
}

function healthScore({totalExpected, missing, invalid, duplicates}){
  if(!totalExpected||totalExpected<=0) return 100;
  const bad=missing+invalid+duplicates;
  const score=Math.max(0, Math.min(100, (1 - bad/totalExpected)*100));
  return Math.round(score*100)/100;
}

function statusFor(score){
  if(score>=99.5) return 'GOOD';
  if(score>=95) return 'FAIR';
  if(score>=80) return 'DEGRADED';
  return 'POOR';
}

function validateTimestamps(rows, interval){
  const step=intervalMs(interval);
  const issues=[];
  for(let i=1;i<rows.length;i++){
    const diff=rows[i].openTime - rows[i-1].openTime;
    if(diff<0) issues.push({type:'out_of_order', index:i});
    if(diff===0) issues.push({type:'duplicate', index:i});
    if(diff>0 && diff!==step && diff%step!==0) issues.push({type:'gap', index:i, gap:diff});
    if(rows[i].openTime % step !==0) issues.push({type:'misaligned', index:i});
  }
  return issues;
}

const DataVerifier={ intervalMs, isValidOhlc, normalizeCandles, findGaps, healthScore, statusFor, validateTimestamps, INTERVAL_MS };
global.DataVerifier=DataVerifier;
if(typeof module!=='undefined'&&module.exports) module.exports=DataVerifier;
})(typeof window!=='undefined'?window:globalThis);
