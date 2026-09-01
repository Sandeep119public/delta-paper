/** Delta Paper Trading boot – trading isolated from chart/visualization */
(async function(){
'use strict';
DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');
const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(src+' failed to load'));document.head.appendChild(s);});
const requiredLoad = async (src) => {
  try { await loadScript(src); }
  catch(e){
    DELTA_LOGGER.error('[Boot] REQUIRED dependency failed: '+src, e);
    throw e;
  }
};
let chartLoadFailed = false;
let chartLoadError = null;
const optionalChartLoad = async (src) => {
  try { await loadScript(src); }
  catch(e){
    chartLoadFailed = true;
    chartLoadError = e;
    DELTA_LOGGER.warn('[Boot] Optional chart asset failed: '+src+' — trading will continue', e);
  }
};
// 1. Load required trading dependencies
await requiredLoad('./js/FinancialEngine.js');
await requiredLoad('./js/TradingEngine.js');
await requiredLoad('./js/data/ExchangeTime.js');
await requiredLoad('./js/data/DataVerifier.js');
await requiredLoad('./js/data/HistoricalDataStorage.js');
await requiredLoad('./js/data/HistoricalDataProvider.js');
await requiredLoad('./js/data/DataDownloader.js');
await requiredLoad('./js/data/DataDiagnostics.js');
await requiredLoad('./js/data/HistoricalDataManager.js');
// 2. Chart / visualization optional — failure must never abort boot
await optionalChartLoad('./js/data/DataManagerUI.js');
await optionalChartLoad('./js/ChartReplay.js');
await optionalChartLoad('./js/ChartController.js');
try{ await loadScript('./js/services/MarketDataStatus.js'); }catch(e){ DELTA_LOGGER.warn('[Boot] MarketDataStatus optional load failed',e); }
// 2. Initialize state/storage
const config=DELTA_CONFIG,eventBusInstance=eventBus,apiService=new DeltaApiService(config),wsService=new WebSocketService(config);
await storage.init().catch(e=>DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
const historicalStorage=new HistoricalDataStorage(); await historicalStorage.init().catch(e=>DELTA_LOGGER.warn('[Boot] Historical storage unavailable:',e.message));
const stateManager=new AppState(config,storage);await stateManager.load();
// 3-4. Initialize financial/trading engine + market services
const marketService=new MarketDataService(config,apiService,wsService),validator=new InputValidator(config);
const exchangeTime=new ExchangeTime(config);
const deltaProvider=new DeltaDataProvider(config);
const binanceProvider=new BinanceDataProvider(config);
const compositeProvider=new CompositeHistoricalProvider(config, deltaProvider, binanceProvider);
const primaryProvider = compositeProvider;
const historicalDataManager=new HistoricalDataManager(config, historicalStorage, DataVerifier, new DataDownloader(config, historicalStorage, primaryProvider), exchangeTime);
window.exchangeTime=exchangeTime;
exchangeTime.sync().catch(()=>{});
setInterval(()=> exchangeTime.sync().catch(()=>{}), 5*60*1000);
const fundingSimulator=new FundingSimulator(config,stateManager,marketService,eventBusInstance),riskMetrics=new RiskMetrics(config,stateManager),keyboardShortcuts=new KeyboardShortcuts(config,eventBusInstance),app=new DeltaPaperApp(config,stateManager,validator,marketService);
window.app=app;window.fundingSimulator=fundingSimulator;window.riskMetrics=riskMetrics;window.keyboardShortcuts=keyboardShortcuts;window.eventBus=eventBusInstance;window.financialEngine=new FinancialEngine(config,stateManager,marketService);window.tradingEngine=new TradingEngine(config,stateManager,marketService,window.financialEngine);
window.historicalStorage=historicalStorage; window.historicalDataManager=historicalDataManager; window.DataVerifier=DataVerifier;
window.deltaProvider=deltaProvider; window.binanceProvider=binanceProvider;
app.financial=window.financialEngine;app.trading=window.tradingEngine;
// 6. Chart controller — isolated
if(!chartLoadFailed && typeof ChartController !== 'undefined'){
  try{ app.chartController=new ChartController(app); }catch(e){ DELTA_LOGGER.error('[Boot] ChartController construction failed — chart disabled, trading active',e); chartLoadFailed=true; chartLoadError=e; }
} else if(chartLoadFailed){
  DELTA_LOGGER.warn('[Boot] ChartController not loaded — chart will show Unavailable state');
}
// DataManagerUI is chart-only optional
if(!chartLoadFailed && typeof DataManagerUI !== 'undefined'){
  try{ app.dataManagerUI=new DataManagerUI(app, historicalDataManager); app.openDataManager=()=> app.dataManagerUI.openManager(); app.openDiagnostics=()=> app.dataManagerUI.openDiagnostics(); }catch(e){ DELTA_LOGGER.warn('[Boot] DataManagerUI init failed',e); }
} else {
  app.openDataManager=()=> DELTA_LOGGER.warn('[Boot] DataManager unavailable — chart assets not loaded');
  app.openDiagnostics=()=> DELTA_LOGGER.warn('[Boot] Diagnostics unavailable — chart assets not loaded');
  // Ensure visible Chart Unavailable if DOM exists and chart failed to load
  if(chartLoadFailed){
    try{
      const c=document.getElementById('tv-chart-container');
      if(c && !c.querySelector('#chartErrorOverlay')){
        c.style.position='relative';
        const o=document.createElement('div');
        o.id='chartErrorOverlay';
        o.style.cssText='position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(11,15,25,0.92);z-index:10;padding:16px;';
        o.innerHTML='<div style="max-width:520px;width:100%;background:#111827;border:1px solid #243448;border-radius:12px;padding:16px;font-family:JetBrains Mono,monospace"><div style="font-weight:800;color:#f8fafc">Chart Unavailable</div><div style="font-size:11px;color:#94a3b8;margin-top:6px">'+String((chartLoadError&&chartLoadError.message)||'Chart assets failed to load')+'</div><div style="font-size:11px;color:#22c55e;margin-top:8px">Trading, TP/SL and liquidation continue to operate.</div><button class="mini-btn" onclick="location.reload()" style="margin-top:10px">Retry</button></div>';
        c.appendChild(o);
      }
    }catch(_){}
  }
}
// 5. Start application/trading loop — MUST be awaited
try {
  await app.init();
} catch (e) {
  DELTA_LOGGER.error('[Boot] App init failed — attempting isolated recovery', e);
  try {
    app.startSimulationLoop();
    app.renderAll();
  } catch (e2) {
    DELTA_LOGGER.error('[Boot] Isolated recovery failed', e2);
  }
}
// 7-8. Optional visualizations / UI helpers — each isolated, never blocks trading
try{ if(app.dataManagerUI) app.dataManagerUI.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] DataManagerUI init failed',e); }
try{ fundingSimulator.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] FundingSimulator init failed',e); }
try{ keyboardShortcuts.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] KeyboardShortcuts init failed',e); }
marketService.init().then(()=>DELTA_LOGGER.log('[Boot] Market data initialized')).catch(e=>DELTA_LOGGER.error('[Boot] market init failed',e));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(e=>DELTA_LOGGER.error('[Boot] Service Worker failed',e));
DELTA_LOGGER.log('[Boot] Application ready — trading isolated from chart');
})();
