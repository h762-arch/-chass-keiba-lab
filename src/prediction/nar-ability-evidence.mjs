const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const inactive=h=>['scratched','excluded','withdrawn'].includes(h.runnerStatus||h.horseStatus);
const reasons=new Set(['time_missing_no_history','time_missing_no_same_surface','time_missing_parse','time_missing_unknown']);
const historyHoldReasons=['EPISODE_AMBIGUOUS','EPISODE_LINK_UNMATCHED'];
const historyHoldReasonSet=new Set(historyHoldReasons);
const boundedCount=v=>Number.isSafeInteger(v)&&v>=0&&v<=1000?v:null;
const missingTimeDiagnostic=h=>{
 if(h.predictedTime)return null;
 const e=h.evidence?.schemaVersion===1?h.evidence:null,empty={runCount:null,sameDistanceCount:null,sameTrackCount:null};
 if(!e)return {status:'UNAVAILABLE',sourceReason:null,observation:'EVIDENCE_NOT_RETAINED',...empty};
 const runCount=boundedCount(e.runCount),sameDistanceCount=boundedCount(e.sameDistanceCount),sameTrackCount=boundedCount(e.sameTrackCount),sourceReason=reasons.has(e.timeMissingReason)?e.timeMissingReason:e.timeMissingReason==='TIME_REASON_UNAVAILABLE'?'TIME_REASON_UNAVAILABLE':null;
 let observation='UPSTREAM_REASON_UNAVAILABLE';
 if(sourceReason==='time_missing_no_history')observation='UPSTREAM_NO_HISTORY';
 else if(sourceReason==='time_missing_no_same_surface')observation='UPSTREAM_NO_SAME_SURFACE';
 else if(sourceReason==='time_missing_parse')observation='UPSTREAM_PARSE_UNAVAILABLE';
 else if(sourceReason==='time_missing_unknown'){
  if(runCount===0)observation='NO_PARSED_HISTORY';
  else if(runCount===null||sameDistanceCount===null||sameTrackCount===null)observation='RETAINED_COUNTS_UNAVAILABLE';
  else if(sameDistanceCount===0)observation='NO_SAME_DISTANCE_EVIDENCE';
  else if(sameTrackCount===0)observation='NO_SAME_TRACK_EVIDENCE';
  else observation='RETAINED_EVIDENCE_PRESENT';
 }
 return {status:'OBSERVED',sourceReason,observation,runCount,sameDistanceCount,sameTrackCount};
};
const historyIdentityDiagnostic=h=>{
 const refs=h?.history?.body?.identity?.references;
 if(!Array.isArray(refs)||refs.length>100)return {status:'UNAVAILABLE',heldReferenceCount:null,reasonCounts:null};
 const reasonCounts=Object.fromEntries(historyHoldReasons.map(reason=>[reason,0]));let held=0;
 for(const ref of refs){
  if(ref?.status==='RESOLVED')continue;
  if(ref?.status!=='HOLD'||!historyHoldReasonSet.has(ref?.reasonCode))return {status:'UNAVAILABLE',heldReferenceCount:null,reasonCounts:null};
  held++;reasonCounts[ref.reasonCode]++;
 }
 return {status:'OBSERVED',heldReferenceCount:held,reasonCounts};
};
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
 const details=horses.map(h=>{const timeDiagnostic=missingTimeDiagnostic(h),historyDiagnostic=historyIdentityDiagnostic(h);return {horseNo:h.horseNo,active:!inactive(h),
  abilityStatus:finite(h.abilityScore)===null?'HOLD':'AVAILABLE',
  abilityReason:finite(h.abilityScore)!==null?null:h.evidence?.runCount===0?'NO_PARSED_HISTORY':h.evidence?.schemaVersion===1?'ABILITY_NOT_GENERATED':'EVIDENCE_NOT_RETAINED',
  timeStatus:h.predictedTime?'AVAILABLE':'HOLD',
  timeReason:h.predictedTime?null:h.evidence?.timeMissingReason||'EVIDENCE_NOT_RETAINED',timeDiagnostic,
  evidenceStatus:h.evidence?.schemaVersion===1?'RETAINED':'NOT_RETAINED',historyIdentityDiagnostic:historyDiagnostic,
  probabilityStatus:'MODEL_HOLD',probabilityReason:'PROBABILITY_MODEL_NOT_CONNECTED'};});
 const activeDetails=details.filter(h=>h.active),timeDiagnosticCounts={};
 for(const h of activeDetails)if(h.timeDiagnostic)timeDiagnosticCounts[h.timeDiagnostic.observation]=(timeDiagnosticCounts[h.timeDiagnostic.observation]||0)+1;
 const historyObserved=details.filter(h=>h.historyIdentityDiagnostic.status==='OBSERVED'),historyUnavailable=details.length-historyObserved.length,historyCounts=Object.fromEntries(historyHoldReasons.map(reason=>[reason,historyObserved.reduce((n,h)=>n+h.historyIdentityDiagnostic.reasonCounts[reason],0)])),historyHeld=historyObserved.reduce((n,h)=>n+h.historyIdentityDiagnostic.heldReferenceCount,0),historyStatus=historyUnavailable===0?'OBSERVED':historyObserved.length?'PARTIAL':'UNAVAILABLE';
 return {schemaVersion:1,horseCount:horses.length,activeHorseCount:active.length,
  activeAbilityCount:activeDetails.filter(h=>h.abilityStatus==='AVAILABLE').length,
  activeTimeCount:activeDetails.filter(h=>h.timeStatus==='AVAILABLE').length,
  retainedEvidenceCount:details.filter(h=>h.evidenceStatus==='RETAINED').length,
  abilityComplete:active.length>=2&&activeDetails.every(h=>h.abilityStatus==='AVAILABLE'),
  timeDiagnosticSummary:{missingActiveCount:activeDetails.filter(h=>h.timeStatus==='HOLD').length,observations:timeDiagnosticCounts},
  historyIdentityDiagnostic:{status:historyStatus,heldReferenceCount:historyStatus==='OBSERVED'?historyHeld:null,unavailableHorseCount:historyUnavailable,reasonCounts:historyStatus==='OBSERVED'?historyCounts:null},
  probabilityStatus:'MODEL_HOLD',probabilityReason:'PROBABILITY_MODEL_NOT_CONNECTED',horses:details};
}
