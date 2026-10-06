import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateJraFrozenSignalOutcomes} from '../src/research/jra-signal-outcomes.mjs';
import {readJraEarlyResearchSnapshot} from '../src/prediction/jra-early-research-reader.mjs';
import {compareJraEarlyToOfficialResult} from '../src/research/jra-early-result-kpi.mjs';
const raceId='20261010-JRA-東京-01',policyVersion='CHASS-SIGNAL-v1.0';
function input(){
 const horses=['💎','💎💎','💎💎💎','⚠️'].map((mark,i)=>({horseNo:i+1,
  valueMark:i===3?'':mark,warningMark:i===3?mark:'',abilityMarkAtFreeze:'',finalMarkAtFreeze:'',
  popularityAtFreeze:i===3?1:9,oddsAtFreeze:20,evAtFreeze:120,
  longshotScenario:{policyVersion,level:i===0?'place':i===2?'big_win':'win',scenario:'想定着順のシナリオ',marketValue:true,
   evidence:[{code:'LAST3F',strength:2,label:'上がり能力'},{code:'TIME_TOP',strength:2,label:'TIME上位'}]},
  warningScenario:{policyVersion,targetBasis:'market_top3',scenario:'展開不利で4着以下',factors:[{code:'PACE_COLLAPSE',label:'展開不利'}]}}));
 const snapshot={raceId,revision:1,calculationVersion:'jra-ability-data-v2',modelVersion:'10.0.1-jra-drive1-ability',
  dataCalculatedAt:'2026-10-10T00:01:00Z',data:{race:{postTime:'10:05'}}};
 return {raceId,signalSnapshot:{schemaVersion:1,policyVersion,status:'frozen',frozenAt:'2026-10-10T00:02:00Z',horses},
  early:{status:'READY',snapshot},officialComparison:{status:'READY',comparison:{raceId,earlyRevision:1,
  calculationVersion:snapshot.calculationVersion,modelVersion:snapshot.modelVersion,earlyCalculatedAt:snapshot.dataCalculatedAt,
  resultFetchedAt:'2026-10-10T02:00:00Z',resultSource:'JRA_OFFICIAL',formalKpiEligible:true,postTimeStatus:'PRE_POST',
  runners:[{horseNo:1,matched:true,win:false,top3:true},{horseNo:2,matched:true,win:true,top3:true},
   {horseNo:3,matched:true,win:false,top3:false},{horseNo:4,matched:true,win:false,top3:false}]}}};
}

test('each fixed mark has its own outcome target and never becomes a formal EARLY KPI',()=>{
 const p=input(),before=JSON.stringify(p),r=evaluateJraFrozenSignalOutcomes(p);
 assert.equal(r.status,'READY');assert.deepEqual(r.observation.observations.map(h=>[h.target,h.hit]),
  [['SECOND_OR_THIRD',true],['WIN',true],['WIN',false],['FOURTH_OR_WORSE',true]]);
 assert.equal(r.observation.formalKpiEligible,false);assert.equal(r.observation.productionActivationReady,false);
 assert.equal(r.observation.predictionStage,'SIGNAL_FREEZE');assert.equal(JSON.stringify(p),before);
 assert.ok(Object.isFrozen(r.observation.observations[0]));
});
test('a winning single diamond is distinct from a 2nd/3rd scenario hit; top3 warning is a miss',()=>{
 const p=input();p.officialComparison.comparison.runners[0].win=true;
 p.officialComparison.comparison.runners[3].top3=true;
 const rows=evaluateJraFrozenSignalOutcomes(p).observation.observations;
 assert.equal(rows[0].hit,false);assert.equal(rows[0].win,true);assert.equal(rows[0].top3,true);
 assert.equal(rows[3].hit,false);
});
test('pending and unverified official sources never count as losses',()=>{
 const p=input();p.officialComparison={status:'PENDING'};
 assert.equal(evaluateJraFrozenSignalOutcomes(p).status,'PENDING');
 for(const patch of [{resultSource:'MANUAL'},{formalKpiEligible:false},{postTimeStatus:'UNVERIFIED'},
  {earlyRevision:2},{raceId:'20261010-JRA-東京-02'}]){
  const q=input();Object.assign(q.officialComparison.comparison,patch);
  assert.equal(evaluateJraFrozenSignalOutcomes(q).status,'EXCLUDED');
 }
});
test('signals frozen at/after post time or before their calculation are excluded',()=>{
 for(const stamp of ['2026-10-10T01:05:00Z','2026-10-10T02:01:00Z','2026-10-10T00:00:00Z']){
  const p=input();p.signalSnapshot.frozenAt=stamp;
  assert.equal(evaluateJraFrozenSignalOutcomes(p).reason,'SIGNAL_TIMING_UNVERIFIED');
 }
 const p=input();p.early.snapshot.data.race.postTime=null;
 assert.equal(evaluateJraFrozenSignalOutcomes(p).reason,'TEMPORAL_OR_SOURCE_UNVERIFIED');
});
test('violations, legacy market gaps and unmatched runners are per-horse exclusions',()=>{
 const p=input();p.signalSnapshot.horses[0].popularityAtFreeze=5;
 delete p.signalSnapshot.horses[1].oddsAtFreeze;
 p.officialComparison.comparison.runners[2]={horseNo:3,matched:false,win:null,top3:null};
 const r=evaluateJraFrozenSignalOutcomes(p).observation;
 assert.equal(r.observedHorseCount,1);assert.equal(r.excludedHorseCount,3);
 assert.deepEqual(r.excluded.map(x=>x.reason),['SIGNAL_VIOLATION','SIGNAL_UNVERIFIED','RESULT_RUNNER_UNMATCHED']);
});
test('malformed and duplicate result identities fail closed',()=>{
 for(const runner of [{horseNo:5,matched:true,win:true,top3:false},{horseNo:1,matched:true,win:false,top3:true},
  {horseNo:'5',matched:true,win:false,top3:false}]){
  const p=input();p.officialComparison.comparison.runners.push(runner);
  assert.equal(evaluateJraFrozenSignalOutcomes(p).reason,'RESULT_RUNNER_INVALID');
 }
 assert.equal(evaluateJraFrozenSignalOutcomes({}).status,'EXCLUDED');
});
test('existing EARLY reader and official comparator feed the outcome evaluator with SELECT-only reads',async()=>{
 const p=input(),now=Date.parse('2026-10-10T03:00:00Z'),s=p.early.snapshot;
 const horses=p.signalSnapshot.horses.map(h=>({horseNo:h.horseNo,horseName:`馬${h.horseNo}`,
  abilityRank:h.horseNo,overall:80,win:20,place:40,predictedTime:'1:20.0'}));
 const data={schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:{date:'2026-10-10',racecourse:'東京',raceNo:1,postTime:'10:05'},horses};
 const DB={prepare(sql){assert.match(sql,/^SELECT\b/);return {bind(){return this},async first(){
  if(sql.includes('precomputed_race_snapshots'))return {organization:'JRA',race_id:raceId,revision:1,
   source_validated_at:'2026-10-10T00:00:00Z',data_calculated_at:s.dataCalculatedAt,
   calculation_version:s.calculationVersion,model_version:s.modelVersion,status:'PARTIAL',data_json:JSON.stringify(data)};
  return {organization:'JRA',race_date:'2026-10-10',track:'東京',race_no:1,fetched_at:'2026-10-10T02:00:00Z',
   payload_json:JSON.stringify({ok:true,organization:'JRA',source:'JRA_OFFICIAL',date:'2026-10-10',track:'東京',race:1,
    quality:{complete:true,finishOrderCount:3},finishOrder:[2,1,3],results:[2,1,3,4].map((horseNo,i)=>({horseNo,position:i+1}))})};
 }}}};
 p.early=await readJraEarlyResearchSnapshot({DB,raceId,now});
 p.officialComparison=await compareJraEarlyToOfficialResult({DB,raceId,now});
 assert.equal(p.early.status,'READY');assert.equal(p.officialComparison.status,'READY');
 const r=evaluateJraFrozenSignalOutcomes(p);
 assert.equal(r.status,'READY');assert.equal(r.observation.observedHorseCount,4);
});
