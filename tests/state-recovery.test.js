import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';

function loadAppState() {
  const src = fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
  const Module = new Function('exports', 'module', src + '\nmodule.exports = { AppState };');
  const mod = { exports: {} };
  Module(mod.exports, mod);
  return mod.exports.AppState;
}

const cfg = { START_INR: 1000, STORE_KEY: 'x', MAX_LEVERAGE: 20, VALIDATION: { MIN_BALANCE: 0, MAX_DECIMALS: 8, MIN_LOTS: 1, MAX_LOTS: 100 } };

describe('state recovery', () => {
  beforeEach(() => { localStorage.clear(); });
  it('falls back to a valid storage copy when the newer copy is malformed', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 9, inr: -1, positions: null, lots: null }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(1000);
    expect(s.get().positions).toEqual({});
  });

  it('rejects null positions and null lots', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: 500, positions: null, lots: {} }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().positions).toEqual({});
  });

  it('rejects null lots', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: 500, positions: {}, lots: null }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().lots).toEqual({});
  });

  it('rejects arrays where objects are expected', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: 500, positions: [], lots: [] }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().positions).toEqual({});
    expect(s.get().lots).toEqual({});
  });

  it('rejects NaN balance', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: NaN, positions: {}, lots: {} }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(1000);
  });

  it('rejects Infinity balance', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: Infinity, positions: {}, lots: {} }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(1000);
  });

  it('prefers newer valid snapshot over older valid one', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 10, inr: 2000, positions: {}, lots: {} }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(2000);
  });

  it('recovers when both sources are invalid', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ revision: 1, inr: -1, positions: null, lots: null }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(1000);
  });

  it('sets schemaVersion and revision on default state', async () => {
    const AppState = loadAppState();
    const s = new AppState(cfg);
    const defaults = s.createDefault();
    expect(defaults.schemaVersion).toBe(1);
    expect(defaults.revision).toBe(1);
    expect(defaults.updatedAt).toBeGreaterThan(0);
  });
});
