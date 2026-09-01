/* DataManagerUI: Historical Data Manager UI + Download UI + Diagnostics */
(function(global){
'use strict';
class DataManagerUI {
  constructor(app, manager){
    this.app=app; this.manager=manager;
    this.el=null; this.diagEl=null;
  }
  init(){
    this._injectStyles();
    this._createManagerOverlay();
    this._createDiagnosticsOverlay();
    this._bindChartButton();
  }
  _injectStyles(){
    if(document.getElementById('dataMgrStyles')) return;
    const s=document.createElement('style');
    s.id='dataMgrStyles';
    s.textContent=`
    #dataManagerOverlay .modal{max-width:640px}
    .dm-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
    .dm-stat{background:rgba(0,0,0,0.15);border:1px solid #243448;border-radius:10px;padding:8px}
    .dm-stat span{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px;font-weight:700;display:block}
    .dm-stat b{font-family:JetBrains Mono,monospace;font-size:12px;color:#f8fafc;display:block;margin-top:2px;overflow:hidden;text-overflow:ellipsis}
    .dm-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
    .dm-progress{height:6px;background:#0d1420;border-radius:3px;overflow:hidden;margin:8px 0}
    .dm-fill{height:100%;width:0%;background:#3b82f6;transition:width .2s}
    .dm-field{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
    .dm-field label{font-size:11px;color:#94a3b8;font-weight:600}
    .dm-field select,.dm-field input{background:rgba(0,0,0,0.2);border:1px solid #334155;border-radius:8px;color:#f8fafc;padding:8px;font-size:13px}
    #dataBtn{padding:5px 10px;font-size:10px;font-weight:700;border-radius:6px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.3);color:#3b82f6;font-family:JetBrains Mono,monospace}
    #dataBtn.on{background:rgba(16,185,129,0.12);border-color:rgba(16,185,129,0.3);color:#10b981}
    .dm-table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}
    .dm-table th{font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;padding:6px 8px;text-align:left;border-bottom:1px solid #243448}
    .dm-table td{padding:6px 8px;border-bottom:1px solid rgba(36,52,72,0.3);font-family:JetBrains Mono,monospace}
    .dm-usage{font-size:11px;color:#94a3b8;background:rgba(0,0,0,0.15);border:1px solid #243448;border-radius:8px;padding:8px;margin-top:10px;line-height:1.6}
    `;
    document.head.appendChild(s);
  }
  _createManagerOverlay(){
    if(document.getElementById('dataManagerOverlay')) return;
    const overlay=document.createElement('div');
    overlay.className='overlay'; overlay.id='dataManagerOverlay';
    overlay.innerHTML=`<div class="modal">
      <div class="modal-h"><h3>Historical Data</h3><button class="x-btn" data-close-m="dataManagerOverlay">✕</button></div>
      <div class="modal-b">
        <div class="dm-field" style="flex-direction:row;gap:8px">
          <div class="dm-field" style="flex:1"><label>Symbol</label><select id="dmSymbol"><option value="BTCUSD">BTCUSD</option><option value="ETHUSD">ETHUSD</option><option value="SOLUSD">SOLUSD</option></select></div>
          <div class="dm-field" style="flex:1"><label>Timeframe</label><select id="dmInterval"><option value="1m">1m</option><option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option></select></div>
        </div>
        <div id="dmStatus" style="font-size:11px;color:#94a3b8;margin:6px 0">Loading...</div>
        <div class="dm-grid">
          <div class="dm-stat"><span>Status</span><b id="dmStatStatus">—</b></div>
          <div class="dm-stat"><span>Health</span><b id="dmStatHealth">—</b></div>
          <div class="dm-stat"><span>Available range</span><b id="dmStatRange">—</b></div>
          <div class="dm-stat"><span>Candles</span><b id="dmStatCount">—</b></div>
          <div class="dm-stat"><span>Earliest</span><b id="dmStatEarliest">—</b></div>
          <div class="dm-stat"><span>Latest</span><b id="dmStatLatest">—</b></div>
        </div>
        <div class="dm-actions">
          <button class="mini-btn" id="dmDownload">Download</button>
          <button class="mini-btn" id="dmVerify">Verify</button>
          <button class="mini-btn" id="dmRepair">Repair</button>
          <button class="mini-btn" id="dmDelete" style="color:#ef4444;border-color:rgba(239,68,68,0.3)">Delete</button>
          <button class="mini-btn" id="dmDiagnostics">Diagnostics</button>
        </div>
        <div id="dmStoredWrap" style="margin-top:12px">
          <div style="font-weight:700;font-size:11px;color:#94a3b8;margin-bottom:4px">STORED DATA</div>
          <table class="dm-table" id="dmTable"><thead><tr><th>Symbol</th><th>Interval</th><th>First</th><th>Last</th><th>Candles</th><th>Health</th><th></th></tr></thead><tbody id="dmTableBody"><tr><td colspan="7" style="text-align:center;color:#64748b">Loading...</td></tr></tbody></table>
        </div>
        <div id="dmUsage" class="dm-usage">Estimating storage usage...</div>
        <div id="dmDownloadPanel" style="display:none;margin-top:12px;border:1px solid #243448;border-radius:10px;padding:10px">
          <div style="font-weight:700;font-size:12px;margin-bottom:6px">Download</div>
          <div class="dm-field"><label>From</label><input type="date" id="dmFrom"></div>
          <div class="dm-field"><label>To</label><input type="date" id="dmTo"></div>
          <div id="dmProgressWrap" style="display:none">
            <div style="font-size:11px;color:#94a3b8" id="dmProgressText">0%</div>
            <div class="dm-progress"><div class="dm-fill" id="dmFill"></div></div>
            <div style="font-size:11px;color:#94a3b8" id="dmProgressDetail"></div>
          </div>
          <div class="dm-actions">
            <button class="mini-btn" id="dmStart">Start</button>
            <button class="mini-btn" id="dmPause">Pause</button>
            <button class="mini-btn" id="dmResume">Resume</button>
            <button class="mini-btn" id="dmCancel">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.classList.remove('show'); });
    overlay.querySelector('[data-close-m="dataManagerOverlay"]').addEventListener('click',()=> overlay.classList.remove('show'));
    const $=id=>overlay.querySelector('#'+id);
    $('dmSymbol').value=this.app.selSym||'BTCUSD';
    $('dmInterval').value=this.app._tf||'1m';
    const refresh=()=> this.refresh();
    $('dmSymbol').addEventListener('change',refresh);
    $('dmInterval').addEventListener('change',refresh);
    $('dmVerify').addEventListener('click',async()=>{ const v=await this.manager.verify($('dmSymbol').value,$('dmInterval').value); this.app.toast('Verify', `Health ${v.health}% Missing ${v.missing} Invalid ${v.invalid}`, ''); this.refresh(); });
    $('dmRepair').addEventListener('click',async()=>{ $('dmRepair').disabled=true; const r=await this.manager.repair($('dmSymbol').value,$('dmInterval').value); this.app.toast('Repair', `Health ${r.health}%`, 'ok'); $('dmRepair').disabled=false; this.refresh(); });
    $('dmDelete').addEventListener('click',async()=>{ if(!confirm('Delete local candles for '+$('dmSymbol').value+' · '+$('dmInterval').value+'?'))return; await this.manager.deleteRange($('dmSymbol').value,$('dmInterval').value); this.app.toast('Deleted','Local data cleared',''); this.refresh(); });
    $('dmDiagnostics').addEventListener('click',()=>{ overlay.classList.remove('show'); this.openDiagnostics(); });
    $('dmDownload').addEventListener('click',()=>{ $('dmDownloadPanel').style.display=$('dmDownloadPanel').style.display==='none'?'block':'none'; });
    const today=new Date().toISOString().slice(0,10);
    const monthAgo=new Date(Date.now()-30*24*60*60*1000).toISOString().slice(0,10);
    $('dmFrom').value=monthAgo; $('dmTo').value=today;
    $('dmStart').addEventListener('click',async()=>{
      const sym=$('dmSymbol').value, interval=$('dmInterval').value;
      const from=new Date($('dmFrom').value).getTime(), to=new Date($('dmTo').value).getTime()+86400000-1;
      if(!Number.isFinite(from)||!Number.isFinite(to)||from>=to) return this.app.toast('Invalid range','Check dates','err');
      // Estimate before download
      try{
        const est=await this.manager.estimateDownload(from,to,interval);
        const mb=(est.estimatedBytes/1048576).toFixed(1);
        const avail=est.availableBytes===Infinity? 'unknown': (est.availableBytes/1048576).toFixed(1)+' MB';
        if(est.estimate.supported && est.estimate.percentage>=90){
          if(!confirm(`Storage is nearly full (${est.estimate.percentage}%). Estimated download ${mb} MB. Continue?`)) return;
        } else if(!est.enough){
          if(!confirm(`Estimated download ${mb} MB exceeds available ${avail}. Continue anyway?`)) return;
        } else {
          // show estimate
          $('dmProgressDetail').textContent=`Estimated: ${est.candles.toLocaleString()} candles ~${mb} MB (available ${avail})`;
        }
      }catch(e){}
      $('dmProgressWrap').style.display='block';
      try{
        await this.manager.downloadRange({symbol:sym, interval, from, to, onProgress:p=>{
          $('dmFill').style.width=p.percent+'%';
          $('dmProgressText').textContent=p.percent+'% — '+p.downloaded+' / '+p.totalExpected+' candles';
          $('dmProgressDetail').textContent=p.done? 'Done' : new Date(p.cursor).toLocaleDateString();
        }});
        this.app.toast('Download complete','Historical data saved','ok');
        this.refresh();
        if(sym===this.app.selSym && interval===this.app._tf && this.app.chartController) this.app.chartController.load(sym, interval);
      }catch(e){
        if(e.code==='QUOTA_WARNING' || /quota/i.test(e.message)) this.app.toast('Storage warning', e.message,'err');
        else this.app.toast('Download failed', e.message,'err');
      }
    });
    $('dmPause').addEventListener('click',()=> this.manager.pauseDownload());
    $('dmResume').addEventListener('click',()=> this.manager.resumeDownload());
    $('dmCancel').addEventListener('click',()=> this.manager.cancelDownload());
  }
  _createDiagnosticsOverlay(){
    if(document.getElementById('diagOverlay')) return;
    const overlay=document.createElement('div');
    overlay.className='overlay'; overlay.id='diagOverlay';
    overlay.innerHTML=`<div class="modal"><div class="modal-h"><h3>Data Diagnostics</h3><button class="x-btn" data-close-m="diagOverlay">✕</button></div>
      <div class="modal-b" style="font-family:JetBrains Mono,monospace;font-size:11px;line-height:1.6">
        <div id="diagContent" style="white-space:pre-wrap;background:rgba(0,0,0,0.2);border:1px solid #243448;border-radius:8px;padding:10px;max-height:50vh;overflow:auto">—</div>
        <div class="dm-actions"><button class="mini-btn" id="diagRefresh">Refresh</button><button class="mini-btn" id="diagCopy">Copy</button></div>
      </div></div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) overlay.classList.remove('show'); });
    overlay.querySelector('[data-close-m="diagOverlay"]').addEventListener('click',()=> overlay.classList.remove('show'));
    overlay.querySelector('#diagRefresh').addEventListener('click',()=> this.refreshDiagnostics());
    overlay.querySelector('#diagCopy').addEventListener('click',()=>{ const t=overlay.querySelector('#diagContent').textContent; navigator.clipboard.writeText(t).then(()=>this.app.toast('Copied','Diagnostics copied','ok')).catch(()=>{}); });
  }
  _bindChartButton(){
    const tfRow=document.querySelector('.tf-row');
    if(!tfRow || document.getElementById('dataBtn')) return;
    const btn=document.createElement('button');
    btn.id='dataBtn'; btn.textContent='Data';
    btn.title='Historical Data Manager';
    btn.addEventListener('click',()=> this.openManager());
    tfRow.appendChild(btn);
  }
  openManager(){
    const overlay=document.getElementById('dataManagerOverlay');
    if(overlay){ overlay.classList.add('show'); this.refresh(); }
  }
  openDiagnostics(){
    const overlay=document.getElementById('diagOverlay');
    if(overlay){ overlay.classList.add('show'); this.refreshDiagnostics(); }
  }
  async _renderTable(){
    const tbody=document.getElementById('dmTableBody');
    if(!tbody) return;
    const symbols=this.app.config.SYMBOLS || ['BTCUSD','ETHUSD','SOLUSD'];
    const intervals=['1m','5m','15m','1h'];
    const rows=[];
    for(const s of symbols) for(const iv of intervals){
      const meta=await this.manager.storage.getMeta(s, iv);
      if(meta && meta.candleCount>0) rows.push(meta);
    }
    if(!rows.length){ tbody.innerHTML='<tr><td colspan="7" style="text-align:center;color:#64748b">No stored data — download to begin.</td></tr>'; return; }
    tbody.innerHTML='';
    for(const m of rows){
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${m.symbol}</td><td>${m.interval}</td><td>${m.earliestTimestamp? new Date(m.earliestTimestamp).toLocaleDateString():'—'}</td><td>${m.latestTimestamp? new Date(m.latestTimestamp).toLocaleDateString():'—'}</td><td>${m.candleCount.toLocaleString()}</td><td>${m.healthScore}%</td><td><button class="mini-btn" data-del="${m.symbol}|${m.interval}" style="padding:2px 6px;font-size:10px">Del</button></td>`;
      tbody.appendChild(tr);
    }
    tbody.querySelectorAll('[data-del]').forEach(b=> b.addEventListener('click', async()=>{
      const [sym,iv]=b.dataset.del.split('|');
      if(!confirm('Delete '+sym+' '+iv+'?')) return;
      await this.manager.deleteRange(sym,iv); this.refresh();
    }));
  }
  async _renderUsage(){
    const el=document.getElementById('dmUsage');
    if(!el) return;
    let text='IndexedDB Usage\n';
    if(navigator.storage && navigator.storage.estimate){
      try{
        const est=await navigator.storage.estimate();
        const used=(est.usage||0), quota=(est.quota||0);
        const fmt=b=> b>1073741824? (b/1073741824).toFixed(2)+' GB' : b>1048576? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';
        text+=`Used: ${fmt(used)} / ${fmt(quota)} (${quota? Math.round(used/quota*100):0}%)\n`;
      }catch(e){ text+='Used: unknown\n'; }
    }
    // Per-symbol estimates via candle counts
    const symbols=this.app.config.SYMBOLS || ['BTCUSD','ETHUSD','SOLUSD'];
    for(const s of symbols){
      const meta=await this.manager.storage.getMeta(s,'1m');
      if(meta && meta.candleCount) text+=`${s}: ${meta.candleCount.toLocaleString()} candles\n`;
    }
    el.textContent=text;
  }
  async refresh(){
    const sym=document.getElementById('dmSymbol')?.value || this.app.selSym;
    const interval=document.getElementById('dmInterval')?.value || this.app._tf;
    const diag=await this.manager.getDiagnostics(sym, interval);
    const statusEl=document.getElementById('dmStatStatus');
    const healthEl=document.getElementById('dmStatHealth');
    const rangeEl=document.getElementById('dmStatRange');
    const countEl=document.getElementById('dmStatCount');
    const earliestEl=document.getElementById('dmStatEarliest');
    const latestEl=document.getElementById('dmStatLatest');
    const statusMsg=document.getElementById('dmStatus');
    if(statusEl) statusEl.textContent=diag.local.status;
    if(healthEl) healthEl.textContent=diag.local.health + '%';
    if(countEl) countEl.textContent=String(diag.local.count);
    if(earliestEl) earliestEl.textContent=diag.local.earliest? new Date(diag.local.earliest).toLocaleDateString() : '—';
    if(latestEl) latestEl.textContent=diag.local.latest? new Date(diag.local.latest).toLocaleDateString() : '—';
    if(rangeEl) rangeEl.textContent= diag.local.earliest && diag.local.latest ? `${new Date(diag.local.earliest).toLocaleDateString()} → ${new Date(diag.local.latest).toLocaleDateString()}` : 'Not downloaded';
    if(statusMsg){
      if(diag.local.count===0) statusMsg.textContent='Not downloaded — use Download to fetch history.';
      else if(diag.local.status==='GOOD') statusMsg.textContent='Verified — ready for chart & replay.';
      else statusMsg.textContent=`Status: ${diag.local.status} — missing ${diag.local.missing} candles`;
    }
    this._renderTable();
    this._renderUsage();
  }
  async refreshDiagnostics(){
    const sym=document.getElementById('dmSymbol')?.value || this.app.selSym;
    const interval=document.getElementById('dmInterval')?.value || this.app._tf;
    const snap= await new global.DataDiagnostics(this.manager).snapshot(sym, interval);
    const fmtDate=v=> v? new Date(v).toISOString() : '—';
    const txt=[
      'DATA DIAGNOSTICS',
      '',
      `Symbol: ${snap.symbol}`,
      `Interval: ${snap.interval}`,
      '------------------------',
      'LOCAL STORAGE',
      `Records: ${snap.local.count}`,
      `Earliest: ${fmtDate(snap.local.earliest)}`,
      `Latest: ${fmtDate(snap.local.latest)}`,
      `Health: ${snap.local.health}% (${snap.local.status})`,
      `Missing: ${snap.local.missing}`,
      '------------------------',
      'REMOTE SOURCE',
      `Remote (Delta): ${snap.lastError? 'Failed' : (snap.remote? 'Connected':'No fetch yet')}`,
      `Last request: ${snap.lastRequest? JSON.stringify(snap.lastRequest): '—'}`,
      `Response candles: ${snap.remote? (snap.remote.remoteCandles ?? snap.remote.count ?? '—') : '—'}`,
      `Valid: ${snap.local.count}`,
      `Invalid: ${snap.verify? snap.verify.invalid : '—'}`,
      '------------------------',
      'CHART',
      `Minimum required: 100`,
      `Available: ${snap.local.count}`,
      `Status: ${snap.local.count>=100? 'READY':'INSUFFICIENT'}`,
      snap.lastError? `Last error: ${snap.lastError}`: ''
    ].join('\n');
    const el=document.getElementById('diagContent');
    if(el) el.textContent=txt;
  }
}
global.DataManagerUI=DataManagerUI;
})(typeof window!=='undefined'?window:globalThis);
