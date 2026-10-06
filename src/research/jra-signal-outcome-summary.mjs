import {evaluateJraFrozenSignalOutcomes} from './jra-signal-outcomes.mjs';
import {isFrozenSignalRaceId} from './signal-rule-cohort-audit.mjs';
const rejected=reason=>Object.freeze({status:'REJECTED',reason,summary:null});
const markGroups=[['💎','SECOND_OR_THIRD'],['💎💎','WIN'],['💎💎💎','WIN'],['⚠️','FOURTH_OR_WORSE']];

// Explicit, bounded research cohort. Rates count observed horse signals, never pending/excluded inputs.
// No formal KPI adoption, market substitution, persistence, network, flag or scheduler changes.
export function summarizeJraFrozenSignalOutcomes(pairs){
 if(!Array.isArray(pairs)||pairs.length<1||pairs.length>100||
  pairs.some(p=>!isFrozenSignalRaceId(p?.raceId)||!p.raceId.includes('-JRA-')))
  return rejected('INVALID_COHORT');
 if(new Set(pairs.map(p=>p.raceId)).size!==pairs.length)return rejected('DUPLICATE_RACE_ID');
 const observations=[],excludedHorses=[],excludedRaces=[],raceReasonCounts={},horseReasonCounts={};
 let auditedRaceCount=0,observedRaceCount=0;
 for(const pair of [...pairs].sort((a,b)=>a.raceId.localeCompare(b.raceId))){
  const result=evaluateJraFrozenSignalOutcomes(pair);
  if(result.status!=='READY'){
   excludedRaces.push(Object.freeze({raceId:pair.raceId,status:result.status,reason:result.reason}));
   raceReasonCounts[result.reason]=(raceReasonCounts[result.reason]??0)+1;continue;
  }
  auditedRaceCount++;
  const o=result.observation;
  if(o.observedHorseCount)observedRaceCount++;
  for(const horse of o.observations)observations.push(Object.freeze({raceId:pair.raceId,...horse}));
  for(const horse of o.excluded){
   excludedHorses.push(Object.freeze({raceId:pair.raceId,...horse}));
   horseReasonCounts[horse.reason]=(horseReasonCounts[horse.reason]??0)+1;
  }
 }
 const groups=markGroups.map(([mark,target])=>{
  const rows=observations.filter(h=>(h.target==='FOURTH_OR_WORSE'?'⚠️':h.mark)===mark),
   count=rows.length,scenarioHits=rows.filter(h=>h.hit).length,
   winHits=rows.filter(h=>h.win).length,top3Hits=rows.filter(h=>h.top3).length;
  return Object.freeze({mark,target,observedHorseCount:count,observedRaceCount:new Set(rows.map(h=>h.raceId)).size,
   scenarioHits,scenarioHitRate:count?scenarioHits/count:null,winHits,winHitRate:count?winHits/count:null,
   top3Hits,top3HitRate:count?top3Hits/count:null});
 });
 return Object.freeze({status:'READY',reason:null,summary:Object.freeze({mode:'research',
  predictionStage:'SIGNAL_FREEZE',formalKpiEligible:false,productionActivationReady:false,
  scenarioQuality:'NOT_EVALUATED',rateUnit:'HORSE_SIGNAL',requestedRaceCount:pairs.length,
  auditedRaceCount,observedRaceCount,excludedRaceCount:excludedRaces.length,
  pendingRaceCount:excludedRaces.filter(r=>r.status==='PENDING').length,
  observedHorseCount:observations.length,excludedHorseCount:excludedHorses.length,
  groups:Object.freeze(groups),raceReasonCounts:Object.freeze(raceReasonCounts),horseReasonCounts:Object.freeze(horseReasonCounts),
  observations:Object.freeze(observations),excludedHorses:Object.freeze(excludedHorses),excludedRaces:Object.freeze(excludedRaces)
 })});
}
