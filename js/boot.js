/**
 * Delta Paper Trading - Boot Script
 * Initializes all modules and starts the application
 */

(async function() {
  'use strict';

  DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');

  // Initialize modules in order
  const config = DELTA_CONFIG;
  
  // Create event bus
  const eventBusInstance = eventBus;
  
  // Create services
  const apiService = new DeltaApiService(config);
  const wsService = new WebSocketService(config);
  
  // Initialize IndexedDB before state so it's available for load
  await storage.init().catch(e => DELTA_LOGGER.warn('[Boot] IndexedDB init failed, using localStorage fallback'));
  
  // Create state manager (uses IndexedDB + localStorage)
  const stateManager = new AppState(config, storage);
  await stateManager.load();
  
  // Create market data service (coordinator)
  const marketService = new MarketDataService(config, apiService, wsService);
  
  // Create validator
  const validator = new InputValidator(config);
  
  // Create new modules
  const orderEngine = new OrderEngine(config, marketService, eventBusInstance);
  const fundingSimulator = new FundingSimulator(config, stateManager, marketService, eventBusInstance);
  const riskMetrics = new RiskMetrics(config, stateManager);
  const keyboardShortcuts = new KeyboardShortcuts(config, eventBusInstance);
  const simulationEngine = new SimulationEngine(config, eventBusInstance);
  const backtestEngine = new BacktestEngine(config, stateManager, eventBusInstance);
  const monteCarloEngine = new MonteCarloEngine(eventBusInstance);
  
  // Create main app
  const app = new DeltaPaperApp(config, stateManager, validator, marketService);
  
  // Make app globally available for legacy compatibility
  window.app = app;
  
  // Make modules available globally for debugging
  window.orderEngine = orderEngine;
  window.fundingSimulator = fundingSimulator;
  window.riskMetrics = riskMetrics;
  window.keyboardShortcuts = keyboardShortcuts;
  window.simulationEngine = simulationEngine;
  window.backtestEngine = backtestEngine;
  window.monteCarloEngine = monteCarloEngine;
  window.eventBus = eventBusInstance;
  
  // Initialize app immediately (UI renders first, market data streams in afterwards)
  app.init();
  
  // Initialize new modules
  orderEngine.init();
  fundingSimulator.init();
  keyboardShortcuts.init();
  simulationEngine.init();
  backtestEngine.init();
  DELTA_LOGGER.log('[Boot] MonteCarloEngine ready');
  
  // Initialize market data asynchronously (non-blocking)
  marketService.init()
    .then(() => DELTA_LOGGER.log('[Boot] Market data initialized'))
    .catch(e => DELTA_LOGGER.error('[Boot] market init failed', e));
  
  // Register service worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(r => DELTA_LOGGER.log('[Boot] Service Worker registered'))
      .catch(e => DELTA_LOGGER.error('[Boot] Service Worker failed', e));
  }
  
  DELTA_LOGGER.log('[Boot] Application ready');
  DELTA_LOGGER.log('[Boot] Keyboard shortcuts: Press Shift+? for help');
})();
