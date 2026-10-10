import test from 'node:test';
import assert from 'node:assert/strict';
import { productionSignalBindingQuery,readProductionSignalBindingAudit,productionSignalBindingSummaryLines } from '../scripts/jra-production-signal-binding-audit.mjs';

const date='2026-10-10',raceId='20261010-JRA-東京-01',second='20261010-JRA-東京-02';
const snapshot={schemaVersion:1,policyVersion:'CHASS-SIGNAL-v1.0',status:'frozen',
 frozenAt:'2026-10-10T00:00:00Z',horses:[{horseNo:1,warningMark:'',valueMark:''}]};
const saved=(model='model')=>({race_id:raceId,model_version:model,market_json:JSON.stringify({raceId,signalSnapshot:snapshot})});
function run(rows,extra={}){
 const queries=[];return {queries,async audit(){return readProductionSignalBindingAudit(date,{
  execute:async sql=>{queries.push(sql);return rows;},expectedRaceIds:[raceId,second],...extra});}};
}

test('one bounded app SELECT observes all models without granting Signal adoption',async()=>{
 const s=run([saved()]),out=await s.audit();
 assert.equal(s.queries.length,1);assert.match(s.queries[0],/^SELECT race_id,model_version,market_json FROM races/);
 assert.ok(!/RESULT|INSERT|UPDATE|CREATE/i.test(s.queries[0]));
 assert.equal(out.status,'OBSERVED');assert.equal(out.readQueryCount,1);assert.equal(out.capturedSelectionReadCount,1);
 assert.equal(out.bindingCaptureMissingCount,1);assert.equal(out.signalMissingCount,0);
 assert.equal(out.formalKpiEligible,false);assert.equal(out.productionActivationReady,false);
 assert.deepEqual(out.missingExpectedRaceIds,[second]);assert.ok(Object.isFrozen(out.rows));
});
test('no app rows means missing app records, not failed odds collection',async()=>{
 const out=await run([]).audit();assert.equal(out.storedRaceCount,0);
 assert.deepEqual(out.missingExpectedRaceIds,[raceId,second]);assert.equal(out.signalMissingCount,0);
 assert.equal(out.bindingCaptureMissingCount,0);assert.equal(out.coverage,'COMPARED');
});
test('saved market without Signal and saved Signal without capture are distinct',async()=>{
 const a=saved('ability');a.market_json=JSON.stringify({horses:[{horseNo:1,odds:2}]});
 const out=await run([a,saved('signal')]).audit();
 assert.equal(out.signalMissingCount,1);assert.equal(out.bindingCaptureMissingCount,1);
 assert.equal(out.storedModelRecordCount,2);assert.equal(out.storedRaceCount,1);
});
test('multiple model versions are never silently collapsed to a latest winner',async()=>{
 const rows=[saved('old'),saved('new')],before=JSON.stringify(rows),out=await run(rows).audit();
 assert.equal(out.rows.length,2);assert.equal(out.bindingCaptureMissingCount,2);
 assert.deepEqual(out.rows.map(r=>r.modelVersion),['new','old']);assert.equal(JSON.stringify(rows),before);
});
test('query failure reports unknown coverage with sanitized errors',async()=>{
 const out=await readProductionSignalBindingAudit(date,{execute:async()=>{throw Error('private API token');}});
 assert.equal(out.status,'BLOCKED');assert.equal(out.reason,'APP_SIGNAL_QUERY_FAILED');
 assert.ok(!JSON.stringify(out).includes('private'));assert.match(productionSignalBindingSummaryLines(out),/UNKNOWN/);
});
test('101 rows blocks coverage instead of presenting truncated success',async()=>{
 const out=await run(Array.from({length:101},(_,i)=>saved(`m${i}`))).audit();
 assert.equal(out.reason,'APP_SIGNAL_ROW_LIMIT');assert.equal(out.coverage,'UNKNOWN');
});
test('duplicate rows and invalid model identity block',async()=>{
 assert.equal((await run([saved(),saved()]).audit()).reason,'APP_SIGNAL_DUPLICATE_ROW');
 const bad=saved();bad.model_version='';
 assert.equal((await run([bad]).audit()).reason,'APP_SIGNAL_ROW_IDENTITY_INVALID');
});
test('invalid date and expected identities reject before D1 calls',async()=>{
 assert.throws(()=>productionSignalBindingQuery("2026-10-10' OR 1=1"));
 const s=run([saved()],{expectedRaceIds:['20261009-JRA-東京-01']});
 assert.equal((await s.audit()).reason,'INVALID_EXPECTED_RACES');assert.equal(s.queries.length,0);
});
test('unknown expected meeting stays not compared, never guesses 24 races',async()=>{
 const out=await run([saved()],{expectedRaceIds:null}).audit();
 assert.equal(out.coverage,'NOT_COMPARED');assert.equal(out.expectedRaceCount,null);
 assert.equal(out.missingExpectedRaceIds,null);assert.match(productionSignalBindingSummaryLines(out),/Expected races: UNKNOWN/);
});
test('unexpected app race is reported separately from official expected set',async()=>{
 const extra=saved('extra');extra.race_id='20261010-JRA-東京-03';extra.market_json=null;
 const out=await run([saved(),extra]).audit();
 assert.deepEqual(out.unexpectedStoredRaceIds,[extra.race_id]);assert.deepEqual(out.missingExpectedRaceIds,[second]);
});
test('invalid and provisional Signals preserve individual reasons',async()=>{
 const a=saved('bad'),b=saved('provisional');a.market_json='{';
 b.market_json=JSON.stringify({signalSnapshot:{status:'provisional'}});
 const out=await run([a,b]).audit();assert.equal(out.reasonCounts.SAVED_MARKET_INVALID,1);
 assert.equal(out.reasonCounts.SIGNAL_NOT_FROZEN,1);assert.equal(out.bindingCaptureMissingCount,0);
});
test('the fixed SQL selects only the requested day and uses a limit sentinel',()=>{
 assert.equal(productionSignalBindingQuery(date),"SELECT race_id,model_version,market_json FROM races WHERE race_id LIKE '20261010-JRA-%' ORDER BY race_id,model_version LIMIT 101");
});
