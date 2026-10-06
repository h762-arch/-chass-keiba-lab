import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeJraFrozenSignalOutcomes} from '../src/research/jra-signal-outcome-summary.mjs';
const policyVersion='CHASS-SIGNAL-v1.0';
function pair(no,mark='💎',{win=false,top3=true}={}){
 const raceId=`20261010-JRA-東京-${String(no).padStart(2,'0')}`,
  snapshot={raceId,revision:1,calculationVersion:'jra-ability-data-v2',modelVersion:'10.0.1-jra-drive1-ability',
   dataCalculatedAt:'2026-10-10T00:01:00Z',data:{race:{postTime:'10:05'}}};
 return {raceId,early:{status:'READY',snapshot},signalSnapshot:{schemaVersion:1,policyVersion,status:'frozen',
  frozenAt:'2026-10-10T00:02:00Z',horses:[{horseNo:1,valueMark:mark.startsWith('⚠')?'':mark,
  warningMark:mark.startsWith('⚠')?mark:'',abilityMarkAtFreeze:'',finalMarkAtFreeze:'',
  popularityAtFreeze:mark.startsWith('⚠')?1:9,oddsAtFreeze:20,evAtFreeze:120,
  longshotScenario:{policyVersion,level:mark==='💎'?'place':mark==='💎💎💎'?'big_win':'win',scenario:'想定着順のシナリオ',marketValue:true,
   evidence:[{code:'LAST3F',strength:2,label:'上がり能力'},{code:'TIME_TOP',strength:2,label:'TIME上位'}]},
  warningScenario:{policyVersion,targetBasis:'market_top3',scenario:'展開不利で4着以下',factors:[{code:'PACE_COLLAPSE',label:'展開不利'}]}}]},
 officialComparison:{status:'READY',comparison:{raceId,earlyRevision:1,calculationVersion:snapshot.calculationVersion,
 modelVersion:snapshot.modelVersion,earlyCalculatedAt:snapshot.dataCalculatedAt,resultFetchedAt:'2026-10-10T02:00:00Z',
 resultSource:'JRA_OFFICIAL',formalKpiEligible:true,postTimeStatus:'PRE_POST',runners:[{horseNo:1,matched:true,win,top3}]}}};
}
const group=(summary,mark)=>summary.groups.find(g=>g.mark===mark);

test('mark-specific denominators distinguish scenario hits, wins and top3 without KPI promotion',()=>{
 const s=summarizeJraFrozenSignalOutcomes([pair(1),pair(2,'💎',{win:true}),pair(3,'💎💎',{win:true}),
  pair(4,'💎💎💎',{top3:false}),pair(5,'⚠️⚠️',{top3:false})]).summary;
 const diamond=group(s,'💎');assert.equal(diamond.observedHorseCount,2);assert.equal(diamond.scenarioHits,1);
 assert.equal(diamond.scenarioHitRate,1/2);assert.equal(diamond.winHitRate,1/2);assert.equal(diamond.top3HitRate,2/2);
 assert.equal(group(s,'💎💎').scenarioHitRate,1);assert.equal(group(s,'💎💎💎').scenarioHitRate,0);
 assert.equal(group(s,'⚠️').scenarioHitRate,1);assert.equal(s.observedHorseCount,5);
 assert.equal(s.formalKpiEligible,false);assert.equal(s.productionActivationReady,false);assert.equal(s.rateUnit,'HORSE_SIGNAL');
});
test('two observed horse signals in one race are two samples and one observed race',()=>{
 const p=pair(1),h=structuredClone(p.signalSnapshot.horses[0]);h.horseNo=2;p.signalSnapshot.horses.push(h);
 p.officialComparison.comparison.runners.push({horseNo:2,matched:true,win:false,top3:false});
 const s=summarizeJraFrozenSignalOutcomes([p]).summary,g=group(s,'💎');
 assert.equal(s.observedRaceCount,1);assert.equal(g.observedRaceCount,1);assert.equal(g.observedHorseCount,2);
 assert.equal(g.scenarioHitRate,1/2);
});
test('pending results and invalid timing never become losses or zero-percent empty groups',()=>{
 const a=pair(1),b=pair(2),c=pair(3);a.officialComparison={status:'PENDING'};
 b.signalSnapshot.frozenAt='2026-10-10T02:00:00Z';c.officialComparison={status:'REJECTED'};
 const s=summarizeJraFrozenSignalOutcomes([a,b,c]).summary;
 assert.equal(s.excludedRaceCount,3);assert.equal(s.pendingRaceCount,1);assert.equal(s.observedHorseCount,0);
 for(const g of s.groups){assert.equal(g.scenarioHitRate,null);assert.equal(g.winHitRate,null);assert.equal(g.top3HitRate,null);}
 assert.equal(s.raceReasonCounts.OFFICIAL_RESULT_NOT_FOUND,1);assert.equal(s.excludedHorseCount,0);
});
test('partial race exclusions remove only unverified or unmatched horse signals from rates',()=>{
 const p=pair(1);for(let n=2;n<=4;n++){
  const h=structuredClone(p.signalSnapshot.horses[0]);h.horseNo=n;p.signalSnapshot.horses.push(h);
  p.officialComparison.comparison.runners.push({horseNo:n,matched:true,win:false,top3:false});
 }
 p.signalSnapshot.horses[1].popularityAtFreeze=5;delete p.signalSnapshot.horses[2].oddsAtFreeze;
 p.officialComparison.comparison.runners[3]={horseNo:4,matched:false,win:null,top3:null};
 const s=summarizeJraFrozenSignalOutcomes([p]).summary;
 assert.equal(s.auditedRaceCount,1);assert.equal(s.excludedRaceCount,0);assert.equal(s.excludedHorseCount,3);
 assert.equal(group(s,'💎').observedHorseCount,1);assert.equal(group(s,'💎').scenarioHitRate,1);
 assert.deepEqual(s.horseReasonCounts,{SIGNAL_VIOLATION:1,SIGNAL_UNVERIFIED:1,RESULT_RUNNER_UNMATCHED:1});
});
test('empty, oversized, malformed, non-JRA and duplicate cohorts fail closed',()=>{
 for(const pairs of [null,[],Array(101).fill(pair(1)),[{}],[{raceId:'20261010-NAR-大井-01'}]])
  assert.equal(summarizeJraFrozenSignalOutcomes(pairs).reason,'INVALID_COHORT');
 assert.equal(summarizeJraFrozenSignalOutcomes([pair(1),pair(1)]).reason,'DUPLICATE_RACE_ID');
});
test('output is deterministic and immutable without changing input snapshots',()=>{
 const pairs=[pair(2),pair(1)],before=JSON.stringify(pairs),r=summarizeJraFrozenSignalOutcomes(pairs);
 assert.equal(JSON.stringify(pairs),before);assert.deepEqual(r,summarizeJraFrozenSignalOutcomes([...pairs].reverse()));
 assert.ok(Object.isFrozen(r.summary.groups[0]));assert.ok(Object.isFrozen(r.summary.observations[0]));
 assert.ok(Object.isFrozen(r.summary.excludedHorses));
 const p=pair(3);p.signalSnapshot.horses[0].valueMark='';
 const s=summarizeJraFrozenSignalOutcomes([p]).summary;
 assert.equal(s.auditedRaceCount,1);assert.equal(s.observedRaceCount,0);assert.equal(s.observedHorseCount,0);
});
