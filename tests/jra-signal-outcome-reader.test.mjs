import test from 'node:test';
import assert from 'node:assert/strict';
import {readJraSignalOutcomeCohort} from '../src/research/jra-signal-outcome-reader.mjs';
const raceId='20261010-JRA-東京-01',now=Date.parse('2026-10-10T03:00:00Z'),policyVersion='CHASS-SIGNAL-v1.0';
function entry(){return {raceId,record:{marketSnapshot:{raceId,signalSnapshot:{schemaVersion:1,policyVersion,status:'frozen',
 frozenAt:'2026-10-10T00:02:00Z',horses:[{horseNo:1,valueMark:'💎',popularityAtFreeze:6,oddsAtFreeze:20,evAtFreeze:120,
 longshotScenario:{policyVersion,level:'place',scenario:'2〜3着',marketValue:true,
 evidence:[{code:'LAST3F',strength:2,label:'上がり能力'}]}}]}}}};}
function db({missingEarly=false,missingResult=false,badEarly=false,throwEarly=false,throwResult=false}={}){
 const horses=Array.from({length:4},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,abilityRank:i+1,
  overall:80-i,win:20-i,place:40-i,predictedTime:'1:20.0'})),calls=[];
 return {calls,prepare(sql){assert.match(sql.trim(),/^SELECT\b/);assert.doesNotMatch(sql,/market_json|final_json|result_json/);
  return {bind(...args){return {async first(){calls.push({sql,args});
   if(sql.includes('precomputed_race_snapshots')){
    if(throwEarly)throw Error('DB failed');if(missingEarly)return null;
    return {organization:'JRA',race_id:raceId,revision:1,source_validated_at:'2026-10-10T00:00:00Z',
     data_calculated_at:'2026-10-10T00:01:00Z',calculation_version:'jra-ability-data-v2',
     model_version:'10.0.1-jra-drive1-ability',status:'PARTIAL',data_json:badEarly?'bad':JSON.stringify({
      schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},horses})};
   }
   if(throwResult)throw Error('DB failed');if(missingResult)return null;
   assert.deepEqual(args,['result|2026-10-10|東京|1']);
   return {organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,fetched_at:'2026-10-10T02:00:00Z',
    payload_json:JSON.stringify({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,
     quality:{complete:true,finishOrderCount:3},finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})};
  }}}};
 }};
}

test('saved signal is joined to validated EARLY and official caches with just two SELECT reads',async()=>{
 const DB=db(),entries=[entry()],before=JSON.stringify(entries),r=await readJraSignalOutcomeCohort({DB,entries,now});
 assert.equal(r.status,'READY');assert.equal(r.readQueryCount,2);assert.equal(DB.calls.length,2);
 assert.equal(r.summary.observedHorseCount,1);assert.equal(r.summary.groups[0].scenarioHitRate,1);
 assert.equal(r.summary.formalKpiEligible,false);assert.equal(r.productionActivationReady,false);
 assert.equal(JSON.stringify(entries),before);
});
test('missing official results are pending and excluded from hit-rate denominators',async()=>{
 const r=await readJraSignalOutcomeCohort({DB:db({missingResult:true}),entries:[entry()],now});
 assert.equal(r.summary.pendingRaceCount,1);assert.equal(r.summary.observedHorseCount,0);
 assert.equal(r.summary.groups[0].scenarioHitRate,null);
});
test('invalid stored signals perform zero I/O, and malformed earliest EARLY never falls forward',async()=>{
 const DB=db(),e=entry();e.record.marketSnapshot.signalSnapshot.status='provisional';
 const r=await readJraSignalOutcomeCohort({DB,entries:[e],now});assert.equal(DB.calls.length,0);
 assert.equal(r.summary.excludedRaceCount,1);
 const bad=db({badEarly:true}),b=await readJraSignalOutcomeCohort({DB:bad,entries:[entry()],now});
 assert.equal(bad.calls.length,1);assert.equal(b.readerExclusions[0].reason,'EARLY_MALFORMED_DATA');
 assert.equal(b.summary.observedHorseCount,0);
});
test('invalid, duplicate, conflicting and non-JRA cohorts fail before any DB reads',async()=>{
 const DB=db();for(const entries of [[],[entry(),entry()],Array(101).fill(entry()),[{raceId:'20261010-NAR-大井-01'}],
  [{raceId:'20261010-JRA-東京-13'}],[{...entry(),record:{raceId:'other'}}]]){
  assert.equal((await readJraSignalOutcomeCohort({DB,entries,now})).status,'REJECTED');
 }
 assert.equal((await readJraSignalOutcomeCohort({DB,entries:[entry()],now:NaN})).reason,'INVALID_READER_CLOCK');
 assert.equal(DB.calls.length,0);
});
test('EARLY or official read failures block the entire summary rather than count losses',async()=>{
 for(const options of [{throwEarly:true},{throwResult:true}]){
  const r=await readJraSignalOutcomeCohort({DB:db(options),entries:[entry()],now});
  assert.equal(r.status,'BLOCKED');assert.equal(r.summary,null);assert.equal(r.productionActivationReady,false);
 }
});
test('memoization is per invocation and absent EARLY is recorded without result reads',async()=>{
 const DB=db();for(let i=0;i<2;i++)assert.equal((await readJraSignalOutcomeCohort({DB,entries:[entry()],now})).readQueryCount,2);
 assert.equal(DB.calls.length,4);
 const missing=db({missingEarly:true}),r=await readJraSignalOutcomeCohort({DB:missing,entries:[entry()],now});
 assert.equal(missing.calls.length,1);assert.equal(r.readerExclusions[0].reason,'EARLY_DATA_NOT_FOUND');
 assert.equal(r.summary.observedHorseCount,0);assert.ok(Object.isFrozen(r.readerExclusions[0]));
});
