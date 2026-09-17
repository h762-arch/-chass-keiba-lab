import test from 'node:test';
import assert from 'node:assert/strict';
import {appendLayerRevision,createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {d1RowToSnapshot,findPrecomputedInput,findPrecomputedRevision,savePrecomputedSnapshot,snapshotToD1Values} from '../src/prediction/precomputed-store.mjs';

async function fixture(organization='JRA'){
  return createPrecomputedSnapshot({raceId:`20260910-${organization}-中山-01`,organization,source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:{mark:'◎'},now:'2026-09-10T01:00:00Z'});
}

function mockDb({existingInput=null,existingRevision=null,latest=0}={}){
  const calls=[];
  return {calls,prepare(sql){const call={sql,args:[],run:false};calls.push(call);return {bind(...args){call.args=args;return this;},async first(){if(sql.includes('input_hash=?'))return existingInput;if(sql.includes('snapshot_hash=?'))return existingRevision;if(sql.includes('MAX(revision)'))return {revision:latest};return null;},async run(){call.run=true;return {success:true};}};}};
}

test('D1 row serialization preserves separated five layers',async()=>{
  const snapshot=await fixture();
  const values=snapshotToD1Values(snapshot,{revision:1,createdAt:'2026-09-10T01:00:01Z'});
  assert.equal(values[0],'JRA');
  assert.equal(values[2],1);
  assert.match(values[5],/^[a-f0-9]{64}$/);
  assert.equal(values[7],'2026-09-10T01:00:00Z');
  assert.equal(values[8],'2026-09-10T01:00:00Z');
  assert.equal(JSON.parse(values[15]).ability,80);
  assert.equal(JSON.parse(values[16]).odds,4);
  assert.equal(JSON.parse(values[17]).mark,'◎');
  assert.equal(values[19],'CALCULATED');
});

test('D1 save is idempotent only for an identical snapshotHash',async()=>{
  const snapshot=await fixture(),DB=mockDb({existingRevision:{revision:3}});
  const result=await savePrecomputedSnapshot(DB,snapshot);
  assert.deepEqual(result,{saved:false,reason:'UNCHANGED',revision:3});
  assert.equal(DB.calls.some(call=>call.sql.startsWith('INSERT')),false);
});

test('D1 save appends one revision without mixing organization',async()=>{
  const snapshot=await fixture('NAR'),DB=mockDb({latest:2});
  const result=await savePrecomputedSnapshot(DB,snapshot,{createdAt:'2026-09-10T01:00:01Z'});
  assert.deepEqual(result,{saved:true,reason:'SAVED',revision:3});
  const insert=DB.calls.find(call=>call.sql.startsWith('INSERT'));
  assert.equal(insert.args[0],'NAR');
  assert.equal(insert.args[1],snapshot.raceId);
  assert.equal(insert.args[2],3);
  assert.equal(insert.run,true);
});

test('RESULT append keeps inputHash and saves a new revision',async()=>{
  const original=await fixture(),withResult=await appendLayerRevision(original,'RESULT',{finishOrder:[1]}),DB=mockDb({latest:1});
  assert.equal(withResult.inputHash,original.inputHash);
  assert.notEqual(withResult.snapshotHash,original.snapshotHash);
  const result=await savePrecomputedSnapshot(DB,withResult);
  assert.deepEqual(result,{saved:true,reason:'SAVED',revision:2});
  assert.equal(DB.calls.find(call=>call.sql.startsWith('INSERT')).args[18],JSON.stringify({finishOrder:[1]}));
});

test('SOURCE freshness-only revision persists under a new snapshotHash',async()=>{
  const original=await fixture();
  const refreshed=await appendLayerRevision(original,'SOURCE',{...original.layers.SOURCE,acquiredAt:'2026-09-10T01:16:00Z'},{at:'2026-09-10T01:16:00Z'});
  const DB=mockDb({latest:1});
  assert.equal(refreshed.inputHash,original.inputHash);
  assert.notEqual(refreshed.snapshotHash,original.snapshotHash);
  assert.equal(refreshed.sourceValidatedAt,'2026-09-10T01:16:00Z');
  assert.deepEqual(await savePrecomputedSnapshot(DB,refreshed),{saved:true,reason:'SAVED',revision:2});
});

test('same RESULT revision is a no-op',async()=>{
  const original=await fixture(),withResult=await appendLayerRevision(original,'RESULT',{finishOrder:[1]}),DB=mockDb({existingRevision:{revision:2}});
  const result=await savePrecomputedSnapshot(DB,withResult);
  assert.deepEqual(result,{saved:false,reason:'UNCHANGED',revision:2});
  assert.equal(DB.calls.some(call=>call.sql.startsWith('INSERT')),false);
});

test('pre-FINAL MARKET change saves a new revision under the same inputHash',async()=>{
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-01',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:null,now:'2026-09-10T01:00:00Z'});
  const changed=await appendLayerRevision(partial,'MARKET',{odds:5}),DB=mockDb({latest:1});
  assert.equal(changed.inputHash,partial.inputHash);
  assert.notEqual(changed.snapshotHash,partial.snapshotHash);
  assert.deepEqual(await savePrecomputedSnapshot(DB,changed),{saved:true,reason:'SAVED',revision:2});
});

test('input lookup binds organization race and hash independently',async()=>{
  const DB=mockDb();
  await findPrecomputedInput(DB,'JRA','race-1','hash-1');
  assert.deepEqual(DB.calls[0].args,['JRA','race-1','hash-1']);
});

test('input lookup reconstructs the full snapshot needed for freshness decisions',async()=>{
  const row={organization:'JRA',race_id:'race-1',revision:2,source_hash:'s',input_hash:'i',snapshot_hash:'h',source_acquired_at:'a',source_validated_at:'sv',data_calculated_at:'dc',calculated_at:'dc',calculation_version:'v',model_version:'m',cluster_version:null,signal_rule_version:null,status:'PARTIAL',source_json:'{}',data_json:'{"ability":80}',market_json:null,final_json:null,result_json:null};
  const found=await findPrecomputedInput(mockDb({existingInput:row}),'JRA','race-1','i');
  assert.equal(found.sourceValidatedAt,'sv');
  assert.equal(found.dataCalculatedAt,'dc');
  assert.deepEqual(found.layers.DATA,{ability:80});
});

test('revision lookup binds organization race and snapshot hash independently',async()=>{
  const DB=mockDb({existingRevision:{revision:1}});
  await findPrecomputedRevision(DB,'NAR','race-1','snapshot-1');
  assert.deepEqual(DB.calls[0].args,['NAR','race-1','snapshot-1']);
});

test('D1 row read keeps FINAL separate from later RESULT',()=>{
  const snapshot=d1RowToSnapshot({organization:'JRA',race_id:'r',revision:2,source_hash:'s',input_hash:'i',snapshot_hash:'h',source_acquired_at:'a',source_validated_at:'sv',data_calculated_at:'dc',calculated_at:'c',calculation_version:'v',model_version:'m',cluster_version:null,signal_rule_version:null,status:'CALCULATED',source_json:'{}',data_json:'{"ability":80}',market_json:'{"odds":4}',final_json:'{"mark":"◎"}',result_json:'{"finish":1}'});
  assert.deepEqual(snapshot.layers.FINAL,{mark:'◎'});
  assert.deepEqual(snapshot.layers.RESULT,{finish:1});
  assert.equal(Object.isFrozen(snapshot.layers.FINAL),true);
  assert.throws(()=>{snapshot.layers.FINAL.mark='○';},TypeError);
});
