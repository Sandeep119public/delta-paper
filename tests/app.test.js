/**
 * Delta Paper Trading - Unit Tests
 * Run with: node tests/app.test.js (requires Node.js)
 */

// Mock browser globals for Node.js testing
global.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = String(value); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; }
};

global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ click: () => {} })
};

global.navigator = {
  serviceWorker: null
};

global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.WebSocket = function() {};
global.fetch = () => Promise.resolve({ ok: false, json: () => ({}) });

// Load modules (in real browser these would be loaded via script tags)
console.log('Delta Paper Trading - Test Suite');
console.log('================================\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`✗ ${name}`);
    console.error(`  Error: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// Test Configuration Module
console.log('Testing Configuration Module...');
test('DELTA_CONFIG should exist', () => {
  assert(typeof DELTA_CONFIG !== 'undefined', 'DELTA_CONFIG not defined');
});

test('DELTA_CONFIG should have required properties', () => {
  assert(DELTA_CONFIG.START_INR === 866000, 'Wrong START_INR');
  assert(DELTA_CONFIG.BASE_RATE === 86.6, 'Wrong BASE_RATE');
  assert(DELTA_CONFIG.MAX_LEVERAGE === 20, 'Wrong MAX_LEVERAGE');
  assert(Array.isArray(DELTA_CONFIG.SYMBOLS), 'SYMBOLS should be array');
  assert(DELTA_CONFIG.SYMBOLS.length === 3, 'Should have 3 symbols');
});

test('DELTA_CONFIG should have validation limits', () => {
  assert(DELTA_CONFIG.VALIDATION.MIN_LOTS === 1, 'Wrong MIN_LOTS');
  assert(DELTA_CONFIG.VALIDATION.MAX_LOTS === 10000, 'Wrong MAX_LOTS');
});

// Test Validator Module
console.log('\nTesting Validator Module...');
test('InputValidator should validate lots correctly', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  
  // Valid input
  let result = validator.validateLots(5);
  assert(result.isValid === true, 'Should be valid');
  assert(result.value === 5, 'Value should be 5');
  
  // Below minimum
  result = validator.validateLots(0);
  assert(result.isValid === true, 'Should auto-correct');
  assert(result.value === 1, 'Should correct to minimum');
  
  // Above maximum
  result = validator.validateLots(99999);
  assert(result.value === 10000, 'Should correct to maximum');
  
  // Invalid input
  result = validator.validateLots('abc');
  assert(result.isValid === true, 'Should auto-correct invalid');
  assert(result.value === 1, 'Should default to minimum');
  
  // Empty input
  result = validator.validateLots('');
  assert(result.corrected === 1, 'Should suggest correction');
});

test('InputValidator should validate deposits', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  
  // Valid deposit
  let result = validator.validateDeposit(1000);
  assert(result.isValid === true, 'Should be valid');
  assert(result.value === 1000, 'Value should match');
  
  // Below minimum
  result = validator.validateDeposit(50);
  assert(result.isValid === false, 'Should reject below minimum');
  
  // Invalid
  result = validator.validateDeposit('abc');
  assert(result.isValid === false, 'Should reject invalid');
  
  // Negative
  result = validator.validateDeposit(-100);
  assert(result.isValid === false, 'Should reject negative');
});

test('InputValidator should validate withdrawals', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  const balance = 5000;
  
  // Valid withdrawal
  let result = validator.validateWithdrawal(1000, balance);
  assert(result.isValid === true, 'Should be valid');
  
  // Exceeds balance
  result = validator.validateWithdrawal(10000, balance);
  assert(result.isValid === false, 'Should reject exceeds balance');
  
  // Below minimum
  result = validator.validateWithdrawal(50, balance);
  assert(result.isValid === false, 'Should reject below minimum');
});

test('InputValidator should validate leverage', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  
  // Valid leverage
  let result = validator.validateLeverage(10);
  assert(result.isValid === true, 'Should be valid');
  assert(result.value === 10, 'Value should match');
  
  // Below minimum
  result = validator.validateLeverage(0);
  assert(result.value === 1, 'Should correct to minimum');
  
  // Above maximum
  result = validator.validateLeverage(50);
  assert(result.value === 20, 'Should correct to maximum');
});

test('InputValidator should validate names', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  
  // Valid name
  let result = validator.validateName('John Doe');
  assert(result.isValid === true, 'Should be valid');
  assert(result.value === 'John Doe', 'Value should match');
  
  // Empty name
  result = validator.validateName('');
  assert(result.isValid === false, 'Should reject empty');
  
  // Long name
  result = validator.validateName('A'.repeat(100));
  assert(result.value.length === 50, 'Should truncate to 50');
});

test('InputValidator should format numbers', () => {
  const validator = new InputValidator(DELTA_CONFIG);
  
  assert(validator.formatINR(1000000).includes('₹'), 'Should include ₹ symbol');
  assert(validator.formatUSD(100.5).includes('$'), 'Should include $ symbol');
  assert(validator.formatNumber(1234.5, 2).length > 0, 'Should format number');
});

// Test State Module
console.log('\nTesting State Module...');
test('AppState should create default state', () => {
  const appState = new AppState(DELTA_CONFIG);
  const state = appState.createDefault();
  
  assert(state.inr === DELTA_CONFIG.START_INR, 'Should have starting INR');
  assert(state.usd === 0, 'Should start with 0 USD');
  assert(state.lev === 10, 'Should have default leverage');
  assert(typeof state.uid === 'string', 'Should have UID');
  assert(state.uid.startsWith('DE-IN-'), 'UID should have correct prefix');
});

test('AppState should load and save', () => {
  const appState = new AppState(DELTA_CONFIG);
  localStorage.clear();
  
  const state = appState.load();
  assert(state !== null, 'Should load state');
  
  appState.update({ inr: 900000 });
  const saved = JSON.parse(localStorage.getItem(DELTA_CONFIG.STORE_KEY));
  assert(saved.inr === 900000, 'Should save updates');
});

test('AppState should validate updates', () => {
  const appState = new AppState(DELTA_CONFIG);
  appState.load();
  
  // Valid update
  appState.update({ lev: 15 });
  assert(appState.get('lev') === 15, 'Should update leverage');
  
  // Invalid update should throw
  let threw = false;
  try {
    appState.update({ lev: 100 });
  } catch (e) {
    threw = true;
  }
  assert(threw === true, 'Should reject invalid leverage');
});

test('AppState should track ledger entries', () => {
  const appState = new AppState(DELTA_CONFIG);
  appState.load();
  
  const entry = appState.addLedgerEntry({
    type: 'TEST',
    amount: 1000
  });
  
  assert(entry.id !== undefined, 'Should have ID');
  assert(entry.timestamp !== undefined, 'Should have timestamp');
  assert(appState.state.ledger.length > 0, 'Should add to ledger');
});

test('AppState should track trade history', () => {
  const appState = new AppState(DELTA_CONFIG);
  appState.load();
  
  appState.addTrade({
    symbol: 'BTCUSD',
    pnl: 500,
    fee: 10
  });
  
  assert(appState.state.wins === 1, 'Should count win');
  assert(appState.state.realized === 500, 'Should track realized PnL');
  assert(appState.state.best === 500, 'Should track best trade');
});

test('AppState should subscribe to changes', () => {
  const appState = new AppState(DELTA_CONFIG);
  appState.load();
  
  let notified = false;
  const unsubscribe = appState.subscribe(() => {
    notified = true;
  });
  
  appState.update({ inr: 870000 });
  assert(notified === true, 'Should notify subscribers');
  
  // Unsubscribe should work
  unsubscribe();
  notified = false;
  appState.update({ inr: 880000 });
  assert(notified === false, 'Should not notify after unsubscribe');
});

// Summary
console.log('\n================================');
console.log(`Tests: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
console.log('================================\n');

if (failed > 0) {
  console.error('Some tests failed!');
  process.exit(1);
} else {
  console.log('All tests passed! ✓');
  process.exit(0);
}
