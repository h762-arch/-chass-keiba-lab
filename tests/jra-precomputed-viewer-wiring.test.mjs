import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleJraPrecomputedViewerPublicApi,
  readJraPrecomputedViewerRaces,
  JRA_PRECOMPUTED_VIEWER_MODE
} from '../src/prediction/jra-precomputed-viewer-api.mjs';
import {
  JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,
  JRA_PRECOMPUTED_VIEWER_MODEL_VERSION
} from '../src/prediction/jra-precomputed-viewer-reader.mjs';
import {sanitizeViewerDayPayload,viewerAllowsMarketOverlay} from '../viewer/viewer-core.js';

const now=Date.parse('2026-10-04T00:05:00Z');
const date='2026-10-04';
const data=(track,raceNo)=>({
  schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
  race:{date,racecourse:track,raceNo,raceName:`${track}${raceNo}R`,surface:'芝',distance:2000,trackCondition:'良'},
  horses:[
    {horseNo:1,horseName:'Alpha',abilityRank:1,overall:88,win:25,place:60,predictedTime:'1:58.8',abilityMark:'◎',runningStyle:'先行',jraIndices:{distance:90,course:85,pace:80}},
    {horseNo:2,horseName:'Beta',abilityRank:2,overall:80,win:12,place:38,predictedTime:'1:59.2',abilityMark:'○',runningStyle:'差し',jraIndices:{distance:82,course:80,pace:78}}
  ]
});
const row=(track='東京',raceNo=1,overrides={})=>({
  organization:'JRA',race_id:`20261004-JRA-${track}-${String(raceNo).padStart(2,'0')}`,revision:2,
  source_validated_at:'2026-10-04T00:00:00Z',data_calculated_at:'2026-10-04T00:00:00Z',calculated_at:'2026-10-04T00:00:00Z',
  calculation_version:JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,model_version:JRA_PRECOMPUTED_VIEWER_MODEL_VERSION,
  status:'PARTIAL',data_json:JSON.stringify(data(track,raceNo)),...overrides
});

class D1{
  constructor(rows=[]){this.rows=rows;this.calls=[];this.writes=0;}
  prepare(sql){
    assert.match(sql,/^SELECT\b/i);
    assert.doesNotMatch(sql,/source_json|market_json|final_json|result_json/i);
    assert.doesNotMatch(sql,/INSERT|UPDATE|DELETE|REPLACE/i);
    const call={sql:String(sql),args:[]};this.calls.push(call);const self=this;
    return {
      bind(...args){call.args=args;return this;},
      async all(){return {results:self.rows};},
      async first(){return self.rows.find(r=>r.race_id===call.args[1])||null;}
    };
  }
}
const req=path=>new Request(`https://example.test${path}`);

test('flag OFF bypasses wiring with zero precomputed D1 reads',async()=>{
  const DB=new D1([row()]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=東京&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'false'},DB,{now});
  assert.equal(response,null);
  assert.equal(DB.calls.length,0);
});

test('flag ON JRA day is DATA-only and probability scale is 0-1',async()=>{
  const DB=new D1([row('東京',2),row('東京',1)]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=東京&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('X-CHASS-Viewer-Mode'),JRA_PRECOMPUTED_VIEWER_MODE);
  const body=await response.json();
  assert.equal(body.viewerMode,'precomputed-early-data-only');
  assert.equal(body.marketEvaluation,'disabled');
  assert.equal(body.races.length,2);
  assert.equal(body.races[0].horses[0].winProb,.25);
  assert.equal(body.races[0].horses[0].top3Prob,.6);
  for(const race of body.races){
    assert.equal(race.race.marketAvailable,false);
    for(const horse of race.horses)for(const key of ['odds','popularity','expectedValue','diamond','warning'])assert.equal(key in horse,false,key);
  }
  assert.equal(DB.calls.length,1);
});

test('date-level races endpoint discovers JRA tracks from precomputed DATA only',async()=>{
  const DB=new D1([row('東京',1),row('京都',1)]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/races?date=${date}&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.deepEqual(new Set(body.races.map(r=>r.track)),new Set(['東京','京都']));
  assert.ok(body.races.every(r=>r.predictionAvailable===true));
  assert.equal(body.marketEvaluation,'disabled');
});

test('race endpoint uses exact precomputed reader and never falls back',async()=>{
  const DB=new D1([row('東京',11)]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/race?date=${date}&track=東京&organization=JRA&race=11`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.race.raceNo,11);
  assert.equal(body.viewerMode,'precomputed-early-data-only');
  assert.deepEqual(DB.calls[0].args,['JRA','20261004-JRA-東京-11',JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION]);
});

test('NAR is never intercepted even when viewer flag is ON',async()=>{
  const DB=new D1([row()]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=大井&organization=NAR`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response,null);
  assert.equal(DB.calls.length,0);
});

test('historical frozen EARLY remains readable after the old freshness window',async()=>{
  const DB=new D1([row('東京',1,{source_validated_at:'2026-10-03T23:00:00Z',data_calculated_at:'2026-10-03T22:59:30Z'})]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=東京&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.races.length,1);
});

test('malformed frozen EARLY fails closed without falling forward',async()=>{
  const DB=new D1([row('東京',1,{revision:2}),row('東京',1,{revision:1,data_json:'{bad json'})]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=東京&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error.code,'PRECOMPUTED_VIEWER_UNAVAILABLE');
});

test('future frozen EARLY timestamp fails closed',async()=>{
  const DB=new D1([row('東京',1,{source_validated_at:'2026-10-04T00:06:00Z'})]);
  const response=await handleJraPrecomputedViewerPublicApi(req(`/api/chass/v1/public/day?date=${date}&track=東京&organization=JRA`),{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,{now});
  assert.equal(response.status,503);
  const body=await response.json();
  assert.equal(body.error.message,'FUTURE_TIMESTAMP');
});

test('list reader freezes earliest nonempty DATA revision per race independent of DB row order',async()=>{
  const older=row('東京',1,{revision:1,data_json:JSON.stringify({...data('東京',1),race:{...data('東京',1).race,raceName:'EARLY'}})});
  const newer=row('東京',1,{revision:3,data_json:JSON.stringify({...data('東京',1),race:{...data('東京',1).race,raceName:'NEW'}})});
  const DB=new D1([newer,older]);
  const read=await readJraPrecomputedViewerRaces({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,date,track:'東京',now});
  assert.equal(read.status,'READY');
  assert.equal(read.races.length,1);
  assert.equal(read.races[0].race.raceName,'EARLY');
  assert.match(DB.calls[0].sql,/data_json IS NOT NULL AND data_json<>''/);
  assert.match(DB.calls[0].sql,/ORDER BY race_id ASC,revision ASC/);
  assert.deepEqual(DB.calls[0].args,['JRA','20261004-JRA-','20261004-JRA-\uffff',JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION]);
});


test('viewer sanitizer preserves EARLY mode and disables market overlay',()=>{
  const day=sanitizeViewerDayPayload({
    ok:true,date,track:'東京',organization:'JRA',viewerMode:'precomputed-early-data-only',marketEvaluation:'disabled',
    races:[{race:{organization:'JRA',date,track:'東京',raceNo:1,raceName:'EARLY'},horses:[]}]
  });
  assert.equal(day.viewerMode,'precomputed-early-data-only');
  assert.equal(day.marketEvaluation,'disabled');
  assert.equal(viewerAllowsMarketOverlay(day),false);
  assert.equal(viewerAllowsMarketOverlay({viewerMode:null,marketEvaluation:null}),true);
});
