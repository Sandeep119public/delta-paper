/**
 * Delta Paper Trading - IndexedDB Storage Wrapper
 * Unlimited local storage for trade history and tick data
 */

class IndexedDBStorage {
  constructor(dbName = 'DeltaPaperDB', version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
    this.isAvailable = typeof indexedDB !== 'undefined';
  }

  /**
   * Initialize the database
   * @returns {Promise<IDBDatabase>}
   */
  async init() {
    if (!this.isAvailable) {
      DELTA_LOGGER.warn('[IndexedDB] Not available, falling back to localStorage');
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        DELTA_LOGGER.error('[IndexedDB] Open failed:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        DELTA_LOGGER.log('[IndexedDB] Connected to', this.dbName);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Trade history store
        if (!db.objectStoreNames.contains('trades')) {
          const tradeStore = db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
          tradeStore.createIndex('timestamp', 'timestamp', { unique: false });
          tradeStore.createIndex('symbol', 'symbol', { unique: false });
          tradeStore.createIndex('type', 'type', { unique: false });
        }

        // Ledger entries store
        if (!db.objectStoreNames.contains('ledger')) {
          const ledgerStore = db.createObjectStore('ledger', { keyPath: 'id', autoIncrement: true });
          ledgerStore.createIndex('timestamp', 'timestamp', { unique: false });
          ledgerStore.createIndex('type', 'type', { unique: false });
        }

        // Tick data store (for backtesting)
        if (!db.objectStoreNames.contains('ticks')) {
          const tickStore = db.createObjectStore('ticks', { keyPath: 'id', autoIncrement: true });
          tickStore.createIndex('timestamp', 'timestamp', { unique: false });
          tickStore.createIndex('symbol', 'symbol', { unique: false });
          tickStore.createIndex('symbol_timestamp', ['symbol', 'timestamp'], { unique: false });
        }

        // Equity curve store
        if (!db.objectStoreNames.contains('equity')) {
          const equityStore = db.createObjectStore('equity', { keyPath: 'id', autoIncrement: true });
          equityStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Orders store (for pending limit/stop orders)
        if (!db.objectStoreNames.contains('orders')) {
          const orderStore = db.createObjectStore('orders', { keyPath: 'id' });
          orderStore.createIndex('symbol', 'symbol', { unique: false });
          orderStore.createIndex('status', 'status', { unique: false });
          orderStore.createIndex('type', 'type', { unique: false });
        }

        // Settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }

        DELTA_LOGGER.log('[IndexedDB] Schema created/updated');
      };
    });
  }

  /**
   * Add an item to a store
   * @param {string} storeName - Store name
   * @param {Object} data - Data to add
   * @returns {Promise<number>} Inserted ID
   */
  async add(storeName, data) {
    if (!this.db) return this.fallbackAdd(storeName, data);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.add({ ...data, timestamp: Date.now() });

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all items from a store
   * @param {string} storeName - Store name
   * @param {Object} [options] - Query options (limit, index, value)
   * @returns {Promise<Array>}
   */
  async getAll(storeName, options = {}) {
    if (!this.db) return this.fallbackGetAll(storeName);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      let request;

      if (options.index && options.value !== undefined) {
        const index = store.index(options.index);
        request = index.getAll(options.value);
      } else {
        request = store.getAll();
      }

      request.onsuccess = () => {
        let results = request.result;
        if (options.limit) {
          results = results.slice(-options.limit);
        }
        if (options.order === 'desc') {
          results.reverse();
        }
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a single item by key
   * @param {string} storeName - Store name
   * @param {*} key - Key to lookup
   * @returns {Promise<Object|null>}
   */
  async get(storeName, key) {
    if (!this.db) return this.fallbackGet(storeName, key);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.get(key);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update an item
   * @param {string} storeName - Store name
   * @param {Object} data - Data to update (must include keyPath)
   * @returns {Promise<void>}
   */
  async put(storeName, data) {
    if (!this.db) return this.fallbackPut(storeName, data);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.put(data);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Delete an item by key
   * @param {string} storeName - Store name
   * @param {*} key - Key to delete
   * @returns {Promise<void>}
   */
  async delete(storeName, key) {
    if (!this.db) return this.fallbackDelete(storeName, key);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.delete(key);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all items from a store
   * @param {string} storeName - Store name
   * @returns {Promise<void>}
   */
  async clear(storeName) {
    if (!this.db) return this.fallbackClear(storeName);

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Count items in a store
   * @param {string} storeName - Store name
   * @returns {Promise<number>}
   */
  async count(storeName) {
    if (!this.db) return 0;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get items within a timestamp range
   * @param {string} storeName - Store name
   * @param {number} startTime - Start timestamp
   * @param {number} endTime - End timestamp
   * @returns {Promise<Array>}
   */
  async getByTimeRange(storeName, startTime, endTime) {
    if (!this.db) return [];

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index('timestamp');
      const range = IDBKeyRange.bound(startTime, endTime);
      const request = index.getAll(range);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Prune old data from a store
   * @param {string} storeName - Store name
   * @param {number} maxAge - Max age in milliseconds
   * @returns {Promise<number>} Number of items removed
   */
  async prune(storeName, maxAge) {
    if (!this.db) return 0;

    const cutoff = Date.now() - maxAge;
    const items = await this.getByTimeRange(storeName, 0, cutoff);

    for (const item of items) {
      await this.delete(storeName, item.id);
    }

    return items.length;
  }

  // Fallback methods for localStorage
  fallbackAdd(storeName, data) {
    const items = this.getFallbackItems(storeName);
    data.id = items.length + 1;
    data.timestamp = Date.now();
    items.push(data);
    localStorage.setItem('idb_' + storeName, JSON.stringify(items));
    return data.id;
  }

  fallbackGetAll(storeName) {
    return this.getFallbackItems(storeName);
  }

  fallbackGet(storeName, key) {
    const items = this.getFallbackItems(storeName);
    return items.find(item => item.id === key) || null;
  }

  fallbackPut(storeName, data) {
    const items = this.getFallbackItems(storeName);
    const index = items.findIndex(item => item.id === data.id);
    if (index !== -1) {
      items[index] = data;
    } else {
      items.push(data);
    }
    localStorage.setItem('idb_' + storeName, JSON.stringify(items));
  }

  fallbackDelete(storeName, key) {
    const items = this.getFallbackItems(storeName);
    const filtered = items.filter(item => item.id !== key);
    localStorage.setItem('idb_' + storeName, JSON.stringify(filtered));
  }

  fallbackClear(storeName) {
    localStorage.removeItem('idb_' + storeName);
  }

  getFallbackItems(storeName) {
    try {
      return JSON.parse(localStorage.getItem('idb_' + storeName) || '[]');
    } catch (e) {
      return [];
    }
  }
}

// Singleton instance
const storage = new IndexedDBStorage();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IndexedDBStorage, storage };
}
