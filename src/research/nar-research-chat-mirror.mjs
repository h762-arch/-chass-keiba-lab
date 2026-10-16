import {createHash} from 'node:crypto';

export const NAR_RESEARCH_MIRROR_SCHEMA='chass-nar-research-chat-mirror-v1';
export const NAR_RESEARCH_BODY_LIMIT=4*1024*1024;
const origin='https://chass-keiba-lab7.h7625421.workers.dev';
const venues={morioka:['10','盛岡'],mizusawa:['11','水沢'],urawa:['18','浦和'],funabashi:['19','船橋'],ooi:['20','大井'],kawasaki:['21','川崎'],kanazawa:['22','金沢'],kasamatsu:['23','笠松'],nagoya:['24','名古屋'],sonoda:['27','園田'],himeji:['28','姫路'],kochi:['31','高知'],saga:['32','佐賀'],monbetsu:['36','門別']};
export const supportsNarResearchMirror=slug=>Object.hasOwn(venues,slug);
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const flags={researchOnly:true,formalKpiEligible:false,productionActivationReady:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
const safeFlags=p=>p?.researchOnly===true&&p.formalKpiEligible===false&&p.productionActivationReady===false;
export function narResearchViewerUrl(selectedDate,slug){ensure(date(selectedDate)&&supportsNarResearchMirror(slug),'RESEARCH_CONFIGURATION_INVALID');return `${origin}/api/chass/v1/public/day?${new URLSearchParams({date:selectedDate,track:venues[slug][1],organization:'NAR'})}`;}

// Projection only. Raw History, Pack and source horse evidence never enter the mirror.
// Capture time is not a prediction time, source-acquisition cutoff or EARLY freeze.
export function projectNarResearchChatMirror(p,{date:expectedDate,slug,capturedAt}={}){
 const sourceUrl=narResearchViewerUrl(expectedDate,slug),[code,track]=venues[slug];
 ensure(typeof capturedAt==='string'&&Number.isFinite(Date.parse(capturedAt))&&new Date(capturedAt).toISOString()===capturedAt,'RESEARCH_CAPTURE_TIME_INVALID');
 ensure(p?.ok===true&&p.date===expectedDate&&p.track===track&&p.organization==='NAR'&&p.viewerMode==='nar-precomputed-ability-research'&&p.marketEvaluation==='disabled'&&safeFlags(p)&&Array.isArray(p.races)&&integer(p.count,1,20)&&p.count===p.races.length,'RESEARCH_VIEWER_INVALID');
 const seen=new Set();
 const races=p.races.map(r=>{
  ensure(r&&integer(r.raceNo,1,20)&&r.raceId===`${expectedDate.replaceAll('-','')}-NAR-${code}-${String(r.raceNo).padStart(2,'0')}`&&!seen.has(r.raceId)&&r.date===expectedDate&&r.track===track&&r.organization==='NAR'&&safeFlags(r)&&Array.isArray(r.horses)&&integer(r.horses.length,2,30),'RESEARCH_RACE_INVALID');seen.add(r.raceId);
  ensure(text(r.raceName,256)&&typeof r.postTime==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.postTime)&&integer(r.distance,100,5000)&&['ダート','芝','障害'].includes(r.surface),'RESEARCH_RACE_INVALID');
  const horseNumbers=new Set();
  const horses=r.horses.map(h=>{
   ensure(h&&integer(h.horseNo,1,30)&&!horseNumbers.has(h.horseNo)&&text(h.horseName,100)&&['active','scratched','excluded','withdrawn','unknown'].includes(h.runnerStatus),'RESEARCH_HORSE_INVALID');horseNumbers.add(h.horseNo);
   ensure((h.abilityScore===null||(typeof h.abilityScore==='number'&&Number.isFinite(h.abilityScore)))&&h.ability?.score===h.abilityScore&&(h.abilityRank===null||integer(h.abilityRank,1,r.horses.length)),'RESEARCH_ABILITY_INVALID');
   const time=h.predictedTime?.text??null;ensure(h.predictedTime&&typeof h.predictedTime==='object'&&!Array.isArray(h.predictedTime)&&(time===null||(typeof time==='string'&&/^\d{1,2}:[0-5]\d\.\d$/.test(time))),'RESEARCH_TIME_INVALID');
   ensure(h.probability?.win===null&&h.probability?.top3===null&&h.probability?.status==='MODEL_HOLD'&&h.market?.odds===null&&h.market?.popularity===null&&h.mark===null&&['winProb','top3Prob','odds','popularity','expectedValue','diamond','warning'].every(k=>h[k]==null),'RESEARCH_SIGNAL_INVALID');
   return {horseNumber:h.horseNo,horseName:h.horseName,abilityRank:h.abilityRank,score:h.abilityScore,predictedTime:time,runnerStatus:h.runnerStatus,winProb:null,top3Prob:null,mark:null,odds:null,popularity:null,expectedValue:null,diamond:null,warning:null};
  });
  return {raceId:r.raceId,raceNumber:r.raceNo,raceName:r.raceName,startTime:r.postTime,distance:r.distance,surface:r.surface,horseCount:horses.length,abilityCount:horses.filter(h=>h.score!==null).length,timeCount:horses.filter(h=>h.predictedTime!==null).length,sourceAcquiredAt:null,predictionAt:null,horses};
 }).sort((a,b)=>a.raceNumber-b.raceNumber);
 return {ok:true,schemaVersion:NAR_RESEARCH_MIRROR_SCHEMA,...flags,date:expectedDate,track,trackSlug:slug,organization:'NAR',scope:'RESEARCH_ABILITY_TIME_ONLY_NOT_EARLY_PREDICTION',sourceUrl,capturedAt,sourceTimingVerification:'NOT_EXPOSED_BY_VIEWER',sourcePayloadSha256:createHash('sha256').update(JSON.stringify(p)).digest('hex'),hashBasis:'UTF8_JSON_STRINGIFY_VIEWER_PAYLOAD',freshness:{latestPredictionAt:null,latestOddsAt:null,latestResultAt:null},diagnostics:{researchViewerProjection:true,marketTextAvailable:false,identityMismatchCount:0,abilityOnlyFallback:true},raceCount:races.length,totalHorseCount:races.reduce((sum,r)=>sum+r.horseCount,0),races};
}

// Exactly one fixed-origin GET, with a whole-request deadline and strict body bound.
// A legacy 404 is the publisher's trigger; other failures never enable this route.
export async function fetchNarResearchChatMirror({date,slug,fetchImpl=globalThis.fetch,now=()=>new Date(),timeoutMs=15000}={}){
 const url=narResearchViewerUrl(date,slug);ensure(typeof fetchImpl==='function'&&typeof now==='function'&&integer(timeoutMs,1,30000),'RESEARCH_CONFIGURATION_INVALID');
 const controller=new AbortController();let timer,reader;
 try{return await Promise.race([
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('RESEARCH_FETCH_TIMEOUT'));},timeoutMs);}),
  (async()=>{
   const response=await fetchImpl(url,{method:'GET',redirect:'manual',headers:{accept:'application/json'},signal:controller.signal});
   ensure(response&&!response.redirected,'RESEARCH_HTTP_UNAVAILABLE');if(response.status===404)return null;ensure(response.status===200,'RESEARCH_HTTP_UNAVAILABLE');
   ensure(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''),'RESEARCH_CONTENT_TYPE_INVALID');
   ensure(!(Number(response.headers.get('content-length'))>NAR_RESEARCH_BODY_LIMIT)&&response.body,'RESEARCH_BODY_INVALID');
   reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;ensure(size<=NAR_RESEARCH_BODY_LIMIT,'RESEARCH_BODY_TOO_LARGE');chunks.push(r.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('RESEARCH_JSON_INVALID');}
   return projectNarResearchChatMirror(payload,{date,slug,capturedAt:now().toISOString()});
  })()
 ]);}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
