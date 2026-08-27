/**
 * Delta Paper Trading - Risk Metrics Calculator
 * Calculates Max Drawdown, Sharpe Ratio, Sortino Ratio, and other risk metrics
 */

class RiskMetrics {
  constructor(config, stateManager) {
    this.config = config;
    this.state = stateManager;
    this.returns = [];
    this.peakEquity = 0;
    this.maxDrawdown = 0;
    this.maxDrawdownPercent = 0;
  }

  /**
   * Calculate all risk metrics
   * @returns {Object} Risk metrics
   */
  calculate() {
    const state = this.state.getState();
    const equityCurve = state.equityCurve || [];

    if (equityCurve.length < 2) {
      return this.getDefaultMetrics();
    }

    // Calculate returns from equity curve
    this.returns = this.calculateReturns(equityCurve);

    // Calculate metrics
    const sharpe = this.calculateSharpeRatio();
    const sortino = this.calculateSortinoRatio();
    const maxDD = this.calculateMaxDrawdown(equityCurve);
    const winRate = this.calculateWinRate(state);
    const profitFactor = this.calculateProfitFactor(state);
    const expectancy = this.calculateExpectancy(state);
    const calmar = this.calculateCalmarRatio(equityCurve);

    return {
      maxDrawdown: maxDD.amount,
      maxDrawdownPercent: maxDD.percent,
      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      calmarRatio: calmar,
      winRate,
      profitFactor,
      expectancy,
      totalTrades: state.wins + state.losses,
      winningTrades: state.wins,
      losingTrades: state.losses,
      averageWin: state.wins > 0 ? state.realized / state.wins : 0,
      averageLoss: state.losses > 0 ? state.realized / state.losses : 0,
      bestTrade: state.best,
      worstTrade: state.worst,
      totalFees: state.feesTotal
    };
  }

  /**
   * Calculate returns from equity curve
   * @param {Array} equityCurve - Array of equity points
   * @returns {Array} Array of returns
   */
  calculateReturns(equityCurve) {
    const returns = [];
    for (let i = 1; i < equityCurve.length; i++) {
      const prev = equityCurve[i - 1].e;
      const curr = equityCurve[i].e;
      if (prev > 0) {
        returns.push((curr - prev) / prev);
      }
    }
    return returns;
  }

  /**
   * Calculate Sharpe Ratio
   * @param {number} riskFreeRate - Annualized risk-free rate (default: 6% for INR)
   * @returns {number} Sharpe ratio
   */
  calculateSharpeRatio(riskFreeRate = 0.06) {
    if (this.returns.length < 2) return 0;

    const mean = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    const variance = this.returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (this.returns.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualize (assuming daily returns)
    const annualizedReturn = mean * 365;
    const annualizedStdDev = stdDev * Math.sqrt(365);

    return (annualizedReturn - riskFreeRate) / annualizedStdDev;
  }

  /**
   * Calculate Sortino Ratio
   * @param {number} targetReturn - Target return (default: 0)
   * @returns {number} Sortino ratio
   */
  calculateSortinoRatio(targetReturn = 0) {
    if (this.returns.length < 2) return 0;

    const mean = this.returns.reduce((a, b) => a + b, 0) / this.returns.length;
    
    // Calculate downside deviation (only negative returns)
    const downsideReturns = this.returns.filter(r => r < targetReturn);
    if (downsideReturns.length === 0) return Infinity;

    const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r - targetReturn, 2), 0) / downsideReturns.length;
    const downsideDeviation = Math.sqrt(downsideVariance);

    if (downsideDeviation === 0) return Infinity;

    // Annualize
    const annualizedReturn = mean * 365;
    const annualizedDownside = downsideDeviation * Math.sqrt(365);

    return (annualizedReturn - targetReturn) / annualizedDownside;
  }

  /**
   * Calculate Maximum Drawdown
   * @param {Array} equityCurve - Array of equity points
   * @returns {Object} Drawdown info
   */
  calculateMaxDrawdown(equityCurve) {
    if (equityCurve.length < 2) return { amount: 0, percent: 0 };

    let peak = equityCurve[0].e;
    let maxDD = 0;
    let maxDDPercent = 0;

    for (const point of equityCurve) {
      if (point.e > peak) {
        peak = point.e;
      }

      const drawdown = peak - point.e;
      const drawdownPercent = (drawdown / peak) * 100;

      if (drawdown > maxDD) {
        maxDD = drawdown;
      }
      if (drawdownPercent > maxDDPercent) {
        maxDDPercent = drawdownPercent;
      }
    }

    this.peakEquity = peak;
    this.maxDrawdown = maxDD;
    this.maxDrawdownPercent = maxDDPercent;

    return { amount: maxDD, percent: maxDDPercent };
  }

  /**
   * Calculate Win Rate
   * @param {Object} state - Application state
   * @returns {number} Win rate as percentage
   */
  calculateWinRate(state) {
    const total = state.wins + state.losses;
    if (total === 0) return 0;
    return (state.wins / total) * 100;
  }

  /**
   * Calculate Profit Factor
   * @param {Object} state - Application state
   * @returns {number} Profit factor
   */
  calculateProfitFactor(state) {
    if (state.losses === 0) return state.wins > 0 ? Infinity : 0;
    
    const grossProfit = state.realized > 0 ? state.realized : 0;
    const grossLoss = Math.abs(state.worst * state.losses);
    
    if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
    return grossProfit / grossLoss;
  }

  /**
   * Calculate Expectancy
   * @param {Object} state - Application state
   * @returns {number} Expected value per trade
   */
  calculateExpectancy(state) {
    const total = state.wins + state.losses;
    if (total === 0) return 0;

    const winRate = state.wins / total;
    const lossRate = state.losses / total;
    const avgWin = state.wins > 0 ? state.best : 0;
    const avgLoss = state.losses > 0 ? Math.abs(state.worst) : 0;

    return (winRate * avgWin) - (lossRate * avgLoss);
  }

  /**
   * Calculate Calmar Ratio
   * @param {Array} equityCurve - Array of equity points
   * @returns {number} Calmar ratio
   */
  calculateCalmarRatio(equityCurve) {
    if (equityCurve.length < 2) return 0;

    const returns = this.calculateReturns(equityCurve);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const annualizedReturn = meanReturn * 365;

    const maxDD = this.calculateMaxDrawdown(equityCurve);
    if (maxDD.percent === 0) return annualizedReturn > 0 ? Infinity : 0;

    return annualizedReturn / (maxDD.percent / 100);
  }

  /**
   * Get current drawdown
   * @returns {Object} Current drawdown info
   */
  getCurrentDrawdown() {
    const state = this.state.getState();
    const equity = this.calculateCurrentEquity(state);
    
    if (this.peakEquity === 0) {
      this.peakEquity = equity;
    }

    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    const drawdown = this.peakEquity - equity;
    const drawdownPercent = this.peakEquity > 0 ? (drawdown / this.peakEquity) * 100 : 0;

    return {
      amount: drawdown,
      percent: drawdownPercent,
      peak: this.peakEquity
    };
  }

  /**
   * Calculate current equity
   * @param {Object} state - Application state
   * @returns {number} Current equity in INR
   */
  calculateCurrentEquity(state) {
    return state.inr + (state.usd * (this.config.BASE_RATE || 86.6));
  }

  /**
   * Get default metrics when insufficient data
   * @returns {Object} Default metrics
   */
  getDefaultMetrics() {
    return {
      maxDrawdown: 0,
      maxDrawdownPercent: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      calmarRatio: 0,
      winRate: 0,
      profitFactor: 0,
      expectancy: 0,
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      averageWin: 0,
      averageLoss: 0,
      bestTrade: 0,
      worstTrade: 0,
      totalFees: 0
    };
  }

  /**
   * Format metrics for display
   * @param {Object} metrics - Raw metrics
   * @returns {Object} Formatted metrics
   */
  formatForDisplay(metrics) {
    return {
      maxDrawdown: '₹' + this.formatNumber(metrics.maxDrawdown),
      maxDrawdownPercent: metrics.maxDrawdownPercent.toFixed(2) + '%',
      sharpeRatio: metrics.sharpeRatio.toFixed(2),
      sortinoRatio: metrics.sortinoRatio === Infinity ? '∞' : metrics.sortinoRatio.toFixed(2),
      calmarRatio: metrics.calmarRatio === Infinity ? '∞' : metrics.calmarRatio.toFixed(2),
      winRate: metrics.winRate.toFixed(1) + '%',
      profitFactor: metrics.profitFactor === Infinity ? '∞' : metrics.profitFactor.toFixed(2),
      expectancy: '$' + metrics.expectancy.toFixed(2),
      totalTrades: metrics.totalTrades,
      winningTrades: metrics.winningTrades,
      losingTrades: metrics.losingTrades,
      averageWin: '$' + metrics.averageWin.toFixed(2),
      averageLoss: '$' + metrics.averageLoss.toFixed(2),
      bestTrade: '$' + metrics.bestTrade.toFixed(2),
      worstTrade: '$' + metrics.worstTrade.toFixed(2),
      totalFees: '$' + metrics.totalFees.toFixed(2)
    };
  }

  /**
   * Format number with commas
   * @param {number} num - Number to format
   * @returns {string} Formatted number
   */
  formatNumber(num) {
    return Number(num).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
}

