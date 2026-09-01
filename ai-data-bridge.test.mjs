import test from 'node:test';
import assert from 'node:assert/strict';
import {handleChassBridge,VERSION} from '../worker.js';

const prediction=(createdAt,modelVersion='9.9.29')=>({
  schemaVersion:3,modelVersion,createdAt,
  volatility:{volatilityIndex:72,confidence:81,similarRaceCount:42,similarUpsetRate:71,stabilityScore:28},
  axisModel:{raceConfidence:54},
  horses:[
    {horseNo:1,horseName:'アルファ',win:22,place:58,predictedTime:'1:38.4',abilityScore:91,overall:94,predictionAxes:{speedCeilingScore:88,placeStabilityScore:82,paceFitScore:77,predictionConsensus:84}},
    {horseNo:2,horseName:'ベータ',win:16,place:47,predictedTime:'1:39.0',abilityScore:86,overall:89,predictionAxes:{speedCeilingScore:80,placeStabilityScore:78,paceFitScore:73,predictionConsensus:76}},
    {horseNo:3,horseName:'ガンマ',win:8,place:28,predictedTime:'',predictedTimeMissingReason:'time_missing_no_history',abilityScore:72,overall:76,predictionAxes:{speedCeilingScore:null,placeStabilityScore:51,paceFitScore:61,predictionConsensus:55}}
  ]
});

function raceRows(){
  const validatedAt='2026-08-31T09:00:00.000Z',pendingAt='2026-08-31T10:00:00.000Z';
  const original=prediction(validatedAt);
  const live={createdAt:'2026-08-31T09:20:00.000Z',adjustedFromModelVersion:'9.9.29',scratchImpactScore:63,excludedHorseNos:[3],volatility:{volatilityIndex:51,confidence:74,similarRaceCount:40,similarUpsetRate:49,stabilityScore:49},raceConfidence:66,horses:[
    {...original.horses[0],win:57.9,place:69,finalMark:'◎',horseStatus:'active'},
    {...original.horses[1],win:42.1,place:61,finalMark:'○',horseStatus:'active'},
    {...original.horses[2],win:0,place:0,finalMark:'',horseStatus:'scratched'}
  ]};
  const result={schemaVersion:3,fetchedAt:'2026-08-31T10:30:00.000Z',finishOrder:[1,2,3],actualTimes:{1:'1:38.7',2:'1:39.1'},trackCondition:'良',horses:[{horseNo:1,position:1,time:'1:38.7',last3f:37.1,cornerPositions:'2-2'},{horseNo:2,position:2,time:'1:39.1',last3f:37.0,cornerPositions:'4-3'},{horseNo:3,position:3,time:'',horseStatus:'scratched'}]};
  const market={acquiredAt:'2026-08-31T08:58:00.000Z',horses:[{horseNo:1,odds:4.2,popularity:2,ev:118,valueMark:'',marketGapScore:12},{horseNo:2,odds:8.1,popularity:4,ev:126,valueMark:'💎',valueType:'相手穴',marketGapScore:56},{horseNo:3,odds:null,popularity:null,ev:null}]};
  const final={top3:[{horseNo:1,mark:'◎'},{horseNo:2,mark:'○'},{horseNo:3,mark:'▲'}]};
  const validated={race_id:'2026-08-31|大井|8',model_version:'9.9.29',race_json:JSON.stringify({raceDate:'2026-08-31',track:'大井',raceNo:8,distance:1600,surface:'ダート',postTime:'18:35',raceClass:'C2',liveAdjustedPrediction:live,scratchAudit:{scratchDetectedAt:'2026-08-31T09:19:00.000Z',scratchImpactScore:63,statusByHorse:{3:'scratched'}}}),prediction_json:JSON.stringify(original),market_json:JSON.stringify(market),final_json:JSON.stringify(final),result_json:JSON.stringify(result),validation_json:JSON.stringify({modelVersion:'9.9.29',generatedAt:'2026-08-31T10:31:00.000Z',failures:[]}),prediction_created_at:validatedAt,result_acquired_at:result.fetchedAt,status:'validated',updated_at:'2026-08-31T10:31:00.000Z'};
  const pendingPrediction=prediction(pendingAt,'9.9.30');
  const pending={race_id:'2026-08-31|大井|9',model_version:'9.9.30',race_json:JSON.stringify({raceDate:'2026-08-31',track:'大井',raceNo:9,distance:1200,surface:'ダート',postTime:'19:10',resultQueue:{status:'result_retry',attempts:2,nextCheckAt:'2026-08-31T10:15:00.000Z',lastResultError:'network_error'}}),prediction_json:JSON.stringify(pendingPrediction),market_json:JSON.stringify({horses:[]}),final_json:JSON.stringify(final),result_json:null,validation_json:null,prediction_created_at:pendingAt,result_acquired_at:null,status:'result_retry',updated_at:'2026-08-31T10:02:00.000Z'};
  return [pending,validated];
}

class FakeD1 {
  constructor({fail=false}={}){this.rows=raceRows();this.fail=fail;this.sql=[];this.writeCount=0}
  prepare(sql){this.sql.push(String(sql));if(!/^\s*(SELECT|WITH)\b/i.test(String(sql))){this.writeCount++;throw new Error('write attempted')};const db=this;return {async first(){if(db.fail)throw new Error('D1 unavailable');return {ok:1}},async all(){if(db.fail)throw new Error('D1 unavailable');if(/FROM\s+races/i.test(sql))return {results:db.rows};if(/FROM\s+predictions/i.test(sql))return {results:db.rows.map(row=>({race_id:row.race_id,model_version:row.model_version,horse_count:3}))};if(/FROM\s+results/i.test(sql))return {results:[]};return {results:[]}}}}
  async batch(){this.writeCount++;throw new Error('batch write attempted')}
}

const envFor=db=>({DB:db,CHASS_BRIDGE_TOKEN:'secret-token'});
const req=(path,{token='secret-token',method='GET',origin}={})=>new Request(`https://example.test${path}`,{method,headers:{...(token==null?{}:{authorization:`Bearer ${token}`}),...(origin?{origin}:{})}});
const json=async response=>({response,body:await response.json()});

test('bridge remains compatible at Ver.10.0-dev',()=>assert.equal(VERSION,'10.0-dev'));
test('missing and invalid credentials are rejected',async()=>{
  const db=new FakeD1();
  assert.equal((await handleChassBridge(req('/api/chass/v1/context',{token:null}),envFor(db))).status,401);
  assert.equal((await handleChassBridge(req('/api/chass/v1/context',{token:'bad'}),envFor(db))).status,401);
  assert.equal((await handleChassBridge(req('/api/chass/v1/context'),{DB:db})).status,503);
});
test('authorized latest context is compact and reports freshness',async()=>{
  const db=new FakeD1(),{response,body}=await json(await handleChassBridge(req('/api/chass/v1/context'),envFor(db)));
  assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.probabilityScale,'0-1');assert.ok(body.responseBytes<100_000);assert.equal(body.latestPredictions.page.length,2);assert.equal(body.latestPredictions.page[0].raceNo,9);assert.equal(body.researchMetrics.validatedRaceCount,1);assert.ok(body.longshotMetrics);assert.ok(body.volatilityMetrics);
});
test('race scope returns one race with Original and Live separated',async()=>{
  const db=new FakeD1(),{body}=await json(await handleChassBridge(req('/api/chass/v1/race?raceId=2026-08-31%7C%E5%A4%A7%E4%BA%95%7C8'),envFor(db)));
  assert.equal(body.race.raceNo,8);assert.equal(body.race.original.horses[0].aiWinProbability,0.22);assert.equal(body.race.liveAdjusted.horses[0].aiWinProbability,0.579);assert.equal(body.race.scratch.scratchCount,1);
  const missing=body.race.original.horses.find(h=>h.horseNo===3);assert.equal(missing.predictedTimeSeconds,null);assert.equal(missing.predictedTimeMissingReason,'time_missing_no_history');
});
test('race can be found by date, track and race number',async()=>{
  const db=new FakeD1(),{body}=await json(await handleChassBridge(req('/api/chass/v1/race?date=2026-08-31&track=%E5%A4%A7%E4%BA%95&raceNo=8'),envFor(db)));assert.equal(body.race.raceId,'2026-08-31|大井|8');
});
test('race bridge adds walk-forward Historical Similarity without changing prediction',async()=>{
  const db=new FakeD1(),target=db.rows.find(row=>row.race_id.endsWith('|8')),originalPrediction=target.prediction_json;
  for(let day=1;day<=20;day++){const row=structuredClone(target),date=`2026-07-${String(day).padStart(2,'0')}`,prediction=JSON.parse(row.prediction_json),race=JSON.parse(row.race_json),result=JSON.parse(row.result_json);row.race_id=`${date}|大井|8`;race.raceDate=date;delete race.liveAdjustedPrediction;delete race.scratchAudit;prediction.createdAt=`${date}T08:00:00.000Z`;result.fetchedAt=`${date}T10:00:00.000Z`;row.race_json=JSON.stringify(race);row.prediction_json=JSON.stringify(prediction);row.result_json=JSON.stringify(result);row.prediction_created_at=prediction.createdAt;row.result_acquired_at=result.fetchedAt;row.updated_at=result.fetchedAt;db.rows.push(row)}
  const {body}=await json(await handleChassBridge(req('/api/chass/v1/race?raceId=2026-08-31%7C%E5%A4%A7%E4%BA%95%7C8'),envFor(db)));
  assert.equal(body.race.historicalSimilarity.similarityVersion,'similarity_v1');assert.equal(body.race.historicalSimilarity.original.similarRaceCount,20);assert.equal(body.race.historicalSimilarity.original.adopted,false);assert.equal(target.prediction_json,originalPrediction);
});
test('research bridge exposes shadow walk-forward metrics',async()=>{
  const db=new FakeD1(),target=db.rows.find(row=>row.race_id.endsWith('|8'));
  for(let day=1;day<=12;day++){const row=structuredClone(target),date=`2026-07-${String(day).padStart(2,'0')}`,prediction=JSON.parse(row.prediction_json),race=JSON.parse(row.race_json),result=JSON.parse(row.result_json);row.race_id=`${date}|大井|8`;race.raceDate=date;prediction.createdAt=`${date}T08:00:00.000Z`;result.fetchedAt=`${date}T10:00:00.000Z`;row.race_json=JSON.stringify(race);row.prediction_json=JSON.stringify(prediction);row.result_json=JSON.stringify(result);row.prediction_created_at=prediction.createdAt;row.result_acquired_at=result.fetchedAt;row.updated_at=result.fetchedAt;db.rows.push(row)}
  const {body}=await json(await handleChassBridge(req('/api/chass/v1/research'),envFor(db)));assert.equal(body.similarityMetrics.mode,'walk_forward_shadow');assert.equal(body.similarityMetrics.adopted,false);assert.equal(body.similarityMetrics.officialPredictionDelta.brierScore,0);
});
test('unknown race is 404 and SQL-looking input is never interpolated',async()=>{
  const db=new FakeD1(),attack=encodeURIComponent("x' OR 1=1 --"),response=await handleChassBridge(req(`/api/chass/v1/race?raceId=${attack}`),envFor(db));assert.equal(response.status,404);assert.equal(db.sql.some(sql=>sql.includes("OR 1=1")),false);
});
test('pending scope contains pending races only',async()=>{
  const db=new FakeD1(),{body}=await json(await handleChassBridge(req('/api/chass/v1/pending'),envFor(db)));assert.equal(body.pendingResults.total,1);assert.equal(body.pendingResults.page[0].status,'result_retry');assert.equal(body.pendingResults.page[0].pending.lastError,'network_error');
});
test('research scope reuses validation population',async()=>{
  const db=new FakeD1(),{body}=await json(await handleChassBridge(req('/api/chass/v1/research'),envFor(db)));assert.equal(body.researchMetrics.validatedRaceCount,1);assert.equal(body.researchMetrics.evaluatedHorseCount,3);assert.equal(body.researchMetrics.performanceByModelVersion['9.9.29'].validatedRaceCount,1);
});
test('GET bridge performs SELECT only and never calls D1 batch',async()=>{
  const db=new FakeD1();await handleChassBridge(req('/api/chass/v1/context?scope=recent&limit=100'),envFor(db));assert.equal(db.writeCount,0);assert.ok(db.sql.every(sql=>/^\s*(SELECT|WITH)\b/i.test(sql)));
});
test('D1 failure is isolated as 503',async()=>{const response=await handleChassBridge(req('/api/chass/v1/context'),envFor(new FakeD1({fail:true})));assert.equal(response.status,503);assert.equal((await response.json()).error,'d1_read_failed')});
test('write methods are rejected',async()=>{const response=await handleChassBridge(req('/api/chass/v1/context',{method:'POST'}),envFor(new FakeD1()));assert.equal(response.status,405)});
test('unknown scope is rejected instead of broadening data access',async()=>{const response=await handleChassBridge(req('/api/chass/v1/context?scope=all'),envFor(new FakeD1()));assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_scope')});
test('unknown bridge paths do not fall through to latest context',async()=>{const response=await handleChassBridge(req('/api/chass/v1/everything'),envFor(new FakeD1()));assert.equal(response.status,404);assert.equal((await response.json()).error,'not_found')});
test('CORS is emitted only for the configured exact origin',async()=>{
  const db=new FakeD1(),env={...envFor(db),CHASS_BRIDGE_ALLOWED_ORIGIN:'https://chat.example'};
  const allowed=await handleChassBridge(req('/api/chass/v1/health',{origin:'https://chat.example'}),env),denied=await handleChassBridge(req('/api/chass/v1/health',{origin:'https://evil.example'}),env);
  assert.equal(allowed.headers.get('access-control-allow-origin'),'https://chat.example');assert.equal(denied.headers.get('access-control-allow-origin'),null);
});
