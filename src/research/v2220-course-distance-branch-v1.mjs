import {resolveCourseContext} from './course-asset-runtime-v1.mjs';

export const BRANCH_KEY='COURSE_DISTANCE_BRANCH';
export const BRANCH_VERSION='CHASS_BRANCH_COURSE_DISTANCE_V2220_ADAPTER_V1';
const governance=()=>({productionMutation:false,originalEarlyMutation:false,resultLeakage:false,validationOnlyLeakage:false,writeSideEffects:false});
const authority=()=>({researchOnly:true,routerWired:false,sourceOriginAuthenticated:false,formalKpiReadiness:'HOLD',formalKpiEligible:false,
  probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',productionExecutionAuthorized:false});
function hold(reason,raceId=null){return {branchKey:BRANCH_KEY,branchVersion:BRANCH_VERSION,raceId,branchStatus:'HOLD',terminalStatus:'HOLD_WITH_REASON',reasons:[reason],assetResolution:[],paceHandoff:null,governance:governance(),...authority()};}
function declaredRace(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||![Object.prototype,null].includes(Object.getPrototypeOf(input)))throw Error();
  const out={};
  for(const k of ['raceId','organizer','venue','venueCode','surface','distance','layout','railVariant']){
    const d=Object.getOwnPropertyDescriptor(input,k);if(!d)continue;
    if(!Object.hasOwn(d,'value'))throw Error();if(d.value===undefined)continue;
    if(d.value!==null&&!['string','number'].includes(typeof d.value))throw Error();
    if(typeof d.value==='string'&&(d.value.length>200||/[\x00-\x1f\x7f]/.test(d.value)))throw Error();out[k]=d.value;
  }
  for(const k of ['result','RESULT','resultSnapshot','finishOrder','validationSnapshot','resultAt','resultAcquiredAt','validated','validationCompleted','historicalResearch']){
    const d=Object.getOwnPropertyDescriptor(input,k);if(!d)continue;if(!Object.hasOwn(d,'value'))throw Error();
    if(d.value!=null&&d.value!==false)out.preForbidden=true;
  }
  return out;
}
function raceIdentityMatches(id,course){
  const a=id.match(/^(\d{8})_(.+)_(\d{1,2})$/),b=id.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|(\d{1,2})$/),c=id.match(/^(\d{8})-(JRA|NAR)-(.+)-(\d{1,2})$/);
  if(!a&&!b&&!c)return false;
  const date=(a?.[1]??b?.[1]??c?.[1]).replaceAll('-',''),raceNo=Number(a?.[3]??b?.[3]??c?.[4]);
  const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6)}T00:00:00Z`,ms=Date.parse(iso);
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,10).replaceAll('-','')!==date||raceNo<1||raceNo>20)return false;
  const venue=a?.[2]??b?.[2]??c?.[3];
  return (venue===course.identity?.venue||venue===course.identity?.venueCode)&&(!c||c[2]===course.identity?.organizer);
}

export async function evaluateCourseDistanceBranch(race, options={}){
  try{race=declaredRace(race);}catch{return hold('RACE_INPUT_INVALID');}
  if(race.preForbidden)return hold('RESULT_OR_HISTORICAL_INPUT_FORBIDDEN_PRE');
  const raceId=String(race?.raceId??'').trim();
  if(!raceId){
    return hold('RACE_ID_MISSING');
  }
  const course=await resolveCourseContext({
    organizer:race.organizer,
    venue:race.venue,
    venueCode:race.venueCode,
    surface:race.surface,
    distance:race.distance,
    layout:race.layout,
    railVariant:race.railVariant
  },options);
  if(course.usableForPre&&!raceIdentityMatches(raceId,course))return hold('RACE_COURSE_IDENTITY_CONFLICT',raceId);
  const mapped = course.status==='READY' ? 'PASS'
    : course.status==='DEGRADED_TERMINAL' ? 'PASS_REASON_TERMINAL'
    : course.status==='SPECIALIST_CONTEXT' ? 'SPECIALIST_TERMINAL'
    : 'HOLD';
  return {
    branchKey:BRANCH_KEY,
    branchVersion:BRANCH_VERSION,
    raceId,
    branchStatus:mapped,
    terminalStatus:mapped==='HOLD'?'HOLD_WITH_REASON':'TERMINAL',
    reasons:course.reasons??[],
    courseProfileId:course.courseProfileId??null,
    courseGeometryId:course.courseGeometryId??null,
    assetResolution:[
      {assetKey:'COURSE_GEOMETRY',sourceAsset:'CHASS_COURSE_PROFILE_V1',resolved:Boolean(course.courseGeometryId),runtimeUse:'STATIC_CANONICAL'},
      {assetKey:'COURSE_DISTANCE_PROFILE',sourceAsset:'CHASS_COURSE_DISTANCE_PROFILE_V1',resolved:Boolean(course.courseProfileId),runtimeUse:'STATIC_CANONICAL'},
      {assetKey:'COURSE_SAMPLE_COVERAGE',sourceAsset:'CHASS_COURSE_SAMPLE_COVERAGE_V1',resolved:course.usableForPre===true,runtimeUse:'SHADOW_GUARD_ONLY'},
      {assetKey:'COURSE_HIST_SAMPLE',sourceAsset:'CHASS_COURSE_HIST_SAMPLE_V1',resolved:false,runtimeUse:'FORBIDDEN_PRE'},
      {assetKey:'COURSE_FORWARD_JOIN',sourceAsset:'CHASS_COURSE_FORWARD_JOIN_V1',resolved:false,runtimeUse:'VALIDATION_ONLY_FORBIDDEN_PRE'},
      {assetKey:'COURSE_FORWARD_READINESS',sourceAsset:'CHASS_COURSE_FORWARD_READINESS_V1',resolved:false,runtimeUse:'VALIDATION_ONLY_FORBIDDEN_PRE'}
    ],
    courseContext:course,
    paceHandoff:course.usableForPre?{
      genericFlatPaceEligible:course.genericFlatPaceEligible,
      requiresSpecialistBranch:course.genericFlatPaceEligible===false,
      courseProfileId:course.courseProfileId,
      startToFirstCornerClass:course.distanceProfile?.startToFirstCornerClass??null,
      firstTurnDistanceM:course.distanceProfile?.firstTurnDistanceM??null,
      turnCount:course.distanceProfile?.turnCount??null,
      finishStraightM:course.geometry?.finishStraightM??null,
      elevationDiffM:course.geometry?.elevationDiffM??null,
      direction:course.geometry?.direction??null,
      layout:course.identity?.layout??null,
      geometryTags:course.geometry?.tags??null,
      frontPressureGeometryCue:course.paceHandoff?.frontPressureGeometryCue??null,
      leadSettlementEaseState:course.paceHandoff?.leadSettlementEaseState??null,
      closingAccessState:course.paceHandoff?.closingAccessState??null,
      longSprintDemandState:course.paceHandoff?.longSprintDemandState??null,
      routeCostState:course.paceHandoff?.routeCostState??null,
      courseDataLineage:course.lineage??null
    }:null,
    governance:governance(),
    ...authority()
  };
}
