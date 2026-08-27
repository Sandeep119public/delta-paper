# Delta Papers - Tooling Migration Guide

This document describes the migration from JSDoc-based JavaScript to a modern, strictly-typed TypeScript toolchain with Vite and Vitest.

## ✅ Completed Migrations

### 1. Strict TypeScript Setup

**Dependencies Installed:**
- `typescript` - Type checker
- `@types/node` - Node.js type definitions

**Configuration (`tsconfig.json`):**
```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "module": "ESNext",
    "target": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"]
  }
}
```

**Financial Types (`src/types/trading.ts`):**
- `Order` - Trade order with Decimal quantities
- `Position` - Open position with PnL methods
- `MarketData` - Real-time market snapshot
- `AccountState` - Account balances and stats
- `TradingConfig` - Fee rates and limits

### 2. Precision Math with Decimal.js

**Why:** Native JavaScript numbers (IEEE 754) cause floating-point errors:
```javascript
// ❌ BAD: 0.1 + 0.2 === 0.30000000000000004
// ✅ GOOD: Using Decimal.js for exact arithmetic
```

**Utilities (`src/utils/margin.ts`):**
- `calculateMargin()` - Required margin for leveraged positions
- `calculateUnrealizedPnL()` - Profit/loss calculation
- `calculateLiquidationPrice()` - Liquidation price estimation
- `validateOrder()` - Order validation before execution
- `safeDecimal()` - Safe parsing of user input

### 3. Modern Build Tooling (Vite)

**Dependencies Installed:**
- `vite` - Fast dev server and bundler
- `jsdom` - DOM simulation for testing

**Configuration (`vite.config.ts`):**
```typescript
export default defineConfig({
  server: { port: 3000, open: true },
  build: { target: 'esnext', minify: 'esbuild' },
  test: { environment: 'jsdom', globals: true }
});
```

**Scripts (`package.json`):**
```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 4. Professional Testing (Vitest)

**Dependencies Installed:**
- `vitest` - Vite-native test framework
- `jsdom` - Browser environment simulation

**Test Suite (`tests/unit/finance.test.ts`):**
- 23 passing tests covering:
  - Margin calculations
  - PnL calculations (long/short)
  - Liquidation price
  - Fee calculations
  - Order validation
  - Precision math verification

## 📋 Next Steps for Full Migration

### Phase 1: Convert Core Modules to TypeScript

1. **Convert `js/config.js` → `src/config.ts`:**
   ```typescript
   export const DELTA_CONFIG = {
     START_INR: 100000,
     START_USD: 0,
     MAX_LEVERAGE: 50,
     // ... typed configuration
   };
   ```

2. **Convert `js/state.js` → `src/state.ts`:**
   ```typescript
   import { AccountState } from './types/trading';
   
   export class AppState {
     private state: AccountState;
     // ... typed state management
   }
   ```

3. **Convert `js/validator.js` → `src/validator.ts`:**
   ```typescript
   export class InputValidator {
     validateLots(value: number): boolean {
       return Number.isInteger(value) && value >= 1;
     }
   }
   ```

### Phase 2: Update HTML Entry Point

Update `index.html` to use Vite's module entry:
```html
<script type="module" src="/src/main.ts"></script>
```

### Phase 3: Migrate Business Logic

4. **Convert `js/market.js` → `src/market.ts`:**
   - Use `MarketData` interface
   - Typed WebSocket handlers
   - Decimal prices

5. **Convert `js/app.js` → `src/app.ts`:**
   - Typed DOM references
   - Typed event handlers
   - Use Decimal for all financial calculations

### Phase 4: Add Integration Tests

- Test full trade lifecycle
- Test WebSocket reconnection
- Test state persistence

## 🎯 Benefits of This Migration

| Aspect | Before (JSDoc) | After (TypeScript) |
|--------|---------------|-------------------|
| **Type Safety** | IDE hints only | Compile-time enforcement |
| **Precision** | Floating-point errors | Exact Decimal math |
| **Dev Speed** | Slow rebuilds | Instant HMR with Vite |
| **Testing** | Manual browser testing | Fast unit tests with Vitest |
| **Refactoring** | Risky, error-prone | Safe, compiler-checked |
| **Documentation** | Comments only | Self-documenting types |

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm run test

# Run tests with coverage
npm run test:coverage

# Type check
npm run typecheck

# Build for production
npm run build
```

## ⚠️ Important Notes for Financial Apps

1. **Never use native `number` for money:** Always use `Decimal` from `decimal.js`
2. **Validate all user inputs:** Use the `validateOrder()` function before any trade
3. **Test edge cases:** Zero balances, max leverage, minimum lot sizes
4. **Log everything:** Keep audit trails for all trades and balance changes
5. **Use strict null checks:** Prevent undefined errors in critical paths

## 📚 Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Decimal.js Documentation](https://mikemcl.github.io/decimal.js/)
- [Vite Guide](https://vitejs.dev/guide/)
- [Vitest Documentation](https://vitest.dev/)
