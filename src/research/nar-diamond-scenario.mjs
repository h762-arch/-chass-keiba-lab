import {verifyNarEarlySnapshot} from './nar-early-freeze.mjs';

// Isolated research assessment only. Does not assign marks or mutate EARLY.
export const NAR_DIAMOND_SCENARIO_VERSION='NAR-DIAMOND-SCENARIO-RESEARCH-2';
const clone=v=>JSON.parse(JSON.stringify(v));
const num=v=>(typeof v!=='number'&&typeof v!=='string')||String(v).trim()===''||!Number.isFinite(Number(v))?null:Number(v);
const score=v=>{const n=num(v);return n!=null&&n>=0&&n<=100?n:null};
const runCount=v=>{const n=num(v);return Number.isSafeInteger(n)&&n>0?n:null};
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
async function digest(v){const h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return [...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('')}
function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v}
function timeSeconds(v){const m=String(v||'').match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);return m?Number(m[1])*60+Number(m[2]):null}
const reject=reason=>freeze({status:'REJECTED',reason,assessment:null});

// Deterministic evaluation of a verified source, shared by generation and readback.
function evaluate({snapshot,raceId,horseNo,now}){
 const d=snapshot.data,race=d.race,captured=Date.parse(snapshot.capturedAt),post=Date.parse(`${race.raceDate}T${race.postTime}:00+09:00`);
 if(!Number.isFinite(now)||!Number.isFinite(captured)||captured>now||!Number.isFinite(post)||now>=post)return reject('SCENARIO_PRE_POST_REQUIRED');
 if(d.result||d.resultSnapshot||race.historicalResearch)return reject('SCENARIO_REFERENCE_REJECTED');
 const horses=d.predictionSnapshot.horses||[],h=horses.find(x=>Number(x.horseNo)===Number(horseNo));
 const signal=d.marketSnapshot?.signalSnapshot,entry=signal?.horses?.find(x=>Number(x.horseNo)===Number(horseNo));
 if(!h||!entry)return reject('SCENARIO_RUNNER_MISSING');
 const mark=entry.valueMark,pop=num(entry.popularityAtFreeze),odds=num(entry.oddsAtFreeze),ev=num(entry.evAtFreeze);
 if(!['💎','💎💎','💎💎💎'].includes(mark))return reject('DIAMOND_CANDIDATE_REQUIRED');
 if(signal.status!=='frozen'||!Number.isInteger(pop)||pop<6||pop>horses.length||odds==null||odds<=0||ev==null||ev<=0||mark==='💎💎💎'&&pop<9||entry.warningMark)return reject('DIAMOND_SOURCE_POLICY_INVALID');
 const style=String(h.runningStyle||''),front=['逃げ','先行','好位','逃げ・先行','先行・好位'].includes(style),close=['差し','追込','追い込み','中団','差し・追込'].includes(style),missing=[],evidence=[];
 if(!front&&!close||front&&close)missing.push('UNAMBIGUOUS_RUNNING_STYLE');
 const push=(code,path,value,kind='model_estimate')=>evidence.push({code,path,value,kind});
 if(front!==close)push('RUNNING_STYLE','predictionSnapshot.horses.runningStyle',style);
 const features=h.features||{},counts=features.evidence||{},sec=timeSeconds(h.predictedTime),confidence=score(h.predictedTimeConfidence);
 const allTimes=horses.map(x=>timeSeconds(x.predictedTime)).filter(x=>x!=null),timeRank=sec==null?null:1+allTimes.filter(x=>x<sec).length;
 if(sec!=null&&confidence!=null&&confidence>=60&&runCount(counts.sameDistance)!=null&&allTimes.length>=2&&timeRank<=3)push('TIME_SUPPORT','predictionSnapshot.horses.predictedTime',{time:h.predictedTime,rank:timeRank,confidence,sameDistanceRuns:counts.sameDistance});
 if(score(features.distanceFit)!=null&&score(features.distanceFit)>=70&&runCount(counts.sameDistance)!=null)push('DISTANCE_SUPPORT','predictionSnapshot.horses.features.distanceFit',{score:features.distanceFit,runs:counts.sameDistance});
 if(score(features.courseFit)!=null&&score(features.courseFit)>=70&&runCount(counts.sameTrack)!=null)push('COURSE_SUPPORT','predictionSnapshot.horses.features.courseFit',{score:features.courseFit,runs:counts.sameTrack});
 if(close&&score(features.last3fAbility)!=null&&score(features.last3fAbility)>=70&&runCount(counts.last3f)!=null)push('FINISH_SUPPORT','predictionSnapshot.horses.features.last3fAbility',{score:features.last3fAbility,runs:counts.last3f});
 const supports=evidence.filter(e=>e.code!=='RUNNING_STYLE');
 if(supports.length<(mark==='💎💎💎'?2:1))missing.push('ABILITY_SUPPORT');
 const frame=num(h.frameNo),unknowns=[];
 if(frame!=null&&Number.isInteger(frame)&&frame>=1&&frame<=8)push('FRAME','predictionSnapshot.horses.frameNo',frame,'source_field');else unknowns.push('FRAME');
 // A default pace string or current going alone does not prove a pace forecast
 // or horse-specific going suitability. Do not invent either from those fields.
 unknowns.push('POSITION_PROJECTION','PACE_FORECAST','GOING_SUITABILITY');
 const target=mark==='💎'?[2,3]:[1],conditions=[],failureConditions=[];
 let scenario=null;
 if(!missing.length){
  if(front){conditions.push({code:'FRONT_POSITION',hypothesis:'先行集団または好位を確保できること'},{code:'FRONT_ENERGY',hypothesis:'前半の競り合いで脚を使い過ぎず、終盤まで余力を残せること'});failureConditions.push('前半の競り合いが強まり先行時の消耗が増す','想定した先行・好位の位置を取れない');}
  else{conditions.push({code:'CLOSING_POSITION',hypothesis:'中団以降で脚を温存し、終盤に進出できる進路を確保できること'},{code:'FRONT_WEAKENS',hypothesis:'前半の流れで先行勢の余力が減り、差しが届くこと'});failureConditions.push('先行勢が余力を保ち差しが届かない','進路を確保できず終盤の進出が遅れる');}
  const descriptions=supports.map(e=>e.code==='TIME_SUPPORT'?`同距離${e.value.sameDistanceRuns}走を基にした予想TIME ${e.value.time}（入力内${e.value.rank}位）`:e.code==='DISTANCE_SUPPORT'?`同距離${e.value.runs}走の距離適性評価${e.value.score}`:e.code==='COURSE_SUPPORT'?`同場${e.value.runs}走のコース適性評価${e.value.score}`:`上がり${e.value.runs}走の末脚評価${e.value.score}`);
  const position=front?'先行・好位を確保し、前半の競り合いで消耗せず終盤まで余力を残せれば':'中団以降で脚を温存し、先行勢の余力が減る流れで進路を確保できれば';
  const finish=mark==='💎'?(front?'終盤に2〜3着へ残る':'終盤に2〜3着へ差し込む'):(front?'終盤に前の馬を捕らえる、または後続の差しを抑えて1着を狙う':'終盤に先行勢を捕らえて1着を狙う');
  scenario=`${Number(horseNo)}番 ${h.horseName}。EARLY入力の脚質評価は「${style}」${frame!=null&&Number.isInteger(frame)&&frame>=1&&frame<=8?`、枠は${frame}枠`:''}。【仮定】${position}、${descriptions.join('・')}を再現して、${finish}筋を検討する。成立には上記の位置取りと流れが必要。失敗条件：${failureConditions.join('／')}。想定ペース・馬場適性は未確認のため有利と断定しない。`;
 }
 const body={schemaVersion:NAR_DIAMOND_SCENARIO_VERSION,mode:'shadow',researchOnly:true,adopted:false,formalKpiEligible:false,status:missing.length?'INSUFFICIENT':'SCENARIO_READY',raceId,horseNo:Number(horseNo),sourceEarlySha256:snapshot.contentSha256,sourceCapturedAt:snapshot.capturedAt,generatedAt:new Date(now).toISOString(),originalMark:mark,sourceMarket:{popularity:pop,odds,ev},targetPositions:target,scenario,evidence,conditions,failureConditions,missing,unknowns,reviewEligibility:missing.length?'REVIEW_REQUIRED':'RESEARCH_CANDIDATE',sourceSignal:clone(entry)};
 return body;
}

export async function buildNarDiamondScenarioResearch({snapshot,raceId,horseNo,now=Date.now()}={}){
 try{
  const source=clone(snapshot);
  if((await verifyNarEarlySnapshot(source,{raceId})).status!=='PRESERVED')return reject('EARLY_SOURCE_INVALID');
  const body=evaluate({snapshot:source,raceId,horseNo,now});
  if(body.status==='REJECTED')return body;
  return freeze({...body,contentSha256:await digest(body)});
 }catch{return reject('EARLY_SOURCE_INVALID')}
}

export async function verifyNarDiamondScenarioResearch(assessment,{snapshot,raceId}={}){
 try{
  const source=clone(snapshot),saved=clone(assessment);
  if((await verifyNarEarlySnapshot(source,{raceId})).status!=='PRESERVED'||saved?.schemaVersion!==NAR_DIAMOND_SCENARIO_VERSION||saved.raceId!==raceId||saved.sourceEarlySha256!==source.contentSha256)return reject('SCENARIO_SOURCE_MISMATCH');
  const {contentSha256,...body}=saved;if(contentSha256!==await digest(body))return reject('SCENARIO_CONTENT_MISMATCH');
  // Validate saved generation time, never the current read time. No new assessment is generated.
  const generated=Date.parse(saved.generatedAt);
  if(!Number.isFinite(generated)||saved.generatedAt!==new Date(generated).toISOString())return reject('SCENARIO_SEMANTIC_MISMATCH');
  const expected=evaluate({snapshot:source,raceId,horseNo:saved.horseNo,now:generated});
  if(expected.status==='REJECTED'||canonical(expected)!==canonical(body))return reject('SCENARIO_SEMANTIC_MISMATCH');
  return freeze({status:'VERIFIED',assessment:saved});
 }catch{return reject('SCENARIO_UNREADABLE')}
}
