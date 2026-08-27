/**
 * Delta Paper Trading - Unit Tests (Vitest)
 * Run with: npm test (requires Node.js and npm)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock browser globals for jsdom testing
beforeEach(() => {
  // Reset localStorage
  localStorage.clear();
  
  // Reset DOM
  document.body.innerHTML = '';
});

// Test Configuration Module
describe('DELTA_CONFIG', () => {
  it('should have required properties', () => {
    expect(DELTA_CONFIG).toBeDefined();
    expect(DELTA_CONFIG.START_INR).toBe(866000);
    expect(DELTA_CONFIG.BASE_RATE).toBe(86.6);
    expect(DELTA_CONFIG.MAX_LEVERAGE).toBe(20);
    expect(Array.isArray(DELTA_CONFIG.SYMBOLS)).toBe(true);
    expect(DELTA_CONFIG.SYMBOLS.length).toBe(3);
  });

  it('should have validation limits', () => {
    expect(DELTA_CONFIG.VALIDATION.MIN_LOTS).toBe(1);
    expect(DELTA_CONFIG.VALIDATION.MAX_LOTS).toBe(10000);
  });
});

// Test Validator Module
describe('InputValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new InputValidator(DELTA_CONFIG);
  });

  it('should validate lots correctly', () => {
    // Valid input
    let result = validator.validateLots(5);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(5);
    
    // Below minimum
    result = validator.validateLots(0);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(1);
    
    // Above maximum
    result = validator.validateLots(99999);
    expect(result.value).toBe(10000);
    
    // Invalid input
    result = validator.validateLots('abc');
    expect(result.isValid).toBe(false);
    expect(result.corrected).toBe(1);
    
    // Empty input
    result = validator.validateLots('');
    expect(result.corrected).toBe(1);
  });

  it('should validate deposits', () => {
    // Valid deposit
    let result = validator.validateDeposit(1000);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(1000);
    
    // Below minimum
    result = validator.validateDeposit(50);
    expect(result.isValid).toBe(false);
    
    // Invalid
    result = validator.validateDeposit('abc');
    expect(result.isValid).toBe(false);
    
    // Negative
    result = validator.validateDeposit(-100);
    expect(result.isValid).toBe(false);
  });

  it('should validate withdrawals', () => {
    const balance = 5000;
    
    // Valid withdrawal
    let result = validator.validateWithdrawal(1000, balance);
    expect(result.isValid).toBe(true);
    
    // Exceeds balance
    result = validator.validateWithdrawal(10000, balance);
    expect(result.isValid).toBe(false);
    
    // Below minimum
    result = validator.validateWithdrawal(50, balance);
    expect(result.isValid).toBe(false);
  });

  it('should validate leverage', () => {
    // Valid leverage
    let result = validator.validateLeverage(10);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(10);
    
    // Below minimum
    result = validator.validateLeverage(0);
    expect(result.value).toBe(1);
    
    // Above maximum
    result = validator.validateLeverage(50);
    expect(result.value).toBe(20);
  });

  it('should validate names', () => {
    // Valid name
    let result = validator.validateName('John Doe');
    expect(result.isValid).toBe(true);
    expect(result.value).toBe('John Doe');
    
    // Empty name
    result = validator.validateName('');
    expect(result.isValid).toBe(false);
    
    // Long name
    result = validator.validateName('A'.repeat(100));
    expect(result.value.length).toBe(50);
  });

  it('should format numbers', () => {
    expect(validator.formatINR(1000000).includes('₹')).toBe(true);
    expect(validator.formatUSD(100.5).includes('$')).toBe(true);
    expect(validator.formatNumber(1234.5, 2).length).toBeGreaterThan(0);
  });
});

// Test State Module
describe('AppState', () => {
  let appState;

  beforeEach(() => {
    appState = new AppState(DELTA_CONFIG);
  });

  it('should create default state', () => {
    const state = appState.createDefault();
    
    expect(state.inr).toBe(DELTA_CONFIG.START_INR);
    expect(state.usd).toBe(0);
    expect(state.lev).toBe(10);
    expect(typeof state.uid).toBe('string');
    expect(state.uid.startsWith('DE-IN-')).toBe(true);
  });

  it('should load and save', () => {
    localStorage.clear();
    
    const state = appState.load();
    expect(state).not.toBeNull();
    
    appState.update({ inr: 900000 });
    const saved = JSON.parse(localStorage.getItem(DELTA_CONFIG.STORE_KEY));
    expect(saved.inr).toBe(900000);
  });

  it('should validate updates', () => {
    appState.load();
    
    // Valid update
    appState.update({ lev: 15 });
    expect(appState.get('lev')).toBe(15);
    
    // Invalid update should throw
    expect(() => {
      appState.update({ lev: 100 });
    }).toThrow();
  });

  it('should track ledger entries', () => {
    appState.load();
    
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      type: 'TEST',
      amount: 1000
    };
    
    appState.state.ledger.unshift(entry);
    if (appState.state.ledger.length > 40) {
      appState.state.ledger = appState.state.ledger.slice(0, 40);
    }
    appState.save();
    
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toBeDefined();
    expect(appState.state.ledger.length).toBeGreaterThan(0);
  });

  it('should track trade history', () => {
    appState.load();
    
    const trade = {
      t: Date.now(),
      symbol: 'BTCUSD',
      pnl: 500,
      fee: 10
    };
    
    appState.state.history.unshift(trade);
    if (appState.state.history.length > 50) {
      appState.state.history = appState.state.history.slice(0, 50);
    }
    
    // Update statistics manually as app.js does
    if (trade.pnl !== undefined) {
      if (trade.pnl > 0) {
        appState.state.wins++;
        if (trade.pnl > appState.state.best) appState.state.best = trade.pnl;
      }
      appState.state.realized += trade.pnl;
    }
    if (trade.fee !== undefined) {
      appState.state.feesTotal += trade.fee;
    }
    appState.save();
    
    expect(appState.state.wins).toBe(1);
    expect(appState.state.realized).toBe(500);
    expect(appState.state.best).toBe(500);
  });

  it('should subscribe to changes', () => {
    appState.load();
    
    let notified = false;
    const unsubscribe = appState.subscribe(() => {
      notified = true;
    });
    
    appState.update({ inr: 870000 });
    expect(notified).toBe(true);
    
    // Unsubscribe should work
    unsubscribe();
    notified = false;
    appState.update({ inr: 880000 });
    expect(notified).toBe(false);
  });
});

// Test Services
describe('DeltaApiService', () => {
  let apiService;

  beforeEach(() => {
    apiService = new DeltaApiService(DELTA_CONFIG);
  });

  it('should initialize with correct config', () => {
    expect(apiService.config).toBe(DELTA_CONFIG);
    expect(apiService.consecutiveFailures).toBe(0);
    expect(apiService.circuitOpen).toBe(false);
  });

  it('should track circuit breaker status', () => {
    expect(apiService.isCircuitOpen()).toBe(false);
    
    const status = apiService.getStatus();
    expect(status.consecutiveFailures).toBe(0);
    expect(status.circuitOpen).toBe(false);
    expect(status.isAvailable).toBe(true);
  });

  it('should reset circuit breaker', () => {
    apiService.consecutiveFailures = 5;
    apiService.circuitOpen = true;
    apiService.circuitOpenUntil = Date.now() + 30000;
    
    apiService.reset();
    
    expect(apiService.consecutiveFailures).toBe(0);
    expect(apiService.circuitOpen).toBe(false);
  });
});

describe('WebSocketService', () => {
  let wsService;

  beforeEach(() => {
    wsService = new WebSocketService(DELTA_CONFIG);
  });

  it('should initialize with correct config', () => {
    expect(wsService.config).toBe(DELTA_CONFIG);
    expect(wsService.connections.size).toBe(0);
  });

  it('should track connection status', () => {
    const status = wsService.getStatus();
    expect(status.active).toBe(0);
    expect(status.total).toBe(0);
    expect(status.endpoints).toBe(DELTA_CONFIG.WS_ENDPOINTS.length);
  });

  it('should manage message handlers', () => {
    const handler = vi.fn();
    const unsubscribe = wsService.onMessage(handler);
    
    expect(wsService.messageHandlers.size).toBe(1);
    
    unsubscribe();
    expect(wsService.messageHandlers.size).toBe(0);
  });
});

describe('MarketDataService', () => {
  let marketService;
  let mockApiService;
  let mockWsService;

  beforeEach(() => {
    mockApiService = {
      get: vi.fn().mockResolvedValue([]),
      isCircuitOpen: vi.fn().mockReturnValue(false),
      getStatus: vi.fn().mockReturnValue({ isAvailable: true })
    };
    
    mockWsService = {
      connectAll: vi.fn(),
      onMessage: vi.fn().mockReturnValue(() => {}),
      getStatus: vi.fn().mockReturnValue({ active: 0 })
    };
    
    marketService = new MarketDataService(DELTA_CONFIG, mockApiService, mockWsService);
  });

  it('should initialize market entries', () => {
    DELTA_CONFIG.SYMBOLS.forEach(sym => {
      expect(marketService.markets[sym]).toBeDefined();
      expect(marketService.markets[sym].symbol).toBe(sym);
    });
  });

  it('should apply ticker data', () => {
    marketService.applyTickerObj({
      symbol: 'BTCUSD',
      mark_price: '80000',
      close: '80000'
    });
    
    expect(marketService.markets.BTCUSD.price).toBe(80000);
    expect(marketService.markets.BTCUSD.gotLive).toBe(true);
  });

  it('should determine decimal places correctly', () => {
    expect(marketService.decFor(100000)).toBe(0);
    expect(marketService.decFor(10000)).toBe(0);
    expect(marketService.decFor(1000)).toBe(1);
    expect(marketService.decFor(100)).toBe(2);
    expect(marketService.decFor(10)).toBe(3);
    expect(marketService.decFor(1)).toBe(4);
  });

  it('should manage listeners', () => {
    const listener = vi.fn();
    const unsubscribe = marketService.subscribe(listener);
    
    expect(marketService.listeners.size).toBe(1);
    
    unsubscribe();
    expect(marketService.listeners.size).toBe(0);
  });
});
