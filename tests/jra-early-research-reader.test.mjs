import test from 'node:test';
import assert from 'node:assert/strict';
import {
 JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION,readJraEarlyResearchSnapshot
} from '../src/prediction/jra-early-research-reader.mjs';
import {readJraPrecomputedViewerRace} from '../src/prediction/jra-precomputed-viewer-reader.mjs';

const raceId='20261004-JRA-東京-11';
const now=Date.parse('2026-10-04T01:00:00Z');
const data=()=>({
 schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-04',racecourse:'東京',raceNo:11,postTime:'15:40'},
 horses:[
  {horseNo:1,horseName:'Alpha',abilityRank:1,overall:88,win:25,second:20,place:60,jraIndices:{total:88}},
  {horseNo:2,horseName:'Beta',abilityRank:2,overall:80,win:12,second:19,place:38,jraIndices:{total:80}}
 ]
});
const row=(revision,overrides={})=>({
 organization:'JRA',race_id:raceId,revision,
 source_validated_at:'2026-10-04T00:00:00Z',data_calculated_at:'2026-10-04T00:01:00Z',calculated_at:'2026-10-04T00:01:00Z',
 calculation_version:JRA_EARLY_CALCULATION_VERSION,model_version:JRA_EARLY_MODEL_VERSION,
 status:'PARTIAL',data_json:JSON.stringify(data()),...overrides
});

function database(rows){
 const calls=[];
 const DB={calls,prepare(sql){
  calls.push({sql,args:null});
  assert.match(sql,/^SELECT\b/);
  assert.match(sql,/ORDER BY revision ASC LIMIT 1/);
  assert.match(sql,/data_json IS NOT NULL AND data_json<>''/);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE|PRAGMA)\b/i);
  assert.doesNotMatch(sql,/\b(?:source_json|market_json|final_json|result_json|cluster_version|signal_rule_version)\b/i);
  return {bind(...args){calls.at(-1).args=args;return this;},async first(){
   const [org,id,calculation,model]=calls.at(-1).args;
   return rows.filter(r=>r.organization===org&&r.race_id===id&&r.calculation_version===calculation&&
    r.model_version===model&&r.data_json!=null&&r.data_json!=='').sort((a,b)=>a.revision-b.revision)[0]??null;
  }};
 }};
 return DB;
}

test('research reads raw frozen EARLY with viewer OFF, exact versions and zero network',async()=>{
 const enriched=data();enriched.horses[0].jockey='騎手';enriched.horses[0].bodyWeight=null;
 const DB=database([row(3,{data_json:JSON.stringify(enriched),market_json:'SECRET',final_json:'SECRET',result_json:'SECRET'})]);
 const previousFetch=globalThis.fetch;
 let requests=0;globalThis.fetch=()=>{requests++;throw Error('network forbidden');};
 try{
  const result=await readJraEarlyResearchSnapshot({DB,raceId,now});
  assert.equal(result.status,'READY');
  assert.equal(result.snapshot.revision,3);
  assert.equal(result.snapshot.data.race.postTime,'15:40');
  assert.equal(result.snapshot.data.horses[0].jockey,'騎手');
  assert.equal(result.snapshot.data.horses[0].bodyWeight,null);
  assert.equal(result.snapshot.data.horses[0].second,20);
  assert.deepEqual(DB.calls[0].args,['JRA',raceId,JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION]);
  assert.doesNotMatch(JSON.stringify(result),/SECRET|market_json|final_json|result_json/);
  assert.equal(DB.calls.length,1);assert.equal(requests,0);
  const viewer=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'false'},DB,raceId,now});
  assert.equal(viewer.status,'DISABLED');assert.equal(DB.calls.length,1);
 }finally{globalThis.fetch=previousFetch;}
});

test('first nonempty v2 DATA revision is fixed regardless of row order or status',async()=>{
 const newer=data();newer.race.postTime='16:40';
 const DB=database([row(2,{data_json:JSON.stringify(newer)}),row(1)]);
 const read=await readJraEarlyResearchSnapshot({DB,raceId,now});
 assert.equal(read.status,'READY');assert.equal(read.snapshot.revision,1);
 assert.equal(read.snapshot.data.race.postTime,'15:40');
 const bad=database([row(2),row(1,{status:'STALE'})]);
 const fail=await readJraEarlyResearchSnapshot({DB:bad,raceId,now});
 assert.equal(fail.reason,'SNAPSHOT_NOT_READABLE');assert.equal(bad.calls.length,1);
});

test('malformed earliest DATA and future timestamps fail closed without later fallback',async()=>{
 for(const overrides of [
  {data_json:'{broken'},
  {source_validated_at:'2026-10-04T01:01:00Z'},
  {data_calculated_at:'2026-10-04T01:01:00Z'},
  {data_json:JSON.stringify({...data(),race:{...data().race,raceNo:10}})}
 ]){
  const DB=database([row(2),row(1,overrides)]);
  const result=await readJraEarlyResearchSnapshot({DB,raceId,now});
  assert.equal(result.status,'REJECTED');assert.equal(DB.calls.length,1);
 }
});

test('historical EARLY never expires after fifteen minutes',async()=>{
 const DB=database([row(1)]);
 const result=await readJraEarlyResearchSnapshot({DB,raceId,now:now+365*24*60*60*1000});
 assert.equal(result.status,'READY');
});

test('old calculation/model versions are not mistaken for formal v2',async()=>{
 const DB=database([row(1,{calculation_version:'jra-ability-data-v1'}),row(2,{model_version:'other'})]);
 const result=await readJraEarlyResearchSnapshot({DB,raceId,now});
 assert.equal(result.reason,'DATA_NOT_FOUND');
});

test('market fields inside DATA are rejected while other layers are never selected',async()=>{
 for(const field of ['odds','popularity','EV','marketRank']){
  const poison=data();poison.horses[0][field]=1;
  const result=await readJraEarlyResearchSnapshot({DB:database([row(1,{data_json:JSON.stringify(poison)})]),raceId,now});
  assert.equal(result.reason,'MARKET_DATA_FORBIDDEN',field);
 }
});

test('invalid input, NAR identity, unavailable D1 and query errors fail closed',async()=>{
 assert.equal((await readJraEarlyResearchSnapshot({raceId,now})).reason,'D1_UNAVAILABLE');
 const DB=database([row(1)]);
 assert.equal((await readJraEarlyResearchSnapshot({DB,raceId:'20261004-NAR-東京-11',now})).reason,'INVALID_RACE_ID');
 assert.equal((await readJraEarlyResearchSnapshot({DB,raceId,now:NaN})).reason,'INVALID_READER_CLOCK');
 assert.equal(DB.calls.length,0);
 assert.equal((await readJraEarlyResearchSnapshot({DB:{prepare(){throw Error('D1 unavailable');}},raceId,now})).reason,'D1_READ_FAILED');
});
