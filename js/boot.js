/**
 * Delta Paper Trading - Boot Script
 * Initializes all modules and starts the application
 */

(function() {
  'use strict';

  console.log('[Boot] Starting Delta Paper Trading...');

  // Initialize modules in order
  const config = DELTA_CONFIG;
  
  // Create state manager
  const stateManager = new AppState(config);
  stateManager.load();
  
  // Create market data manager
  const marketManager = new MarketDataManager(config);
  
  // Create validator
  const validator = new Validator(config, stateManager);
  
  // Create main app
  const app = new DeltaPaperApp(config, stateManager, validator, marketManager);
  
  // Make app globally available for legacy compatibility
  window.app = app;
  
  // Initialize market data first (fetches live prices from Delta Exchange India)
  marketManager.init().then(() => {
    console.log('[Boot] Market data initialized');
    
    // Then initialize the app
    app.init();
    
    // Register service worker for PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(r => console.log('[Boot] Service Worker registered'))
        .catch(e => console.error('[Boot] Service Worker failed', e));
    }
    
    console.log('[Boot] Application ready');
  }).catch(err => {
    console.error('[Boot] Initialization failed:', err);
    // Still try to init app even if market data fails (will use simulation)
    app.init();
  });

})();
