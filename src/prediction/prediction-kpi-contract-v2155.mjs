// Policy assessment ONLY. Input receipts need independent authentication by the caller.
// No persistence, network, probability promotion, EARLY adoption or runtime wiring.
export const PREDICTION_KPI_CONTRACT_VERSION='CHASS_PREDICTION_KPI_CONTRACT_V2155_V1';
const TIERS=['T0_CACHE_REGISTRY','T1_CANONICAL_PROVIDER','T2_ALT_AUTHORITATIVE','T3_PRE_CUTOFF_BUILD'];
const ELIGIBILITY=['ELIGIBLE','INELIGIBLE_SAMPLE','INELIGIBLE_STAGE','INELIGIBLE_MODEL_NOT_READY','INELIGIBLE_CONTRACT_NOT_DEFINED','INELIGIBLE_PIPELINE_NOT_READY'];
const CORE_GATES=['officialCard','identity','sourceFrozen','sourceLineage','leakageGuard','candidateTrace','portfolio','preservation','roleTournament','signalEvidence','productionWritePolicy','baselineReadiness','fieldEligibilityProof'];
const text=v=>typeof v==='string'&&v.trim().length>0;
const at=v=>text(v)&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
function canonical(v){
  if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
  if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
  if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
  throw Error('NON_JSON_INPUT');
}
async function hash(v){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(d)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const unique=xs=>new Set(xs).size===xs.length;

export async function assessPredictionKpiContractV2155(input={}){
  const failures=[],bad=reason=>failures.push(reason);
  let x,inputHash=null;
  try{inputHash=await hash(input);x=JSON.parse(canonical(input))}catch{bad('NON_JSON_INPUT');x={}}
  if(!x||typeof x!=='object'||Array.isArray(x)){bad('OBJECT_INPUT_REQUIRED');x={}}
  const contract=x.contract&&typeof x.contract==='object'&&!Array.isArray(x.contract)?x.contract:{};
  const core=x.core&&typeof x.core==='object'&&!Array.isArray(x.core)?x.core:{};
  const fields=x.fields??[],attempts=x.attempts??[];
  const end=at(core.frozenAt),off=at(core.offAt),contractAt=at(contract.frozenAt);
  if(contract.version!=='v2.15.5'||contract.baselineReadinessVersion!=='CONTRACT_V04'
    ||!text(contract.freezeId)||!text(contract.sourceSnapshotId)||!Number.isFinite(contractAt))bad('CURRENT_FROZEN_CONTRACT_REQUIRED');
  if(!text(core.runId)||!text(core.raceId)||!text(core.freezeId)||!text(core.snapshotHash)
    ||!text(core.fieldEligibilityFreezeId)||!text(core.acquisitionFreezeId)
    ||core.contractFreezeId!==contract.freezeId)bad('FREEZE_BINDING_REQUIRED');
  if(core.mode!=='FORWARD'||core.stage!=='ORIGINAL_EARLY'||core.immutableStatus!=='FROZEN'
    ||core.resultPresent!==false||core.cancelled!==false||core.postFreezeMutation!==false)bad('CORE_INVALID_OR_NOT_FORWARD');
  if(!Number.isFinite(end)||!Number.isFinite(off)||end>=off||!Number.isFinite(contractAt)||contractAt>end)bad('PRE_OFF_FREEZE_REQUIRED');
  for(const gate of CORE_GATES)if(core.gates?.[gate]!=='PASS')bad('CORE_GATE_'+gate);
  const runners=core.runnerKeys,final5=core.final5Keys,pairs=core.rolePairs;
  if(!Array.isArray(runners)||runners.length<5||runners.length>99||!runners.every(text)||!unique(runners)
    ||!Array.isArray(final5)||final5.length!==5||!unique(final5)||!final5.every(k=>runners.includes(k)))bad('RUNNER_OR_FINAL5_INVALID');
  else{
    const expected=new Set();for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)expected.add(JSON.stringify([final5[i],final5[j]].sort()));
    if(!Array.isArray(pairs)||pairs.length!==10||pairs.some(p=>!Array.isArray(p?.horseKeys)||p.horseKeys.length!==2||p.status!=='PASS'
      ||!expected.delete(JSON.stringify([...p.horseKeys].sort())))||expected.size)bad('TEN_DISTINCT_ROLE_PAIRS_REQUIRED');
  }
  const plans=contract.fields;
  const fieldRows=Array.isArray(fields)?fields.slice(0,2000).filter(f=>f&&typeof f==='object'):[],attemptRows=Array.isArray(attempts)?attempts.slice(0,8000).filter(a=>a&&typeof a==='object'):[];
  if(!Array.isArray(plans)||!plans.length||plans.length>2000||!Array.isArray(fields)||fields.length>2000
    ||!Array.isArray(attempts)||attempts.length>8000)bad('BOUNDED_LEDGER_REQUIRED');
  const planned=Array.isArray(plans)?plans.slice(0,2000).filter(p=>p&&typeof p==='object'):[],keys=planned.map(p=>p?.eligibilityId);
  if(planned.length!==plans?.length||fieldRows.length!==fields?.length||attemptRows.length!==attempts?.length)bad('LEDGER_ROW_INVALID');
  if(!keys.every(text)||!unique(keys)||!unique(fieldRows.map(f=>f?.eligibilityId))
    ||fieldRows.length!==planned.length||fieldRows.some(f=>!keys.includes(f?.eligibilityId)))bad('TARGET_FIELD_COVERAGE_INVALID');
  if(!unique(planned.map(p=>JSON.stringify([p.scopeKey,p.fieldId]))))bad('DUPLICATE_SCOPE_FIELD');
  const attemptIds=attemptRows.map(a=>a?.attemptId);
  if(!attemptIds.every(text)||!unique(attemptIds)||attemptRows.some(a=>!keys.includes(a?.eligibilityId)))bad('ATTEMPT_IDENTITY_INVALID');
  const missing=[],exhausted=[],numericFields=[],fieldResults=[];
  let eligible=0,resolvedEligible=0,required=0,resolvedAcquire=0,exhaustedAcquire=0,notRequired=0;
  for(const plan of planned){
    if(!plan||!text(plan.fieldId)||!text(plan.requirementSnapshotId)||!ELIGIBILITY.includes(plan.eligibilityStatus)
      ||!['MUST_ACQUIRE','MUST_ATTEMPT_PIPELINE','NOT_REQUIRED'].includes(plan.acquisitionRequired)
      ||typeof plan.numericMetric!=='boolean'||typeof plan.structuralMissing!=='boolean'||!text(plan.scopeKey)
      ||!(plan.scopeKey===core.raceId||(Array.isArray(runners)&&runners.includes(plan.scopeKey)))){bad('FIELD_CONTRACT_INVALID');continue}
    const id=plan.eligibilityId,f=fieldRows.find(f=>f?.eligibilityId===id),isEligible=plan.eligibilityStatus==='ELIGIBLE';
    if(isEligible)eligible++;
    const needs=plan.acquisitionRequired!=='NOT_REQUIRED';if(needs)required++;else notRequired++;
    if(!isEligible&&(!text(plan.eligibilityReasonCode)||!text(plan.reason)))bad('INELIGIBLE_REASON_REQUIRED:'+id);
    if(isEligible&&!needs)bad('ELIGIBLE_CANNOT_SKIP_ACQUISITION:'+id);
    if(!f){bad('FIELD_ROW_MISSING:'+id);continue}
    if(f.runId!==core.runId||f.raceId!==core.raceId||f.fieldId!==plan.fieldId||f.scopeKey!==plan.scopeKey
      ||f.contractFreezeId!==contract.freezeId||f.requirementSnapshotId!==plan.requirementSnapshotId
      ||f.eligibilityStatus!==plan.eligibilityStatus||f.freezeId!==core.fieldEligibilityFreezeId
      ||f.acquisitionFreezeId!==core.acquisitionFreezeId||f.immutableStatus!=='FROZEN'
      ||f.leakageGuard!=='PASS'||f.sourceLineage!=='PASS'||f.conflict!==false)bad('FIELD_BINDING_OR_INTEGRITY_INVALID:'+id);
    const frozen=at(f.frozenAt);if(!Number.isFinite(frozen)||frozen>end||frozen<contractAt)bad('FIELD_FREEZE_TIME_INVALID:'+id);
    const aa=attemptRows.filter(a=>a?.eligibilityId===id);
    for(let i=0;i<aa.length;i++){
      const a=aa[i],time=at(a.attemptedAt);
      if(a.runId!==core.runId||a.raceId!==core.raceId||a.scopeKey!==plan.scopeKey||a.fieldId!==plan.fieldId
        ||a.attemptNo!==i+1||a.tier!==TIERS[i]||!text(a.provider)||!text(a.sourceCandidate)
        ||a.leakageGuard!=='PASS'||a.immutableStatus!=='FROZEN'||!Number.isFinite(time)
        ||time<contractAt||time>frozen||(i>0&&time<at(aa[i-1].attemptedAt))
        ||!['FOUND','NOT_FOUND','READ_FAILED','BLOCKED','NOT_APPLICABLE'].includes(a.result)
        ||(a.result==='FOUND'?!text(a.sourceSnapshotId):!text(a.reasonCode)))bad('ATTEMPT_INVALID:'+id);
    }
    if(f.acquisitionState==='RESOLVED'){
      if(!needs||f.resolutionStatus!=='RESOLVED'||!aa.length||aa.length>4||aa.at(-1)?.result!=='FOUND'
        ||aa.slice(0,-1).some(a=>a.result==='FOUND')||!text(f.sourceSnapshotId)||f.sourceSnapshotId!==aa.at(-1)?.sourceSnapshotId
        ||f.sourceStage!=='EARLY'||f.value===null||f.value===undefined||(plan.numericMetric&&!finite(f.value)))bad('RESOLUTION_PROOF_REQUIRED:'+id);
      else{resolvedAcquire++;if(isEligible){resolvedEligible++;if(plan.numericMetric)numericFields.push({eligibilityId:id,fieldId:plan.fieldId,scopeKey:plan.scopeKey,value:f.value,sourceSnapshotId:f.sourceSnapshotId})}}
      if(!isEligible)bad('INELIGIBLE_CANNOT_STORE_FORMAL_VALUE:'+id);
    }else if(f.acquisitionState==='EXHAUSTED_DECLARED'){
      if(!needs||aa.length!==4||aa.some(a=>a.result==='FOUND')||!text(f.exhaustionCode)||!text(f.exhaustionReason)
        ||!text(f.finalSourceState)||!['SOURCE_MISSING','READ_FAILED'].includes(f.resolutionStatus)||f.value!==null)bad('EXHAUSTION_PROOF_REQUIRED:'+id);
      else{exhaustedAcquire++;exhausted.push({eligibilityId:id,fieldId:plan.fieldId,scopeKey:plan.scopeKey,code:f.exhaustionCode,reason:f.exhaustionReason,attemptIds:aa.map(a=>a.attemptId),finalSourceState:f.finalSourceState})}
      missing.push(id);
    }else if(f.acquisitionState==='NOT_REQUIRED'){
      if(needs||isEligible||f.resolutionStatus!=='NOT_APPLICABLE'||aa.length||f.value!==null)bad('NOT_REQUIRED_CONTRACT_INVALID:'+id);
      // LIVE-only fields do not become EARLY missingness; genuine structural
      // inability at EARLY remains declared rather than fabricated.
      if(plan.structuralMissing===true)missing.push(id);
    }else bad('ACQUISITION_NOT_TERMINAL:'+id);
    fieldResults.push({eligibilityId:id,eligibilityStatus:plan.eligibilityStatus,acquisitionState:f.acquisitionState,
      eligibleNumericDenominator:isEligible&&plan.numericMetric,resolutionStatus:f.resolutionStatus});
  }
  if(required!==resolvedAcquire+exhaustedAcquire)bad('ACQUISITION_COUNT_NOT_TERMINAL');
  const ok=failures.length===0;
  // Classification is a policy candidate, NOT an authenticated adoption receipt.
  return freeze({schemaVersion:PREDICTION_KPI_CONTRACT_VERSION,inputHash,runId:core.runId??null,raceId:core.raceId??null,
    status:ok?'POLICY_READY':'HOLD',formalKpiStatus:ok?(missing.length?'FORMAL_WITH_DECLARED_MISSING':'FORMAL_FULL'):'NOT_FORMAL',
    formalPredictionKpiCandidate:ok,acquisitionGate:required===resolvedAcquire+exhaustedAcquire&&ok?'TERMINAL':'HOLD',
    semanticCompleteness:ok?'PASS':'FAIL',missingFields:missing,acquisitionExhausted:exhausted,
    fieldResults,metricEligibleFields:ok?numericFields:[],counts:{eligibleFieldCount:eligible,resolvedEligibleFieldCount:resolvedEligible,
      eligibleNumericFieldCount:planned.filter(p=>p.eligibilityStatus==='ELIGIBLE'&&p.numericMetric===true).length,
      resolvedEligibleNumericFieldCount:numericFields.length,
      requiredAcquireCount:required,resolvedAcquireCount:resolvedAcquire,exhaustedAcquireCount:exhaustedAcquire,ineligibleNoAcquireCount:notRequired},
    failures:[...new Set(failures)],evidenceInterpretation:'MISSING_IS_NOT_NEGATIVE',
    assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'});
}
