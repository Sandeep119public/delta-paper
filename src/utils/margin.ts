/**
 * Delta Paper Trading - Margin & PnL Calculations
 * Uses Decimal.js for precise financial math to avoid floating-point errors
 */

import Decimal from 'decimal.js';
import type { 
  PnLResult, 
  OrderValidationResult,
  TradingConfig 
} from '../types/trading';

// Configure Decimal precision for financial calculations
Decimal.set({
  precision: 20,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -20,
  toExpPos: 20,
});

/**
 * Calculate required margin for a position
 * @param notionalValue - The total value of the position
 * @param leverage - The leverage multiplier
 * @returns Required margin as Decimal
 */
export function calculateMargin(notionalValue: Decimal, leverage: number): Decimal {
  if (leverage < 1) {
    throw new Error('Leverage must be at least 1');
  }
  return notionalValue.dividedBy(leverage);
}

/**
 * Calculate unrealized PnL for a position
 * @param position - The current position
 * @param currentPrice - Current market price
 * @returns Unrealized PnL as Decimal (positive = profit, negative = loss)
 */
export function calculateUnrealizedPnL(
  entryPrice: Decimal,
  currentPrice: Decimal,
  size: Decimal,
  direction: 1 | -1
): Decimal {
  const priceDiff = currentPrice.minus(entryPrice);
  return priceDiff.times(size).times(direction);
}

/**
 * Calculate unrealized PnL percentage
 * @param pnl - The PnL amount
 * @param margin - The initial margin
 * @returns PnL as percentage
 */
export function calculatePnLPercent(pnl: Decimal, margin: Decimal): Decimal {
  if (margin.isZero()) {
    return new Decimal(0);
  }
  return pnl.dividedBy(margin).times(100);
}

/**
 * Calculate liquidation price for a leveraged position
 * @param entryPrice - Entry price
 * @param margin - Initial margin
 * @param size - Position size
 * @param direction - Long (1) or Short (-1)
 * @param maintenanceMarginRate - Maintenance margin requirement (e.g., 0.005 for 0.5%)
 * @returns Liquidation price
 */
export function calculateLiquidationPrice(
  entryPrice: Decimal,
  margin: Decimal,
  size: Decimal,
  direction: 1 | -1,
  maintenanceMarginRate: Decimal = new Decimal('0.005')
): Decimal {
  // For long positions: liquidation when losses equal margin minus maintenance
  // For short positions: liquidation when price rises enough to wipe out margin
  
  const notional = entryPrice.times(size);
  const maintenanceMargin = notional.times(maintenanceMarginRate);
  
  if (direction === 1) {
    // Long: liquidation price is below entry
    const maxLoss = margin.minus(maintenanceMargin);
    const priceDrop = maxLoss.dividedBy(size);
    const liqPrice = entryPrice.minus(priceDrop);
    return liqPrice.lessThan(0) ? new Decimal(0) : liqPrice;
  } else {
    // Short: liquidation price is above entry
    const maxLoss = margin.minus(maintenanceMargin);
    const priceRise = maxLoss.dividedBy(size);
    return entryPrice.plus(priceRise);
  }
}

/**
 * Calculate trading fee
 * @param notionalValue - Trade notional value
 * @param feeRate - Fee rate (e.g., 0.0005 for 0.05%)
 * @returns Fee amount
 */
export function calculateFee(notionalValue: Decimal, feeRate: Decimal): Decimal {
  return notionalValue.times(feeRate);
}

/**
 * Validate an order before execution
 * @param params - Order parameters
 * @param accountBalance - Available USD balance
 * @param config - Trading configuration
 * @returns Validation result with errors if any
 */
export function validateOrder(
  price: Decimal,
  quantity: Decimal,
  leverage: number,
  accountBalance: Decimal,
  config: TradingConfig
): OrderValidationResult {
  const errors: string[] = [];
  
  // Validate inputs
  if (price.isNaN() || price.lessThanOrEqualTo(0)) {
    errors.push('Invalid price');
  }
  
  if (quantity.isNaN() || quantity.lessThanOrEqualTo(0)) {
    errors.push('Invalid quantity');
  }
  
  if (leverage < 1 || leverage > config.maxLeverage) {
    errors.push(`Leverage must be between 1 and ${config.maxLeverage}`);
  }
  
  if (errors.length > 0) {
    return { isValid: false, errors };
  }
  
  // Calculate requirements
  const notionalValue = price.times(quantity);
  const requiredMargin = calculateMargin(notionalValue, leverage);
  const estimatedFee = calculateFee(notionalValue, config.takerFee);
  const totalRequired = requiredMargin.plus(estimatedFee);
  
  // Check sufficient balance
  if (totalRequired.greaterThan(accountBalance)) {
    errors.push(`Insufficient balance. Need ${totalRequired.toFixed(2)} USD, have ${accountBalance.toFixed(2)} USD`);
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    requiredMargin,
    estimatedFee
  };
}

/**
 * Get complete PnL analysis for a position
 * @param position - The position to analyze
 * @param currentPrice - Current market price
 * @returns Complete PnL result
 */
export function getPnLAnalysis(
  entryPrice: Decimal,
  currentPrice: Decimal,
  size: Decimal,
  margin: Decimal,
  direction: 1 | -1,
  _leverage: number
): PnLResult {
  const unrealizedPnL = calculateUnrealizedPnL(entryPrice, currentPrice, size, direction);
  const unrealizedPnLPercent = calculatePnLPercent(unrealizedPnL, margin);
  const liquidationPrice = calculateLiquidationPrice(entryPrice, margin, size, direction);
  
  return {
    unrealizedPnL,
    unrealizedPnLPercent,
    marginUsed: margin,
    liquidationPrice
  };
}

/**
 * Format Decimal to fixed decimal places for display
 * @param value - Decimal value to format
 * @param decimals - Number of decimal places
 * @returns Formatted string
 */
export function formatDecimal(value: Decimal, decimals: number = 2): string {
  return value.toFixed(decimals);
}

/**
 * Parse string/number to Decimal safely
 * @param value - Value to parse
 * @returns Decimal (0 if invalid input)
 */
export function safeDecimal(value: string | number | null | undefined): Decimal {
  if (value === null || value === undefined) {
    return new Decimal(0);
  }
  try {
    const d = new Decimal(value);
    return d.isNaN() || !d.isFinite() ? new Decimal(0) : d;
  } catch {
    return new Decimal(0);
  }
}
