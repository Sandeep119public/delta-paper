/**
 * Delta Paper Trading - WebSocket Service
 * Manages WebSocket connections with heartbeat and exponential backoff reconnection
 */

class WebSocketService {
  constructor(config) {
    this.config = config;
    this.connections = new Map(); // url -> { ws, hadData, heartbeat, retries }
    this.messageHandlers = new Set();
    this.reconnectHandlers = new Set();
  }

  /**
   * Connect to all WebSocket endpoints
   */
  connectAll() {
    this.config.WS_ENDPOINTS.forEach(url => this.connect(url));
  }

  /**
   * Open WebSocket connection to a specific endpoint
   * @param {string} url - WebSocket endpoint URL
   */
  connect(url) {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      DELTA_LOGGER.warn('[WsService] Connection failed:', url, e.message);
      this.scheduleReconnect(url);
      return;
    }

    const connection = {
      url,
      ws,
      hadData: false,
      heartbeat: null,
      retries: 0
    };

    this.connections.set(url, connection);

    ws.onopen = () => {
      DELTA_LOGGER.log('[WsService] Connected:', url);
      this.startHeartbeat(connection);
      this.sendSubscriptions(connection);
      this.notifyReconnectHandlers(url, 'connected');
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      this.handleMessage(msg, connection);
    };

    ws.onclose = () => {
      this.stopHeartbeat(connection);
      this.connections.delete(url);
      this.scheduleReconnect(url);
      this.notifyReconnectHandlers(url, 'disconnected');
    };

    ws.onerror = (e) => {
      DELTA_LOGGER.warn('[WsService] Error:', url, e);
      try { ws.close(); } catch (e) {}
    };
  }

  /**
   * Send subscription messages - Delta India specific format
   * @param {Object} connection - Connection object
   */
  sendSubscriptions(connection) {
    const ws = connection.ws;
    if (!ws || ws.readyState !== 1) return;

    try {
      ws.send(JSON.stringify({
        type: 'subscribe',
        payload: {
          channels: [
            { name: 'ticker', symbols: this.config.SYMBOLS },
            { name: 'trades', symbols: this.config.SYMBOLS },
            { name: 'mark_price', symbols: this.config.SYMBOLS.map(s => 'MARK:' + s) }
          ]
        }
      }));

      ws.send(JSON.stringify({ type: 'enable_heartbeat' }));
      DELTA_LOGGER.log('[WsService] Subscribed to:', this.config.SYMBOLS.join(', '));
    } catch (e) {
      DELTA_LOGGER.warn('[WsService] Subscription failed:', e.message);
    }
  }

  /**
   * Start heartbeat interval for a connection
   * @param {Object} connection - Connection object
   */
  startHeartbeat(connection) {
    this.stopHeartbeat(connection);
    connection.heartbeat = setInterval(() => {
      try {
        if (connection.ws.readyState === 1) {
          connection.ws.send('{"type":"ping"}');
        }
      } catch (e) {}
    }, this.config.PERF.WS_HEARTBEAT);
  }

  /**
   * Stop heartbeat interval for a connection
   * @param {Object} connection - Connection object
   */
  stopHeartbeat(connection) {
    if (connection.heartbeat) {
      clearInterval(connection.heartbeat);
      connection.heartbeat = null;
    }
  }

  /**
   * Schedule WebSocket reconnection with exponential backoff
   * @param {string} url - WebSocket endpoint URL
   */
  scheduleReconnect(url) {
    const connection = this.connections.get(url);
    if (connection) {
      connection.retries = Math.min(connection.retries + 1, 8);
    }

    const retries = connection ? connection.retries : 1;
    const delay = Math.min(
      this.config.PERF.MAX_RECONNECT_DELAY,
      this.config.PERF.RECONNECT_BASE_DELAY * Math.pow(2, retries)
    );

    setTimeout(() => {
      this.connections.delete(url);
      this.connect(url);
    }, delay);
  }

  /**
   * Handle incoming WebSocket message
   * @param {Object} msg - Parsed message
   * @param {Object} connection - Connection object
   */
  handleMessage(msg, connection) {
    const msgType = msg.type;

    // Skip non-data messages
    if (!msgType || msgType === 'heartbeat' || msgType === 'subscriptions' || 
        msgType === 'success' || msgType === 'pong') {
      return;
    }

    connection.hadData = true;
    this.notifyMessageHandlers(msg);
  }

  /**
   * Add message handler
   * @param {Function} handler - Message handler function
   * @returns {Function} Unsubscribe function
   */
  onMessage(handler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Add reconnect handler
   * @param {Function} handler - Reconnect handler function
   * @returns {Function} Unsubscribe function
   */
  onReconnect(handler) {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  /**
   * Notify all message handlers
   * @param {Object} msg - Message to send
   */
  notifyMessageHandlers(msg) {
    this.messageHandlers.forEach(handler => {
      try {
        handler(msg);
      } catch (e) {
        DELTA_LOGGER.error('[WsService] Handler error:', e);
      }
    });
  }

  /**
   * Notify all reconnect handlers
   * @param {string} url - WebSocket URL
   * @param {string} status - Connection status
   */
  notifyReconnectHandlers(url, status) {
    this.reconnectHandlers.forEach(handler => {
      try {
        handler(url, status);
      } catch (e) {
        DELTA_LOGGER.error('[WsService] Reconnect handler error:', e);
      }
    });
  }

  /**
   * Get connection status
   * @returns {Object} Connection statistics
   */
  getStatus() {
    const active = Array.from(this.connections.values()).filter(c => c.ws.readyState === 1).length;
    return {
      active,
      total: this.connections.size,
      endpoints: this.config.WS_ENDPOINTS.length
    };
  }

  /**
   * Close all connections
   */
  closeAll() {
    this.connections.forEach((connection, url) => {
      this.stopHeartbeat(connection);
      try {
        connection.ws.close();
      } catch (e) {}
    });
    this.connections.clear();
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebSocketService;
}
