// Independent declaration assessment only: no IO, writes, freezes or KPI promotion.
export const VERSION='CHASS_EARLY_PREFREEZE_GATE_V1';
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const has=(x,max=512)=>typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim()&&!/[\x00-\x1f\x7f]/.test(x);
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
function timestamp(x){
 if(typeof x!=='string')return NaN;
 const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
 if(!m)return NaN;
 const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number);
 if(y<1000||month<1||month>12||day<1||day>new Date(Date.UTC(y,month,0)).getUTCDate()||hour>23||minute>59||second>59)return NaN;
 if(m[8]!=='Z'&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4,6))>59))return NaN;
 return Date.parse(x);
}
function copyDeclarations(input){
 let nodes=0,characters=0;const seen=new WeakSet();
 function copy(v,depth=0){
  if(++nodes>4000||depth>8)throw Error();
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='number'){if(!Number.isFinite(v))throw Error();return v;}
  if(typeof v==='string'){characters+=v.length;if(v.length>4096||characters>100000)throw Error();return v;}
  if(typeof v!=='object'||seen.has(v))throw Error();
  if(!Array.isArray(v)&&![Object.prototype,null].includes(Object.getPrototypeOf(v)))throw Error();
  if(Object.getOwnPropertySymbols(v).length)throw Error();
  seen.add(v);const descriptors=Object.getOwnPropertyDescriptors(v);let out;
  if(Array.isArray(v)){
   if(v.length>500||Object.keys(descriptors).length!==v.length+1)throw Error();
   out=[];for(let i=0;i<v.length;i++){const d=descriptors[String(i)];if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw Error();out.push(copy(d.value,depth+1));}
  }else{
   const names=Object.keys(descriptors);if(names.length>100)throw Error();out=Object.create(null);
   for(const k of names){const d=descriptors[k];if(!d.enumerable||!Object.hasOwn(d,'value'))throw Error();out[k]=copy(d.value,depth+1);}
  }
  seen.delete(v);return out;
 }
 if(!record(input))throw Error();return copy(input);
}
export function assessEarlyPrefreezeGate(input={}){
 let x,inputStatus='DECLARATIONS_ONLY';try{x=copyDeclarations(input);}catch{x={};inputStatus='INVALID_INPUT';}
 const runners=Array.isArray(x.runners)&&x.runners.length<=30?x.runners:[],roster=runners.length>=2&&runners.every(record),f=timestamp(x.freezeAt),s=timestamp(x.startAt),g={};
 const put=(id,pass,reason)=>g[id]={status:pass?'PASS':'HOLD',reason:pass?null:reason};
 const before=Number.isFinite(f)&&Number.isFinite(s)&&f<s&&(x.resultAt==null||(Number.isFinite(timestamp(x.resultAt))&&f<timestamp(x.resultAt)));
 const captured=r=>timestamp(r.capturedAt),evidenceSaved=r=>timestamp(r.evidenceSavedAt),snapshotSaved=timestamp(x.snapshot?.savedAt);
 put('G01',has(x.raceId)&&has(x.venue,100)&&integer(x.raceNo,1,20)&&Number.isFinite(s),'RACE_IDENTITY_MISSING');
 put('G02',roster&&integer(x.expectedRunnerCount,2,30)&&runners.length===x.expectedRunnerCount&&runners.every(r=>integer(r.horseNo,1,30)&&has(r.horseName,100))&&new Set(runners.map(r=>r.horseNo)).size===runners.length,'RUNNER_ROSTER_MISSING');
 put('G03',roster&&runners.every(r=>has(r.canonicalId)&&has(r.identitySource,2048)&&r.identityVerified===true)&&new Set(runners.map(r=>r.canonicalId)).size===runners.length,'CANONICAL_ID_MISSING');
 put('G04',before&&roster&&runners.every(r=>Number.isFinite(captured(r))&&captured(r)<=f&&has(r.sourceRef,2048)),'PRE_RESULT_TIME_UNVERIFIED');
 put('G05',before&&roster&&has(x.snapshot?.id)&&sha(x.snapshot?.hash)&&Number.isFinite(snapshotSaved)&&snapshotSaved<=f&&x.snapshot?.readback===true&&runners.every(r=>Number.isFinite(captured(r))&&captured(r)<=snapshotSaved),'SNAPSHOT_UNVERIFIED');
 put('G06',before&&roster&&Number.isFinite(snapshotSaved)&&snapshotSaved<=f&&runners.every(r=>has(r.evidenceId)&&has(r.evidenceSource,2048)&&Number.isFinite(evidenceSaved(r))&&Number.isFinite(captured(r))&&captured(r)<=evidenceSaved(r)&&evidenceSaved(r)<=snapshotSaved&&r.evidenceReadback===true),'EVIDENCE_MISSING');
 put('G07',x.cpsi?.coverageVerified===true&&x.cpsi?.modelReady===true,'CPSI_MODEL_HOLD');
 const marketUnavailable=x.market?.status==='NOT_AVAILABLE',marketDeclared=before&&has(x.market?.source,2048)&&Number.isFinite(timestamp(x.market?.capturedAt))&&timestamp(x.market.capturedAt)<=f;
 g.G08={status:marketUnavailable||marketDeclared?'PASS':'MARKET_UNKNOWN',reason:marketUnavailable||marketDeclared?null:'MARKET_UNKNOWN'};
 put('G09',before&&has(x.early?.freezeId)&&sha(x.early?.signalHash)&&x.early?.immutable===true&&x.early?.readback===true&&timestamp(x.early?.freezeAt)===f,'EARLY_FREEZE_UNVERIFIED');
 put('G10',x.readback?.snapshot===true&&x.readback?.evidence===true&&x.readback?.early===true&&['G05','G06','G09'].every(k=>g[k].status==='PASS'),'READBACK_MISMATCH');
 const required=['G01','G02','G03','G04','G05','G06','G07','G09','G10'];
 const candidateReadiness=required.every(k=>g[k].status==='PASS')?'PASS':'HOLD';
 // No caller flag can authenticate receipts or promote this independent module.
 put('G11',false,'FORMAL_INTEGRATION_NOT_VERIFIED');
 const resultAt=timestamp(x.resultAt),comparedAt=timestamp(x.resultAudit?.comparedAt);
 put('G12',before&&Number.isFinite(resultAt)&&resultAt>=s&&Number.isFinite(comparedAt)&&comparedAt>=resultAt&&has(x.early?.freezeId)&&x.resultAudit?.originalFreezeId===x.early.freezeId&&x.resultAudit?.compared===true,'RESULT_AUDIT_PENDING');
 return {version:VERSION,inputStatus,assessmentBasis:'CALLER_DECLARATIONS_ONLY',temporalVerification:'DECLARED_RELATIVE_ORDER_ONLY',candidateReadiness,formalReadiness:'HOLD',formalKpiEligible:false,researchOnly:true,persistenceVerified:false,acquisitionCertified:false,earlyFreezeVerified:false,earlyImmutable:null,declaredEarlyImmutable:x.early?.immutable===true,formalContractDeclared:x.formalContractVerified===true,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',marketAvailability:marketUnavailable?'NOT_AVAILABLE':marketDeclared?'DECLARED':'UNKNOWN',gate:g,blockingReasons:[...required,'G11'].filter(k=>g[k].status!=='PASS').map(k=>g[k].reason)};
}
