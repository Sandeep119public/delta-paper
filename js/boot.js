/** Delta Paper Trading boot – single historical pipeline. */
(async function(){
'use strict';
DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');
const loadScript=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error(src+' failed to load'));document.head.appendChild(s);});
await loadScript('./js/FinancialEngine.js');
await loadScript('./js/TradingEngine.js');
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
await loadScript('./js/services/MarketDataStatus.js');
const config=DELTA_CONFIG,eventBusInstance=eventBus,apiService=new DeltaApiService(config),wsService=new WebSocketService(config);
await storage.init().catch(e=>DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
const historicalStorage=new HistoricalDataStorage(); await historicalStorage.init().catch(e=>DELTA_LOGGER.warn('[Boot] Historical storage unavailable:',e.message));
const stateManager=new AppState(config,storage);await stateManager.load();
const marketService=new MarketDataService(config,apiService,wsService),validator=new InputValidator(config);
const exchangeTime=new ExchangeTime(config);
// Keep the existing provider abstraction, but make it configurable so the
// application can use an India-native backend without changing chart code.
const provider=new BinanceDataProvider(config);
const historicalDataManager=new HistoricalDataManager(config, historicalStorage, DataVerifier, new DataDownloader(config, historicalStorage, provider), exchangeTime);
window.exchangeTime=exchangeTime;
exchangeTime.sync().catch(()=>{});
setInterval(()=> exchangeTime.sync().catch(()=>{}), 5*60*1000);
const fundingSimulator=new FundingSimulator(config,stateManager,marketService,eventBusInstance),riskMetrics=new RiskMetrics(config,stateManager),keyboardShortcuts=new KeyboardShortcuts(config,eventBusInstance),app=new DeltaPaperApp(config,stateManager,validator,marketService);
window.app=app;window.fundingSimulator=fundingSimulator;window.riskMetrics=riskMetrics;window.keyboardShortcuts=keyboardShortcuts;window.eventBus=eventBusInstance;window.financialEngine=new FinancialEngine(config,stateManager,marketService);window.tradingEngine=new TradingEngine(config,stateManager,marketService,window.financialEngine);
window.historicalStorage=historicalStorage; window.historicalDataManager=historicalDataManager; window.DataVerifier=DataVerifier;
app.financial=window.financialEngine;app.trading=window.tradingEngine;app.chartController=new ChartController(app);
app.dataManagerUI=new DataManagerUI(app, historicalDataManager);
app.openDataManager=()=> app.dataManagerUI.openManager();
app.openDiagnostics=()=> app.dataManagerUI.openDiagnostics();
app.init();
try{ app.dataManagerUI.init(); }catch(e){ DELTA_LOGGER.warn('[Boot] DataManagerUI init failed',e); }
fundingSimulator.init();keyboardShortcuts.init();
marketService.init().then(()=>DELTA_LOGGER.log('[Boot] Market data initialized')).catch(e=>DELTA_LOGGER.error('[Boot] market init failed',e));
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(e=>DELTA_LOGGER.error('[Boot] Service Worker failed',e));
DELTA_LOGGER.log('[Boot] Application ready');
})();
