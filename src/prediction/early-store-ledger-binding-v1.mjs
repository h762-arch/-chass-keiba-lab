import {readEarlyExactRevisionV1} from './early-revision-readback-v1.mjs';
import {assessPredictionKpiLedgerBundleV2155,predictionKpiLedgerSha256} from './prediction-kpi-ledger-adapter-v2155.mjs';

export const VERSION='CHASS_EARLY_STORE_LEDGER_BINDING_V1';
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
function parse(raw,max){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>max)throw Error();
 const value=JSON.parse(raw);let nodes=0;
 function visit(x,depth=0){if(++nodes>30000||depth>32)throw Error();if(typeof x==='number'&&!Number.isFinite(x))throw Error();if(x&&typeof x==='object')for(const v of Object.values(x))visit(v,depth+1);}
 visit(value);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
 return value;
}
function instant(v){
 if(typeof v!=='string')return NaN;
 const m=v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
 if(!m)return NaN;const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 if(y<1000||month<1||month>12||day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()||hour>23||minute>59||second>59||(m[7]!=='Z'&&(Number(m[7].slice(1,3))>23||Number(m[7].slice(4,6))>59)))return NaN;
 return Date.parse(v);
}
function result(status,reason,extra={}){
 return Object.freeze({version:VERSION,status,reason,...extra,researchOnly:true,formalReadiness:'HOLD',
  formalKpiEligible:false,persistenceVerified:false,acquisitionCertified:false,earlyFreezeVerified:false,
  earlyImmutable:null,externalAnchorAuthenticated:false,freezeMutation:'NONE',
  probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
}
// All records and pins remain unauthenticated caller inputs. This connects
// independently supplied evidence; it creates no save record or Freeze receipt.
export async function readEarlyStoreLedgerBindingV1(DB,evidenceJson,pinJson){
 let evidence,pin;
 try{evidence=parse(evidenceJson,500000);pin=parse(pinJson,4096);}catch{return result('HOLD','INVALID_BINDING_INPUT');}
 try{
  const record=evidence.saveRecord,bundle=evidence.ledgerBundle,anchor=evidence.ledgerAnchor;
  if(pin.schemaVersion!=='CHASS_EARLY_STORE_LEDGER_PIN_V1'||!sha(pin.saveRecordSha256)||!sha(pin.ledgerBundleSha256)||!sha(pin.snapshotHash))return result('HOLD','INVALID_PIN');
  if(!record||record.schemaVersion!=='CHASS_EARLY_SAVE_RECORD_V1'||!text(record.recordId)||!['JRA','NAR'].includes(record.organization)||!text(record.raceId)||!text(record.runId)||!text(record.freezeId)||!Number.isSafeInteger(record.revision)||record.revision<1||!['sourceHash','inputHash','snapshotHash'].every(k=>sha(record[k])))return result('HOLD','INVALID_SAVE_RECORD');
  if(await predictionKpiLedgerSha256(record)!==pin.saveRecordSha256||await predictionKpiLedgerSha256(bundle)!==pin.ledgerBundleSha256)return result('HOLD','PINNED_CONTENT_MISMATCH');
  for(const key of ['organization','raceId','revision','snapshotHash','runId','freezeId'])if(record[key]!==pin[key])return result('HOLD','SAVE_PIN_BINDING_MISMATCH');
  if(bundle?.runId!==record.runId||bundle?.raceId!==record.raceId||bundle?.predictionFreezeId!==record.freezeId||anchor?.bundleSha256!==pin.ledgerBundleSha256)return result('HOLD','LEDGER_SAVE_BINDING_MISMATCH');
  const ledger=await assessPredictionKpiLedgerBundleV2155({bundle,anchor});
  if(ledger.status!=='POLICY_READY')return result('HOLD','LEDGER_POLICY_HOLD');
  const core=bundle.sections.find(s=>s.kind==='core').body;
  const savedAt=instant(record.savedAt),frozenAt=instant(core.frozenAt),offAt=instant(core.offAt);
  if(!Number.isFinite(savedAt)||!Number.isFinite(frozenAt)||!Number.isFinite(offAt)||savedAt>frozenAt||frozenAt>=offAt)return result('HOLD','SAVE_FREEZE_TIME_MISMATCH');
  const read=await readEarlyExactRevisionV1(DB,JSON.stringify({schemaVersion:'CHASS_EARLY_REVISION_EXPECTATION_V1',organization:record.organization,raceId:record.raceId,revision:record.revision,sourceHash:record.sourceHash,inputHash:record.inputHash,snapshotHash:record.snapshotHash}));
  if(read.status!=='EXACT_REVISION_CONTENT_MATCH')return result('HOLD','EXACT_REVISION_READBACK_HOLD');
  const validated=instant(read.sourceValidatedAt),calculated=instant(read.dataCalculatedAt);
  if(!Number.isFinite(validated)||!Number.isFinite(calculated)||validated>savedAt||calculated>savedAt)return result('HOLD','SNAPSHOT_SAVE_TIME_MISMATCH');
  return result('STORE_LEDGER_BINDINGS_MATCH',null,{
   organization:record.organization,raceId:record.raceId,revision:record.revision,
   snapshotHash:read.snapshotHash,saveRecordSha256:pin.saveRecordSha256,
   ledgerBundleSha256:pin.ledgerBundleSha256,runId:record.runId,freezeId:record.freezeId,
   storeReadPerformed:true,contentHashesVerified:true,ledgerPolicyChecked:true,
   assessmentBasis:'SUPPLIED_STORE_RECORD_LEDGER_AND_UNAUTHENTICATED_PIN',
   temporalVerification:'HASH_BOUND_RELATIVE_ORDER_ONLY',
   formalBlocker:'INDEPENDENT_STORE_RECORD_PIN_AND_SIGNAL_AUTHENTICATION_REQUIRED'});
 }catch{return result('HOLD','BINDING_VALIDATION_FAILED');}
}
