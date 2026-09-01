/** Delta Paper Trading boot – trading isolated from chart/visualization */
(async function(){
'use strict';
DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');
const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(src+' failed to load'));document.head.appendChild(s);});
try{ await loadScript('./js/FinancialEngine.js'); }catch(e){ DELTA_LOGGER.error('[Boot] FinancialEngine load failed',e); }
try{ await loadScript('./js/TradingEngine.js'); }catch(e){ DELTA_LOGGER.error('[Boot] TradingEngine load failed',e); }
await loadScript('./js/data/ExchangeTime.js');
await loadScript('./js/data/DataVerifier.js');
await loadScript('./js/data/HistoricalDataStorage.js');
await loadScript('./js/data/HistoricalDataProvider.js');
await loadScript('./js/data/DataDownloader.js');
await loadScript('./js/data/DataDiagnostics.js');
await loadScript('./js/data/HistoricalDataManager.js');
await loadScript('./js/data/DataManagerUI.js');
await loadScript('./js/ChartReplay.js');
await loadScript('./js/ChartController.js');
try{ await loadScript('./js/services/MarketDataStatus.js'); }catch(e){ DELTA_LOGGER.warn('[Boot] MarketDataStatus optional load failed',e); }
const config=DELTA_CONFIG,eventBusInstance=eventBus,apiService=new DeltaApiService(config),wsService=new WebSocketService(config);
await storage.init().catch(e=>DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
const historicalStorage=new HistoricalDataStorage(); await historicalStorage.init().catch(e=>DELTA_LOGGER.warn('[Boot] Historical storage unavailable:',e.message));
const stateManager=new AppState(config,storage);await stateManager.load();
const marketService=new MarketDataService(config,apiService,wsService),validator=new InputValidator(config);
const exchangeTime=new ExchangeTime(config);
// Primary: Delta India candles; fallback Binance only when explicitly enabled
const deltaProvider=new DeltaDataProvider(config);
const binanceProvider=new BinanceDataProvider(config);
const compositeProvider=new CompositeHistoricalProvider(config, deltaProvider, binanceProvider);
const primaryProvider = compositeProvider; // genuinely provider-agnostic abstraction; composite handles fallback policy
const historicalDataManager=new HistoricalDataManager(config, historicalStorage, DataVerifier, new DataDownloader(config, historicalStorage, primaryProvider), exchangeTime);
window.exchangeTime=exchangeTime;
exchangeTime.sync().catch(()=>{});
setInterval(()=> exchangeTime.sync().catch(()=>{}), 5*60*1000);
const fundingSimulator=new FundingSimulator(config,stateManager,marketService,eventBusInstance),riskMetrics=new RiskMetrics(config,stateManager),keyboardShortcuts=new KeyboardShortcuts(config,eventBusInstance),app=new DeltaPaperApp(config,stateManager,validator,marketService);
window.app=app;window.fundingSimulator=fundingSimulator;window.riskMetrics=riskMetrics;window.keyboardShortcuts=keyboardShortcuts;window.eventBus=eventBusInstance;window.financialEngine=new FinancialEngine(config,stateManager,marketService);window.tradingEngine=new TradingEngine(config,stateManager,marketService,window.financialEngine);
window.historicalStorage=historicalStorage; window.historicalDataManager=historicalDataManager; window.DataVerifier=DataVerifier;
window.deltaProvider=deltaProvider; window.binanceProvider=binanceProvider;
app.financial=window.financialEngine;app.trading=window.tradingEngine;
try{ app.chartController=new ChartController(app); }catch(e){ DELTA_LOGGER.error('[Boot] ChartController construction failed',e); }
try{ app.dataManagerUI=new DataManagerUI(app, historicalDataManager); app.openDataManager=()=> app.dataManagerUI.openManager(); app.openDiagnostics=()=> app.dataManagerUI.openDiagnostics(); }catch(e){ DELTA_LOGGER.warn('[Boot] DataManagerUI init failed',e); }
// 1. Initialize market/state/trading is already done (stateManager loaded, marketService constructed)
// 2. Start simulation/trigger loop BEFORE chart — must not depend on chart
// 3. Render base UI, 4. chart in failure boundary, 5. visualization independently
try{ app.init(); }catch(e){ DELTA_LOGGER.error('[Boot] App init failed — attempting isolated recovery',e); try{ app.startSimulationLoop(); app.renderAll(); }catch(e2){ DELTA_LOGGER.error('[Boot] Isolated recovery failed',e2); } }
try{ if(app.dataManagerUI) app.dataManagerUI.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] DataManagerUI init failed',e); }
try{ fundingSimulator.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] FundingSimulator init failed',e); }
try{ keyboardShortcuts.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] KeyboardShortcuts init failed',e); }
marketService.init().then(()=>DELTA_LOGGER.log('[Boot] Market data initialized')).catch(e=>DELTA_LOGGER.error('[Boot] market init failed',e));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(e=>DELTA_LOGGER.error('[Boot] Service Worker failed',e));
DELTA_LOGGER.log('[Boot] Application ready — trading isolated from chart');
})();
