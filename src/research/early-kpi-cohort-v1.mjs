import {summarizeJraEarlyResultKpi} from './jra-early-kpi-summary.mjs';
import {jraEarlyIdentity,JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION} from '../prediction/jra-early-research-reader.mjs';

export const EARLY_KPI_COHORT_VERSION='CHASS_EARLY_KPI_COHORT_V1';
const NAR_TRACKS=new Set(['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀']);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
function narIdentity(id){
 if(typeof id!=='string')return false;
 const m=/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]\d?)$/.exec(id);
 if(!m||!NAR_TRACKS.has(m[2]))return false;
 const at=Date.parse(m[1]+'T00:00:00Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===m[1];
}
const common=()=>({version:EARLY_KPI_COHORT_VERSION,evidenceBasis:'CALLER_PROVIDED_DB_ROW_CONTRACT',
 sourceOriginAuthenticated:false,formalKpiReadiness:'HOLD',formalKpiEligible:false,
 probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
// Single bounded, SELECT-only research entry. No injected comparison/payload,
// public route, fetch, current-market requirement, repairs or fallback revision.
export async function summarizeEarlyEvidenceCohort({DB,targets,now=Date.now()}={}){
 if(!Number.isFinite(now)||!Array.isArray(targets)||!targets.length||targets.length>100
  ||targets.some(t=>!t||Array.isArray(t)||typeof t.raceId!=='string'||t.raceId.length>160
    ||Object.keys(t).some(k=>!['organization','raceId'].includes(k))
    ||(t.organization==='JRA'?!jraEarlyIdentity(t.raceId):t.organization==='NAR'?!narIdentity(t.raceId):true)))
  return freeze({...common(),status:'REJECTED',reason:'INVALID_COHORT',report:null});
 if(new Set(targets.map(t=>t.organization+'|'+t.raceId)).size!==targets.length)
  return freeze({...common(),status:'REJECTED',reason:'DUPLICATE_TARGET',report:null});
 const jra=targets.filter(t=>t.organization==='JRA').map(t=>t.raceId).sort(),nar=targets.filter(t=>t.organization==='NAR');
 const read=jra.length?await summarizeJraEarlyResultKpi({DB,raceIds:jra,now}):null;
 const s=read?.status==='READY'?read.summary:null;
 const included=s?.included||[],excluded=[...(s?.excluded||jra.map(raceId=>({raceId,status:'HOLD',reason:read?.reason||'EARLY_READ_UNAVAILABLE'}))),
  ...nar.map(t=>({raceId:t.raceId,status:'HOLD',reason:'NAR_AUTHENTICATED_OUTCOME_READER_NOT_WIRED'}))].sort((a,b)=>a.raceId.localeCompare(b.raceId));
 const reasonCounts={};for(const x of excluded)reasonCounts[x.reason]=(reasonCounts[x.reason]||0)+1;
 return freeze({...common(),status:'READ_COMPLETE',reason:null,report:{requestedRaceCount:targets.length,
  contractQualifiedRaceCount:included.length,heldRaceCount:excluded.length,reasonCounts,included,excluded,
  // Never combine JRA/NAR or race-/runner-weighted means.
  JRA:{requestedRaceCount:jra.length,contractQualifiedRaceCount:included.length,
   calculationVersion:JRA_EARLY_CALCULATION_VERSION,modelVersion:JRA_EARLY_MODEL_VERSION,
   metrics:s?{unit:'MEAN_OF_RACE_MEANS',meanRaceWinBrier:s.meanRaceWinBrier,meanRaceTop3Brier:s.meanRaceTop3Brier,
    meanRaceTimeMaeSeconds:s.meanRaceTimeMaeSeconds,matchedRunnerCount:s.matchedRunnerCount,
    timeSampleCount:s.timeSampleCount,timeRaceCount:s.timeRaceCount}:null},
  NAR:{requestedRaceCount:nar.length,contractQualifiedRaceCount:0,metrics:null,
   reason:'NAR_AUTHENTICATED_OUTCOME_READER_NOT_WIRED'}}});
}
