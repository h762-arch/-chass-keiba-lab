import {summarizeJraEarlyResultKpi} from '../src/research/jra-early-kpi-summary.mjs';

const SNAPSHOT_SQL=`SELECT organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND calculation_version=? AND model_version=? AND data_json IS NOT NULL AND data_json<>'' ORDER BY revision ASC LIMIT 1`;
const RESULT_SQL=`SELECT organization,race_date,track,race_no,payload_json,fetched_at FROM jra_official_cache WHERE kind='result' AND cache_key=?`;
const normalize=sql=>String(sql).replace(/\s+/g,' ').trim();
const quoted=value=>`'${value.replaceAll("'","''")}'`;

// Match the two imported readers' complete SELECT templates before binding values.
// The remote D1 CLI receives only these SELECT statements, never arbitrary SQL.
export function createProductionKpiDb(execute){
 return Object.freeze({prepare(sql){
  const template=normalize(sql);
  const kind=template===SNAPSHOT_SQL?'snapshot':template===RESULT_SQL?'result':null;
  if(!kind)throw new Error('KPI_QUERY_NOT_ALLOWED');
  return Object.freeze({bind(...values){
   if(!values.every(value=>typeof value==='string'))throw new Error('KPI_BIND_INVALID');
   if(kind==='snapshot'&&(values.length!==4||values[0]!=='JRA'||
    !/^\d{8}-JRA-[^-]+-\d{2}$/.test(values[1])||
    values[2]!=='jra-ability-data-v2'||values[3]!=='10.0.1-jra-drive1-ability'))
    throw new Error('KPI_BIND_INVALID');
   if(kind==='result'&&(values.length!==1||
    !/^result\|\d{4}-\d{2}-\d{2}\|[^|]+\|(?:[1-9]|1[0-2])$/.test(values[0])))
    throw new Error('KPI_BIND_INVALID');
   let index=0;
   const command=template.replace(/\?/g,()=>quoted(values[index++]));
   if(index!==values.length)throw new Error('KPI_BIND_INVALID');
   return Object.freeze({async first(){
    const rows=await execute(command);
    if(!Array.isArray(rows)||rows.length>1)throw new Error('KPI_QUERY_RESULT_INVALID');
    return rows[0]??null;
   }});
  }});
 }});
}

export async function auditProductionJraEarlyKpi(report,{execute,now=Date.now()}={}){
 if(report?.snapshotAudit==='EMPTY')return Object.freeze({status:'EMPTY',reason:'NO_V2_DATA',summary:null});
 if(report?.snapshotAudit!=='PASS'||!Array.isArray(report.snapshotDataRaceIds)||
  report.snapshotDataRaceIds.length<1||report.snapshotDataRaceIds.length>24)
  return Object.freeze({status:'BLOCKED',reason:'V2_COHORT_NOT_VALIDATED',summary:null});
 try{
  const result=await summarizeJraEarlyResultKpi({DB:createProductionKpiDb(execute),
   raceIds:report.snapshotDataRaceIds,now});
  if(result.status!=='READY'||result.summary.excluded.some(item=>
   item.reason==='EARLY_D1_READ_FAILED'||item.reason==='RESULT_READ_FAILED'))
   return Object.freeze({status:'BLOCKED',reason:'KPI_READ_FAILED',summary:null});
  return result;
 }catch{return Object.freeze({status:'BLOCKED',reason:'KPI_READ_FAILED',summary:null});}
}

export function productionKpiSummaryLines(result){
 const lines=['## Frozen JRA EARLY → official result KPI (READ-ONLY)',`- KPI status: ${result.status}`];
 if(result.status!=='READY')return [...lines,`- Reason: ${result.reason}`,
  '- Formal KPI values: UNAVAILABLE'].join('\n')+'\n';
 const s=result.summary;
 return [...lines,`- Requested / formal / excluded races: ${s.requestedRaceCount} / ${s.formalRaceCount} / ${s.excludedRaceCount}`,
  `- Matched runners / TIME samples: ${s.matchedRunnerCount} / ${s.timeSampleCount}`,
  `- Mean race win Brier / top3 Brier: ${s.meanRaceWinBrier??'N/A'} / ${s.meanRaceTop3Brier??'N/A'}`,
  `- Mean race TIME MAE seconds / sampled races: ${s.meanRaceTimeMaeSeconds??'N/A'} / ${s.timeRaceCount}`,
  ...Object.entries(s.reasonCounts).sort(([a],[b])=>a.localeCompare(b)).map(([reason,count])=>`- Excluded ${reason}: ${count}`),
  '- Means are per-race; excluded races and missing TIME samples are not zero-filled.'].join('\n')+'\n';
}
