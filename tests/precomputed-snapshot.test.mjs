import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appendLayerRevision,assertMarketIndependentData,createPrecomputedSnapshot,stableHash,viewerState} from '../src/prediction/precomputed-snapshot.mjs';

const base={raceId:'20260910-JRA-中山-01',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z',horses:[{horseNo:1,name:'A'}]},data:{horses:[{horseNo:1,ability:80,aiWin:25,aiPlace:60,predictedTime:'1:34.2'}]},market:{horses:[{horseNo:1,odds:4,popularity:2,expectedValue:1}]},final:{horses:[{horseNo:1,mark:'◎',aiWin:25,aiPlace:60,expectedValue:1}]}};

test('Web Crypto inputHash is key-order stable and normalized defaults are idempotent',async()=>{
  assert.equal(await stableHash({b:2,a:1}),await stableHash({a:1,b:2}));
  const implicit=await createPrecomputedSnapshot(base);
  const explicit=await createPrecomputedSnapshot({...base,versions:{calculationVersion:'precompute-v1',modelVersion:'10.0.1'}});
  assert.equal(implicit.inputHash,explicit.inputHash);
  assert.match(implicit.inputHash,/^[a-f0-9]{64}$/);
});

test('DATA rejects odds popularity EV and nested market fields',async()=>{
  for(const data of [{odds:2},{horses:[{popularity:1}]},{EV:1.2},{diagnostic:{marketRank:1}},{オッズ:2},{人気:1},{期待値:1.2},{expectedReturn:1.2},{bettingPrice:4.5},{publicRank:1}]){
    assert.throws(()=>assertMarketIndependentData(data),/market_field_in_data/);
    await assert.rejects(createPrecomputedSnapshot({...base,data}),/market_field_in_data/);
  }
});

test('inputHash changes across organization model and calculation versions',async()=>{
  const jra=await createPrecomputedSnapshot(base);
  const nar=await createPrecomputedSnapshot({...base,organization:'NAR'});
  const model=await createPrecomputedSnapshot({...base,versions:{modelVersion:'10.0.2'}});
  const calculation=await createPrecomputedSnapshot({...base,versions:{calculationVersion:'precompute-v2'}});
  const cluster=await createPrecomputedSnapshot({...base,versions:{clusterVersion:'cluster-B'}});
  const signal=await createPrecomputedSnapshot({...base,versions:{signalRuleVersion:'signal-B'}});
  assert.notEqual(jra.inputHash,nar.inputHash);
  assert.notEqual(jra.inputHash,model.inputHash);
  assert.notEqual(jra.inputHash,calculation.inputHash);
  assert.notEqual(jra.inputHash,cluster.inputHash);
  assert.notEqual(jra.inputHash,signal.inputHash);
});

test('acquisition metadata does not change semantic inputHash',async()=>{
  const first=await createPrecomputedSnapshot({...base,source:{...base.source,acquiredAt:'2026-09-10T00:00:00Z',fetchMetadata:{requestId:'a'}}});
  const second=await createPrecomputedSnapshot({...base,source:{...base.source,acquiredAt:'2026-09-10T00:05:00Z',fetchMetadata:{requestId:'b'}}});
  assert.equal(first.sourceHash,second.sourceHash);
  assert.equal(first.inputHash,second.inputHash);
  assert.notEqual(first.sourceAcquiredAt,second.sourceAcquiredAt);
});

test('semantic SOURCE content change changes sourceHash and inputHash',async()=>{
  const first=await createPrecomputedSnapshot(base);
  const second=await createPrecomputedSnapshot({...base,source:{...base.source,horses:[{horseNo:1,name:'B'}]}});
  assert.notEqual(first.sourceHash,second.sourceHash);
  assert.notEqual(first.inputHash,second.inputHash);
});

test('MARKET exclusively carries raw market inputs while DATA stays ability-only',async()=>{
  const snapshot=await createPrecomputedSnapshot(base);
  assert.equal(snapshot.layers.DATA.horses[0].odds,undefined);
  assert.equal(snapshot.layers.DATA.horses[0].popularity,undefined);
  assert.equal(snapshot.layers.MARKET.horses[0].odds,4);
  assert.equal(snapshot.layers.MARKET.horses[0].popularity,2);
  assert.equal(snapshot.status,'CALCULATED');
});

test('FINAL requires MARKET at creation and append time',async()=>{
  await assert.rejects(createPrecomputedSnapshot({...base,market:null,final:{horses:[]}}),/final_requires_market/);
  const partial=await createPrecomputedSnapshot({...base,market:null,final:null});
  assert.equal(partial.status,'PARTIAL');
  await assert.rejects(appendLayerRevision(partial,'FINAL',{horses:[]}),/final_requires_market/);
});

test('FINAL is deeply immutable and RESULT append preserves it byte-equivalent',async()=>{
  const snapshot=await createPrecomputedSnapshot(base);
  const before=JSON.stringify(snapshot.layers.FINAL);
  assert.equal(Object.isFrozen(snapshot.layers.FINAL.horses[0]),true);
  assert.throws(()=>{snapshot.layers.FINAL.horses[0].mark='○';},TypeError);
  await assert.rejects(appendLayerRevision(snapshot,'FINAL',{horses:[]}),/frozen/);
  const withResult=await appendLayerRevision(snapshot,'RESULT',{finishOrder:[1]});
  assert.equal(JSON.stringify(withResult.layers.FINAL),before);
  assert.deepEqual(withResult.layers.RESULT,{finishOrder:[1]});
});

test('FINAL rejects DATA and MARKET revisions while semantic SOURCE change starts a new partial cycle',async()=>{
  const snapshot=await createPrecomputedSnapshot(base);
  for(const layer of ['DATA','MARKET'])await assert.rejects(appendLayerRevision(snapshot,layer,{}),/finalized_upstream_frozen/);
  const changed=await appendLayerRevision(snapshot,'SOURCE',{...base.source,horses:[{horseNo:1,name:'B'}]});
  assert.equal(changed.status,'PARTIAL');
  assert.equal(changed.layers.DATA,null);
  assert.equal(changed.layers.FINAL,null);
});

test('pre-FINAL MARKET revision keeps inputHash and changes snapshotHash',async()=>{
  const partial=await createPrecomputedSnapshot({...base,final:null});
  const changed=await appendLayerRevision(partial,'MARKET',{horses:[{horseNo:1,odds:5}]});
  assert.equal(changed.inputHash,partial.inputHash);
  assert.notEqual(changed.snapshotHash,partial.snapshotHash);
  assert.deepEqual(changed.layers.DATA,partial.layers.DATA);
  assert.equal(changed.layers.FINAL,null);
  assert.equal(changed.layers.RESULT,null);
  assert.equal(changed.status,'PARTIAL');
});

test('pre-FINAL SOURCE revision recomputes identity and invalidates every downstream layer',async()=>{
  const partial=await createPrecomputedSnapshot({...base,final:null});
  const changed=await appendLayerRevision(partial,'SOURCE',{...base.source,horses:[{horseNo:1,name:'B'}]});
  assert.notEqual(changed.sourceHash,partial.sourceHash);
  assert.notEqual(changed.inputHash,partial.inputHash);
  assert.notEqual(changed.snapshotHash,partial.snapshotHash);
  assert.equal(changed.layers.DATA,null);
  assert.equal(changed.layers.MARKET,null);
  assert.equal(changed.layers.FINAL,null);
  assert.equal(changed.layers.RESULT,null);
  assert.equal(changed.status,'PARTIAL');
});

test('metadata-only SOURCE validation preserves downstream and refreshes sourceValidatedAt',async()=>{
  const snapshot=await createPrecomputedSnapshot({...base,now:'2026-09-10T00:00:00Z'});
  const validated=await appendLayerRevision(snapshot,'SOURCE',{...base.source,acquiredAt:'2026-09-10T00:16:00Z',fetchMetadata:{requestId:'new'}},{at:'2026-09-10T00:16:00Z'});
  assert.equal(validated.sourceHash,snapshot.sourceHash);
  assert.equal(validated.inputHash,snapshot.inputHash);
  assert.deepEqual(validated.layers.DATA,snapshot.layers.DATA);
  assert.deepEqual(validated.layers.MARKET,snapshot.layers.MARKET);
  assert.deepEqual(validated.layers.FINAL,snapshot.layers.FINAL);
  assert.equal(validated.sourceValidatedAt,'2026-09-10T00:16:00Z');
  assert.notEqual(validated.snapshotHash,snapshot.snapshotHash);
  assert.equal(viewerState(validated,{now:Date.parse('2026-09-10T00:16:01Z')}).status,'CALCULATED');
});

test('out-of-order SOURCE validation cannot move freshness backward or make a fresh snapshot stale',async()=>{
  const snapshot=await createPrecomputedSnapshot({...base,now:'2026-09-10T02:00:00Z'});
  const late=await appendLayerRevision(snapshot,'SOURCE',{...base.source,acquiredAt:'2026-09-10T01:30:00Z'},{at:'2026-09-10T01:30:00Z'});
  assert.equal(late,snapshot);
  assert.equal(late.sourceValidatedAt,'2026-09-10T02:00:00Z');
  assert.equal(late.snapshotHash,snapshot.snapshotHash);
  assert.equal(viewerState(late,{now:Date.parse('2026-09-10T02:10:00Z')}).status,'CALCULATED');
});

test('pre-FINAL DATA revision invalidates dependent MARKET EV FINAL and RESULT',async()=>{
  const partial=await createPrecomputedSnapshot({...base,final:null,market:{horses:[{horseNo:1,expectedValue:1}]}});
  const changed=await appendLayerRevision(partial,'DATA',{horses:[{horseNo:1,aiWin:40}]});
  assert.equal(changed.inputHash,partial.inputHash);
  assert.equal(changed.layers.DATA.horses[0].aiWin,40);
  assert.equal(changed.layers.MARKET,null);
  assert.equal(changed.layers.FINAL,null);
  assert.equal(changed.layers.RESULT,null);
  assert.equal(changed.status,'PARTIAL');
});

test('RESULT before FINAL is rejected at creation and revision time',async()=>{
  await assert.rejects(createPrecomputedSnapshot({...base,final:null,result:{finishOrder:[1]}}),/result_requires_final/);
  const partial=await createPrecomputedSnapshot({...base,final:null});
  await assert.rejects(appendLayerRevision(partial,'RESULT',{finishOrder:[1]}),/result_requires_final/);
});

test('SOURCE DATA MARKET FINAL RESULT lifecycle succeeds in order',async()=>{
  let snapshot=await createPrecomputedSnapshot({...base,final:null,market:null});
  snapshot=await appendLayerRevision(snapshot,'SOURCE',{...base.source,horses:[{horseNo:1,name:'B'}]});
  snapshot=await appendLayerRevision(snapshot,'DATA',{horses:[{horseNo:1,aiWin:30}]});
  snapshot=await appendLayerRevision(snapshot,'MARKET',{horses:[{horseNo:1,odds:4,expectedValue:1.2}]});
  snapshot=await appendLayerRevision(snapshot,'FINAL',{horses:[{horseNo:1,mark:'◎'}]});
  const finalBefore=JSON.stringify(snapshot.layers.FINAL);
  snapshot=await appendLayerRevision(snapshot,'RESULT',{finishOrder:[1]});
  assert.equal(snapshot.status,'CALCULATED');
  assert.deepEqual(snapshot.layers.RESULT,{finishOrder:[1]});
  assert.equal(JSON.stringify(snapshot.layers.FINAL),finalBefore);
});

test('DATA recalculation refreshes viewer freshness while old DATA becomes stale',async()=>{
  const old=await createPrecomputedSnapshot({...base,now:'2026-09-10T00:00:00Z'});
  assert.equal(viewerState(old,{now:Date.parse('2026-09-10T00:16:00Z')}).status,'STALE');
  let rebuilt=await appendLayerRevision(await createPrecomputedSnapshot({...base,final:null,now:'2026-09-10T00:00:00Z'}),'SOURCE',{...base.source,horses:[{horseNo:1,name:'B'}]},{at:'2026-09-10T02:00:00Z'});
  rebuilt=await appendLayerRevision(rebuilt,'DATA',{horses:[{horseNo:1,aiWin:30}]},{at:'2026-09-10T02:00:00Z'});
  rebuilt=await appendLayerRevision(rebuilt,'MARKET',{horses:[{horseNo:1,odds:4}]},{at:'2026-09-10T02:00:10Z'});
  rebuilt=await appendLayerRevision(rebuilt,'FINAL',{horses:[{horseNo:1,mark:'◎'}]},{at:'2026-09-10T02:00:20Z'});
  assert.equal(rebuilt.calculatedAt,'2026-09-10T02:00:00Z');
  assert.equal(viewerState(rebuilt,{now:Date.parse('2026-09-10T02:01:00Z')}).status,'CALCULATED');
});

test('viewer status vocabulary is NOT_CALCULATED PARTIAL STALE CALCULATED',async()=>{
  assert.equal(viewerState(null).status,'NOT_CALCULATED');
  const partial=await createPrecomputedSnapshot({...base,final:null});
  assert.equal(viewerState(partial).status,'PARTIAL');
  const old=await createPrecomputedSnapshot({...base,now:'2026-01-01T00:00:00Z'});
  assert.equal(viewerState(old,{now:Date.parse('2026-01-02T00:00:00Z')}).status,'STALE');
  const current=await createPrecomputedSnapshot({...base,now:'2026-01-01T00:00:00Z'});
  assert.equal(viewerState(current,{now:Date.parse('2026-01-01T00:01:00Z')}).status,'CALCULATED');
});

test('snapshot runtime source has no node:crypto dependency',async()=>{
  const source=await readFile(new URL('../src/prediction/precomputed-snapshot.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/node:crypto|createHash\s*\(/);
  assert.match(source,/subtle\.digest\('SHA-256'/);
});
