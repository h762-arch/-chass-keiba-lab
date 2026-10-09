// One-field offline acquisition orchestration. Registered collectors own source
// access; this module has no built-in fetch, DB, Drive, persistence or promotion.
export const BOUNDED_ACQUISITION_VERSION='CHASS_BOUNDED_ACQUISITION_V2155_V1';
const TIERS=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
const text=v=>typeof v==='string'&&v.trim().length>0;
const at=v=>text(v)&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
function canonical(v){
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object'&&[Object.prototype,null].includes(Object.getPrototypeOf(v)))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('NON_JSON');
}
async function digest(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const requireThat=(ok,reason)=>{if(!ok)throw Error(reason)};
async function boundedCall(collector,args,ms){
  const controller=new AbortController();let timer;
  const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({kind:'TIMEOUT'})},ms)});
  const call=Promise.resolve().then(()=>collector({...args,signal:controller.signal})).then(value=>({kind:'RETURNED',value}),()=>({kind:'READ_FAILED'}));
  try{return await Promise.race([call,deadline])}finally{clearTimeout(timer)}
}

export async function executeBoundedPredictionAcquisitionV2155(input={}){
  let planHash=null,plan=null,attempts=[],lastTime=null;
  const output=(state,reason,extra={})=>freeze({schemaVersion:BOUNDED_ACQUISITION_VERSION,planHash,
    runId:plan?.runId??null,raceId:plan?.raceId??null,eligibilityId:plan?.eligibilityId??null,
    status:state==='RESOLVED'||state==='EXHAUSTED_DECLARED'?'TERMINAL':'HOLD',acquisitionState:state,
    reason,attempts,...extra,assessmentOnly:true,formalKpiEligible:false,adopted:false,
    productionActivationReady:false,freezeMutation:'NONE',persisted:false});
  try{
    const {collectors,clock=Date.now}=input??{};
    const raw=canonical(input?.plan);requireThat(raw.length<=20000,'PLAN_TOO_LARGE');
    plan=JSON.parse(raw);planHash=await digest(plan);
    requireThat(plan&&plan.version==='v2.15.5'&&plan.mode==='FORWARD'&&plan.stage==='ORIGINAL_EARLY'
      &&plan.immutableStatus==='FROZEN'&&plan.leakageGuard==='PASS','PREREGISTERED_FORWARD_PLAN_REQUIRED');
    for(const k of ['planId','runId','raceId','eligibilityId','scopeKey','fieldId','requirementSnapshotId','contractFreezeId'])requireThat(text(plan[k]),'PLAN_IDENTITY_REQUIRED');
    requireThat(['MUST_ACQUIRE','MUST_ATTEMPT_PIPELINE'].includes(plan.acquisitionRequired)
      &&typeof plan.numericMetric==='boolean','REQUIRED_ACQUISITION_CONTRACT_REQUIRED');
    const frozen=at(plan.frozenAt),cutoff=at(plan.cutoffAt),off=at(plan.offAt);
    requireThat(Number.isFinite(frozen)&&Number.isFinite(cutoff)&&Number.isFinite(off)&&frozen<cutoff&&cutoff<off,'PRE_CUTOFF_PLAN_REQUIRED');
    requireThat(Number.isInteger(plan.maxAttemptMs)&&plan.maxAttemptMs>=1&&plan.maxAttemptMs<=5000,'BOUNDED_TIMEOUT_REQUIRED');
    requireThat(Array.isArray(plan.tiers)&&plan.tiers.length===4&&plan.tiers.every((t,i)=>t?.tier===TIERS[i]&&text(t.provider)&&text(t.sourceCandidate)),'EXACT_PREREGISTERED_TIERS_REQUIRED');
    // Validate every required collector before the first call. Missing hooks
    // cannot manufacture a completed attempt or exhaustion receipt.
    requireThat(collectors&&plan.tiers.every(t=>Object.hasOwn(collectors,t.provider)&&typeof collectors[t.provider]==='function')&&typeof clock==='function','ALL_COLLECTORS_REQUIRED');
    const now=()=>{const n=clock();requireThat(typeof n==='number'&&Number.isFinite(n)&&n>=frozen&&(lastTime===null||n>=lastTime),'CLOCK_INVALID');lastTime=n;requireThat(n<cutoff,'CUTOFF_REACHED');return n};
    for(let i=0;i<4;i++){
      const tier=plan.tiers[i],start=now();
      const context=freeze({runId:plan.runId,raceId:plan.raceId,eligibilityId:plan.eligibilityId,scopeKey:plan.scopeKey,
        fieldId:plan.fieldId,requirementSnapshotId:plan.requirementSnapshotId,contractFreezeId:plan.contractFreezeId,
        planId:plan.planId,planHash,tier:tier.tier,provider:tier.provider,sourceCandidate:tier.sourceCandidate,
        cutoffAt:plan.cutoffAt,offAt:plan.offAt,stage:plan.stage});
      const receipt=await boundedCall(collectors[tier.provider],{context},Math.min(plan.maxAttemptMs,Math.max(1,Math.floor(cutoff-start))));
      // Do not accept a response observed after the target cutoff, even if its
      // provider timestamp claims an earlier source time.
      const ended=clock();requireThat(typeof ended==='number'&&Number.isFinite(ended)&&ended>=start,'CLOCK_INVALID');lastTime=ended;
      const base={attemptId:plan.planId+':'+(i+1),runId:plan.runId,raceId:plan.raceId,eligibilityId:plan.eligibilityId,
        fieldId:plan.fieldId,scopeKey:plan.scopeKey,attemptNo:i+1,tier:tier.tier,provider:tier.provider,
        sourceCandidate:tier.sourceCandidate,attemptedAt:new Date(start).toISOString(),completedAt:new Date(ended).toISOString(),
        planHash,leakageGuard:'PASS',immutableStatus:'FROZEN'};
      if(ended>=cutoff){attempts.push({...base,result:'BLOCKED',reasonCode:'CUTOFF_REACHED'});return output('IN_PROGRESS','CUTOFF_REACHED')}
      if(receipt.kind==='TIMEOUT'){
        attempts.push({...base,result:'READ_FAILED',reasonCode:'COLLECTOR_TIMEOUT'});
        // Abort is cooperative: a timed-out task might still run. It cannot
        // authorize progression/exhaustion or trigger later tiers.
        return output('IN_PROGRESS','COLLECTOR_TIMEOUT');
      }
      if(receipt.kind==='READ_FAILED'){attempts.push({...base,result:'READ_FAILED',reasonCode:'COLLECTOR_READ_FAILED'});continue}
      let r;try{const body=canonical(receipt.value);requireThat(body.length<=200000,'RECEIPT_TOO_LARGE');r=JSON.parse(body)}catch{attempts.push({...base,result:'BLOCKED',reasonCode:'RECEIPT_INVALID'});return output('IN_PROGRESS','RECEIPT_INVALID')}
      if(!r||!['FOUND','NOT_FOUND','READ_FAILED','BLOCKED','NOT_APPLICABLE','CONFLICT'].includes(r.result)){
        attempts.push({...base,result:'BLOCKED',reasonCode:'RECEIPT_RESULT_INVALID'});return output('IN_PROGRESS','RECEIPT_RESULT_INVALID');
      }
      if(r.result==='CONFLICT'){attempts.push({...base,result:'CONFLICT',reasonCode:'SOURCE_CONFLICT'});return output('IN_PROGRESS','SOURCE_CONFLICT')}
      if(r.result!=='FOUND'){
        if(!text(r.reasonCode)){attempts.push({...base,result:'BLOCKED',reasonCode:'RECEIPT_REASON_REQUIRED'});return output('IN_PROGRESS','RECEIPT_REASON_REQUIRED')}
        attempts.push({...base,result:r.result,reasonCode:r.reasonCode});continue;
      }
      const captured=at(r.capturedAt),asOf=at(r.dataAsOf);
      try{
      requireThat(r.runId===plan.runId&&r.raceId===plan.raceId&&r.scopeKey===plan.scopeKey&&r.fieldId===plan.fieldId
        &&r.eligibilityId===plan.eligibilityId&&text(r.sourceSnapshotId)&&r.sourceStage==='EARLY'
        &&r.identityStatus==='PASS'&&r.sourceLineage==='PASS'&&r.leakageGuard==='PASS','FOUND_PROVENANCE_INVALID');
      requireThat(Number.isFinite(captured)&&Number.isFinite(asOf)&&asOf<=captured&&captured<=ended&&captured<cutoff,'FOUND_AVAILABILITY_INVALID');
      requireThat(r.value!==undefined&&r.value!==null&&(!plan.numericMetric||(typeof r.value==='number'&&Number.isFinite(r.value))),'FOUND_VALUE_INVALID');
      }catch(e){attempts.push({...base,result:'BLOCKED',reasonCode:e.message});return output('IN_PROGRESS',e.message)}
      attempts.push({...base,result:'FOUND',sourceSnapshotId:r.sourceSnapshotId});
      return output('RESOLVED',null,{resolutionStatus:'RESOLVED',value:r.value,sourceSnapshotId:r.sourceSnapshotId,
        sourceStage:'EARLY',capturedAt:r.capturedAt,dataAsOf:r.dataAsOf,completedAt:new Date(ended).toISOString()});
    }
    return output('EXHAUSTED_DECLARED',null,{resolutionStatus:attempts.some(a=>a.result==='READ_FAILED')?'READ_FAILED':'SOURCE_MISSING',
      value:null,exhaustionCode:'BOUNDED_TIERS_EXHAUSTED',exhaustionReason:'All four preregistered pre-cutoff tiers completed without a valid source.',
      finalSourceState:attempts.at(-1).result,completedAt:new Date(lastTime).toISOString()});
  }catch(e){return output('IN_PROGRESS',['NON_JSON','PLAN_TOO_LARGE','PREREGISTERED_FORWARD_PLAN_REQUIRED','PLAN_IDENTITY_REQUIRED','REQUIRED_ACQUISITION_CONTRACT_REQUIRED','PRE_CUTOFF_PLAN_REQUIRED','BOUNDED_TIMEOUT_REQUIRED','EXACT_PREREGISTERED_TIERS_REQUIRED','ALL_COLLECTORS_REQUIRED','CLOCK_INVALID','CUTOFF_REACHED','RECEIPT_RESULT_INVALID','FOUND_PROVENANCE_INVALID','FOUND_AVAILABILITY_INVALID','FOUND_VALUE_INVALID'].includes(e?.message)?e.message:'ACQUISITION_FAILED')}
}
