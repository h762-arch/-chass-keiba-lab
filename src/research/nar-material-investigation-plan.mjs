import {reportNarStatusCoverage} from './nar-status-coverage-report.mjs';
import {narStatusSourceUrl} from './nar-status-mirror-audit.mjs';

const flags={scope:'SAVED_MATERIAL_INVESTIGATION_PLAN_ONLY',sourceReferenceBasis:'DECLARED_LOCAL_BUNDLE',researchOnly:true,formalKpiEligible:false,acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',executionStatus:'NOT_EXECUTED',automaticExecutionAllowed:false};
const task=(kind,input,observed,requiredEvidence)=>({kind,input,observed,requiredEvidence,diagnosisStatus:'NOT_ESTABLISHED'});

// Derive review tasks from a newly validated raw bundle, never a caller's report.
// No fetch, DB, model, scheduler or saved-DATA mutation port exists.
export function buildNarMaterialInvestigationPlan(bundle,options={}){
 const hold=(reasonCodes,coverage=null)=>({...flags,status:'HOLD',reasonCodes,sourceCoverage:coverage,requests:[],races:[]});
 try{
  const coverage=reportNarStatusCoverage(bundle,options);
  if(!['OBSERVED','HISTORICAL_OBSERVED'].includes(coverage.status))return hold(['SOURCE_COVERAGE_HOLD'],coverage);
  const sourceRows=new Map(bundle.snapshot.payload.races.map(r=>[r.raceId,r])),races=[],diagnosticRaceIds=[];
  for(const r of coverage.rows){
   const tasks=[];
   if(r.activeAbilityMissing===null||r.activeAbilityMissing>0)tasks.push(task('REVIEW_ABILITY_SOURCE','VERIFIED_SAVED_DATA_OR_PACK',{activeAbilityMissing:r.activeAbilityMissing},['ACTIVE_RUNNER_IDENTITIES','RETAINED_ABILITY_EVIDENCE','MISSING_SCORE_REASON']));
   if(r.activeTimeMissing===null||r.activeTimeMissing>0)tasks.push(task('REVIEW_TIME_CONDITIONS','SAVED_STATUS_DIAGNOSTICS',{activeTimeMissing:r.activeTimeMissing},['ACTIVE_RUNNER_COVERAGE','TIME_SOURCE_REASON','RETAINED_TIME_CANDIDATES','RETAINED_HISTORY_COVERAGE']));
   const history={linkHeldReferences:r.linkHeldReferences,storeHeldEpisodes:r.storeHeldEpisodes,storeUnresolvedObservations:r.storeUnresolvedObservations};
   if(Object.values(history).some(v=>v===null||v>0))tasks.push(task('REVIEW_HISTORY_MATCH_CONDITIONS','SAVED_STATUS_DIAGNOSTICS',history,['HELD_REFERENCE_REASONS','RETAINED_MATCH_CONDITIONS','ROLLING_STORE_AUDIT_IF_NOT_EXPLAINED']));
   if(r.packStatus!=='PARTIAL')tasks.push(task('REVIEW_PACK_AVAILABILITY','VERIFIED_SAVED_DATA_OR_PACK',{packStatus:r.packStatus},['RECORDED_PACK_CONTRACT_OR_ABSENCE','PARENT_DATA_IDENTITY_AND_HASH']));
   if(!tasks.length)continue;
   const raw=sourceRows.get(r.raceId),packHash=typeof raw.preAnalysisPackHash==='string'&&/^[a-f0-9]{64}$/.test(raw.preAnalysisPackHash)?raw.preAnalysisPackHash:null;
   races.push({raceId:r.raceId,track:r.track,raceNo:r.raceNo,sourcePackHash:packHash,packHashVerification:'NOT_PERFORMED_BY_THIS_PLAN',tasks});
   if(tasks.some(t=>t.input==='SAVED_STATUS_DIAGNOSTICS'))diagnosticRaceIds.push(r.raceId);
  }
  // The public race filter rejects multiple venues sharing a race number.
  // One unfiltered date read avoids both ambiguity and repeated full diagnostics.
  const requests=diagnosticRaceIds.length?[{id:'DATE_STATUS_DIAGNOSTICS',method:'GET',url:narStatusSourceUrl(coverage.mirrorAudit.date)+'&diagnostics=1',executionStatus:'NOT_EXECUTED',responseScope:'ALL_RESTORED_RACES_AFFECTED_HORSES',expectedRaceIds:diagnosticRaceIds,responseAcceptanceRequirements:['MATCH_REQUEST_DATE_AND_EXPECTED_RACE_IDS','COMPARE_CAPTURED_COUNTS_AND_PACK_HASH_WHEN_PRESENT','VERIFY_DIAGNOSTICS_SCHEMA_AND_DETAIL_SCOPE','HOLD_ON_DRIFT_OR_UNAVAILABLE'],limitation:'History store or ability/Pack details may require separately verified saved DATA; status diagnostics alone may not explain the gap.'}]:[];
  return {...flags,status:coverage.usageMode==='HISTORICAL'?'HISTORICAL_PLAN_READY':'PLAN_READY',reasonCodes:[...coverage.reasonCodes],sourceUsageMode:coverage.usageMode,sourceCurrentStatusEligible:coverage.currentStatusEligible,sourceFreshnessStatus:coverage.freshnessStatus,sourceReference:{date:coverage.mirrorAudit.date,commitSha:coverage.mirrorAudit.commitSha,capturedAt:coverage.mirrorAudit.observed.capturedAt,auditedAt:coverage.mirrorAudit.auditedAt,payloadSha256:bundle.snapshot.payloadSha256},sourceMirrorDecision:coverage.mirrorAudit.status,sourceMirrorReasons:[...coverage.mirrorAudit.reasonCodes],savedRaceCount:coverage.raceCount,investigationRaceCount:races.length,taskCount:races.reduce((n,r)=>n+r.tasks.length,0),ordering:'RACE_ID_NOT_PREDICTIVE_PRIORITY',historyCounterOverlap:'UNKNOWN_DO_NOT_ADD',requests,races,formalReadiness:'NOT_EVALUATED'};
 }catch{return hold(['INVESTIGATION_INPUT_UNREADABLE']);}
}
