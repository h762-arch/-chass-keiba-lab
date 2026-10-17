import {d1RowToSnapshot} from './precomputed-store.mjs';
import {createPrecomputedIdentity,createSnapshotHash} from './precomputed-snapshot.mjs';

export const VERSION='CHASS_EARLY_REVISION_READBACK_V1';
export const EXACT_REVISION_SQL='SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND revision=? LIMIT 1';
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=x=>typeof x==='string'&&x.length>0&&x.length<=512&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
function outcome(status,reason,extra={}){
 return Object.freeze({version:VERSION,status,reason,...extra,researchOnly:true,
  formalReadiness:'HOLD',formalKpiEligible:false,persistenceVerified:false,
  acquisitionCertified:false,earlyFreezeVerified:false,earlyImmutable:null,
  externalAnchorAuthenticated:false,probabilityDecision:'MODEL_HOLD',
  productionActivationDecision:'NO-GO'});
}
function expectation(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>4096)throw Error();
 const x=JSON.parse(raw);
 if(!x||x.schemaVersion!=='CHASS_EARLY_REVISION_EXPECTATION_V1'||!['JRA','NAR'].includes(x.organization)||!text(x.raceId)||!Number.isSafeInteger(x.revision)||x.revision<1||!['sourceHash','inputHash','snapshotHash'].every(k=>sha(x[k])))throw Error();
 return x;
}
// Only plain scalar database columns may cross the IO boundary. Accessors and
// serialization callbacks are rejected without execution. JSON depth/size are bounded.
function detachedRow(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||![Object.prototype,null].includes(Object.getPrototypeOf(row)))throw Error();
 if(Object.getOwnPropertySymbols(row).length)throw Error();
 const descriptors=Object.getOwnPropertyDescriptors(row),out=Object.create(null);
 if(Object.keys(descriptors).length>40)throw Error();
 let bytes=0;
 for(const [key,d] of Object.entries(descriptors)){
  if(!Object.hasOwn(d,'value')||!d.enumerable)throw Error();
  const v=d.value;
  if(v!==null&&typeof v!=='string'&&!(typeof v==='number'&&Number.isFinite(v)))throw Error();
  if(typeof v==='string'){bytes+=new TextEncoder().encode(v).length;if(bytes>1000000)throw Error();}
  out[key]=v;
 }
 let nodes=0;
 function bounded(v,depth=0){
  if(++nodes>30000||depth>32)throw Error();
  if(typeof v==='number'&&!Number.isFinite(v))throw Error();
  if(v&&typeof v==='object')for(const c of Object.values(v))bounded(c,depth+1);
 }
 for(const k of ['source_json','data_json','market_json','final_json','result_json']){
  if(out[k]!==null&&typeof out[k]!=='string')throw Error();
  if(out[k]!==null)bounded(JSON.parse(out[k]));
 }
 return out;
}

// Supplied DB and expectation origins are NOT authenticated by this function.
// One exact SELECT only; no writer, latest fallback, or runtime hook.
export async function readEarlyExactRevisionV1(DB,expectationJson,{timeoutMs=5000}={}){
 let expected;
 try{expected=expectation(expectationJson);}catch{return outcome('HOLD','INVALID_EXPECTATION');}
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)return outcome('HOLD','INVALID_READ_TIMEOUT');
 let timer;
 try{
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),timeoutMs);});
  const reading=Promise.resolve().then(async()=>{
   const row=await DB.prepare(EXACT_REVISION_SQL).bind(expected.organization,expected.raceId,expected.revision).first();
   return {row:row==null?null:detachedRow(row)};
  });
  const read=await Promise.race([reading,deadline]);
  clearTimeout(timer);
  if(read.timeout)return outcome('HOLD','READ_TIMEOUT');
  if(read.row===null)return outcome('HOLD','REVISION_NOT_FOUND');
  const row=read.row;
  if(row.organization!==expected.organization||row.race_id!==expected.raceId||row.revision!==expected.revision)return outcome('HOLD','REVISION_BINDING_MISMATCH');
  if(!['source_hash','input_hash','snapshot_hash'].every(k=>sha(row[k])))return outcome('HOLD','INVALID_STORED_HASH');
  const snapshot=d1RowToSnapshot(row);
  if(!snapshot.layers.SOURCE||typeof snapshot.layers.SOURCE!=='object'||Array.isArray(snapshot.layers.SOURCE)||!snapshot.layers.DATA||typeof snapshot.layers.DATA!=='object'||Array.isArray(snapshot.layers.DATA))return outcome('HOLD','INVALID_SNAPSHOT_LAYERS');
  if(!['CALCULATED','NOT_CALCULATED','STALE','PARTIAL'].includes(snapshot.status)||!text(snapshot.calculationVersion)||!text(snapshot.modelVersion))return outcome('HOLD','INVALID_SNAPSHOT_METADATA');
  const identity=await createPrecomputedIdentity({organization:snapshot.organization,source:snapshot.layers.SOURCE,versions:snapshot});
  if(identity.sourceHash!==snapshot.sourceHash||identity.inputHash!==snapshot.inputHash)return outcome('HOLD','SOURCE_INPUT_HASH_MISMATCH');
  if(await createSnapshotHash(snapshot)!==snapshot.snapshotHash)return outcome('HOLD','SNAPSHOT_HASH_MISMATCH');
  if(['sourceHash','inputHash','snapshotHash'].some(k=>snapshot[k]!==expected[k]))return outcome('HOLD','EXPECTED_HASH_MISMATCH');
  return outcome('EXACT_REVISION_CONTENT_MATCH',null,{
   organization:snapshot.organization,raceId:snapshot.raceId,revision:snapshot.revision,
   sourceHash:snapshot.sourceHash,inputHash:snapshot.inputHash,snapshotHash:snapshot.snapshotHash,
   storeReadPerformed:true,contentHashesVerified:true,
   assessmentBasis:'SUPPLIED_DB_AND_UNAUTHENTICATED_EXPECTATION',
   temporalVerification:'NOT_ASSESSED',formalBlocker:'TRUSTED_STORE_ACQUISITION_AND_SIGNAL_FREEZE_UNVERIFIED'});
 }catch{return outcome('HOLD','READ_OR_VALIDATION_FAILED');}
 finally{clearTimeout(timer);}
}
