/**
 * Delta Paper Trading - Keyboard Shortcuts
 * Hotkeys for rapid execution by active traders
 */

class KeyboardShortcuts {
  constructor(config, eventBus) {
    this.config = config;
    this.events = eventBus;
    this.shortcuts = new Map();
    this.isEnabled = true;
    this.handler = this.handleKeyDown.bind(this);
  }

  /**
   * Initialize keyboard shortcuts
   */
  init() {
    // Register default shortcuts
    this.registerDefaults();
    
    // Add event listener
    document.addEventListener('keydown', this.handler);
    
    DELTA_LOGGER.log('[KeyboardShortcuts] Initialized');
  }

  /**
   * Register default keyboard shortcuts
   */
  registerDefaults() {
    // Buy/Sell shortcuts
    this.register('b', () => this.events.emit(EVENTS.ORDER_PLACED, { type: 'BUY_TICKET' }));
    this.register('s', () => this.events.emit(EVENTS.ORDER_PLACED, { type: 'SELL_TICKET' }));
    
    // Flatten (close all positions)
    this.register('f', () => this.events.emit(EVENTS.ORDER_PLACED, { type: 'FLATTEN' }));
    
    // Cancel all orders
    this.register('Escape', () => this.events.emit(EVENTS.ORDER_CANCELLED, { type: 'CANCEL_ALL' }));
    
    // Quick leverage settings
    this.register('Shift+1', () => this.events.emit(EVENTS.LEVERAGE_CHANGED, { leverage: 1 }));
    this.register('Shift+2', () => this.events.emit(EVENTS.LEVERAGE_CHANGED, { leverage: 5 }));
    this.register('Shift+3', () => this.events.emit(EVENTS.LEVERAGE_CHANGED, { leverage: 10 }));
    this.register('Shift+4', () => this.events.emit(EVENTS.LEVERAGE_CHANGED, { leverage: 15 }));
    this.register('Shift+5', () => this.events.emit(EVENTS.LEVERAGE_CHANGED, { leverage: 20 }));
    
    // Symbol switching
    this.register('1', () => this.events.emit(EVENTS.SYMBOL_CHANGED, { symbol: 'BTCUSD' }));
    this.register('2', () => this.events.emit(EVENTS.SYMBOL_CHANGED, { symbol: 'ETHUSD' }));
    this.register('3', () => this.events.emit(EVENTS.SYMBOL_CHANGED, { symbol: 'SOLUSD' }));
    
    // Quantity shortcuts
    this.register('q', () => this.events.emit('quantity:set', { lots: 1 }));
    this.register('w', () => this.events.emit('quantity:set', { lots: 5 }));
    this.register('e', () => this.events.emit('quantity:set', { lots: 10 }));
    this.register('r', () => this.events.emit('quantity:set', { lots: 25 }));
    
    // Menu shortcuts
    this.register('m', () => this.events.emit(EVENTS.MODAL_OPENED, { modal: 'menuOverlay' }));
    this.register('h', () => this.events.emit(EVENTS.MODAL_OPENED, { modal: 'hisOverlay' }));
    this.register('a', () => this.events.emit(EVENTS.MODAL_OPENED, { modal: 'acctOverlay' }));
    
    // Trading actions
    this.register('Enter', () => this.events.emit('trade:confirm'));
    this.register('Shift+Enter', () => this.events.emit('trade:confirm', { force: true }));
    
    // Number keys for quick lot selection (when not in input)
    this.register('4', () => this.events.emit('quantity:set', { lots: 50 }));
    this.register('5', () => this.events.emit('quantity:set', { lots: 100 }));
    this.register('6', () => this.events.emit('quantity:set', { lots: 250 }));
    this.register('7', () => this.events.emit('quantity:set', { lots: 500 }));
    this.register('8', () => this.events.emit('quantity:set', { lots: 1000 }));
    this.register('9', () => this.events.emit('quantity:set', { lots: 2500 }));
    this.register('0', () => this.events.emit('quantity:set', { lots: 'max' }));
  }

  /**
   * Register a keyboard shortcut
   * @param {string} key - Key combination (e.g., 'Shift+1', 'b')
   * @param {Function} callback - Callback function
   */
  register(key, callback) {
    this.shortcuts.set(key.toLowerCase(), callback);
  }

  /**
   * Unregister a keyboard shortcut
   * @param {string} key - Key combination
   */
  unregister(key) {
    this.shortcuts.delete(key.toLowerCase());
  }

  /**
   * Handle keydown event
   * @param {KeyboardEvent} event - Keyboard event
   */
  handleKeyDown(event) {
    if (!this.isEnabled) return;

    // Don't trigger shortcuts when typing in inputs
    if (this.isInputFocused()) return;

    const key = this.getKeyString(event);
    const callback = this.shortcuts.get(key);

    if (callback) {
      event.preventDefault();
      event.stopPropagation();
      
      try {
        callback(event);
      } catch (e) {
        DELTA_LOGGER.error('[KeyboardShortcuts] Error executing shortcut:', key, e);
      }
    }
  }

  /**
   * Get key string from event
   * @param {KeyboardEvent} event - Keyboard event
   * @returns {string} Key string
   */
  getKeyString(event) {
    const parts = [];
    
    if (event.ctrlKey) parts.push('Ctrl');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    if (event.metaKey) parts.push('Meta');
    
    let key = event.key.toLowerCase();
    if (key === ' ') key = 'space';
    if (key === 'escape') key = 'Escape';
    if (key === 'enter') key = 'Enter';
    
    parts.push(key);
    
    return parts.join('+');
  }

  /**
   * Check if an input field is focused
   * @returns {boolean} True if input is focused
   */
  isInputFocused() {
    const active = document.activeElement;
    if (!active) return false;
    
    const tagName = active.tagName.toLowerCase();
    return tagName === 'input' || 
           tagName === 'textarea' || 
           tagName === 'select' ||
           active.contentEditable === 'true';
  }

  /**
   * Enable keyboard shortcuts
   */
  enable() {
    this.isEnabled = true;
  }

  /**
   * Disable keyboard shortcuts
   */
  disable() {
    this.isEnabled = false;
  }

  /**
   * Toggle keyboard shortcuts
   */
  toggle() {
    this.isEnabled = !this.isEnabled;
  }

  /**
   * Get all registered shortcuts
   * @returns {Array} List of shortcuts
   */
  listShortcuts() {
    return Array.from(this.shortcuts.keys()).map(key => ({
      key,
      description: this.getShortcutDescription(key)
    }));
  }

  /**
   * Get description for a shortcut
   * @param {string} key - Key combination
   * @returns {string} Description
   */
  getShortcutDescription(key) {
    const descriptions = {
      'b': 'Open Buy ticket',
      's': 'Open Sell ticket',
      'f': 'Flatten (close all positions)',
      'escape': 'Cancel all orders',
      'shift+1': 'Set leverage to 1x',
      'shift+2': 'Set leverage to 5x',
      'shift+3': 'Set leverage to 10x',
      'shift+4': 'Set leverage to 15x',
      'shift+5': 'Set leverage to 20x',
      '1': 'Switch to BTCUSD',
      '2': 'Switch to ETHUSD',
      '3': 'Switch to SOLUSD',
      'q': 'Set quantity to 1 lot',
      'w': 'Set quantity to 5 lots',
      'e': 'Set quantity to 10 lots',
      'r': 'Set quantity to 25 lots',
      'm': 'Open Menu',
      'h': 'Open History',
      'a': 'Open Account',
      'enter': 'Confirm trade',
      'shift+enter': 'Force confirm trade'
    };
    
    return descriptions[key] || key;
  }

  /**
   * Cleanup
   */
  destroy() {
    document.removeEventListener('keydown', this.handler);
    this.shortcuts.clear();
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = KeyboardShortcuts;
}
