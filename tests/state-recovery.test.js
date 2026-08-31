import { describe, expect, it } from 'vitest';
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
  it('falls back to a valid storage copy when the newer copy is malformed', async () => {
    const AppState = loadAppState();
    const storage = {
      db: {},
      get: async () => ({ stateVersion: 9, inr: -1, positions: null, lots: null }),
      put: async () => {},
      clear: async () => {}
    };
    const s = new AppState(cfg, storage);
    await s.load();
    expect(s.get().inr).toBe(1000);
    expect(s.get().positions).toEqual({});
  });
});
