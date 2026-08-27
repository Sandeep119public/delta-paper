/**
 * Delta Paper Trading - Type Definitions
 * Strict TypeScript interfaces for financial domain logic
 */

import Decimal from 'decimal.js';

/**
 * Order representation for trades
 * Uses Decimal for precise financial calculations
 */
export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: Decimal; // Precise quantity using Decimal
  price: Decimal;    // Precise price using Decimal
  timestamp: number;
  leverage?: number;
  fee?: Decimal;
}

/**
 * Position representation for open trades
 */
export interface Position {
  symbol: string;
  entryPrice: Decimal;
  currentPrice: Decimal;
  size: Decimal;
  lots: number;
  leverage: number;
  margin: Decimal;
  direction: 1 | -1; // 1 = Long, -1 = Short
  takeProfit?: Decimal;
  stopLoss?: Decimal;
  
  // Computed properties
  getUnrealizedPnL: () => Decimal;
  getUnrealizedPnLPercent: () => Decimal;
  getLiquidationPrice: () => Decimal;
}

/**
 * Market data snapshot
 */
export interface MarketData {
  symbol: string;
  price: Decimal;
  prevPrice: Decimal | null;
  open24h: Decimal | null;
  change24h: Decimal | null;
  fundingRate: Decimal | null;
  lotSize: Decimal;
  decimalPlaces: number;
  isLive: boolean;
}

/**
 * Account state for paper trading
 */
export interface AccountState {
  inrBalance: Decimal;
  usdBalance: Decimal;
  totalEquity: Decimal;
  realizedPnL: Decimal;
  unrealizedPnL: Decimal;
  totalFeesPaid: Decimal;
  wins: number;
  losses: number;
  bestTrade: Decimal;
  worstTrade: Decimal;
  positions: Map<string, Position>;
  leverage: number;
}

/**
 * Trade history entry
 */
export interface TradeHistory {
  timestamp: number;
  symbol: string;
  action: string;
  quantity: Decimal;
  price: Decimal;
  pnl: Decimal | null;
  fee: Decimal;
}

/**
 * Configuration for financial calculations
 */
export interface TradingConfig {
  takerFee: Decimal;      // e.g., 0.0005 for 0.05%
  makerFee: Decimal;      // e.g., 0.0002 for 0.02%
  maxLeverage: number;    // e.g., 50
  defaultLeverage: number; // e.g., 10
  symbols: string[];
  lotSizes: Map<string, Decimal>;
}

/**
 * PnL calculation result
 */
export interface PnLResult {
  unrealizedPnL: Decimal;
  unrealizedPnLPercent: Decimal;
  marginUsed: Decimal;
  liquidationPrice: Decimal;
}

/**
 * Margin calculation parameters
 */
export interface MarginParams {
  notionalValue: Decimal;
  leverage: number;
}

/**
 * Order validation result
 */
export interface OrderValidationResult {
  isValid: boolean;
  errors: string[];
  requiredMargin?: Decimal;
  estimatedFee?: Decimal;
}
