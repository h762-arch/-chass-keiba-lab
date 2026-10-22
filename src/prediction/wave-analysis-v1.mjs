/** Read-only Wave research analysis. No forecast, signal, EV, or D1 writes. */
import {projectAndCalculateMetricShadow} from './chass-cpsi-wave-core-v1.mjs';
import {sourceSha256,stableSourceJson} from './cpsi-source-recovery-v1.mjs';
export const WAVE_ANALYSIS_VERSION='CHASS_WAVE_ANALYSIS_APP_V1_RESEARCH';
const number=x=>typeof x==='number'&&Number.isFinite(x);
const score=x=>number(x)&&x>=0&&x<=100;
const clamp=x=>Math.max(0,Math.min(100,x));
const wma=rows=>{const valid=rows.filter(([v])=>score(v));const weight=valid.reduce((s,[,w])=>s+w,0);return {value:weight?valid.reduce((s,[v,w])=>s+v*w,0)/weight:null,weight};};
export const operationalClass=x=>x<=34?'LOW':x<=49?'LOW-MID':x<=64?'WATCH':'HIGH';
const governance=()=>({researchOnly:true,formalKpiEligible:false,sourceOriginAuthenticated:false,originalEarlyMutation:false,resultLeakage:false,decisionInfluence:'CONTEXT_REVIEW_ONLY_NO_MARKS'});
function plain(value,depth=0,budget={n:0}){
 if(++budget.n>100000||depth>24)throw Error('WAVE_INPUT_TOO_LARGE');
 if(value==null||typeof value==='boolean'||number(value))return value;
 if(typeof value==='string'){if(value.length>2000000)throw Error('WAVE_INPUT_TOO_LARGE');return value;}
 if(typeof value!=='object')throw Error('WAVE_INPUT_INVALID');
 const out=Array.isArray(value)?[]:{};
 for(const key of Object.keys(value)){
  const d=Object.getOwnPropertyDescriptor(value,key);
  if(!d||!Object.hasOwn(d,'value')||['__proto__','prototype','constructor'].includes(key))throw Error('WAVE_INPUT_INVALID');
  if(d.value!==undefined)out[key]=plain(d.value,depth+1,budget);
 }
 return out;
}
const isInactive=h=>h.eligible===false||['scratched','excluded','withdrawn','取消','除外','出走取消','競走除外'].includes(h.runnerStatus??h.horseStatus);
function error(reason){return {schemaVersion:WAVE_ANALYSIS_VERSION,status:'ERROR_TERMINAL',reasons:[reason],canonical:null,operational:null,...governance()};}
function marketRows(m,hs){
 if(!m)return null;
 const rows=m.horses;
 if(!Array.isArray(rows)||rows.length!==hs.length||new Set(rows.map(x=>x.horseNo)).size!==hs.length||hs.some(h=>!rows.some(x=>x.horseNo===h.horseNo)))throw Error('WAVE_MARKET_ROSTER_MISMATCH');
 if(rows.some(x=>!Number.isInteger(x.popularity)||x.popularity<1||!number(x.odds)||x.odds<1))throw Error('WAVE_MARKET_VALUE_INVALID');
 const sorted=[...rows].sort((a,b)=>a.popularity-b.popularity);
 if(sorted.some((x,i)=>x.popularity!==i+1||(i&&x.odds<sorted[i-1].odds)))throw Error('WAVE_MARKET_RANK_INVALID');
 return sorted;
}
function eligiblePriors(priors,race,freezeAt){
 if(priors==null)return {known:false,rows:[],scope:null};
 if(!Array.isArray(priors)||priors.length>10000)throw Error('WAVE_PRIOR_INPUT_INVALID');
 const cut=Date.parse(freezeAt);
 const rows=priors.filter(p=>p&&p.organization===race.raceType&&p.authorityFamily===`${race.raceType}_WAVE`&&p.formulaFamily===(race.raceType==='NAR'?'NAR_HARAN_V01':'JRA_HARAN_V02')&&p.semanticVersion===1&&p.scoreScale==='0_100_CONTEXT_SCORE'&&p.preResultFrozen===true&&p.resultLeakage===false&&p.currentEvidence===true&&['FULL_CANONICAL','AVAILABLE_WEIGHT_CURRENT','MARKET_ONLY_CURRENT','STRUCTURE_ONLY_CURRENT'].includes(p.mode)&&score(p.score)&&typeof p.recordId==='string'&&p.recordId&&typeof p.contentHash==='string'&&/^sha256:[0-9a-f]{64}$/.test(p.contentHash)&&p.raceId!==`${race.raceDate}|${race.track}|${race.raceNo}`&&Number.isFinite(Date.parse(p.freezeAt))&&Date.parse(p.freezeAt)<cut&&Date.parse(p.freezeAt)<Date.parse(p.postAt));
 if(new Set(rows.map(p=>p.recordId)).size!==rows.length)throw Error('WAVE_PRIOR_DUPLICATE');
 const levels=[['VENUE_DISTANCE_FIELD',p=>p.track===race.track&&race.distanceBand&&p.distanceBand===race.distanceBand&&race.fieldSizeBand&&p.fieldSizeBand===race.fieldSizeBand],['VENUE_DISTANCE',p=>p.track===race.track&&race.distanceBand&&p.distanceBand===race.distanceBand],['VENUE',p=>p.track===race.track],['CIRCUIT',()=>true]];
 for(const [scope,match] of levels){const selected=rows.filter(match);if(selected.length)return {known:true,rows:selected,scope};}
 return {known:true,rows:[],scope:'CIRCUIT'};
}
/** priors=null means NOT_READ, [] means a caller explicitly supplied an empty set. Neither authenticates a source. */
export function analyzeWave(root,{now=Date.now(),priors=null}={}){
 try{
  const clean=plain(root),race=clean?.race,hs=clean?.horses;
  if(!race||!Array.isArray(hs)||!['JRA','NAR'].includes(race.raceType))return error('WAVE_RACE_INPUT_INVALID');
  const raceId=`${race.raceDate}|${race.track}|${race.raceNo}`;
  const checked=projectAndCalculateMetricShadow({race,horses:hs,organization:race.raceType,raceId,hasResult:['result','resultSnapshot','validationSnapshot','finishOrder','payout','validated','validationCompleted'].some(k=>clean[k]!=null&&clean[k]!==false)},{now});
  if(!checked.cpsi)return error(checked.reasons?.[0]||'WAVE_INPUT_REJECTED');
  if(checked.wave?.status==='NOT_APPLICABLE'||checked.wave?.reasons?.includes('WAVE_POPULATION_UNVERIFIED'))return error(checked.wave.reasons[0]);
  const active=hs.filter(h=>!isInactive(h)),N=active.length,market=race.originalEarlyMarket,rows=marketRows(market,active),ev=race.waveEvidence||{},freeze=race.metricInputFreeze;
  if(active.some(h=>typeof h.canonicalHorseKey!=='string'||!h.canonicalHorseKey)||new Set(active.map(h=>h.canonicalHorseKey)).size!==N)return error('WAVE_HORSE_KEY_MISSING_OR_DUPLICATE');
  const reasons=[],components={},jra=race.raceType==='JRA';
  const refs=new Set(active.map(h=>h.canonicalIndex?.authorityRef).filter(Boolean));
  const rank=ev.favoriteHighestIndexRank;
  const validRank=!!rows&&refs.size===1&&refs.has(ev.indexAuthorityRef)&&ev.indexSnapshotId===freeze.indexSnapshotId&&Number.isInteger(rank)&&rank>=1&&rank<=N;
  const count=(key,ref)=>{
   const value=ev[key];if(value==null){reasons.push('PROCESS_MISSING_INDEX_DERIVED_'+key);return null;}
   if(!Number.isInteger(value)||value<0||value>N||typeof ev[ref]!=='string'||!ev[ref].trim())throw Error('WAVE_INDEX_DERIVED_INVALID');
   return clamp(100*value/N);
  };
  if(jra)components.FS=clamp(100*(N-7)/11);
  components.FIM=validRank?clamp(100*(rank-1)/(N-1)):null;
  components.CD=count('multiClusterCount','clusterAuthorityRef');
  components.FW=rows?clamp(100*(rows[0].odds-1.1)/3.9):null;
  if(rows&&rows.length>=3){const q=rows.slice(0,3).map(h=>1/h.odds),sum=q.reduce((a,b)=>a+b,0);components.ENT=clamp(100*(-q.reduce((a,b)=>{const p=b/sum;return a+p*Math.log(p);},0))/Math.log(3));}else components.ENT=null;
  components.MGD=count('marketGapCount','marketGapAuthorityRef');
  // NAR compatibility explicitly recovers VFS=UNKNOWN only; never import JRA FS.
  const SC=wma(jra?[[components.FS,.25],[components.FIM,.45],[components.CD,.30]]:[[components.FIM,.45],[components.CD,.30]]);
  const MC=wma([[components.FW,.4],[components.ENT,.4],[components.MGD,.2]]);
  // MC requires an actual complete, PRE-labelled market, even if MG exists.
  if(!rows){MC.value=null;MC.weight=0;reasons.push('FROZEN_EARLY_MARKET_SOURCE_MISSING');}
  // Previously materialized NAR SC/MC is independently bound and validated by the existing Core.
  if(!jra&&race.narWaveScMc){SC.value=race.narWaveScMc.SC;MC.value=race.narWaveScMc.MC;if(!score(SC.value)||!score(MC.value))return error('NAR_SC_MC_INVALID');reasons.push('SAVED_NAR_SC_MC_COMPONENT_COVERAGE_UNVERIFIED');}
  const both=score(SC.value)&&score(MC.value),known=Object.values(components).filter(score).length,total=Object.keys(components).length;
  const full=both&&known===total&&!race.narWaveScMc;
  const canonicalScore=both?Math.round(.55*SC.value+.45*MC.value):null;
  let mode=null,value=null,origin=null,confidence=null,influence=null,prior=null;
  if(both){mode=full?'FULL_CANONICAL':'AVAILABLE_WEIGHT_CURRENT';value=canonicalScore;origin=full?'CURRENT_CANONICAL':'CURRENT_PARTIAL';confidence=full?'UNRATED_CANONICAL':'UNRATED_PARTIAL';influence='PRESERVATION_BOUNDARY_RECHECK';}
  else if(score(MC.value)){mode='MARKET_ONLY_CURRENT';value=Math.round(MC.value);origin='CURRENT_MARKET_ONLY';confidence='LOW';influence='CANDIDATE_BREADTH_FAVORITE_RECHECK';}
  else if(score(SC.value)){mode='STRUCTURE_ONLY_CURRENT';value=Math.round(SC.value);origin='CURRENT_STRUCTURE_ONLY';confidence='LOW';influence='CANDIDATE_BREADTH_BOUNDARY_RECHECK';}
  else{
   const resolved=eligiblePriors(priors,race,freeze.freezeAt);
   if(!resolved.known)reasons.push('PRIOR_NOT_READ');
   else if(resolved.rows.length){const values=resolved.rows.map(p=>p.score).sort((a,b)=>a-b),n=values.length;value=n%2?values[(n-1)/2]:(values[n/2-1]+values[n/2])/2;mode='HISTORICAL_PRIOR';origin='PRIOR';confidence='VERY_LOW';influence='READ_BUDGET_OR_COVERAGE_ONLY';prior={scope:resolved.scope,count:n,recordIds:resolved.rows.map(p=>p.recordId),median:value};}
   else{value=50;mode='COLD_START_NEUTRAL';origin='COLD_START';confidence='MINIMAL';influence='DISPLAY_ONLY';prior={scope:'CIRCUIT',count:0,recordIds:[],median:null};}
  }
  const isCurrent=['FULL_CANONICAL','AVAILABLE_WEIGHT_CURRENT','MARKET_ONLY_CURRENT','STRUCTURE_ONLY_CURRENT'].includes(mode),comparable=['FULL_CANONICAL','AVAILABLE_WEIGHT_CURRENT'].includes(mode);
  const conflict=both?(Math.abs(SC.value-MC.value)>=25||(!!rows&&rows[0].odds<=1.5&&SC.value>=65)):null;
  const sourceClass=market?.sourceClass??'UNKNOWN';
  if(jra&&['FULL_CANONICAL','AVAILABLE_WEIGHT_CURRENT'].includes(mode)){
   const minutes=(Date.parse(freeze.postAt)-Date.parse(market?.capturedAt))/60000;
   const maturity=Number.isFinite(minutes)&&minutes>=0?(minutes<=15?100:minutes<=60?90:minutes<=180?75:minutes<=360?60:minutes<=720?45:30):null;
   const dc=100*known/total;
   confidence=dc===100&&maturity>=75?'HIGH':dc>=100*5/6&&maturity>=45?'MEDIUM':'LOW';
  }
  const formulaId=jra?'HARAN-V02-20260927-FROZEN':'NAR-HARAN-V01-20260928-PROPOSED';
  return {schemaVersion:WAVE_ANALYSIS_VERSION,status:mode&&!reasons.some(r=>r.startsWith('PROCESS_MISSING'))?'ANALYSIS_TERMINAL':'RECOVERY_PENDING',raceId,organization:race.raceType,runId:freeze.runId,inputSnapshotId:freeze.inputSnapshotId,indexSnapshotId:freeze.indexSnapshotId??null,marketSnapshotId:freeze.marketSnapshotId??null,freezeAt:freeze.freezeAt,postAt:freeze.postAt,checkedAt:new Date(now).toISOString(),authorityVersion:jra?'JRA_WAVE_v1.2':'NAR_WAVE_COMPONENT_COMPAT_v1.0',canonical:{score:canonicalScore,class:canonicalScore==null?null:jra&&canonicalScore>=80?(canonicalScore>=90?'EXTREME':'VERY_HIGH'):operationalClass(canonicalScore),formulaId,status:both?(full?'NUMERIC':'PARTIAL_NUMERIC'):'INSUFFICIENT_INPUT',structuralChaos:SC.value,marketChaos:MC.value,components,componentWeight:{structural:SC.weight,market:MC.weight},marketConflict:conflict},operational:{score:value,class:value==null?null:operationalClass(value),mode,origin,confidence,canonicalComparable:comparable,currentEvidence:isCurrent,decisionInfluence:influence,lowDecisionGrade:value!=null&&value<=34?'UNTRUSTED':'NOT_APPLICABLE',boundaryWatch:value!=null&&value>=45&&value<=49,prior},roles:{winUpsetRisk:'UNKNOWN',placeTailRisk:'UNKNOWN',marketReliability:sourceClass==='PREDICTED_ODDS'?'LOW':'UNKNOWN'},quality:{dataCoveragePct:100*known/total,sourceClass,reasons,sourceOriginAuthenticated:false,priorSourceAuthenticated:false},runnerContexts:active.map(h=>({canonicalHorseKey:h.canonicalHorseKey,horseNo:h.horseNo,waveInputSnapshotId:freeze.inputSnapshotId,propagationStatus:'MATCH'})),...governance()};
 }catch(e){return error(e.message?.startsWith('WAVE_')?e.message:'WAVE_INPUT_INVALID');}
}
export async function createWaveArtifact(root,options={}){
 const input=plain(root),priors=options.priors==null?null:plain(options.priors),result=analyzeWave(input,{...options,priors});
 if(result.status==='ERROR_TERMINAL')throw Error(result.reasons[0]);
 const inputHash=await sourceSha256({input,priors}),body={engineVersion:WAVE_ANALYSIS_VERSION,inputHash,input,priors,analyzedAt:result.checkedAt,result};
 return {format:'CHASS_WAVE_RESEARCH_ARTIFACT_V1',contentHash:await sourceSha256(body),body};
}
export async function verifyWaveArtifact(artifact){
 if(artifact?.format!=='CHASS_WAVE_RESEARCH_ARTIFACT_V1'||artifact.contentHash!==await sourceSha256(artifact.body))throw Error('WAVE_ARTIFACT_HASH_MISMATCH');
 const {body}=artifact;
 if(body.engineVersion!==WAVE_ANALYSIS_VERSION||body.inputHash!==await sourceSha256({input:body.input,priors:body.priors}))throw Error('WAVE_ARTIFACT_INPUT_MISMATCH');
 const calculated=analyzeWave(body.input,{now:Date.parse(body.analyzedAt),priors:body.priors});
 if(stableSourceJson(calculated)!==stableSourceJson(body.result))throw Error('WAVE_ARTIFACT_RECOMPUTE_MISMATCH');
 return artifact;
}
export async function saveWaveArtifact(store,artifact){
 await verifyWaveArtifact(artifact);
 const key='CHASS_WAVE_RESEARCH_V1:'+artifact.contentHash;
 const bytes=JSON.stringify(artifact),existing=store.getItem(key);
 if(existing!=null&&existing!==bytes)throw Error('WAVE_ARTIFACT_IMMUTABLE_CONFLICT');
 if(existing==null)store.setItem(key,bytes);
 const restored=JSON.parse(store.getItem(key)||'null');await verifyWaveArtifact(restored);
 if(stableSourceJson(restored)!==stableSourceJson(artifact))throw Error('WAVE_DEVICE_READBACK_FAILED');
 return {key,status:'READBACK_VERIFIED',artifact:restored};
}
/** Every race is isolated; one rejected race cannot rewrite or invalidate another. */
export async function createWaveBatch(sources,options={}){
 if(!Array.isArray(sources)||!sources.length||sources.length>24)throw Error('WAVE_BATCH_COUNT_INVALID');
 const rows=[];
 for(let i=0;i<sources.length;i++){
  try{const entry=sources[i];rows.push({index:i,artifact:await createWaveArtifact(entry.input??entry,{...options,priors:entry.priors??null}),error:null});}
  catch(e){rows.push({index:i,artifact:null,error:e.message});}
 }
 return rows;
}
