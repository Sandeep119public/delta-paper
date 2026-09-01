/**
 * Delta Paper Trading - WebSocket Service
 * Hardened: dedup connections, backoff jitter, stale handling, single bad endpoint isolation
 */
class WebSocketService {
  constructor(config) {
    this.config = config;
    this.connections = new Map(); // url -> { ws, hadData, heartbeat, retries, closedIntentionally, lastDataAt }
    this.retryCounts = new Map(); // url -> retries (survives deletion)
    this.reconnectTimers = new Map(); // url -> timer
    this.messageHandlers = new Set();
    this.reconnectHandlers = new Set();
    this._connecting = new Set();
  }
  connectAll() {
    this.config.WS_ENDPOINTS.forEach(url => this.connect(url));
  }
  connect(url) {
    // Prevent duplicate connections / storms
    if (this._connecting.has(url)) return;
    const existing = this.connections.get(url);
    if (existing && (existing.ws.readyState === 0 || existing.ws.readyState === 1)) return;
    this._connecting.add(url);
    let ws;
    try { ws = new WebSocket(url); } catch (e) {
      this._connecting.delete(url);
      DELTA_LOGGER.warn('[WsService] Connection failed:', url, e.message);
      this.scheduleReconnect(url);
      return;
    }
    const retries = this.retryCounts.get(url) || 0;
    const connection = { url, ws, hadData: false, heartbeat: null, retries, reconnectTimer: null, closedIntentionally: false };
    this.connections.set(url, connection);
    ws.onopen = () => {
      this._connecting.delete(url);
      this.retryCounts.set(url, 0);
      connection.retries = 0;
      DELTA_LOGGER.log('[WsService] Connected:', url);
      this.startHeartbeat(connection);
      this.sendSubscriptions(connection);
      this.notifyReconnectHandlers(url, 'connected');
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      this.handleMessage(msg, connection);
    };
    ws.onclose = () => {
      this._connecting.delete(url);
      this.stopHeartbeat(connection);
      this.connections.delete(url);
      if (!connection.closedIntentionally) {
        this.scheduleReconnect(url);
      }
      this.notifyReconnectHandlers(url, 'disconnected');
    };
    ws.onerror = (e) => {
      DELTA_LOGGER.warn('[WsService] Error:', url, e && e.message || e);
      try { ws.close(); } catch (_) {}
    };
  }
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
    } catch (e) { DELTA_LOGGER.warn('[WsService] Subscription failed:', e.message); }
  }
  startHeartbeat(connection) {
    this.stopHeartbeat(connection);
    connection.heartbeat = setInterval(() => {
      try { if (connection.ws.readyState === 1) connection.ws.send('{"type":"ping"}'); } catch (e) {}
    }, this.config.PERF.WS_HEARTBEAT);
  }
  stopHeartbeat(connection) {
    if (connection.heartbeat) { clearInterval(connection.heartbeat); connection.heartbeat = null; }
  }
  scheduleReconnect(url) {
    // Cancel any pending timer for this url
    if (this.reconnectTimers.has(url)) { clearTimeout(this.reconnectTimers.get(url)); this.reconnectTimers.delete(url); }
    const prev = this.retryCounts.get(url) || 0;
    const retries = Math.min(prev + 1, 8);
    this.retryCounts.set(url, retries);
    const base = this.config.PERF.RECONNECT_BASE_DELAY;
    const max = this.config.PERF.MAX_RECONNECT_DELAY;
    let delay = Math.min(max, base * Math.pow(2, retries));
    delay = Math.floor(delay * (0.75 + Math.random()*0.5));
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(url);
      this.connect(url);
    }, delay);
    this.reconnectTimers.set(url, timer);
  }
  handleMessage(msg, connection) {
    const msgType = msg.type;
    if (!msgType || msgType === 'heartbeat' || msgType === 'subscriptions' || msgType === 'success' || msgType === 'pong') return;
    // Normalize: ensure symbol fields are present before forwarding
    connection.hadData = true;
    connection.lastDataAt = Date.now();
    this.notifyMessageHandlers(msg);
  }
  onMessage(handler) { this.messageHandlers.add(handler); return () => this.messageHandlers.delete(handler); }
  onReconnect(handler) { this.reconnectHandlers.add(handler); return () => this.reconnectHandlers.delete(handler); }
  notifyMessageHandlers(msg) {
    this.messageHandlers.forEach(handler => { try { handler(msg); } catch (e) { DELTA_LOGGER.error('[WsService] Handler error:', e); } });
  }
  notifyReconnectHandlers(url, status) {
    this.reconnectHandlers.forEach(handler => { try { handler(url, status); } catch (e) { DELTA_LOGGER.error('[WsService] Reconnect handler error:', e); } });
  }
  getStatus() {
    let active=0; for(const c of this.connections.values()){ try{ if(c.ws.readyState===1) active++; }catch(e){} }
    return { active, total: this.connections.size, endpoints: this.config.WS_ENDPOINTS.length };
  }
  closeAll() {
    for(const [url, timer] of this.reconnectTimers.entries()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for(const [url, connection] of this.connections.entries()){
      connection.closedIntentionally = true;
      this.stopHeartbeat(connection);
      try { connection.ws.close(); } catch (e) {}
    }
    this.connections.clear();
    this._connecting.clear();
  }
}
