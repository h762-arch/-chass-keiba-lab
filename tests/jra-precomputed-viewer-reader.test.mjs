import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,
  JRA_PRECOMPUTED_VIEWER_MODEL_VERSION,
  precomputedViewerEnabled,
  projectJraPrecomputedViewerRace,
  readJraPrecomputedViewerRace
} from '../src/prediction/jra-precomputed-viewer-reader.mjs';

const raceId='20261003-JRA-東京-11';
const now=Date.parse('2026-10-03T06:05:00Z');

function data(overrides={}){
  return {
    schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
    race:{date:'2026-10-03',racecourse:'東京',raceNo:11,raceName:'Viewer Canary',surface:'芝',distance:2000,trackCondition:'良'},
    horses:[
      {horseNo:1,horseName:'Alpha',abilityRank:1,overall:88.2,win:25.5,place:61.5,predictedTime:'1:58.8',abilityMark:'◎',runningStyle:'先行',jraIndices:{distance:90,course:87,pace:82}},
      {horseNo:2,horseName:'Beta',abilityRank:2,overall:84.1,win:12.25,place:39.75,predictedTime:'1:59.2',abilityMark:'○',runningStyle:'差し',jraIndices:{distance:82,course:85,pace:79}}
    ],
    quality:{horseCount:2},...overrides
  };
}

function row(overrides={}){
  return {
    organization:'JRA',race_id:raceId,revision:5,
    source_validated_at:'2026-10-03T06:00:00Z',data_calculated_at:'2026-10-03T05:59:30Z',calculated_at:'2026-10-03T05:59:30Z',
    calculation_version:JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,
    model_version:JRA_PRECOMPUTED_VIEWER_MODEL_VERSION,status:'PARTIAL',data_json:JSON.stringify(data()),
    market_json:JSON.stringify({poison:'MARKET'}),final_json:JSON.stringify({poison:'FINAL'}),result_json:JSON.stringify({poison:'RESULT'}),
    ...overrides
  };
}

function db(returnRow){
  const calls=[];
  return {calls,prepare(sql){
    assert.match(sql,/^SELECT\b/i);
    assert.doesNotMatch(sql,/market_json|final_json|result_json/i);
    const call={sql,args:[]};calls.push(call);
    return {bind(...args){call.args=args;return this;},async first(){return typeof returnRow==='function'?returnRow(call):returnRow;}};
  }};
}

test('viewer flag parser is explicit true only',()=>{
  assert.equal(precomputedViewerEnabled({ENABLE_PRECOMPUTED_VIEWER:'true'}),true);
  assert.equal(precomputedViewerEnabled({ENABLE_PRECOMPUTED_VIEWER:'TRUE'}),true);
  for(const value of [undefined,'','false','1','yes'])assert.equal(precomputedViewerEnabled({ENABLE_PRECOMPUTED_VIEWER:value}),false);
});

test('flag OFF performs zero precomputed D1 reads',async()=>{
  const DB=db(row());
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'false'},DB,raceId,now});
  assert.deepEqual(result,{status:'DISABLED',reason:'VIEWER_FLAG_OFF',race:null});
  assert.equal(DB.calls.length,0);
});

test('flag ON reads exact JRA calculation/model version and projects DATA only',async()=>{
  const DB=db(row());
  const oldFetch=globalThis.fetch;let fetchCalls=0;
  globalThis.fetch=async()=>{fetchCalls++;throw new Error('network forbidden');};
  try{
    const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,raceId,now});
    assert.equal(result.status,'READY');
    assert.deepEqual(DB.calls[0].args,['JRA',raceId,JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION]);
    assert.equal(result.race.viewerMode,'precomputed-early-data-only');
    assert.equal(result.race.marketEvaluation,'disabled');
    assert.equal(result.race.race.marketAvailable,false);
    assert.equal(result.race.horses[0].winProb,0.255);
    assert.equal(result.race.horses[0].top3Prob,0.615);
    assert.equal(result.race.horses[1].winProb,0.1225);
    assert.equal(result.race.horses[1].top3Prob,0.3975);
    assert.equal(JSON.stringify(result.race).includes('poison'),false);
    assert.equal(fetchCalls,0);
  }finally{globalThis.fetch=oldFetch;}
});

test('DATA missing fails closed',async()=>{
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({data_json:null})),raceId,now});
  assert.equal(result.status,'REJECTED');
  assert.equal(result.reason,'DATA_MISSING');
});

test('calculationVersion mismatch fails closed',async()=>{
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({calculation_version:'wrong'})),raceId,now});
  assert.equal(result.reason,'VERSION_MISMATCH');
});

test('modelVersion mismatch fails closed',async()=>{
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({model_version:'wrong'})),raceId,now});
  assert.equal(result.reason,'VERSION_MISMATCH');
});

test('malformed DATA JSON fails closed',async()=>{
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({data_json:'{not-json'})),raceId,now});
  assert.equal(result.reason,'MALFORMED_DATA');
});

test('wrong organization or race identity fails closed',async()=>{
  for(const changed of [
    {organization:'NAR'},
    {race_id:'20261003-JRA-東京-10'},
    {data_json:JSON.stringify(data({race:{...data().race,raceNo:10}}))},
    {data_json:JSON.stringify(data({raceType:'NAR'}))}
  ]){
    const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row(changed)),raceId,now});
    assert.equal(result.status,'REJECTED');
    assert.equal(result.reason,'IDENTITY_MISMATCH');
  }
});

test('stale or future source validation fails closed',async()=>{
  const stale=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({source_validated_at:'2026-10-03T05:40:00Z'})),raceId,now});
  assert.equal(stale.reason,'STALE');
  const future=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({source_validated_at:'2026-10-03T06:06:00Z'})),raceId,now});
  assert.equal(future.reason,'STALE');
});

test('invalid probability scale and duplicate runners fail closed',async()=>{
  const invalid=data();invalid.horses[0].win=120;
  const badProbability=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({data_json:JSON.stringify(invalid)})),raceId,now});
  assert.equal(badProbability.reason,'MALFORMED_DATA');
  const duplicate=data();duplicate.horses[1].horseNo=1;
  const badDuplicate=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB:db(row({data_json:JSON.stringify(duplicate)})),raceId,now});
  assert.equal(badDuplicate.reason,'MALFORMED_DATA');
});

test('projection itself cannot expose MARKET FINAL RESULT payloads',()=>{
  const projected=projectJraPrecomputedViewerRace(row(),{raceId});
  const serialized=JSON.stringify(projected);
  assert.doesNotMatch(serialized,/MARKET|FINAL|RESULT|poison/);
  assert.equal(projected.validation.probabilityScale,'0-1');
});
