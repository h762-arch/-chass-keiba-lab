import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {buildNarMaterialInvestigationPlan} from './nar-material-investigation-plan.mjs';

const flags={scope:'DECLARED_LOCAL_DIAGNOSTIC_CONSISTENCY_ONLY',researchOnly:true,formalKpiEligible:false,acquisitionCertified:false,currentStatusEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',diagnosisStatus:'NOT_ESTABLISHED',taskCompletion:'NOT_CLAIMED'};
const reasons=['EPISODE_AMBIGUOUS','EPISODE_LINK_UNMATCHED'];
const timeReasons=['UPSTREAM_NO_HISTORY','UPSTREAM_NO_SAME_SURFACE','UPSTREAM_PARSE_UNAVAILABLE','UPSTREAM_REASON_UNKNOWN','UPSTREAM_REASON_UNAVAILABLE'];
const n=(v,max=1000)=>Number.isInteger(v)&&v>=0&&v<=max;
const require=(ok,code)=>{if(!ok)throw Error(code);};
const tally=values=>{const r={};for(const v of values)r[v]=(r[v]||0)+1;return r;};
const reasonTally=values=>Object.fromEntries(reasons.map(k=>[k,values.filter(v=>v===k).length]));
function timeCondition(c){
 require(c?.status==='OBSERVED'&&c.scope==='RETAINED_FACTS_ONLY','TIME_CONDITIONS_UNAVAILABLE');
 require(n(c.targetDistance,3600)&&c.targetDistance>=800&&typeof c.coverageComplete==='boolean'&&n(c.retainedRunCount,5)&&(c.parsedRunCount===null||n(c.parsedRunCount)),'TIME_CONDITIONS_INVALID');
 for(const k of ['finiteTimeCount','exactFiniteTimeCount','within300mFiniteTimeCount','invalidDistanceCount','nonpositiveTimeCount'])require(n(c[k],c.retainedRunCount),'TIME_CONDITIONS_INVALID');
 require(c.exactFiniteTimeCount<=c.within300mFiniteTimeCount&&c.within300mFiniteTimeCount<=c.finiteTimeCount&&c.invalidDistanceCount<=c.finiteTimeCount&&c.nonpositiveTimeCount<=c.finiteTimeCount&&(!c.coverageComplete||c.parsedRunCount===c.retainedRunCount),'TIME_CONDITIONS_INVALID');
 const observed=!c.coverageComplete?'RETAINED_COVERAGE_INCOMPLETE':c.nonpositiveTimeCount?'NONPOSITIVE_TIME_RETAINED':c.exactFiniteTimeCount?'EXACT_TIME_CANDIDATE_PRESENT':c.within300mFiniteTimeCount?'NEAR_TIME_CANDIDATE_PRESENT':c.invalidDistanceCount?'DISTANCE_FACTS_UNAVAILABLE':c.finiteTimeCount?'NO_FINITE_TIME_WITHIN_300M':'NO_FINITE_TIME_RETAINED';
 require(c.observation===observed,'TIME_CONDITIONS_INVALID');return {observation:observed,coverageComplete:c.coverageComplete};
}
function historyCondition(c,history){
 require(c?.status==='OBSERVED'&&c.scope==='RETAINED_IDENTITY_LINKS_ONLY','HISTORY_CONDITIONS_UNAVAILABLE');
 require(Array.isArray(c.references)&&c.references.length===history.heldReferenceCount&&c.references.length<=5&&c.heldReferenceCount===c.references.length,'HISTORY_CONDITIONS_INVALID');
 const seen=new Set();
 for(const r of c.references){
  require(n(r?.episodeIndex,5)&&r.episodeIndex>0&&!seen.has(r.episodeIndex)&&reasons.includes(r.sourceReason)&&['NAR','JRA','OTHER','UNAVAILABLE'].includes(r.origin)&&typeof r.dateSupported==='boolean'&&typeof r.venueRecognized==='boolean','HISTORY_CONDITIONS_INVALID');seen.add(r.episodeIndex);
  for(const k of ['officialReferenceCount','sameMonthDayReferenceCount','sameVenueReferenceCount','dateVenueReferenceCount','eligibleCandidateCount','sameDateVenueEpisodeCount'])require(n(r[k],5),'HISTORY_CONDITIONS_INVALID');
  require(r.sameDateVenueEpisodeCount>=1&&r.sameMonthDayReferenceCount<=r.officialReferenceCount&&r.sameVenueReferenceCount<=r.officialReferenceCount&&r.dateVenueReferenceCount<=Math.min(r.sameMonthDayReferenceCount,r.sameVenueReferenceCount)&&r.eligibleCandidateCount===(r.origin==='NAR'?r.dateVenueReferenceCount:0),'HISTORY_CONDITIONS_INVALID');
  const observed=r.origin!=='NAR'?'ORIGIN_NOT_NAR':!r.dateSupported?'DATE_TEXT_UNSUPPORTED':!r.venueRecognized?'VENUE_NOT_RECOGNIZED':!r.officialReferenceCount?'NO_OFFICIAL_PAST_REFERENCES':!r.sameMonthDayReferenceCount?'NO_MONTH_DAY_MATCH':!r.sameVenueReferenceCount?'NO_VENUE_MATCH':!r.dateVenueReferenceCount?'DATE_VENUE_COMBINATION_UNMATCHED':r.dateVenueReferenceCount>1||r.sameDateVenueEpisodeCount>1?'MULTIPLE_CANDIDATES_OR_EPISODES':'MATCHING_CANDIDATE_PRESENT';
  require(r.observation===observed,'HISTORY_CONDITIONS_INVALID');
 }
 const observations=tally(c.references.map(r=>r.observation));require(isDeepStrictEqual(observations,c.observations)&&isDeepStrictEqual(reasonTally(c.references.map(r=>r.sourceReason)),history.reasonCounts),'HISTORY_CONDITIONS_INVALID');return observations;
}
function inspect(d,source){
 require(d?.schemaVersion===1&&d.status==='OBSERVED'&&d.detailScope==='AFFECTED_HORSES'&&d.researchOnly===true&&d.formalKpiEligible===false&&d.productionActivationReady===false&&d.probabilityStatus==='MODEL_HOLD','DIAGNOSTIC_UNAVAILABLE');
 const q=source.quality;require(q?.schemaVersion===1&&d.horseCount===source.horseCount&&d.activeHorseCount===q.activeHorseCount,'DIAGNOSTIC_COUNT_DRIFT');
 require(d.time?.status==='OBSERVED'&&d.time.unavailableActiveCount===0&&d.time.missingActiveCount===q.activeHorseCount-q.activeTimeCount&&d.time.observedMissingActiveCount===d.time.missingActiveCount&&d.history?.status==='OBSERVED'&&d.history.unavailableHorseCount===0&&d.history.heldReferenceCount===source.historyLinkAudit?.heldEpisodeCount,'DIAGNOSTIC_COUNT_DRIFT');
 require(Array.isArray(d.horses)&&d.horses.length<=source.horseCount&&d.displayedHorseCount===d.horses.length&&d.omittedUnaffectedHorseCount===source.horseCount-d.horses.length,'COMPACT_DETAIL_INVALID');
 const seen=new Set(),horses=[],missingReasons=[],heldReasons=[];let missing=0,held=0,shownActive=0;
 for(const h of d.horses){
  require(n(h?.horseNo,30)&&h.horseNo>0&&!seen.has(h.horseNo)&&typeof h.active==='boolean','HORSE_DIAGNOSTIC_INVALID');seen.add(h.horseNo);if(h.active)shownActive++;
  require(['AVAILABLE','MISSING','UNAVAILABLE'].includes(h.time?.status)&&!(h.active&&h.time.status==='UNAVAILABLE')&&h.history?.status==='OBSERVED'&&n(h.history.heldReferenceCount,5),'HORSE_DIAGNOSTIC_INVALID');
  require(h.time.status!=='AVAILABLE'||h.history.heldReferenceCount>0,'COMPACT_DETAIL_INVALID');
  require(reasons.every(k=>n(h.history.reasonCounts?.[k],5))&&Object.keys(h.history.reasonCounts).length===2&&reasons.reduce((s,k)=>s+h.history.reasonCounts[k],0)===h.history.heldReferenceCount,'HORSE_DIAGNOSTIC_INVALID');
  for(const k of reasons)for(let i=0;i<h.history.reasonCounts[k];i++)heldReasons.push(k);held+=h.history.heldReferenceCount;
  let time=null,history=null;
  if(h.active&&h.time.status==='MISSING'){require(timeReasons.includes(h.time.observation),'HORSE_DIAGNOSTIC_INVALID');missing++;missingReasons.push(h.time.observation);time={sourceObservation:h.time.observation,...timeCondition(h.conditions?.time)};}
  if(h.history.heldReferenceCount>0)history=historyCondition(h.conditions?.history,h.history);
  horses.push({horseNo:h.horseNo,active:h.active,time,history});
 }
 require(shownActive<=q.activeHorseCount&&d.horses.length-shownActive<=source.horseCount-q.activeHorseCount&&missing===d.time.missingActiveCount&&held===d.history.heldReferenceCount&&isDeepStrictEqual(tally(missingReasons),d.time.observations)&&isDeepStrictEqual(reasonTally(heldReasons),d.history.reasonCounts),'DIAGNOSTIC_COUNT_DRIFT');
 return {raceId:source.raceId,horses};
}
// Acceptance checks consistency only, never origin authentication or causal truth.
export function acceptNarMaterialDiagnostics(bundle,response,options={}){
 const hold=reason=>({...flags,status:'HOLD',reasonCodes:[reason],observations:[]});
 try{
  const plan=buildNarMaterialInvestigationPlan(bundle,options);
  require(['PLAN_READY','HISTORICAL_PLAN_READY'].includes(plan.status),'SOURCE_PLAN_HOLD');
  if(!plan.requests.length)return {...flags,status:'NO_DIAGNOSTIC_TASKS',reasonCodes:[],observations:[]};
  require(response?.ok===true&&response.date===plan.sourceReference.date&&response.schemaReady===true&&response.historyStoreSchemaReady===true&&response.researchOnly===true&&response.formalKpiEligible===false&&response.productionActivationReady===false&&response.format==='compact'&&response.countScope==='DATE'&&response.raceDetailScope==='ALL_RESTORED_RACES'&&response.selectedRaceNo===null,'RESPONSE_CONTRACT_INVALID');
  const original=bundle.snapshot.payload;
  require(response.savedRaceCount===original.savedRaceCount&&response.rejectedRowCount===original.rejectedRowCount&&Array.isArray(response.races)&&response.races.length===original.races.length,'RESPONSE_ROW_DRIFT');
  const seen=new Map();for(const r of response.races){require(typeof r?.raceId==='string'&&!seen.has(r.raceId),'RESPONSE_ROW_DRIFT');seen.set(r.raceId,r);}
  for(const r of original.races)require(isDeepStrictEqual(r,seen.get(r.raceId)),'RESPONSE_ROW_DRIFT');
  const s=response.qualityDiagnostics;require(s?.schemaVersion===1&&s.detailScope==='AFFECTED_HORSES'&&['OBSERVED','PARTIAL'].includes(s.status)&&Array.isArray(s.races)&&s.races.length===original.races.length,'SIDECAR_CONTRACT_INVALID');
  const diagnostics=new Map();for(const r of s.races){require(seen.has(r?.raceId)&&!diagnostics.has(r.raceId)&&['OBSERVED','PARTIAL','UNAVAILABLE'].includes(r.diagnostics?.status),'SIDECAR_CONTRACT_INVALID');diagnostics.set(r.raceId,r.diagnostics);}
  require(s.status===(s.races.every(r=>r.diagnostics.status==='OBSERVED')?'OBSERVED':'PARTIAL'),'SIDECAR_CONTRACT_INVALID');
  const observations=plan.requests[0].expectedRaceIds.map(id=>inspect(diagnostics.get(id),seen.get(id)));
  return {...flags,status:plan.sourceUsageMode==='HISTORICAL'?'HISTORICAL_INSPECTION_READY':'INSPECTION_READY',reasonCodes:[...plan.reasonCodes],sourceReference:plan.sourceReference,sourceMirrorDecision:plan.sourceMirrorDecision,sourceFreshnessStatus:plan.sourceFreshnessStatus,diagnosticProvenance:'DECLARED_LOCAL_JSON_NOT_AUTHENTICATED',responseSha256:createHash('sha256').update(JSON.stringify(response)).digest('hex'),acceptedRaceCount:observations.length,observations,formalReadiness:'NOT_EVALUATED'};
 }catch(e){const allowed=['TIME_CONDITIONS_UNAVAILABLE','TIME_CONDITIONS_INVALID','HISTORY_CONDITIONS_UNAVAILABLE','HISTORY_CONDITIONS_INVALID','DIAGNOSTIC_UNAVAILABLE','DIAGNOSTIC_COUNT_DRIFT','COMPACT_DETAIL_INVALID','HORSE_DIAGNOSTIC_INVALID','SOURCE_PLAN_HOLD','RESPONSE_CONTRACT_INVALID','RESPONSE_ROW_DRIFT','SIDECAR_CONTRACT_INVALID'];return hold(allowed.includes(e?.message)?e.message:'ACCEPTANCE_INPUT_UNREADABLE');}
}
