/**
 * Delta Paper Trading - Configuration Module
 * Centralized configuration for the paper trading application
 */

const DELTA_CONFIG = {
  // API Configuration - DELTA EXCHANGE INDIA
  API_BASE: 'https://api.india.delta.exchange',
  
  // WebSocket endpoints - DIRECT CONNECTIONS ONLY (no proxies for WS)
  WS_ENDPOINTS: [
    'wss://socket.india.delta.exchange',
    'wss://public-socket.india.delta.exchange',
    'wss://ws.india.delta.exchange'
  ],

  // CORS Proxy fallback chain for REST API only (WebSocket bypasses these)
  // Note: Most public CORS proxies don't work with Delta India API
  // Direct browser access may still face CORS restrictions
  PROXY_CHAIN: [
    u => u, // Direct connection (primary)
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u), // CORS proxy fallback 1
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u) // CORS proxy fallback 2
  ],

  // Trading Symbols - Delta India perpetual contracts
  SYMBOLS: ['BTCUSD', 'ETHUSD', 'SOLUSD'],

  // Symbol metadata
  SYM_META: {
    BTCUSD: { name: 'Bitcoin', short: 'BTC' },
    ETHUSD: { name: 'Ethereum', short: 'ETH' },
    SOLUSD: { name: 'Solana', short: 'SOL' }
  },

  // Official Delta India lot sizes (coins per 1 contract)
  // These are defaults; live values fetched from /v2/products
  LOT_SIZES: {
    BTCUSD: 0.001,  // 0.001 BTC per lot
    ETHUSD: 0.01,   // 0.01 ETH per lot
    SOLUSD: 1       // 1 SOL per lot
  },

  // Financial Configuration
  START_INR: 866000,      // Starting INR balance (~₹10L)
  BASE_RATE: 86.6,        // Base INR/USD exchange rate
  CONVERT_FEE: 0.001,     // 0.1% conversion fee
  TAKER_FEE: 0.0005,      // 0.05% taker fee

  // UI Configuration
  MAX_LEVERAGE: 20,       // Maximum allowed leverage
  MIN_DEPOSIT: 100,       // Minimum deposit in INR
  MIN_WITHDRAW: 100,      // Minimum withdrawal in INR

  // Storage keys
  STORE_KEY: 'deltaPaper.mob.v9',

  // App metadata
  APP_NAME: 'Delta Paper',
  APP_VERSION: '9.1.0',   // Updated for real-time fixes

  // Validation limits
  VALIDATION: {
    MIN_LOTS: 1,
    MAX_LOTS: 10000,
    MIN_BALANCE: 0,
    MAX_DECIMALS: 8
  },

  // Performance settings
  PERF: {
    REST_POLL_INTERVAL: 3000,  // 3 second REST polling
    WS_HEARTBEAT: 20000,       // 20 second heartbeat
    RECONNECT_BASE_DELAY: 100, // 100ms base reconnect delay
    MAX_RECONNECT_DELAY: 30000 // 30 second max reconnect delay
  },

  // Visualization settings
  VIS: {
    HEATMAP_BUCKET_SIZE: 50,
    HEATMAP_FPS: 15,
    VWAP_BANDS: true,
  }
};

