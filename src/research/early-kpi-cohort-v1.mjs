import {summarizeJraEarlyResultKpi} from './jra-early-kpi-summary.mjs';
import {readNarEarlyOutcome} from './nar-early-outcome-reader-v1.mjs';
import {jraEarlyIdentity,JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION} from '../prediction/jra-early-research-reader.mjs';

export const EARLY_KPI_COHORT_VERSION='CHASS_EARLY_KPI_COHORT_V1';
export const EARLY_MODEL_COHORT_BOUNDARY_VERSION='CHASS_EARLY_MODEL_COHORT_BOUNDARY_V1';
const NAR_TRACKS=new Set(['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀']);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function narIdentity(id){
 if(typeof id!=='string')return false;
 const m=/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]\d?)$/.exec(id);
 if(!m||!NAR_TRACKS.has(m[2]))return false;
 const at=Date.parse(m[1]+'T00:00:00Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===m[1];
}
const common=()=>({version:EARLY_KPI_COHORT_VERSION,modelBoundaryVersion:EARLY_MODEL_COHORT_BOUNDARY_VERSION,evidenceBasis:'CALLER_PROVIDED_DB_ROW_CONTRACT',
 sourceOriginAuthenticated:false,formalKpiReadiness:'HOLD',formalKpiEligible:false,
 probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
const average=xs=>xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(6)):null;
function narMetrics(rows){return {unit:'MEAN_OF_RACE_MEANS',meanRaceWinBrier:average(rows.map(r=>r.winBrier)),
 meanRaceTop3Brier:average(rows.map(r=>r.top3Brier)),meanRaceTimeMaeSeconds:average(rows.filter(r=>r.timeMaeSeconds!==null).map(r=>r.timeMaeSeconds)),
 matchedRunnerCount:rows.reduce((n,r)=>n+r.matchedRunnerCount,0),timeSampleCount:rows.reduce((n,r)=>n+r.timeSampleCount,0),
 timeRaceCount:rows.filter(r=>r.timeMaeSeconds!==null).length};}
function narModels(rows){
 const groups=new Map();for(const row of rows){if(!groups.has(row.modelVersion))groups.set(row.modelVersion,[]);groups.get(row.modelVersion).push(row);}
 return [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([modelVersion,items])=>({modelVersion,contractQualifiedRaceCount:items.length,
  eligibilityBasis:'STORED_ROW_CONTRACT_ONLY',formalKpiEligible:false,sourceOriginAuthenticated:false,
  formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',metrics:narMetrics(items)}));
}
// Single bounded, SELECT-only research entry. No injected comparison/payload,
// public route, fetch, current-market requirement, repairs or fallback revision.
export function earlyEvidenceCohortRejection(targets,now){
 if(!Number.isFinite(now)||!Array.isArray(targets)||!targets.length||targets.length>100
  ||targets.some(t=>!t||Array.isArray(t)||typeof t.raceId!=='string'||t.raceId.length>160
    ||Object.keys(t).some(k=>!['organization','raceId'].includes(k))
    ||(t.organization==='JRA'?!jraEarlyIdentity(t.raceId):t.organization==='NAR'?!narIdentity(t.raceId):true)))
  return 'INVALID_COHORT';
 if(new Set(targets.map(t=>t.organization+'|'+t.raceId)).size!==targets.length)
  return 'DUPLICATE_TARGET';
 return null;
}
export async function summarizeEarlyEvidenceCohort({DB,targets,now=Date.now()}={}){
 const reason=earlyEvidenceCohortRejection(targets,now);
 if(reason)return freeze({...common(),status:'REJECTED',reason,report:null});
 const jra=targets.filter(t=>t.organization==='JRA').map(t=>t.raceId).sort(),nar=targets.filter(t=>t.organization==='NAR').sort((a,b)=>a.raceId.localeCompare(b.raceId));
 const read=jra.length?await summarizeJraEarlyResultKpi({DB,raceIds:jra,now}):null;
 const s=read?.status==='READY'?read.summary:null;
 const narIncluded=[],narExcluded=[];
 for(const t of nar){
  const r=await readNarEarlyOutcome({DB,raceId:t.raceId,now});
  if(r.status==='READY'&&r.comparison?.rowContractQualified===true)narIncluded.push(r.comparison);
  else narExcluded.push({raceId:t.raceId,status:r.status,reason:r.reason});
 }
 const jraIncluded=s?.included||[],included=[...jraIncluded,...narIncluded].sort((a,b)=>a.raceId.localeCompare(b.raceId));
 const excluded=[...(s?.excluded||jra.map(raceId=>({raceId,status:'HOLD',reason:read?.reason||'EARLY_READ_UNAVAILABLE'}))),
  ...narExcluded].sort((a,b)=>a.raceId.localeCompare(b.raceId));
 const models=narModels(narIncluded);
 const reasonCounts={};for(const x of excluded)reasonCounts[x.reason]=(reasonCounts[x.reason]||0)+1;
 return freeze({...common(),status:'READ_COMPLETE',reason:null,report:{modelBoundaryVersion:EARLY_MODEL_COHORT_BOUNDARY_VERSION,requestedRaceCount:targets.length,
  contractQualifiedRaceCount:included.length,heldRaceCount:excluded.length,reasonCounts,included,excluded,
  // Never combine JRA/NAR or race-/runner-weighted means.
  JRA:{requestedRaceCount:jra.length,contractQualifiedRaceCount:jraIncluded.length,
   calculationVersion:JRA_EARLY_CALCULATION_VERSION,modelVersion:JRA_EARLY_MODEL_VERSION,modelScope:'FIXED_MODEL_VERSION',
   metrics:s?{unit:'MEAN_OF_RACE_MEANS',meanRaceWinBrier:s.meanRaceWinBrier,meanRaceTop3Brier:s.meanRaceTop3Brier,
    meanRaceTimeMaeSeconds:s.meanRaceTimeMaeSeconds,matchedRunnerCount:s.matchedRunnerCount,
    timeSampleCount:s.timeSampleCount,timeRaceCount:s.timeRaceCount}:null},
  NAR:{requestedRaceCount:nar.length,contractQualifiedRaceCount:narIncluded.length,
   modelScope:models.length>1?'MULTIPLE_MODEL_VERSIONS_SEPARATED':models.length===1?'SINGLE_MODEL_VERSION':'NO_QUALIFIED_MODEL',models,
   mixedModelAggregateWithheld:models.length>1,metrics:models.length===1?models[0].metrics:null,
   reason:'STORED_ROW_CONTRACT_ONLY_SOURCE_AND_DURABLE_TIME_UNAUTHENTICATED'}}});
}
