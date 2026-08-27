/**
 * Delta Paper Trading - Funding Rate Simulator
 * Automatically deducts/adds funding fees every 8 hours for perpetual futures
 */

class FundingSimulator {
  constructor(config, stateManager, marketService, eventBus) {
    this.config = config;
    this.state = stateManager;
    this.market = marketService;
    this.events = eventBus;
    this.fundingInterval = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
    this.lastFundingTime = 0;
    this.checkInterval = null;
  }

  /**
   * Initialize the funding simulator
   */
  init() {
    // Load last funding time from state
    const state = this.state.getState();
    this.lastFundingTime = state.lastFundingTime || Date.now();

    // Check for funding every minute
    this.checkInterval = setInterval(() => this.checkFunding(), 60000);

    // Initial check
    this.checkFunding();

    DELTA_LOGGER.log('[FundingSimulator] Initialized, interval:', this.fundingInterval / 1000 / 60, 'minutes');
  }

  /**
   * Check if funding should be applied
   */
  checkFunding() {
    const now = Date.now();
    const timeSinceLastFunding = now - this.lastFundingTime;

    if (timeSinceLastFunding >= this.fundingInterval) {
      this.applyFunding();
      this.lastFundingTime = now;
      this.state.update({ lastFundingTime: now });
    }
  }

  /**
   * Apply funding to all open positions
   */
  applyFunding() {
    const state = this.state.getState();
    const positions = state.positions;

    if (Object.keys(positions).length === 0) {
      DELTA_LOGGER.log('[FundingSimulator] No open positions, skipping funding');
      return;
    }

    let totalFundingPaid = 0;
    let totalFundingReceived = 0;

    for (const [symbol, position] of Object.entries(positions)) {
      const market = this.market.getMarket(symbol);
      if (!market || !(market.price > 0)) continue;

      const fundingRate = market.funding || 0;
      if (fundingRate === 0) continue;

      // Funding is based on position value, not margin
      const positionValue = position.qty * market.price;
      const fundingAmount = positionValue * fundingRate;

      // Long positions pay when funding is positive, receive when negative
      // Short positions receive when funding is positive, pay when negative
      const funding = position.dir === 1 ? -fundingAmount : fundingAmount;

      // Update USD balance
      const currentState = this.state.getState();
      const newUsd = currentState.usd + funding;

      if (newUsd < 0) {
        DELTA_LOGGER.warn('[FundingSimulator] Insufficient margin for funding, liquidating:', symbol);
        this.events.emit(EVENTS.LIQUIDATION_TRIGGERED, { symbol, reason: 'funding' });
        continue;
      }

      this.state.update({ usd: newUsd });

      // Track funding
      if (funding > 0) {
        totalFundingReceived += funding;
      } else {
        totalFundingPaid += Math.abs(funding);
      }

      // Add to ledger
      this.pushLedgerEntry({
        type: 'Funding',
        detail: symbol,
        dInr: 0,
        dUsd: funding,
        fundingRate: fundingRate,
        positionValue: positionValue
      });

      // Emit event
      this.events.emit(EVENTS.FUNDING_ACCRUED, {
        symbol,
        funding,
        fundingRate,
        positionValue,
        direction: position.dir
      });

      DELTA_LOGGER.log('[FundingSimulator] Applied funding to', symbol + ':', 
        (funding >= 0 ? '+' : '') + funding.toFixed(4), 'USD',
        '(rate:', (fundingRate * 100).toFixed(4) + '%)');
    }

    // Summary
    if (totalFundingPaid > 0 || totalFundingReceived > 0) {
      DELTA_LOGGER.log('[FundingSimulator] Funding summary - Paid:', 
        totalFundingPaid.toFixed(4), 'Received:', totalFundingReceived.toFixed(4));
    }
  }

  /**
   * Push a ledger entry
   * @param {Object} entry - Ledger entry
   */
  pushLedgerEntry(entry) {
    const state = this.state.getState();
    const ledger = [{ ...entry, t: Date.now() }, ...state.ledger];
    if (ledger.length > 100) ledger.length = 100; // Keep more entries for funding history
    this.state.update({ ledger });
  }

  /**
   * Get next funding time
   * @returns {Date} Next funding time
   */
  getNextFundingTime() {
    return new Date(this.lastFundingTime + this.fundingInterval);
  }

  /**
   * Get time until next funding
   * @returns {number} Milliseconds until next funding
   */
  getTimeUntilFunding() {
    const nextFunding = this.lastFundingTime + this.fundingInterval;
    return Math.max(0, nextFunding - Date.now());
  }

  /**
   * Get current funding rate for a symbol
   * @param {string} symbol - Trading symbol
   * @returns {number} Funding rate (e.g., 0.0001 = 0.01%)
   */
  getFundingRate(symbol) {
    const market = this.market.getMarket(symbol);
    return market ? (market.funding || 0) : 0;
  }

  /**
   * Calculate estimated funding for a position
   * @param {Object} position - Position object
   * @returns {Object} Funding estimate
   */
  estimateFunding(position) {
    const market = this.market.getMarket(position.sym);
    if (!market) return { rate: 0, amount: 0, direction: 0 };

    const rate = market.funding || 0;
    const positionValue = position.qty * market.price;
    const amount = positionValue * rate;
    const direction = position.dir === 1 ? -1 : 1; // Longs pay when positive

    return {
      rate,
      amount: amount * direction,
      positionValue,
      nextFunding: this.getNextFundingTime()
    };
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

