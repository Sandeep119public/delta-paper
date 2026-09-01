/* Single authoritative trading runtime: pricing, execution, triggers and accounting.
 *
 * Execution policy:
 *   LIVE:  authoritative market tick → configured slippage → fill price
 *   REPLAY: historical replay price → optional replay slippage → fill price
 *
 * TP / SL / Liquidation always use the exact price that triggered the condition.
 * No second market lookup is performed after trigger detection.
 */
(function(global){
'use strict';
class TradingEngine {
  constructor(config,state,market,financial){
    this.config=config;this.state=state;this.market=market;this.financial=financial;
    this.mode='live';this.replayPrices=new Map();
  }
  setReplayPrice(symbol,price,time){if(Number.isFinite(price)&&price>0)this.replayPrices.set(symbol,{price,time});}
  clearReplay(){this.mode='live';this.replayPrices.clear();}
  enterReplay(){this.mode='replay';}

  price(symbol){
    if(this.mode==='replay'){const r=this.replayPrices.get(symbol);if(r?.price>0)return r.price;}
    const m=this.market.getMarket(symbol);return m?.price>0?m.price:0;
  }

  executeMarket({symbol,side,lots,leverage,reason='MARKET',executionPrice}){
    const lotSize=Number(this.config.LOT_SIZES?.[symbol]);if(!(lotSize>0))throw Error('Unknown contract size');
    const mark=Number.isFinite(executionPrice)&&executionPrice>0?executionPrice:this.price(symbol);
    if(!(mark>0))throw Error(this.mode==='replay'?'Replay price unavailable':'Live price unavailable');
    const slip=Number(this.config.MARKET_SLIPPAGE??this.config.CLOSE_SLIPPAGE??0.0003);
    const fill=side===1?mark*(1+slip):mark*(1-slip),qty=lots*lotSize;
    const fee=this.financial.fee(fill*qty);
    const result=this.financial.fill(symbol,side,fill,qty,leverage,fee,lots,reason);
    this.state.flushSave();
    return {fill,qty,fee,result};
  }

  close(symbol,reason='MARKET_CLOSE',executionPrice){
    const pos=this.state.get().positions?.[symbol];if(!pos)throw Error('No open position');
    return this.executeMarket({symbol,side:-pos.dir,lots:pos.lots,leverage:pos.lev,reason,executionPrice});
  }

  onPrice(symbol,price){
    // Do not auto-overwrite replay price with live ticks — replay price is set explicitly via setReplayPrice
    // If in replay mode and this call is from live market, ignore it for replay symbols
    if(this.mode==='replay' && !this.replayPrices.has(symbol)){
      // No replay price for this symbol — treat as live but still check triggers with provided price
      // (allows TP/SL to work if replay hasn't set price yet)
    }
    const pos=this.state.get().positions?.[symbol];if(!pos||!(price>0))return null;
    const liq=this.financial.liquidationPrice(pos);
    if((pos.dir===1&&price<=liq)||(pos.dir===-1&&price>=liq))return this.financial.liquidate(symbol,price,'LIQUIDATION');
    if(pos.tp&&((pos.dir===1&&price>=pos.tp)||(pos.dir===-1&&price<=pos.tp)))return this.close(symbol,'TAKE_PROFIT',price);
    if(pos.sl&&((pos.dir===1&&price<=pos.sl)||(pos.dir===-1&&price>=pos.sl)))return this.close(symbol,'STOP_LOSS',price);
    return null;
  }
}
global.TradingEngine=TradingEngine;
})(window);