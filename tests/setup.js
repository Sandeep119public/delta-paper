/**
 * Delta Paper Trading - Test Setup
 * Loads globals and mocks for vitest tests
 */

// Load configuration
import '../js/config.js';
import '../js/console.js';

// Mock browser globals
if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = {
    store: {},
    getItem(key) { return this.store[key] || null; },
    setItem(key, value) { this.store[key] = String(value); },
    removeItem(key) { delete this.store[key]; },
    clear() { this.store = {}; }
  };
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
}

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = function() {
    this.readyState = 0;
    this.send = () => {};
    this.close = () => {};
  };
}

if (typeof globalThis.fetch === 'undefined') {
  globalThis.fetch = () => Promise.resolve({ ok: false, json: () => ({}) });
}

if (typeof globalThis.confirm === 'undefined') {
  globalThis.confirm = () => true;
}
