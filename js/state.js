/**
 * Delta Paper Trading - State Management Module
 * Handles application state, persistence, and data validation
 */

class AppState {
  constructor(config) {
    this.config = config;
    this.state = null;
    this.listeners = new Set();
  }

  /**
   * Create default state object
   */
  createDefault() {
    const cfg = this.config;
    return {
      name: 'Trader',
      uid: 'DE-IN-' + (10000000 + Math.floor(Math.random() * 89999999)),
      createdAt: Date.now(),
      inr: cfg.START_INR,
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
      lastSeen: Date.now()
    };
  }

  /**
   * Load state from localStorage or create default
   */
  load() {
    try {
      const stored = localStorage.getItem(this.config.STORE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Validate and merge with defaults
        this.state = { ...this.createDefault(), ...parsed };
        this.migrateState();
        console.log('[State] Loaded from storage');
      } else {
        this.state = this.createDefault();
        console.log('[State] Created default state');
      }
      this.save();
      return this.state;
    } catch (e) {
      console.error('[State] Load failed:', e);
      this.state = this.createDefault();
      this.save();
      return this.state;
    }
  }

  /**
   * Save state to localStorage
   */
  save() {
    try {
      if (!this.state) return;
      this.state.lastSeen = Date.now();
      localStorage.setItem(this.config.STORE_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.error('[State] Save failed:', e);
      throw new Error('Failed to save state. Storage may be full.');
    }
  }

  /**
   * Migrate old state versions to current format
   */
  migrateState() {
    // Future migration logic can be added here
    // Example: if (!this.state.version) { ... }
  }

  /**
   * Reset state to defaults
   */
  reset() {
    this.state = this.createDefault();
    this.save();
    this.notifyListeners();
    console.log('[State] Reset to defaults');
  }

  /**
   * Update state partially
   * @param {Object} updates - Key-value pairs to update
   */
  update(updates) {
    if (!this.state) throw new Error('State not initialized');
    
    // Validate updates
    const validated = this.validateUpdates(updates);
    
    // Apply updates
    Object.assign(this.state, validated);
    this.save();
    this.notifyListeners();
  }

  /**
   * Validate state updates
   * @param {Object} updates - Updates to validate
   * @returns {Object} Validated updates
   */
  validateUpdates(updates) {
    const validated = {};
    const v = this.config.VALIDATION;

    for (const [key, value] of Object.entries(updates)) {
      switch (key) {
        case 'inr':
        case 'usd':
          if (typeof value !== 'number' || value < v.MIN_BALANCE) {
            throw new Error(`${key} must be a non-negative number`);
          }
          validated[key] = Number(value.toFixed(v.MAX_DECIMALS));
          break;

        case 'lev':
          if (!Number.isInteger(value) || value < 1 || value > this.config.MAX_LEVERAGE) {
            throw new Error(`Leverage must be 1-${this.config.MAX_LEVERAGE}`);
          }
          validated[key] = value;
          break;

        case 'lots':
          if (typeof value !== 'object' || value === null) {
            throw new Error('lots must be an object');
          }
          // Validate each symbol's lot count
          for (const [sym, lotCount] of Object.entries(value)) {
            if (!Number.isInteger(lotCount) || 
                lotCount < v.MIN_LOTS || 
                lotCount > v.MAX_LOTS) {
              throw new Error(`Invalid lot count for ${sym}`);
            }
          }
          validated[key] = value;
          break;

        case 'name':
          if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('Name cannot be empty');
          }
          validated[key] = value.trim().slice(0, 50);
          break;

        default:
          validated[key] = value;
      }
    }

    return validated;
  }

  /**
   * Subscribe to state changes
   * @param {Function} listener - Callback function
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new Error('Listener must be a function');
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of state change
   */
  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.state);
      } catch (e) {
        console.error('[State] Listener error:', e);
      }
    });
  }

  /**
   * Get current state
   * @returns {Object} Current state
   */
  getState() {
    return this.state;
  }

  /**
   * Get specific state property
   * @param {string} key - Property name
   * @returns {*} Property value
   */
  get(key) {
    return this.state ? this.state[key] : undefined;
  }

  /**
   * Add transaction to ledger
   * @param {Object} tx - Transaction object
   */
  addLedgerEntry(tx) {
    if (!this.state) throw new Error('State not initialized');
    
    const entry = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
      timestamp: Date.now(),
      ...tx
    };

    this.state.ledger.unshift(entry);
    
    // Keep only last 1000 entries
    if (this.state.ledger.length > 1000) {
      this.state.ledger = this.state.ledger.slice(0, 1000);
    }
    
    this.save();
    this.notifyListeners();
    return entry;
  }

  /**
   * Add trade to history
   * @param {Object} trade - Trade object
   */
  addTrade(trade) {
    if (!this.state) throw new Error('State not initialized');
    
    this.state.history.unshift(trade);
    
    // Update statistics
    if (trade.pnl !== undefined) {
      if (trade.pnl > 0) {
        this.state.wins++;
        if (trade.pnl > this.state.best) this.state.best = trade.pnl;
      } else if (trade.pnl < 0) {
        this.state.losses++;
        if (trade.pnl < this.state.worst) this.state.worst = trade.pnl;
      }
      this.state.realized += trade.pnl;
    }
    
    if (trade.fee !== undefined) {
      this.state.feesTotal += trade.fee;
    }
    
    // Keep only last 500 trades
    if (this.state.history.length > 500) {
      this.state.history = this.state.history.slice(0, 500);
    }
    
    this.save();
    this.notifyListeners();
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AppState };
}
