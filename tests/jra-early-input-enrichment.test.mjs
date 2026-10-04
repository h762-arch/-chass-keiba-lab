import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {calculateJraData,projectJraAbilityInput} from '../src/prediction/jra-data-calculator.mjs';
import {assertMarketIndependentData,createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {runRacePrecomputeJob} from '../src/prediction/background-precompute.mjs';
import {JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION as calculationVersion,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION as modelVersion,readJraPrecomputedViewerRace} from '../src/prediction/jra-precomputed-viewer-reader.mjs';
import {preflightQueries} from '../scripts/jra-production-preflight.mjs';

const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/jra/jra-early-enrichment-baseline.json',import.meta.url),'utf8'));
const clone=value=>structuredClone(value);
const fields=['frameNo','jockey','trainer','bodyWeight','bodyWeightChange'];
const job={organization:'JRA',date:'2026-09-05',track:'中山',raceNo:5};
const raceId='20260905-JRA-中山-05';
const now='2026-09-05T03:00:00Z';
const versions={calculationVersion,modelVersion};
function withoutEnrichment(data){
 const value=clone(data);delete value.race.postTime;
 value.horses.forEach(h=>fields.forEach(key=>delete h[key]));
 return value;
}

test('official parser explanation values survive input and DATA without scoring',()=>{
 const html=fs.readFileSync(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
 const source=parseJraRaceCard(html,{date:job.date,track:job.track,race:job.raceNo});
 const input=projectJraAbilityInput(source),data=calculateJraData(source);
 assert.equal(data.race.postTime,source.race.postTime);
 for(const original of source.horses){
  const projected=input.horses.find(h=>h.horseNo===original.horseNo);
  const saved=data.horses.find(h=>h.horseNo===original.horseNo);
  for(const key of fields){assert.equal(projected[key],original[key]);assert.equal(saved[key],original[key]);}
  original.pastRuns.forEach((run,i)=>{
   assert.equal(projected.pastRuns[i].jockey,run.jockey??'');
   assert.equal(projected.pastRuns[i].bodyWeight,run.bodyWeight??null);
  });
 }
 assertMarketIndependentData(data);
});

test('all legacy DATA fields remain byte-equivalent to the v1 base SHA fixture',()=>{
 const data=calculateJraData(clone(baseline.source));
 assert.equal(JSON.stringify(withoutEnrichment(data)),JSON.stringify(baseline.data));
 assert.equal(data.race.postTime,baseline.source.race.postTime);
 data.horses.forEach((horse,i)=>fields.forEach(key=>assert.equal(horse[key],baseline.source.horses[i][key])));
});

test('changing explanation fields including past-run metadata cannot move ability outputs',()=>{
 const source=clone(baseline.source);
 source.race.postTime='15:45';
 source.horses.forEach((horse,i)=>{
  horse.frameNo=8-i;horse.jockey='別騎手';horse.trainer='別調教師';
  horse.bodyWeight=520+i*10;horse.bodyWeightChange=-24+i;
  horse.pastRuns.forEach(run=>{run.jockey='別走歴騎手';run.bodyWeight=530;});
 });
 assert.equal(JSON.stringify(withoutEnrichment(calculateJraData(source))),JSON.stringify(baseline.data));
 // weightChangeFromPrevious is carried-weight delta, never body-weight delta.
 assert.equal(calculateJraData(source).horses[0].features.weightChangeFromPrevious,-2);
});

test('unannounced body weights and changes stay null; published zero change is retained',()=>{
 for(const absent of [null,undefined]){
  const source=clone(baseline.source);
  source.horses.forEach(h=>{h.bodyWeight=absent;h.bodyWeightChange=absent;h.pastRuns.forEach(r=>{r.bodyWeight=absent});});
  const input=projectJraAbilityInput(source),data=calculateJraData(source);
  assert.ok(input.horses.every(h=>h.bodyWeight===null&&h.bodyWeightChange===null&&h.pastRuns.every(r=>r.bodyWeight===null)));
  assert.ok(data.horses.every(h=>h.bodyWeight===null&&h.bodyWeightChange===null));
 }
 assert.equal(calculateJraData(baseline.source).horses[1].bodyWeightChange,0);
});

test('missing official postTime is never inferred',()=>{
 for(const missing of ['',null,undefined]){
  const source=clone(baseline.source);source.race.postTime=missing;
  assert.equal(calculateJraData(source).race.postTime,'');
 }
});

test('enriched projection excludes arbitrary market and training values at every input level',()=>{
 const source=clone(baseline.source);
 const poison={odds:1.1,popularity:1,EV:3,marketRank:1,MARKET:{odds:1},FINAL:{mark:'◎'},RESULT:{finish:1},trainingScore:99,workoutScore:99,jockeyScore:99,trainerScore:99,bodyWeightScore:99,gateScore:99};
 Object.assign(source,poison);Object.assign(source.race,poison);
 source.horses.forEach(h=>{Object.assign(h,poison);h.pastRuns.forEach(r=>Object.assign(r,poison));});
 const data=calculateJraData(source),input=projectJraAbilityInput(source);
 assert.deepEqual(data,calculateJraData(baseline.source));
 assertMarketIndependentData(input);assertMarketIndependentData(data);
 assert.doesNotMatch(JSON.stringify({input,data}),/"(?:odds|popularity|EV|marketRank|MARKET|FINAL|RESULT|trainingScore|workoutScore|jockeyScore|trainerScore|bodyWeightScore|gateScore)":/);
 for(const key of ['odds','popularity','EV','marketRank'])assert.throws(()=>assertMarketIndependentData({[key]:1}),/market_field_in_data/);
});

test('enriched DATA stays runner-order stable and ignores scratched/excluded runners',()=>{
 const source=clone(baseline.source);source.horses.reverse();
 for(const [i,status] of ['scratched','excluded'].entries())source.horses.push({...clone(source.horses[0]),horseNo:98+i,runningStatus:status});
 assert.deepEqual(calculateJraData(source),calculateJraData(baseline.source));
});

test('runtime config, Viewer and READ-ONLY preflight agree on v2 with unchanged model and safety settings',()=>{
 const config=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).vars;
 assert.equal(calculationVersion,'jra-ability-data-v2');assert.equal(modelVersion,'10.0.1-jra-drive1-ability');
 assert.equal(config.JRA_PRECOMPUTE_CALCULATION_VERSION,calculationVersion);
 assert.equal(config.JRA_PRECOMPUTE_MODEL_VERSION,modelVersion);
 for(const [key,value] of Object.entries({ENABLE_BACKGROUND_PRECOMPUTE:'true',ENABLE_PRECOMPUTED_VIEWER:'true',ENABLE_JRA_DIRECT_FETCH:'false',ENABLE_JRA_ODDS_DIRECT_FETCH:'false',JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',JRA_PRECOMPUTE_MAX_JOBS:'1'}))assert.equal(config[key],value);
 const sql=preflightQueries(job.date).snapshotAudit;
 assert.ok(sql.includes(`calculation_version='${calculationVersion}'`));
 assert.ok(sql.includes(`model_version='${modelVersion}'`));
});

test('v2 recalculates the same SOURCE over v1 DATA then short-circuits identical v2 DATA',async()=>{
 const source=clone(baseline.source);
 let existing=await createPrecomputedSnapshot({raceId,organization:'JRA',source,data:baseline.data,versions:{...versions,calculationVersion:'jra-ability-data-v1'},now});
 const oldHash=existing.inputHash;let calculates=0,saves=0;
 const deps={enabled:true,versions,now,loadSource:async()=>source,loadLatest:async()=>existing,
  calculate:async()=>{calculates++;return {DATA:calculateJraData(source),versions};},
  save:async snapshot=>{saves++;existing=snapshot;return {saved:true,revision:saves};}};
 assert.equal((await runRacePrecomputeJob(job,deps)).status,'SAVED');
 assert.equal(calculates,1);assert.notEqual(existing.inputHash,oldHash);
 assert.equal(existing.calculationVersion,calculationVersion);assert.equal(existing.modelVersion,modelVersion);
 assert.equal(existing.layers.DATA.race.postTime,source.race.postTime);
 for(const layer of ['MARKET','FINAL','RESULT'])assert.equal(existing.layers[layer],null);
 assert.equal((await runRacePrecomputeJob(job,deps)).status,'SOURCE_VALIDATED');
 assert.equal(calculates,1);assert.equal(saves,2);
});

test('v1 DATA is rejected as v2 with one read, zero write and zero network',async()=>{
 let reads=0;const oldFetch=globalThis.fetch;
 globalThis.fetch=()=>{throw new Error('unexpected_network');};
 try{
  const DB={prepare(sql){reads++;assert.match(sql,/^SELECT/);assert.doesNotMatch(sql,/market_json|final_json|result_json/i);
   return {bind(...args){assert.deepEqual(args,['JRA',raceId,calculationVersion,modelVersion]);return this;},
    async first(){return {organization:'JRA',race_id:raceId,calculation_version:'jra-ability-data-v1',model_version:modelVersion,data_json:JSON.stringify(baseline.data)};}};}};
  const result=await readJraPrecomputedViewerRace({env:{ENABLE_PRECOMPUTED_VIEWER:'true'},DB,raceId,now:Date.parse(now)});
  assert.equal(result.reason,'VERSION_MISMATCH');assert.equal(result.race,null);assert.equal(reads,1);
 }finally{globalThis.fetch=oldFetch;}
});
