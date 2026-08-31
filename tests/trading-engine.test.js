import { describe, expect, it, beforeEach } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';

function load(name, context) {
  vm.runInContext(fs.readFileSync(new URL('../js/' + name, import.meta.url), 'utf8'), context);
}
function fixture() {
  const raw={usd:1000,inr:0,positions:{},feesTotal:0,realized:0,wins:0,losses:0,best:0,worst:0,grossProfit:0,grossLoss:0,tradeCount:0,history:[],tradeArchive:[]};
  const context=vm.createContext({console,Math,Number,Date,Error,window:{}});
  load('FinancialEngine.js',context); load('TradingEngine.js',context);
  const config={SYMBOLS:['BTCUSD'],LOT_SIZES:{BTCUSD:1},MAX_LEVERAGE:20,TAKER_FEE:0.001,BASE_RATE:86.6,MAINTENANCE_MARGIN:0.005,MARKET_SLIPPAGE:0};
  const state={get:()=>raw,update:u=>Object.assign(raw,u),flushSave:()=>{}};
  let live=110; const market={getMarket:symbol=>({symbol,price:live})};
  const financial=new context.window.FinancialEngine(config,state,market);
  const trading=new context.window.TradingEngine(config,state,market,financial);
  return {raw,trading,setLive:v=>{live=v;}};
}
describe('TradingEngine',()=>{
 let f; beforeEach(()=>{f=fixture();});
 it('uses replay price instead of live market price',()=>{
   f.trading.enterReplay(); f.trading.setReplayPrice('BTCUSD',100,1);
   f.trading.executeMarket({symbol:'BTCUSD',side:1,lots:1,leverage:1});
   expect(f.raw.positions.BTCUSD.entry).toBeCloseTo(100,6);
 });
 it('closes a long when replay price reaches TP',()=>{
   f.trading.enterReplay(); f.trading.setReplayPrice('BTCUSD',100,1);
   f.trading.executeMarket({symbol:'BTCUSD',side:1,lots:1,leverage:1});
   f.raw.positions.BTCUSD.tp=105;
   f.trading.onPrice('BTCUSD',105);
   expect(f.raw.positions.BTCUSD).toBeUndefined();
   expect(f.raw.tradeArchive.at(-1).reason).toBe('TAKE_PROFIT');
 });
 it('closes a long when price reaches SL',()=>{
   f.trading.executeMarket({symbol:'BTCUSD',side:1,lots:1,leverage:1});
   f.raw.positions.BTCUSD.sl=95;
   f.trading.onPrice('BTCUSD',95);
   expect(f.raw.positions.BTCUSD).toBeUndefined();
   expect(f.raw.tradeArchive.at(-1).reason).toBe('STOP_LOSS');
 });
 it('uses live price when replay is inactive',()=>{
   f.trading.executeMarket({symbol:'BTCUSD',side:1,lots:1,leverage:1});
   expect(f.raw.positions.BTCUSD.entry).toBeCloseTo(110,6);
 });
});
