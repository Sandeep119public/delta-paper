/**
 * Delta Paper Trading - Boot Script
 * Initializes modules and loads the authoritative accounting layer before startup.
 */
(async function() {
  'use strict';
  DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');
  const loadScript = src => new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src + ' failed to load')); document.head.appendChild(s);
  });
  await loadScript('./js/FinancialEngine.js');
  await loadScript('./js/FinancialPatch.js');

  const config = DELTA_CONFIG, eventBusInstance = eventBus;
  const apiService = new DeltaApiService(config), wsService = new WebSocketService(config);
  await storage.init().catch(e => DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
  const stateManager = new AppState(config, storage); await stateManager.load();
  const marketService = new MarketDataService(config, apiService, wsService), validator = new InputValidator(config);
  const orderEngine = new OrderEngine(config, marketService, eventBusInstance);
  const fundingSimulator = new FundingSimulator(config, stateManager, marketService, eventBusInstance);
  const riskMetrics = new RiskMetrics(config, stateManager), keyboardShortcuts = new KeyboardShortcuts(config, eventBusInstance);
  const simulationEngine = new SimulationEngine(config, eventBusInstance), backtestEngine = new BacktestEngine(config, stateManager, eventBusInstance);
  const monteCarloEngine = new MonteCarloEngine(eventBusInstance), app = new DeltaPaperApp(config, stateManager, validator, marketService);

  window.app = app; window.orderEngine = orderEngine; window.fundingSimulator = fundingSimulator; window.riskMetrics = riskMetrics;
  window.keyboardShortcuts = keyboardShortcuts; window.simulationEngine = simulationEngine; window.backtestEngine = backtestEngine;
  window.monteCarloEngine = monteCarloEngine; window.eventBus = eventBusInstance;
  window.financialEngine = new FinancialEngine(config, stateManager, marketService); app.financial = window.financialEngine;

  app.init(); orderEngine.init(); fundingSimulator.init(); keyboardShortcuts.init(); simulationEngine.init(); backtestEngine.init();
  DELTA_LOGGER.log('[Boot] MonteCarloEngine ready');
  marketService.init().then(() => DELTA_LOGGER.log('[Boot] Market data initialized')).catch(e => DELTA_LOGGER.error('[Boot] market init failed', e));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').then(() => DELTA_LOGGER.log('[Boot] Service Worker registered')).catch(e => DELTA_LOGGER.error('[Boot] Service Worker failed', e));
  DELTA_LOGGER.log('[Boot] Application ready');
})();
