import {createHash} from 'node:crypto';
import {auditNarInitialEvidenceV1} from './nar-initial-evidence-audit-v1.mjs';
import {earlyEvidenceTime,earlyEvidenceContainsCurrentOutcome} from '../prediction/jra-early-research-reader.mjs';

export const NAR_EARLY_OUTCOME_VERSION='CHASS_NAR_EARLY_OUTCOME_READER_V1';
const tracks=new Set(['帯広','門別','盛岡','水沢','浦和','船橋','大井','川崎','金沢','笠松','名古屋','園田','姫路','高知','佐賀']);
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const hash=raw=>createHash('sha256').update(raw,'utf8').digest('hex');
const score=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100;
const horseNo=n=>Number.isInteger(n)&&n>=1&&n<=99;
const name=s=>typeof s==='string'&&s.length<=200?s.normalize('NFKC').replace(/[\s\u3000]+/g,'').trim():'';
const mean=xs=>xs.length?Number((xs.reduce((a,b)=>a+b,0)/xs.length).toFixed(6)):null;
const seconds=v=>{const m=/^(\d{1,2}):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(String(v||''));return m?Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||0)):null;};
function identity(id){
 const m=typeof id==='string'&&/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]\d?)$/.exec(id);
 if(!m||!tracks.has(m[2]))return null;const at=Date.parse(m[1]+'T00:00:00Z');
 return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===m[1]?{date:m[1],track:m[2],race:Number(m[3])}:null;
}
function output(status,reason,comparison=null){return freeze({version:NAR_EARLY_OUTCOME_VERSION,status,reason,comparison,
 evidenceBasis:'STORED_BYTES_AND_EXISTING_NAR_SEMANTIC_VERIFIERS',formalKpiEligible:false,
 sourceOriginAuthenticated:false,resultOriginAuthenticated:false,externalAnchorAuthenticated:false,
 trustedDurableTime:false,formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});}
function parsed(raw,max){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>max)throw Error('BOUNDS');
 const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('OBJECT');
 return v;
}

// Explicit SELECT-only bridge over the existing initial bundle/observation and
// races result stores. No writer, acquisition, reconstruction or fallback model.
export async function readNarEarlyOutcome({DB,raceId,now=Date.now()}={}){
 const id=identity(raceId);if(!id||!Number.isFinite(now))return output('HOLD','NAR_INVALID_REQUEST');
 if(typeof DB?.prepare!=='function')return output('HOLD','NAR_DB_UNAVAILABLE');
 const read=(sql,key)=>DB.prepare(sql).bind(key).first();
 let bundleRow,receiptRow,bundle,receipt,evidence;
 try{
  const legacy=await read('SELECT 1 AS present FROM research_nar_early_snapshots WHERE storage_key=?','nar-early:v1:'+raceId);
  if(legacy!==null)return output('HOLD','NAR_LEGACY_EARLY_REQUIRES_SEPARATE_AUDIT');
  bundleRow=await read('SELECT CASE WHEN length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 300000 THEN snapshot_json END AS raw FROM research_nar_initial_bundles WHERE storage_key=?','nar-initial-research:v1:'+raceId);
  if(bundleRow===null)return output('HOLD','NAR_INITIAL_BUNDLE_MISSING');
  bundle=parsed(bundleRow?.raw,300000);
  if(bundle.raceId!==raceId||typeof bundle.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(bundle.contentSha256))return output('HOLD','NAR_BUNDLE_IDENTITY_INVALID');
  const receiptKey=`nar-commit-observation:v1:${raceId}:${bundle.contentSha256}`;
  receiptRow=await read('SELECT CASE WHEN length(CAST(snapshot_json AS BLOB)) BETWEEN 1 AND 300000 THEN snapshot_json END AS raw FROM research_nar_commit_observations WHERE storage_key=?',receiptKey);
  if(receiptRow===null)return output('HOLD','NAR_COMMIT_RECEIPT_MISSING');
  receipt=parsed(receiptRow?.raw,300000);
  evidence={schemaVersion:'CHASS_NAR_INITIAL_EVIDENCE_V1',evidenceKind:'UNSPECIFIED',
   bundleKey:'nar-initial-research:v1:'+raceId,bundleRawJson:bundleRow.raw,bundleUtf8Sha256:hash(bundleRow.raw),bundle,
   receiptKey,receiptRawJson:receiptRow.raw,receiptUtf8Sha256:hash(receiptRow.raw),receipt};
 }catch{return output('HOLD','NAR_EVIDENCE_READ_OR_TEXT_INVALID');}
 const audit=await auditNarInitialEvidenceV1(JSON.stringify(evidence));
 if(audit.status!=='CONTENT_AND_OBSERVED_TIME_MATCH')return output('HOLD','NAR_'+(audit.reason||'EVIDENCE_NOT_MATCHED'));
 const source=bundle.sourceEarlySnapshot?.data,prediction=source?.predictionSnapshot,race=source?.race;
 try{if(earlyEvidenceContainsCurrentOutcome({race,prediction}))return output('HOLD','NAR_EARLY_RESULT_DATA_FORBIDDEN');}
 catch{return output('HOLD','NAR_EARLY_RESULT_DATA_FORBIDDEN');}
 const acquired=earlyEvidenceTime(bundle.acquiredAt),sealed=earlyEvidenceTime(bundle.sealedAt),observed=receipt.observation?.returnedAt;
 if(!Number.isFinite(acquired)||!Number.isFinite(sealed)||!Number.isSafeInteger(observed)
  ||acquired>now||sealed>now||observed>now)return output('HOLD','NAR_EVIDENCE_FUTURE_OR_TIME_INVALID');
 if(race?.raceDate!==id.date||race.track!==id.track||Number(race.raceNo)!==id.race
  ||prediction?.race?.postTime!==race.postTime)return output('HOLD','NAR_EARLY_RACE_BINDING_INVALID');
 const post=Date.parse(`${id.date}T${race.postTime}:00+09:00`);
 if(!Number.isFinite(post)||sealed>=post||observed>=post)return output('HOLD','NAR_NOT_PRE_POST');
 const modelVersion=prediction.modelVersion;
 if(typeof modelVersion!=='string'||!modelVersion.trim()||modelVersion.length>160)return output('HOLD','NAR_EARLY_MODEL_VERSION_MISSING');
 const horses=prediction.horses;
 if(!Array.isArray(horses)||horses.length<3||horses.length>32
  ||horses.some(h=>!horseNo(h?.horseNo)||!name(h.horseName)||!score(h.win)||!score(h.place)||h.place<h.win
   ||Object.hasOwn(h,'finish')||Object.hasOwn(h,'position'))
  ||new Set(horses.map(h=>h.horseNo)).size!==horses.length||new Set(horses.map(h=>name(h.horseName))).size!==horses.length)
  return output('HOLD','NAR_EARLY_RUNNERS_OR_PROBABILITIES_INVALID');
 let row,result;
 try{
  row=await DB.prepare('SELECT race_id,model_version,result_acquired_at,CASE WHEN length(CAST(result_json AS BLOB)) BETWEEN 1 AND 500000 THEN result_json END AS result_json FROM races WHERE race_id=? AND model_version=?').bind(raceId,modelVersion).first();
  if(row===null||row?.result_json===null&&row?.result_acquired_at===null)return output('PENDING','NAR_STORED_RESULT_MISSING');
  result=parsed(row?.result_json,500000);
 }catch{return output('HOLD','NAR_RESULT_READ_OR_TEXT_INVALID');}
 if(row.race_id!==raceId||row.model_version!==modelVersion||result.schemaVersion!==3||result.raceId!==raceId
  ||result.organization!=='NAR'||result.resultSource!=='NAR_OFFICIAL'||result.legacyDerived===true||result.historicalResearch)
  return output('HOLD','NAR_RESULT_IDENTITY_OR_ORIGIN_LABEL_INVALID');
 const fetched=earlyEvidenceTime(result.fetchedAt),stored=earlyEvidenceTime(row.result_acquired_at);
 if(!Number.isFinite(fetched)||!Number.isFinite(stored)||fetched!==stored||fetched<=post||fetched<=observed||fetched>now)
  return output('HOLD','NAR_RESULT_TIME_INVALID');
 const order=result.finishOrder,actual=result.horses;
 if(!Array.isArray(order)||order.length!==3||order.some(n=>!horseNo(n))||new Set(order).size!==3
  ||!Array.isArray(actual)||actual.length!==horses.length)return output('HOLD','NAR_RESULT_FIELD_INCOMPLETE');
 if(actual.some(h=>!horseNo(h?.horseNo)||!Number.isInteger(h.position)||h.position<1||h.position>horses.length
   ||(h.horseStatus!=null&&h.horseStatus!=='active')||h.eligible===false
   ||(h.positionText!=null&&String(h.positionText)!==String(h.position)))
  ||new Set(actual.map(h=>h.position)).size!==horses.length||new Set(actual.map(h=>h.horseNo)).size!==horses.length)
  return output('HOLD','NAR_RESULT_NONFINISH_INACTIVE_OR_AMBIGUOUS');
 const byNo=new Map(actual.map(h=>[h.horseNo,h]));
 if(horses.some(h=>!byNo.has(h.horseNo)||name(byNo.get(h.horseNo).horseName)!==name(h.horseName))
  ||order.some((no,i)=>byNo.get(no)?.position!==i+1))return output('HOLD','NAR_RESULT_RUNNER_BINDING_INVALID');
 if(result.actualTimes!=null&&(typeof result.actualTimes!=='object'||Array.isArray(result.actualTimes)
  ||Object.keys(result.actualTimes).some(k=>String(Number(k))!==k||!byNo.has(Number(k)))))return output('HOLD','NAR_RESULT_TIME_RUNNER_INVALID');
 const wins=[],places=[],errors=[];
 for(const h of horses){
  const r=byNo.get(h.horseNo),pred=seconds(h.predictedTime),actualTime=seconds(r.actualTime??r.time),mapped=result.actualTimes?.[String(h.horseNo)];
  if(mapped!=null&&(seconds(mapped)===null||actualTime!==seconds(mapped)))return output('HOLD','NAR_RESULT_TIME_CONFLICT');
  if(pred!=null&&actualTime!=null)errors.push(Math.abs(actualTime-pred));
  wins.push((h.win/100-Number(h.horseNo===order[0]))**2);places.push((h.place/100-Number(order.includes(h.horseNo)))**2);
 }
 return output('READY',null,{raceId,organization:'NAR',modelVersion,earlyRevision:1,
  sourceBundleSha256:bundle.contentSha256,receiptContentSha256:receipt.contentSha256,
  bundleUtf8Sha256:audit.bundleUtf8Sha256,receiptUtf8Sha256:audit.receiptUtf8Sha256,
  resultUtf8Sha256:hash(row.result_json),observedTiming:audit.observedTiming,
  matchedRunnerCount:horses.length,timeSampleCount:errors.length,winBrier:mean(wins),top3Brier:mean(places),timeMaeSeconds:mean(errors),
  rowContractQualified:true,eligibilityBasis:'CONTENT_OBSERVED_TIME_AND_STORED_RESULT_CONTRACT_ONLY'});
}
