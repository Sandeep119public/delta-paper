/**
 * Delta Paper Trading - Unit Tests (Vitest)
 * Run with: npm test (requires Node.js and npm)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Import modules under test
// Note: config.js and console.js are loaded via setup.js

// Test Configuration Module
describe('DELTA_CONFIG', () => {
  it('should have required properties', () => {
    expect(typeof DELTA_CONFIG).not.toBe('undefined');
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

// Test DELTA_LOGGER
describe('DELTA_LOGGER', () => {
  it('should exist', () => {
    expect(typeof DELTA_LOGGER).not.toBe('undefined');
  });

  it('should have enable/disable methods', () => {
    expect(typeof DELTA_LOGGER.enable).toBe('function');
    expect(typeof DELTA_LOGGER.disable).toBe('function');
  });
});

// Test Validator Module (inline for now)
describe('InputValidator', () => {
  let validator;

  beforeEach(async () => {
    validator = new globalThis.InputValidator(globalThis.DELTA_CONFIG);
  });

  it('should validate lots correctly', () => {
    let result = validator.validateLots(5);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(5);
    
    result = validator.validateLots(0);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(1);
    
    result = validator.validateLots(99999);
    expect(result.value).toBe(10000);
    
    result = validator.validateLots('abc');
    expect(result.isValid).toBe(false);
  });

  it('should validate deposits', () => {
    let result = validator.validateDeposit(1000);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(1000);
    
    result = validator.validateDeposit(50);
    expect(result.isValid).toBe(false);
  });

  it('should validate leverage', () => {
    let result = validator.validateLeverage(10);
    expect(result.isValid).toBe(true);
    expect(result.value).toBe(10);
    
    result = validator.validateLeverage(0);
    expect(result.value).toBe(1);
    
    result = validator.validateLeverage(50);
    expect(result.value).toBe(20);
  });

  it('should format numbers', () => {
    expect(validator.formatINR(1000000).includes('₹')).toBe(true);
    expect(validator.formatUSD(100.5).includes('$')).toBe(true);
  });
});

// Test State Module
describe('AppState', () => {
  let appState;

  beforeEach(async () => {
    localStorage.clear();
    appState = new globalThis.AppState(globalThis.DELTA_CONFIG);
  });

  it('should create default state', () => {
    const state = appState.createDefault();
    expect(state.inr).toBe(DELTA_CONFIG.START_INR);
    expect(state.usd).toBe(0);
    expect(state.lev).toBe(10);
    expect(typeof state.uid).toBe('string');
  });

  it('should load and save', async () => {
    const state = await appState.load();
    expect(state).not.toBeNull();

    appState.update({ inr: 900000 });
    appState.flushSave();
    const saved = JSON.parse(localStorage.getItem(DELTA_CONFIG.STORE_KEY));
    expect(saved.inr).toBe(900000);
  });

  it('should validate updates', () => {
    appState.load();
    appState.update({ lev: 15 });
    expect(appState.get('lev')).toBe(15);
    
    expect(() => {
      appState.update({ lev: 100 });
    }).toThrow();
  });

  it('should subscribe to changes', () => {
    appState.load();
    
    let notified = false;
    const unsubscribe = appState.subscribe(() => {
      notified = true;
    });
    
    appState.update({ inr: 870000 });
    expect(notified).toBe(true);
    
    unsubscribe();
    notified = false;
    appState.update({ inr: 880000 });
    expect(notified).toBe(false);
  });
});
