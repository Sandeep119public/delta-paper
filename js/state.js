/**
 * Delta Paper Trading - State Management Module
 * Handles application state, persistence, and data validation
 */

class AppState {
  constructor(config, storage) {
    this.config = config;
    this.state = null;
    this.listeners = new Set();
    this.storage = storage || null;
    this._saveTimer = null;
    this._dirty = false;
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
      lastSeen: Date.now(),
      equityCurve: []
    };
  }

  /**
   * Load state from IndexedDB (primary) or localStorage (fallback)
   */
  async load() {
    try {
      let parsed = null;

      // Try IndexedDB first
      if (this.storage && this.storage.db) {
        try {
          parsed = await this.storage.get('settings', this.config.STORE_KEY);
        } catch (e) {
          DELTA_LOGGER.warn('[State] IndexedDB read failed, falling back:', e);
        }
      }

      // Fall back to localStorage
      if (!parsed) {
        const stored = localStorage.getItem(this.config.STORE_KEY);
        if (stored) {
          parsed = JSON.parse(stored);
          // Migrate to IndexedDB in background
          if (this.storage && this.storage.db) {
            this.storage.put('settings', { key: this.config.STORE_KEY, ...parsed }).catch(() => {});
          }
        }
      }

      if (parsed) {
        this.state = { ...this.createDefault(), ...parsed };
        this.migrateState();
        DELTA_LOGGER.log('[State] Loaded from storage');
      } else {
        this.state = this.createDefault();
        DELTA_LOGGER.log('[State] Created default state');
      }
      this.flushSave();
      return this.state;
    } catch (e) {
      DELTA_LOGGER.error('[State] Load failed:', e);
      this.state = this.createDefault();
      this.flushSave();
      return this.state;
    }
  }

  /**
   * Save state to localStorage (sync) and IndexedDB (async background)
   * Debounced: batches rapid updates into a single write every 2 seconds
   */
  save() {
    if (!this.state) return;
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushSave();
    }, 2000);
  }

  /**
   * Immediately persist state (for critical user actions)
   */
  flushSave() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this._flushSave();
  }

  /** @private */
  _flushSave() {
    if (!this._dirty || !this.state) return;
    try {
      this.state.lastSeen = Date.now();
      localStorage.setItem(this.config.STORE_KEY, JSON.stringify(this.state));
      if (this.storage && this.storage.db) {
        const clone = { key: this.config.STORE_KEY };
        for (const k in this.state) {
          const v = this.state[k];
          if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            clone[k] = { ...v };
          } else {
            clone[k] = Array.isArray(v) ? v.map(i => typeof i === 'object' ? { ...i } : i) : v;
          }
        }
        this.storage.put('settings', clone).catch(e => {
          DELTA_LOGGER.warn('[State] IndexedDB save failed:', e);
        });
      }
      this._dirty = false;
    } catch (e) {
      DELTA_LOGGER.error('[State] Save failed:', e);
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
    this.flushSave();
    this.notifyListeners();
    DELTA_LOGGER.log('[State] Reset to defaults');
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
        DELTA_LOGGER.error('[State] Listener error:', e);
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
   * Get specific state property or entire state if no key provided
   * @param {string} [key] - Property name (optional)
   * @returns {*} Property value or entire state
   */
  get(key) {
    if (!this.state) return undefined;
    return key === undefined ? this.state : this.state[key];
  }
}

