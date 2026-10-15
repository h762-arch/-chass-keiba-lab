const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const inactive=h=>['scratched','excluded','withdrawn'].includes(h.runnerStatus||h.horseStatus);
const reasons=new Set(['time_missing_no_history','time_missing_no_same_surface','time_missing_parse','time_missing_unknown']);
// Bounded, market-independent projection; never copies raw upstream objects.
export function retainNarAbilityEvidence(h){
 const runs=Array.isArray(h.runs)?h.runs:null;
 return {schemaVersion:1,runCount:runs?.length??null,
  sameDistanceCount:runs?runs.filter(r=>r.sameDistance===true).length:null,
  sameTrackCount:runs?runs.filter(r=>r.sameTrack===true).length:null,
  recentIndices:Array.isArray(h.recentIndex)?h.recentIndex.slice(0,10).map(finite).filter(v=>v!==null):[],
  components:Object.fromEntries(['timeIndex','fiveRaceAvgIndex','distanceIndex','courseIndex'].map(k=>[k,finite(h[k])])),
  timeType:['実績','補正'].includes(h.predictedTimeType)?h.predictedTimeType:null,
  timeConfidence:finite(h.predictedTimeConfidence),
  timeMissingReason:h.predictedTime?null:reasons.has(h.predictedTimeMissingReason)?h.predictedTimeMissingReason:'TIME_REASON_UNAVAILABLE'};
}
export function auditNarAbilityEvidence(horses=[]){
 const active=horses.filter(h=>!inactive(h));
 const details=horses.map(h=>({horseNo:h.horseNo,active:!inactive(h),
  abilityStatus:finite(h.abilityScore)===null?'HOLD':'AVAILABLE',
  abilityReason:finite(h.abilityScore)!==null?null:h.evidence?.runCount===0?'NO_PARSED_HISTORY':h.evidence?.schemaVersion===1?'ABILITY_NOT_GENERATED':'EVIDENCE_NOT_RETAINED',
  timeStatus:h.predictedTime?'AVAILABLE':'HOLD',
  timeReason:h.predictedTime?null:h.evidence?.timeMissingReason||'EVIDENCE_NOT_RETAINED',
  evidenceStatus:h.evidence?.schemaVersion===1?'RETAINED':'NOT_RETAINED',
  probabilityStatus:'MODEL_HOLD',probabilityReason:'PROBABILITY_MODEL_NOT_CONNECTED'}));
 const activeDetails=details.filter(h=>h.active);
 return {schemaVersion:1,horseCount:horses.length,activeHorseCount:active.length,
  activeAbilityCount:activeDetails.filter(h=>h.abilityStatus==='AVAILABLE').length,
  activeTimeCount:activeDetails.filter(h=>h.timeStatus==='AVAILABLE').length,
  retainedEvidenceCount:details.filter(h=>h.evidenceStatus==='RETAINED').length,
  abilityComplete:active.length>=2&&activeDetails.every(h=>h.abilityStatus==='AVAILABLE'),
  probabilityStatus:'MODEL_HOLD',probabilityReason:'PROBABILITY_MODEL_NOT_CONNECTED',horses:details};
}
