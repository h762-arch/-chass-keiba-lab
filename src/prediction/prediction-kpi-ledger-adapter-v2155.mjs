import {assessPredictionKpiContractV2155} from './prediction-kpi-contract-v2155.mjs';
export const PREDICTION_KPI_LEDGER_VERSION='CHASS_PREDICTION_KPI_LEDGER_BUNDLE_V2155_V1';
const KINDS=['contract','core','fields','attempts','sources'];
const text=v=>typeof v==='string'&&v.trim().length>0;
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const at=v=>text(v)&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
function canonical(v){
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('NON_JSON');
}
export async function predictionKpiLedgerSha256(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const blocked=reason=>freeze({schemaVersion:PREDICTION_KPI_LEDGER_VERSION,status:'HOLD',reason,assessment:null,
  formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
const requireThat=(ok,reason)=>{if(!ok)throw Error(reason)};

// Bounded OFFLINE adapter: an external, independently verified Freeze anchor is
// required. Rehashing a supplied bundle never establishes that external trust.
export async function assessPredictionKpiLedgerBundleV2155(input={}){
  try{
    const {bundle,anchor}=input??{};
    requireThat(bundle&&anchor,'BUNDLE_AND_EXTERNAL_ANCHOR_REQUIRED');
    requireThat(anchor.schemaVersion==='VERIFIED_PREDICTION_KPI_INPUT_ANCHOR_V1'&&sha(anchor.bundleSha256)
      &&text(anchor.evidenceRef)&&text(anchor.runId)&&text(anchor.raceId)&&text(anchor.predictionFreezeId),
    'EXTERNAL_ANCHOR_INVALID');
    requireThat(bundle.schemaVersion===PREDICTION_KPI_LEDGER_VERSION&&bundle.runId===anchor.runId
      &&bundle.raceId===anchor.raceId&&bundle.predictionFreezeId===anchor.predictionFreezeId
      &&bundle.immutableStatus==='FROZEN','BUNDLE_BINDING_INVALID');
    requireThat(Array.isArray(bundle.sections)&&bundle.sections.length===5
      &&KINDS.every(k=>bundle.sections.filter(s=>s?.kind===k).length===1),'EXACT_SECTION_SET_REQUIRED');
    // Check collection sizes before hashing large caller-controlled bodies.
    const section=k=>bundle.sections.find(s=>s.kind===k);
    for(const [kind,max] of [['fields',2000],['attempts',8000],['sources',10000]])requireThat(Array.isArray(section(kind).body)&&section(kind).body.length<=max,'BOUNDED_'+kind.toUpperCase()+'_REQUIRED');
    requireThat(Array.isArray(section('contract').body?.fields)&&section('contract').body.fields.length<=2000,'BOUNDED_CONTRACT_REQUIRED');
    requireThat(canonical(bundle).length<=10_000_000,'BUNDLE_TOO_LARGE');
    const bundleHash=await predictionKpiLedgerSha256(bundle);
    requireThat(bundleHash===anchor.bundleSha256,'EXTERNAL_ANCHOR_HASH_MISMATCH');
    const ids=new Set();
    for(const s of bundle.sections){
      requireThat(text(s.snapshotId)&&!ids.has(s.snapshotId)&&s.runId===bundle.runId&&s.raceId===bundle.raceId
        &&s.immutableStatus==='FROZEN'&&sha(s.contentSha256),'SECTION_BINDING_INVALID');ids.add(s.snapshotId);
      requireThat(await predictionKpiLedgerSha256(s.body)===s.contentSha256,'SECTION_CONTENT_MISMATCH');
    }
    const raw=JSON.parse(canonical(bundle)),byKind=Object.fromEntries(raw.sections.map(s=>[s.kind,s]));
    const contract=byKind.contract.body,core=byKind.core.body,fields=byKind.fields.body,attempts=byKind.attempts.body,sources=byKind.sources.body;
    requireThat(core&&contract&&core.runId===raw.runId&&core.raceId===raw.raceId&&core.freezeId===raw.predictionFreezeId
      &&contract.freezeId===byKind.contract.snapshotId&&core.freezeId===byKind.core.snapshotId
      &&core.fieldEligibilityFreezeId===byKind.fields.snapshotId&&core.acquisitionFreezeId===byKind.attempts.snapshotId,
    'LEDGER_FREEZE_JOIN_INVALID');
    const end=at(core.frozenAt),off=at(core.offAt);
    requireThat(Number.isFinite(end)&&Number.isFinite(off)&&end<off,'PRE_OFF_CORE_REQUIRED');
    for(const s of raw.sections){const frozen=at(s.frozenAt);requireThat(Number.isFinite(frozen)&&frozen<=end,'SECTION_FREEZE_TIME_INVALID')}
    requireThat(byKind.contract.frozenAt===contract.frozenAt&&byKind.core.frozenAt===core.frozenAt,'SECTION_BODY_TIME_MISMATCH');
    const sourceMap=new Map();
    for(const s of sources){
      requireThat(s&&text(s.sourceSnapshotId)&&!sourceMap.has(s.sourceSnapshotId)&&s.runId===core.runId&&s.raceId===core.raceId
        &&s.stage==='EARLY'&&s.identityStatus==='PASS'&&s.sourceLineage==='PASS'&&s.leakageGuard==='PASS'
        &&s.immutableStatus==='FROZEN'&&Array.isArray(s.values)&&s.values.length<=2000,'SOURCE_REGISTRY_INVALID');
      const captured=at(s.capturedAt),asOf=at(s.dataAsOf);
      requireThat(Number.isFinite(captured)&&Number.isFinite(asOf)&&asOf<=captured&&captured<=at(byKind.sources.frozenAt),
      'SOURCE_AVAILABILITY_TIME_INVALID');
      requireThat(s.values.every(v=>v&&text(v.eligibilityId)&&text(v.fieldId)&&text(v.scopeKey))
        &&new Set(s.values.map(v=>v.eligibilityId)).size===s.values.length,'SOURCE_VALUE_IDENTITY_INVALID');
      sourceMap.set(s.sourceSnapshotId,s);
    }
    const sourceBefore=(id,time)=>{const s=sourceMap.get(id);requireThat(s&&at(s.capturedAt)<=at(time),'SOURCE_SNAPSHOT_MISSING_OR_LATE');return s};
    sourceBefore(contract.sourceSnapshotId,contract.frozenAt);
    for(const plan of contract.fields)sourceBefore(plan?.requirementSnapshotId,contract.frozenAt);
    for(const f of fields){
      requireThat(f&&f.frozenAt===byKind.fields.frozenAt,'FIELD_SECTION_TIME_MISMATCH');
      if(f.acquisitionState==='RESOLVED'){
        const s=sourceBefore(f.sourceSnapshotId,f.frozenAt),value=s.values.find(v=>v.eligibilityId===f.eligibilityId);
        requireThat(value&&value.fieldId===f.fieldId&&value.scopeKey===f.scopeKey&&canonical(value.value)===canonical(f.value),'SOURCE_VALUE_MISMATCH');
      }
    }
    for(const a of attempts){
      requireThat(a&&at(a.attemptedAt)<=at(byKind.attempts.frozenAt),'ATTEMPT_SECTION_TIME_INVALID');
      const completed=a.completedAt??a.attemptedAt;
      requireThat(Number.isFinite(at(completed))&&at(completed)>=at(a.attemptedAt)&&at(completed)<=at(byKind.attempts.frozenAt),'ATTEMPT_SECTION_TIME_INVALID');
      if(a.result==='FOUND')sourceBefore(a.sourceSnapshotId,completed);
    }
    // Input storage order has no authority. Preserve attempt numbers and let the
    // policy evaluator reject duplicate/gapped/reordered tier declarations.
    const order=new Map(contract.fields.map((p,i)=>[p.eligibilityId,i]));
    const normalizedFields=[...fields].sort((a,b)=>(order.get(a.eligibilityId)??2001)-(order.get(b.eligibilityId)??2001));
    const normalizedAttempts=[...attempts].sort((a,b)=>(order.get(a.eligibilityId)??2001)-(order.get(b.eligibilityId)??2001)||a.attemptNo-b.attemptNo);
    const assessment=await assessPredictionKpiContractV2155({contract,core,fields:normalizedFields,attempts:normalizedAttempts});
    return freeze({schemaVersion:PREDICTION_KPI_LEDGER_VERSION,status:assessment.status==='POLICY_READY'?'POLICY_READY':'HOLD',
      reason:assessment.status==='POLICY_READY'?null:'POLICY_GATE_HOLD',runId:core.runId,raceId:core.raceId,
      bundleSha256:bundleHash,anchorEvidenceRef:anchor.evidenceRef,sectionBindings:raw.sections.map(s=>({kind:s.kind,snapshotId:s.snapshotId,contentSha256:s.contentSha256})),
      assessment,integrityVerified:true,externalAuthentication:'CALLER_MUST_VERIFY_ANCHOR',
      formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
  }catch(e){return blocked(['NON_JSON','BUNDLE_AND_EXTERNAL_ANCHOR_REQUIRED','EXTERNAL_ANCHOR_INVALID','BUNDLE_BINDING_INVALID','EXACT_SECTION_SET_REQUIRED','BOUNDED_FIELDS_REQUIRED','BOUNDED_ATTEMPTS_REQUIRED','BOUNDED_SOURCES_REQUIRED','BOUNDED_CONTRACT_REQUIRED','BUNDLE_TOO_LARGE','EXTERNAL_ANCHOR_HASH_MISMATCH','SECTION_BINDING_INVALID','SECTION_CONTENT_MISMATCH','LEDGER_FREEZE_JOIN_INVALID','PRE_OFF_CORE_REQUIRED','SECTION_FREEZE_TIME_INVALID','SECTION_BODY_TIME_MISMATCH','SOURCE_REGISTRY_INVALID','SOURCE_AVAILABILITY_TIME_INVALID','SOURCE_VALUE_IDENTITY_INVALID','SOURCE_SNAPSHOT_MISSING_OR_LATE','FIELD_SECTION_TIME_MISMATCH','SOURCE_VALUE_MISMATCH','ATTEMPT_SECTION_TIME_INVALID'].includes(e?.message)?e.message:'LEDGER_BUNDLE_UNREADABLE')}
}
