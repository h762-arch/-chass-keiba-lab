export const NAR_INDEX_ANALYSIS_VERSION='NAR_COMPONENT_INDEX_SCAN_V1';
const fields=['timeIndex','fiveRaceAvgIndex','distanceIndex','courseIndex'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
// Descriptive projection of existing derived components, not the Drive Index Master.
export function analyzeNarIndexComponents(horses){
 const active=horses.filter(h=>h.runnerStatus==='active'),universe=horses.filter(h=>!['scratched','excluded','withdrawn'].includes(h.runnerStatus));
 const columns=fields.map(field=>{
  const known=active.filter(h=>h.evidence?.schemaVersion===1&&finite(h.evidence.components?.[field])).map(h=>({horseNo:h.horseNo,value:h.evidence.components[field]})).sort((a,b)=>b.value-a.value||a.horseNo-b.horseNo);
  const n=known.length,values=known.map(h=>h.value),ascending=values.slice().sort((a,b)=>a-b),median=n?n%2?ascending[Math.floor(n/2)]:(ascending[n/2-1]+ascending[n/2])/2:null;
  const measured=new Map(known.map((h,i)=>{const rank=1+known.filter(x=>x.value>h.value).length;return [h.horseNo,{value:h.value,rank,percentile:n>=2?100*(n-rank)/(n-1):null,
   percentileStatus:n>=2?'AVAILABLE':'INSUFFICIENT',topDeficit:values[0]-h.value,medianEdge:h.value-median,
   gapToPrevious:i?known[i-1].value-h.value:null,gapToNext:i+1<n?h.value-known[i+1].value:null}];}));
  return {field,scaleId:`NAR_DERIVED_${field}_V1`,direction:'HIGHER_IS_BETTER',sourceVersion:'NAR_ABILITY_PRECOMPUTE_V1',
   sourceClass:'DERIVED_OFFICIAL_CARD_COMPONENT',independenceGroup:'INDEX_ABILITY',isCpsi:false,
   comparableCount:n,activeRunnerCount:active.length,coverage:{numerator:n,denominator:universe.length},
   relativeScope:n===universe.length&&n>=2?'FULL_FIELD_RELATIVE':'KNOWN_ONLY_RELATIVE',
   rankMethod:'COMPETITION',percentileMethod:'100*(N-Rank)/(N-1)',
   rows:horses.map(h=>{
    const base={horseNo:h.horseNo,runnerStatus:h.runnerStatus};
    if(['scratched','excluded','withdrawn'].includes(h.runnerStatus))return {...base,status:'NOT_APPLICABLE',reasonCode:'RUNNER_NOT_ACTIVE',recoveryAction:'NONE',value:null,rank:null,percentile:null};
    if(h.runnerStatus!=='active')return {...base,status:'HOLD',reasonCode:'RUNNER_STATUS_UNKNOWN',recoveryAction:'Resolve official runner status.',value:null,rank:null,percentile:null};
    if(measured.has(h.horseNo))return {...base,status:'AVAILABLE',reasonCode:null,recoveryAction:'NONE',...measured.get(h.horseNo)};
    return {...base,status:'HOLD',reasonCode:h.evidence?.schemaVersion===1?'COMPONENT_NOT_RETAINED':'EVIDENCE_NOT_RETAINED',recoveryAction:'Acquire validated component evidence in a new eligible run.',value:null,rank:null,percentile:null};
   })};
 });
 return {version:NAR_INDEX_ANALYSIS_VERSION,status:'DESCRIPTIVE_RESEARCH',sourceClass:'DERIVED_OFFICIAL_CARD_COMPONENT',formalKpiEligible:false,
  scoreAggregation:'NOT_PERFORMED',columns,
  cluster:{status:'AUTHORITY_UNRESOLVED',reasonCode:'CLUSTER_RULE_NOT_RESOLVED',recoveryAction:'Resolve the applicable frozen Cluster authority before classification.'},
  dependentAnalyses:[{id:'INDEX_MASTER',status:'NOT_CONNECTED',reasonCode:'CANONICAL_INDEX_NOT_CONNECTED',recoveryAction:'Connect exact-match canonical Index Source and semantic contract.'},{id:'MARKET_GAP',status:'NOT_CONNECTED',reasonCode:'EARLY_INPUT_NOT_CONNECTED',recoveryAction:'Connect the immutable EARLY input with source lineage.'}]};
}
