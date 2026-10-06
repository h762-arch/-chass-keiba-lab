import {readJraStarShadowCohort} from '../src/research/jra-star-shadow-reader.mjs';
import {createProductionKpiDb} from './jra-production-kpi-reader.mjs';

const blocked=reason=>Object.freeze({status:'BLOCKED',reason,summary:null});

// Observe only the cohort already validated by preflight, using the existing exact SELECT allowlist.
// Shadow observations never authorize Activation or promote ☆ to a formal EARLY mark/KPI.
export async function auditProductionJraStarShadow(report,{execute,now=Date.now()}={}){
 if(report?.snapshotAudit==='EMPTY')return Object.freeze({status:'EMPTY',reason:'NO_V2_DATA',summary:null});
 if(report?.snapshotAudit!=='PASS'||!Array.isArray(report.snapshotDataRaceIds)||
  report.snapshotDataRaceIds.length<1||report.snapshotDataRaceIds.length>24)
  return blocked('V2_COHORT_NOT_VALIDATED');
 let readFailed=false;
 try{
  const DB=createProductionKpiDb(async sql=>{
   try{return await execute(sql);}catch{readFailed=true;throw Error('SHADOW_READ_FAILED');}
  });
  const result=await readJraStarShadowCohort({DB,raceIds:report.snapshotDataRaceIds,now});
  // Official comparison errors may be reduced to a generic exclusion by the pure shadow evaluator.
  // Retain the transport failure separately so a failed D1 SELECT can never appear as a healthy audit.
  if(readFailed||result.status!=='READY'||result.summary.excluded.some(row=>
   row.reason==='EARLY_D1_READ_FAILED'||row.reason==='OFFICIAL_COMPARISON_UNAVAILABLE'))
   return blocked('SHADOW_READ_OR_VALIDATION_FAILED');
  return result;
 }catch{return blocked('SHADOW_READ_OR_VALIDATION_FAILED');}
}

export function productionStarShadowSummaryLines(result){
 const lines=['## JRA ☆ candidate shadow research (READ-ONLY)',`- Shadow status: ${result.status}`,
  '- Research only: NOT a formal EARLY mark or formal KPI; NOT an Activation gate.'];
 if(result.status!=='READY')return [...lines,`- Reason: ${result.reason}`,
  '- Shadow hit rates: UNAVAILABLE'].join('\n')+'\n';
 const s=result.summary;
 return [...lines,`- Requested / observed / excluded races: ${s.requestedRaceCount} / ${s.observedRaceCount} / ${s.excludedRaceCount}`,
  `- Win / top3 hits: ${s.winHits} / ${s.top3Hits}`,
  `- Win / top3 hit rates (0–1): ${s.winHitRate??'N/A'} / ${s.top3HitRate??'N/A'}`,
  ...Object.entries(s.reasonCounts).sort(([a],[b])=>a.localeCompare(b)).map(([reason,count])=>`- Excluded ${reason}: ${count}`),
  '- Pending and excluded races are not counted as losses; zero observations keep rates unavailable.'].join('\n')+'\n';
}
