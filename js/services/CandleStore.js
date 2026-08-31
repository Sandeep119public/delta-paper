/**
 * Local historical candle store.
 * IndexedDB cache with Binance-compatible kline normalization.
 * Browser-first: charts read local history, then fill missing ranges from REST.
 */
class CandleStore {
  constructor(options = {}) {
    this.dbName = options.dbName || 'delta-paper-market-data';
    this.version = 1;
    this.db = null;
    this.memory = new Map();
    this.maxMemory = options.maxMemory || 50000;
  }

  async init() {
    if (!('indexedDB' in window)) return this;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('candles')) {
          const store = db.createObjectStore('candles', { keyPath: ['symbol', 'interval', 'openTime'] });
          store.createIndex('range', ['symbol', 'interval', 'openTime']);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(() => null);
  }

  key(c) { return `${c.symbol}|${c.interval}|${c.openTime}`; }

  normalize(symbol, interval, row) {
    const c = Array.isArray(row) ? {
      openTime: Number(row[0]), open: Number(row[1]), high: Number(row[2]),
      low: Number(row[3]), close: Number(row[4]), volume: Number(row[5]),
      closeTime: Number(row[6]), trades: Number(row[8] || 0)
    } : {
      openTime: Number(row.openTime ?? row.time ?? row.t),
      open: Number(row.open), high: Number(row.high), low: Number(row.low),
      close: Number(row.close), volume: Number(row.volume ?? 0),
      closeTime: Number(row.closeTime ?? 0), trades: Number(row.trades ?? 0)
    };
    if (!Number.isFinite(c.openTime) || !Number.isFinite(c.close) || c.open <= 0 || c.high <= 0 || c.low <= 0) return null;
    return { symbol, interval, ...c, updatedAt: Date.now() };
  }

  async putMany(symbol, interval, rows) {
    const candles = rows.map(r => this.normalize(symbol, interval, r)).filter(Boolean);
    candles.forEach(c => {
      this.memory.set(this.key(c), c);
      if (this.memory.size > this.maxMemory) this.memory.delete(this.memory.keys().next().value);
    });
    if (!this.db || !candles.length) return candles.length;
    await new Promise((resolve, reject) => {
      const tx = this.db.transaction('candles', 'readwrite');
      const store = tx.objectStore('candles');
      candles.forEach(c => store.put(c));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    return candles.length;
  }

  async getRange(symbol, interval, start, end, limit = 10000) {
    const out = [];
    for (const c of this.memory.values()) {
      if (c.symbol === symbol && c.interval === interval && c.openTime >= start && c.openTime <= end) out.push(c);
    }
    if (this.db) {
      const dbRows = await new Promise(resolve => {
        const result = [];
        const tx = this.db.transaction('candles', 'readonly');
        const idx = tx.objectStore('candles').index('range');
        const req = idx.openCursor(IDBKeyRange.bound([symbol, interval, start], [symbol, interval, end]));
        req.onsuccess = () => { const cur = req.result; if (cur) { result.push(cur.value); cur.continue(); } else resolve(result); };
        req.onerror = () => resolve([]);
      });
      const map = new Map(out.map(c => [this.key(c), c]));
      dbRows.forEach(c => map.set(this.key(c), c));
      return [...map.values()].sort((a,b)=>a.openTime-b.openTime).slice(0, limit);
    }
    return out.sort((a,b)=>a.openTime-b.openTime).slice(0, limit);
  }

  async latest(symbol, interval, limit = 1000) {
    const rows = await this.getRange(symbol, interval, 0, Date.now(), limit * 2);
    return rows.slice(-limit);
  }
}
window.CandleStore = CandleStore;
