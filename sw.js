const CACHE = 'delta-paper-v7';
const CRITICAL_ASSETS = [
  './','./index.html','./manifest.json','./css/styles.css',
  './js/config.js','./js/console.js','./js/EventEmitter.js','./js/Storage.js',
  './js/services/DeltaApiService.js','./js/services/WebSocketService.js','./js/services/MarketDataService.js',
  './js/state.js','./js/validator.js',
  './js/FundingSimulator.js','./js/RiskMetrics.js','./js/KeyboardShortcuts.js',
  './js/VwapIndicator.js','./js/FinancialEngine.js','./js/TradingEngine.js',
  './js/services/CandleStore.js','./js/services/ChartDataService.js','./js/ChartReplay.js','./js/ChartController.js','./js/services/MarketDataStatus.js',
  './js/app.js','./js/boot.js'
];
const OPTIONAL_ASSETS = [
  './css/ui-refresh.css',
  './icons/icon-192.png','./icons/icon-512.png','./icons/maskable-512.png'
];
const ALL_ASSETS = [...CRITICAL_ASSETS, ...OPTIONAL_ASSETS];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    for (const asset of CRITICAL_ASSETS) {
      try { const res = await fetch(asset, { cache: 'no-cache' }); if (res.ok) await c.put(asset, res); }
      catch (_) { /* critical asset missing: still install, but log */ console.warn('[SW] Critical asset missing:', asset); }
    }
    await Promise.all(OPTIONAL_ASSETS.map(async asset => {
      try { const res = await fetch(asset, { cache: 'no-cache' }); if (res.ok) await c.put(asset, res); }
      catch (_) { /* optional: do not block */ }
    }));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put('./index.html', clone));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // stale-while-revalidate: serve instantly, refresh cache in background
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
