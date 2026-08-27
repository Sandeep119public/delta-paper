/**
 * Delta Paper Trading - State Management (Zustand-inspired)
 * Lightweight state management with immutable updates, subscriptions, and middleware
 */

// Middleware: localStorage persistence
function persistMiddleware(key, options = {}) {
  return (set, get, store) => {
    const newSet = (partial, replace) => {
      set(partial, replace);
      const state = get();
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch (e) {
        DELTA_LOGGER.error('[Persist] Save failed:', e);
        if (options.onError) options.onError(e);
      }
    };

    // Load initial state from localStorage
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        set(parsed, true);
      }
    } catch (e) {
      DELTA_LOGGER.error('[Persist] Load failed:', e);
    }

    return newSet;
  };
}

// Middleware: validation
function validateMiddleware(validators = {}) {
  return (set, get, store) => {
    const newSet = (partial, replace) => {
      const state = get();
      const updates = typeof partial === 'function' ? partial(state) : partial;

      // Validate each field
      for (const [key, value] of Object.entries(updates)) {
        if (validators[key]) {
          const result = validators[key](value, state);
          if (result !== true) {
            throw new Error(result || `Invalid value for ${key}`);
          }
        }
      }

      set(partial, replace);
    };

    return newSet;
  };
}

// Middleware: batch updates (prevent multiple localStorage writes)
function batchMiddleware() {
  return (set, get, store) => {
    let batchCount = 0;
    let pendingUpdates = null;

    const newSet = (partial, replace) => {
      batchCount++;
      
      if (pendingUpdates) {
        Object.assign(pendingUpdates, typeof partial === 'function' ? partial(get()) : partial);
      } else {
        pendingUpdates = typeof partial === 'function' ? partial(get()) : { ...partial };
      }

      // Defer actual update to next microtask
      if (batchCount === 1) {
        queueMicrotask(() => {
          const updates = pendingUpdates;
          pendingUpdates = null;
          batchCount = 0;
          set(updates, replace);
        });
      }
    };

    return newSet;
  };
}

// Create store
function createStore(createState, middlewares = []) {
  let state;
  const listeners = new Set();

  const getState = () => state;

  const setState = (partial, replace) => {
    const nextState = typeof partial === 'function' ? partial(state) : partial;
    
    if (!Object.is(nextState, state)) {
      const previousState = state;
      state = replace ? nextState : { ...state, ...nextState };
      
      listeners.forEach(listener => {
        try {
          listener(state, previousState);
        } catch (e) {
          DELTA_LOGGER.error('[Store] Listener error:', e);
        }
      });
    }
  };

  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  // Apply middlewares (in reverse order)
  let enhancedSet = setState;
  for (let i = middlewares.length - 1; i >= 0; i--) {
    enhancedSet = middlewares[i](enhancedSet, getState, { getState, setState: enhancedSet, subscribe });
  }

  // Initialize state
  state = createState(setState, getState);

  return {
    getState,
    setState: enhancedSet,
    subscribe
  };
}

// Default state creator
function createDefaultState() {
  return {
    name: 'Trader',
    uid: 'DE-IN-' + (10000000 + Math.floor(Math.random() * 89999999)),
    createdAt: Date.now(),
    inr: DELTA_CONFIG.START_INR,
    usd: 0,
    lev: 10,
    lots: {},
    positions: {},
    history: [],
    ledger: [],
    realized: 0,
    wins: 0,
    losses: 0,
    feesTotal: 0,
    best: 0,
    worst: 0,
    lastSeen: Date.now(),
    equityCurve: []
  };
}

// Validation rules
const validators = {
  inr: (value) => {
    if (typeof value !== 'number' || value < 0) return 'INR must be non-negative';
    return true;
  },
  usd: (value) => {
    if (typeof value !== 'number' || value < 0) return 'USD must be non-negative';
    return true;
  },
  lev: (value) => {
    if (!Number.isInteger(value) || value < 1 || value > DELTA_CONFIG.MAX_LEVERAGE) {
      return `Leverage must be 1-${DELTA_CONFIG.MAX_LEVERAGE}`;
    }
    return true;
  },
  lots: (value) => {
    if (typeof value !== 'object' || value === null) return 'Lots must be an object';
    for (const [sym, lotCount] of Object.entries(value)) {
      if (!Number.isInteger(lotCount) || lotCount < 1 || lotCount > 10000) {
        return `Invalid lot count for ${sym}`;
      }
    }
    return true;
  },
  name: (value) => {
    if (typeof value !== 'string' || value.trim().length === 0) return 'Name cannot be empty';
    return true;
  }
};

// Create the store with middlewares
const appStore = createStore(
  (set, get) => {
    // Load from localStorage or use defaults
    try {
      const stored = localStorage.getItem(DELTA_CONFIG.STORE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...createDefaultState(), ...parsed };
      }
    } catch (e) {
      DELTA_LOGGER.error('[Store] Load failed:', e);
    }
    return createDefaultState();
  },
  [
    persistMiddleware(DELTA_CONFIG.STORE_KEY, {
      onError: (e) => {
        DELTA_LOGGER.error('[Store] Critical: localStorage unavailable');
      }
    }),
    validateMiddleware(validators)
  ]
);

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { appStore, createStore, createDefaultState };
}
