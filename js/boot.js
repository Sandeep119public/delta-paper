/**
 * Delta Paper Trading - Boot Script
 * Initializes all modules and starts the application
 */

(function() {
  'use strict';

  DELTA_LOGGER.log('[Boot] Starting Delta Paper Trading...');

  // Initialize modules in order
  const config = DELTA_CONFIG;
  
  // Create services
  const apiService = new DeltaApiService(config);
  const wsService = new WebSocketService(config);
  
  // Create state manager
  const stateManager = new AppState(config);
  stateManager.load();
  
  // Create market data service (coordinator)
  const marketService = new MarketDataService(config, apiService, wsService);
  
  // Create validator
  const validator = new InputValidator(config);
  
  // Create main app
  const app = new DeltaPaperApp(config, stateManager, validator, marketService);
  
  // Make app globally available for legacy compatibility
  window.app = app;
  
  // Initialize app immediately (UI renders first, market data streams in afterwards)
  app.init();
  
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
})();
