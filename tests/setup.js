import fs from 'node:fs';
import vm from 'node:vm';

function loadLegacyScript(path, expose) {
  let source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  if (expose) source += `\nglobalThis.${expose} = typeof ${expose} !== 'undefined' ? ${expose} : globalThis.${expose};`;
  vm.runInThisContext(source, { filename: path });
}

loadLegacyScript('../js/config.js', 'DELTA_CONFIG');
loadLegacyScript('../js/console.js', 'DELTA_LOGGER');
loadLegacyScript('../js/validator.js', 'InputValidator');
loadLegacyScript('../js/state.js', 'AppState');

globalThis.localStorage = {
  store: {},
  getItem(key) { return this.store[key] || null; },
  setItem(key, value) { this.store[key] = String(value); },
  removeItem(key) { delete this.store[key]; },
  clear() { this.store = {}; }
};

globalThis.requestAnimationFrame ??= (cb) => setTimeout(cb, 0);
globalThis.WebSocket ??= function() { this.readyState = 0; this.send = () => {}; this.close = () => {}; };
globalThis.fetch ??= () => Promise.resolve({ ok: false, json: () => ({}) });
globalThis.confirm ??= () => true;
