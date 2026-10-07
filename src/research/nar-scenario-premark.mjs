// Isolated pre-mark research. No assignment, sealing, storage, fetch or app wiring.
export const NAR_PREMARK_SCHEMA='NAR-SCENARIO-PREMARK-RESEARCH-1';
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const reject=reason=>freeze({status:'REJECTED',reason,assessment:null});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,allowed)=>object(v)&&Object.keys(v).every(k=>allowed.includes(k));
const score=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100;
const count=v=>Number.isSafeInteger(v)&&v>0;
const horseKeys=['horseNo','horseName','runningStyle','frameNo','predictedTime','predictedTimeConfidence','features'];
const featureKeys=['distanceFit','courseFit','last3fAbility','evidence','evidenceSources'];
const countKeys=['sameDistance','sameTrack','last3f'];
function canonical(v){if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';throw Error('NON_JSON')}
async function hash(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('')}
function seconds(v){const m=typeof v==='string'&&v.match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);const n=m?Number(m[1])*60+Number(m[2]):NaN;return Number.isFinite(n)&&n>0?n:null}
const referenceKeys=['result','resultSnapshot','finishOrder','historicalResearch','validated','validationCompleted'];
const hasReference=v=>object(v)&&referenceKeys.some(k=>v[k]!=null&&v[k]!==false);
function select(v,allowed){const out={};for(const k of allowed)if(v?.[k]!==undefined)out[k]=structuredClone(v[k]);return out}
// Explicit projection adapter. It omits legacy marks/market; it does not authenticate a source.
export function projectNarScenarioAbilityInput(source){
 if(!object(source)||!Array.isArray(source.horses)||hasReference(source)||hasReference(source.race)||source.horses.some(hasReference))throw Error('REFERENCE_INPUT_REJECTED');
 const horses=source.horses.map(h=>{const out=select(h,horseKeys);if(h.features!=null){out.features=select(h.features,featureKeys);if(h.features.evidence!=null)out.features.evidence=select(h.features.evidence,countKeys)}return out});
 return freeze({raceId:source.raceId,acquiredAt:source.acquiredAt,race:select(source.race,['raceDate','track','raceNo','postTime']),horses});
}
function validate(input,horseNo,now){
 if(!keys(input,['raceId','acquiredAt','race','horses'])||!keys(input.race,['raceDate','track','raceNo','postTime'])||!Array.isArray(input.horses))return 'INPUT_SCHEMA_INVALID';
 const r=input.race;
 if(typeof r.track!=='string'||!r.track.trim()||r.track.includes('|')||!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>99||input.raceId!==`${r.raceDate}|${r.track}|${r.raceNo}`||!/^\d{4}-\d{2}-\d{2}$/.test(r.raceDate)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.postTime))return 'IDENTITY_OR_POST_INVALID';
 const post=Date.parse(`${r.raceDate}T${r.postTime}:00+09:00`),captured=typeof input.acquiredAt==='string'?Date.parse(input.acquiredAt):NaN;
 if(!Number.isFinite(post)||new Date(post+9*3600_000).toISOString().slice(0,10)!==r.raceDate)return 'IDENTITY_OR_POST_INVALID';
 if(!Number.isFinite(now)||!Number.isFinite(captured)||captured>now||now-captured>60_000||now>=post)return 'INPUT_TIME_INVALID';
 if(input.horses.length<2||input.horses.length>99||input.horses.some(h=>!keys(h,horseKeys)||!Number.isInteger(h.horseNo)||h.horseNo<1||h.horseNo>99||typeof h.horseName!=='string'||!h.horseName.trim()))return 'RUNNER_SCHEMA_INVALID';
 if(new Set(input.horses.map(h=>h.horseNo)).size!==input.horses.length||!Number.isInteger(horseNo)||!input.horses.some(h=>h.horseNo===horseNo))return 'RUNNER_IDENTITY_INVALID';
 for(const h of input.horses){const f=h.features;if(f!=null&&(!keys(f,featureKeys)||f.evidence!=null&&!keys(f.evidence,countKeys)||f.evidenceSources!=null&&!keys(f.evidenceSources,countKeys)))return 'FEATURE_SCHEMA_INVALID'}
 return null;
}
function refs(f,key){const ids=f.evidenceSources?.[key];return Array.isArray(ids)&&count(f.evidence?.[key])&&ids.length===f.evidence[key]&&ids.every(id=>typeof id==='string'&&id.trim())&&new Set(ids).size===ids.length?[...ids].sort():null}
export async function evaluateNarScenarioPremarkResearch({input,horseNo,now=Date.now()}={}){
 try{
  // Validate before cloning: JSON conversion must not rescue invalid numbers or hidden extra fields.
  canonical(input);const reason=validate(input,horseNo,now);if(reason)return reject(reason);
  const projection=structuredClone(input),h=projection.horses.find(h=>h.horseNo===horseNo),f=h.features||{},c=f.evidence||{},evidence=[],missing=[],unknowns=['POSITION_PROJECTION','PACE_FORECAST','GOING_SUITABILITY'];
  const style=h.runningStyle,front=['逃げ','先行','好位','逃げ・先行','先行・好位'].includes(style),closing=['差し','追込','追い込み','中団','差し・追込'].includes(style);
  if(!front&&!closing)missing.push('UNAMBIGUOUS_RUNNING_STYLE');
  const add=(code,value,sourceKey)=>evidence.push({code,value,kind:'model_estimate',runIds:refs(f,sourceKey)});
  const time=seconds(h.predictedTime),times=projection.horses.map(x=>seconds(x.predictedTime)).filter(x=>x!=null),rank=time==null?null:1+times.filter(x=>x<time).length;
  // V2 provisional support gates reused solely to inventory model evidence.
  if(time!=null&&score(h.predictedTimeConfidence)&&h.predictedTimeConfidence>=60&&count(c.sameDistance)&&times.length>=2&&rank<=3)add('TIME_SUPPORT',{time:h.predictedTime,rank,confidence:h.predictedTimeConfidence,runs:c.sameDistance},'sameDistance');
  if(score(f.distanceFit)&&f.distanceFit>=70&&count(c.sameDistance))add('DISTANCE_SUPPORT',{score:f.distanceFit,runs:c.sameDistance},'sameDistance');
  if(score(f.courseFit)&&f.courseFit>=70&&count(c.sameTrack))add('COURSE_SUPPORT',{score:f.courseFit,runs:c.sameTrack},'sameTrack');
  if(closing&&score(f.last3fAbility)&&f.last3fAbility>=70&&count(c.last3f))add('FINISH_SUPPORT',{score:f.last3fAbility,runs:c.last3f},'last3f');
  if(!evidence.length)missing.push('ABILITY_SUPPORT');
  const dependencies=[];for(let i=0;i<evidence.length;i++)for(let j=i+1;j<evidence.length;j++){const a=evidence[i],b=evidence[j];dependencies.push({codes:[a.code,b.code],relationship:!a.runIds||!b.runIds?'UNKNOWN':a.runIds.some(id=>b.runIds.includes(id))?'OVERLAPPING_RUNS':'DISJOINT_RUNS_UNVALIDATED'})}
  const frame=Number.isInteger(h.frameNo)&&h.frameNo>=1&&h.frameNo<=8?h.frameNo:null;if(frame===null)unknowns.push('FRAME');
  const baseCondition=front?'先行・好位を確保し、前半に脚を使い過ぎず余力を残す':closing?'中団以降で脚を温存し、終盤に進出する進路を確保する':null;
  const baseFailure=front?'前半の競り合いで消耗する、または先行・好位を取れない':'進路が塞がる、または先行勢が余力を保つ';
  const routes=['WIN_ROUTE','PLACE_ROUTE'].map(routeType=>{
   const win=routeType==='WIN_ROUTE',condition=front?(win?'前の馬を捕らえ、後続の追撃にも耐える余力が必要':'勝ち馬に届かなくても、後続に抜かれず2〜3着を守れる余力が必要'):(win?'先行勢に加えて同じ差し集団も上回る末脚が必要':'勝ち馬を捕らえきれなくても、2〜3着争いを上回る末脚が必要');
   const failure=win?'位置を確保できても競争相手を上回る能力が足りない':'勝ち馬との差だけでなく、複数の相手にも先着される';
   const routeMissing=[...missing,win?'WIN_ROUTE_CRITERIA_UNAPPROVED':'PLACE_ROUTE_CRITERIA_UNAPPROVED'];
   const conditions=missing.length?[]:[baseCondition,condition],failureConditions=missing.length?[]:[baseFailure,failure];
   const hypothesis=missing.length?null:`${horseNo}番 ${h.horseName}。脚質入力「${style}」${frame?`、${frame}枠`:''}。【未認定の仮説】${conditions.join('。')}。失敗条件：${failureConditions.join('／')}。想定ペース・馬場適性は未確認。能力評価の再現と相手比較は未検証。`;
   return {routeType,status:'INSUFFICIENT',targetPositions:win?[1]:[2,3],hypothesis,conditions,failureConditions,missing:routeMissing,unknowns:[...unknowns]};
  });
  const inputProjectionSha256=await hash(projection);
  return freeze({schemaVersion:NAR_PREMARK_SCHEMA,mode:'shadow',researchOnly:true,adopted:false,formalKpiEligible:false,status:'INSUFFICIENT',reviewEligibility:'REVIEW_REQUIRED',raceId:projection.raceId,horseNo,generatedAt:new Date(now).toISOString(),inputProjectionSha256,routes,evidence,dependencies,strongIndependentSupportCount:null,missing:[...missing,'ROUTE_CRITERIA_UNAPPROVED','MARKET_POLICY_NOT_EVALUATED','STRONG_SUPPORT_CRITERIA_UNAPPROVED']});
 }catch{return reject('INPUT_UNREADABLE')}
}
