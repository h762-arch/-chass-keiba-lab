/** CHASS CPSI numeric recovery + circuit-separated Wave. Pure ESM, browser/Worker/Node. SHADOW only.
 * Canonical sources: CPSI_INLINE_NUMERIC_COMPAT_v1.0 and HARAN-V02-20260927-FROZEN.
 * Never writes a record, mark, probability, KPI, EV, or frozen EARLY.
 */
export const METRIC_RECOVERY_VERSION='CHASS_CPSI_WAVE_SHADOW_V1_REVIEWED';
export const CPSI_CONTRACT='CPSI_INLINE_NUMERIC_COMPAT_v1.0';
export const JRA_WAVE_FORMULA='HARAN-V02-20260927-FROZEN';
const CORE_WEIGHTS=Object.freeze({A:.20,B:.20,C:.20,D:.15,E:.10,F:.10,G:.05});
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const clamp=(x,l=0,h=100)=>Math.min(h,Math.max(l,x));
const round=(x,d=1)=>finite(x)?Number(x.toFixed(d)):null;
const validScore=x=>finite(x)&&x>=0&&x<=100;
const asText=x=>typeof x==='string'&&x.length>0&&x.length<=256?x.trim():'';
const safeObject=x=>{if(!x||typeof x!=='object'||Array.isArray(x))return false;const p=Object.getPrototypeOf(x);return p===null||Object.getPrototypeOf(p)===null;};
const governance=()=>({researchOnly:true,formalKpiEligible:false,formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',productionExecutionAuthorized:false,sourceOriginAuthenticated:false,provenanceBasis:'CALLER_METADATA_VALIDATED_NOT_SOURCE_AUTHENTICATED',originalEarlyMutation:false,resultLeakage:false,marketToCpsiLeakage:false});
const inactive=new Set(['scratched','excluded','withdrawn','取消','除外','出走取消','競走除外']);
const active=h=>h.eligible!==false&&!inactive.has(h.runnerStatus??h.horseStatus);
const META=['organizer','raceId','runId','inputSnapshotId','kind','isPreResult','capturedAt','authorityRef'];
const indexKeys=[...META,'sourceClass','sourceSnapshotId','peak','baseline5','current','prev','distance','course'];
const domainKeys=[...META,'sourceClass','sourceSnapshotId','indexSnapshotId','use','status','value'];
function copyData(value,depth=0,budget={n:0}){
 if(++budget.n>20000||depth>10)throw Error('INPUT_BOUNDS_EXCEEDED');
 if(value==null||typeof value==='boolean'||typeof value==='number')return value;
 if(typeof value==='string'){if(value.length>1000)throw Error('INPUT_BOUNDS_EXCEEDED');return value;}
 if(!safeObject(value)&&!Array.isArray(value))throw Error('INPUT_DATA_INVALID');
 const out=Array.isArray(value)?[]:{};
 for(const key of Object.keys(value)){
  if(['__proto__','prototype','constructor'].includes(key))throw Error('INPUT_DATA_INVALID');
  const d=Object.getOwnPropertyDescriptor(value,key);if(!Object.hasOwn(d,'value'))throw Error('INPUT_ACCESSOR_FORBIDDEN');
  if(/^(result.*|finishorder|payout|postrace|actual.*|historicalresearch|validation.*)$/i.test(key.replace(/[_-]/g,''))&&d.value!=null&&d.value!==false)throw Error('POST_RESULT_FIELD_FORBIDDEN');
  if(d.value!==undefined)out[key]=copyData(d.value,depth+1,budget);
 }
 return out;
}
function timestamp(x){
 if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(x))return NaN;
 const date=Date.parse(x.slice(0,10)+'T00:00:00Z');
 if(!Number.isFinite(date)||new Date(date).toISOString().slice(0,10)!==x.slice(0,10)||Number(x.slice(11,13))>23||Number(x.slice(14,16))>59||Number(x.slice(17,19))>59)return NaN;
 return Date.parse(x);
}
function provenance(source,input,allowed,idKey='snapshotId'){
 if(!safeObject(source)||Object.keys(source).some(k=>!allowed.includes(k)))return 'SOURCE_SCHEMA_OR_FORBIDDEN_FIELD';
 if(source.organizer!==input.organization||source.raceId!==input.raceId||source.runId!==input.runId||source.inputSnapshotId!==input.inputSnapshotId)return 'SOURCE_IDENTITY_OR_SNAPSHOT_MISMATCH';
 if(source.kind!=='EARLY'||source.isPreResult!==true||!asText(source.authorityRef)||!asText(source[idKey]))return 'SOURCE_AUTHORITY_OR_PRE_MISSING';
 const time=timestamp(source.capturedAt);
 if(!Number.isFinite(time)||time>timestamp(input.freezeAt)||time>input.checkedAt)return 'SOURCE_AFTER_CUTOFF_OR_INVALID_TIME';
 // All sources must be from the same JST race day; older history belongs in an explicitly PRE-built index artifact.
 if(new Date(time+9*3600000).toISOString().slice(0,10)!==input.race.raceDate)return 'SOURCE_RACE_DATE_MISMATCH';
 return null;
}
function guardInput(input){
 if(!safeObject(input)||!['JRA','NAR'].includes(input.organization)||!Array.isArray(input.horses)||input.horses.length<2||input.horses.length>30)return 'INPUT_OR_CIRCUIT_INVALID';
 const r=input.race;
 if(!safeObject(r))return 'RACE_INPUT_INVALID';
 if(['JRA','NAR'].includes(r.raceType)&&r.raceType!==input.organization)return 'RACE_CIRCUIT_MISMATCH';
 for(const o of [input,r])for(const k of Object.keys(o))if(/^(result|RESULT|finishOrder|payout|postRace|actualResult|historicalResearch)$/.test(k)&&o[k]!=null)return 'POST_RESULT_FIELD_FORBIDDEN';
 const nos=input.horses.map(h=>h?.horseNo);
 if(nos.some(n=>!Number.isInteger(n)||n<1||n>99)||new Set(nos).size!==nos.length)return 'RUNNER_IDENTITY_INVALID';
 const match=asText(input.raceId).match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|(\d{1,2})$/);
 if(!match||match[1]!==r.raceDate||match[2]!==r.track||Number(match[3])!==r.raceNo||r.raceNo<1||r.raceNo>20)return 'RACE_IDENTITY_MISMATCH';
 if(!asText(input.runId)||!asText(input.inputSnapshotId))return 'INPUT_FREEZE_ID_MISSING';
 const cutoff=timestamp(input.freezeAt),post=timestamp(input.postAt);
 if(!Number.isFinite(cutoff)||!Number.isFinite(post)||!Number.isFinite(input.checkedAt)||cutoff>input.checkedAt||cutoff>=post||input.checkedAt>=post)return 'CUTOFF_OR_PRESTART_INVALID';
 if(new Date(cutoff+9*3600000).toISOString().slice(0,10)!==r.raceDate||new Date(post+9*3600000).toISOString().slice(0,10)!==r.raceDate)return 'CUTOFF_RACE_DATE_MISMATCH';
 for(const h of input.horses){
  if(!safeObject(h))return 'RUNNER_INPUT_INVALID';
  if(h.canonicalIndex!=null){
   const error=provenance(h.canonicalIndex,input,indexKeys,'sourceSnapshotId');if(error)return error;
   if(!asText(input.indexSnapshotId)||h.canonicalIndex.sourceSnapshotId!==input.indexSnapshotId||h.canonicalIndex.sourceClass!=='CANONICAL_INDEX_PRE')return 'INDEX_SNAPSHOT_MIXING_FORBIDDEN';
  }
  if(h.cpsiDomains!=null){
   if(!safeObject(h.cpsiDomains)||Object.keys(h.cpsiDomains).some(k=>!['D','E','F','G'].includes(k)))return 'DOMAIN_SCHEMA_INVALID';
   for(const s of Object.values(h.cpsiDomains)){
    if(s==null)continue;
    const error=provenance(s,input,domainKeys,'sourceSnapshotId');if(error)return error;
    if(!asText(input.indexSnapshotId)||s.indexSnapshotId!==input.indexSnapshotId||s.sourceClass!=='PRE_COMPONENT_SCORER'||s.use!=='SHADOW')return 'DOMAIN_SOURCE_NOT_AUTHORIZED';
   }
  }
 }
 for(const [key,allowed] of [
  ['market',[...META,'snapshotId','sourceRef','sourceClass','horses']],
  ['waveEvidence',[...META,'snapshotId','indexSnapshotId','indexAuthorityRef','marketSnapshotId','favoriteHighestIndexRank','multiClusterCount','clusterAuthorityRef','marketGapCount','marketGapAuthorityRef']],
  ['narWaveScMc',[...META,'snapshotId','marketSnapshotId','indexSnapshotId','SC','MC']]
 ]){
  const source=input[key];if(source==null)continue;
  const error=provenance(source,input,allowed);if(error)return error;
  if(key==='market'&&(source.snapshotId!==input.marketSnapshotId||!asText(source.sourceRef)||!['PREDICTED_ODDS','REAL_PRE_ODDS'].includes(source.sourceClass)))return 'MARKET_SNAPSHOT_OR_SOURCE_MISMATCH';
  if(key!=='market'&&(!asText(input.indexSnapshotId)||source.indexSnapshotId!==input.indexSnapshotId||!asText(input.marketSnapshotId)||source.marketSnapshotId!==input.marketSnapshotId))return 'WAVE_INPUT_SNAPSHOT_MISMATCH';
 }
 return null;
}
function racePercentiles(horses,field){
 const data=horses.filter(h=>validIndex(h)?.[field]!==undefined&&finite(validIndex(h)?.[field]));
 const values=data.map(h=>h.canonicalIndex[field]).sort((a,b)=>a-b);
 const out=new Map();
 for(const h of data){const v=h.canonicalIndex[field];const n=values.length;
  // A singleton is neutral; ties use the lower PERCENTRANK.INC position.
  const p=n<2?50:100*values.filter(x=>x<v).length/(n-1);
  out.set(h.horseNo,p);
 }
 return out;
}
function validIndex(h){
 const a=h?.canonicalIndex;
 if(!safeObject(a)||a.sourceClass!=='CANONICAL_INDEX_PRE'||provenance(a,h.__input,indexKeys,'sourceSnapshotId')||a.sourceSnapshotId!==h.__input.indexSnapshotId)return null;
 return a;
}
function component(status,value=null,origin=null,reason=null){return {status,value,origin,reason};}
function calcCpsi(input){
 const {organization,horses}=input;
 const initial=horses.map(h=>({...h,__org:organization,__input:input}));
 const sources=new Set(initial.map(validIndex).filter(Boolean).map(x=>`${x.sourceSnapshotId}|${x.authorityRef}`));
 const sourceConflict=sources.size>1;
 const hs=sourceConflict?initial.map(h=>({...h,canonicalIndex:null})):initial;
 const fields=['peak','baseline5','current','prev','distance','course'];
 const ranks=Object.fromEntries(fields.map(f=>[f,racePercentiles(hs,f)]));
 const out=[];
 for(const h of hs){
  const ix=validIndex(h);
  const rr=f=>ranks[f].get(h.horseNo);
  const comps={};
  const has=f=>ix&&finite(ix[f]);
  if(has('peak')&&has('baseline5'))comps.A=component('RESOLVED',round(.55*rr('peak')+.45*rr('baseline5')),ix.sourceSnapshotId);
  else comps.A=component('UNKNOWN',null,null,'PEAK_AND_BASELINE_REQUIRED');
  if(has('current'))comps.B=component('RESOLVED',round(rr('current')),ix.sourceSnapshotId);
  else if(has('prev'))comps.B=component('RESOLVED_PROXY',round(rr('prev')),ix.sourceSnapshotId,'PREV_PROXY_NOT_OBSERVED_CURRENT');
  else comps.B=component('UNKNOWN',null,null,'CURRENT_OR_PREV_REQUIRED');
  if(has('distance')&&has('course'))comps.C=component('RESOLVED',round(.5*rr('distance')+.5*rr('course')),ix.sourceSnapshotId);
  else if(has('distance')||has('course'))comps.C=component('PARTIAL_NEUTRAL_PRIMITIVE',round(.5*(has('distance')?rr('distance'):50)+.5*(has('course')?rr('course'):50)),ix.sourceSnapshotId,'ONE_PRIMITIVE_NEUTRAL50');
  else comps.C=component('UNKNOWN',null,null,'DISTANCE_AND_COURSE_UNKNOWN');
  for(const k of ['D','E','F','G']){
   const s=h?.cpsiDomains?.[k];
   comps[k]=safeObject(s)&&!provenance(s,input,domainKeys,'sourceSnapshotId')&&s.indexSnapshotId===input.indexSnapshotId&&s.sourceClass==='PRE_COMPONENT_SCORER'&&s.use==='SHADOW'&&s.status==='RESOLVED'&&validScore(s.value)
    ?component('RESOLVED',round(s.value),s.sourceSnapshotId)
    :component('UNKNOWN',null,null,'AUTHORIZED_PRE_SCORER_MISSING');
  }
  const coreUsableCount=['A','B','C'].filter(k=>['RESOLVED','RESOLVED_PROXY','PARTIAL_NUMERIC','PARTIAL_NEUTRAL_PRIMITIVE'].includes(comps[k].status)).length;
  const resolvedWeight=Object.keys(comps).filter(k=>['RESOLVED','RESOLVED_PROXY'].includes(comps[k].status)).reduce((sum,k)=>sum+CORE_WEIGHTS[k],0);
  const partialWeight=Object.keys(comps).filter(k=>comps[k].status.startsWith('PARTIAL')).reduce((sum,k)=>sum+CORE_WEIGHTS[k],0);
  // Partial C contains a neutral primitive: its 10% overlaps the 20% partial-domain weight.
  const primitiveNeutralWeight=comps.C.status==='PARTIAL_NEUTRAL_PRIMITIVE'?CORE_WEIGHTS.C/2:0;
  const neutralWeight=1-resolvedWeight-partialWeight+primitiveNeutralWeight;
  const computed=Object.entries(comps).reduce((sum,[k,v])=>sum+CORE_WEIGHTS[k]*(validScore(v.value)?v.value:50),0);
  const observed=Object.entries(comps).filter(([,v])=>v.status==='RESOLVED');
  const observedWeight=observed.reduce((sum,[k])=>sum+CORE_WEIGHTS[k],0);
  const only=observedWeight?observed.reduce((sum,[k,v])=>sum+CORE_WEIGHTS[k]*v.value,0)/observedWeight:null;
  const numeric=coreUsableCount>=2;
  const scoreMode=numeric?(['A','B','C'].every(k=>comps[k].status==='RESOLVED')?'CORE_COMPLETE':'PARTIAL_NUMERIC'):'INSUFFICIENT';
  const reasons=[];
  if(!ix)reasons.push(sourceConflict?'INDEX_SNAPSHOT_MIXING_FORBIDDEN':'CANONICAL_PRE_INDEX_SOURCE_NOT_MATERIALIZED');
  if(coreUsableCount<2)reasons.push('CORE_USABLE_LT_2');
  if(neutralWeight>0)reasons.push('UNOBSERVED_DOMAINS_NEUTRAL50_COMPAT_ONLY');
  out.push({horseNo:h.horseNo,canonicalHorseKey:asText(h.canonicalHorseKey)||null,
   identityMode:asText(h.canonicalHorseKey)?'CANONICAL_HORSE_KEY':'RACE_HORSE_NO_SHADOW_ONLY',
   components:comps,primitiveStatus:Object.fromEntries(fields.map(f=>[f,!has(f)?'UNKNOWN':ranks[f].size===1?'SINGLETON_NEUTRAL':'OBSERVED'])),coreUsableCount,scoreMode,status:numeric?'NUMERIC_SHADOW':'INSUFFICIENT',
   cpsiMainCompat:numeric?round(computed):null,cpsiResolvedOnly:only==null?null:round(only),
   resolvedWeightPct:round(resolvedWeight*100),partialWeightPct:round(partialWeight*100),neutralizedWeightPct:round(neutralWeight*100),
   coverageStatus:resolvedWeight>=1-1e-9?'COMPLETE':resolvedWeight+partialWeight>=.6?'PARTIAL':'LOW_COVERAGE',
   uncertainty:!numeric?'VERY_HIGH':resolvedWeight>=.8&&partialWeight===0?'LOW':resolvedWeight>=.6?'MEDIUM':resolvedWeight>=.4?'HIGH':'VERY_HIGH',
   rankEligible:numeric,rank:null,rankGap:null,reasons});
 }
 const eligible=out.filter(x=>x.rankEligible).sort((a,b)=>b.cpsiMainCompat-a.cpsiMainCompat||a.horseNo-b.horseNo);
 const leader=eligible[0]?.cpsiMainCompat??null;
 for(const r of eligible){r.rank=1+eligible.filter(x=>x.cpsiMainCompat>r.cpsiMainCompat).length;r.rankGap=round(leader-r.cpsiMainCompat);}
 return {version:CPSI_CONTRACT,status:'SHADOW_ONLY',marketBlindIntegrity:'PASS',marketColumnsReferenced:0,weights:CORE_WEIGHTS,
  activeRunnerCount:out.length,numericMaterializedCount:eligible.length,insufficientCount:out.length-eligible.length,rows:out,
  ...governance()};
}
function meanAvailable(pairs){let v=0,w=0;for(const [score,weight] of pairs){if(validScore(score)){v+=score*weight;w+=weight;}}return w?{value:v/w,weight:w}: {value:null,weight:0};}
function classifyWave(w){return w<=34?'LOW':w<=49?'LOW-MID':w<=64?'WATCH':w<80?'HIGH':w<90?'VERY_HIGH':'EXTREME';}
function jraWave(input,cpsi){
 const m=input.market||{},hs=input.horses.filter(h=>h.runnerStatus!=='scratched'&&h.runnerStatus!=='excluded'&&h.runnerStatus!=='withdrawn');
 const N=hs.length,ev=input.waveEvidence||{}, reasons=[];
 // Only explicitly PRE-labelled market allowed, never infer its phase from final odds.
 const isPre=m.kind==='EARLY'&&asText(m.sourceRef)&&asText(m.capturedAt)&&Number.isFinite(Date.parse(m.capturedAt))&&asText(m.snapshotId);
 const marketHorse=Array.isArray(m.horses)?m.horses:[];
 const sourceSet=new Set(marketHorse.map(h=>h.horseNo));
 const exactRoster=sourceSet.size===N&&sourceSet.size===marketHorse.length&&hs.every(h=>sourceSet.has(h.horseNo));
 const sorted=marketHorse.filter(h=>Number.isInteger(h.popularity)&&h.popularity>=1&&finite(h.odds)&&h.odds>0).sort((a,b)=>a.popularity-b.popularity);
 const top3=sorted.slice(0,3),uniqueTop3=top3.length===3&&new Set(top3.map(x=>x.popularity)).size===3&&top3.every((h,i)=>h.popularity===i+1);
 const completeMarket=sorted.length===N&&new Set(sorted.map(h=>h.popularity)).size===N&&sorted.every((h,i)=>h.popularity===i+1&&h.odds>=1);
 const marketReady=isPre&&exactRoster&&uniqueTop3&&completeMarket;
 if(!isPre)reasons.push('FROZEN_EARLY_MARKET_SOURCE_MISSING');
 if(isPre&&!exactRoster)reasons.push('EARLY_MARKET_ROSTER_MISMATCH');
 if(isPre&&exactRoster&&!uniqueTop3)reasons.push('EARLY_TOP3_MARKET_INCOMPLETE');
 if(isPre&&exactRoster&&!completeMarket)reasons.push('EARLY_ALL_RUNNER_MARKET_INCOMPLETE');
 if(N<2)return {version:JRA_WAVE_FORMULA,status:'NOT_APPLICABLE',waveScore:null,reasons:['FIELD_TOO_SMALL'],...governance()};
 const FS=clamp(100*(N-7)/11);
 const rank=ev.favoriteHighestIndexRank;
 const indexAuthorities=new Set(input.horses.map(h=>h.canonicalIndex?.authorityRef).filter(Boolean));
 const rankProven=ev.indexSnapshotId===input.indexSnapshotId&&indexAuthorities.size===1&&indexAuthorities.has(ev.indexAuthorityRef)&&Number.isInteger(rank)&&rank>=1&&rank<=N;
 const FIM=rankProven?clamp(100*(rank-1)/(N-1)):null;
 const CL=Number.isInteger(ev.multiClusterCount)&&ev.multiClusterCount>=0&&ev.multiClusterCount<=N&&asText(ev.clusterAuthorityRef)?ev.multiClusterCount:null;
 const MG=Number.isInteger(ev.marketGapCount)&&ev.marketGapCount>=0&&ev.marketGapCount<=N&&asText(ev.marketGapAuthorityRef)?ev.marketGapCount:null;
 const CD=CL==null?null:clamp(100*CL/N),MGD=MG==null?null:clamp(100*MG/N);
 const O1=marketReady?top3[0].odds:null,FW=O1==null?null:clamp(100*(O1-1.1)/3.9);
 const q=marketReady?top3.map(x=>1/x.odds):[];
 const qsum=q.reduce((x,y)=>x+y,0),p=qsum?q.map(x=>x/qsum):[];
 const ENT=qsum>0?clamp(100*(-p.reduce((sum,x)=>sum+x*Math.log(x),0))/Math.log(3)):null;
 const SC=meanAvailable([[FS,.25],[FIM,.45],[CD,.3]]),MC=meanAvailable([[FW,.4],[ENT,.4],[MGD,.2]]);
 if(!marketReady)reasons.push('MARKET_CHAOS_UNRESOLVED');
 if(SC.value===null)reasons.push('STRUCTURAL_CHAOS_UNRESOLVED');
 const numeric=marketReady&&SC.value!==null&&MC.value!==null;
 const waveScore=numeric?Math.round(.55*SC.value+.45*MC.value):null;
 const marketConflict=numeric?Math.abs(SC.value-MC.value)>=25||(O1<=1.5&&SC.value>=65):null;
 const status=numeric?(SC.weight<1||MC.weight<1?'PARTIAL_NUMERIC_SHADOW':'NUMERIC_SHADOW'):'HOLD';
 const raceMode=waveScore==null?null:waveScore<50?'NORMAL':waveScore<65?'WATCH':waveScore<80?'HIGH_VARIANCE':'EXTREME_VARIANCE';
 return {version:JRA_WAVE_FORMULA,status,formulaId:JRA_WAVE_FORMULA,waveScore,waveClass:waveScore==null?null:classifyWave(waveScore),raceMode,
  structuralChaos:SC.value==null?null:round(SC.value),marketChaos:MC.value==null?null:round(MC.value),marketConflict,
  waveInputSnapshotId:isPre?m.snapshotId:null,sourceClass:isPre?m.sourceClass??'UNKNOWN':null,
  dataCoveragePct:round(100*[FS,FIM,CD,FW,ENT,MGD].filter(validScore).length/6),
  componentCoverage:{structuralWeightPct:round(SC.weight*100),marketWeightPct:round(MC.weight*100)},
  components:{FS:round(FS),FIM:round(FIM),CD:round(CD),FW:round(FW),ENT:round(ENT),MGD:round(MGD)},
  reasons,operationalUse:'SHADOW_ONLY_NO_MARKS',...governance()};
}
function narWave(input){
 const v=input.narWaveScMc;
 const identityOk=safeObject(v)&&v.organizer==='NAR'&&asText(v.authorityRef)&&asText(v.snapshotId)&&v.isPreResult===true;
 const ready=identityOk&&validScore(v.SC)&&validScore(v.MC);
 const waveScore=ready?Math.round(.55*v.SC+.45*v.MC):null;
 return {version:'NAR_Haran_v0.1_EXISTING_SC_MC',status:ready?'NUMERIC_SHADOW':'HOLD',waveScore,
  waveClass:waveScore==null?null:waveScore<=34?'LOW':waveScore<=49?'LOW-MID':waveScore<=64?'WATCH':'HIGH',
  structuralChaos:ready?v.SC:null,marketChaos:ready?v.MC:null,
  reasons:ready?[]:['NAR_CANONICAL_SC_MC_SOURCE_MISSING'],waveInputSnapshotId:ready?v.snapshotId:null,
  noJraWeightsReused:true,...governance()};
}
/** Input is a pre-result research projection. Never pass RESULT or POST input; those are rejected. */
function terminal(reason){return {version:METRIC_RECOVERY_VERSION,status:'HOLD',reasons:[reason],cpsi:null,wave:null,...governance()};}
function population(input){
 const race=input.race,tag=[race.raceType,race.raceName,race.surface,race.specialty].filter(x=>typeof x==='string').join(' ');
 if(/新馬|NEWCOMER/i.test(tag))return 'NEWCOMER_SPECIALIST_REQUIRED';
 if(/障害|JUMP/i.test(tag))return 'JUMP_SPECIALIST_REQUIRED';
 if(/ばんえい|BANEI/i.test(tag))return 'BANEI_SPECIALIST_REQUIRED';
 const required=input.organization==='JRA'?'JRA_STANDARD_INDEX':'NAR_FLAT';
 return race.waveEligibility===required?null:'WAVE_POPULATION_UNVERIFIED';
}
export function calculateCpsiWaveShadow(unsafeInput,{now=Date.now()}={}){
 let input;try{input=copyData(unsafeInput);}catch(e){return terminal(e.message);}
 if(!safeObject(input))return terminal('INPUT_OR_CIRCUIT_INVALID');
 input.checkedAt=now;
 const failure=guardInput(input);
 if(failure)return terminal(failure);
 const clean={...input,horses:input.horses.filter(active)};
 const cpsi=calcCpsi(clean);
 const applicability=clean.horses.length<2?'FIELD_TOO_SMALL':population(input);
 const wave=applicability?{status:applicability==='WAVE_POPULATION_UNVERIFIED'?'HOLD':'NOT_APPLICABLE',waveScore:null,reasons:[applicability],...governance()}:input.organization==='JRA'?jraWave(clean,cpsi):narWave(clean);
 return {version:METRIC_RECOVERY_VERSION,status:'SHADOW_TERMINAL',organization:input.organization,
  raceId:input.raceId,runId:input.runId,inputSnapshotId:input.inputSnapshotId,indexSnapshotId:input.indexSnapshotId??null,marketSnapshotId:input.marketSnapshotId??null,freezeAt:input.freezeAt,checkedAt:new Date(now).toISOString(),cpsi,wave,...governance()};
}

/** PRE-only projection. Sources are caller-supplied artifacts, never authenticated by their labels. */
const own=(object,key)=>{if(!safeObject(object))return undefined;const d=Object.getOwnPropertyDescriptor(object,key);if(!d)return undefined;if(!Object.hasOwn(d,'value'))throw Error('INPUT_ACCESSOR_FORBIDDEN');return d.value;};
export function projectAndCalculateMetricShadow(args={},options={}){
 try{
  const race=own(args,'race'),horses=own(args,'horses'),organization=own(args,'organization'),raceId=own(args,'raceId');
  if(!safeObject(race)||!Array.isArray(horses))return terminal('RACE_OR_HORSES_MISSING');
  if(own(args,'hasResult')===true)return terminal('POST_RESULT_FIELD_FORBIDDEN');
  for(const k of ['result','RESULT','resultSnapshot','finishOrder','payout','postRace','historicalResearch','actualResult']){
   if(own(race,k)!=null)return terminal('POST_RESULT_FIELD_FORBIDDEN');
  }
  const freeze=copyData(own(race,'metricInputFreeze'));
  if(!safeObject(freeze))return terminal('INPUT_FREEZE_ID_MISSING');
  const fields=['runId','inputSnapshotId','indexSnapshotId','marketSnapshotId','freezeAt','postAt'];
  if(Object.keys(freeze).some(k=>!fields.includes(k)))return terminal('INPUT_FREEZE_SCHEMA_INVALID');
  const input={organization,raceId,...freeze,race:{},checkedAt:options.now??Date.now()};
  for(const k of ['raceDate','track','raceNo','raceType','raceName','surface','specialty','waveEligibility'])input.race[k]=own(race,k);
  const batchRaw=own(race,'cpsiCanonicalIndexSnapshot'),batch=batchRaw==null?null:copyData(batchRaw);
  let byHorse;
  if(batch){
   const error=provenance(batch,input,[...META,'snapshotId','horses']);
   if(error)return terminal(error);
   if(batch.snapshotId!==input.indexSnapshotId||!Array.isArray(batch.horses)||batch.horses.length>30)return terminal('INDEX_SNAPSHOT_MIXING_FORBIDDEN');
   byHorse=new Map();
   for(const row of batch.horses){
    if(!safeObject(row)||Object.keys(row).some(k=>!['horseNo','peak','baseline5','current','prev','distance','course'].includes(k)))return terminal('INDEX_ROW_FORBIDDEN_FIELD');
    if(!Number.isInteger(row.horseNo)||byHorse.has(row.horseNo)||!horses.some(h=>own(h,'horseNo')===row.horseNo))return terminal('INDEX_ROSTER_MISMATCH');
    byHorse.set(row.horseNo,row);
   }
  }
  input.horses=horses.map(h=>{
   const horseNo=own(h,'horseNo'),values=byHorse?.get(horseNo);
   let canonicalIndex=null;
   if(batch&&values){
    canonicalIndex={sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:batch.snapshotId};
    for(const k of META)canonicalIndex[k]=batch[k];
    for(const k of ['peak','baseline5','current','prev','distance','course'])canonicalIndex[k]=values[k]??null;
   }else if(!batch)canonicalIndex=copyData(own(h,'canonicalIndex'))??null;
   return {horseNo,canonicalHorseKey:own(h,'canonicalHorseKey'),runnerStatus:own(h,'runnerStatus')??own(h,'horseStatus')??'active',eligible:own(h,'eligible'),canonicalIndex,cpsiDomains:copyData(own(h,'cpsiDomains'))??null};
  });
  input.market=copyData(own(race,'originalEarlyMarket'))??null;
  input.waveEvidence=copyData(own(race,'waveEvidence'))??null;
  input.narWaveScMc=copyData(own(race,'narWaveScMc'))??null;
  return calculateCpsiWaveShadow(input,options);
 }catch(e){return terminal(e.message?.startsWith('INPUT_')||e.message==='POST_RESULT_FIELD_FORBIDDEN'?e.message:'METRIC_PROJECTION_FAILED');}
}
