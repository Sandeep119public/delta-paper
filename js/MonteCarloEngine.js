/**
 * Monte Carlo sequence-sensitivity engine.
 * IMPORTANT: shuffling realized trades tests path/sequence sensitivity, not strategy skill.
 */
class MonteCarloEngine {
  constructor(eventBus) { this.events = eventBus; }

  async runStressTest(trades, iterations = 10000, startingBalance = 10000) {
    if (!trades || trades.length < 3) return { error: 'Need at least 3 trades to analyze' };
    const tradePnls = trades.map(t => typeof t === 'number' ? t : Number(t.pnl || 0)).filter(Number.isFinite);
    if (tradePnls.length < 3 || !(startingBalance > 0)) return { error: 'Invalid trade sample or starting balance' };
    const originalEquity = this._buildEquityCurve(tradePnls, startingBalance);
    const distributions = { drawdowns: [] };
    return new Promise(resolve => {
      let i = 0;
      const processChunk = () => {
        const end = Math.min(i + 500, Math.max(1, Math.floor(iterations)));
        for (; i < end; i++) distributions.drawdowns.push(this._calculateMaxDrawdown(this._buildEquityCurve(this._shuffle([...tradePnls]), startingBalance)));
        if (i < iterations) { this.events.emit('montecarlo:progress', { current:i,total:iterations,percent:i/iterations*100 }); setTimeout(processChunk,0); }
        else resolve(this._analyze(distributions, originalEquity, tradePnls, startingBalance));
      };
      processChunk();
    });
  }

  _analyze(d, originalEquity, pnls, start) {
    const originalDD=this._calculateMaxDrawdown(originalEquity), sorted=[...d.drawdowns].sort((a,b)=>a-b);
    // One-sided permutation p-value: probability that a random ordering is at least as bad.
    const worse=d.drawdowns.filter(x=>x>=originalDD).length;
    const permutationPValue=(worse+1)/(d.drawdowns.length+1);
    const finalEquity=originalEquity[originalEquity.length-1], totalReturn=(finalEquity-start)/start*100;
    let maxWinStreak=0,maxLossStreak=0,cur=0,type=null;
    for(const p of pnls){if(p>0){cur=type==='w'?cur+1:1;type='w';maxWinStreak=Math.max(maxWinStreak,cur);}else if(p<0){cur=type==='l'?cur+1:1;type='l';maxLossStreak=Math.max(maxLossStreak,cur);}}
    const robustness=1-permutationPValue;
    return {
      originalMAE: originalDD,
      originalMFE: null,
      originalMaxDrawdown: originalDD,
      sequenceMaxDrawdown: originalDD,
      totalReturn, finalEquity, totalTrades:pnls.length,
      winningTrades:pnls.filter(p=>p>0).length, losingTrades:pnls.filter(p=>p<0).length,
      maxWinStreak,maxLossStreak,
      permutationPValue, sequenceRobustness: robustness,
      // Backward-compatible field. It is NOT probability of skill.
      skillProbability: robustness,
      percentileMAE: this._percentile(sorted,.95), percentileMFE:null, percentileMaxDrawdown:this._percentile(sorted,.95),
      meanMAE:this._mean(sorted), meanMFE:null, meanMaxDrawdown:this._mean(sorted), medianMAE:this._percentile(sorted,.5), iterations:d.drawdowns.length,
      verdict: permutationPValue <= .05
        ? 'Unusual trade ordering: observed drawdown is better than most random permutations. This is sequencing evidence, not proof of skill.'
        : permutationPValue <= .20
        ? 'Some sequencing sensitivity detected. This test does not establish strategy skill.'
        : 'Observed drawdown is common under random trade ordering. No sequencing evidence of unusual performance.'
    };
  }

  _percentile(a,p){return a.length?a[Math.min(a.length-1,Math.floor((a.length-1)*p))]:0;}
  _mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
  _calculateMaxDrawdown(equity){let peak=equity[0],dd=0;for(const v of equity){if(v>peak)peak=v;if(peak>0)dd=Math.max(dd,(peak-v)/peak*100);}return dd;}
  _shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
  _buildEquityCurve(pnls,start){const out=[start];for(const p of pnls)out.push(out[out.length-1]+p);return out;}
}
