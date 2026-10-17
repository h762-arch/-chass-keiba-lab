import {createHash} from 'node:crypto';
import {verifyNarInitialResearchBundle} from './nar-initial-research-bundle.mjs';
import {verifyNarCommitObservationResearch} from './nar-commit-admission.mjs';

export const VERSION='CHASS_NAR_INITIAL_EVIDENCE_AUDIT_V1';
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hash=v=>createHash('sha256').update(v,'utf8').digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
function parse(raw,max){
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>max)throw Error();
 const x=JSON.parse(raw);let nodes=0;
 function visit(v,depth=0){if(++nodes>30000||depth>32)throw Error();if(typeof v==='number'&&!Number.isFinite(v))throw Error();if(v&&typeof v==='object')for(const c of Object.values(v))visit(c,depth+1);}
 visit(x);if(!x||typeof x!=='object'||Array.isArray(x))throw Error();return x;
}
const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&v===v.trim()&&!/[\x00-\x1f\x7f]/.test(v);
function result(status,reason,extra={}){
 return Object.freeze({version:VERSION,status,reason,...extra,researchOnly:true,
  formalReadiness:'HOLD',formalKpiEligible:false,adopted:false,
  productionEvidenceVerified:false,externalAnchorAuthenticated:false,
  trustedDurableTime:false,earlyFreezeAuthenticated:false,
  inputProvenance:'UNAUTHENTICATED',storeReadPerformed:false,freezeMutation:'NONE',
  probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
}

// Independent offline audit of supplied stored text. It does not trust caller
// PASS/check flags, authenticate provenance, contact a store, or promote KPI.
export async function auditNarInitialEvidenceV1(evidenceJson){
 let e,bundle,receipt;
 try{
  e=parse(evidenceJson,1000000);
  if(e.schemaVersion!=='CHASS_NAR_INITIAL_EVIDENCE_V1')return result('HOLD','EVIDENCE_SCHEMA_INVALID');
  if(typeof e.bundleRawJson!=='string'||e.bundleRawJson.length===0)return result('HOLD','ORIGINAL_BUNDLE_TEXT_REQUIRED');
  bundle=parse(e.bundleRawJson,300000);
  if(!sha(e.bundleUtf8Sha256)||hash(e.bundleRawJson)!==e.bundleUtf8Sha256)return result('HOLD','BUNDLE_BYTE_HASH_MISMATCH');
  if(!text(bundle.raceId)||e.bundleKey!=='nar-initial-research:v1:'+bundle.raceId)return result('HOLD','BUNDLE_KEY_MISMATCH');
  if(e.bundle==null||canonical(e.bundle)!==canonical(bundle))return result('HOLD','BUNDLE_SUMMARY_MISMATCH');
  if((await verifyNarInitialResearchBundle(bundle,{raceId:bundle.raceId})).status!=='PRESERVED')return result('HOLD','BUNDLE_SEMANTICS_INVALID');
  if(e.receiptRawJson===null||e.receiptRawJson===undefined)return result('HOLD','ORIGINAL_RECEIPT_TEXT_REQUIRED');
  receipt=parse(e.receiptRawJson,300000);
  if(!sha(e.receiptUtf8Sha256)||hash(e.receiptRawJson)!==e.receiptUtf8Sha256)return result('HOLD','RECEIPT_BYTE_HASH_MISMATCH');
  if(e.receiptKey!==`nar-commit-observation:v1:${bundle.raceId}:${bundle.contentSha256}`)return result('HOLD','RECEIPT_KEY_MISMATCH');
  if(e.receipt==null||canonical(e.receipt)!==canonical(receipt))return result('HOLD','RECEIPT_SUMMARY_MISMATCH');
  const checked=await verifyNarCommitObservationResearch({snapshot:bundle,receipt});
  if(checked.status!=='PRESERVED')return result('HOLD','RECEIPT_SEMANTICS_INVALID');
  if(checked.timing!=='OBSERVED_WITHIN_WINDOW')return result('HOLD',checked.timing==='OBSERVED_OUTSIDE_WINDOW'?'COMMIT_OBSERVED_LATE':'COMMIT_TIMING_UNCONFIRMED');
  return result('CONTENT_AND_OBSERVED_TIME_MATCH',null,{
   declaredEvidenceKind:e.evidenceKind==='SYNTHETIC_REHEARSAL'?'SYNTHETIC_REHEARSAL':'UNSPECIFIED',
   assessmentBasis:'SUPPLIED_BYTES_AND_EXISTING_SEMANTIC_VERIFIERS',
   bundleUtf8Sha256:hash(e.bundleRawJson),receiptUtf8Sha256:hash(e.receiptRawJson),
   bundleContentSha256:bundle.contentSha256,receiptContentSha256:receipt.contentSha256,
   byteHashesVerified:true,semanticBindingsVerified:true,observedTiming:checked.timing,
   formalBlocker:'DURABLE_TIME_PROVENANCE_AND_FORMAL_POLICY_UNVERIFIED'});
 }catch{return result('HOLD','EVIDENCE_UNREADABLE_OR_OUT_OF_BOUNDS');}
}
