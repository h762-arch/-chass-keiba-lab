import {stableHash} from '../prediction/precomputed-snapshot.mjs';
import {RETROSPECTIVE_BRIDGE_VERSION} from './prediction-evidence-bridge-v1.mjs';
import {buildNarHistoryInterpretation} from './nar-history-interpretation-v1.mjs';
const fail=r=>{throw new TypeError(r);};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const numeric=v=>finite(v)?v:typeof v==='string'&&/^-?\d+(?:\.\d+)?$/.test(v.trim())&&Number.isFinite(Number(v))?Number(v):null;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const validFinish=r=>Number.isInteger(r.fieldSize)&&r.fieldSize>1&&Number.isInteger(r.finish)&&r.finish>0&&r.finish<=r.fieldSize;
const POLICY='ALL_RETAINED_HISTORY_EXACT_COURSE_OR_DISTANCE_NO_SURFACE_FILTER';
export async function auditNarSummaryMetrics(snapshot){
  if(snapshot?.schemaVersion!==RETROSPECTIVE_BRIDGE_VERSION||snapshot.organization!=='NAR'||snapshot.replayMode!=='RETROSPECTIVE_ONLY'
    ||snapshot.earlyEligible!==false||snapshot.researchOnly!==true||snapshot.formalKpiEligible!==false
    ||snapshot.productionActivationReady!==false||snapshot.supplementalResearch?.version!=='NAR_SUMMARY_EVIDENCE_BRIDGE_V1')fail('SUPPLEMENTAL_RETROSPECTIVE_RESEARCH_REQUIRED');
  const {snapshotHash,...payload}=snapshot;if(await stableHash(payload)!==snapshotHash)fail('SNAPSHOT_HASH_MISMATCH');
  const rows=snapshot.data.horses.filter(h=>h.runningStatus==='active').map(h=>{
    buildNarHistoryInterpretation({race:snapshot.data.race,horse:h});
    const items=snapshot.evidence.filter(e=>e.horseKey===h.horseKey&&e.family==='FORM_RESEARCH');
    if(items.length>1)fail('SUMMARY_METRIC_AMBIGUOUS');
    const e=items[0];if(!e)return {horseKey:h.horseKey,horseNo:h.horseNo,status:'SUMMARY_MISSING',metrics:[]};
    const all=h.pastRuns.map((r,i)=>({...r,historyIndex:i})).sort((a,b)=>b.date.localeCompare(a.date)||a.historyIndex-b.historyIndex);
    const metrics=[];
    function add(field,runs,kind,scope,tolerance){
      const sourceRaw=e.values[field]??null,source=numeric(sourceRaw),isCount=kind==='COUNT';
      const complete=isCount||runs.every(r=>kind==='MARGIN'?finite(r.margin):validFinish(r));
      const recomputed=isCount?runs.length:!runs.length||!complete?null:kind==='MARGIN'?runs.reduce((n,r)=>n+r.margin,0)/runs.length
        :kind==='MEAN_FINISH'?runs.reduce((n,r)=>n+r.finish,0)/runs.length
        :100*runs.filter(r=>kind==='WIN'?r.finish===1:r.finish<=3).length/runs.length;
      const status=source===null?'SOURCE_MISSING_OR_NONNUMERIC':!runs.length&&!isCount?'NO_RAW_SAMPLE':!complete?'RAW_INCOMPLETE'
        :Math.abs(source-recomputed)<=tolerance+1e-10?'MATCH_UNDER_AUDIT_POLICY':'MISMATCH_UNDER_AUDIT_POLICY';
      metrics.push({field,scope,kind,sourceRaw,sourceNumeric:source,recomputed,tolerance,status,
        rawSampleCount:runs.length,rawComplete:complete,
        refs:{summary:structuredClone(e.refs),history:runs.map(r=>({historyIndex:r.historyIndex,date:r.date,course:r.racecourse,distance:r.distance,surface:r.surface}))},
        meaning:'ARITHMETIC_RECONCILIATION_NOT_SOURCE_DEFINITION_OR_ABILITY_CERTIFICATION'});
    }
    add('保存走数',all,'COUNT','ALL',0);
    for(const [field,n] of [['直近3走平均着順',3],['直近5走平均着順',5],['近10走平均着順',10]])add(field,all.slice(0,n),'MEAN_FINISH',`LATEST_${n}`,0.005);
    add('直近3走平均着差',all.slice(0,3),'MARGIN','LATEST_3',0.005);add('近10走平均着差',all,'MARGIN','ALL',0.005);
    for(const [prefix,runs,scope] of [['近10走',all,'ALL'],['同距離',all.filter(r=>r.distance===snapshot.data.race.distance),'EXACT_DISTANCE'],['同場',all.filter(r=>r.racecourse===snapshot.data.race.racecourse),'EXACT_COURSE']]){
      if(prefix!=='近10走')add(prefix+'走数',runs,'COUNT',scope,0);
      add(prefix+'勝率',runs,'WIN',scope,0.05);add(prefix+'複勝率',runs,'TOP3',scope,0.05);
    }
    for(const field of ['先行率','4角平均位置','近10走ベストTIME','近10走ベスト上がり'])metrics.push({field,sourceRaw:e.values[field]??null,
      status:'UNVERIFIED_DEFINITION_OR_CONDITION',recomputed:null,refs:{summary:structuredClone(e.refs)},
      reason:'PASSAGE_LABELS_RATE_DENOMINATOR_OR_MIXED_CONDITIONS_NOT_AUTHENTICATED'});
    return {horseKey:h.horseKey,horseNo:h.horseNo,horseName:h.horseName,status:'AUDITED_RESEARCH_ONLY',metrics,
      judgments:'CURRENT_LEVEL_PEAK_FORM_TRIGGER_AND_NOTES_REMAIN_SOURCE_DECLARED',predictionChangeAllowed:false};
  });
  const counts={};for(const m of rows.flatMap(r=>r.metrics))counts[m.status]=(counts[m.status]??0)+1;
  const result={version:'NAR_SUMMARY_METRIC_AUDIT_V1',raceId:snapshot.raceId,runId:snapshot.runId,modelVersion:snapshot.modelVersion,
    snapshotHash,policy:POLICY,sourcePrecisionPolicy:'MEANS_2_DECIMAL_HALF_STEP_RATES_1_DECIMAL_HALF_STEP_COUNTS_EXACT',rows,
    coverage:{runners:rows.length,summaries:rows.filter(r=>r.status==='AUDITED_RESEARCH_ONLY').length,metrics:rows.reduce((n,r)=>n+r.metrics.length,0),statusCounts:counts},
    sourceAuthentication:'UNVERIFIED',sourceDefinition:'UNVERIFIED',causalAbilityEvidence:false,
    missingOutcomePolicy:'NO_IMPUTATION_NO_UNKNOWN_AS_LOSS',noSampleRatePolicy:'NULL_NOT_ZERO',
    researchOnly:true,earlyEligible:false,formalKpiEligible:false,productionActivationReady:false,
    predictionMutation:'NONE',freezeMutation:'NONE',signalMutation:'NONE',sourceMutation:'NONE'};
  return freeze({...result,auditHash:await stableHash(result)});
}
