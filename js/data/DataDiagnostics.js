/* DataDiagnostics: collects and formats diagnostics for UI */
(function(global){
'use strict';
class DataDiagnostics {
  constructor(manager){ this.manager=manager; }
  async snapshot(symbol, interval){
    const mgr=this.manager;
    const meta= mgr.storage ? await mgr.storage.getMeta(symbol,interval) : null;
    const verify= mgr.verifier ? await mgr.verify(symbol,interval) : null;
    const diag= await mgr.getDiagnostics(symbol,interval);
    return {
      symbol, interval,
      local: diag.local,
      remote: diag.remote,
      verify,
      meta,
      lastError: diag.lastError,
      lastRequest: diag.lastRequest,
      status: meta? meta.status : 'EMPTY'
    };
  }
  format(snapshot){
    const lines=[];
    lines.push(`Symbol: ${snapshot.symbol}`);
    lines.push(`Interval: ${snapshot.interval}`);
    lines.push('--- LOCAL STORAGE ---');
    lines.push(`Records: ${snapshot.local.count}`);
    lines.push(`Earliest: ${snapshot.local.earliest? new Date(snapshot.local.earliest).toISOString() : '—'}`);
    lines.push(`Latest: ${snapshot.local.latest? new Date(snapshot.local.latest).toISOString() : '—'}`);
    lines.push(`Health: ${snapshot.local.health}% (${snapshot.local.status})`);
    lines.push(`Missing: ${snapshot.local.missing}`);
    lines.push('--- REMOTE SOURCE ---');
    if(snapshot.remote) lines.push(`Remote received: ${snapshot.remote.remoteCandles ?? snapshot.remote.count ?? '—'}`);
    else lines.push('Remote: no fetch yet');
    if(snapshot.lastError) lines.push(`Last error: ${snapshot.lastError}`);
    lines.push('--- CHART ---');
    lines.push(`Min required: 100`);
    lines.push(`Available: ${snapshot.local.count}`);
    lines.push(`Status: ${snapshot.local.count>=100? 'READY':'INSUFFICIENT'}`);
    return lines.join('\n');
  }
}
global.DataDiagnostics=DataDiagnostics;
})(typeof window!=='undefined'?window:globalThis);
