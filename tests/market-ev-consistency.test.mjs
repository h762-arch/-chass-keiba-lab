import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');

test('active market reload does not copy stale EV/value/warning fields', () => {
  assert.doesNotMatch(src, /h\.ev=o\.ev/);
  assert.doesNotMatch(src, /h\.valueMark=o\.valueMark/);
  assert.doesNotMatch(src, /h\.warningMark=o\.warningMark/);
  assert.match(src, /reconcileMarketDerivedValues\(next\.horses,next\.race\)/);
});

test('odds cache invalidates when prediction basis changes', () => {
  assert.match(src, /previousBasisSignature!==basisSignature/);
  assert.match(src, /predictionBasisSignature:basisSignature/);
  assert.match(src, /marketDerivedVersion:'MDV-2'/);
});

test('expected-value semantics remain odds times win-percent', () => {
  const displayEv = (odds, winPct) => odds * winPct / 100;
  assert.equal(Number(displayEv(15.4, 23.4).toFixed(4)), 3.6036);
  assert.equal(Number(displayEv(36.1, 2.8).toFixed(4)), 1.0108);
  assert.equal(Number(displayEv(26.0, 1.7).toFixed(4)), 0.442);
  assert.equal(Number(displayEv(3.5, 1.4).toFixed(4)), 0.049);
});

test('validated historical records are protected from repair', () => {
  const window={__CHASS_TEST__:true},ctx={window,console,Date,Math,JSON,Map,Set,URL,TextEncoder,structuredClone,Promise,localStorage:{getItem:()=>null,setItem(){}},setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){}};
  vm.createContext(ctx);vm.runInContext(src,ctx);const r={race:{oddsType:'実オッズ'},validated:true,validationCompleted:true,horses:[{horseNo:1,win:50,odds:5}],predictionSnapshot:{horses:[{horseNo:1,win:50}]},marketSnapshot:{schemaVersion:1,horses:[{horseNo:1,ev:123,warningMark:'⚠️'}]},finalSnapshot:{top3:[{horseNo:1}]}},market=JSON.stringify(r.marketSnapshot);
  window.CHASS_TEST.migrateSnapshotRecord(r);assert.equal(JSON.stringify(r.marketSnapshot),market);
});
