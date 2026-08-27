/**
 * Delta Paper Trading - TypeScript Type Definitions
 * Strict interfaces for compile-time type checking
 */

// Configuration types
export interface DeltaConfig {
  API_BASE: string;
  WS_ENDPOINTS: string[];
  PROXY_CHAIN: Array<(url: string) => string>;
  SYMBOLS: string[];
  SYM_META: Record<string, SymbolMeta>;
  LOT_SIZES: Record<string, number>;
  START_INR: number;
  BASE_RATE: number;
  CONVERT_FEE: number;
  TAKER_FEE: number;
  MAX_LEVERAGE: number;
  MIN_DEPOSIT: number;
  MIN_WITHDRAW: number;
  STORE_KEY: string;
  APP_NAME: string;
  APP_VERSION: string;
  VALIDATION: ValidationLimits;
  PERF: PerformanceConfig;
}

export interface SymbolMeta {
  name: string;
  short: string;
}

export interface ValidationLimits {
  MIN_LOTS: number;
  MAX_LOTS: number;
  MIN_BALANCE: number;
  MAX_DECIMALS: number;
}

export interface PerformanceConfig {
  REST_POLL_INTERVAL: number;
  WS_HEARTBEAT: number;
  RECONNECT_BASE_DELAY: number;
  MAX_RECONNECT_DELAY: number;
}

// Market data types
export interface MarketEntry {
  symbol: string;
  price: number | null;
  prevPrice: number | null;
  open24: number | null;
  chg24: number | null;
  funding: number | null;
  lot: number;
  gotLive: boolean;
  dec: number;
  decLocked: boolean;
}

export interface TickerData {
  symbol: string;
  mark_price?: string | number;
  close?: string | number;
  last_price?: string | number;
  ltp_change_24h?: string | number;
  mark_change_24h?: string | number;
  funding_rate?: string | number;
  open_interest?: string | number;
  oi?: string | number;
  quotes?: {
    best_ask?: string | number;
    best_bid?: string | number;
  };
}

export interface WebSocketMessage {
  type?: string;
  channel?: string;
  sy?: string;
  p?: string;
  d?: Array<{ m?: string }>;
  data?: TickerData | TickerData[];
  symbol?: string;
}

// State types
export interface AppState {
  name: string;
  uid: string;
  createdAt: number;
  inr: number;
  usd: number;
  lev: number;
  lots: Record<string, number>;
  positions: Record<string, Position>;
  history: TradeHistoryEntry[];
  ledger: LedgerEntry[];
  realized: number;
  wins: number;
  losses: number;
  feesTotal: number;
  best: number;
  worst: number;
  lastSeen: number;
  equityCurve: EquityPoint[];
}

export interface Position {
  sym: string;
  dir: 1 | -1;
  lots: number;
  qty: number;
  entry: number;
  margin: number;
  lev: number;
  tp: number;
  sl: number;
}

export interface TradeHistoryEntry {
  t: number;
  sym: string;
  label: string;
  qty: number;
  price: number;
  pnl: number;
}

export interface LedgerEntry {
  t: number;
  type: string;
  detail: string;
  dInr: number;
  dUsd: number;
}

export interface EquityPoint {
  t: number;
  e: number;
}

// Service types
export interface ApiService {
  get(path: string): Promise<unknown>;
  isCircuitOpen(): boolean;
  getStatus(): CircuitBreakerStatus;
  reset(): void;
}

export interface CircuitBreakerStatus {
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenUntil: number;
  isAvailable: boolean;
}

export interface WebSocketService {
  connectAll(): void;
  connect(url: string): void;
  onMessage(handler: (msg: WebSocketMessage) => void): () => void;
  onReconnect(handler: (url: string, status: string) => void): () => void;
  getStatus(): ConnectionStatus;
  closeAll(): void;
}

export interface ConnectionStatus {
  active: number;
  total: number;
  endpoints: number;
}

export interface MarketDataService {
  init(): Promise<void>;
  getMarket(symbol: string): MarketEntry | null;
  getAllMarkets(): Record<string, MarketEntry>;
  subscribe(callback: (markets: Record<string, MarketEntry>) => void): () => void;
  getDataSource(): string;
  getStats(): MarketStats;
}

export interface MarketStats {
  updates: number;
  lastUpdate: number;
  latency: number | null;
  source: string;
  sockets: number;
}

// Validation types
export interface ValidationResult {
  isValid: boolean;
  value: number | null;
  error: string | null;
  corrected?: number;
  warning?: string;
}

// App types
export interface DeltaPaperApp {
  init(): Promise<void>;
  switchSymbol(sym: string): void;
  adjustLeverage(delta: number): void;
  executeTrade(side: 1 | -1): void;
  closePosition(sym: string, price?: number): void;
  closeAll(): void;
  placeOrder(side: 1 | -1): void;
  openPosDetail(sym: string): void;
  saveTpSl(): void;
  clearTpSl(): void;
  doDeposit(): void;
  doWithdraw(): void;
  doConvert(): void;
  resetAccount(): void;
  renderAll(): void;
}

// Store types
export interface Store<T> {
  getState(): T;
  setState(partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean): void;
  subscribe(listener: (state: T, previousState: T) => void): () => void;
}

export type Middleware<T> = (
  set: (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void,
  get: () => T,
  store: Store<T>
) => (partial: Partial<T> | ((state: T) => Partial<T>), replace?: boolean) => void;
