/**
 * Delta Paper Trading - Boot Script
 * Initializes modules and loads the authoritative accounting patch before app startup.
 */
(async function() {
  'use strict';
  DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');

  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './js/FinancialEngine.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('FinancialEngine failed to load'));
    document.head.appendChild(s);
  });

  const config = DELTA_CONFIG;
  const eventBusInstance = eventBus;
  const apiService = new DeltaApiService(config);
  const wsService = new WebSocketService(config);
  await storage.init().catch(e => DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
  const stateManager = new AppState(config, storage);
  await stateManager.load();
  const marketService = new MarketDataService(config, apiService, wsService);
  const validator = new InputValidator(config);
  const orderEngine = new OrderEngine(config, marketService, eventBusInstance);
  const fundingSimulator = new FundingSimulator(config, stateManager, marketService, eventBusInstance);
  const riskMetrics = new RiskMetrics(config, stateManager);
  const keyboardShortcuts = new KeyboardShortcuts(config, eventBusInstance);
  const simulationEngine = new SimulationEngine(config, eventBusInstance);
  const backtestEngine = new BacktestEngine(config, stateManager, eventBusInstance);
  const monteCarloEngine = new MonteCarloEngine(eventBusInstance);
  const app = new DeltaPaperApp(config, stateManager, validator, marketService);

  window.app = app;
  window.orderEngine = orderEngine;
  window.fundingSimulator = fundingSimulator;
  window.riskMetrics = riskMetrics;
  window.keyboardShortcuts = keyboardShortcuts;
  window.simulationEngine = simulationEngine;
  window.backtestEngine = backtestEngine;
  window.monteCarloEngine = monteCarloEngine;
  window.eventBus = eventBusInstance;
  window.financialEngine = new FinancialEngine(config, stateManager, marketService);

  app.init();
  orderEngine.init();
  fundingSimulator.init();
  keyboardShortcuts.init();
  simulationEngine.init();
  backtestEngine.init();
  DELTA_LOGGER.log('[Boot] MonteCarloEngine ready');

  marketService.init()
    .then(() => DELTA_LOGGER.log('[Boot] Market data initialized'))
    .catch(e => DELTA_LOGGER.error('[Boot] market init failed', e));

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(r => DELTA_LOGGER.log('[Boot] Service Worker registered'))
      .catch(e => DELTA_LOGGER.error('[Boot] Service Worker failed', e));
  }
  DELTA_LOGGER.log('[Boot] Application ready');
  DELTA_LOGGER.log('[Boot] Keyboard shortcuts: Press Shift+? for help');
})();
