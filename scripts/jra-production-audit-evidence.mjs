import {createHash} from 'node:crypto';
import {JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION} from '../src/prediction/jra-early-research-reader.mjs';

const rejected=()=>Object.freeze({status:'REJECTED',reason:'INVALID_AUDIT_EVIDENCE',json:null,sha256:null});
const select=(value,keys)=>Object.fromEntries(keys.map(key=>[key,value?.[key]??null]));
const ordered=rows=>[...rows].sort((a,b)=>a.raceId.localeCompare(b.raceId));
const exclusions=rows=>ordered(rows).map(row=>select(row,['raceId','status','reason']));

function validPartition(result,cohort,kind){
 if(!['READY','EMPTY','BLOCKED','REJECTED'].includes(result?.status))return false;
 if(result.status!=='READY')return result.summary===null;
 const s=result.summary,rows=s?.[kind],excluded=s?.excluded;
 if(!Array.isArray(rows)||!Array.isArray(excluded))return false;
 const ids=[...rows,...excluded].map(row=>row?.raceId);
 return s.requestedRaceCount===cohort.length&&ids.length===cohort.length&&
  new Set(ids).size===ids.length&&ids.every(id=>cohort.includes(id))&&
  s.excludedRaceCount===excluded.length&&
  (kind==='included'?s.formalRaceCount:s.observedRaceCount)===rows.length;
}

// Safe, deterministic projection of already-read audit results. No D1, network or file operations.
// The digest checks exported content integrity; it does not prove Production provenance or readiness.
export function buildProductionJraAuditEvidence({report,kpi,shadow,commitSha=null}={}){
 const date=report?.targetDate,stamp=Date.parse(`${date}T00:00:00Z`),checked=Date.parse(report?.checkedAt);
 const cohort=report?.snapshotDataRaceIds;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(stamp)||
  new Date(stamp).toISOString().slice(0,10)!==date||!Number.isFinite(checked)||
  !Array.isArray(cohort)||cohort.length>24||new Set(cohort).size!==cohort.length||
  cohort.some(id=>typeof id!=='string'||!/^\d{8}-JRA-[^\r\n]+-(?:0[1-9]|1[0-2])$/.test(id)||
   !id.startsWith(date.replaceAll('-','')+'-JRA-'))||
  (commitSha!==null&&(typeof commitSha!=='string'||!/^[0-9a-f]{40}$/.test(commitSha)))||
  !validPartition(kpi,cohort,'included')||!validPartition(shadow,cohort,'observations'))return rejected();
 if(kpi.status==='READY'&&shadow.status==='READY'){
  const revisions=new Map(kpi.summary.included.map(row=>[row.raceId,row.earlyRevision]));
  if(shadow.summary.observations.some(row=>revisions.has(row.raceId)&&
   revisions.get(row.raceId)!==row.earlyRevision))return rejected();
 }
 const formal=kpi.status==='READY'?{
  ...select(kpi.summary,['requestedRaceCount','formalRaceCount','excludedRaceCount','matchedRunnerCount',
   'timeSampleCount','timeRaceCount','meanRaceWinBrier','meanRaceTop3Brier','meanRaceTimeMaeSeconds']),
  included:ordered(kpi.summary.included).map(row=>select(row,['raceId','earlyRevision','matchedRunnerCount','timeSampleCount'])),
  excluded:exclusions(kpi.summary.excluded)
 }:null;
 const research=shadow.status==='READY'?{
  ...select(shadow.summary,['requestedRaceCount','observedRaceCount','excludedRaceCount','winHits','top3Hits','winHitRate','top3HitRate']),
  observations:ordered(shadow.summary.observations).map(row=>select(row,['raceId','earlyRevision','horseNo','winHit','top3Hit'])),
  excluded:exclusions(shadow.summary.excluded)
 }:null;
 const evidence={schemaVersion:'CHASS-JRA-AUDIT-EVIDENCE-1',targetDate:date,
  checkedAt:new Date(checked).toISOString(),commitSha,
  calculationVersion:JRA_EARLY_CALCULATION_VERSION,modelVersion:JRA_EARLY_MODEL_VERSION,
  productionActivationReady:false,starFormalMarkAdopted:false,
  scope:'READ_ONLY_AUDIT_OBSERVATION',raceIds:[...cohort].sort(),
  preflight:select(report,['migration','schema','indexes','meeting','race','snapshotAudit']),
  formalKpi:{status:kpi.status,reason:kpi.reason??null,summary:formal},
  starResearch:{status:shadow.status,reason:shadow.reason??null,summary:research}};
 const json=JSON.stringify(evidence,null,2)+'\n';
 return Object.freeze({status:'READY',reason:null,json,sha256:createHash('sha256').update(json).digest('hex')});
}

export function productionAuditEvidenceLines(result){
 if(result.status!=='READY')return '## JRA audit evidence\n- Evidence: UNAVAILABLE\n- Production Activation Ready: NO\n';
 return `## JRA audit evidence\n- SHA-256 (UTF-8 JSON including final newline): ${result.sha256}\n- Digest checks exported content only; it does not certify Production readiness.\n\n\`\`\`json\n${result.json}\`\`\`\n`;
}
