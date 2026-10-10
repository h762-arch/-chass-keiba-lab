import { validDate } from '../jra-meeting-discovery.mjs';
import { isFrozenSignalRaceId } from '../src/research/signal-rule-cohort-audit.mjs';
import { readSignalSourceBindingCohort,SIGNAL_BINDING_READ_SQL } from '../src/research/signal-source-binding-reader.mjs';

const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export function productionSignalBindingQuery(date){
 if(!validDate(date))throw Error('invalid_target_date');
 return `SELECT race_id,model_version,market_json FROM races WHERE race_id LIKE '${date.replaceAll('-','')}-JRA-%' ORDER BY race_id,model_version LIMIT 101`;
}

// Additive coverage observation. No new receipts, latest-model selection,
// source backfill, mark generation or production gate change.
export async function readProductionSignalBindingAudit(date,{execute,expectedRaceIds=null}={}){
 const result=(status,reason,extra={})=>freeze({targetDate:date,status,reason,mode:'research',
  source:'APP_RACES_SAVED_ORIGINAL_SIGNAL',authenticity:'NOT_VERIFIED',
  adopted:false,formalKpiEligible:false,productionActivationReady:false,...extra});
 if(!validDate(date)||typeof execute!=='function')return result('REJECTED','INVALID_AUDIT_INPUT');
 const prefix=date.replaceAll('-','')+'-JRA-';
 if(expectedRaceIds!==null&&(!Array.isArray(expectedRaceIds)||expectedRaceIds.length<1||
  expectedRaceIds.length>100||new Set(expectedRaceIds).size!==expectedRaceIds.length||
  expectedRaceIds.some(id=>!isFrozenSignalRaceId(id)||!id.startsWith(prefix))))
  return result('REJECTED','INVALID_EXPECTED_RACES');
 let rows;
 try{rows=await execute(productionSignalBindingQuery(date));}
 catch{return result('BLOCKED','APP_SIGNAL_QUERY_FAILED',{readQueryCount:1});}
 if(!Array.isArray(rows))return result('BLOCKED','APP_SIGNAL_RESPONSE_INVALID',{readQueryCount:1});
 if(rows.length>100)return result('BLOCKED','APP_SIGNAL_ROW_LIMIT',{readQueryCount:1,coverage:'UNKNOWN'});
 const identities=new Set();
 for(const row of rows){
  if(!isFrozenSignalRaceId(row?.race_id)||!row.race_id.startsWith(prefix)||
   typeof row.model_version!=='string'||row.model_version.length<1||row.model_version.length>160||
   /[\r\n\0]/.test(row.model_version))return result('BLOCKED','APP_SIGNAL_ROW_IDENTITY_INVALID',{readQueryCount:1});
  const key=JSON.stringify([row.race_id,row.model_version]);
  if(identities.has(key))return result('BLOCKED','APP_SIGNAL_DUPLICATE_ROW',{readQueryCount:1});
  identities.add(key);
 }
 const selected=rows.map(r=>({raceId:r.race_id,modelVersion:r.model_version}));
 const capturedDB={prepare(sql){if(sql!==SIGNAL_BINDING_READ_SQL)throw Error('unexpected_query');
  return {bind(raceId,modelVersion){return {async first(){
   return rows.find(r=>r.race_id===raceId&&r.model_version===modelVersion)||null;
  }}}};
 }};
 const audit=selected.length?await readSignalSourceBindingCohort({DB:capturedDB,selections:selected}):
  {status:'OBSERVED',rows:[],reasonCounts:{},readQueryCount:0};
 if(audit.status!=='OBSERVED')return result('BLOCKED','APP_SIGNAL_READER_FAILED',{readQueryCount:1});
 const stored=new Set(rows.map(r=>r.race_id)),expected=expectedRaceIds===null?null:new Set(expectedRaceIds),
  missing=expected?[...expected].filter(id=>!stored.has(id)).sort():null,
  unexpected=expected?[...stored].filter(id=>!expected.has(id)).sort():null;
 return result('OBSERVED',null,{readQueryCount:1,capturedSelectionReadCount:audit.readQueryCount,
  expectedRaceCount:expected?.size??null,storedModelRecordCount:rows.length,storedRaceCount:stored.size,
  missingExpectedRaceIds:missing,unexpectedStoredRaceIds:unexpected,coverage:expected?'COMPARED':'NOT_COMPARED',
  bindingCaptureMissingCount:audit.rows.filter(r=>r.reason==='BINDING_CAPTURE_MISSING').length,
  signalMissingCount:audit.rows.filter(r=>r.reason==='SIGNAL_SNAPSHOT_MISSING').length,
  reasonCounts:audit.reasonCounts,rows:audit.rows,
  limitation:'All saved model versions are observed separately. No retained binding captures are read by this production adapter; missing captures are not reconstructed. App Signal storage is separate from precomputed MARKET/DATA and does not determine core Prediction KPI eligibility.'});
}

export function productionSignalBindingSummaryLines(report){
 return `## Phase113 saved Original Signal coverage\n- Status: ${report.status}; reason: ${report.reason||'none'}\n`+
  `- App saved model records / distinct races: ${report.storedModelRecordCount??'UNKNOWN'} / ${report.storedRaceCount??'UNKNOWN'}\n`+
  `- Expected races: ${report.expectedRaceCount??'UNKNOWN'}; comparison: ${report.coverage||'UNKNOWN'}\n`+
  `- Missing expected app races: ${report.missingExpectedRaceIds===null||report.missingExpectedRaceIds===undefined?'UNKNOWN':report.missingExpectedRaceIds.join(', ')||'none'}\n`+
  `- Missing Signal / missing binding capture (model records): ${report.signalMissingCount??'UNKNOWN'} / ${report.bindingCaptureMissingCount??'UNKNOWN'}\n`+
  `- Reasons: ${JSON.stringify(report.reasonCounts||{})}\n- Production/Signal adoption: NOT PERFORMED\n`;
}
