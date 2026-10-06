import test from 'node:test';
import assert from 'node:assert/strict';
import {readJraEarlyResearchSnapshot} from '../src/prediction/jra-early-research-reader.mjs';
import {compareJraEarlyToOfficialResult} from '../src/research/jra-early-result-kpi.mjs';
import {evaluateJraStarShadow,summarizeJraStarShadow} from '../src/research/jra-star-shadow-kpi.mjs';

const raceId='20261010-JRA-東京-01',now=Date.parse('2026-10-10T03:00:00Z');
const horses=Array.from({length:6},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,
 abilityRank:i+1,overall:80-i,win:20-i,place:40-i,predictedTime:'1:20.0'}));
const data={schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',
 race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},horses};
const row=(revision,payload=data)=>({organization:'JRA',race_id:raceId,revision,
 source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:'2026-10-10T00:01:00Z',
 calculation_version:'jra-ability-data-v2',model_version:'10.0.1-jra-drive1-ability',
 status:'PARTIAL',data_json:JSON.stringify(payload)});
const result=()=>({organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,
 fetched_at:'2026-10-10T02:00:00Z',payload_json:JSON.stringify({ok:true,organization:'JRA',
 source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,
 quality:{complete:true,finishOrderCount:3},finishOrder:[5,1,2],
 results:horses.map(h=>({horseNo:h.horseNo,position:[5,1,2,3,4,6].indexOf(h.horseNo)+1,actualTime:'1:20.2'}))})});
function db(rows=[row(2,{...data,horses:horses.map(h=>({...h,abilityRank:h.horseNo===4?5:h.horseNo===5?4:h.abilityRank}))}),row(1)],official=result()){
 const calls=[];
 return {calls,prepare(sql){assert.match(sql,/^SELECT\b/);assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b|market_json|final_json|result_json/i);
  const call={sql,args:[]};calls.push(call);
  return {bind(...args){call.args=args;return this},async first(){
   if(sql.includes('precomputed_race_snapshots'))return rows.filter(r=>r.calculation_version===call.args[2]&&r.model_version===call.args[3]).sort((a,b)=>a.revision-b.revision)[0]??null;
   assert.deepEqual(call.args,['result|2026-10-10|東京|1']);return official;
  }};
 }};
}

test('earliest frozen rank five is compared only to validated official result with SELECT only',async()=>{
 const DB=db();const early=await readJraEarlyResearchSnapshot({DB,raceId,now});
 const comparison=await compareJraEarlyToOfficialResult({DB,raceId,now});
 const original=JSON.stringify({early,comparison});
 const evaluated=evaluateJraStarShadow({early,officialComparison:comparison});
 assert.equal(early.snapshot.revision,1);assert.equal(evaluated.status,'READY');
 assert.deepEqual(evaluated.observation,{raceId,earlyRevision:1,horseNo:5,winHit:true,top3Hit:true});
 assert.equal(JSON.stringify({early,comparison}),original);
 assert.equal(DB.calls.length,3);
 assert.doesNotMatch(JSON.stringify(evaluated),/odds|popularity|MARKET|FINAL|RESULT/);
});

test('pending, temporal uncertainty, mismatched revision and missing runner never count as losses',async()=>{
 const DB=db(),early=await readJraEarlyResearchSnapshot({DB,raceId,now});
 const valid=await compareJraEarlyToOfficialResult({DB,raceId,now});
 const c=valid.comparison;
 const pending=evaluateJraStarShadow({early,officialComparison:{status:'PENDING'}});
 assert.equal(pending.status,'PENDING');
 for(const changed of [
  {...c,earlyRevision:2},{...c,formalKpiEligible:false},
  {...c,runners:c.runners.map(r=>r.horseNo===5?{...r,matched:false,win:null,top3:null}:r)}
 ])assert.equal(evaluateJraStarShadow({early,officialComparison:{status:'READY',comparison:changed}}).status,'EXCLUDED');
 const invalidEarly={...early,snapshot:{...early.snapshot,calculationVersion:'jra-ability-data-v1'}};
 assert.equal(evaluateJraStarShadow({early:invalidEarly,officialComparison:valid}).status,'EXCLUDED');
});

test('cohort hit rates use matched races only and reject duplicate identities',async()=>{
 const DB=db(),early=await readJraEarlyResearchSnapshot({DB,raceId,now});
 const hit=await compareJraEarlyToOfficialResult({DB,raceId,now});
 const another={...early,snapshot:{...early.snapshot,raceId:'20261010-JRA-東京-02'}};
 const miss={status:'READY',comparison:{...hit.comparison,raceId:another.snapshot.raceId,
  runners:hit.comparison.runners.map(r=>r.horseNo===5?{...r,win:false,top3:false}:r)}};
 const pending={...early,snapshot:{...early.snapshot,raceId:'20261010-JRA-東京-03'}};
 const pairs=[{early:pending,officialComparison:{status:'PENDING'}},
  {early:another,officialComparison:miss},{early,officialComparison:hit}];
 const summary=summarizeJraStarShadow(pairs).summary;
 assert.equal(summary.requestedRaceCount,3);assert.equal(summary.observedRaceCount,2);
 assert.equal(summary.excludedRaceCount,1);assert.equal(summary.winHits,1);
 assert.equal(summary.top3Hits,1);assert.equal(summary.winHitRate,.5);
 assert.equal(summary.top3HitRate,.5);assert.equal(summary.reasonCounts.OFFICIAL_RESULT_NOT_FOUND,1);
 assert.deepEqual(summary,summarizeJraStarShadow([...pairs].reverse()).summary);
 assert.equal(summarizeJraStarShadow([pairs[2],pairs[2]]).reason,'INVALID_COHORT');
});
