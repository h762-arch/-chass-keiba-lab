// PRE-only projection. Never reads RESULTS, never writes Snapshot, never authorizes prediction.
export const COURSE_SHADOW_VERSION='CHASS_V2220_WEB_WORKER_SHADOW_V1';
export const SHADOW_POLICY=Object.freeze({researchOnly:true,routerWired:false,formalKpiReadiness:'HOLD',formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',productionExecutionAuthorized:false,productionMutation:false,originalEarlyMutation:false,resultLeakage:false,validationOnlyLeakage:false,writeSideEffects:false});
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const read=(x,k)=>{if(!plain(x))return undefined;const d=Object.getOwnPropertyDescriptor(x,k);if(!d)return undefined;if(!Object.hasOwn(d,'value'))throw Error('COURSE_INPUT_ACCESSOR_FORBIDDEN');return d.value;};
export function shadowHold(reason,{raceId=null}={}){return Object.freeze({phase:COURSE_SHADOW_VERSION,branchStatus:'HOLD',terminalStatus:'HOLD_WITH_REASON',raceId,reasons:[reason],courseContext:null,paceHandoff:null,...SHADOW_POLICY});}
export function projectCoursePreRace(snapshot){
 try{
  if(!plain(snapshot))return {hold:'COURSE_SNAPSHOT_INVALID'};
  if(['RESULT','result','resultSnapshot','finishOrder','validationSnapshot','resultAt','resultAcquiredAt','validated','validationCompleted','historicalResearch'].some(k=>read(snapshot,k)!=null&&read(snapshot,k)!==false))return {hold:'RESULT_OR_HISTORICAL_INPUT_FORBIDDEN_PRE'};
  const layers=read(snapshot,'layers');if(plain(layers)&&read(layers,'RESULT')!=null)return {hold:'RESULT_OR_HISTORICAL_INPUT_FORBIDDEN_PRE'};
  const source=plain(layers)?read(layers,'SOURCE'):null;
  const race=read(snapshot,'race')??read(source,'race')??read(read(snapshot,'predictionSnapshot'),'race');
  if(!plain(race))return {hold:'COURSE_RACE_INPUT_MISSING'};
  const organization=read(snapshot,'organization')??read(snapshot,'organizer')??read(race,'organization')??read(race,'organizer');
  const id=read(snapshot,'raceId')??read(race,'raceId');
  // Static fields ONLY. Never infer an A rail variant from a course-profile file.
  const input={raceId:id,organizer:organization,venue:read(race,'venue')??read(race,'track')??read(race,'racecourse'),venueCode:read(race,'venueCode'),surface:read(race,'surface'),distance:read(race,'distance'),layout:read(race,'layout'),railVariant:read(race,'railVariant')};
  if(typeof input.raceId!=='string'||input.raceId.length>120)return {hold:'RACE_ID_MISSING'};
  if(['芝','T'].includes(input.surface)&&(!input.railVariant||!['A','B','C','D','E'].includes(input.railVariant)))return {hold:'COURSE_RAIL_VARIANT_REQUIRED',raceId:input.raceId};
  return {input};
 }catch{return {hold:'COURSE_SNAPSHOT_INVALID'};}
}
function sameRace(id,course){
 const a=id.match(/^(\d{8})_(.+)_(\d{1,2})$/),b=id.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|(\d{1,2})$/),c=id.match(/^(\d{8})-(JRA|NAR)-(.+)-(\d{1,2})$/);
 if(!a&&!b&&!c)return false;
 const date=(a?.[1]??b?.[1]??c?.[1]).replaceAll('-',''),n=Number(a?.[3]??b?.[3]??c?.[4]);
 if(n<1||n>20||!Number.isSafeInteger(n))return false;
 const ms=Date.parse(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T00:00:00Z`);
 return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10).replaceAll('-','')===date&&
 [course?.identity?.venue,course?.identity?.venueCode].includes(a?.[2]??b?.[2]??c?.[3])&&(!c||c[2]===course?.identity?.organizer);
}
export function mapCourseShadow(course,raceId,{originVerified=false}={}){
 if(course?.usableForPre&& !sameRace(raceId,course))return shadowHold('RACE_COURSE_IDENTITY_CONFLICT',{raceId});
 const branchStatus=course?.status==='READY'?'PASS':course?.status==='DEGRADED_TERMINAL'?'PASS_REASON_TERMINAL':course?.status==='SPECIALIST_CONTEXT'?'SPECIALIST_TERMINAL':'HOLD';
 return Object.freeze({phase:COURSE_SHADOW_VERSION,branchStatus,terminalStatus:branchStatus==='HOLD'?'HOLD_WITH_REASON':'TERMINAL',raceId,reasons:course?.reasons??['COURSE_UNKNOWN'],courseProfileId:course?.courseProfileId??null,courseContext:course??null,paceHandoff:course?.genericFlatPaceEligible===true&&course?.usableForPre===true?Object.freeze({courseProfileId:course.courseProfileId,railVariant:course.identity?.railVariant??null,layout:course.identity?.layout??null,frontPressureGeometryCue:course.paceHandoff?.frontPressureGeometryCue??null,startToFirstCornerClass:course.distanceProfile?.startToFirstCornerClass??null,firstTurnDistanceM:course.distanceProfile?.firstTurnDistanceM??null,finishStraightM:course.geometry?.finishStraightM??null,requiresIndependentHorseAndJockeyIntent:true}):null,sourceOriginAuthenticated:originVerified,...SHADOW_POLICY});
}
