import {assessEarlyPrefreezeGate} from './early-prefreeze-gate-v1.mjs';

// Prediction availability overlay.
// v1 remains the strict formal-evidence/KPI audit.
// v2.8.3 separates "can we issue/freeze a pre-result prediction?" from
// "is formal KPI evidence complete?" without relaxing temporal integrity.
export const VERSION='CHASS_EARLY_PREFREEZE_AVAILABILITY_V2_8_3';

export const PREDICTION_READINESS=Object.freeze({
  FULL:'FINAL5_READY_FULL',
  DEGRADED:'FINAL5_READY_DEGRADED',
  HOLD:'PREDICTION_HOLD'
});

const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const clean=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);

function strictTimestamp(x){
  if(typeof x!=='string') return NaN;
  const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if(!m) return NaN;
  const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number);
  if(
    y<1000 || month<1 || month>12 ||
    day<1 || day>new Date(Date.UTC(y,month,0)).getUTCDate() ||
    hour>23 || minute>59 || second>59
  ) return NaN;
  if(m[8]!=='Z'&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4,6))>59)) return NaN;
  return Date.parse(x);
}

function safeCopy(input){
  let nodes=0,characters=0;
  const seen=new WeakSet();

  function copy(v,depth=0){
    if(++nodes>4000||depth>8) throw Error();
    if(v===null||typeof v==='boolean') return v;
    if(typeof v==='number'){
      if(!Number.isFinite(v)) throw Error();
      return v;
    }
    if(typeof v==='string'){
      characters+=v.length;
      if(v.length>4096||characters>100000) throw Error();
      return v;
    }
    if(typeof v!=='object'||seen.has(v)) throw Error();
    if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v))) throw Error();
    if(Object.getOwnPropertySymbols(v).length) throw Error();

    seen.add(v);
    const descriptors=Object.getOwnPropertyDescriptors(v);
    let out;

    if(Array.isArray(v)){
      if(v.length>500||Object.keys(descriptors).length!==v.length+1) throw Error();
      out=[];
      for(let i=0;i<v.length;i++){
        const d=descriptors[String(i)];
        if(!d||!d.enumerable||!Object.hasOwn(d,'value')) throw Error();
        out.push(copy(d.value,depth+1));
      }
    }else{
      const names=Object.keys(descriptors);
      if(names.length>100) throw Error();
      out=Object.create(null);
      for(const k of names){
        const d=descriptors[k];
        if(!d.enumerable||!Object.hasOwn(d,'value')) throw Error();
        out[k]=copy(d.value,depth+1);
      }
    }

    seen.delete(v);
    return out;
  }

  if(!record(input)) throw Error();
  return copy(input);
}

function normalizeBoundedInteger(value,min,max,width=2){
  const n=typeof value==='string'&&/^\d{1,2}$/.test(value)?Number(value):value;
  return integer(n,min,max)?String(n).padStart(width,'0'):null;
}

export const normalizeRaceNo=value=>normalizeBoundedInteger(value,1,20,2);
export const normalizeHorseNo=value=>normalizeBoundedInteger(value,1,30,2);

function normalizedInteger(value,min,max){
  const text=normalizeBoundedInteger(value,min,max,2);
  return text===null?null:Number(text);
}

function calendarDate(value){
  if(typeof value!=='string'||!(/^[0-9]{8}$/.test(value)||/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))) return null;
  const d=value.replaceAll('-',''),y=Number(d.slice(0,4)),m=Number(d.slice(4,6)),day=Number(d.slice(6));
  if(y<1000||m<1||m>12||day<1||day>new Date(Date.UTC(y,m,0)).getUTCDate()) return null;
  return d;
}

function legacyParts(raceId){
  if(!clean(raceId)) return null;
  const hyphen=raceId.match(/^(\d{8})-(JRA|NAR)-(.+)-(\d{1,2})$/);
  if(hyphen) return {date:calendarDate(hyphen[1]),raceNo:normalizeRaceNo(hyphen[4]),venue:null};
  const pipe=raceId.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|(\d{1,2})$/);
  return pipe?{date:calendarDate(pipe[1]),raceNo:normalizeRaceNo(pipe[3]),venue:pipe[2]}:null;
}

function canonicalPartsFromRaceId(raceId){
  if(!clean(raceId)) return null;
  const m=raceId.match(/^(\d{8})_(.+)_(\d{1,2})$/);
  if(!m) return null;
  const raceNo=normalizeRaceNo(m[3]);
  const date=calendarDate(m[1]);
  if(!date||!raceNo||!clean(m[2],100)) return null;
  return {date,venue:m[2],raceNo};
}

export function canonicalizeRaceId(input={}){
  let x;
  try{x=safeCopy(input);}catch{return null;}

  if(x.raceId!=null&&!clean(x.raceId)) return null;
  if(x.raceDate!=null&&!calendarDate(x.raceDate)) return null;

  const fromId=canonicalPartsFromRaceId(x.raceId);
  if(fromId) return `${fromId.date}_${fromId.venue}_${fromId.raceNo}`;

  // A malformed structured ID must never fall through as a valid legacy key.
  if(typeof x.raceId==='string'&&/^\d{8}_/.test(x.raceId)) return null;
  const legacy=legacyParts(x.raceId);
  if(legacy){
    if(!legacy.date||!legacy.raceNo) return null;
    if(x.raceDate!=null&&calendarDate(x.raceDate)!==legacy.date) return null;
    if(x.raceNo!=null&&normalizeRaceNo(x.raceNo)!==legacy.raceNo) return null;
    if(legacy.venue!==null&&x.venue!=null&&legacy.venue!==x.venue) return null;
    return x.raceId;
  }

  // Preserve opaque existing IDs rather than inventing an unverified alias.
  if(clean(x.raceId)) return x.raceId;

  const date=calendarDate(x.raceDate);
  const rn=normalizeRaceNo(x.raceNo);
  if(/^\d{8}$/.test(date)&&clean(x.venue,100)&&rn) return `${date}_${x.venue}_${rn}`;

  // Legacy non-underscore IDs are preserved only when no canonical date/venue/raceNo
  // representation can be derived.
  return clean(x.raceId)?x.raceId:null;
}

export function makeRaceLocalHorseKey(input={}){
  try{
    const {canonicalRaceId,horseNo}=safeCopy(input),hn=normalizeHorseNo(horseNo);
    return clean(canonicalRaceId)&&hn?`${canonicalRaceId}|H${hn}`:null;
  }catch{return null;}
}

function addOnce(list,reason){
  if(!list.includes(reason)) list.push(reason);
}

function explicitCpsiNotApplicable(x){
  return x.cpsi?.notApplicable===true
    || x.cpsi?.status==='NOT_APPLICABLE'
    || x.cpsi?.compatStatus==='NOT_APPLICABLE'
    || x.cpsiCompat?.status==='NOT_APPLICABLE';
}

function declaredCpsiAvailable(x){
  return x.cpsi?.compatStatus==='AVAILABLE'
    || x.cpsi?.status==='AVAILABLE'
    || x.cpsiCompat?.status==='AVAILABLE';
}

function cpsiCompatValue(x){
  const declared=[x.cpsi,x.cpsiCompat].find(v=>record(v)&&(v.compatStatus==='AVAILABLE'||v.status==='AVAILABLE'));
  const candidates=[
    declared?.mainCompatScore,
    declared?.MainCompatScore
  ];
  return candidates.find(v=>typeof v==='number'&&Number.isFinite(v));
}

function cpsiCompatValid(x){
  if(!declaredCpsiAvailable(x)) return false;
  if(explicitCpsiNotApplicable(x)) return false;
  const declarations=[x.cpsi,x.cpsiCompat].filter(v=>record(v)&&(v.compatStatus==='AVAILABLE'||v.status==='AVAILABLE'));
  const values=declarations.map(v=>{
    const scores=[v.mainCompatScore,v.MainCompatScore].filter(n=>n!==undefined);
    const counts=[v.coreUsableCount,v.CoreUsableCount].filter(n=>n!==undefined);
    if(!scores.length||!counts.length||!scores.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=100&&n===scores[0])||!counts.every(n=>Number.isSafeInteger(n)&&n>=2&&n===counts[0])) return null;
    return [scores[0],counts[0]];
  });
  return values.length>0&&values.every(v=>v!==null&&v[0]===values[0]?.[0]&&v[1]===values[0]?.[1]);
}

function raceIdentityResolved(x,canonicalRaceId,startAt){
  const rn=normalizeRaceNo(x.raceNo);
  if(!canonicalRaceId||!clean(x.venue,100)||!rn||!Number.isFinite(startAt)) return false;

  if(x.raceDate!=null&&!calendarDate(x.raceDate)) return false;
  const legacy=legacyParts(x.raceId);
  const declaredDate=canonicalPartsFromRaceId(canonicalRaceId)?.date||legacy?.date||calendarDate(x.raceDate);
  if(declaredDate&&new Date(startAt+9*3600000).toISOString().slice(0,10).replaceAll('-','')!==declaredDate) return false;

  const parts=canonicalPartsFromRaceId(canonicalRaceId);
  if(parts){
    if(parts.venue!==x.venue||parts.raceNo!==rn) return false;
    if(x.raceDate!=null){
      if(typeof x.raceDate!=='string') return false;
      const d=x.raceDate.replaceAll('-','');
      if(!/^\d{8}$/.test(d)||d!==parts.date) return false;
    }
  }else{
    // Legacy IDs still require the original strict race-identity gate.
    return assessEarlyPrefreezeGate({...x,raceNo:Number(rn)}).gate.G01.status==='PASS';
  }
  return true;
}

function final5Valid(x,horseNos){
  if(!Array.isArray(x.final5)||x.final5.length!==5) return false;
  const seats=x.final5.map(v=>normalizedInteger(record(v)?v.horseNo:v,1,30));
  const rosterSet=new Set(horseNos);
  return seats.every(n=>n!==null)
    && new Set(seats).size===5
    && seats.every(n=>rosterSet.has(n));
}

function runnerUniverseResolved(x,runners){
  const expected=normalizedInteger(x.expectedRunnerCount,2,30);
  if(expected===null||runners.length!==expected||runners.length<2||runners.length>30) return false;
  const horseNos=runners.map(r=>record(r)?normalizedInteger(r.horseNo,1,30):null);
  return horseNos.every(n=>n!==null)
    && new Set(horseNos).size===horseNos.length
    && runners.every(r=>record(r)&&clean(r.horseName,100));
}

export function assessEarlyPredictionAvailabilityV2(input={}){
  let x;
  try{x=safeCopy(input);}catch{
    return {
      version:VERSION,
      predictionReadiness:PREDICTION_READINESS.HOLD,
      predictionCanFreeze:false,
      predictionQuality:'HOLD',
      formalKpiReadiness:'HOLD',
      formalKpiEligible:false,
      researchOnly:true,
      assessmentBasis:'CALLER_DECLARATIONS_ONLY',
      freezeExecutionAuthorized:false,
      earlyFreezeVerified:false,
      probabilityDecision:'MODEL_HOLD',
      productionActivationDecision:'NO-GO',
      formalKpiAssessmentAuthority:'EXTERNAL_FORMAL_INTEGRATION_REQUIRED',
      canonicalRaceId:null,
      raceLocalHorseKeys:[],
      cpsiCompatStatus:'INVALID_OR_UNAVAILABLE',
      cpsiCompatValue:null,
      holdReasons:['INVALID_DECLARATIONS'],
      degradedReasons:[],
      historicalFormalPromotionAllowed:false,
      retryPolicy:{maxAutomaticRetries:1,afterFailure:'ISOLATE_MODULE_AND_CONVERGE_TO_FULL_DEGRADED_OR_HOLD'}
    };
  }

  const strict=assessEarlyPrefreezeGate(x);
  const holdReasons=[];
  const degradedReasons=[];
  const runners=Array.isArray(x.runners)?x.runners:[];
  const canonicalRaceId=canonicalizeRaceId(x);
  const freezeAt=strictTimestamp(x.freezeAt);
  const startAt=strictTimestamp(x.startAt);
  const resultAt=x.resultAt==null?NaN:strictTimestamp(x.resultAt);

  // True Core failures.
  if(!raceIdentityResolved(x,canonicalRaceId,startAt)) addOnce(holdReasons,'RACE_IDENTITY_UNRESOLVED');
  if(!runnerUniverseResolved(x,runners)) addOnce(holdReasons,'RUNNER_UNIVERSE_UNRESOLVED');
  if(!canonicalRaceId) addOnce(holdReasons,'CANONICAL_RACE_KEY_UNRESOLVED');

  // A valid freeze timestamp is mandatory. Persistence/readback may degrade;
  // the actual pre-start/pre-result temporal anchor may not.
  if(!Number.isFinite(freezeAt)) addOnce(holdReasons,'FREEZE_TIME_INVALID_OR_MISSING');
  if(Number.isFinite(freezeAt)&&Number.isFinite(startAt)&&freezeAt>=startAt) addOnce(holdReasons,'FREEZE_NOT_PRESTART');
  if(x.resultAt!=null&&!Number.isFinite(resultAt)) addOnce(holdReasons,'RESULT_TIME_INVALID');
  if(Number.isFinite(resultAt)&&Number.isFinite(freezeAt)&&freezeAt>=resultAt) addOnce(holdReasons,'FREEZE_NOT_PRERESULT');
  if(x.resultLeakDetected===true||x.postResultLeakDetected===true) addOnce(holdReasons,'RESULT_LEAK_DETECTED');
  if(x.resultPresent===true||x.validationCompleted===true||x.validated===true||(x.result!=null&&x.result!==false)||(x.resultSnapshot!=null&&x.resultSnapshot!==false)) addOnce(holdReasons,'RESULT_ALREADY_PRESENT');

  const horseNos=runners.map(r=>record(r)?normalizedInteger(r.horseNo,1,30):null);
  if(
    horseNos.length!==runners.length
    || horseNos.some(n=>n===null)
    || new Set(horseNos).size!==horseNos.length
  ) addOnce(holdReasons,'RACE_LOCAL_IDENTITY_UNRESOLVED');

  const ambiguous=x.identityAmbiguous===true
    || runners.some(r=>record(r)&&(r.identityAmbiguous===true||r.identityStatus==='AMBIGUOUS'));
  if(ambiguous) addOnce(holdReasons,'IDENTITY_ASSIGNMENT_AMBIGUOUS');

  // Core source temporal integrity must be established. Missing/invalid source time
  // is not merely a persistence problem.
  const sourceTimes=runners.map(r=>record(r)?strictTimestamp(r.capturedAt):NaN);
  if(
    Number.isFinite(freezeAt)
    && (
      sourceTimes.length!==runners.length
      || sourceTimes.some(t=>!Number.isFinite(t))
    )
  ) addOnce(holdReasons,'CORE_SOURCE_TIME_UNVERIFIED');

  if(runners.some(r=>!record(r)||!clean(r.sourceRef,2048))){
    addOnce(holdReasons,'CORE_SOURCE_PROVENANCE_UNVERIFIED');
  }

  if(
    Number.isFinite(freezeAt)
    && sourceTimes.some(t=>Number.isFinite(t)&&t>freezeAt)
  ) addOnce(holdReasons,'POST_FREEZE_SOURCE_IN_CORE');

  if(!final5Valid(x,horseNos)) addOnce(holdReasons,'FINAL5_MISSING_OR_CORRUPT');

  // Quality / persistence failures degrade rather than globally stop prediction.
  if(strict.gate.G03.status!=='PASS'&&!ambiguous) addOnce(degradedReasons,'PERMANENT_HORSE_ID_UNAVAILABLE');
  if(strict.gate.G05.status!=='PASS') addOnce(degradedReasons,'SNAPSHOT_NOT_MATERIALIZED');
  if(strict.gate.G06.status!=='PASS') addOnce(degradedReasons,'EVIDENCE_CARD_NOT_MATERIALIZED');
  if(strict.gate.G09.status!=='PASS') addOnce(degradedReasons,'EARLY_FREEZE_RECEIPT_PENDING');
  if(strict.gate.G10.status!=='PASS') addOnce(degradedReasons,'READBACK_PENDING');

  const cpsiNA=explicitCpsiNotApplicable(x)&&!declaredCpsiAvailable(x);
  const cpsiDeclared=declaredCpsiAvailable(x);
  const cpsiValid=cpsiCompatValid(x);

  if(cpsiDeclared&&!cpsiValid){
    addOnce(degradedReasons,'CPSI_COMPAT_DECLARATION_INVALID');
  }else if(strict.gate.G07.status!=='PASS'&&!cpsiNA){
    addOnce(
      degradedReasons,
      cpsiValid?'FORMAL_CPSI_MODEL_HOLD':'CPSI_UNAVAILABLE_OR_MODEL_HOLD'
    );
  }

  if(runners.some(r=>record(r)&&r.nameConflict===true)&&!ambiguous){
    addOnce(degradedReasons,'NAME_CONFLICT_QUARANTINED');
  }

  if(record(x.optionalModules)){
    for(const state of Object.values(x.optionalModules)){
      const status=record(state)?state.status:state;
      if(['ERROR','MISSING','UNAVAILABLE','PARTIAL'].includes(status)){
        addOnce(degradedReasons,'OPTIONAL_MODULE_DEGRADED');
      }
    }
  }

  const raceLocalHorseKeys=holdReasons.includes('RACE_LOCAL_IDENTITY_UNRESOLVED')
    ? []
    : runners
        .map(r=>makeRaceLocalHorseKey({canonicalRaceId,horseNo:r.horseNo}))
        .filter(Boolean);

  const predictionReadiness=holdReasons.length
    ? PREDICTION_READINESS.HOLD
    : degradedReasons.length
      ? PREDICTION_READINESS.DEGRADED
      : PREDICTION_READINESS.FULL;

  return {
    version:VERSION,
    predictionReadiness,
    predictionCanFreeze:predictionReadiness!==PREDICTION_READINESS.HOLD,
    predictionQuality:
      predictionReadiness===PREDICTION_READINESS.FULL?'FULL'
      : predictionReadiness===PREDICTION_READINESS.DEGRADED?'DEGRADED'
      : 'HOLD',

    // v1 remains authoritative for strict formal KPI certification.
    formalKpiReadiness:'HOLD',
    formalKpiEligible:false,
    formalKpiAssessmentAuthority:'EXTERNAL_FORMAL_INTEGRATION_REQUIRED',
    researchOnly:true,
    assessmentBasis:'CALLER_DECLARATIONS_ONLY',
    freezeExecutionAuthorized:false,
    earlyFreezeVerified:false,
    probabilityDecision:'MODEL_HOLD',
    productionActivationDecision:'NO-GO',

    canonicalRaceId,
    rawRaceId:clean(x.raceId)?x.raceId:null,
    raceLocalHorseKeys,

    cpsiCompatStatus:
      cpsiNA?'NOT_APPLICABLE'
      : cpsiValid?'AVAILABLE'
      : cpsiDeclared?'INVALID'
      : strict.gate.G07.status==='PASS'?'FORMAL_READY_NO_COMPAT_DECLARATION'
      : 'UNKNOWN_OR_UNAVAILABLE',
    cpsiCompatValue:cpsiValid?cpsiCompatValue(x):null,
    cpsiFormalModelStatus:strict.gate.G07.status==='PASS'?'READY':'MODEL_HOLD',

    holdReasons,
    degradedReasons,

    strictCandidateReadiness:strict.candidateReadiness,
    strictFormalReadiness:strict.formalReadiness,

    historicalFormalPromotionAllowed:false,
    retryPolicy:{
      maxAutomaticRetries:1,
      afterFailure:'ISOLATE_MODULE_AND_CONVERGE_TO_FULL_DEGRADED_OR_HOLD'
    }
  };
}
