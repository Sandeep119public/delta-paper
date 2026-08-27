/**
 * Delta Paper Trading - Monte Carlo Stress Testing Engine
 * Runs 10,000 permutations of the trade sequence to distinguish
 * skill from luck. Calculates MAE, MFE, and max drawdown distributions.
 */

class MonteCarloEngine {
  constructor(eventBus) {
    this.events = eventBus;
  }

  /**
   * Run 10,000 permutations of the trade sequence to test for "lucky sequencing"
   * @param {Array} trades - Array of trade PnL values (or objects with .pnl)
   * @param {number} iterations - Number of shuffle permutations
   * @param {number} startingBalance - Starting balance in USD
   * @returns {Promise<Object>} Stress test results
   */
  async runStressTest(trades, iterations = 10000, startingBalance = 10000) {
    if (!trades || trades.length === 0) {
      return { error: 'No trades to analyze' };
    }

    const tradePnls = trades.map(t => (typeof t === 'number' ? t : (t.pnl || 0)));
    const originalEquity = this._buildEquityCurve(tradePnls, startingBalance);

    const distributions = { maes: [], mfes: [], drawdowns: [] };

    // Fisher-Yates shuffle loop (chunked to avoid blocking the UI thread)
    return new Promise((resolve) => {
      let i = 0;
      const processChunk = () => {
        const end = Math.min(i + 500, iterations);
        for (; i < end; i++) {
          const shuffled = this._shuffle([...tradePnls]);
          const equityCurve = this._buildEquityCurve(shuffled, startingBalance);

          distributions.maes.push(this._calculateMAE(equityCurve));
          distributions.mfes.push(this._calculateMFE(equityCurve));
          distributions.drawdowns.push(this._calculateMaxDrawdown(equityCurve));
        }

        if (i < iterations) {
          this.events.emit('montecarlo:progress', {
            current: i,
            total: iterations,
            percent: (i / iterations) * 100
          });
          setTimeout(processChunk, 0);
        } else {
          resolve(this._analyzeDistributions(distributions, originalEquity, tradePnls, startingBalance));
        }
      };
      processChunk();
    });
  }

  /**
   * Maximum Adverse Excursion: Largest peak-to-trough drop before recovery
   */
  _calculateMAE(equity) {
    let maxEquity = equity[0], maxDrawdown = 0;
    for (const val of equity) {
      if (val > maxEquity) maxEquity = val;
      maxDrawdown = Math.max(maxDrawdown, maxEquity - val);
    }
    return maxDrawdown;
  }

  /**
   * Maximum Favorable Excursion: Largest trough-to-peak run
   */
  _calculateMFE(equity) {
    let minEquity = equity[0], maxExcursion = 0;
    for (const val of equity) {
      if (val < minEquity) minEquity = val;
      maxExcursion = Math.max(maxExcursion, val - minEquity);
    }
    return maxExcursion;
  }

  /**
   * Calculate maximum drawdown as a percentage
   */
  _calculateMaxDrawdown(equity) {
    let peak = equity[0], maxDD = 0;
    for (const val of equity) {
      if (val > peak) peak = val;
      maxDD = Math.max(maxDD, (peak - val) / peak);
    }
    return maxDD * 100;
  }

  /**
   * Analyze the Monte Carlo distributions and compute skill probability
   */
  _analyzeDistributions(distributions, originalEquity, tradePnls, startingBalance) {
    const origMAE = this._calculateMAE(originalEquity);
    const origMFE = this._calculateMFE(originalEquity);
    const origMaxDD = this._calculateMaxDrawdown(originalEquity);

    // Sort distributions for percentile calculations
    const sortedMAE = [...distributions.maes].sort((a, b) => a - b);
    const sortedMFE = [...distributions.mfes].sort((a, b) => a - b);
    const sortedDD = [...distributions.drawdowns].sort((a, b) => a - b);

    // P-Value: % of random permutations that had a WORSE MAE than the strategy
    const maeExceededRate = distributions.maes.filter(m => m > origMAE).length / distributions.maes.length;

    // Skill probability: > 0.95 indicates skill, < 0.05 indicates luck
    const skillProbability = 1 - maeExceededRate;

    // Final equity stats
    const finalEquity = originalEquity[originalEquity.length - 1];
    const totalReturn = ((finalEquity - startingBalance) / startingBalance) * 100;

    // Calculate win streak and loss streak from original trades
    let maxWinStreak = 0, maxLossStreak = 0, currentStreak = 0, streakType = null;
    for (const pnl of tradePnls) {
      if (pnl > 0) {
        if (streakType === 'win') currentStreak++;
        else { currentStreak = 1; streakType = 'win'; }
        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else if (pnl < 0) {
        if (streakType === 'loss') currentStreak++;
        else { currentStreak = 1; streakType = 'loss'; }
        maxLossStreak = Math.max(maxLossStreak, currentStreak);
      }
    }

    return {
      originalMAE: origMAE,
      originalMFE: origMFE,
      originalMaxDrawdown: origMaxDD,
      totalReturn,
      finalEquity,
      totalTrades: tradePnls.length,
      winningTrades: tradePnls.filter(p => p > 0).length,
      losingTrades: tradePnls.filter(p => p < 0).length,
      maxWinStreak,
      maxLossStreak,
      skillProbability,
      percentileMAE: sortedMAE[Math.floor(sortedMAE.length * 0.95)],
      percentileMFE: sortedMFE[Math.floor(sortedMFE.length * 0.95)],
      percentileMaxDrawdown: sortedDD[Math.floor(sortedDD.length * 0.95)],
      meanMAE: sortedMAE.reduce((a, b) => a + b, 0) / sortedMAE.length,
      meanMFE: sortedMFE.reduce((a, b) => a + b, 0) / sortedMFE.length,
      meanMaxDrawdown: sortedDD.reduce((a, b) => a + b, 0) / sortedDD.length,
      medianMAE: sortedMAE[Math.floor(sortedMAE.length * 0.5)],
      iterations: distributions.maes.length,
      verdict: skillProbability > 0.95
        ? 'Strong skill signal — strategy outperforms 95%+ of random sequences'
        : skillProbability > 0.80
        ? 'Moderate skill — likely some edge, but not statistically conclusive'
        : skillProbability > 0.50
        ? 'Weak signal — performance may be partly due to favorable sequencing'
        : 'Luck-dominated — returns are indistinguishable from random trade ordering'
    };
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  _buildEquityCurve(pnls, start) {
    return pnls.reduce((acc, pnl) => [...acc, acc[acc.length - 1] + pnl], [start]);
  }
}
