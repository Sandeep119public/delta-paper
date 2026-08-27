/**
 * Delta Paper Trading - Unit Tests for Financial Calculations
 * Uses Vitest for fast, Vite-native testing
 */

import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  calculateMargin,
  calculateUnrealizedPnL,
  calculatePnLPercent,
  calculateLiquidationPrice,
  calculateFee,
  validateOrder,
  getPnLAnalysis,
  safeDecimal,
  formatDecimal
} from '../../src/utils/margin';
import type { TradingConfig } from '../../src/types/trading';

// Test configuration
const TEST_CONFIG: TradingConfig = {
  takerFee: new Decimal('0.0005'), // 0.05%
  makerFee: new Decimal('0.0002'), // 0.02%
  maxLeverage: 50,
  defaultLeverage: 10,
  symbols: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
  lotSizes: new Map([
    ['BTCUSD', new Decimal('0.001')],
    ['ETHUSD', new Decimal('0.01')],
    ['SOLUSD', new Decimal('0.1')]
  ])
};

describe('Margin Calculation', () => {
  it('should correctly calculate required margin for a leveraged trade', () => {
    // Example: $10,000 position size at 10x leverage = $1,000 required margin
    const notionalValue = new Decimal('10000');
    const leverage = 10;
    const margin = calculateMargin(notionalValue, leverage);
    
    expect(margin).toEqual(new Decimal('1000'));
  });

  it('should handle high leverage correctly', () => {
    const notionalValue = new Decimal('50000');
    const leverage = 50;
    const margin = calculateMargin(notionalValue, leverage);
    
    expect(margin).toEqual(new Decimal('1000'));
  });

  it('should throw error for invalid leverage', () => {
    expect(() => calculateMargin(new Decimal('1000'), 0)).toThrow('Leverage must be at least 1');
    expect(() => calculateMargin(new Decimal('1000'), -1)).toThrow('Leverage must be at least 1');
  });
});

describe('PnL Calculation', () => {
  it('should calculate profit for long position', () => {
    const entryPrice = new Decimal('78000');
    const currentPrice = new Decimal('79000');
    const size = new Decimal('0.1'); // 0.1 BTC
    const direction: 1 | -1 = 1; // Long
    
    const pnl = calculateUnrealizedPnL(entryPrice, currentPrice, size, direction);
    
    // (79000 - 78000) * 0.1 * 1 = 100
    expect(pnl).toEqual(new Decimal('100'));
  });

  it('should calculate loss for long position', () => {
    const entryPrice = new Decimal('78000');
    const currentPrice = new Decimal('77000');
    const size = new Decimal('0.1');
    const direction: 1 | -1 = 1; // Long
    
    const pnl = calculateUnrealizedPnL(entryPrice, currentPrice, size, direction);
    
    // (77000 - 78000) * 0.1 * 1 = -100
    expect(pnl).toEqual(new Decimal('-100'));
  });

  it('should calculate profit for short position', () => {
    const entryPrice = new Decimal('78000');
    const currentPrice = new Decimal('77000');
    const size = new Decimal('0.1');
    const direction: 1 | -1 = -1; // Short
    
    const pnl = calculateUnrealizedPnL(entryPrice, currentPrice, size, direction);
    
    // (77000 - 78000) * 0.1 * -1 = 100
    expect(pnl).toEqual(new Decimal('100'));
  });

  it('should calculate PnL percentage correctly', () => {
    const pnl = new Decimal('500');
    const margin = new Decimal('1000');
    
    const pnlPercent = calculatePnLPercent(pnl, margin);
    
    // (500 / 1000) * 100 = 50%
    expect(pnlPercent).toEqual(new Decimal('50'));
  });

  it('should return 0 for PnL percent when margin is zero', () => {
    const pnl = new Decimal('100');
    const margin = new Decimal('0');
    
    const pnlPercent = calculatePnLPercent(pnl, margin);
    
    expect(pnlPercent).toEqual(new Decimal('0'));
  });
});

describe('Liquidation Price Calculation', () => {
  it('should calculate liquidation price for long position', () => {
    const entryPrice = new Decimal('78000');
    const margin = new Decimal('1000');
    const size = new Decimal('0.1');
    const direction: 1 | -1 = 1; // Long
    
    const liqPrice = calculateLiquidationPrice(entryPrice, margin, size, direction);
    
    // Long position gets liquidated when price drops significantly
    expect(liqPrice.lessThan(entryPrice)).toBe(true);
    expect(liqPrice.greaterThan(new Decimal('0'))).toBe(true);
  });

  it('should calculate liquidation price for short position', () => {
    const entryPrice = new Decimal('78000');
    const margin = new Decimal('1000');
    const size = new Decimal('0.1');
    const direction: 1 | -1 = -1; // Short
    
    const liqPrice = calculateLiquidationPrice(entryPrice, margin, size, direction);
    
    // Short position gets liquidated when price rises significantly
    expect(liqPrice.greaterThan(entryPrice)).toBe(true);
  });
});

describe('Fee Calculation', () => {
  it('should calculate trading fee correctly', () => {
    const notionalValue = new Decimal('10000');
    const feeRate = new Decimal('0.0005'); // 0.05%
    
    const fee = calculateFee(notionalValue, feeRate);
    
    // 10000 * 0.0005 = 5
    expect(fee).toEqual(new Decimal('5'));
  });

  it('should handle small fees with precision', () => {
    const notionalValue = new Decimal('100.50');
    const feeRate = new Decimal('0.0005');
    
    const fee = calculateFee(notionalValue, feeRate);
    
    // Verify no floating-point errors
    expect(fee).toEqual(new Decimal('0.05025'));
  });
});

describe('Order Validation', () => {
  it('should validate a correct order', () => {
    const price = new Decimal('78000');
    const quantity = new Decimal('0.1');
    const leverage = 10;
    const accountBalance = new Decimal('1000');
    
    const result = validateOrder(price, quantity, leverage, accountBalance, TEST_CONFIG);
    
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.requiredMargin).toBeDefined();
    expect(result.estimatedFee).toBeDefined();
  });

  it('should reject order with insufficient balance', () => {
    const price = new Decimal('78000');
    const quantity = new Decimal('1'); // Large quantity
    const leverage = 10;
    const accountBalance = new Decimal('100'); // Insufficient
    
    const result = validateOrder(price, quantity, leverage, accountBalance, TEST_CONFIG);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Insufficient balance'));
  });

  it('should reject order with invalid leverage', () => {
    const price = new Decimal('78000');
    const quantity = new Decimal('0.1');
    const leverage = 100; // Exceeds max
    const accountBalance = new Decimal('10000');
    
    const result = validateOrder(price, quantity, leverage, accountBalance, TEST_CONFIG);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Leverage must be between'));
  });

  it('should reject order with invalid price', () => {
    const price = new Decimal('-100'); // Negative price
    const quantity = new Decimal('0.1');
    const leverage = 10;
    const accountBalance = new Decimal('1000');
    
    const result = validateOrder(price, quantity, leverage, accountBalance, TEST_CONFIG);
    
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual('Invalid price');
  });
});

describe('PnL Analysis', () => {
  it('should provide complete PnL analysis', () => {
    const entryPrice = new Decimal('78000');
    const currentPrice = new Decimal('79000');
    const size = new Decimal('0.1');
    const margin = new Decimal('780');
    const direction: 1 | -1 = 1;
    const leverage = 10;
    
    const analysis = getPnLAnalysis(entryPrice, currentPrice, size, margin, direction, leverage);
    
    expect(analysis.unrealizedPnL).toEqual(new Decimal('100'));
    expect(analysis.marginUsed).toEqual(margin);
    expect(analysis.liquidationPrice).toBeDefined();
    expect(analysis.liquidationPrice.lessThan(entryPrice)).toBe(true);
  });
});

describe('Utility Functions', () => {
  it('should safely parse valid numbers to Decimal', () => {
    expect(safeDecimal('100.50')).toEqual(new Decimal('100.50'));
    expect(safeDecimal(100.50)).toEqual(new Decimal('100.5'));
    expect(safeDecimal(null)).toEqual(new Decimal('0'));
    expect(safeDecimal(undefined)).toEqual(new Decimal('0'));
  });

  it('should handle invalid input gracefully', () => {
    expect(safeDecimal('invalid')).toEqual(new Decimal('0'));
    expect(safeDecimal(NaN)).toEqual(new Decimal('0'));
  });

  it('should format decimals correctly', () => {
    expect(formatDecimal(new Decimal('100.123456'), 2)).toBe('100.12');
    expect(formatDecimal(new Decimal('100.1'), 4)).toBe('100.1000');
    expect(formatDecimal(new Decimal('100'), 0)).toBe('100');
  });
});

describe('Precision Tests - Avoiding Floating Point Errors', () => {
  it('should handle 0.1 + 0.2 correctly (classic FP issue)', () => {
    const a = new Decimal('0.1');
    const b = new Decimal('0.2');
    const sum = a.plus(b);
    
    // With native JS: 0.1 + 0.2 === 0.30000000000000004
    // With Decimal: should be exactly 0.3
    expect(sum).toEqual(new Decimal('0.3'));
  });

  it('should handle precise fee calculations', () => {
    const amount = new Decimal('1000');
    const feeRate = new Decimal('0.0005');
    
    // Calculate fee multiple times to ensure consistency
    const fee1 = calculateFee(amount, feeRate);
    const fee2 = calculateFee(amount, feeRate);
    const fee3 = calculateFee(amount, feeRate);
    
    expect(fee1).toEqual(fee2);
    expect(fee2).toEqual(fee3);
    expect(fee1).toEqual(new Decimal('0.5'));
  });

  it('should maintain precision in chained calculations', () => {
    const price = new Decimal('78543.21');
    const quantity = new Decimal('0.1234');
    const leverage = 10;
    
    const notional = price.times(quantity);
    const margin = calculateMargin(notional, leverage);
    const fee = calculateFee(notional, new Decimal('0.0005'));
    
    // All values should be exact Decimals
    expect(margin.isNaN()).toBe(false);
    expect(fee.isNaN()).toBe(false);
    expect(margin.plus(fee).isFinite()).toBe(true);
  });
});
