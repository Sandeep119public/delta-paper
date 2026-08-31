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
      schemaVersion: 1,
      revision: 1,
      updatedAt: Date.now(),
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
   * Validate a persisted snapshot. Rejects null positions/lots, NaN, Infinity,
   * arrays where objects are expected, and missing required fields.
   */
  isValidSnapshot(s) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    if (typeof s.inr !== 'number' || !Number.isFinite(s.inr) || s.inr < 0) return false;
    if (s.usd !== undefined && (typeof s.usd !== 'number' || !Number.isFinite(s.usd) || s.usd < 0)) return false;
    if (s.positions === null || (s.positions !== undefined && (typeof s.positions !== 'object' || Array.isArray(s.positions)))) return false;
    if (s.lots === null || (s.lots !== undefined && (typeof s.lots !== 'object' || Array.isArray(s.lots)))) return false;
    if (s.history !== undefined && !Array.isArray(s.history)) return false;
    if (s.ledger !== undefined && !Array.isArray(s.ledger)) return false;
    return true;
  }

  /**
   * Load state from IndexedDB (primary) or localStorage (fallback)
   */
  async load() {
    try {
      let idbState = null, localState = null;
      if (this.storage && this.storage.db) {
        try { idbState = await this.storage.get('settings', this.config.STORE_KEY); }
        catch (e) { DELTA_LOGGER.warn('[State] IndexedDB read failed:', e); }
      }
      try {
        const stored = localStorage.getItem(this.config.STORE_KEY);
        if (stored) localState = JSON.parse(stored);
      } catch (e) { DELTA_LOGGER.warn('[State] localStorage read failed:', e); }

      const newer = (a,b) => {
        if (!a) return b; if (!b) return a;
        const av = Number(a.revision||a.stateVersion||0), bv = Number(b.revision||b.stateVersion||0);
        if (av !== bv) return av > bv ? a : b;
        return Number(a.updatedAt||a.lastSeen||0) >= Number(b.updatedAt||b.lastSeen||0) ? a : b;
      };
      const validIdb = this.isValidSnapshot(idbState);
      const validLocal = this.isValidSnapshot(localState);
      const parsed = newer(validIdb ? idbState : null, validLocal ? localState : null);
      this.state = parsed ? { ...this.createDefault(), ...parsed } : this.createDefault();
      this.migrateState();
      this._dirty = true;
      this.flushSave();
      DELTA_LOGGER.log(parsed ? '[State] Loaded newest persisted state' : '[State] Created default state');
      return this.state;
    } catch (e) {
      DELTA_LOGGER.error('[State] Load failed:', e);
      this.state = this.createDefault(); this._dirty = true; this.flushSave();
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
      this.state.updatedAt = this.state.lastSeen;
      this.state.revision = Number(this.state.revision || 0) + 1;
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
   * Migrate old state versions to current format.
   * schemaVersion tracks the data shape; revision tracks saves.
   */
  migrateState() {
    const sv = Number(this.state.schemaVersion || 1);
    if (sv < 1) {
      // Migrate from pre-versioned state
      if (this.state.stateVersion !== undefined && this.state.revision === undefined) {
        this.state.revision = Number(this.state.stateVersion);
      }
      delete this.state.stateVersion;
      this.state.schemaVersion = 1;
    }
    // Future: if (sv < 2) { ... }
  }

  /**
   * Reset state to defaults
   */
  reset() {
    this.state = this.createDefault();
    this._dirty = true;
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
    if (!updates || typeof updates !== 'object') throw new Error('updates must be an object');

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

