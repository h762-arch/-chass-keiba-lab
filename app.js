(() => {
'use strict';
let jraMeetingSelector=null,jraRaceClient=null,jraOddsClient=null,jraResultClient=null;
const APP_VERSION='10.0.1';
let cpsiFirstPreview=null,cpsiFirstFileGeneration=0;
let cpsiSourceRoot=null,cpsiSourceGeneration=0,cpsiSourceBusy=false;
let cpsiDriveReaderToken='',cpsiDriveController=null;
// CHASS-JRA-AUTO-LOAD-v1.5.2
if(typeof window!=='undefined'){
  window.CHASS_FEATURES=window.CHASS_FEATURES||{};
  if(window.CHASS_FEATURES.ENABLE_JRA_AUTO_FETCH==null){
    window.CHASS_FEATURES.ENABLE_JRA_AUTO_FETCH=true;
  }
}

const ENABLE_LONGSHOT_SCENARIO=typeof window==='undefined'||window.CHASS_FEATURES?.ENABLE_LONGSHOT_SCENARIO!==false;
const ENABLE_CALIBRATION_RESEARCH=typeof window==='undefined'||window.CHASS_FEATURES?.ENABLE_CALIBRATION_RESEARCH!==false;
const BACKUP_SCHEMA_VERSION=1;
const $=id=>document.getElementById(id);
const KEY='chass_v90_races';
const LEGACY_KEY='chass_v80_races';
const CURRENT='chass_v90_current';
const LEGACY_CURRENT='chass_v80_current';
const ODDS_HISTORY='chass_v90_odds_history';
const PREODDS_POLICY_VERSION='PREODDS-v1';
const PREODDS_MARKET_ROLE='longshot_discovery_only';
const PREODDS_FALLBACK_HOUR_JST=9,PREODDS_FALLBACK_MINUTE_JST=30;
let oddsTimer=null,preOddsFallbackTimer=null;
let raceLoadController=null,liveOddsController=null;
let raceLoadGeneration=0,liveOddsGeneration=0;
let resultFetchInProgress=null;
let lastRaceFetchAudit=null;
let activeRaceGeneration=0;
let quickExpanded=false;
let predictionViewMode='original';
const historicalSimilarityCache=new Map(),historicalSimilarityFlights=new Map();
const dashboardUi={
 open:{models:true,calibration:false,calibrationResearch:false,volatility:false,predictionAxes:false,failures:true,distance:false,popularity:false,ev:false,diagnosis:false,saved:false},
 diagnosisFilter:'',raceType:'local',track:'all',period:'all',quality:'all',analysisQuality:'AB',modelVersion:'all',format:'all',raceSort:'new',raceLimit:10
};
const NAR_TRACKS={
  '盛岡':10,'水沢':11,'浦和':18,'船橋':19,'大井':20,'川崎':21,'笠松':23,'金沢':22,
  '名古屋':24,'園田':27,'姫路':28,'高知':31,'佐賀':32,'門別':36
};
const HISTORY_COLLECTION_KEY='chass_history_collection_v1';
const MEETING_CALENDAR_KEY='chass_meeting_calendar_v1';
let historyCollection=null;
let historyCollectorRunning=false,historyCollectorAbort=false;
let backgroundHistoricalJob=null,backgroundHistoricalPollTimer=null;
let meetingCalendarCache={schemaVersion:1,entries:{}};
const MEETING_SELECTOR_TTL_MS=20*60_000,meetingDiscoveryPromises=new Map();
let meetingSelectorState={date:'',status:'idle',entries:{},source:null,fallback:false,error:null};
let jraNormalizedDraft=null;
const AUTO_RESULT_SETTING='chass_auto_result_v1',AUTO_RESULT_RETRY_MINUTES=[5,5,10,15,30],AUTO_RESULT_MAX_ATTEMPTS=6;
let autoResultRunInProgress=null,autoResultTimer=null,autoResultDetailLimit=20;
let autoResultActionMessage='';
const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cloneData=v=>v==null?v:JSON.parse(JSON.stringify(v));
const INACTIVE_HORSE_STATUSES=new Set(['scratched','excluded','withdrawn']);
function normalizeHorseStatus(value){const s=String(value||'').trim();if(/出走取消|取消/.test(s))return 'scratched';if(/競走除外|発走除外|除外/.test(s))return 'excluded';if(/出走取止|取止|取止め|取り止め/.test(s))return 'withdrawn';if(['active','scratched','excluded','withdrawn','unknown'].includes(s))return s;return s?'unknown':'active'}
function horseStatusLabel(status){return ({scratched:'出走取消',excluded:'競走除外',withdrawn:'出走取止',unknown:'状態確認中',active:'出走'})[normalizeHorseStatus(status)]||'出走'}
function isEligibleHorse(h){return !INACTIVE_HORSE_STATUSES.has(normalizeHorseStatus(h?.horseStatus))&&h?.eligible!==false}
function originalLayerHorses(record){return frozenHorses(record).map(h=>({...h,horseStatus:'active',eligible:true,originalMark:h.warningMark?'':h.mark||h.finalMark||h.abilityMark||''}))}
function scratchImpactScore(original,statusByHorse){const ordered=[...original].sort((a,b)=>(b.overall??0)-(a.overall??0)||(b.win??0)-(a.win??0)),rank=new Map(ordered.map((h,i)=>[Number(h.horseNo),i+1])),activeEscapes=original.filter(h=>/逃/.test(String(h.runningStyle))&&!INACTIVE_HORSE_STATUSES.has(statusByHorse[Number(h.horseNo)])),removed=original.filter(h=>INACTIVE_HORSE_STATUSES.has(statusByHorse[Number(h.horseNo)]));let score=0;for(const h of removed){const r=rank.get(Number(h.horseNo));score+=r===1?45:r<=3?25:5;if(Number(h.popularity)===1)score+=25;if(h.valueMark)score+=15;if(/逃/.test(String(h.runningStyle))&&activeEscapes.length===0)score+=35}return clamp(score,0,100)}
function livePaceAdjustment(h,removed,original){const removedEscape=removed.some(x=>/逃/.test(String(x.runningStyle))),removedForward=removed.filter(x=>/逃|先行/.test(String(x.runningStyle))).length,onlyEscapeRemoved=removedEscape&&!original.filter(x=>!removed.includes(x)&&/逃/.test(String(x.runningStyle))).length;if(onlyEscapeRemoved)return /逃|先行/.test(String(h.runningStyle))?.06:-.05;if(removedForward>=2)return /逃|先行/.test(String(h.runningStyle))?.04:-.03;if(removed.some(x=>/差|追/.test(String(x.runningStyle))))return /逃|先行/.test(String(h.runningStyle))?.02:0;return 0}
function buildLiveAdjustedPrediction(record,statusItems=[],at=new Date().toISOString(),history=[]){const original=originalLayerHorses(record),previous=record?.scratchAudit?.statusByHorse||{},statusByHorse={...previous};for(const item of statusItems||[]){const no=Number(item?.horseNo),status=normalizeHorseStatus(item?.horseStatus||item?.statusText||item?.positionText);if(no&&status!=='active')statusByHorse[no]=status}const removed=original.filter(h=>INACTIVE_HORSE_STATUSES.has(statusByHorse[Number(h.horseNo)]));if(!removed.length)return null;const impact=scratchImpactScore(original,statusByHorse),active=original.filter(h=>!INACTIVE_HORSE_STATUSES.has(statusByHorse[Number(h.horseNo)])).map(h=>cloneData(h)),winSum=active.reduce((s,h)=>s+(num(h.win)||0),0)||1,placeRaw=active.map(h=>Math.max(1,(num(h.place)||1)*(1+livePaceAdjustment(h,removed,original)))),placeTarget=Math.min(300,active.reduce((s,h)=>s+(num(h.place)||0),0)),placeSum=placeRaw.reduce((s,x)=>s+x,0)||1;active.forEach((h,i)=>{h.horseStatus='active';h.eligible=true;h.win=Number((100*(num(h.win)||0)/winSum).toFixed(2));h.place=Number(clamp(placeRaw[i]*placeTarget/placeSum,1,88).toFixed(2));const paceDelta=livePaceAdjustment(h,removed,original);h.paceFitScore=Number(clamp((num(h.paceFitScore??h.predictionAxes?.paceFitScore)??50)+paceDelta*100,0,100).toFixed(1));if(h.predictionAxes)h.predictionAxes.paceFitScore=h.paceFitScore;h.ev=num(h.odds)==null?null:Number((num(h.odds)*h.win).toFixed(2));h.fair=h.win>0?Number((100/h.win).toFixed(2)):null;h.overall=Math.round(clamp((num(h.overall)||0)+paceDelta*20,0,100))});abilityMarks(active,record?.race||record?.predictionSnapshot?.race||{});applyValueFlags(active,record?.race||record?.predictionSnapshot?.race||{});const axis=applyPredictionAxisReinforcement(active,record?.race||record?.predictionSnapshot?.race||{}),ranked=rankFinalFor(active),marks=['◎','○','▲'];ranked.forEach((h,i)=>h.finalMark=i<3?marks[i]:'');const inactive=removed.map(h=>({...h,horseStatus:statusByHorse[Number(h.horseNo)],eligible:false,odds:null,popularity:null,ev:null,valueMark:'',warningMark:'',finalMark:'',statusLabel:horseStatusLabel(statusByHorse[Number(h.horseNo)])})),horses=[...active,...inactive].sort((a,b)=>Number(a.horseNo)-Number(b.horseNo)),race=cloneData(record?.race||record?.predictionSnapshot?.race||{}),soleEscapeRemoved=removed.some(x=>/逃/.test(String(x.runningStyle)))&&!active.some(x=>/逃/.test(String(x.runningStyle)));if(soleEscapeRemoved)race.pace='スロー';const synthetic={race,predictionSnapshot:{createdAt:at,race,horses:active.map(predictionHorse)},marketSnapshot:{horses:active.map(marketHorse)}},volatility=calculateVolatilityIndex(synthetic,history),originalVolatility=record?.predictionSnapshot?.volatility||null,createdAt=record?.liveAdjustedPrediction?.createdAt||at;return {schemaVersion:1,kind:'live_adjustment',adjustedFromModelVersion:record?.predictionSnapshot?.modelVersion||record?.modelVersion||APP_VERSION,createdAt,updatedAt:at,scratchDetectedAt:record?.scratchAudit?.scratchDetectedAt||at,originalPredictionFingerprint:snapshotFingerprint(record?.predictionSnapshot),scratchImpactScore:impact,fullRecalculation:impact>=40,originalPace:record?.predictionSnapshot?.race?.pace||record?.race?.pace||'標準',livePace:race.pace||'標準',originalVolatilityIndex:originalVolatility?.volatilityIndex??record?.race?.volatilityIndex??null,liveVolatilityIndex:volatility.volatilityIndex,volatility,originalRaceConfidence:record?.predictionSnapshot?.axisModel?.raceConfidence??record?.race?.raceConfidence??null,raceConfidence:axis.raceConfidence,statusByHorse,excludedHorseNos:removed.map(h=>Number(h.horseNo)),horses,finalSnapshot:{schemaVersion:1,createdAt:at,top3:ranked.slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:marks[i],rank:i+1}))}}}
// Ver.10.0.1 Phase 1: scratch information is status-only.  The legacy Live
// Adjusted payload remains readable, but no new probability/mark/EV layer is built.
function resultMarketPresent(value){return (typeof value==='number'||typeof value==='string')&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0}
function resultTextPresent(value){return typeof value==='string'&&value.trim()!==''}
function resultParticipantHorseNos(record){
 if(record?.resultSnapshot&&activeRaceIdentity(record).raceId&&!layerMatchesActive(record,record.resultSnapshot,'result'))return new Set();
 const result=record?.resultSnapshot||record?.result||{},out=new Set((result.finishOrder||[]).map(Number).filter(n=>Number.isInteger(n)&&n>0));
 for(const [no,time] of Object.entries(result.actualTimes||{})){const n=Number(no);if(Number.isInteger(n)&&n>0&&resultTextPresent(time))out.add(n)}
 for(const h of result.horses||[]){const no=Number(h?.horseNo),finish=Number(h?.position??h?.finish),market=h?.finalOdds??h?.odds,hasResult=Number.isFinite(finish)&&finish>0||resultTextPresent(h?.time)||resultTextPresent(h?.actualTime)||resultTextPresent(h?.cornerPositions)||resultMarketPresent(market);if(Number.isInteger(no)&&no>0&&hasResult)out.add(no)}return out;
}
function confirmedInactiveHorseNos(record){const audit=record?.scratchAudit||{},participants=resultParticipantHorseNos(record);return new Set(Object.entries(audit.statusByHorse||{}).filter(([no,status])=>{const meta=audit.statusMetaByHorse?.[no],confirmed=!meta||meta.statusConfidence==='confirmed';return confirmed&&INACTIVE_HORSE_STATUSES.has(status)&&!participants.has(Number(no))}).map(([no])=>Number(no)))}
function applyScratchStatuses(record,statusItems=[],at=new Date().toISOString(),options={}){if(!record?.predictionSnapshot)return record;const context=Array.isArray(options)?{}:options||{},source=context.source||'NAR_OFFICIAL',resultAuthority=context.resultAuthority===true||source==='NAR_RESULT',authoritativeActive=context.authoritativeActive===true||resultAuthority,originalFingerprint=snapshotFingerprint(record.predictionSnapshot),previous=record?.scratchAudit?.statusByHorse||{},statusByHorse={...previous},statusMetaByHorse={...(record?.scratchAudit?.statusMetaByHorse||{})},reconciliations=[...(record?.scratchAudit?.reconciliations||[])],hadAudit=!!record.scratchAudit,knownNos=new Set((record.predictionSnapshot.horses||[]).map(h=>Number(h.horseNo)));for(const item of statusItems||[]){const no=Number(item?.horseNo),raw=item?.horseStatus??item?.statusText??item?.positionText,status=normalizeHorseStatus(raw);if(!Number.isInteger(no)||no<1||knownNos.size&&!knownNos.has(no))continue;const finish=Number(item?.position??item?.finish),resultEvidence=resultAuthority&&(Number.isFinite(finish)&&finish>0||resultTextPresent(item?.time)||resultTextPresent(item?.actualTime)||resultTextPresent(item?.cornerPositions)||resultMarketPresent(item?.finalOdds??item?.odds));if(raw==null&&!resultEvidence)continue;if(resultEvidence||authoritativeActive&&status==='active'){const old=statusByHorse[no];statusByHorse[no]='active';statusMetaByHorse[no]={status:'active',statusSource:resultEvidence?'NAR_RESULT':source,statusReason:resultEvidence?`finish=${Number.isFinite(finish)&&finish>0?finish:'confirmed'}`:'official_active_row',statusCheckedAt:at,statusConfidence:'confirmed'};if(INACTIVE_HORSE_STATUSES.has(old))reconciliations.push({at,code:resultEvidence?'STATUS_RECONCILED_FROM_RESULT':'STATUS_RECONCILED_FROM_OFFICIAL',horseNo:no,previousStatus:old,latestStatus:'active',source:statusMetaByHorse[no].statusSource});continue}if(INACTIVE_HORSE_STATUSES.has(status)){statusByHorse[no]=status;statusMetaByHorse[no]={status,statusSource:source,statusReason:'explicit_official_status',statusCheckedAt:at,statusConfidence:'confirmed'}}}
 const participants=resultParticipantHorseNos(record);for(const no of participants){const old=statusByHorse[no];if(INACTIVE_HORSE_STATUSES.has(old)){statusByHorse[no]='active';statusMetaByHorse[no]={status:'active',statusSource:'NAR_RESULT',statusReason:'result_participation',statusCheckedAt:at,statusConfidence:'confirmed'};reconciliations.push({at,code:'STATUS_RECONCILED_FROM_RESULT',horseNo:no,previousStatus:old,latestStatus:'active',source:'NAR_RESULT'})}}
 const inactiveNos=Object.entries(statusByHorse).filter(([no,status])=>INACTIVE_HORSE_STATUSES.has(status)&&statusMetaByHorse[no]?.statusConfidence!=='low'&&!participants.has(Number(no))).map(([no])=>Number(no));for(const h of record.horses||[]){const no=Number(h.horseNo),status=participants.has(no)?'active':statusByHorse[no];if(INACTIVE_HORSE_STATUSES.has(status)&&inactiveNos.includes(no)){h.horseStatus=status;h.runnerStatus=status;h.eligible=false;h.statusLabel=horseStatusLabel(status)}else if(status==='active'){h.horseStatus='active';h.runnerStatus='active';h.eligible=true;h.statusLabel=horseStatusLabel('active')}}if(!hadAudit&&!inactiveNos.length&&!reconciliations.length)return record;record.scratchAudit={schemaVersion:3,mode:'status_only',scratchDetectedAt:record.scratchAudit?.scratchDetectedAt||at,lastCheckedAt:at,statusByHorse,statusMetaByHorse,inactiveHorseNos:inactiveNos,originalPredictionFingerprint:originalFingerprint,legacyLiveAdjustmentPresent:!!record.liveAdjustedPrediction,reconciliations:reconciliations.slice(-20),timeline:[...(record.scratchAudit?.timeline||[]).slice(-8),{at,event:reconciliations.length?'runner_status_reconciled':hadAudit?'runner_status_updated':'runner_status_detected',horseNos:inactiveNos}]};if(snapshotFingerprint(record.predictionSnapshot)!==originalFingerprint)throw new Error('original_snapshot_mutated');return record}
function buildScratchValidation(record){const inactive=confirmedInactiveHorseNos(record);if(!inactive.size)return null;const top3=new Set((record?.resultSnapshot?.finishOrder||record?.result?.finishOrder||[]).map(Number).slice(0,3)),originalPicks=(record?.finalSnapshot?.top3||[]).map(x=>Number(x.horseNo)).filter(no=>!inactive.has(no));return {schemaVersion:3,scratchAffected:true,scratchExcludedHorseNos:[...inactive],officialBasis:'original_snapshot',mode:'status_only',originalTop3Hits:originalPicks.filter(no=>top3.has(no)).length,originalDenominator:originalPicks.length,originalPredictionFingerprint:record.scratchAudit.originalPredictionFingerprint||snapshotFingerprint(record?.predictionSnapshot)}}
function stableStringify(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;
 return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function snapshotFingerprint(value){let hash=2166136261;const text=stableStringify(value);for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`}
const cleanName=s=>String(s??'').replace(/\s+/g,'').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
const stddev=a=>a.length?Math.sqrt(a.reduce((s,x)=>s+(x-mean(a))**2,0)/a.length):null;
function requestError(code,message,status=0){const e=new Error(message);e.code=code;e.status=status;return e}
async function responseJson(res){try{return await res.json()}catch{throw requestError('parser_error','API応答を解析できませんでした。',res.status)}}
async function fetchJsonSimple(url,{signal,timeoutMs=10000}={}){
 const controller=signal?null:new AbortController(),activeSignal=signal||controller.signal;
 const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
 try{
  const res=await fetch(url,{cache:'no-store',signal:activeSignal});
  const text=await res.text();
  let data;try{data=JSON.parse(text)}catch{throw requestError('parse_error','API応答を解析できませんでした。',res.status)}
  if(!res.ok)throw requestError(data?.errorCode||(/^JRA_[A-Z_]+$/.test(data?.error||'')?data.error:'http_error'),data?.error||`HTTP ${res.status}`,res.status);
  return {res,data};
 }catch(error){
  if(error?.name==='AbortError')throw requestError('timeout','取得がタイムアウトしました。');
  if((error instanceof TypeError||error?.name==='TypeError')&&!error.code)throw requestError('network_error',String(error.message||error));
  throw error;
 }finally{if(timer)clearTimeout(timer)}
}
async function fetchNarSyncApi(url,{signal,attempts=1}={}){
 let lastError=null;
 for(let attempt=1;attempt<=attempts;attempt++){
  if(attempt>1)await new Promise((resolve,reject)=>{const t=setTimeout(resolve,attempt===2?900:1800);if(signal){const abort=()=>{clearTimeout(t);reject(Object.assign(new Error('aborted'),{name:'AbortError'}))};if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true})}});
  try{
   const res=await fetch(url,{cache:'no-store',signal});
   let data;try{data=await responseJson(res)}catch(error){if(res.ok)throw error;data={error:error.message,errorCode:'parser_error'}}
   if(res.ok)return {res,data,clientAttemptCount:attempt};
   const code=data?.errorCode||'nar_temporary',retryable=['network_error','nar_timeout','nar_temporary'].includes(code)||[429,500,502,503,504].includes(Number(res.status));
   const error=requestError(code,data?.error||'取得失敗',res.status);error.attemptCount=data?.attemptCount;error.urlType=data?.urlType;error.fallbackTried=data?.fallbackTried;error.diagnostics=data?.diagnostics||[];error.raceFetchAudit=data?.raceFetchAudit||null;
   if(!retryable||attempt===attempts)throw error;lastError=error;
  }catch(error){
   if(error?.name==='AbortError')throw requestError(signal?.aborted?'aborted':'timeout',signal?.aborted?'取得をキャンセルしました。':'取得がタイムアウトしました。');
   if(error instanceof TypeError&&!error.code)error.code='network_error';
   const retryable=['network_error','nar_timeout','nar_temporary'].includes(error?.code)||[429,500,502,503,504].includes(Number(error?.status));
   lastError=error;if(!retryable||attempt===attempts)throw error;
  }
 }
 throw lastError||requestError('network_error','通信に失敗しました。');
}
async function fetchNarMinimalApi(url,{signal,generation,isCurrent,requestId,getAbortReason}={}){const started=Date.now(),audit={requestId,requestedAt:new Date().toISOString(),fetchStartedAt:new Date().toISOString(),visibilityStart:typeof document!=='undefined'?document.visibilityState:'unknown',onlineStart:typeof navigator!=='undefined'?navigator.onLine:null,request:{success:false,stage:'request_start'},headers:{success:false},body:{success:false},json:{success:false},payload:{success:false}};let response;try{response=await fetch(url,{cache:'no-store',signal,headers:requestId?{'X-CHASS-Request-ID':requestId}:{}});audit.request={success:true,stage:'response_headers'};audit.headersAt=new Date().toISOString();audit.headers={success:true,httpStatus:response.status,requestId:response.headers?.get?.('x-chass-request-id')||requestId||null,route:response.headers?.get?.('x-chass-route')||null}}catch(error){const message=String(error?.message||error),abortReason=typeof getAbortReason==='function'?getAbortReason():'',code=error?.name==='AbortError'?(abortReason==='timeout'?'fetch_timeout':'fetch_aborted'):/network connection was lost/i.test(message)?'network_connection_lost':/load failed/i.test(message)?'safari_load_failed':'fetch_failed',e=requestError(code,message);audit.abortReason=abortReason||null;audit.errorName=error?.name||'';audit.errorMessage=message.slice(0,180);audit.visibilityEnd=typeof document!=='undefined'?document.visibilityState:'unknown';audit.onlineEnd=typeof navigator!=='undefined'?navigator.onLine:null;audit.totalMs=Date.now()-started;e.transportAudit=audit;throw e}if(generation!=null&&typeof isCurrent==='function'&&!isCurrent()){const e=requestError('stale_request','古い結果取得を破棄しました。');audit.totalMs=Date.now()-started;e.transportAudit=audit;throw e}let text;try{text=await response.text();audit.bodyAt=new Date().toISOString();audit.body={success:true,bodyBytes:new TextEncoder().encode(text).length}}catch(error){const e=requestError('response_body_failed',error?.message||'response body failed',response.status);audit.body={success:false,errorCode:e.code};audit.errorName=error?.name||'';audit.errorMessage=String(error?.message||error).slice(0,180);e.transportAudit=audit;throw e}if(!text){const e=requestError('empty_payload','空のAPI応答です。',response.status);audit.body={success:false,bodyBytes:0,errorCode:e.code};e.transportAudit=audit;throw e}let data;try{data=JSON.parse(text);audit.parsedAt=new Date().toISOString();audit.json={success:true}}catch(error){const e=requestError('json_parse_failed','API応答JSONを解析できませんでした。',response.status);audit.json={success:false,errorCode:e.code};audit.errorName=error?.name||'';audit.errorMessage=String(error?.message||error).slice(0,180);e.transportAudit=audit;throw e}if(!response.ok){const e=requestError(data?.errorCode||'http_error',data?.error||`HTTP ${response.status}`,response.status);audit.payload={success:false,errorCode:e.code};e.transportAudit=audit;throw e}if(!data||data.ok!==true||!Array.isArray(data.finishOrder)){const e=requestError('invalid_payload','結果APIの形式が不正です。',response.status);audit.payload={success:false,errorCode:e.code};e.transportAudit=audit;throw e}audit.payload={success:true,stage:'payload_validate'};audit.completedAt=new Date().toISOString();audit.visibilityEnd=typeof document!=='undefined'?document.visibilityState:'unknown';audit.onlineEnd=typeof navigator!=='undefined'?navigator.onLine:null;audit.primaryMs=Date.now()-started;audit.totalMs=audit.primaryMs;return {res:response,data,transportAudit:audit}}
function renderRaceFetchDiagnostics(audit=lastRaceFetchAudit){const box=$('raceFetchDiagnostics'),body=$('raceFetchDiagnosticsBody');if(!box||!body)return;const rows=[];for(const [key,label] of [['detail','DebaTableSmall'],['card','RaceMarkTable'],['odds','OddsTanFuku'],['parse','解析']]){const x=audit?.[key];if(!x)continue;rows.push([label,x.success?'成功':'失敗']);if(x.activeRoute)rows.push([`${label}・経路`,x.activeRoute]);if(x.fallbackUsed)rows.push([`${label}・復旧`,'RaceMarkTable_ipat']);if(x.httpStatus!=null)rows.push([`${label}・HTTP`,String(x.httpStatus)]);if(x.attemptCount!=null)rows.push([`${label}・試行`,String(x.attemptCount)]);if(x.errorCode)rows.push([`${label}・エラー`,x.errorCode]);if(x.horseCount!=null)rows.push(['解析馬数',String(x.horseCount)]);if(x.abilityCount!=null)rows.push(['能力データ',String(x.abilityCount)]);if(x.predictedTimeCount!=null)rows.push(['TIMEデータ',String(x.predictedTimeCount)])}body.innerHTML=rows.map(([k,v])=>`<div class="diag-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('');box.hidden=!rows.length;if(rows.some(([,v])=>v==='失敗'))box.open=true}
function diagnosticRows(audit={}){const rows=[],flight=audit.singleFlight,transport=audit.transportAudit;if(audit.requestId)rows.push(['Request ID',audit.requestId]);if(flight){rows.push(['取得種別',flight.priority||'']);rows.push(['Single-Flight',flight.mode||'']);rows.push(['Active raceId',flight.raceId||'']);if(flight.abortReason)rows.push(['Abort理由',flight.abortReason]);rows.push(['開始visibility',String(flight.visibilityStart??'')]);rows.push(['終了visibility',String(flight.visibilityEnd??'')]);rows.push(['開始online',String(flight.onlineStart??'')]);rows.push(['終了online',String(flight.onlineEnd??'')])}if(transport){for(const [key,label] of [['request','Request'],['headers','Headers'],['body','Body'],['json','JSON'],['payload','Payload']]){const x=transport[key];if(!x)continue;rows.push([`通常経路・${label}`,x.success?'成功':'失敗']);if(x.httpStatus!=null)rows.push([`${label}・HTTP`,String(x.httpStatus)]);if(x.bodyBytes!=null)rows.push([`${label}・Bytes`,String(x.bodyBytes)]);if(x.errorCode)rows.push([`${label}・エラー`,x.errorCode])}if(transport.primaryMs!=null)rows.push(['Primary時間',`${transport.primaryMs}ms`]);if(transport.totalMs!=null)rows.push(['Total時間',`${transport.totalMs}ms`]);if(transport.errorName)rows.push(['Error name',transport.errorName]);if(transport.errorMessage)rows.push(['Error message',transport.errorMessage])}const section=(title,x)=>{if(!x)return;rows.push([title,x.success===true?'成功':x.success===false?'失敗':'未使用']);if(x.stage)rows.push([`${title}・段階`,x.stage==='diagnostic_recovery_complete'?'復旧完了':x.stage]);if(x.httpStatus!=null)rows.push([`${title}・HTTP`,String(x.httpStatus)]);if(x.errorCode)rows.push([`${title}・エラー`,x.errorCode]);if(x.route)rows.push([`${title}・経路`,x.route]);if(x.parsedRows!=null)rows.push([`${title}・解析`,`${x.parsedRows}頭${x.finishOrder?.length?' / '+x.finishOrder.join('-'):''}`]);if(x.recoveryMs!=null)rows.push(['Recovery時間',`${x.recoveryMs}ms`]);for(const key of ['persist','cloud','validation','render'])if(x[key])rows.push([`${title}・${key}`,key==='cloud'&&x[key]==='pending'?'クラウド同期待ち':x[key]])};section('通常経路',audit.primarySyncAudit);section('復旧経路',audit.recoveryAudit);section('後処理',audit.postFetchAudit);if(transport||audit.primarySyncAudit||audit.recoveryAudit||audit.postFetchAudit)return rows;if(audit.apiOk!=null)rows.push(['API取得',audit.apiOk?'成功':'失敗']);if(audit.stage)rows.push(['取得段階',String(audit.stage)]);if(audit.errorCode)rows.push(['エラー',audit.errorCode]);return rows}
function renderResultDiagnostics(audit=state.resultFetchAudit){const box=$('resultDiagnostics'),body=$('resultDiagnosticsBody');if(!box||!body)return;const context=activeRaceContext(),auditIdentity={raceId:audit?.raceId||audit?.singleFlight?.raceId||'',organization:audit?.organization||audit?.singleFlight?.organization||''},belongsToActive=context.hasPrediction&&(!auditIdentity.raceId||auditIdentity.raceId===context.raceId)&&(!auditIdentity.organization||auditIdentity.organization===context.organization),rows=belongsToActive?diagnosticRows(audit||{}):[];box.hidden=!rows.length;if(audit?.resultFetchSuccess)box.open=false;body.innerHTML=rows.map(([k,v])=>`<div class="diag-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}
async function fetchResultDiagnostic(r,requestId=''){const code=narCode(r.track);if(!code||!r.raceDate||!r.raceNo)return null;try{const res=await fetch(`/api/nar/result-diagnostic?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}&requestId=${encodeURIComponent(requestId)}`,{cache:'no-store',headers:requestId?{'X-CHASS-Request-ID':requestId}:{}}),d=await responseJson(res);return d}catch(e){return {ok:false,errorCode:e?.code||'diagnostic_unavailable',httpStatus:e?.status||null,error:String(e?.message||e),diagnostics:[]}}}
function errorLabel(e){
 const labels={parse_error:'公式ページの解析に失敗しました。',timeout:'NAR公式への接続がタイムアウトしました。',http_error:'NAR公式のHTTP応答で失敗しました。',empty_response:'NAR公式から空の応答が返りました。',fetch_failed:'結果APIへ接続できませんでした。',fetch_aborted:'結果取得をキャンセルしました。',fetch_timeout:'結果APIがタイムアウトしました。',response_body_failed:'結果APIの本文を読み取れませんでした。',json_parse_failed:'結果APIのJSONを解析できませんでした。',empty_payload:'結果APIから空の応答が返りました。',invalid_payload:'結果APIの応答形式が不正です。',serialize_failed:'結果APIのJSON生成に失敗しました。',post_process_failed:'結果取得後の処理に失敗しました。',result_rows_insufficient:'結果待ち｜公式結果はまだ公開されていません。',odds_fetch_failed:'最終オッズのみ取得できませんでした。',metadata_fetch_failed:'付随情報のみ取得できませんでした。',persist_failed:'端末保存に失敗しました。',d1_save_failed:'クラウド保存のみ失敗しました。端末結果は保持しています。',validation_failed:'結果は保存済みですが再集計に失敗しました。',render_failed:'結果は保存済みですが画面反映に失敗しました。',response_build_failed:'結果処理の応答生成に失敗しました。'};
 if(labels[e?.code])return labels[e.code];
 if(e?.code==='race_not_found'||e?.status===404)return '指定レースが見つかりません。';
 if(e?.code==='parser_error')return '公式ページの解析に失敗しました。';
 if(e?.code==='nar_timeout')return 'NAR公式への接続がタイムアウトしました。再取得できます。';
 if(e?.code==='nar_temporary'||e?.status===429||e?.status>=500)return 'NAR公式または取得サーバーで一時エラーが発生しました。';
 if(e?.code==='network_error'||e instanceof TypeError)return '通信に失敗しました。ネットワークを確認してください。';
 return String(e?.message||'取得に失敗しました。');
}
// One presentation policy for manual result reads and the automatic JRA/NAR queue.
// Raw server messages remain in diagnostics, never in the user-facing explanation.
function resultFetchFeedback({code='',status=0,hasResult=false}={}){
 const key=String(code),http=Number(status)||Number(/^http_(\d{3})$/.exec(key)?.[1])||0;let reason='取得に失敗しました。原因は確認できません。',action='取得診断を確認し、時間をおいて再確認してください。',kind='unknown';
 const set=(k,r,a)=>{kind=k;reason=r;action=a;};
 if(['JRA_RESULT_BEFORE_POST'].includes(key))set('waiting','発走前のため結果を取得していません。','発走後、公式結果の掲載を待ってください。');
 else if(['result_unpublished','result_rows_insufficient','JRA_RESULT_UNPUBLISHED'].includes(key))set('waiting','公式結果はまだ掲載されていないか、着順が揃っていません。','公式結果の掲載後に再確認してください。');
 else if(key==='JRA_RESULT_FETCH_DISABLED')set('disabled','JRA結果取得は現在OFFです。','運用設定の確認が必要です。再試行を繰り返す必要はありません。');
 else if(http===401||http===403)set('access','結果APIへのアクセスが拒否されました。','接続先や運用設定の確認が必要です。');
 else if(http===429||key==='rate_limited')set('limited','取得先からアクセス回数を制限されています。','連続操作を避け、時間をおいて再確認してください。');
 else if(['timeout','nar_timeout','fetch_timeout','JRA_FETCH_TIMEOUT'].includes(key))set('timeout','結果の取得が制限時間を超えました。','通信状態を確認し、時間をおいて再確認してください。');
 else if(['network_error','fetch_failed','network_connection_lost','safari_load_failed','JRA_OFFICIAL_UNAVAILABLE','response_body_failed'].includes(key))set('network','結果の通信に失敗しました。','通信状態を確認してから再確認してください。');
 else if(['parse_error','parser_error','json_parse_failed','empty_payload','empty_response','invalid_payload','AUTO_RESULT_INVALID','JRA_RESULT_PARSE_ERROR'].includes(key))set('invalid','応答を読み取れないか、結果データを安全に照合できませんでした。','結果の保存・上書きはせず、時間をおいて再確認してください。');
 else if(http===404||key==='race_not_found')set('selection','指定レースを見つけられませんでした。','日付・競馬場・レース番号を確認してください。');
 else if(http>=500||key==='nar_temporary')set('server','取得先で一時的なエラーが発生しました。','時間をおいて再確認してください。');
 else if(['aborted','fetch_aborted','stale_request'].includes(key))set('cancelled','結果取得を中止しました。','現在選択しているレースを確認してください。');
 const prefix=hasResult?'保存済み結果は保持しています。':'予想データは保持しています。';
 return {kind,reason,action,text:`${reason} ${action} ${prefix}`};
}
function resultQueueTime(value){const time=Date.parse(value);return Number.isFinite(time)?new Date(time).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})+' JST':'未設定';}
function resultRetryAvailability(id,record,now=Date.now()){
 const q=record?.resultQueue;
 if(!record?.predictionSnapshot||!q||!autoResultSelectionMatches(id,record,q))return {allowed:false,reason:'レース識別情報を確認してください。'};
 if((record.resultSnapshot?.finishOrder||record.result?.finishOrder||[]).length>=3)return {allowed:false,reason:'結果は取得済みです。'};
 if(!autoResultEnabled()||q.enabled===false||q.status==='paused')return {allowed:false,reason:'自動取得を停止中です。'};
 if(!['result_waiting','result_pending','result_retry'].includes(q.status))return {allowed:false,reason:'再確認の対象ではありません。'};
 const first=Date.parse(postRaceFirstCheckAt(record.race||{}));
 if(!Number.isFinite(first))return {allowed:false,reason:'発走日時を確認してください。'};
 if(now<first)return {allowed:false,reason:'発走時刻+10分から確認できます。'};
 const last=Date.parse(q.lastResultCheckAt);
 if(Number.isFinite(last)&&now-last<60000)return {allowed:false,reason:'前回確認から1分以上あけてください。'};
 return {allowed:true,reason:''};
}
function resultQueueDetails(records=raceCache,now=Date.now()){
 return Object.entries(records||{}).filter(([,r])=>r?.resultQueue&&(r.resultSnapshot?.finishOrder||r.result?.finishOrder||[]).length<3&&['result_waiting','result_pending','result_retry','paused'].includes(r.resultQueue.status)).map(([id,record])=>{
  const q=record.resultQueue,availability=resultRetryAvailability(id,record,now),feedback=q.lastResultError?resultFetchFeedback({code:q.lastResultError}):null;
  const stopped=q.retryLimitReached===true||Number(q.attempts)>=AUTO_RESULT_MAX_ATTEMPTS;
  const schedule=q.enabled===false||q.status==='paused'?'自動取得を停止中':stopped?'自動再試行は上限に到達':q.nextCheckAt?'次回確認 '+resultQueueTime(q.nextCheckAt):'次回確認時刻は未設定';
  return {id,organization:raceTypeOf(record),code:q.lastResultError||'',reason:feedback?.reason||'結果の確認待ちです。',action:feedback?.action||'',schedule,lastCheck:q.lastResultCheckAt?resultQueueTime(q.lastResultCheckAt):'未確認',attempts:Number(q.attempts)||0,stopped,allowed:availability.allowed,blockedReason:availability.reason};
 }).sort((a,b)=>Number(b.stopped)-Number(a.stopped)||Number(!!b.code)-Number(!!a.code)||a.id.localeCompare(b.id));
}
function renderAutoResultDetails(){
 const box=$('autoResultDetails'),body=$('autoResultDetailsBody'),summary=$('autoResultDetailsSummary'),more=$('autoResultMore'),notice=$('autoResultActionStatus');if(!box||!body)return;
 const rows=resultQueueDetails();box.hidden=!rows.length;if(summary)summary.textContent=`未取得レースの理由・再確認 ${rows.length}件`;
 body.innerHTML=rows.slice(0,autoResultDetailLimit).map(r=>`<li class="auto-result-detail"><strong>${esc(r.id)}（${esc(r.organization)}）</strong><p>${esc(r.reason)} ${esc(r.action)}</p><small>${esc(r.schedule)}｜確認 ${r.attempts}回｜前回 ${esc(r.lastCheck)}</small>${r.code?`<small>診断コード：${esc(r.code)}</small>`:''}<button type="button" class="ghost wide" data-result-retry="${esc(r.id)}" ${!r.allowed||autoResultRunInProgress?'disabled':''}>このレースだけ再確認</button>${!r.allowed?`<small>${esc(r.blockedReason)}</small>`:''}</li>`).join('');
 if(more){more.hidden=rows.length<=autoResultDetailLimit;more.textContent=`さらに表示（残り${Math.max(0,rows.length-autoResultDetailLimit)}件）`;}
 if(notice)notice.textContent=autoResultActionMessage;
}
async function retryAutoResultFromUi(id){
 if(autoResultRunInProgress){autoResultActionMessage='別の結果確認が進行中です。完了を待ってください。';renderAutoResultDetails();return;}
 const availability=resultRetryAvailability(id,raceCache[id]);
 if(!availability.allowed){autoResultActionMessage=availability.reason;renderAutoResultDetails();return;}
 autoResultActionMessage=`${id} を確認中…`;renderAutoResultDetails();
 try{const result=await runAutoResultQueue({retryId:id});autoResultActionMessage=result.busy?'他の取得処理が進行中です。完了後に再確認してください。':result.completed?`${id}：結果を取得・保存しました。`:result.deferred||!result.processed?`${id}：記録の変更などにより確認を見送りました。`:`${id}：確認しました。下の理由・次回確認予定をご覧ください。`;}
 catch{autoResultActionMessage=`${id}：確認処理に失敗しました。保存状態と取得診断を確認してください。`;}
 renderAutoResultQueue();
}
// Separate, non-persistent CPSI preview. It never creates or updates an EARLY Snapshot.
function calculateCpsiFirst(root){
 const race=root?.race||{},horses=root?.horses||[],organization=raceTypeOf({race}),id=raceId(race);
 const args={race,horses,organization,raceId:id,hasResult:!!(root?.result||root?.resultSnapshot||root?.validationSnapshot||root?.validated||root?.validationCompleted)};
 const fallback=reason=>({status:'HOLD',reasons:[reason],cpsi:null,researchOnly:true,formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',sourceOriginAuthenticated:false});
 let result;try{result=window.CHASS_CPSI_WAVE_CORE?.projectAndCalculateCpsiShadow?.(args)||fallback('BROWSER_METRIC_CORE_UNAVAILABLE');}catch{result=fallback('CPSI_FIRST_COMPUTE_FAILED');}
 const savedAudit=root?.savedCpsiShadow&&window.CHASS_CPSI_WAVE_CORE?.auditSavedCpsiShadow?window.CHASS_CPSI_WAVE_CORE.auditSavedCpsiShadow(root.savedCpsiShadow,result):null;
 return {raceId:id,organization,result,savedAudit};
}
function cpsiFirstReason(result){
 const labels={INPUT_FREEZE_ID_MISSING:'指数の取得時刻・入力固定情報がありません。',INPUT_FREEZE_SCHEMA_INVALID:'入力固定情報の形式を確認してください。',CUTOFF_OR_PRESTART_INVALID:'取得締切・発走前時刻を確認できません。',POST_RESULT_FIELD_FORBIDDEN:'結果を含むデータから先行CPSIは計算しません。',INDEX_ROSTER_MISMATCH:'指数と出走馬の対応が一致しません。',INDEX_SNAPSHOT_MIXING_FORBIDDEN:'指数の保存単位が一致しません。',SOURCE_IDENTITY_OR_SNAPSHOT_MISMATCH:'レース・Run・指数の識別情報が一致しません。',SOURCE_AFTER_CUTOFF_OR_INVALID_TIME:'指数の取得時刻が締切後か不明です。',BROWSER_METRIC_CORE_UNAVAILABLE:'CPSIの計算機能を読み込めませんでした。',NEWCOMER_SPECIALIST_REQUIRED:'新馬はこのCPSI計算の対象外です。',JUMP_SPECIALIST_REQUIRED:'障害はこのCPSI計算の対象外です。',BANEI_SPECIALIST_REQUIRED:'ばんえいはこのCPSI計算の対象外です。',FIELD_TOO_SMALL:'比較可能な出走馬が2頭未満です。'};
 return (result?.reasons||[]).map(code=>labels[code]||'指数の形式・出所・対応関係を確認できません。').filter((x,i,a)=>a.indexOf(x)===i).join(' ');
}
function renderCpsiFirstPreview(){
 const box=$('cpsiFirstPreview'),body=$('cpsiFirstRows'),status=$('cpsiFirstStatus');if(!box||!body||!status)return;
 if(!cpsiFirstPreview){box.hidden=true;return;}
 box.hidden=false;const {raceId:id,organization,result,savedAudit}=cpsiFirstPreview,cpsi=result?.cpsi;
 if($('cpsiFirstRace'))$('cpsiFirstRace').textContent=`${id||'レース識別情報なし'}（${organization}）`;
 status.textContent=cpsi?`CPSI先行計算：${cpsi.numericMaterializedCount}/${cpsi.activeRunnerCount}頭｜SHADOW・正式判定は保留`:`CPSI【NA】｜${cpsiFirstReason(result)}`;
 if(savedAudit)status.textContent+='｜保存値の検算：'+({FORMULA_MATCH:'成分・数式一致（出所認証・物理読戻は別）',COMPONENT_MISMATCH:'成分または数値が相違',SOURCE_CONFLICT:'入力・保存単位が相違',UNVERIFIED:'照合できません'}[savedAudit.status]||'照合できません');
 const uncertainty={LOW:'低',MEDIUM:'中',HIGH:'高',VERY_HIGH:'非常に高い'};
 body.innerHTML=(cpsi?.rows||[]).map(row=>`<li><strong>${esc(String(row.horseNo))}番｜CPSI ${row.cpsiMainCompat==null?'【NA】':esc(row.cpsiMainCompat)}${row.rank==null?'':`（${row.rank}位）`}</strong><span>Core ${row.coreUsableCount}/3｜充足 ${esc(row.resolvedWeightPct)}%｜中立補完 ${esc(row.neutralizedWeightPct)}%</span><span>不確実性：${esc(uncertainty[row.uncertainty]||'不明')}｜${row.scoreMode==='CORE_COMPLETE'?'Core完備':row.rankEligible?'部分計算':'算出不足'}</span>${row.components?.B?.status==='RESOLVED_PROXY'?'<small>Currentは未取得。前走指数の代理値を使用。</small>':''}${row.components?.C?.status==='PARTIAL_NEUTRAL_PRIMITIVE'?'<small>距離・コースの片側が不明。中立補完は観測値ではありません。</small>':''}${row.rankEligible?'':'<small>正規指数の不足です。別の能力指数で代用しません。</small>'}</li>`).join('');
}
function previewCpsiFirst(root){
 cpsiSourceGeneration++;cpsiSourceRoot=null;
 cpsiFirstPreview=calculateCpsiFirst(root);
 try{const source=window.CHASS_CPSI_SOURCE_RECOVERY;if(source)cpsiSourceRoot=source.sourceRootFromInput(source.sourceInputFromRoot(root));}catch{/* Missing identities remain NA; never manufacture them. */}
 if($('cpsiSourceStatus'))$('cpsiSourceStatus').textContent='元資料は未保存です。Drive接続状態は取得時に確認します。出所の正式認証は別です。';
 renderCpsiFirstPreview();return cpsiFirstPreview;
}
function cpsiSourceMessage(code){
 const labels={CANONICAL_HORSE_KEY_REQUIRED_OR_DUPLICATE:'正規の馬IDが未取得か重複しています。',SOURCE_JSON_INVALID:'元資料JSONを読み取れません。',SOURCE_TOO_LARGE:'元資料は2MiB以下にしてください。',SOURCE_COUNT_INVALID:'元資料の件数が上限を超えています。',SOURCE_HAS_NO_PRIMITIVES:'保存できる生指数がありません。',DEVICE_STORAGE_UNAVAILABLE:'この環境では端末保存を利用できません。',DEVICE_SOURCE_CAPACITY:'元資料の端末保存上限（128件）です。',SOURCE_HASH_OR_CONTEXT_MISMATCH:'元資料のハッシュ・保存単位が一致しません。',SOURCE_READBACK_MISMATCH:'保存後の読戻内容が一致しません。',CUTOFF_OR_PRESTART_INVALID:'発走前・固定時刻を確認できません。'};
 return labels[code]||'元資料の識別情報・形式・端末保存を確認できません。';
}
async function runCpsiSourceAction(action,file=null){
 if(cpsiSourceBusy)return null;
 const source=window.CHASS_CPSI_SOURCE_RECOVERY,generation=cpsiSourceGeneration;
 let store,completed=0;cpsiSourceBusy=true;
 const fresh=()=>generation===cpsiSourceGeneration;
 const message=text=>{if(fresh()&&$('cpsiSourceStatus'))$('cpsiSourceStatus').textContent=text;};
 for(const id of ['cpsiDriveLoad','cpsiSourceSave','cpsiSourceRecover','cpsiSourceExport'])setButtonBusy(id,true);
 message('元資料を確認中…');
 try{
  if(!source)throw Error('SOURCE_MODULE_UNAVAILABLE');
  if(action==='import'){
   if(!file||file.size>2097152)throw Error('SOURCE_TOO_LARGE');
   const artifacts=await source.artifactsFromSourceFile(await file.text(),{sourceRef:`file:${String(file.name||'source.json').slice(0,240)}`});
   if(!fresh())return null;store=await source.openDeviceSourceStore();
   for(const artifact of artifacts){if(!fresh())return null;await source.saveSourceAndReadback(store,artifact);completed++;}
   message(`端末への元資料登録完了｜${completed}件｜件数・馬ID・SHA-256の読戻一致。Drive出所認証は未接続です。`);
   return {status:'DEVICE_READBACK_VERIFIED',completed};
  }
  if(!cpsiSourceRoot)throw Error('CANONICAL_HORSE_KEY_REQUIRED_OR_DUPLICATE');
  const target=cloneData(cpsiSourceRoot);
  if(action==='export'){
   const artifact=await source.createSourceArtifact(target,{sourceRef:'device-cpsi-input'});if(!fresh())return null;
   const url=URL.createObjectURL(new Blob([JSON.stringify({format:source.BUNDLE_FORMAT,sources:[artifact]},null,2)],{type:'application/json'}));
   const a=document.createElement('a');a.href=url;a.download=`CHASS_CPSI_SOURCE_${artifact.input.organization}_${artifact.input.raceId.replaceAll('|','_')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   message('元資料ファイルを出力しました。クラウド送信・予想への反映はありません。');return {status:'EXPORTED'};
  }
  store=await source.openDeviceSourceStore();if(!fresh())return null;
  if(action==='save'){
   const artifact=await source.createSourceArtifact(target,{sourceRef:'device-cpsi-input'});if(!fresh())return null;
   const receipt=await source.saveSourceAndReadback(store,artifact);
   message(`元資料の端末保存完了｜${receipt.horseCount}頭｜件数・馬ID・SHA-256の読戻一致。出所認証・正式判定は別です。`);return receipt;
  }
  if(action!=='recover')throw Error('SOURCE_ACTION_INVALID');
  const input=source.sourceInputFromRoot(target),artifacts=await store.list(source.sourceContextKey(input));
  const recovery=await source.recoverCpsiSources(target,artifacts);if(!fresh())return null;
  // Recompute from recovered primitives. Never reuse a saved CPSI score or mutate state/raceCache.
  if(recovery.status!=='SOURCE_CONFLICT'){
   cpsiSourceRoot=recovery.root;cpsiFirstPreview=calculateCpsiFirst(recovery.root);renderCpsiFirstPreview();
  }
  const labels={RECOVERED:`不足${recovery.recoveredFields}項目を回復してCPSIを再計算しました。`,UNCHANGED:'同じ元資料を確認しました。回復が必要な不足はありません。',SOURCE_NOT_FOUND:'同じレース・Run・Snapshot・馬IDの元資料が端末にありません。',SOURCE_CONFLICT:'元資料に相違があります。回復を中止しました。'};
  message(`${labels[recovery.status]}照合${recovery.candidateCount}件｜クラウド送信・元予想の変更なし。`);
  return recovery;
 }catch(error){message(`元資料処理失敗｜${cpsiSourceMessage(error.code||error.message)}${completed?` 読戻確認済み${completed}件。`:''}`);return null;}
 finally{store?.close();cpsiSourceBusy=false;for(const id of ['cpsiDriveLoad','cpsiSourceSave','cpsiSourceRecover','cpsiSourceExport'])setButtonBusy(id,false);}
}
function cancelCpsiDriveRead(){if(cpsiDriveController){cpsiDriveController.abort();if($('cpsiDriveStatus'))$('cpsiDriveStatus').textContent='Drive取得を中断しました。現在の選択で再取得できます。';}}
function cpsiDriveSelection(){
 const organization=$('raceMode')?.value==='JRA'?'JRA':'NAR';
 const raceDate=$(organization==='JRA'?'jraDate':'autoRaceDate')?.value,track=$(organization==='JRA'?'jraCourse':'autoTrack')?.value,raceNo=Number($(organization==='JRA'?'jraRaceNo':'autoRaceNo')?.value);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(raceDate||'')||!track||!Number.isInteger(raceNo)||raceNo<1||raceNo>12)throw Error('DRIVE_SELECTION_INVALID');
 return {organization,raceId:`${raceDate}|${track}|${raceNo}`};
}
function cpsiDriveMessage(code){
 return ({DRIVE_NOT_CONFIGURED:'本番のDrive接続設定が未完了です。',DRIVE_CONFIG_INVALID:'本番のDrive接続設定を確認してください。',DRIVE_CREDENTIALS_INVALID:'Worker側のGoogle認証設定を確認してください。',DRIVE_READER_UNAUTHORIZED:'接続キーが未入力か一致しません。',DRIVE_SOURCE_NOT_FOUND:'選択したレース・Runの正規PRE元資料がありません。',DRIVE_SOURCE_PRE_EVIDENCE_INVALID:'元資料のRun・Snapshot・馬ID・発走前証跡を確認できません。',DRIVE_SOURCE_RUN_AMBIGUOUS:'複数のRun・固定単位があり、自動選択できません。',DRIVE_SOURCE_CONFLICT:'元資料の内容が相違しています。回復を中止しました。',DRIVE_SOURCE_CHANGED_DURING_READ:'取得中に元資料が更新されました。再取得してください。',DRIVE_SOURCE_FEED_REQUIRED:'Sheetsに正規CPSI元資料の配信表がありません。',DRIVE_SOURCE_FORMAT_REQUIRED:'Driveファイルが正規CPSI元資料の形式ではありません。',DRIVE_FILE_NOT_READABLE:'登録元資料へのGoogle読み取り権限を確認してください。',DRIVE_GOOGLE_AUTH_REJECTED:'GoogleがWorkerの認証を拒否しました。',DRIVE_SELECTION_INVALID:'日付・競馬種別・競馬場・レースを選択してください。',DRIVE_REQUEST_ABORTED:'Drive取得を中断しました。',DRIVE_GOOGLE_RATE_LIMITED:'Googleの取得上限です。時間をおいて再実行してください。',DRIVE_CONTEXT_MISMATCH:'現在の入力と元資料の固定単位・馬IDが一致しません。',DRIVE_RESPONSE_INVALID:'Drive取得応答を確認できません。'})[code]||'Drive元資料を取得・確認できません。端末保存の失敗も含め、成功扱いにはしていません。';
}
async function loadCpsiFromDrive(){
 if(cpsiSourceBusy)return null;
 const generation=cpsiSourceGeneration,source=window.CHASS_CPSI_SOURCE_RECOVERY;
 let store,selection,controller,timer,completed=0;cpsiSourceBusy=true;
 const message=text=>{if($('cpsiDriveStatus'))$('cpsiDriveStatus').textContent=text;};
 const fresh=()=>generation===cpsiSourceGeneration&&!controller?.signal.aborted&&JSON.stringify(selection)===JSON.stringify(cpsiDriveSelection());
 for(const id of ['cpsiDriveLoad','cpsiSourceSave','cpsiSourceRecover','cpsiSourceExport'])setButtonBusy(id,true);
 try{
  if(!source)throw Error('DRIVE_RESPONSE_INVALID');
  selection=cpsiDriveSelection();
  const entered=$('cpsiDriveReaderKey')?.value||'';if(entered)cpsiDriveReaderToken=entered;
  if($('cpsiDriveReaderKey'))$('cpsiDriveReaderKey').value='';
  if(!/^[-A-Za-z0-9_]{32,256}$/.test(cpsiDriveReaderToken))throw Error('DRIVE_READER_UNAUTHORIZED');
  controller=new AbortController();cpsiDriveController=controller;timer=setTimeout(()=>controller.abort(),20000);
  let target=null;
  if(cpsiSourceRoot){const input=source.sourceInputFromRoot(cpsiSourceRoot);if(input.organization===selection.organization&&input.raceId===selection.raceId)target=cloneData(cpsiSourceRoot);}
  const params=new URLSearchParams(selection);
  if(target)for(const k of ['runId','inputSnapshotId','indexSnapshotId'])params.set(k,target.race.metricInputFreeze[k]);
  message(`${selection.raceId}（${selection.organization}）のDrive元資料を取得中…`);
  const r=await fetch('/api/cpsi/sources/drive?'+params.toString(),{method:'GET',credentials:'same-origin',cache:'no-store',headers:{authorization:'Bearer '+cpsiDriveReaderToken,accept:'application/json'},signal:controller.signal});
  if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}
  const length=Number(r.headers.get('content-length'));if(length>2097152)throw Error('DRIVE_RESPONSE_INVALID');
  // Bound decoded response too; Content-Length alone is not trusted.
  if(!r.body)throw Error('DRIVE_RESPONSE_INVALID');
  const reader=r.body.getReader(),parts=[];let size=0;
  try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>2097152)throw Error('DRIVE_RESPONSE_INVALID');parts.push(p.value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}
  const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw Error('DRIVE_RESPONSE_INVALID');}
  if(!r.ok||data.ok!==true)throw Error(typeof data.code==='string'?data.code:'DRIVE_RESPONSE_INVALID');
  if(data.status!=='DRIVE_SOURCE_READY'||data.organization!==selection.organization||data.raceId!==selection.raceId||data.format!==source.BUNDLE_FORMAT||data.transportAuthenticated!==true||data.sourceOriginAuthenticated!==false)throw Error('DRIVE_RESPONSE_INVALID');
  const artifacts=await source.artifactsFromSourceFile(JSON.stringify({format:data.format,sources:data.sources}),{sourceRef:'drive-read'});
  if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}
  if(artifacts.some(a=>a.input.organization!==selection.organization||a.input.raceId!==selection.raceId))throw Error('DRIVE_CONTEXT_MISMATCH');
  const seed=target||source.sourceRootFromInput(artifacts[0].input),context=source.sourceContextKey(source.sourceInputFromRoot(seed));
  if(artifacts.some(a=>a.contextKey!==context))throw Error('DRIVE_CONTEXT_MISMATCH');
  const recovery=await source.recoverCpsiSources(seed,artifacts);
  if(recovery.status==='SOURCE_CONFLICT')throw Error('DRIVE_SOURCE_CONFLICT');
  if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}store=await source.openDeviceSourceStore();
  for(const a of artifacts){if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}await source.saveSourceAndReadback(store,a);completed++;}
  if(!fresh()){message('対象が変更されたためDrive取得を中断しました。現在の選択で再取得できます。');return null;}
  // Time is checked again after physical storage/readback, never backdated to request start.
  source.sourceInputFromRoot(recovery.root);
  previewCpsiFirst(recovery.root);
  const rows=cpsiFirstPreview?.result?.cpsi;
  message(`Drive取得・端末読戻完了｜${completed}資料｜CPSI ${rows?.numericMaterializedCount??0}/${rows?.activeRunnerCount??0}頭｜Google読取接続済み・出所の正式認証は別です。`);
  if($('cpsiSourceStatus'))$('cpsiSourceStatus').textContent=`元資料${completed}件の件数・馬ID・SHA-256を読戻確認済み。元EARLY・Signal・D1は変更していません。`;
  return {status:'DRIVE_DEVICE_READBACK_VERIFIED',completed,recovery};
 }catch(e){
  if(generation===cpsiSourceGeneration){const code=controller?.signal.aborted||e.name==='AbortError'?'DRIVE_REQUEST_ABORTED':e.message;message(`Drive取得未完了｜${cpsiDriveMessage(code)}${completed?` 読戻確認済み${completed}資料。`:''}`);}
  return null;
 }finally{clearTimeout(timer);store?.close();if(cpsiDriveController===controller)cpsiDriveController=null;cpsiSourceBusy=false;for(const id of ['cpsiDriveLoad','cpsiSourceSave','cpsiSourceRecover','cpsiSourceExport'])setButtonBusy(id,false);}
}
async function importCpsiFirstFile(file){
 const generation=++cpsiFirstFileGeneration;cpsiSourceRoot=null;cpsiSourceGeneration++;if($('cpsiFirstInputStatus'))$('cpsiFirstInputStatus').textContent='指数を読み込み中…';
 try{if(file.size>2097152)throw Error('入力ファイルは2MiB以下にしてください。');const root=JSON.parse((await file.text()).replace(/^\uFEFF/,''));if(generation!==cpsiFirstFileGeneration)return null;const result=previewCpsiFirst(root);if(cpsiSourceRoot&&window.CHASS_CPSI_SOURCE_RECOVERY)await runCpsiSourceAction('recover');if(generation!==cpsiFirstFileGeneration)return null;if($('cpsiFirstInputStatus'))$('cpsiFirstInputStatus').textContent='指数の確認が完了しました。予想や結果の保存は行っていません。';return cpsiFirstPreview||result;}
 catch(error){if(generation===cpsiFirstFileGeneration){cpsiSourceRoot=null;cpsiSourceGeneration++;cpsiFirstPreview=null;renderCpsiFirstPreview();if($('cpsiFirstInputStatus'))$('cpsiFirstInputStatus').textContent=`読込失敗｜${error.message}`;}return null;}
}
function currentSelectionId(){return raceId({raceDate:$('autoRaceDate')?.value,track:$('autoTrack')?.value,raceNo:Number($('autoRaceNo')?.value)})}
function setButtonBusy(id,busy,label=''){const b=$(id);if(!b)return;if(busy){b.dataset.idleText=b.textContent;b.disabled=true;b.setAttribute('aria-busy','true');if(label)b.textContent=label}else{b.disabled=false;b.removeAttribute('aria-busy');if(b.dataset.idleText)b.textContent=b.dataset.idleText;delete b.dataset.idleText}}
const median=a=>{const b=a.filter(x=>x!=null).sort((x,y)=>x-y);if(!b.length)return null;const m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2};
const arr=v=>Array.isArray(v)?v.map(num).filter(x=>x!=null):typeof v==='string'?v.split(/[,\s/→>]+/).map(num).filter(x=>x!=null):num(v)==null?[]:[num(v)];
const localStore={get(k,d){try{return JSON.parse(localStorage.getItem(k)||'')??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));return true}catch{return false}}};
const RESEARCH_DB='chass-keiba-research',RESEARCH_DB_VERSION=1;
let researchDb=null,researchStorageMode='localStorage',storageReady=false;
let raceCache=localStore.get(KEY,{}),oddsHistoryCache=localStore.get(ODDS_HISTORY,{}),currentRaceCache=localStore.get(CURRENT,'');
const CLOUD_PENDING_KEY='chass_cloud_pending_v1';
let cloudPending=new Set(localStore.get(CLOUD_PENDING_KEY,[])),cloudState={available:false,source:'local',status:'local',error:'',lastSyncedAt:null};
let cloudResearchAudit={counts:null,exclusions:[],missingResults:[],warnings:[],conflicts:[],eligibleRaceIds:[],datasetRaceIds:[],loadedAt:null};
let cloudAuditRefreshTimer=null,cloudAuditRefreshGeneration=0;
const cloudManifestCache=new Map();
const storageDiagnostics={cacheHit:0,cacheMiss:0,indexedDbRead:0,indexedDbWrite:0,d1Read:0,d1Write:0,externalFetch:0,cloudPost:0,researchRefresh:0,oddsFetch:0,resultFetch:0,unchangedPersist:0};
function storageDiagnostic(name,amount=1){if(Object.hasOwn(storageDiagnostics,name))storageDiagnostics[name]+=amount;return storageDiagnostics[name]}
function stableRecordUpdatedAt(record){return record?.updatedAt||record?.predictionSnapshot?.createdAt||record?.predictionSnapshot?.generatedAt||record?.predictionCreatedAt||record?.resultSnapshot?.fetchedAt||record?.resultAcquiredAt||'1970-01-01T00:00:00.000Z'}
function cloudFingerprint(value){return value==null?null:snapshotFingerprint(value)}
function queueCloudStatus(record){
 const issue=record?.race&&cloudMergeBindingIssue(record);if(issue||record?.predictionSnapshot?.modelVersion!=null&&record?.modelVersion!=null&&String(record.predictionSnapshot.modelVersion)!==String(record.modelVersion))return 'data_conflict';
 const order=record?.resultSnapshot?.finishOrder,known=new Set((record?.predictionSnapshot?.horses||[]).map(h=>Number(h.horseNo))),valid=v=>(typeof v==='number'||typeof v==='string')&&String(v).trim()!==''&&Number.isInteger(Number(v))&&Number(v)>0&&(!known.size||known.has(Number(v)));
 const complete=Array.isArray(order)&&order.length>=3&&order.every(valid)&&new Set(order.map(Number)).size===order.length;
 if(complete&&(record?.validationCompleted||record?.validated))return 'validated';if(complete)return 'result_fetched';if(record?.resultQueue?.enabled===false)return 'prediction_saved';
 const status=record?.resultQueue?.status;return ['result_waiting','result_pending','result_retry','prediction_saved','paused'].includes(status)?status:'prediction_saved';
}
function cloudDescriptor(raceId,record){const racePayload={...(record?.race||record?.predictionSnapshot?.race||{}),...(record?.snapshotIntegrity||record?.race?.snapshotIntegrity?{snapshotIntegrity:record.snapshotIntegrity||record.race.snapshotIntegrity}:{}),resultQueue:record?.resultQueue||null,liveAdjustedPrediction:record?.liveAdjustedPrediction||null,scratchAudit:record?.scratchAudit||null};return {raceId,modelVersion:String(record?.predictionSnapshot?.modelVersion||record?.modelVersion||'Legacy'),updatedAt:stableRecordUpdatedAt(record),status:queueCloudStatus(record),raceFingerprint:cloudFingerprint(racePayload),predictionFingerprint:cloudFingerprint(record?.predictionSnapshot),marketFingerprint:cloudFingerprint(record?.marketSnapshot),finalFingerprint:cloudFingerprint(record?.finalSnapshot),resultFingerprint:cloudFingerprint(record?.resultSnapshot),validationFingerprint:cloudFingerprint(record?.validationSnapshot),liveFingerprint:cloudFingerprint({liveAdjustedPrediction:record?.liveAdjustedPrediction||null,scratchAudit:record?.scratchAudit||null})}}
function manifestKey(item){return `${item?.raceId||''}|${item?.modelVersion||'Legacy'}`}
function manifestMatches(local,remote){return !!remote&&(!remote.fingerprintStatus||remote.fingerprintStatus==='stored')&&['raceFingerprint','predictionFingerprint','marketFingerprint','finalFingerprint','resultFingerprint','validationFingerprint','liveFingerprint'].every(key=>(local[key]||null)===(remote[key]||null))&&local.status===remote.status}
function researchContentFingerprint(record){return snapshotFingerprint({race:record?.race||null,predictionSnapshot:record?.predictionSnapshot||null,marketSnapshot:record?.marketSnapshot||null,finalSnapshot:record?.finalSnapshot||null,resultSnapshot:record?.resultSnapshot||null,validationSnapshot:record?.validationSnapshot||null,resultQueue:record?.resultQueue||null,liveAdjustedPrediction:record?.liveAdjustedPrediction||null,scratchAudit:record?.scratchAudit||null,validationCompleted:!!record?.validationCompleted})}
function idbRequest(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed'))})}
function openResearchDb(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window)){reject(new Error('IndexedDB unavailable'));return}const req=indexedDB.open(RESEARCH_DB,RESEARCH_DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('races'))db.createObjectStore('races',{keyPath:'id'});if(!db.objectStoreNames.contains('oddsHistory'))db.createObjectStore('oddsHistory',{keyPath:'raceId'});if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));req.onblocked=()=>reject(new Error('IndexedDB upgrade blocked'))})}
async function idbGetAll(name){return idbRequest(researchDb.transaction(name,'readonly').objectStore(name).getAll())}
function idbPut(name,value){if(!researchDb)return Promise.reject(new Error('IndexedDB unavailable'));return new Promise((resolve,reject)=>{const tx=researchDb.transaction(name,'readwrite');tx.objectStore(name).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}
function idbPutMany(name,values){if(!researchDb)return Promise.reject(new Error('IndexedDB unavailable'));return new Promise((resolve,reject)=>{const tx=researchDb.transaction(name,'readwrite'),objectStore=tx.objectStore(name);values.forEach(value=>objectStore.put(value));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}
function queueStorageWrite(promise,fallback){promise.catch(()=>{researchStorageMode='localStorage-fallback';fallback?.()})}
function setCloudPending(id,pending=true){if(cloudPending.has(id)===pending)return;if(pending)cloudPending.add(id);else cloudPending.delete(id);localStore.set(CLOUD_PENDING_KEY,[...cloudPending]);renderCloudSyncState()}
function restoredHorseView(record){
 const rows=frozenHorses(record),saved=new Map((record?.horses||[]).map(h=>[Number(h.horseNo),h])),audit=record?.scratchAudit||{},participants=resultParticipantHorseNos(record),inactive=confirmedInactiveHorseNos(record);
 for(const row of rows){const no=Number(row.horseNo),meta=audit.statusMetaByHorse?.[no],old=saved.get(no);let status;
  if(participants.has(no)&&(audit.statusByHorse?.[no]!=null||old?.runnerStatus!=null||old?.horseStatus!=null))status='active';
  else if(inactive.has(no))status=audit.statusByHorse[no];
  else if(meta?.statusConfidence==='low')status='unknown';
  else if(audit.statusByHorse?.[no]==='active')status='active';
  else if(old?.runnerStatus!=null||old?.horseStatus!=null)status=normalizeHorseStatus(old.runnerStatus??old.horseStatus);
  if(status!=null){row.horseStatus=status;row.runnerStatus=status;row.eligible=!INACTIVE_HORSE_STATUSES.has(status);row.statusLabel=horseStatusLabel(status)}
 }return rows;
}
function hydrateCloudRecord(record){if(!record)return record;if(!record.snapshotIntegrity&&record.race?.snapshotIntegrity)record.snapshotIntegrity=cloneData(record.race.snapshotIntegrity);if(record.race)delete record.race.snapshotIntegrity;if(record.race?.liveAdjustedPrediction&&!record.liveAdjustedPrediction)record.liveAdjustedPrediction=record.race.liveAdjustedPrediction;if(record.race?.scratchAudit&&!record.scratchAudit)record.scratchAudit=record.race.scratchAudit;if(record.race){delete record.race.liveAdjustedPrediction;delete record.race.scratchAudit}record.horses=restoredHorseView(record);record.actualTimes=record.resultSnapshot?.actualTimes||{};record.result=record.resultSnapshot?{finishOrder:record.resultSnapshot.finishOrder||[],actualTimes:record.actualTimes}:null;return record}
function cloudMergeBindingIssue(record,expectedRaceId=''){
 const identity=activeRaceIdentity(record);
 if(expectedRaceId&&identity.raceId!==expectedRaceId)return 'CLOUD_RACE_MISMATCH';
 const declared=record?.race?.raceId,p=record?.predictionSnapshot;
 if(declared&&identity.raceId&&declared!==identity.raceId)return 'CLOUD_RACE_MISMATCH';
 if(p?.raceId&&expectedRaceId&&p.raceId!==expectedRaceId)return 'CLOUD_RACE_MISMATCH';
 if(p?.modelVersion!=null&&record?.modelVersion!=null&&String(p.modelVersion)!==String(record.modelVersion))return 'CLOUD_LAYER_BINDING_MISMATCH';
 if(p?.race&&raceId(p.race)&&identity.raceId&&raceId(p.race)!==identity.raceId)return 'CLOUD_RACE_MISMATCH';
 if(identity.raceId)for(const [key,kind] of [['predictionSnapshot','prediction'],['marketSnapshot','market'],['finalSnapshot','final'],['resultSnapshot','result'],['validationSnapshot','validation']])
  if(record?.[key]&&!layerMatchesActive(record,record[key],kind))return 'CLOUD_LAYER_BINDING_MISMATCH';
 return null;
}
function mergeCloudResearchRecord(local,cloud,meta={}){
 local=local?cloneData(local):null;const incoming=hydrateCloudRecord(cloneData(cloud));
 const quarantine=reason=>hydrateCloudRecord({...cloneData(local||incoming||{}),cloudConflict:true,cloudConflictReason:reason,cloudEligible:false,cloudExclusionReason:reason});
 if(!incoming)return quarantine('CLOUD_RECORD_MISSING');
 let issue=cloudMergeBindingIssue(incoming,meta.raceId||'');if(issue)return quarantine(issue);
 if(!incoming.predictionSnapshot?.horses?.length)return quarantine('CLOUD_PREDICTION_MISSING');
 if(incoming.resultSnapshot){const order=incoming.resultSnapshot.finishOrder,known=new Set(incoming.predictionSnapshot.horses.map(h=>Number(h.horseNo)));if(!Array.isArray(order)||order.length<3||order.some(n=>!['number','string'].includes(typeof n)||String(n).trim()===''||!Number.isInteger(Number(n))||Number(n)<=0||!known.has(Number(n)))||new Set(order.map(Number)).size!==order.length)return quarantine('CLOUD_RESULT_INCOMPLETE');}
 if(local){
  issue=cloudMergeBindingIssue(local);if(issue)return quarantine(issue);
  const a=activeRaceIdentity(local),b=activeRaceIdentity(incoming);
  if((a.raceId||b.raceId)&&(a.raceId!==b.raceId||a.organization!==b.organization))return quarantine('CLOUD_RACE_MISMATCH');
  const model=r=>String(r?.predictionSnapshot?.modelVersion||r?.modelVersion||'Legacy');
  if(model(local)!==model(incoming))return quarantine('CLOUD_MODEL_MISMATCH');
  if(local.predictionSnapshot&&incoming.predictionSnapshot&&cloudFingerprint(local.predictionSnapshot)!==cloudFingerprint(incoming.predictionSnapshot))return quarantine('DUPLICATE_OR_CONFLICT');
 }else return hydrateCloudRecord({...incoming,cloudEligible:meta.eligible!==false,cloudExclusionReason:meta.exclusionReason||null});
 const merged={...local};
 for(const key of ['race','predictionSnapshot','marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot','resultQueue','liveAdjustedPrediction','scratchAudit'])if(!merged[key]&&incoming[key])merged[key]=cloneData(incoming[key]);
 for(const key of ['predictionCreatedAt','resultAcquiredAt','modelVersion'])if(!merged[key]&&incoming[key])merged[key]=incoming[key];
 if(merged.resultSnapshot?.finishOrder?.length>=3){merged.validationCompleted=true;merged.validated=true}
 if(!merged.snapshotIntegrity&&incoming.snapshotIntegrity&&['predictionSnapshot','marketSnapshot','finalSnapshot'].every(key=>cloudFingerprint(merged[key])===cloudFingerprint(incoming[key])))merged.snapshotIntegrity=cloneData(incoming.snapshotIntegrity);
 merged.cloudEligible=!merged.cloudConflict&&meta.eligible!==false;merged.cloudExclusionReason=merged.cloudConflict?merged.cloudConflictReason:meta.exclusionReason||null;
 merged.updatedAt=merged.updatedAt||incoming.updatedAt;return hydrateCloudRecord(merged);
}
function buildCloudResearchDataset(data,{merge=true,cache=raceCache}={}){
 const records=Array.isArray(data?.records)?data.records:[],conflicts=[],next={...cache};
 if(merge)for(const item of records){if(!item?.raceId||!item.record)continue;const local=next[item.raceId],merged=mergeCloudResearchRecord(local,item.record,item);
  if(merged.cloudConflict){conflicts.push({raceId:item.raceId,modelVersion:item.record?.predictionSnapshot?.modelVersion||item.record?.modelVersion,reason:merged.cloudConflictReason});if(!local)continue;}
  next[item.raceId]=merged;
 }
 const eligibleRaceIds=[...new Set(records.filter(x=>x?.eligible&&(!merge||!!next[x.raceId]&&next[x.raceId].cloudEligible!==false&&!next[x.raceId].cloudConflict)).map(x=>x.raceId))];
 return {cache:next,records,audit:{counts:data?.counts||null,exclusions:data?.exclusions||[],missingResults:data?.missingResults||[],warnings:data?.warnings||[],conflicts,eligibleRaceIds,datasetRaceIds:records.map(x=>x?.raceId).filter(Boolean),loadedAt:new Date().toISOString()}};
}
function applyCloudResearchDataset(data,{merge=true}={}){
 const staged=buildCloudResearchDataset(data,{merge});raceCache=staged.cache;cloudResearchAudit=staged.audit;return staged.records;
}
async function refreshCloudResearchDataset({persist=false,render=true}={}){if(typeof fetch!=='function'||!cloudState.available)return false;storageDiagnostic('researchRefresh');storageDiagnostic('d1Read');const generation=++cloudAuditRefreshGeneration;cloudState.status='refreshing';renderCloudSyncState();try{const data=await cloudRequest('/api/db/research');if(generation!==cloudAuditRefreshGeneration)return false;applyCloudResearchDataset(data,{merge:true});if(persist){if(researchDb){await idbPutMany('races',Object.entries(raceCache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));storageDiagnostic('indexedDbWrite',Object.keys(raceCache).length)}else localStore.set(KEY,raceCache)}cloudState={...cloudState,available:true,source:'cloud',status:'synced',error:''};settleCloudSyncState('synced');if(render){renderCloudDatasetSummary();renderDashboard()}return data}catch(e){if(generation===cloudAuditRefreshGeneration){cloudState={...cloudState,status:'error',error:e.code||e.message};renderCloudSyncState()}return false}}
function cloudRestoreChangeCounts(previous,cache,records){
 let added=0,enriched=0,conflicts=0;const ids=new Set((records||[]).filter(x=>x?.raceId&&x.record).map(x=>x.raceId));
 for(const id of ids){const record=cache[id];if(!record||record.cloudConflict){conflicts++;continue;}if(!previous.has(id))added++;else if(researchContentFingerprint(record)!==previous.get(id))enriched++;}
 return {added,enriched,conflicts};
}
const CLOUD_READ_OPERATION_KEY='chass_cloud_read_operation_v1';
const CLOUD_HOLD_AUDIT_KEY='chass_cloud_hold_audit_v1';
const cloudAuditFields=['race','predictionSnapshot','marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot','resultQueue','liveAdjustedPrediction','scratchAudit','snapshotIntegrity','validated','validationCompleted','status'];
const cloudAuditFieldLabels={race:'レース情報',predictionSnapshot:'元予想',marketSnapshot:'市場・確定シグナル',finalSnapshot:'FINAL',resultSnapshot:'結果',validationSnapshot:'参考検証',resultQueue:'結果取得の処理状態',liveAdjustedPrediction:'直前評価',scratchAudit:'出走取消の検証',snapshotIntegrity:'保存内容の照合',validated:'検証済み状態',validationCompleted:'検証完了状態',status:'処理状態'};
const cloudAuditLabels={signalDifferences:'Signalに相違（凍結分を含む）',integrityDifferences:'固定確認情報に相違',liveDifferences:'直前評価・取消情報に相違',identityIssues:'識別情報に不備',originalConflicts:'元予想・市場・FINALに相違',resultDifferences:'結果に相違',raceDifferences:'レース情報に相違',referenceOnly:'参照検証・処理状態のみ相違',matched:'本文・状態は一致',failed:'取得・診断未完了',deferred:'端末変更のため見送り'};
function cloudAuditCategory(differences,{identityIssue=false,signalDifference=false}={}){
 return identityIssue?'identityIssues':differences.includes('predictionSnapshot')?'originalConflicts':signalDifference?'signalDifferences':differences.some(k=>['marketSnapshot','finalSnapshot'].includes(k))?'originalConflicts':differences.includes('resultSnapshot')?'resultDifferences':differences.includes('race')?'raceDifferences':differences.includes('snapshotIntegrity')?'integrityDifferences':differences.some(k=>['liveAdjustedPrediction','scratchAudit'].includes(k))?'liveDifferences':differences.length?'referenceOnly':'matched';
}
function cloudAuditChangedPaths(a,b){
 const paths=[];
 const walk=(x,y,path,depth)=>{if(paths.length>=24||path.length>180||stableStringify(x)===stableStringify(y))return;if(depth>=6||x===null||y===null||typeof x!=='object'||typeof y!=='object'||Array.isArray(x)!==Array.isArray(y)){paths.push(path);return;}
  if(Array.isArray(x)){for(let i=0;i<Math.max(x.length,y.length)&&paths.length<24;i++)walk(x[i],y[i],`${path}[${i}]`,depth+1);}
  else for(const k of [...new Set([...Object.keys(x),...Object.keys(y)])].sort()){if(paths.length>=24)break;if(/^[a-zA-Z][a-zA-Z0-9_]*$/.test(k))walk(x[k],y[k],`${path}.${k}`,depth+1);}
 };
 for(const k of cloudAuditFields)walk(a[k],b[k],k,0);return paths;
}
function cloudAuditIntegrityDetails(record){
 const i=verifySnapshotIntegrity(record),text=v=>typeof v==='string'?v.slice(0,80):null;
 return {mismatches:i.mismatches.filter(k=>['snapshotIntegrity','predictionSnapshot','marketSnapshot','finalSnapshot'].includes(k)),temporalInvalid:i.temporalInvalid,chronology:i.chronology,predictionAt:text(record?.predictionCreatedAt||record?.predictionSnapshot?.createdAt||record?.predictionSnapshot?.generatedAt),resultAt:text(record?.resultAcquiredAt||record?.resultSnapshot?.fetchedAt||record?.resultFetchedAt)};
}
function sanitizeCloudIntegrityDetails(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const out={};for(const side of ['local','remote']){const x=value[side];if(!x||!Array.isArray(x.mismatches)||typeof x.temporalInvalid!=='boolean'||!['ordered','unknown','historical_post_result','result_before_prediction'].includes(x.chronology))return null;
 out[side]={mismatches:[...new Set(x.mismatches.filter(k=>['snapshotIntegrity','predictionSnapshot','marketSnapshot','finalSnapshot'].includes(k)))],temporalInvalid:x.temporalInvalid,chronology:x.chronology,predictionAt:typeof x.predictionAt==='string'?x.predictionAt.slice(0,80):null,resultAt:typeof x.resultAt==='string'?x.resultAt.slice(0,80):null};}return out;
}
function cloudIntegrityExplanationHtml(details){
 if(!details)return '';return ['local','remote'].map(side=>{const d=details[side];if(!d||!d.mismatches.length&&!d.temporalInvalid)return '';const reasons=[];
 if(d.mismatches.length)reasons.push(`ハッシュ不一致：${d.mismatches.map(k=>cloudAuditFieldLabels[k]||k).join('・')}`);
 if(d.temporalInvalid)reasons.push('結果取得日時が予想生成日時より前');
 return `<small>${side==='local'?'端末':'クラウド'}の要確認理由：${esc(reasons.join('／'))}${d.temporalInvalid?`<br>予想 ${esc(d.predictionAt||'不明')}／結果 ${esc(d.resultAt||'不明')}`:''}</small>`;
 }).join('');
}
function sanitizeCloudHoldAudit(value){
 if(value?.schemaVersion!==1||!Array.isArray(value.entries))return null;
 const pathPattern=/^(?:race|predictionSnapshot|marketSnapshot|finalSnapshot|resultSnapshot|validationSnapshot|resultQueue|snapshotIntegrity|liveAdjustedPrediction|scratchAudit|validated|validationCompleted|status)(?:\.[a-zA-Z][a-zA-Z0-9_]*|\[\d+\])*$/;
 const integrityStates=['verified','legacy','invalid'];
 return {schemaVersion:1,generatedAt:typeof value.generatedAt==='string'?value.generatedAt.slice(0,40):'',entries:value.entries.slice(0,100).filter(x=>x&&typeof x.raceId==='string'&&typeof x.modelVersion==='string'&&Object.hasOwn(cloudAuditLabels,x.category)).map(x=>{
  const differences=Array.isArray(x.differences)?[...new Set(x.differences.filter(k=>cloudAuditFields.includes(k)))]:[];
  // Older audits included seal/live differences in referenceOnly. Preserve their timestamp and correct that label.
  const category=x.category==='referenceOnly'?cloudAuditCategory(differences):x.category;
  return {raceId:x.raceId.slice(0,512),modelVersion:x.modelVersion.slice(0,128),category,differences,
   changedPaths:Array.isArray(x.changedPaths)?x.changedPaths.filter(p=>typeof p==='string'&&p.length<=180&&pathPattern.test(p)).slice(0,24):[],
   ...(x.integrity&&integrityStates.includes(x.integrity.local)&&integrityStates.includes(x.integrity.remote)?{integrity:{local:x.integrity.local,remote:x.integrity.remote}}:{}),
   ...(sanitizeCloudIntegrityDetails(x.integrityDetails)?{integrityDetails:sanitizeCloudIntegrityDetails(x.integrityDetails)}:{}),
   ...(x.identityIssue&&['local','remote'].includes(x.identityIssue.side)&&['CLOUD_RACE_MISMATCH','CLOUD_LAYER_BINDING_MISMATCH','CLOUD_MODEL_MISMATCH','CLOUD_IDENTITY_MISSING'].includes(x.identityIssue.code)?{identityIssue:{side:x.identityIssue.side,code:x.identityIssue.code}}:{})};
 })};
}
// Remote bodies are temporary diagnostic material, never restoration/KPI input.
const CLOUD_HOLD_EVIDENCE_MAX_BYTES=8*1024*1024,CLOUD_HOLD_EVIDENCE_ITEM_BYTES=262144;
let cloudHoldEvidence=null;
function captureCloudHoldEvidence(local,item,entry){
 if(!cloudHoldEvidence||entry.category!=='integrityDifferences')return;
 cloudHoldEvidence.eligible++;
 if(item?.ok!==true){cloudHoldEvidence.omitted.invalid++;return;}
 const localRevision=stableStringify(cloudAuditParts(local,queueCloudStatus(local)));
 const evidence={raceId:entry.raceId,modelVersion:entry.modelVersion,capturedAt:new Date().toISOString(),localPartsFingerprint:snapshotFingerprint(cloudAuditParts(local,queueCloudStatus(local))),response:{ok:true,raceId:item.raceId,modelVersion:item.modelVersion,status:item.status,updatedAt:item.updatedAt??null,record:item.record}};
 const bytes=new TextEncoder().encode(JSON.stringify(evidence)).length,localBytes=new TextEncoder().encode(localRevision).length;
 if(bytes>CLOUD_HOLD_EVIDENCE_ITEM_BYTES||localBytes>CLOUD_HOLD_EVIDENCE_ITEM_BYTES){cloudHoldEvidence.omitted.oversize++;return;}
 if(cloudHoldEvidence.entries.length>=100||cloudHoldEvidence.bytes+bytes>CLOUD_HOLD_EVIDENCE_MAX_BYTES||cloudHoldEvidence.revisionBytes+localBytes>CLOUD_HOLD_EVIDENCE_MAX_BYTES){cloudHoldEvidence.omitted.budget++;return;}
 cloudHoldEvidence.entries.push({evidence:cloneData(evidence),localRevision});cloudHoldEvidence.bytes+=bytes;cloudHoldEvidence.revisionBytes+=localBytes;
}
function exportCloudHoldEvidence(){
 const e=cloudHoldEvidence;
 if(!e)return null;
 const active=new Set(cloudSyncActiveHolds().map(manifestKey)),audit=new Set((cloudHoldAudit?.entries||[]).filter(x=>x.category==='integrityDifferences').map(manifestKey));
 let stale=0;const entries=[];
 for(const row of e.entries){const x=row.evidence,local=raceCache[x.raceId];
  if(!local||!active.has(manifestKey(x))||!audit.has(manifestKey(x))||e.auditGeneratedAt!==cloudHoldAudit?.generatedAt||stableStringify(cloudAuditParts(local,queueCloudStatus(local)))!==row.localRevision){stale++;continue;}
  entries.push(cloneData(x));
 }
 return {schemaVersion:1,purpose:'diagnostic_only',formalEarlyEvidence:false,startedAt:e.startedAt,finishedAt:e.finishedAt,auditGeneratedAt:e.auditGeneratedAt,complete:e.complete,scope:'integrityDifferences',targetCount:e.targetCount,holdsAtStart:e.holdsAtStart,eligible:e.eligible,captured:entries.length,omitted:{...e.omitted,stale},entries};
}
let cloudHoldAudit=sanitizeCloudHoldAudit(localStore.get(CLOUD_HOLD_AUDIT_KEY,null));
let cloudReadFlight=null,cloudReadOperation=readCloudOperation(localStore.get(CLOUD_READ_OPERATION_KEY,null));
function readCloudOperation(value){
 if(!value||!['restore','recheck','repair','recover','audit','reference'].includes(value.action)||!['running','success','error','partial','interrupted'].includes(value.status))return null;
 const out={action:value.action,status:value.status==='running'?'interrupted':value.status,phase:['fetch','validate','save','complete','render'].includes(value.phase)?value.phase:'fetch',startedAt:typeof value.startedAt==='string'?value.startedAt.slice(0,40):'',finishedAt:typeof value.finishedAt==='string'?value.finishedAt.slice(0,40):'',code:value.code?cloudReadErrorCode({code:value.code}):''};
 if(value.counts&&typeof value.counts==='object')out.counts=Object.fromEntries(['received','added','enriched','conflicts','unchanged','resultAdded','deferred','before','total','checked','cleared','remaining','unverifiable','skipped','metadataRecovered','referenceAdded','ready',...Object.keys(cloudAuditLabels)].filter(k=>Number.isSafeInteger(value.counts[k])&&value.counts[k]>=0).map(k=>[k,value.counts[k]]));
 return out;
}
function cloudReadErrorCode(error){const code=error?.code,mapped={d1_binding_unavailable:'DATABASE_UNAVAILABLE',d1_read_failed:'DATABASE_READ_FAILED',d1_research_read_failed:'DATABASE_READ_FAILED',d1_schema_error:'DATABASE_SCHEMA_ERROR'};return Object.hasOwn(mapped,code)?mapped[code]:['REFERENCE_AUDIT_REQUIRED','RESTORE_RESPONSE_INVALID','MANIFEST_RESPONSE_INVALID','CLOUD_READ_TIMEOUT','LOCAL_SAVE_FAILED','NETWORK_ERROR','INVALID_JSON','HTTP_ERROR','RENDER_FAILED','CLOUD_SYNC_BUSY','DATABASE_UNAVAILABLE','DATABASE_READ_FAILED','DATABASE_SCHEMA_ERROR'].includes(code)?code:code==='invalid_response'?'INVALID_JSON':error?.name==='AbortError'?'CLOUD_READ_TIMEOUT':error instanceof TypeError?'NETWORK_ERROR':Number(error?.status)>=400?'HTTP_ERROR':'NETWORK_ERROR';}
function setCloudReadOperation(patch){cloudReadOperation={...cloudReadOperation,...patch};localStore.set(CLOUD_READ_OPERATION_KEY,cloudReadOperation);renderCloudSyncState();}
async function cloudReadRequest(path,options={}){
 const controller=new AbortController();let timer;
 try{return await Promise.race([cloudRequest(path,{...options,method:options.method||'GET',signal:controller.signal}),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('cloud_read_timeout'),{code:'CLOUD_READ_TIMEOUT'}));},20000);})]);}
 finally{clearTimeout(timer);}
}
function validCloudReadRecords(data,{manifest=false}={}){
 if(!Array.isArray(data?.records)||data.records.length>5000)return false;
 const keys=new Set();return data.records.every(item=>{
  if(!item||typeof item.raceId!=='string'||!item.raceId||item.raceId.length>512)return false;
  if(manifest&&(typeof item.modelVersion!=='string'||!item.modelVersion))return false;
  if(!manifest&&(!item.record||typeof item.record!=='object'||Array.isArray(item.record)))return false;
  const key=manifest?manifestKey(item):item.raceId;if(keys.has(key))return false;keys.add(key);return true;
 });
}
function restoreResearchFromCloud(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=(async()=>{
  setCloudReadOperation({action:'restore',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:null});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   const data=await cloudReadRequest('/api/db/research');
   setCloudReadOperation({phase:'validate'});
   if(!validCloudReadRecords(data))throw Object.assign(new Error('restore_response_invalid'),{code:'RESTORE_RESPONSE_INVALID'});
   const base={...raceCache},before=Object.keys(base).length,previous=new Map(Object.entries(base).map(([id,r])=>[id,researchContentFingerprint(r)])),staged=buildCloudResearchDataset(data,{cache:base});
   setCloudReadOperation({phase:'save'});
   if(researchDb)await idbPutMany('races',Object.entries(staged.cache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));
   else if(!localStore.set(KEY,staged.cache))throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});
   // Saves completed while IndexedDB was pending keep their newer in-memory revision.
   const targets=new Set(data.records.map(x=>x.raceId)),deferredIds=new Set();const next={...raceCache};for(const [id,record] of Object.entries(staged.cache)){
    if(researchContentFingerprint(raceCache[id])===previous.get(id)||!raceCache[id]&&!base[id])next[id]=record;else if(targets.has(id))deferredIds.add(id);
   }
   raceCache=next;cloudResearchAudit=staged.audit;
   cloudResearchAudit.eligibleRaceIds=cloudResearchAudit.eligibleRaceIds.filter(id=>researchContentFingerprint(next[id])===researchContentFingerprint(staged.cache[id]));
   const effective=data.records.filter(x=>!deferredIds.has(x.raceId)),deferred=deferredIds.size,changes=cloudRestoreChangeCounts(previous,next,effective),resultAdded=effective.filter(x=>!base[x.raceId]?.resultSnapshot&&next[x.raceId]?.resultSnapshot&&!next[x.raceId]?.cloudConflict).length;
   const result={...changes,resultAdded,deferred,received:data.records.length,unchanged:Math.max(0,effective.length-changes.added-changes.enriched-changes.conflicts),total:Object.keys(next).length,before,counts:data.counts||{}};
   cloudState={...cloudState,available:true,source:'cloud',error:''};settleCloudSyncState('synced');
   setCloudReadOperation({status:deferred?'partial':'success',phase:'complete',finishedAt:new Date().toISOString(),counts:Object.fromEntries(Object.entries(result).filter(([k])=>k!=='counts')),code:''});
   return result;
  }catch(e){const code=cloudReadOperation?.phase==='save'?'LOCAL_SAVE_FAILED':cloudReadErrorCode(e);cloudState={...cloudState,status:'error',error:code};setCloudReadOperation({status:'error',code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 })().finally(()=>{cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
function recheckCloudSyncHolds(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=(async()=>{
  setCloudReadOperation({action:'recheck',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:null});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   const data=await cloudReadRequest('/api/db/manifest');if(!validCloudReadRecords(data,{manifest:true}))throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
   const remote=new Map(data.records.map(x=>[manifestKey(x),x]));cloudManifestCache.clear();for(const [key,value] of remote)cloudManifestCache.set(key,value);
   const holds=cloudSyncActiveHolds();let cleared=0;
   for(const h of holds){const record=raceCache[h.raceId],key=manifestKey(h);if(record&&!record.cloudConflict&&!cloudMergeBindingIssue(record,h.raceId)&&manifestMatches(cloudDescriptor(h.raceId,record),remote.get(key))){cloudSyncClearHold(key);setCloudPending(h.raceId,false);cleared++;}}
   cloudState={...cloudState,available:true,source:'cloud',error:'',...(cleared?{lastSyncedAt:new Date().toISOString()}:{})};settleCloudSyncState('connected');
   const unverifiable=holds.filter(h=>remote.get(manifestKey(h))?.fingerprintStatus==='unavailable').length;
   const counts={checked:holds.length,cleared,remaining:cloudSyncActiveHolds().length,...(unverifiable?{unverifiable}:{})};setCloudReadOperation({status:'success',phase:'complete',code:'',counts,finishedAt:new Date().toISOString()});return counts;
  }catch(e){const code=cloudReadErrorCode(e);cloudState={...cloudState,status:'error',error:code};setCloudReadOperation({status:'error',code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 })().finally(()=>{cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
function cloudAuditParts(record,status){const race=cloneData(record?.race||{}),parts={race};for(const k of ['resultQueue','liveAdjustedPrediction','scratchAudit','snapshotIntegrity']){parts[k]=record?.[k]??race[k]??null;delete race[k];}for(const k of ['predictionSnapshot','marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot'])parts[k]=record?.[k]??null;parts.validated=!!record?.validated;parts.validationCompleted=!!record?.validationCompleted;parts.status=status;return parts;}
function compareCloudHoldRecord(local,item,id,model){
 if(!local||item?.raceId!==id||item?.modelVersion!==model||!item?.record||Array.isArray(item.record)||!item.record.race||!item.record.predictionSnapshot||typeof item.status!=='string')throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
 const a=cloudAuditParts(local,queueCloudStatus(local)),b=cloudAuditParts(item.record,item.status),differences=cloudAuditFields.filter(k=>stableStringify(a[k])!==stableStringify(b[k]));
 const identityIssue=cloudMergeBindingIssue(local,id)||cloudMergeBindingIssue(item.record,id)||String(local.predictionSnapshot?.modelVersion||local.modelVersion||'Legacy')!==model||String(item.record.predictionSnapshot?.modelVersion||item.record.modelVersion||'Legacy')!==model;
 const signalDifference=stableStringify(a.marketSnapshot?.signalSnapshot??null)!==stableStringify(b.marketSnapshot?.signalSnapshot??null);
 const category=cloudAuditCategory(differences,{identityIssue:!!identityIssue,signalDifference});
 const localIssue=cloudMergeBindingIssue(local,id),remoteIssue=cloudMergeBindingIssue(item.record,id);
 return {raceId:id,modelVersion:model,category,differences,changedPaths:cloudAuditChangedPaths(a,b),integrityDetails:{local:cloudAuditIntegrityDetails(local),remote:cloudAuditIntegrityDetails(item.record)},integrity:{local:verifySnapshotIntegrity(local).status,remote:verifySnapshotIntegrity(item.record).status},...(identityIssue?{identityIssue:{side:localIssue?'local':'remote',code:localIssue||remoteIssue||'CLOUD_MODEL_MISMATCH'}}:{})};
}
function auditCloudSyncHolds(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=Promise.resolve().then(async()=>{
  const counts={total:0,checked:0,...Object.fromEntries(Object.keys(cloudAuditLabels).map(k=>[k,0]))},entries=[];
  const saveAudit=()=>{const next={schemaVersion:1,generatedAt:new Date().toISOString(),entries:cloneData(entries)};if(!localStore.set(CLOUD_HOLD_AUDIT_KEY,next))throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});cloudHoldAudit=next;if(cloudHoldEvidence)cloudHoldEvidence.auditGeneratedAt=next.generatedAt;};
  setCloudReadOperation({action:'audit',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:{...counts}});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   cloudHoldEvidence={startedAt:new Date().toISOString(),finishedAt:'',auditGeneratedAt:'',complete:false,eligible:0,bytes:0,revisionBytes:0,omitted:{invalid:0,oversize:0,budget:0},entries:[]};
   const activeHolds=cloudSyncActiveHolds(),targets=activeHolds.slice(0,100);counts.total=targets.length;cloudHoldEvidence.targetCount=targets.length;cloudHoldEvidence.holdsAtStart=activeHolds.length;
   for(const h of targets){
    const before=stableStringify(raceCache[h.raceId]);let entry;
    try{const item=await cloudReadRequest(`/api/db/hold-audit?raceId=${encodeURIComponent(h.raceId)}&modelVersion=${encodeURIComponent(h.modelVersion)}`);entry=stableStringify(raceCache[h.raceId])===before?compareCloudHoldRecord(raceCache[h.raceId],item,h.raceId,h.modelVersion):{raceId:h.raceId,modelVersion:h.modelVersion,category:'deferred',differences:[]};captureCloudHoldEvidence(raceCache[h.raceId],item,entry);}
    catch(e){if(e?.code==='CLOUD_READ_TIMEOUT'||e?.name==='TypeError'||e?.code==='NETWORK_ERROR')throw e;entry={raceId:h.raceId,modelVersion:h.modelVersion,category:'failed',differences:[]};}
    entries.push(entry);counts.checked++;counts[entry.category]++;saveAudit();setCloudReadOperation({counts:{...counts}});
   }
   saveAudit();cloudHoldEvidence.complete=!counts.failed&&!counts.deferred&&cloudHoldEvidence.targetCount===cloudHoldEvidence.holdsAtStart;cloudHoldEvidence.finishedAt=new Date().toISOString();setCloudReadOperation({status:counts.failed||counts.deferred?'partial':'success',phase:'complete',counts:{...counts},finishedAt:new Date().toISOString()});return counts;
  }catch(e){const code=cloudReadErrorCode(e);setCloudReadOperation({status:counts.checked?'partial':'error',counts:{...counts},code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 }).finally(()=>{if(cloudHoldEvidence&&!cloudHoldEvidence.finishedAt)cloudHoldEvidence.finishedAt=new Date().toISOString();cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
function recoverCloudFingerprintMetadata(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=Promise.resolve().then(async()=>{
  const counts={total:0,checked:0,metadataRecovered:0,ready:0,cleared:0,conflicts:0,deferred:0,skipped:0,remaining:cloudSyncActiveHolds().length};
  setCloudReadOperation({action:'recover',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:{...counts}});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   const manifest=await cloudReadRequest('/api/db/manifest');if(!validCloudReadRecords(manifest,{manifest:true}))throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
   const remote=new Map(manifest.records.map(x=>[manifestKey(x),x]));
   const targets=cloudSyncActiveHolds().filter(h=>['MANIFEST_FINGERPRINT_UNAVAILABLE','REMOTE_RESULT_PRESERVED'].includes(h.reason)).slice(0,1500);counts.total=targets.length;
   for(const h of targets){
    const key=manifestKey(h),record=raceCache[h.raceId];
    counts.checked++;setCloudReadOperation({counts:{...counts}});
    if(!record||record.cloudConflict||cloudMergeBindingIssue(record,h.raceId)||cloudDescriptor(h.raceId,record).modelVersion!==h.modelVersion){counts.skipped++;continue;}
    const revision=stableStringify(record);let descriptor=remote.get(key);
    if(descriptor?.fingerprintStatus==='unavailable'||h.reason==='REMOTE_RESULT_PRESERVED'){
     const reply=await cloudReadRequest('/api/db/recover-fingerprints',{method:'POST',body:JSON.stringify({raceId:h.raceId,modelVersion:h.modelVersion,...(h.reason==='REMOTE_RESULT_PRESERVED'?{refreshExisting:true}:{})})});
     if(reply.raceId!==h.raceId||reply.modelVersion!==h.modelVersion||!['recovered','refreshed','already_present','skipped','concurrent_change'].includes(reply.outcome))throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
     if(reply.outcome==='skipped'){counts.skipped++;continue;}
     if(reply.outcome==='concurrent_change'){counts.deferred++;continue;}
     if(reply.metadataWritten!==(['recovered','refreshed'].includes(reply.outcome)))throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
     descriptor=reply.descriptor;
     if(reply.metadataWritten)counts.metadataRecovered++;
    }
    if(!descriptor||manifestKey(descriptor)!==key||descriptor.fingerprintStatus!=='stored'||!['raceFingerprint','predictionFingerprint','liveFingerprint'].every(k=>typeof descriptor[k]==='string'&&descriptor[k].length>0)||!['marketFingerprint','finalFingerprint','resultFingerprint','validationFingerprint'].every(k=>descriptor[k]===null||typeof descriptor[k]==='string'&&descriptor[k].length>0)){counts.skipped++;continue;}
    counts.ready++;cloudManifestCache.set(key,cloneData(descriptor));
    if(stableStringify(raceCache[h.raceId])!==revision){counts.deferred++;continue;}
    if(manifestMatches(cloudDescriptor(h.raceId,record),descriptor)&&['MANIFEST_FINGERPRINT_UNAVAILABLE','REMOTE_RESULT_PRESERVED'].includes(cloudSyncHolds.get(key)?.reason)){cloudSyncClearHold(key);setCloudPending(h.raceId,false);counts.cleared++;}
    else counts.conflicts++;
    counts.remaining=cloudSyncActiveHolds().length;setCloudReadOperation({counts:{...counts}});
   }
   counts.remaining=cloudSyncActiveHolds().length;
   cloudState={...cloudState,available:true,source:'cloud',error:''};settleCloudSyncState('connected');
   setCloudReadOperation({status:counts.conflicts||counts.deferred||counts.skipped?'partial':'success',phase:'complete',counts:{...counts},finishedAt:new Date().toISOString()});return counts;
  }catch(e){counts.remaining=cloudSyncActiveHolds().length;const code=cloudReadErrorCode(e);setCloudReadOperation({status:counts.metadataRecovered||counts.cleared?'partial':'error',counts:{...counts},code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 }).finally(()=>{cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
function buildReferenceRestoreRecord(local,item,id,model){
 const reject=()=>{throw Object.assign(new Error('reference_restore_rejected'),{code:'REFERENCE_RESTORE_REJECTED'});};
 const remote=item?.record;
 if(!local||local.cloudConflict||item?.ok!==true||item?.raceId!==id||item?.modelVersion!==model||!remote||item.status!=='validated'||remote.validated!==true||remote.validationCompleted!==true)reject();
 const audit=compareCloudHoldRecord(local,item,id,model);
 if(!['referenceOnly','matched'].includes(audit.category)||audit.differences.some(k=>!['validationSnapshot','resultQueue','validated','validationCompleted','status'].includes(k)))reject();
 for(const r of [local,remote]){const i=verifySnapshotIntegrity(r);if(i.status!=='verified'||i.chronology!=='ordered')reject();}
 const validation=remote.validationSnapshot,queue=remote.resultQueue,order=remote.resultSnapshot?.finishOrder,known=new Set((local.predictionSnapshot?.horses||[]).map(h=>Number(h.horseNo)));
 if(!validation||Array.isArray(validation)||validation.raceId!==id||String(validation.modelVersion)!==model||validation.automaticResultQueue!==true||!Array.isArray(validation.failures)||!Array.isArray(validation.checks)||!validation.checks.some(x=>x?.code==='AUTO_RESULT_QUEUE')||!Number.isFinite(Date.parse(validation.generatedAt))||!queue||queue.raceId!==id||String(queue.modelVersion)!==model||queue.status!=='validated')reject();
 if(!Array.isArray(order)||order.length<3||order.some(n=>!['number','string'].includes(typeof n)||String(n).trim()===''||!Number.isInteger(Number(n))||Number(n)<=0||!known.has(Number(n)))||new Set(order.map(Number)).size!==order.length||stableStringify(validation.finishOrder)!==stableStringify(order))reject();
 if(local.validationSnapshot!=null&&stableStringify(local.validationSnapshot)!==stableStringify(validation))reject();
 const previous=local.resultQueue;
 if(!previous||previous.enabled===false||previous.status==='paused'||previous.history?.length&&stableStringify(previous)!==stableStringify(queue))reject();
 const operational=new Set(['status','resultStatus','attempts','totalAttempts','nextCheckAt','lastResultCheckAt','lastResultError','completedAt','history','retryLimitReached']);
 for(const k of new Set([...Object.keys(previous),...Object.keys(queue)]))if(!operational.has(k)&&stableStringify(previous[k])!==stableStringify(queue[k]))reject();
 // These legacy booleans describe completion of the reference result report.
 // No authenticated EARLY receipt, original seal or KPI eligibility is created.
 return {...cloneData(local),validationSnapshot:cloneData(validation),resultQueue:cloneData(queue),validated:true,validationCompleted:true};
}
async function persistReferenceRestore(id,next,revision){
 if(stableStringify(raceCache[id])!==revision)return false;
 if(!researchDb){if(!localStore.set(KEY,{...raceCache,[id]:next}))throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});return true;}
 return new Promise((resolve,reject)=>{
  let written=false;const tx=researchDb.transaction('races','readwrite'),objectStore=tx.objectStore('races'),request=objectStore.get(id);
  request.onsuccess=()=>{try{if(stableStringify(raceCache[id])!==revision||stableStringify(request.result?.data)!==revision)return;objectStore.put({id,data:next,updatedAt:stableRecordUpdatedAt(next)});written=true;}catch(e){tx.abort();}};
  tx.oncomplete=()=>resolve(written);tx.onerror=()=>reject(Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'}));tx.onabort=()=>reject(Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'}));
 });
}
function clearReferenceRestoreHold(key,id){
 if(cloudSyncHolds.get(key)?.reason!=='REMOTE_RESULT_PRESERVED')return false;
 const holds=new Map(cloudSyncHolds),pending=new Set(cloudPending);holds.delete(key);pending.delete(id);
 if(!localStore.set(CLOUD_PENDING_KEY,[...pending])||!localStore.set(CLOUD_SYNC_HOLD_KEY,Object.fromEntries(holds)))throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});
 cloudSyncHolds.delete(key);cloudPending.delete(id);return true;
}
function restoreCloudReferenceValidation(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=Promise.resolve().then(async()=>{
  const counts={total:0,checked:0,referenceAdded:0,unchanged:0,cleared:0,conflicts:0,deferred:0,skipped:0,remaining:cloudSyncActiveHolds().length};
  setCloudReadOperation({action:'reference',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:{...counts}});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   if(!cloudHoldAudit)throw Object.assign(new Error('reference_audit_required'),{code:'REFERENCE_AUDIT_REQUIRED'});
   const diagnosed=new Set(cloudHoldAudit.entries.filter(x=>x.category==='referenceOnly').map(manifestKey)),targets=cloudSyncActiveHolds().filter(h=>h.reason==='REMOTE_RESULT_PRESERVED'&&diagnosed.has(manifestKey(h))).slice(0,100),staged=[];counts.total=targets.length;
   for(const h of targets){
    const original=raceCache[h.raceId],revision=stableStringify(original);counts.checked++;
    const item=await cloudReadRequest(`/api/db/hold-audit?raceId=${encodeURIComponent(h.raceId)}&modelVersion=${encodeURIComponent(h.modelVersion)}`);
    if(stableStringify(raceCache[h.raceId])!==revision){counts.deferred++;continue;}
    let next;try{next=buildReferenceRestoreRecord(original,item,h.raceId,h.modelVersion);}catch{counts.conflicts++;continue;}
    staged.push({h,revision,next});setCloudReadOperation({counts:{...counts}});
   }
   if(staged.length){
    // Read current summaries after the selected bodies; never clear on an old cached manifest.
    const manifest=await cloudReadRequest('/api/db/manifest');if(!validCloudReadRecords(manifest,{manifest:true}))throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
    const descriptors=new Map(manifest.records.map(x=>[manifestKey(x),x]));if(descriptors.size!==manifest.records.length)throw Object.assign(new Error('manifest_response_invalid'),{code:'MANIFEST_RESPONSE_INVALID'});
    for(const {h,revision,next}of staged){const key=manifestKey(h),descriptor=descriptors.get(key);
     if(stableStringify(raceCache[h.raceId])!==revision||cloudSyncHolds.get(key)?.reason!=='REMOTE_RESULT_PRESERVED'){counts.deferred++;continue;}
     if(descriptor?.fingerprintStatus!=='stored'||!manifestMatches(cloudDescriptor(h.raceId,next),descriptor)){counts.conflicts++;continue;}
     const changed=stableStringify(next)!==revision;setCloudReadOperation({phase:'save',counts:{...counts}});
     let saved;try{saved=!changed||await persistReferenceRestore(h.raceId,next,revision);}catch{throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});}
     if(!saved){counts.deferred++;continue;}
     if(stableStringify(raceCache[h.raceId])!==revision){counts.deferred++;continue;}
     raceCache[h.raceId]=next;if(changed)counts.referenceAdded++;else counts.unchanged++;
     if(clearReferenceRestoreHold(key,h.raceId)){cloudManifestCache.set(key,cloneData(descriptor));counts.cleared++;}else counts.deferred++;
     counts.remaining=cloudSyncActiveHolds().length;setCloudReadOperation({counts:{...counts}});
    }
   }
   counts.remaining=cloudSyncActiveHolds().length;setCloudReadOperation({status:counts.conflicts||counts.deferred||counts.skipped?'partial':'success',phase:'complete',counts:{...counts},finishedAt:new Date().toISOString()});return counts;
  }catch(e){counts.remaining=cloudSyncActiveHolds().length;const code=cloudReadErrorCode(e);setCloudReadOperation({status:counts.referenceAdded||counts.cleared?'partial':'error',counts:{...counts},code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 }).finally(()=>{cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
function buildResultRepairRecord(local,item,id,model){
 const reject=()=>{throw Object.assign(new Error('repair_response_invalid'),{code:'repair_response_invalid'});};
 const remote=item?.record;
 if(!local||local.resultSnapshot||local.result?.finishOrder?.length||local.cloudConflict||item?.raceId!==id||item?.modelVersion!==model||!remote?.resultSnapshot||cloudMergeBindingIssue(local,id)||cloudMergeBindingIssue(remote,id))reject();
 const a=activeRaceIdentity(local),b=activeRaceIdentity(remote);
 if(a.raceId!==b.raceId||a.organization!==b.organization||String(local.predictionSnapshot?.modelVersion||local.modelVersion||'Legacy')!==model||String(remote.predictionSnapshot?.modelVersion||remote.modelVersion||'Legacy')!==model||!local.predictionSnapshot?.horses?.length||stableStringify(local.predictionSnapshot)!==stableStringify(remote.predictionSnapshot))reject();
 const order=remote.resultSnapshot.finishOrder,known=new Set(local.predictionSnapshot.horses.map(h=>Number(h.horseNo)));
 if(!Array.isArray(order)||order.length<3||order.some(n=>!['number','string'].includes(typeof n)||String(n).trim()===''||!Number.isInteger(Number(n))||Number(n)<=0||!known.has(Number(n)))||new Set(order.map(Number)).size!==order.length)reject();
 return {...cloneData(local),resultSnapshot:cloneData(remote.resultSnapshot),...(!local.resultAcquiredAt?{resultAcquiredAt:remote.resultSnapshot.fetchedAt||remote.resultAcquiredAt||null}:{})};
}
function repairHeldCloudResults(){
 if(cloudReadFlight)return cloudReadFlight;
 cloudReadFlight=Promise.resolve().then(async()=>{
  const counts={total:0,checked:0,resultAdded:0,conflicts:0,deferred:0,skipped:0};
  setCloudReadOperation({action:'repair',status:'running',phase:'fetch',startedAt:new Date().toISOString(),finishedAt:'',code:'',counts:{...counts}});
  try{
   if(cloudBulkFlight||cloudSyncFlights.size)throw Object.assign(new Error('cloud_sync_busy'),{code:'CLOUD_SYNC_BUSY'});
   const targets=cloudSyncActiveHolds().filter(h=>h.reason==='REMOTE_RESULT_PRESERVED'&&raceCache[h.raceId]?.predictionSnapshot&&!raceCache[h.raceId].resultSnapshot&&!raceCache[h.raceId].result?.finishOrder?.length&&!raceCache[h.raceId].cloudConflict&&!cloudMergeBindingIssue(raceCache[h.raceId],h.raceId)&&cloudDescriptor(h.raceId,raceCache[h.raceId]).modelVersion===h.modelVersion).slice(0,100);
   counts.total=targets.length;
   for(const h of targets){
    const original=raceCache[h.raceId],revision=stableStringify(original);
    setCloudReadOperation({phase:'fetch',counts:{...counts}});
    const item=await cloudReadRequest(`/api/db/result-repair?raceId=${encodeURIComponent(h.raceId)}&modelVersion=${encodeURIComponent(h.modelVersion)}`);counts.checked++;
    if(stableStringify(raceCache[h.raceId])!==revision){counts.deferred++;continue;}
    let next;try{next=buildResultRepairRecord(original,item,h.raceId,h.modelVersion);}catch{counts.conflicts++;continue;}
    setCloudReadOperation({phase:'save',counts:{...counts}});
    try{if(researchDb)await idbPut('races',{id:h.raceId,data:next,updatedAt:stableRecordUpdatedAt(next)});else if(!localStore.set(KEY,{...raceCache,[h.raceId]:next}))throw Error('local_save_failed');}
    catch{throw Object.assign(new Error('local_save_failed'),{code:'LOCAL_SAVE_FAILED'});}
    if(stableStringify(raceCache[h.raceId])!==revision){counts.deferred++;continue;}
    raceCache[h.raceId]=next;counts.resultAdded++;
    // Holds, pending state, original signals and formal validation stay unchanged.
   }
   setCloudReadOperation({status:counts.conflicts||counts.deferred?'partial':'success',phase:'complete',counts:{...counts},code:'',finishedAt:new Date().toISOString()});return counts;
  }catch(e){const code=cloudReadErrorCode(e);setCloudReadOperation({status:counts.resultAdded?'partial':'error',counts:{...counts},code,finishedAt:new Date().toISOString()});throw Object.assign(new Error(code),{code});}
 }).finally(()=>{cloudReadFlight=null;renderCloudSyncState();});return cloudReadFlight;
}
async function cloudRequest(path,options={}){
 const response=await fetch(path,{cache:'no-store',...options,headers:{'content-type':'application/json',...(options.headers||{})}});
 let data;try{data=await response.json();}catch(error){
  // Body reads can fail after headers arrive: do not label transport failures as malformed JSON.
  const code=options.signal?.aborted||error?.name==='AbortError'?'CLOUD_READ_TIMEOUT':error?.name==='SyntaxError'?(response.ok?'invalid_response':'HTTP_ERROR'):'NETWORK_ERROR';
  throw Object.assign(new Error(code),{status:response.status,code});
 }
 if(!response.ok||data?.ok!==true){const sync=path==='/api/db/sync',code=data?.error||(sync&&response.status===409?'SYNC_CONFLICT':`HTTP ${response.status}`);throw Object.assign(new Error(code),{status:response.status,code,...(sync&&Array.isArray(data?.records)?{syncResponse:data}:{})});}
 return data;
}
const CLOUD_SYNC_HOLD_KEY='chass_cloud_sync_holds_v1';
const cloudSyncHolds=new Map(Object.entries(localStore.get(CLOUD_SYNC_HOLD_KEY,{})||{}));
const cloudSyncFlights=new Map();let cloudBulkFlight=null;
const cloudSyncReasonLabels={PREDICTION_SNAPSHOT_CONFLICT:'元予測の不一致',FROZEN_SIGNAL_CONFLICT:'凍結Signalの不一致',FROZEN_WARNING_CONFLICT:'凍結警告の不一致',snapshot_binding_conflict:'レース・モデルの不一致',LOCAL_CLOUD_CONFLICT:'復元時の競合',REMOTE_RESULT_PRESERVED:'クラウドの結果を保持',REMOTE_STATE_DIFFERENT:'クラウドの保存内容を要確認',SYNC_RESPONSE_INVALID:'保存応答を確認できない',SYNC_OUTCOME_UNKNOWN:'保存成否が不明',SYNC_CONFLICT:'保存内容の競合',duplicate_sync_identity:'同期対象の重複',MANIFEST_FINGERPRINT_UNAVAILABLE:'クラウドの照合情報不足（送信停止）'};
function cloudSyncReason(code,fallback='SYNC_CONFLICT'){return Object.hasOwn(cloudSyncReasonLabels,code)?code:fallback;}
function cloudSyncCurrent(id,fallback){return raceCache[id]||fallback;}
function cloudSyncSameRevision(id,record){const current=cloudSyncCurrent(id,record);return manifestKey(cloudDescriptor(id,current))===manifestKey(cloudDescriptor(id,record))&&researchContentFingerprint(current)===researchContentFingerprint(record);}
function cloudSyncHold(id,record,reason){
 const descriptor=cloudDescriptor(id,record),key=manifestKey(descriptor),hold={raceId:id,modelVersion:descriptor.modelVersion,reason:cloudSyncReason(reason),heldAt:new Date().toISOString()};
 cloudSyncHolds.set(key,hold);cloudManifestCache.delete(key);localStore.set(CLOUD_SYNC_HOLD_KEY,Object.fromEntries(cloudSyncHolds));
 if(manifestKey(cloudDescriptor(id,cloudSyncCurrent(id,record)))===key)setCloudPending(id,false);return hold;
}
function cloudSyncClearHold(key){if(cloudSyncHolds.delete(key))localStore.set(CLOUD_SYNC_HOLD_KEY,Object.fromEntries(cloudSyncHolds));}
function cloudSyncActiveHolds(){return [...cloudSyncHolds.values()].filter(h=>h&&typeof h.raceId==='string'&&typeof h.modelVersion==='string');}
function settleCloudSyncState(status='synced',summary=null){
 const held=cloudSyncActiveHolds().length,pending=cloudPending.size;
 cloudState={...cloudState,status:held?'held':status==='error'?'error':pending?'pending':status,...(summary?{summary}:{})};renderCloudSyncState();
}
function cloudSyncSummary(records=[]){const out={created:0,updated:0,unchanged:0,held:0,failed:0,pending:0};for(const r of records)if(Object.hasOwn(out,r.status))out[r.status]++;return out;}
function applyCloudSyncResponse(batch,payload,{unknown=false}={}){
 const replies=Array.isArray(payload?.records)?payload.records:[],byKey=new Map();
 for(const reply of replies){if(!reply||typeof reply!=='object')continue;const key=manifestKey({raceId:reply.raceId,modelVersion:reply.modelVersion||reply.descriptor?.modelVersion});const group=byKey.get(key)||[];group.push(reply);byKey.set(key,group);}
 return batch.map(({raceId:id,record})=>{
  const local=cloudDescriptor(id,record),key=manifestKey(local),group=byKey.get(key)||[],reply=group.length===1?group[0]:null;
  let reason=null,status=reply?.status;
  if(reply?.status==='not_attempted'){setCloudPending(id,true);return {attempted:true,raceId:id,modelVersion:local.modelVersion,status:'pending',written:false,reason:reply.error||'NOT_ATTEMPTED'};}
  if(reply?.status==='conflict')reason=cloudSyncReason(reply.error);
  else if(reply?.status==='failed'&&reply.outcomeKnown===true&&reply.written===false){setCloudPending(id,true);return {attempted:true,raceId:id,modelVersion:local.modelVersion,status:'failed',written:false,reason:'SYNC_FAILED'};}
  else if(!reply||!['created','updated','unchanged'].includes(status)||typeof reply.written!=='boolean'||status==='unchanged'&&reply.written||status!=='unchanged'&&!reply.written)reason=unknown||reply?.outcomeKnown===false?'SYNC_OUTCOME_UNKNOWN':'SYNC_RESPONSE_INVALID';
  else if(reply.reason==='REMOTE_RESULT_PRESERVED')reason='REMOTE_RESULT_PRESERVED';
  else if(reply.descriptor&&!manifestMatches(local,reply.descriptor))reason='REMOTE_STATE_DIFFERENT';
  else if(status==='unchanged'&&!reply.descriptor)reason='SYNC_RESPONSE_INVALID';
  if(reason){cloudSyncHold(id,record,reason);return {attempted:true,raceId:id,modelVersion:local.modelVersion,status:'held',written:null,reason};}
  cloudSyncClearHold(key);if(reply.descriptor)cloudManifestCache.set(key,cloneData(reply.descriptor));else cloudManifestCache.delete(key);
  if(cloudSyncSameRevision(id,record))setCloudPending(id,false);else setCloudPending(id,true);
  if(reply.written)storageDiagnostic('d1Write');
  return {attempted:true,raceId:id,modelVersion:local.modelVersion,status,written:reply.written};
 });
}
async function sendCloudSyncBatch(entries){
 if(cloudReadFlight){return entries.map(({raceId,record})=>{setCloudPending(raceId,true);return {raceId,modelVersion:cloudDescriptor(raceId,record).modelVersion,status:'pending',written:false,reason:'CLOUD_READ_IN_PROGRESS'};});}
 const waiting=[...new Set(entries.map(x=>cloudSyncFlights.get(manifestKey(cloudDescriptor(x.raceId,x.record)))).filter(Boolean))];
 if(waiting.length){await Promise.allSettled(waiting);return sendCloudSyncBatch(entries);}
 const skipped=[],batch=[];
 for(const entry of entries){
  const record=cloneData(cloudSyncCurrent(entry.raceId,entry.record)),id=entry.raceId,local=cloudDescriptor(id,record),key=manifestKey(local);
  if(record.cloudConflict){cloudSyncHold(id,record,'LOCAL_CLOUD_CONFLICT');skipped.push({raceId:id,modelVersion:local.modelVersion,status:'held',reason:'LOCAL_CLOUD_CONFLICT'});continue;}
  if(manifestMatches(local,cloudManifestCache.get(key))){cloudSyncClearHold(key);setCloudPending(id,false);skipped.push({raceId:id,modelVersion:local.modelVersion,status:'unchanged',written:false,confirmation:'ACK_OR_MANIFEST_CACHE'});continue;}
  const hold=cloudSyncHolds.get(key);if(hold){skipped.push({raceId:id,modelVersion:local.modelVersion,status:'held',reason:hold.reason});continue;}
  if(cloudManifestCache.get(key)?.fingerprintStatus==='unavailable'){cloudSyncHold(id,record,'MANIFEST_FINGERPRINT_UNAVAILABLE');skipped.push({raceId:id,modelVersion:local.modelVersion,status:'held',reason:'MANIFEST_FINGERPRINT_UNAVAILABLE'});continue;}
  batch.push({raceId:id,record});setCloudPending(id,true);
 }
 if(!batch.length)return skipped;
 let task;task=Promise.resolve().then(async()=>{
  let payload,unknown=false;
  try{storageDiagnostic('cloudPost');payload=await cloudRequest('/api/db/sync',{method:'POST',body:JSON.stringify({records:batch})});cloudState={...cloudState,available:true,source:'cloud'};}
  catch(e){payload=e.syncResponse;unknown=!payload;cloudState={...cloudState,error:cloudSyncReason(e.code,'SYNC_OUTCOME_UNKNOWN')};if(payload)cloudState.available=true;}
  const outcomes=applyCloudSyncResponse(batch,payload,{unknown}),accepted=outcomes.some(x=>['created','updated','unchanged'].includes(x.status));
  if(accepted)cloudState={...cloudState,error:'',lastSyncedAt:new Date().toISOString()};
  settleCloudSyncState(outcomes.some(x=>x.status==='failed')?'error':'synced');
  return [...skipped,...outcomes];
 }).finally(()=>{for(const entry of batch){const key=manifestKey(cloudDescriptor(entry.raceId,entry.record));if(cloudSyncFlights.get(key)===task)cloudSyncFlights.delete(key);}});
 for(const entry of batch)cloudSyncFlights.set(manifestKey(cloudDescriptor(entry.raceId,entry.record)),task);
 return task;
}
async function syncRaceToCloud(id,data){
 if(typeof fetch!=='function'||!id||!data?.predictionSnapshot)return false;
 const outcomes=await sendCloudSyncBatch([{raceId:id,record:data}]),saved=outcomes[0];settleCloudSyncState(saved?.status==='failed'?'error':'synced',cloudSyncSummary(outcomes));
 return saved&&['created','updated','unchanged'].includes(saved.status)?saved:false;
}
function syncAllResearchToCloud(){
 if(cloudBulkFlight)return cloudBulkFlight;
 cloudBulkFlight=(async()=>{
  const entries=Object.entries(raceCache).filter(([,record])=>record?.predictionSnapshot).map(([raceId,record])=>({raceId,record}));
  if(!entries.length)return {...cloudSyncSummary(),total:0,target:0,synced:0};
  cloudState.status='syncing';renderCloudSyncState();storageDiagnostic('d1Read');
  let manifest;try{manifest=await cloudRequest('/api/db/manifest');}catch(e){cloudState.error=e.code||'MANIFEST_READ_FAILED';settleCloudSyncState('error');throw e;}
  const remote=new Map((manifest.records||[]).map(item=>[manifestKey(item),item]));cloudManifestCache.clear();for(const [key,value] of remote)cloudManifestCache.set(key,value);
  cloudState={...cloudState,available:true,source:'cloud'};const outcomes=[];
  for(let i=0;i<entries.length;i+=25){
   const chunk=await sendCloudSyncBatch(entries.slice(i,i+25));outcomes.push(...chunk);
   if(chunk.some(x=>x.status==='held'&&['SYNC_OUTCOME_UNKNOWN','SYNC_RESPONSE_INVALID'].includes(x.reason))){for(const item of entries.slice(i+25)){setCloudPending(item.raceId,true);outcomes.push({raceId:item.raceId,modelVersion:cloudDescriptor(item.raceId,item.record).modelVersion,status:'pending',written:false,reason:'BATCH_STOPPED'});}break;}
  }
  const summary=cloudSyncSummary(outcomes),result={...summary,total:entries.length,target:outcomes.filter(x=>x.attempted).length,synced:summary.created+summary.updated,records:outcomes};
  if(summary.unchanged===entries.length)cloudState.lastSyncedAt=new Date().toISOString();
  settleCloudSyncState(summary.failed?'error':'synced',result);return result;
 })().finally(()=>{cloudBulkFlight=null;renderCloudSyncState();});return cloudBulkFlight;
}
async function initCloudResearch(){
 if(typeof fetch!=='function')return false;
 try{
  await cloudRequest('/api/db/health');cloudState={...cloudState,available:true,status:'connected',error:''};
  storageDiagnostic('d1Read');const manifest=await cloudRequest('/api/db/manifest'),remoteManifest=new Map((manifest.records||[]).map(item=>[manifestKey(item),item]));for(const [key,value] of remoteManifest)cloudManifestCache.set(key,value);
  const localDiff=new Set(Object.entries(raceCache).filter(([id,record])=>{if(!record?.predictionSnapshot)return false;const local=cloudDescriptor(id,record),remote=remoteManifest.get(manifestKey(local));return cloudPending.has(id)||!manifestMatches(local,remote)}).map(([id])=>id));
  if(researchDb)await idbPutMany('races',Object.entries(raceCache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));
  cloudState.source='cloud';researchStorageMode='d1+indexedDB';
  for(const id of new Set([...cloudPending,...localDiff]))if(raceCache[id])await syncRaceToCloud(id,raceCache[id]);
  settleCloudSyncState('connected');renderCloudDatasetSummary();return true;
 }catch(e){cloudState={...cloudState,available:false,source:'local',status:'local',error:e.code||e.message};renderCloudSyncState();return false}
}
function saveRaceRecord(id,data){raceCache[id]=data;if(researchDb){storageDiagnostic('indexedDbWrite');const localWrite=idbPut('races',{id,data,updatedAt:stableRecordUpdatedAt(data)});queueStorageWrite(localWrite,()=>localStore.set(KEY,raceCache));localWrite.then(()=>syncRaceToCloud(id,data)).catch(()=>{})}else{localStore.set(KEY,raceCache);syncRaceToCloud(id,data)}}
function saveOddsHistory(id,history){oddsHistoryCache[id]=history;if(researchDb)queueStorageWrite(idbPut('oddsHistory',{raceId:id,history,updatedAt:new Date().toISOString()}),()=>localStore.set(ODDS_HISTORY,oddsHistoryCache));else localStore.set(ODDS_HISTORY,oddsHistoryCache)}
function saveCurrentRace(id){currentRaceCache=id;localStore.set(CURRENT,id);if(researchDb)queueStorageWrite(idbPut('settings',{key:'currentRace',value:id}),null)}
const store={get(k,d){if(k===KEY)return raceCache;if(k===ODDS_HISTORY)return oddsHistoryCache;if(k===CURRENT)return currentRaceCache;return localStore.get(k,d)},set(k,v){if(k===KEY){raceCache=v;if(researchDb)queueStorageWrite(idbPutMany('races',Object.entries(v).map(([id,data])=>({id,data,updatedAt:stableRecordUpdatedAt(data)}))),()=>localStore.set(KEY,raceCache));else localStore.set(KEY,v);return}if(k===ODDS_HISTORY){oddsHistoryCache=v;if(researchDb)queueStorageWrite(idbPutMany('oddsHistory',Object.entries(v).map(([raceId,history])=>({raceId,history,updatedAt:new Date().toISOString()}))),()=>localStore.set(ODDS_HISTORY,oddsHistoryCache));else localStore.set(ODDS_HISTORY,v);return}if(k===CURRENT){saveCurrentRace(v);return}localStore.set(k,v)}};
async function initResearchStorage(){
 try{
   researchDb=await openResearchDb();const [savedRaces,savedOdds,settings]=await Promise.all([idbGetAll('races'),idbGetAll('oddsHistory'),idbGetAll('settings')]);
   for(const row of savedRaces){const local=raceCache[row.id],localAt=Date.parse(local?.updatedAt||'')||0,dbAt=Date.parse(row.data?.updatedAt||row.updatedAt||'')||0;if(!local||dbAt>localAt)raceCache[row.id]=row.data}
   for(const row of savedOdds){if(!oddsHistoryCache[row.raceId])oddsHistoryCache[row.raceId]=row.history||[]}
   const savedCurrent=settings.find(x=>x.key==='currentRace')?.value;if(savedCurrent)currentRaceCache=savedCurrent;
   const savedMeeting=settings.find(x=>x.key==='meetingCalendar')?.value||localStore.get(MEETING_CALENDAR_KEY,null);if(savedMeeting?.entries)meetingCalendarCache=savedMeeting;
   await Promise.all([idbPutMany('races',Object.entries(raceCache).map(([id,data])=>({id,data,updatedAt:stableRecordUpdatedAt(data)}))),idbPutMany('oddsHistory',Object.entries(oddsHistoryCache).map(([raceId,history])=>({raceId,history,updatedAt:new Date().toISOString()}))),idbPut('settings',{key:'migration',value:{schemaVersion:1,completedAt:new Date().toISOString(),source:'localStorage',legacyPreserved:true}})]);
   researchStorageMode='indexedDB';localStore.set(CURRENT,currentRaceCache);
 }catch(e){researchDb=null;researchStorageMode='localStorage-fallback';console.warn('IndexedDB fallback:',e?.message||e)}
}

let state={race:{},horses:[],result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null};
let resultFormRaceId='';
function emptyRaceState(mode='NAR'){return {race:{category:mode==='JRA'?'中央競馬':'地方競馬',raceType:mode},horses:[],result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null,resultSnapshot:null,validationSnapshot:null,scratchAudit:null}}
function clearValidationTransient(record=state){if(!record)return record;record.result=null;record.actualTimes={};record.resultSnapshot=null;record.validationSnapshot=null;record.resultMarketSnapshot=null;record.resultStatus='waiting';record.resultOutcome='waiting';record.resultFetchMode=null;record.resultFetchAudit=null;record.resultFetchCheckedAt=null;record.resultFetchError='';record.resultErrorType=null;record.validationCompleted=false;record.validated=false;record.resultFetchedAt=null;record.resultAcquiredAt=null;for(const h of record.horses||[])delete h.actualTime;if(typeof document!=='undefined'){for(const id of ['finish1','finish2','finish3','memo','actualWeather','actualTrackCondition','actualTimesInput']){const el=$(id);if(el)el.value=''}const status=$('narStatus');if(status)status.textContent='';resultFormRaceId=''}return record}
function activeRaceIdentity(record=state){return {organization:raceTypeOf(record)==='JRA'?'JRA':'NAR',raceId:raceId(record?.race||{})}}
function snapshotIdentity(snapshot,record,kind='prediction'){const fallback=activeRaceIdentity(record),snapshotRace=snapshot?.race||null,rid=String(snapshot?.raceId||raceId(snapshotRace||{})),organization=String(snapshot?.organization||snapshot?.raceType||snapshotRace?.raceType||'').toUpperCase();if(rid||organization)return {raceId:rid||fallback.raceId,organization:organization==='JRA'||organization==='NAR'?organization:fallback.organization};if(kind!=='prediction'&&record?.predictionSnapshot)return snapshotIdentity(record.predictionSnapshot,record,'prediction');return fallback}
function layerMatchesActive(record=state,layer,kind='prediction'){
 if(!layer)return false;
 const declaredOrg=String(layer.organization||layer.raceType||layer.race?.raceType||'').toUpperCase();
 if(declaredOrg&&!['JRA','NAR'].includes(declaredOrg))return false;
 const expectedModel=record?.predictionSnapshot?.modelVersion||record?.modelVersion,declaredModel=layer.modelVersion;
 if(kind!=='prediction'&&declaredModel!=null&&expectedModel!=null&&String(declaredModel)!==String(expectedModel))return false;
 const active=activeRaceIdentity(record),identity=snapshotIdentity(layer,record,kind);return !!active.raceId&&identity.raceId===active.raceId&&identity.organization===active.organization;
}
function activeRaceContext(record=state){const identity=activeRaceIdentity(record),hasPrediction=layerMatchesActive(record,record?.predictionSnapshot,'prediction'),hasResult=hasPrediction&&layerMatchesActive(record,record?.resultSnapshot,'result'),hasValidation=hasResult&&layerMatchesActive(record,record?.validationSnapshot,'validation');return {...identity,generation:activeRaceGeneration,hasPrediction,hasResult,hasValidation}}
function beginActiveRaceTransition(mode,race=null){cancelCpsiDriveRead();cpsiSourceRoot=null;cpsiSourceGeneration++;if($('cpsiSourceStatus'))$('cpsiSourceStatus').textContent='元資料の対象を切り替えました。';cpsiFirstPreview=null;cpsiFirstFileGeneration++;if(typeof document!=='undefined')renderCpsiFirstPreview();activeRaceGeneration++;lastRaceFetchAudit=null;predictionViewMode='original';jraNormalizedDraft=null;state=emptyRaceState(mode);if(race)state.race={...state.race,...cloneData(race),raceType:mode,category:mode==='JRA'?'中央競馬':'地方競馬'};clearValidationTransient(state);renderRaceFetchDiagnostics(null);return state}
function activeRequestMatches(request){const active=activeRaceIdentity();return request?.generation===activeRaceGeneration&&request?.raceId===active.raceId&&request?.organization===active.organization}
function restoreSavedRace(record,expected=null){const next=cloneData(record||emptyRaceState()),identity=activeRaceIdentity(next);if(expected&&(identity.raceId!==expected.raceId||identity.organization!==expected.organization))return emptyRaceState(expected.organization||'NAR');const unidentifiedLegacy=!identity.raceId&&!expected,resultValid=unidentifiedLegacy?!!next.resultSnapshot:layerMatchesActive(next,next.resultSnapshot,'result'),validationValid=resultValid&&(unidentifiedLegacy?!!next.validationSnapshot:layerMatchesActive(next,next.validationSnapshot,'validation'));if(!resultValid){next.result=null;next.resultSnapshot=null;next.actualTimes={};next.resultStatus='waiting';next.validationCompleted=false;next.validated=false}else next.actualTimes=next.resultSnapshot?.actualTimes||next.result?.actualTimes||{};if(!validationValid){next.validationSnapshot=null;next.validationCompleted=false;next.validated=false}if(next.predictionSnapshot?.horses?.length)next.horses=restoredHorseView(next);return next}

function setVersion(){
  document.title=`チャス競馬研究所 Ver.${APP_VERSION}`;
  const sp=document.querySelector('.topbar h1 span'); if(sp) sp.textContent=`Ver.${APP_VERSION}`;
}
function renderCloudSyncState(){
 if(typeof document==='undefined')return;
 const source=$('cloudSource'),status=$('cloudSyncStatus'),button=$('cloudSyncButton'),holds=cloudSyncActiveHolds();
 if(source)source.textContent=cloudState.available?'クラウド D1':'ローカル IndexedDB';
 if(status){
  status.className='';const s=cloudState.summary;
  if(cloudBulkFlight||cloudState.status==='syncing')status.textContent='差分確認中';
  else if(cloudState.status==='refreshing')status.textContent='D1再集計中';
  else if(holds.length){status.textContent=`${cloudState.status==='error'?'同期エラー｜':''}同期保留 ${holds.length}件｜${cloudSyncReasonLabels[holds[0].reason]||'保存内容を要確認'}${cloudPending.size?`｜待ち ${cloudPending.size}件`:''}`;status.className='is-error';}
  else if(cloudState.status==='error'){status.textContent=`同期エラー${cloudPending.size?`｜待ち ${cloudPending.size}件`:''}`;status.className='is-error';}
  else if(cloudPending.size)status.textContent=`同期待ち ${cloudPending.size}件`;
  else if(cloudState.status==='synced')status.textContent=s?`☁ 確認完了｜新規 ${s.created}件・更新 ${s.updated}件・変更なし ${s.unchanged}件`:'☁ 同期済';
  else status.textContent=cloudState.available?'クラウド接続済':'ローカルのみ';
 }
 renderCloudReadOperation();
 const readBusy=!!cloudReadFlight||cloudReadOperation?.status==='running';
 for(const id of ['cloudRestoreButton','cloudRecheckButton','cloudResultRepairButton','cloudFingerprintRecoverButton','cloudHoldAuditButton','cloudReferenceRestoreButton']){const el=$(id);if(el)el.disabled=readBusy||!!cloudBulkFlight||cloudSyncFlights.size>0;}
 const detail=$('cloudSyncHolds'),list=$('cloudSyncHoldList'),count=$('cloudSyncHoldCount'),auditSummary=$('cloudHoldAuditSummary');
 const evidenceStatus=$('cloudHoldEvidenceStatus');if(evidenceStatus){const e=cloudHoldEvidence,n=e?.entries.length||0;evidenceStatus.textContent=n?`照合資料を ${n}件取得しました。画面を再読込せず、研究データのバックアップを書き出してください。資料は診断専用で、原本・保留は変更しません。${e.omitted.oversize+e.omitted.budget+e.omitted.invalid?'容量制限などにより一部の資料は含まれません。':''}`:'照合資料が必要な場合は「保留の差分を確認」を実行してから、画面を再読込せずバックアップを書き出してください。固定確認情報が異なる記録のクラウド本文を診断用に含めます。';}
 if(auditSummary){const active=new Set(holds.map(manifestKey)),entries=(cloudHoldAudit?.entries||[]).filter(x=>active.has(manifestKey(x))),totals=entries.reduce((out,x)=>(out[x.category]=(out[x.category]||0)+1,out),{});auditSummary.hidden=!entries.length;auditSummary.textContent=entries.length?`診断時点 ${cloudHoldAudit.generatedAt}｜現在の保留のうち ${entries.length}/${holds.length}件｜${Object.entries(totals).map(([k,n])=>`${cloudAuditLabels[k]} ${n}件`).join('・')}｜診断では原本・保留を変更しません。`:'';}
 if(detail)detail.hidden=!holds.length;if(count)count.textContent=`同期保留の詳細 ${holds.length}件`;
 if(list){const audits=new Map((cloudHoldAudit?.entries||[]).map(x=>[manifestKey(x),x]));list.innerHTML=holds.map(h=>{const a=audits.get(manifestKey(h));return `<div class="cloud-exclusion-row"><strong>${esc(h.raceId)}</strong><span>${esc(cloudSyncReasonLabels[h.reason]||'保存内容を要確認')}</span><small>モデル ${esc(h.modelVersion)}${a?`｜診断時点：${esc(cloudAuditLabels[a.category])}｜差分 ${esc(a.differences.map(k=>cloudAuditFieldLabels[k]).join('・')||'なし')}｜${esc(cloudHoldAudit.generatedAt)}`:''}</small>${a?.integrity?`<small>固定確認：端末 ${esc({verified:'ハッシュ一致',legacy:'照合印なし',invalid:'改変・時系列要確認'}[a.integrity.local])}／クラウド ${esc({verified:'ハッシュ一致',legacy:'照合印なし',invalid:'改変・時系列要確認'}[a.integrity.remote])}（EARLYの正式性は別判定）</small>`:''}${cloudIntegrityExplanationHtml(a?.integrityDetails)}${a?.identityIssue?`<small>識別不備：${a.identityIssue.side==='local'?'端末':'クラウド'}｜${esc(a.identityIssue.code)}</small>`:''}${a?.changedPaths?.length?`<details class="cloud-audit-paths"><summary>差分の項目（最大24件）</summary><ul>${a.changedPaths.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></details>`:''}</div>`}).join('');}
 if(button)button.disabled=readBusy||!!cloudBulkFlight||cloudState.status==='syncing';
}
function renderCloudReadOperation(){
 const node=$('cloudOperationStatus');if(!node)return;
 const op=cloudReadOperation;node.hidden=!op;if(!op)return;
 const action=op.action==='reference'?'参考検証だけの復元':op.action==='audit'?'保留の差分診断':op.action==='recover'?'クラウド照合情報の回復':op.action==='repair'?'不足結果の補完':op.action==='restore'?'復元':'保留の再確認',counts=op.counts||{},at=op.finishedAt||op.startedAt;
 let text;
 if(op.status==='running')text=`${action}中｜${{fetch:'クラウドへ接続中',validate:'受信内容を確認中',save:'端末へ保存中'}[op.phase]||'処理中'}`;
 else if(op.status==='interrupted')text=`前回の${action}は完了を確認できませんでした。再操作前に保存状態を確認してください。`;
 else if(op.status==='error'){
  const labels={REFERENCE_AUDIT_REQUIRED:'先に「保留の差分を確認」を実行してください。',RESTORE_RESPONSE_INVALID:'復元データの形式が不正です。端末データは変更していません。',MANIFEST_RESPONSE_INVALID:'差分応答の形式が不正です。保留は解除していません。',CLOUD_READ_TIMEOUT:'通信が時間内に完了しませんでした。',LOCAL_SAVE_FAILED:'端末への保存に失敗しました。復元成功にはしていません。',NETWORK_ERROR:'クラウドとの通信に失敗しました。',INVALID_JSON:'クラウドの応答を読み取れませんでした。',HTTP_ERROR:'クラウドがエラーを返しました。',DATABASE_UNAVAILABLE:'クラウドの保存先に接続できませんでした。',DATABASE_READ_FAILED:'クラウドの保存データを読み出せませんでした。',DATABASE_SCHEMA_ERROR:'クラウドの保存形式を確認できませんでした。',CLOUD_SYNC_BUSY:'同期処理中です。終了後に操作してください。'};
  text=`${action}失敗｜${labels[op.code]||'処理を完了できませんでした。'}｜${op.code}`;
 }else if(op.code==='RENDER_FAILED')text=`${action}の保存は完了しましたが、画面更新に失敗しました。`;
 else if(op.action==='reference')text=`参考検証の復元${op.status==='partial'?'は一部完了':'完了'}｜対象 ${counts.total||0}件・確認 ${counts.checked||0}件・参考検証復元 ${counts.referenceAdded||0}件・変更なし ${counts.unchanged||0}件・保留解除 ${counts.cleared||0}件・相違 ${counts.conflicts||0}件・見送り ${counts.deferred||0}件・保留継続 ${counts.remaining||0}件｜元予想・結果・Signal保持／EARLY正式判定の昇格なし／クラウドへの送信なし`;
 else if(op.action==='audit')text=`保留の差分診断${op.status==='partial'?'は一部完了':'完了'}｜確認 ${counts.checked||0}/${counts.total||0}件・一致 ${counts.matched||0}件・Signal相違 ${counts.signalDifferences||0}件・固定確認情報相違 ${counts.integrityDifferences||0}件・直前評価等の相違 ${counts.liveDifferences||0}件・参照検証／処理状態のみ ${counts.referenceOnly||0}件・元予想等の相違 ${counts.originalConflicts||0}件・結果相違 ${counts.resultDifferences||0}件・レース相違 ${counts.raceDifferences||0}件・識別不備 ${counts.identityIssues||0}件・未完了 ${(counts.failed||0)+(counts.deferred||0)}件${op.code?`｜停止理由 ${op.code}`:''}｜クラウドへの送信なし`;
 else if(op.action==='recover')text=`クラウド照合情報の回復${op.status==='partial'?'は一部完了':'完了'}｜確認 ${counts.checked||0}/${counts.total||0}件・照合情報更新 ${counts.metadataRecovered||0}件・一致して解除 ${counts.cleared||0}件・相違 ${counts.conflicts||0}件・見送り ${(counts.skipped||0)+(counts.deferred||0)}件・保留継続 ${counts.remaining||0}件${op.code?`｜停止理由 ${op.code}`:''}｜クラウドの照合情報のみ更新`;
 else if(op.action==='repair')text=`不足結果の補完${op.status==='partial'?'は一部完了':'完了'}｜対象 ${counts.total||0}件・確認 ${counts.checked||0}件・結果補完 ${counts.resultAdded||0}件・不一致 ${counts.conflicts||0}件・端末変更を保持 ${counts.deferred||0}件${op.code?`・停止理由 ${op.code}`:''}｜元予想・Signal・保留は変更なし／クラウドへの送信なし`;
 else if(op.action==='restore')text=`復元完了｜受信 ${counts.received||0}件・追加 ${counts.added||0}件・補完 ${counts.enriched||0}件（結果補完 ${counts.resultAdded||0}件）・変更なし ${counts.unchanged||0}件・今回の競合 ${counts.conflicts||0}件${counts.deferred?`・端末の新しい変更を保持 ${counts.deferred}件`:''}｜同期保留は別途再確認してください。`;
 else text=`保留の再確認完了｜確認 ${counts.checked||0}件・一致して解除 ${counts.cleared||0}件・保留継続 ${counts.remaining||0}件${counts.unverifiable?`（照合情報不足 ${counts.unverifiable}件）`:''}｜クラウドへの送信なし`;
 if(op.status==='running'&&op.action==='repair')text+=`｜確認 ${counts.checked||0}/${counts.total||0}件・結果補完 ${counts.resultAdded||0}件`;
 if(op.status==='running'&&op.action==='audit')text+=`｜確認 ${counts.checked||0}/${counts.total||0}件`;
 if(op.status==='running'&&op.action==='recover')text+=`｜確認 ${counts.checked||0}/${counts.total||0}件・照合情報更新 ${counts.metadataRecovered||0}件・一致して解除 ${counts.cleared||0}件`;
 node.textContent=text+(at?`｜${at}`:'');node.className=['error','interrupted','partial'].includes(op.status)?'muted is-error':'muted';
}
async function runCloudReadAction(action){
 try{await (action==='reference'?restoreCloudReferenceValidation():action==='audit'?auditCloudSyncHolds():action==='recover'?recoverCloudFingerprintMetadata():action==='repair'?repairHeldCloudResults():action==='restore'?restoreResearchFromCloud():recheckCloudSyncHolds());try{renderCloudDatasetSummary();renderDashboard();}catch{setCloudReadOperation({status:'partial',phase:'render',code:'RENDER_FAILED'});}}
 catch{/* Safe diagnostic state is retained independently from sync holds. */}
 finally{renderCloudSyncState();}
}
function renderCloudDatasetSummary(){if(typeof document==='undefined')return;const target=$('cloudDatasetSummary'),list=$('cloudExclusionList'),details=$('cloudExclusions'),c=cloudResearchAudit.counts;if(!target)return;if(!c){target.innerHTML='<span>Source: Local Cache｜クラウド未接続・ローカル集計</span>';if(details)details.hidden=true;return}const consistent=(c.consistency?.predictionBalance??(c.d1PredictionSaved===c.d1ResultFetched+c.resultMissing))&&(c.consistency?.resultBalance??(c.d1ResultFetched===c.validationEligible+c.excluded));target.innerHTML=`<div class="cloud-source-label">Source: Cloudflare D1（サーバー側の保存件数・参考）</div><p>端末への結合で競合保留：${new Set((cloudResearchAudit.conflicts||[]).map(x=>x.raceId)).size}R</p><div class="cloud-summary-grid"><div class="cloud-stat"><span>予想保存</span><strong>${Number(c.d1PredictionSaved)||0}R</strong></div><div class="cloud-stat"><span>結果取得済</span><strong>${Number(c.d1ResultFetched)||0}R</strong></div><div class="cloud-stat"><span>検証可能</span><strong>${Number(c.validationEligible)||0}R</strong></div><div class="cloud-stat"><span>結果未取得</span><strong>${Number(c.resultMissing)||0}R</strong><small>予想保存済・結果待ち</small></div><div class="cloud-stat cloud-stat-wide"><span>データ不備除外</span><strong>${Number(c.excluded)||0}R</strong></div></div>${consistent?'':'<p class="cloud-consistency-warning">⚠ 集計整合性に差異あり</p>'}<div class="cloud-sync-help"><span>クラウドへ同期：端末の新規データをD1へ送信</span><span>クラウドから復元：D1のみのデータを端末キャッシュへ追加</span></div>`;const reasonLabel={CLOUD_MODEL_MISMATCH:'モデル版の不一致',CLOUD_RACE_MISMATCH:'レースの不一致',CLOUD_LAYER_BINDING_MISMATCH:'Snapshotのレース・モデル不一致',CLOUD_RECORD_MISSING:'復元レコードなし',PREDICTION_MISSING:'予想Snapshotなし',SNAPSHOT_INCOMPLETE:'Snapshot不完全',RESULT_INCOMPLETE:'結果不完全',LEGACY_UNVERIFIED:'旧データ未検証',DATA_QUALITY:'データ品質',DUPLICATE_OR_CONFLICT:'重複・競合',SCHEMA_MISMATCH:'スキーマ不一致'};const exclusions=[...(cloudResearchAudit.exclusions||[]),...(cloudResearchAudit.conflicts||[])];if(list)list.innerHTML=exclusions.map(x=>`<div class="cloud-exclusion-row"><strong>${esc(x.raceId)}</strong><span>${reasonLabel[x.reason]||esc(x.reason)}</span><small>${esc(x.date||'')} ${esc(x.track||'')} ${esc(x.raceNo||'')}R｜${esc(x.modelVersion||'Legacy')}</small></div>`).join('')||'<p class="muted">検証除外はありません。</p>';if(details)details.hidden=false;let missing=$('cloudMissingResults');if(!missing){target.insertAdjacentHTML('afterend','<details id="cloudMissingResults" class="cloud-exclusions"><summary>結果未取得の一覧</summary><div id="cloudMissingList"></div></details>');missing=$('cloudMissingResults')}const missingList=$('cloudMissingList'),items=cloudResearchAudit.missingResults||[];missing.querySelector('summary').textContent=`結果未取得の一覧 ${items.length}R`;missingList.innerHTML=items.map(x=>`<div class="cloud-exclusion-row"><strong>${esc(x.date)}｜${esc(x.track)} ${esc(x.raceNo)}R</strong><span>${esc(x.modelVersion||'Legacy')}</span><button type="button" class="cloud-open-missing" data-race-id="${esc(x.raceId)}">結果を取得</button></div>`).join('')||'<p class="muted">結果未取得はありません。</p>';missing.querySelectorAll('.cloud-open-missing').forEach(b=>b.onclick=()=>openMissingResultRace(b.dataset.raceId))}
function openMissingResultRace(id){const saved=raceCache[id];if(!saved)return;activeRaceGeneration++;state=restoreSavedRace(saved);setRaceMode(raceTypeOf(state),{announce:false,preserveState:true});fillRace(state.race);render();setView('prediction');if($('narStatus'))$('narStatus').textContent='結果を取得中…';requestAnimationFrame(()=>{$('resultCard')?.scrollIntoView({behavior:'smooth',block:'start'});syncNar({auto:false})})}
function raceId(r={}){
 const d=String(r.raceDate||r.date||'').replaceAll('/','-');
 const t=String(r.track||'').trim();
 const n=String(r.raceNo||'').match(/\d+/)?.[0]||'';
 return d&&t&&n?`${d}|${t}|${n}`:'';
}
function raceTypeOf(record){const race=record?.predictionSnapshot?.race||record?.race||record||{};return race.raceType||record?.raceType||(/中央|JRA/.test(String(race.category||record?.category||''))?'JRA':'NAR')}
function styleCloudDatasetHierarchy(){const target=$('cloudDatasetSummary');if(!target)return;target.style.display='block';target.querySelector('.cloud-source-label')?.setAttribute('style','color:var(--accent);font-size:10px;margin-bottom:6px');target.querySelector('.cloud-total')?.setAttribute('style','display:flex;align-items:center;justify-content:space-between;margin-bottom:6px');target.querySelector('.cloud-branch')?.setAttribute('style','display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-bottom:6px');target.querySelector('.cloud-sync-help')?.setAttribute('style','display:grid;gap:2px;color:var(--muted);font-size:8px')}
function oddsType(v){
 const s=String(v||'').trim();
 if(/予想|想定|参考|forecast|predicted/i.test(s))return '予想オッズ';
 if(/最終|確定|実オッズ|final|real|official/i.test(s))return '実オッズ';
 if(!s||/なし|未取得/.test(s))return 'オッズなし';
 return '種別不明';
}
function normalize(vals){
 const known=vals.filter(x=>x!=null); if(!known.length)return vals.map(()=>null);
 const lo=Math.min(...known),hi=Math.max(...known);if(lo===hi)return vals.map(v=>v==null?null:5);
 return vals.map(v=>v==null?null:clamp(1+8*(v-lo)/(hi-lo),1,9));
}
function derive(horses){
 const raw=horses.map(h=>{
   const recent=arr(h.recentIndex??h.近走指数);
   return {
     highest:num(h.timeIndex??h.maxTimeIndex??h.最高指数??h.最高),
     avg:num(h.fiveRaceAvgIndex??h.avg5Index??h['5走平均']??h.五走平均),
     distance:num(h.distanceIndex??h.距離指数),
     course:num(h.courseIndex??h.コース指数),
     recent,recentMean:mean(recent),
     trend:recent.length>=2?recent[recent.length-1]-recent[0]:null,
     kg:num(h.assignedWeight??h.carryWeight??h.weightKg??h.斤量??h.weight),
     confidence:num(h.dataConfidence??h.confidence)
   };
 });
 const fields=['highest','avg','distance','course','recentMean','trend'];
 const n={};fields.forEach(f=>n[f]=normalize(raw.map(x=>x[f])));
 const medKg=median(raw.map(x=>x.kg)); const kgScore=raw.map(x=>x.kg==null||medKg==null?null:clamp(5+(medKg-x.kg)*.45,2,8));
 const model=raw.map((x,i)=>{
   const parts=[[n.highest[i],.24],[n.avg[i],.28],[n.distance[i],.12],[n.course[i],.10],[n.recentMean[i],.18],[n.trend[i],.04],[kgScore[i],.02],[x.confidence==null?null:clamp(x.confidence/10,0,10),.02]].filter(([v])=>v!=null);
   const den=parts.reduce((s,[,w])=>s+w,0)||1;
   const score=parts.reduce((s,[v,w])=>s+v*w,0)/den;
   return {raw:x,norm:Object.fromEntries(fields.map(f=>[f,n[f][i]])),kgScore,score,completeness:den};
 });
 const max=Math.max(...model.map(x=>x.score)); const ex=model.map(x=>Math.exp((x.score-max)/1.2)); const sum=ex.reduce((a,b)=>a+b,0)||1;
 const win=ex.map(x=>100*x/sum); const b=win.map(w=>Math.pow(Math.max(w,.01),.72)); const bs=b.reduce((a,c)=>a+c,0)||1;
 const place=b.map(v=>300*v/bs).map(v=>clamp(v,1,88));
 return model.map((m,i)=>({...m,win:win[i],place:place[i],kgScore:kgScore[i]}));
}
function abilityMarks(horses,race={}){
 const jra=chassJraRaceContext(race);
 const value=(v,fallback=-Infinity)=>Number.isFinite(Number(v))?Number(v):fallback;
 const sorted=[...(horses||[])].filter(h=>isEligibleHorse(h)&&!h.warningMark).sort((a,b)=>{
   if(jra){
     const overall=value(b.overall)-value(a.overall);
     if(overall)return overall;
     const win=value(b.win)-value(a.win);
     if(win)return win;
   }else{
     const win=value(b.win)-value(a.win);
     if(win)return win;
     const overall=value(b.overall)-value(a.overall);
     if(overall)return overall;
   }
   return Number(a.horseNo||999)-Number(b.horseNo||999);
 });
 (horses||[]).forEach(h=>h.abilityMark='');
 sorted.slice(0,4).forEach((h,i)=>h.abilityMark=['◎','○','▲','△'][i]);
 return sorted;
}
function numericFeature(h,...keys){for(const key of keys){const path=key.split('.');let v=h;for(const part of path)v=v?.[part];const n=num(v);if(n!=null)return clamp(key.startsWith('scores.')&&n<=10?n*10:n,0,100)}return null}
function rankValues(horses,getter,{lower=false}={}){const rows=horses.map((h,i)=>({h,i,v:num(getter(h))})).filter(x=>x.v!=null).sort((a,b)=>lower?a.v-b.v:b.v-a.v),map=new Map();rows.forEach((x,i)=>map.set(x.h,i+1));return {map,count:rows.length,score(h){const rank=map.get(h);return rank==null?null:rows.length===1?100:100*(rows.length-rank)/(rows.length-1)}}}
function paceValueScore(h,horses,race){const stored=numericFeature(h,'features.paceFit','paceFitScore');if(stored!=null)return stored;const pace=String(race?.pace||''),style=String(h.runningStyle||''),escapeCount=horses.filter(x=>/逃げ/.test(String(x.runningStyle||''))).length;if(/逃げ/.test(style)&&escapeCount===1)return 90;if(/スロー|遅/.test(pace))return /逃げ|先行/.test(style)?82:/差し|追込/.test(style)?38:55;if(/ハイ|速/.test(pace))return /差し|追込/.test(style)?82:/逃げ/.test(style)?38:55;return null}
function weightedAvailable(parts){const valid=parts.filter(x=>x.value!=null&&Number.isFinite(x.value)),den=valid.reduce((s,x)=>s+x.weight,0);return den?valid.reduce((s,x)=>s+x.value*x.weight,0)/den:null}
function axisGrade(value){const n=num(value);return n==null?'—':n>=85?'S':n>=75?'A':n>=60?'B':n>=45?'C':'D'}
function horseRuns(h){return Array.isArray(h.runs)?h.runs:Array.isArray(h.features?.runs)?h.features.runs:[]}
function distanceChangeAxis(h,race,speed,stability){
 const runs=horseRuns(h),previous=num(h.previousDistance??h.features?.previousDistance??runs[0]?.distance),current=num(race?.distance);if(previous==null||current==null)return {score:numericFeature(h,'features.distanceChangeFit'),change:null,label:'不明'};
 const change=current-previous,firstCorner=num(String(runs[0]?.corners||'').match(/\d+/)?.[0]),tracking=firstCorner==null?null:clamp(100-(firstCorner-1)*11,20,100),distanceFit=numericFeature(h,'features.distanceFit','scores.distanceFit','raw.distance');
 let score;if(change<0)score=weightedAvailable([{value:speed,weight:4},{value:tracking,weight:3},{value:distanceFit,weight:3}]);else if(change>0)score=weightedAvailable([{value:stability,weight:4},{value:distanceFit,weight:4},{value:numericFeature(h,'features.consistencyScore'),weight:2}]);else score=distanceFit;
 return {score:score==null?null:Number(clamp(score,0,100).toFixed(1)),change,label:change===0?'同距離':change<0?`短縮${Math.abs(change)}m`:`延長${change}m`};
}
function transferLevelAxis(h){
 const origin=String(h.transferOrigin??h.previousOrganization??h.features?.transferOrigin??''),stage=num(h.transferStartNo??h.features?.transferStartNo),classStrength=numericFeature(h,'features.classStrength','transferClassStrength'),ability=numericFeature(h,'abilityScore','overall'),distance=numericFeature(h,'features.distanceFit','scores.distanceFit'),evidence=[classStrength,distance,numericFeature(h,'features.transferEvidence')].filter(x=>x!=null).length;
 if(!origin||!evidence)return {score:null,origin:origin||'',stage:stage??null,evidence:0};
 const base=weightedAvailable([{value:classStrength,weight:5},{value:ability,weight:3},{value:distance,weight:2}]);return {score:base==null?null:Number(clamp(base,0,100).toFixed(1)),origin,stage:stage??null,evidence};
}
function conditionProgressAxis(h){
 const recent=(h.raw?.recent||[]).map(Number).filter(Number.isFinite),trend=recent.length>=2?recent[recent.length-1]-recent[0]:num(h.features?.trend),restDays=num(h.restDays??h.features?.restDays),startNo=num(h.startAfterBreak??h.features?.startAfterBreak),explicit=numericFeature(h,'features.conditionProgress','features.reboundScore','features.restPattern');
 const trendScore=trend==null?null:clamp(50+trend*3,20,90),restScore=restDays==null?null:restDays<7?42:restDays<=45?60:48;
 const score=weightedAvailable([{value:explicit,weight:5},{value:trendScore,weight:4},{value:restScore,weight:1}]);return {score:score==null?null:Number(clamp(score,0,100).toFixed(1)),trend:trend??null,restDays:restDays??null,startAfterBreak:startNo??null,evidence:[explicit,trendScore,restScore].filter(x=>x!=null).length};
}
function applyPredictionAxisReinforcement(horses,race={}){
 if(!Array.isArray(horses)||!horses.length)return {schemaVersion:1,mode:'shadow',raceConfidence:null,horses:[]};
 const ranks={time:rankValues(horses,h=>timeToSec(h.predictedTime),{lower:true}),win:rankValues(horses,h=>h.win),place:rankValues(horses,h=>h.place),overall:rankValues(horses,h=>h.overall)};
 horses.forEach(h=>{
   const timeScore=ranks.time.score(h),speed=weightedAvailable([{value:timeScore,weight:4},{value:numericFeature(h,'raw.highest','features.timeAbility'),weight:3},{value:numericFeature(h,'features.last3fAbility'),weight:2},{value:numericFeature(h,'raw.avg5'),weight:1}]);
   const pace=paceValueScore(h,horses,race),stability=weightedAvailable([{value:numericFeature(h,'features.consistencyScore'),weight:3},{value:numericFeature(h,'features.recentFormScore','raw.avg5'),weight:2},{value:numericFeature(h,'features.distanceFit','scores.distanceFit'),weight:2},{value:numericFeature(h,'features.courseFit','scores.courseFit'),weight:1.5},{value:pace,weight:1},{value:numericFeature(h,'jockeyCourseFit','features.jockeyCourseFit','features.trainerJockeyScore'),weight:.5}]);
   const distanceChange=distanceChangeAxis(h,race,speed,stability),transfer=transferLevelAxis(h),progress=conditionProgressAxis(h),winning=weightedAvailable([{value:num(h.overall),weight:4},{value:speed,weight:3},{value:num(h.win)==null?null:clamp(num(h.win)*2,0,100),weight:2},{value:pace,weight:1}]);
   const debutModel=horseRuns(h).length===0&&!!(h.debut??h.features?.debut),evidenceCount=[speed,stability,pace,distanceChange.score,transfer.score,progress.score].filter(x=>x!=null).length;let axisConfidence=Math.round(clamp((num(h.dataConfidence)??45)*.6+(evidenceCount/6)*40,20,95));if(debutModel)axisConfidence=Math.min(axisConfidence,45);
   h.predictionAxes={schemaVersion:1,speedCeilingScore:speed==null?null:Number(clamp(speed,0,100).toFixed(1)),placeStabilityScore:stability==null?null:Number(clamp(stability,0,100).toFixed(1)),paceFitScore:pace==null?null:Number(clamp(pace,0,100).toFixed(1)),distanceChangeFit:distanceChange.score,distanceChange:distanceChange.change,distanceChangeLabel:distanceChange.label,transferLevelScore:transfer.score,transferOrigin:transfer.origin,transferStartNo:transfer.stage,conditionProgressScore:progress.score,winningAbilityScore:winning==null?null:Number(clamp(winning,0,100).toFixed(1)),jockeyCourseFit:numericFeature(h,'jockeyCourseFit','features.jockeyCourseFit','features.trainerJockeyScore'),debutModel,evidenceCount,axisConfidence};
 });
 const axisRanks={speed:rankValues(horses,h=>h.predictionAxes.speedCeilingScore),stability:rankValues(horses,h=>h.predictionAxes.placeStabilityScore),pace:rankValues(horses,h=>h.predictionAxes.paceFitScore),distance:rankValues(horses,h=>h.predictionAxes.distanceChangeFit),progress:rankValues(horses,h=>h.predictionAxes.conditionProgressScore)};
 horses.forEach(h=>{const rankSet=[ranks.win.map.get(h),ranks.place.map.get(h),ranks.time.map.get(h),ranks.overall.map.get(h),axisRanks.stability.map.get(h),axisRanks.pace.map.get(h)].filter(Number.isFinite),dispersion=stddev(rankSet),consensus=rankSet.length<3?null:clamp(100-(dispersion??0)*22,0,100),a=h.predictionAxes;a.predictionConsensus=consensus==null?null:Number(consensus.toFixed(1));a.consensusLabel=consensus==null?'不明':consensus>=75?'High':consensus>=50?'Medium':'Low';a.candidateWinScore=weightedAvailable([{value:num(h.overall),weight:30},{value:a.speedCeilingScore,weight:25},{value:a.winningAbilityScore,weight:20},{value:a.paceFitScore,weight:10},{value:a.distanceChangeFit,weight:5},{value:a.conditionProgressScore,weight:5},{value:a.predictionConsensus,weight:5}]);a.candidatePlaceScore=weightedAvailable([{value:a.placeStabilityScore,weight:30},{value:num(h.place)==null?null:clamp(num(h.place)*1.3,0,100),weight:25},{value:a.paceFitScore,weight:15},{value:numericFeature(h,'features.distanceFit','scores.distanceFit'),weight:10},{value:numericFeature(h,'features.courseFit','scores.courseFit'),weight:8},{value:a.conditionProgressScore,weight:7},{value:a.predictionConsensus,weight:5}]);});
 const winRaw=horses.map(h=>Math.exp(((h.predictionAxes.candidateWinScore??50)-50)/14)),winSum=winRaw.reduce((s,x)=>s+x,0)||1,placeRaw=horses.map(h=>Math.pow(Math.max((h.predictionAxes.candidatePlaceScore??50),1),.78)),placeSum=placeRaw.reduce((s,x)=>s+x,0)||1;
 horses.forEach((h,i)=>{const a=h.predictionAxes;a.candidateWinRate=Number((100*winRaw[i]/winSum).toFixed(2));a.candidatePlaceRate=Number(clamp(300*placeRaw[i]/placeSum,1,88).toFixed(2));const pop=num(h.popularity),field=Math.max(1,horses.length),marketGap=pop==null?null:clamp(100*(pop-(ranks.place.map.get(h)??pop))/Math.max(1,field-1),0,100);a.placeLongshotScore=pop==null?null:Number(clamp(weightedAvailable([{value:a.placeStabilityScore,weight:25},{value:a.candidatePlaceRate,weight:25},{value:marketGap,weight:20},{value:a.paceFitScore,weight:10},{value:ranks.time.score(h),weight:10},{value:clamp((pop-1)/Math.max(1,field-1)*100,0,100),weight:10}])??0,0,100).toFixed(1));a.placeLongshotCandidate=pop>=7&&a.placeLongshotScore>=62&&a.candidatePlaceRate>=18;const reasons=[['同条件・時計上限',a.speedCeilingScore],['複勝安定性',a.placeStabilityScore],['今回展開への適合',a.paceFitScore],[a.distanceChangeLabel,a.distanceChangeFit],['状態上昇余地',a.conditionProgressScore],['転入レベル補正',a.transferLevelScore]].filter(([,v])=>v!=null).sort((x,y)=>y[1]-x[1]);a.primaryReason=reasons[0]?.[0]||'利用可能データ内の総合評価';a.supportReasons=reasons.slice(1,3).map(x=>x[0]);});
 const remaining=new Set(horses),take=sorter=>{const h=[...remaining].sort(sorter)[0];if(h)remaining.delete(h);return h},marked=[];const add=(h,mark,reason)=>{if(h){h.predictionAxes.candidateMark=mark;h.predictionAxes.markReason=reason;marked.push({horseNo:Number(h.horseNo),mark,reason})}};
 const conditionScore=h=>mean([h.predictionAxes.paceFitScore,h.predictionAxes.distanceChangeFit,h.predictionAxes.conditionProgressScore].filter(x=>x!=null))??-1;
 add(take((a,b)=>b.predictionAxes.candidateWinRate-a.predictionAxes.candidateWinRate),'◎','勝利期待');add(take((a,b)=>(b.predictionAxes.placeStabilityScore??-1)-(a.predictionAxes.placeStabilityScore??-1)),'○','複勝安定');add(take((a,b)=>conditionScore(b)-conditionScore(a)),'▲','展開・条件上昇');add(take((a,b)=>(b.predictionAxes.candidatePlaceRate??-1)-(a.predictionAxes.candidatePlaceRate??-1)),'△','相手安定');const star=[...remaining].filter(h=>h.predictionAxes.placeLongshotCandidate).sort((a,b)=>b.predictionAxes.placeLongshotScore-a.predictionAxes.placeLongshotScore)[0];add(star,'☆','相手穴');
 const ordered=[...horses].sort((a,b)=>b.predictionAxes.candidateWinRate-a.predictionAxes.candidateWinRate),topGap=ordered.length>1?ordered[0].predictionAxes.candidateWinRate-ordered[1].predictionAxes.candidateWinRate:0,topConsensus=mean(ordered.slice(0,3).map(h=>h.predictionAxes.predictionConsensus).filter(x=>x!=null)),coverage=mean(horses.map(h=>Math.min(1,h.predictionAxes.evidenceCount/6))),raceConfidence=Math.round(clamp(35+topGap*1.5+(topConsensus??50)*.3+(coverage??0)*20,0,100));
 return {schemaVersion:1,algorithmVersion:'PAR-1.0',mode:'shadow',adopted:false,adoptionRule:'TOP3・相手穴・較正の改善をwalk-forwardで確認後のみ昇格',raceConfidence,confidenceLabel:raceConfidence>=75?'高':raceConfidence>=50?'中':'低',candidateMarks:marked,horses:horses.map(h=>({horseNo:Number(h.horseNo),...cloneData(h.predictionAxes)}))};
}
const SIGNAL_POLICY_VERSION='CHASS-SIGNAL-v1.0';
const SIGNAL_FREEZE_SCHEMA_VERSION=1;
function marketReadyForSignals(horses=[]){const active=(horses||[]).filter(isEligibleHorse);return active.length>=2&&active.every(h=>num(h.popularity)!=null&&num(h.odds)!=null&&num(h.ev)!=null)}
function signalEvidenceValue(h,...keys){for(const key of keys){const path=key.split('.');let v=h;for(const part of path)v=v?.[part];const n=num(v);if(n!=null)return key.startsWith('scores.')&&n<=10?n*10:n}return null}
function signalMarketHeat(h){const out=[],pop=num(h.popularity),ev=num(h.ev),odds=num(h.odds),fair=num(h.fair);if(pop!=null&&pop<=3&&ev!=null&&ev<75)out.push('期待値低め');if(pop!=null&&pop<=3&&odds!=null&&fair!=null&&odds<fair*.8)out.push('価格過熱');return [...new Set(out)]}
function warningScenarioFor(h,horses,race={}){
 const popularity=num(h.popularity),abilityRank=num(h.overallRank??h.winRank??h.abilityRank),targetBasis=popularity!=null?(popularity>=1&&popularity<=3?'market_top3':null):(abilityRank!=null&&abilityRank<=3?'ability_top3':null);if(!targetBasis)return null;
 const field=Math.max(1,(horses||[]).filter(isEligibleHorse).length),factors=[],push=(code,label,value)=>{if(value!=null)factors.push({code,label,value:Number(value.toFixed?.(1)??value)})};
 const pace=signalEvidenceValue(h,'predictionAxes.paceFitScore','paceFitScore'),distance=signalEvidenceValue(h,'predictionAxes.distanceChangeFit','features.distanceFit','scores.distanceFit'),course=signalEvidenceValue(h,'features.courseFit','scores.courseFit'),stability=signalEvidenceValue(h,'predictionAxes.placeStabilityScore','features.consistencyScore'),condition=signalEvidenceValue(h,'predictionAxes.conditionProgressScore','features.recentFormScore'),weight=signalEvidenceValue(h,'features.weightEffect'),jockey=signalEvidenceValue(h,'predictionAxes.jockeyCourseFit','jockeyCourseFit','features.jockeyCourseFit');
 if(pace!=null&&pace<=40)push('PACE_COLLAPSE','展開不適合',pace);if(distance!=null&&distance<=40)push('DISTANCE_RISK','距離条件不安',distance);if(course!=null&&course<=40)push('COURSE_RISK','コース適性不安',course);if(stability!=null&&stability<=40)push('STABILITY_RISK','複勝安定性不安',stability);if(condition!=null&&condition<=40)push('CONDITION_RISK','近走・状態不安',condition);if(weight!=null&&weight<=35)push('WEIGHT_RISK','斤量条件不安',weight);if(jockey!=null&&jockey<=35)push('JOCKEY_COURSE_RISK','騎手コース適性不安',jockey);if(h.predictedTime&&num(h.timeRank)!=null&&h.timeRank>Math.max(3,Math.ceil(field*.65)))push('TIME_RISK','予想TIME劣後',h.timeRank);
 const placeProjection=num(h.predictionAxes?.candidatePlaceRate??h.place);if(factors.length<2)return null;if(placeProjection!=null&&placeProjection>=50)return null;const severity=factors.length>=4&&placeProjection!=null&&placeProjection<=35?3:factors.length>=3&&placeProjection!=null&&placeProjection<=42?2:1;return {policyVersion:SIGNAL_POLICY_VERSION,targetBasis,scenario:`${factors.slice(0,3).map(x=>x.label).join('＋')}で4着以下まで崩れるシナリオ`,factors:factors.slice(0,5),placeProjection,severity};
}
function buildSignalSnapshot(horses,race={},at=new Date().toISOString()){
 const active=(horses||[]).filter(isEligibleHorse),ready=marketReadyForSignals(active),hasWarning=active.some(h=>!!h.warningMark);return {schemaVersion:SIGNAL_FREEZE_SCHEMA_VERSION,policyVersion:SIGNAL_POLICY_VERSION,status:ready?'frozen':'provisional',frozenAt:ready?at:null,warningFrozenAt:!ready&&hasWarning?at:null,createdAt:at,marketType:race?.oddsType||'オッズなし',horses:active.map(h=>({horseNo:Number(h.horseNo),popularityAtFreeze:num(h.popularity),oddsAtFreeze:num(h.odds),evAtFreeze:num(h.ev),abilityMarkAtFreeze:h.abilityMark||'',finalMarkAtFreeze:h.finalMark||'',valueMark:h.valueMark||'',valueType:h.valueType||'',winValueMark:h.winValueMark||'',placeValueMark:h.placeValueMark||'',warningMark:h.warningMark||'',warningScenario:h.warningScenario?cloneData(h.warningScenario):null,marketHeat:Array.isArray(h.marketHeat)?cloneData(h.marketHeat):[],abilityRisk:Array.isArray(h.abilityRisk)?cloneData(h.abilityRisk):[],longshotScenario:h.longshotScenario?cloneData(h.longshotScenario):null,longshotReasons:Array.isArray(h.longshotReasons)?cloneData(h.longshotReasons):[]}))};
}
function enforceSignalMarkExclusion(horses=[]){for(const h of horses||[]){if(!h.warningMark)continue;h.mark='';h.valueMark='';h.valueType='';h.winValueMark='';h.placeValueMark='';h.abilityMark='';h.finalMark=''}return horses}
function applyFrozenSignalSnapshot(horses=[],snapshot=null){if(!snapshot?.horses?.length)return horses;const map=new Map(snapshot.horses.map(x=>[Number(x.horseNo),x]));for(const h of horses||[]){const saved=map.get(Number(h.horseNo));if(!saved)continue;h.valueMark=saved.valueMark||'';h.valueType=saved.valueType||'';h.winValueMark=saved.winValueMark||'';h.placeValueMark=saved.placeValueMark||'';h.warningMark=saved.warningMark||'';h.warningScenario=saved.warningScenario?cloneData(saved.warningScenario):null;h.marketHeat=Array.isArray(saved.marketHeat)?cloneData(saved.marketHeat):[];h.abilityRisk=Array.isArray(saved.abilityRisk)?cloneData(saved.abilityRisk):[];h.longshotScenario=saved.longshotScenario?cloneData(saved.longshotScenario):null;h.longshotReasons=Array.isArray(saved.longshotReasons)?cloneData(saved.longshotReasons):[]}return enforceSignalMarkExclusion(horses)}
function applyFrozenWarnings(horses=[],snapshot=null){if(!snapshot?.warningFrozenAt||!snapshot?.horses?.length)return horses;const map=new Map(snapshot.horses.map(x=>[Number(x.horseNo),x]));for(const h of horses||[]){const saved=map.get(Number(h.horseNo));if(!saved?.warningMark)continue;h.warningMark=saved.warningMark;h.warningScenario=saved.warningScenario?cloneData(saved.warningScenario):null;h.abilityRisk=Array.isArray(saved.abilityRisk)?cloneData(saved.abilityRisk):[]}return enforceSignalMarkExclusion(horses)}
function resolveSignalSnapshot(record=state,at=new Date().toISOString()){
 const existing=record?.marketSnapshot?.signalSnapshot||null,ready=marketReadyForSignals(record?.horses||[]);if(existing?.status==='frozen'){applyFrozenSignalSnapshot(record?.horses||[],existing);return existing}if(existing?.status==='provisional'&&!ready){applyFrozenSignalSnapshot(record?.horses||[],existing);return existing}applyValueFlags(record?.horses||[],record?.race||record?.predictionSnapshot?.race||{});applyFrozenWarnings(record?.horses||[],existing);enforceSignalMarkExclusion(record?.horses||[]);return buildSignalSnapshot(record?.horses||[],record?.race||record?.predictionSnapshot?.race||{},at)
}
function evaluateLongshots(horses,race={}){
 const active=(horses||[]).filter(isEligibleHorse),ranks={win:rankValues(active,h=>h.win),place:rankValues(active,h=>h.place),overall:rankValues(active,h=>h.overall),time:rankValues(active,h=>timeToSec(h.predictedTime),{lower:true}),distance:rankValues(active,h=>numericFeature(h,'features.distanceFit','scores.distanceFit')),course:rankValues(active,h=>numericFeature(h,'features.courseFit','scores.courseFit'))};
 const field=Math.max(active.length,1),chaos=num(race.chaos)??50,threshold=chaos>=70?58:chaos<40?66:62;
 for(const h of horses||[]){h.valueMark='';h.valueType='';h.winValueMark='';h.placeValueMark='';h.timeValueFlag='';h.warningMark='';h.warningScenario=null;h.abilityRisk=[];h.marketHeat=signalMarketHeat(h);h.longshotReasons=[];h.longshotScenario=null;if(!isEligibleHorse(h))continue;const popularity=num(h.popularity),popPct=popularity==null?null:field===1?0:100*(popularity-1)/(field-1),abilityRanks=[ranks.win.map.get(h),ranks.place.map.get(h),ranks.overall.map.get(h),ranks.time.map.get(h)].filter(Boolean),abilityRank=abilityRanks.length?mean(abilityRanks):null,gap=popularity==null||abilityRank==null?null:clamp(100*(popularity-abilityRank)/Math.max(1,field-1),0,100),timeScore=ranks.time.score(h),distanceScore=numericFeature(h,'features.distanceFit')??ranks.distance.score(h),courseScore=numericFeature(h,'features.courseFit')??ranks.course.score(h),recentScore=numericFeature(h,'features.recentFormScore','features.consistencyScore'),paceScore=paceValueScore(h,active,race),last3f=numericFeature(h,'features.last3fAbility'),rebound=numericFeature(h,'features.reboundScore','features.restPattern'),support=numericFeature(h,'features.weightEffect','features.trainerJockeyScore'),confidence=num(h.dataConfidence),base=clamp((num(h.overall)??0),0,100),marketGapScore=gap;
   const score=weightedAvailable([{value:base,weight:20},{value:timeScore==null?null:timeScore*(h.predictedTimeType==='補正'?.88:1),weight:15},{value:distanceScore,weight:10},{value:courseScore,weight:10},{value:recentScore,weight:10},{value:paceScore,weight:10},{value:marketGapScore,weight:10},{value:last3f,weight:5},{value:rebound,weight:5},{value:support,weight:5}]);
   h.longshotScore=score==null?null:Number(clamp(score+(chaos>=70?3:chaos<40?-3:0),0,100).toFixed(1));h.marketGapScore=marketGapScore==null?null:Number(marketGapScore.toFixed(1));h.timeValueScore=timeScore==null?null:Number(timeScore.toFixed(1));h.courseValueScore=weightedAvailable([{value:distanceScore,weight:1},{value:courseScore,weight:1}]);h.paceFitScore=paceScore;h.reboundScore=rebound;h.popularityPercentile=popPct;h.abilityRank=abilityRank==null?null:Number(abilityRank.toFixed(1));h.winRank=ranks.win.map.get(h)??null;h.placeRank=ranks.place.map.get(h)??null;h.overallRank=ranks.overall.map.get(h)??null;h.timeRank=ranks.time.map.get(h)??null;
   const reasons=[];if(h.timeRank!=null&&h.timeRank<=3&&timeScore>=55)reasons.push({code:'TIME_TOP',strength:timeScore>=75?2:1,label:`TIME ${h.timeRank}位`});if(gap!=null&&gap>=35)reasons.push({code:'MARKET_GAP',strength:gap>=60?2:1,label:`AI能力${Math.max(1,Math.round(abilityRank))}位 / ${popularity}人気`});if(distanceScore!=null&&(ranks.distance.map.get(h)<=3||distanceScore>=72))reasons.push({code:'DISTANCE_FIT',strength:distanceScore>=80?2:1,label:`距離適性 ${ranks.distance.map.get(h)||'上位'}`});if(courseScore!=null&&(ranks.course.map.get(h)<=3||courseScore>=72))reasons.push({code:'COURSE_FIT',strength:courseScore>=80?2:1,label:`同コース適性 ${ranks.course.map.get(h)||'上位'}`});if(recentScore>=72)reasons.push({code:'RECENT_CONTENT',strength:recentScore>=82?2:1,label:'近走内容・安定性'});if(paceScore>=75)reasons.push({code:'PACE_FIT',strength:paceScore>=88?2:1,label:/逃げ/.test(String(h.runningStyle))?'単騎・展開利':'展開適性'});if(last3f>=75)reasons.push({code:'LAST3F',strength:last3f>=85?2:1,label:'上がり性能'});if(rebound>=72)reasons.push({code:'REBOUND',strength:rebound>=82?2:1,label:'巻き返し余地'});h.longshotReasons=reasons.sort((a,b)=>b.strength-a.strength).slice(0,4);
   if(h.timeRank!=null&&h.timeRank<=3&&popularity>=7&&(h.overall??0)>=50)h.timeValueFlag='TIME穴';
   const concrete=h.longshotReasons.filter(x=>x.code!=='MARKET_GAP'),strength=concrete.reduce((s,x)=>s+x.strength,0),marketValue=(num(h.ev)!=null&&h.ev>=100)||(gap!=null&&gap>=35),placeScenario=popularity!=null&&popularity>=6&&num(h.odds)!=null&&num(h.ev)!=null&&(h.overall??0)>=50&&(confidence??0)>=42&&h.longshotScore>=threshold&&num(h.place)!=null&&h.place>=18&&(h.placeRank<=Math.min(6,Math.max(3,Math.ceil(field*.5)))||h.place>=25)&&concrete.length>=1&&marketValue,winScenario=placeScenario&&(h.winRank<=Math.min(5,Math.ceil(field*.42))||num(h.win)>=5)&&h.ev>=105&&strength>=2&&(h.timeRank<=3||h.marketGapScore>=35||h.winRank<=4),bigScenario=winScenario&&popularity>=9&&concrete.length>=2&&strength>=4&&h.longshotScore>=72&&(h.marketGapScore>=50||h.ev>=140);
   if(bigScenario){h.valueType='大穴';h.valueMark='💎💎💎';h.winValueMark=h.valueMark;h.longshotScenario={policyVersion:SIGNAL_POLICY_VERSION,level:'big_win',scenario:'1着まである大穴シナリオ',evidence:cloneData(h.longshotReasons),marketValue:true}}else if(winScenario){h.valueType='勝ち穴';h.valueMark='💎💎';h.winValueMark=h.valueMark;h.longshotScenario={policyVersion:SIGNAL_POLICY_VERSION,level:'win',scenario:'1着まである勝ち筋',evidence:cloneData(h.longshotReasons),marketValue:true}}else if(placeScenario){h.valueType='相手穴';h.valueMark='💎';h.placeValueMark=h.valueMark;h.longshotScenario={policyVersion:SIGNAL_POLICY_VERSION,level:'place',scenario:'2〜3着へ入る具体的シナリオ',evidence:cloneData(h.longshotReasons),marketValue:true}}
 }
 for(const h of active){const warning=warningScenarioFor(h,active,race);if(!warning)continue;h.warningScenario=warning;h.warningMark='⚠️'.repeat(warning.severity);h.abilityRisk=warning.factors.map(x=>x.label)}
 enforceSignalMarkExclusion(horses);return horses;
}
function applyValueFlags(horses,race={}){return evaluateLongshots(horses,race)}
function marketPredictionBasisSignature(horses=[]){
 return JSON.stringify((horses||[]).filter(isEligibleHorse).map(h=>[
   Number(h.horseNo),num(h.win),num(h.place),num(h.overall),String(h.predictedTime||'')
 ]).sort((a,b)=>a[0]-b[0]));
}
function reconcileMarketDerivedValues(horses,race={},signalSnapshot=null){
 (horses||[]).forEach(h=>{
   if(!isEligibleHorse(h))return;
   const o=num(h.odds),w=num(h.win);
   if(o!=null&&w!=null){h.ev=Number((o*w).toFixed(4));h.fair=w>0?Number((100/w).toFixed(4)):null}else{h.ev=null;h.fair=null}
 });
 abilityMarks(horses||[],race||{});
 if(signalSnapshot?.status==='frozen')applyFrozenSignalSnapshot(horses||[],signalSnapshot);else applyValueFlags(horses||[],race||{});
 enforceSignalMarkExclusion(horses||[]);
 return horses;
}
function chassJraRaceContext(race={}){
 return String(race?.raceType||'').toUpperCase()==='JRA'||/中央|JRA/.test(String(race?.category||''));
}
function canonicalInputHorseNo(h,i,race={}){
 const raw=h?.horseNo??h?.horseNumber??h?.馬番;
 const no=Number(raw);
 if(Number.isInteger(no)&&no>=1&&no<=99)return no;
 if(chassJraRaceContext(race)){
   const name=String(h?.horseName??h?.horse??h?.name??h?.馬名??`row${i+1}`).trim();
   throw new Error(`JRA_HORSE_NO_REQUIRED:${name}`);
 }
 return i+1;
}
function transform(root){
 const r={...(root.meta||{}),...(root.race||{})};
 const src=Array.isArray(root.horses)?root.horses:[];
 if(src.length<2)throw new Error('horses配列が2頭未満です。');
 const dm=derive(src); const ot=oddsType(r.oddsType??root.oddsType); r.oddsType=ot; r.raceId=raceId(r);
 const horses=src.map((h,i)=>{
   const d=dm[i], win=num(h.aiWinRate??h.winRate??h.win??h.AI勝率)??d.win, place=num(h.aiPlaceRate??h.placeRate??h.place??h.AI複勝率)??d.place;
   return {
     horseNo:canonicalInputHorseNo(h,i,r),
     horseName:h.horseName??h.horse??h.name??h.馬名??'',
     horseStatus:normalizeHorseStatus(h.horseStatus||h.statusText),eligible:!INACTIVE_HORSE_STATUSES.has(normalizeHorseStatus(h.horseStatus||h.statusText)),
     sourceMark:String(h.sourceMark??h.mark??''),
     popularity:num(h.popularity??h.pop??h.人気),
     odds:num(h.realOdds??h.finalOdds??h.odds??h.単勝オッズ),
     runningStyle:h.runningStyle??h.style??h.脚質??'不明',
     predictedTime:h.predictedTime??h.time??h.予想走破タイム??'',
     predictedTimeType:h.predictedTimeType??h.timeType??'',
     predictedTimeConfidence:num(h.predictedTimeConfidence)??null,
     predictedTimeScenarios:h.predictedTimeScenarios&&typeof h.predictedTimeScenarios==='object'?cloneData(h.predictedTimeScenarios):null,
     sourceAbilityAvailable:h.abilityScore!=null,
     canonicalHorseKey:h.canonicalHorseKey??null,canonicalIndex:h.canonicalIndex?cloneData(h.canonicalIndex):null,cpsiDomains:h.cpsiDomains?cloneData(h.cpsiDomains):null,
     features:h.features&&typeof h.features==='object'?cloneData(h.features):null,
     runs:Array.isArray(h.runs)?cloneData(h.runs):[],
     originOrganization:h.originOrganization||'UNKNOWN',
     originJurisdiction:h.originJurisdiction||'UNKNOWN',
     originSource:h.originSource||'unknown',
     originConfidence:h.originConfidence||'unknown',
     transferOrigin:h.transferOrigin??h.previousOrganization??h.転入元??'',
     previousOrganization:h.previousOrganization??'',
     transferStartNo:num(h.transferStartNo??h.転入後出走数),
     restDays:num(h.restDays??h.間隔日数),
     startAfterBreak:num(h.startAfterBreak??h.休養明け何戦目),
     debut:!!(h.debut??h.初出走),
     jockeyCourseFit:num(h.jockeyCourseFit),
     actualTime:h.actualTime??'',
     reason:h.reason??h.根拠??'',
     dataMode:h.dataMode??r.dataMode??(r.autoGenerated?'NAR自動':'指数データ'),
     marketScore:num(h.marketScore),
     dataConfidence:num(h.dataConfidence??h.confidence)??Math.round(45+d.completeness*45),
     raw:{highest:d.raw.highest,avg5:d.raw.avg,distance:d.raw.distance,course:d.raw.course,recent:d.raw.recent,kg:d.raw.kg},
     scores:{timeIndex:d.score,distanceFit:d.norm.distance,courseFit:d.norm.course,weight:d.kgScore},
     win,place,abilityMark:'',valueMark:'',warningMark:'',finalMark:'',overall:0,ev:null,fair:win>0?100/win:null
   };
 });
 if(r.autoGenerated&&/能力先行/.test(String(r.dataMode||''))&&horses.length){
   const winBase=100/horses.length,placeBase=Math.min(88,300/horses.length);
   horses.forEach(h=>{
     h.win=winBase+(h.win-winBase)*.85;
     h.place=clamp(placeBase+(h.place-placeBase)*.70,1,88);
     h.fair=h.win>0?100/h.win:null;
   });
   const winSum=horses.reduce((s,h)=>s+h.win,0)||100;
   horses.forEach(h=>{h.win=100*h.win/winSum;h.fair=h.win>0?100/h.win:null;});
   r.probabilityCalibration='field baseline shrinkage: win 0.85 / place 0.70';
 }
 const s=horses.map(h=>h.scores.timeIndex??null), n=normalize(s);
 const hasAbilityData=horses.some(h=>h.raw.highest!=null||h.raw.avg5!=null||h.raw.distance!=null||h.raw.course!=null||h.raw.recent.length);
 horses.forEach((h,i)=>{
   if(r.autoGenerated && !hasAbilityData){
     // Ver.9.4: NAR自動時に全馬同点へ潰れないよう、
     // 「能力指数」ではなく市場情報ベースの暫定総合として明確に分離。
     const ms=h.marketScore!=null?h.marketScore:clamp((h.win||0)*1.25+(h.place||0)*.35,20,95);
     h.overall=Math.round(clamp(ms+(h.dataConfidence-45)*.08,20,96));
   }else{
     const ability=n[i]!=null?n[i]:5;
     h.overall=Math.round(clamp(40+ability*6+(h.dataConfidence-50)*.12,0,100));
   }
 });
 abilityMarks(horses,r);
 if(ot==='実オッズ'){
   horses.forEach(h=>{if(h.odds!=null){h.ev=h.odds*h.win;h.fair=h.win>0?100/h.win:null;}});
   applyValueFlags(horses,r);
 }
 const axisModel=applyPredictionAxisReinforcement(horses,r);r.raceConfidence=axisModel.raceConfidence;r.axisModelMode=axisModel.mode;
 return {race:r,horses,result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null,liveAdjustedPrediction:null,scratchAudit:null};
}
function normalizeCategory(v){
 const s=String(v||'').trim();
 if(s==='地方'||s==='地方競馬')return '地方競馬';
 if(s==='中央'||s==='中央競馬')return '中央競馬';
 return '地方競馬';
}
function fillRace(r){
 if(raceTypeOf(state)==='JRA')fillJraRace({date:(r.raceDate||r.date||'').replaceAll('/','-'),racecourse:r.track,raceNo:r.raceNo,raceName:r.raceName,surface:r.surface,distance:r.distance,trackCondition:r.trackCondition,weather:r.weather,pace:r.pace});
 $('category').value=normalizeCategory(r.category);$('raceDate').value=(r.raceDate||r.date||'').replaceAll('/','-');$('track').value=r.track||'';$('raceNo').value=r.raceNo||'';
 if($('autoRaceDate'))$('autoRaceDate').value=$('raceDate').value;
 if($('autoTrack')&&NAR_TRACKS[r.track])$('autoTrack').value=r.track;
 if($('autoRaceNo')&&r.raceNo)$('autoRaceNo').value=String(r.raceNo);$('distance').value=r.distance||'';$('trackCondition').value=r.trackCondition||'不明';$('chaos').value=r.chaos??50;$('pace').value=r.pace||'標準';
}
function raceFromForm(){
 const category=$('category').value;return {...state.race,category,raceType:/中央/.test(category)?'JRA':'NAR',raceDate:$('raceDate').value,track:$('track').value,raceNo:Number($('raceNo').value)||'',distance:Number($('distance').value)||'',trackCondition:$('trackCondition').value,chaos:Number($('chaos').value)||50,pace:$('pace').value||'標準'};
}
function finalScore(h){
 const evRaw=(h.ev??100)-100;
 const evBonus=evRaw<=0?clamp(evRaw*.025,-8,0):(h.overall??0)>=60?clamp(evRaw*.025,0,10):clamp(evRaw*.01,0,2);
 return (h.win||0)*.45+(h.place||0)*.15+(h.overall||0)*.25+evBonus+(h.dataConfidence||0)*.07;
}
function rankFinalFor(horses){
 const selectable=(horses||[]).filter(h=>isEligibleHorse(h)&&!h.warningMark),ability=[...selectable].sort((a,b)=>(b.overall??0)-(a.overall??0)||(b.win??0)-(a.win??0));
 if(!ability.length)return [];
 const topAbility=ability.slice(0,Math.min(3,ability.length));
 const winPick=[...topAbility].sort((a,b)=>finalScore(b)-finalScore(a))[0];
 const supportLimit=Math.max(3,Math.ceil(ability.length*.5));
 const support=ability.slice(0,supportLimit).filter(h=>h!==winPick).sort((a,b)=>finalScore(b)-finalScore(a));
 const rest=ability.filter(h=>h!==winPick&&!support.includes(h)).sort((a,b)=>finalScore(b)-finalScore(a));
 return [winPick,...support,...rest];
}
function rankFinal(){return rankFinalFor(state.horses)}
function getMarketDisplayState(race=state.race,horses=state.horses){
 const totalCount=horses.length,oddsCount=horses.filter(h=>num(h.odds)>0).length;
 const hasRealOdds=race.oddsType==='実オッズ'&&oddsCount>0;
 const realCount=hasRealOdds?oddsCount:0;
 const hasReferenceOdds=!hasRealOdds&&oddsCount>0;
 let label='未取得',finalLabel='市場待ち',mode='none';
 if(hasRealOdds){
   const complete=realCount>=totalCount&&totalCount>0;
   label=`${realCount}/${totalCount}取得`;finalLabel=complete?'市場反映済':'市場一部反映';mode=complete?'real-complete':'real-partial';
 }else if(hasReferenceOdds){label=`参考 ${oddsCount}/${totalCount}`;finalLabel='参考市場';mode='reference'}
 return {realCount,oddsCount,totalCount,hasRealOdds,hasReferenceOdds,label,finalLabel,mode};
}
function renderMarketDisplayState(){
 const m=getMarketDisplayState();
 const jra=raceTypeOf(state)==='JRA';
 if($('marketSummary'))$('marketSummary').textContent=jra?(m.realCount?`入力単勝 ${m.realCount}/${m.totalCount}`:'入力単勝 未取得'):(m.hasRealOdds?`市場 ${m.realCount}/${m.totalCount}`:m.hasReferenceOdds?'市場 参考':'市場 未取得');
 if($('marketStatus'))$('marketStatus').textContent=jra?(m.realCount?'ファイル内市場':'市場未入力'):m.finalLabel;
 if($('liveOddsBadge'))$('liveOddsBadge').textContent=m.label;
 return m;
}
function marketSourceLabel(race=state.race){
 const snapshot=String(race?.oddsSnapshotType||'').toLowerCase(),type=String(race?.oddsType||'');
 if(/pre_frozen|pre_provisional|事前/.test(snapshot+type))return '事前';if(raceTypeOf({race})==='JRA')return /predicted|forecast|予想/.test(snapshot+type)?'予想':'入力';
 if(/final|確定|historical_official/.test(snapshot+type))return '最終';
 if(type==='実オッズ')return '現在';
 if(/予想|想定|参考|predicted|forecast/.test(snapshot+type))return '予想';
 return '市場';
}
function horseMarketText(h,race=state.race){
 const source=marketSourceLabel(race),pop=num(h?.popularity),odds=num(h?.odds);
 if(pop==null&&odds==null)return `${source}未取得`;
 return `${source} ${pop==null?'人気未取得':`${Math.round(pop)}人気`}｜${odds==null?'単勝未取得':`${odds}倍`}`;
}
function horseRankGapText(h){
 const ai=num(h?.abilityRank),market=num(h?.popularity);
 if(ai==null||market==null)return '';
 const gap=Math.round(market)-Math.max(1,Math.round(ai));
 return `AI${Math.max(1,Math.round(ai))}位｜市場${Math.round(market)}位${gap?`｜差${gap>0?'+':''}${gap}`:''}`;
}
function horseShortComment(h){
 const win=num(h?.win),place=num(h?.place),overall=num(h?.overall),sentences=[];
 if(win==null&&place==null&&overall==null)return 'データ不足のため短評を生成できません。';
 sentences.push(`AI勝率 ${win==null?'算出不可':win.toFixed(1)+'%'}、TOP3 ${place==null?'算出不可':place.toFixed(1)+'%'}、TOTAL ${overall==null?'算出不可':overall}。`);
 const reasons=(h?.longshotReasons||[]).map(x=>x?.label).filter(Boolean).slice(0,2);
 if(h?.valueMark)sentences.push(`相手候補の根拠：${reasons.length?reasons.join('・'):h.valueType||'既存の穴馬判定'}。`);
 const cautions=[...(h?.abilityRisk||[]),...(h?.marketHeat||[])].filter(Boolean).slice(0,2);
 if(h?.warningMark||cautions.length)sentences.push(`注意点：${cautions.length?cautions.join('・'):'既存の危険人気馬判定あり'}。`);
 else if(!h?.valueMark&&h?.reason)sentences.push(`評価根拠：${String(h.reason).replace(/[。]+$/,'')}。`);
 return sentences.slice(0,3).join(' ');
}
function getResultDisplayState(raceState=state){
 const context=activeRaceContext(raceState);
 const enforceActive=arguments.length===0||raceState===state;
 if(enforceActive&&(!context.hasPrediction||!context.hasResult))return {done:false,manual:false,finishOrder:[],status:context.raceId?'pending':'unavailable',label:context.raceId?'結果待ち':'未取得'};
 const finishOrder=(raceState?.resultSnapshot?.finishOrder||raceState?.result?.finishOrder||[]).map(Number).filter(Number.isFinite).slice(0,3);
 const done=finishOrder.length>=3,manual=done&&(raceState?.resultSnapshot?.resultSource==='manual'||raceState?.result?.resultSource==='manual'||raceState?.result?.source==='手動修正保存');
 const status=done?'fetched':raceState?.resultStatus||(!raceId(raceState?.race)?'unavailable':'pending');
 const label=manual?'手動修正あり':done&&raceState?.resultFetchError?'結果取得済｜最新更新のみ失敗':done?'検証済':status==='fetching'?'結果取得中':status==='retry'||status==='error'?'再取得待ち':status==='waiting'||status==='pending'?'結果待ち':'未取得';
 return {done,manual,finishOrder,status,label};
}
function restoreSavedResultFields(resultState=getResultDisplayState()){
 const context=activeRaceContext(),formKey=`${context.organization}|${context.raceId}`;
 if(resultFormRaceId!==formKey){for(const id of ['finish1','finish2','finish3','memo','actualWeather','actualTrackCondition','actualTimesInput'])if($(id))$(id).value='';if($('narStatus'))$('narStatus').textContent='';resultFormRaceId=formKey}
 if(!resultState.done)return;
 resultState.finishOrder.forEach((no,i)=>{const input=$(`finish${i+1}`);if(input&&!input.value)input.value=no});
 if($('memo')&&!$('memo').value&&state.result?.memo)$('memo').value=state.result.memo;
 const snapshot=state.resultSnapshot||{};
 if($('actualWeather')&&!$('actualWeather').value)$('actualWeather').value=snapshot.actualWeather||snapshot.weather||'';
 if($('actualTrackCondition')&&!$('actualTrackCondition').value)$('actualTrackCondition').value=snapshot.actualTrackCondition||snapshot.trackCondition||'';
 if($('actualTimesInput')&&!$('actualTimesInput').value){const times=snapshot.actualTimes||{};$('actualTimesInput').value=Object.entries(times).map(([no,time])=>`${no}=${time}`).join('\n')}
}
function renderResultDisplayState(){
 const resultState=getResultDisplayState();
 if($('resultStatusBadge')){$('resultStatusBadge').textContent=resultState.label;$('resultStatusBadge').classList.toggle('is-done',resultState.done);$('resultStatusBadge').classList.toggle('is-manual',resultState.manual)}
 if($('resultState'))$('resultState').textContent=resultState.label;
 if($('narSync'))$('narSync').textContent=resultState.done?'結果を再取得・再検証':resultState.status==='error'||resultState.status==='retry'?'結果を再取得':'結果を確認・検証';renderResultDiagnostics();
 if($('narStatus')&&!$('narStatus').textContent){
   $('narStatus').textContent=resultState.done?(resultState.manual?'結果データ：🟠 手動入力｜公式照合なし':'結果データ：🟢 公式自動取得'):resultState.status==='error'||resultState.status==='retry'?resultFetchFeedback({code:state.resultErrorType||state.resultQueue?.lastResultError}).text:'結果待ち｜レース終了後に公式結果を取得できます。';
 }
 restoreSavedResultFields(resultState);
}
function openResultValidation(){
 const card=$('resultCard');if(!card)return;
 requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'start'}));
}
function snapshotRace(r=state.race){return {category:r.category||'',raceType:r.raceType||raceTypeOf(r),raceDate:r.raceDate||'',track:r.track||'',raceNo:r.raceNo||'',raceName:r.raceName||'',postTime:r.postTime||'',distance:r.distance||'',surface:r.surface||'',courseType:r.courseType||'',trackCondition:r.trackCondition||'',weather:r.weather||'',bias:r.bias||'',pace:r.pace||'',chaos:r.chaos??null,volatilityIndex:r.volatilityIndex??null,raceConfidence:r.raceConfidence??null,predictionConfidence:r.predictionConfidence??null,predictionConfidenceReasons:Array.isArray(r.predictionConfidenceReasons)?cloneData(r.predictionConfidenceReasons):[],axisModelMode:r.axisModelMode||null,jraModelVersion:r.jraModelVersion||null}}
function longshotHorse(h){return {valueType:h.valueType||'',valueMark:h.valueMark||'',winValueFlag:h.winValueMark||'',placeValueFlag:h.placeValueMark||'',longshotScore:h.longshotScore??null,marketGapScore:h.marketGapScore??null,timeValueScore:h.timeValueScore??null,courseValueScore:h.courseValueScore??null,paceFitScore:h.paceFitScore??null,reboundScore:h.reboundScore??null,popularityPercentile:h.popularityPercentile??null,abilityRank:h.abilityRank??null,winRank:h.winRank??null,placeRank:h.placeRank??null,overallRank:h.overallRank??null,timeRank:h.timeRank??null,timeValueFlag:h.timeValueFlag||'',longshotReasons:Array.isArray(h.longshotReasons)?cloneData(h.longshotReasons):[]}}
function predictionHorse(h){return {horseNo:Number(h.horseNo),frameNo:h.frameNo??null,horseName:h.horseName,sexAge:h.sexAge||'',weightCarried:h.weightCarried??h.weight??null,jockey:h.jockey||'',trainer:h.trainer||'',win:h.win,second:h.second??null,place:h.place,overall:h.overall,abilityScore:h.abilityScore??h.scores?.timeIndex??null,jraIndices:h.jraIndices?cloneData(h.jraIndices):null,features:h.features?cloneData(h.features):null,predictedTime:h.predictedTime,predictedTimeType:h.predictedTimeType||'',predictedTimeConfidence:h.predictedTimeConfidence??null,predictedTimeScenarios:h.predictedTimeScenarios?cloneData(h.predictedTimeScenarios):null,probabilityUncertainty:h.probabilityUncertainty??null,abilityMark:h.abilityMark,sourceMark:h.sourceMark||'',dataConfidence:h.dataConfidence,runningStyle:h.runningStyle||'',weight:h.weight??h.weightCarried??null,predictionAxes:h.predictionAxes?cloneData(h.predictionAxes):null,...longshotHorse(h)}}
function marketHorse(h){return {horseNo:Number(h.horseNo),odds:h.odds??null,popularity:h.popularity??null,ev:h.ev??null,warningMark:h.warningMark||'',...longshotHorse(h)}}
const VOLATILITY_WEIGHTS=Object.freeze({similar:30,winBunching:20,marketGap:15,dangerousFavorites:15,longshotDensity:10,timeCloseness:5,paceUncertainty:5});
function volatilityLabel(value){const v=Number(value);return v<30?'順当':v<50?'やや順当':v<70?'波乱注意':v<85?'波乱':'大波乱'}
function volatilityConfidenceLabel(value){const v=Number(value);return v<40?'低':v<70?'中':'高'}
function numericList(values){return values.map(Number).filter(Number.isFinite)}
function spread(values,count=5){const a=numericList(values).sort((x,y)=>y-x).slice(0,count);return a.length>1?a[0]-a[a.length-1]:null}
function normalizedSimilarity(a,b,scale){if(a==null||b==null)return .5;return clamp(1-Math.abs(Number(a)-Number(b))/scale,0,1)}
function volatilityRaceProfile(record){
 const race=record?.predictionSnapshot?.race||record?.race||{},horses=frozenHorses(record),fieldSize=horses.length;
 const wins=numericList(horses.map(h=>h.win)).sort((a,b)=>b-a),places=numericList(horses.map(h=>h.place)).sort((a,b)=>b-a),abilities=numericList(horses.map(h=>h.abilityScore??h.overall)).sort((a,b)=>b-a),overall=numericList(horses.map(h=>h.overall)).sort((a,b)=>b-a),times=numericList(horses.map(h=>timeToSec(h.predictedTime))).sort((a,b)=>a-b);
 const rankedByWin=[...horses].filter(h=>Number.isFinite(Number(h.win))).sort((a,b)=>Number(b.win)-Number(a.win)),rankedByPopularity=[...horses].filter(h=>Number.isFinite(Number(h.popularity))).sort((a,b)=>Number(a.popularity)-Number(b.popularity));
 const popRank=new Map(rankedByPopularity.map((h,i)=>[Number(h.horseNo),i+1]));
 const rankGap=rankedByWin.map((h,i)=>Math.abs((i+1)-(popRank.get(Number(h.horseNo))??i+1))),marketGap=rankGap.length?clamp(mean(rankGap)/(Math.max(3,fieldSize)*.45)*100,0,100):50;
 const warnings=horses.filter(h=>h.warningMark||h.warning).length,longshots=horses.filter(h=>h.valueMark||h.longshotScore>=60).length;
 const topFavorites=rankedByPopularity.slice(0,3),dangerousFavorites=topFavorites.filter(h=>h.warningMark||h.warning).length;
 const bestTime=times[0],timeFourth=times[Math.min(3,times.length-1)],timeGap=bestTime!=null&&timeFourth!=null?timeFourth-bestTime:null;
 const winGap=wins.length>1?wins[0]-wins[1]:null,winTop5Gap=wins.length>1?wins[0]-wins[Math.min(4,wins.length-1)]:null,abilityGap=abilities.length>1?abilities[0]-abilities[Math.min(4,abilities.length-1)]:null;
 const styles=horses.map(h=>String(h.runningStyle||'')).filter(Boolean),styleCounts=styles.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{}),styleMax=Math.max(0,...Object.values(styleCounts)),paceUncertainty=styles.length?clamp((1-styleMax/styles.length)*135,0,100):50;
 const completeness=[wins.length/Math.max(1,fieldSize),places.length/Math.max(1,fieldSize),times.length/Math.max(1,fieldSize),rankedByPopularity.length/Math.max(1,fieldSize)].reduce((s,x)=>s+clamp(x,0,1),0)/4;
 const supportedDeep=horses.filter(h=>Number(h.popularity)>=10&&((Number(h.place)>=20)||(Number(h.marketGapScore)>=60)||(Number(h.timeRank)<=4))).length;
 return {track:String(race.track||''),distance:num(race.distance),surface:String(race.surface||''),raceClass:String(race.raceClass||race.class||race.category||''),trackCondition:String(race.trackCondition||''),fieldSize,wins:wins.slice(0,5),places:places.slice(0,5),winGap,winTop5Gap,placeSpread:spread(places,5),abilityGap,overallSpread:spread(overall,5),timeGap,marketGap,warnings,longshots,dangerousFavorites,supportedDeep,paceUncertainty,completeness};
}
function actualUpsetScore(record){
 const top3=new Set(resultTop3(record)),horses=frozenHorses(record),byPop=[...horses].filter(h=>Number.isFinite(Number(h.popularity))).sort((a,b)=>Number(a.popularity)-Number(b.popularity)),popByNo=new Map(horses.map(h=>[Number(h.horseNo),Number(h.popularity)])),topPops=resultTop3(record).map(no=>popByNo.get(Number(no))).filter(Number.isFinite);
 let score=0;const reasons=[];
 if(byPop[0]&&!top3.has(Number(byPop[0].horseNo))){score+=20;reasons.push('1番人気が馬券外')}
 if(byPop.length>=2&&byPop.slice(0,2).every(h=>!top3.has(Number(h.horseNo)))){score+=20;reasons.push('2番人気以内が両方馬券外')}
 if(topPops.some(p=>p>=7)){score+=20;reasons.push('7人気以下がTOP3')}
 if(topPops.some(p=>p>=10)){score+=25;reasons.push('10人気以下がTOP3')}
 if(topPops.filter(p=>p>=7).length>=2){score+=15;reasons.push('人気薄2頭がTOP3')}
 const highValue=horses.some(h=>top3.has(Number(h.horseNo))&&Number(h.popularity)>=7&&Number(h.ev)>=130);if(highValue){score+=10;reasons.push('高期待値穴馬がTOP3')}
 return {score:clamp(score,0,100),upset:score>=50,orderly:score<50,reasons};
}
function distributionSimilarity(a,b){const n=Math.min(a.length,b.length,5);if(!n)return .5;let diff=0;for(let i=0;i<n;i++)diff+=Math.abs(Number(a[i]||0)-Number(b[i]||0));return clamp(1-diff/(n*25),0,1)}
function volatilitySimilarity(a,b){
 const exact=(x,y,unknown=.5)=>!x||!y?unknown:String(x)===String(y)?1:0;
 const parts=[
  [.12,exact(a.track,b.track,.35)],[.12,normalizedSimilarity(a.distance,b.distance,600)],[.06,exact(a.surface,b.surface,.6)],[.05,exact(a.raceClass,b.raceClass,.6)],[.08,normalizedSimilarity(a.fieldSize,b.fieldSize,8)],
  [.13,distributionSimilarity(a.wins,b.wins)],[.12,distributionSimilarity(a.places,b.places)],[.10,normalizedSimilarity(a.abilityGap,b.abilityGap,35)],[.08,normalizedSimilarity(a.timeGap,b.timeGap,3)],[.06,normalizedSimilarity(a.marketGap,b.marketGap,60)],[.05,(normalizedSimilarity(a.longshots,b.longshots,4)+normalizedSimilarity(a.warnings,b.warnings,3))/2],[.03,exact(a.trackCondition,b.trackCondition,.65)]
 ];return clamp(parts.reduce((s,[w,v])=>s+w*v,0),0,1);
}
function volatilityHistoryBefore(current,history){
 const currentId=raceId(current?.race||current?.predictionSnapshot?.race||{}),stamp=Date.parse(current?.predictionSnapshot?.createdAt||current?.predictionSnapshot?.generatedAt||`${current?.race?.raceDate||current?.predictionSnapshot?.race?.raceDate||'9999-12-31'}T23:59:59Z`);
 return (history||[]).filter(r=>raceId(r?.race||r?.predictionSnapshot?.race||{})!==currentId&&resultOrder(r).length>=3&&(!Number.isFinite(stamp)||Date.parse(r?.predictionSnapshot?.createdAt||r?.predictionSnapshot?.generatedAt||`${r?.race?.raceDate||'1970-01-01'}T00:00:00Z`)<stamp));
}
function calculateVolatilityIndex(current,history=[]){
 const profile=volatilityRaceProfile(current),eligible=volatilityHistoryBefore(current,history).map(record=>({record,profile:volatilityRaceProfile(record)})).map(x=>({...x,similarity:volatilitySimilarity(profile,x.profile),actual:actualUpsetScore(x.record)})).sort((a,b)=>b.similarity-a.similarity);
 let similar=eligible.filter(x=>x.similarity>=.35).slice(0,50);if(similar.length<20)similar=eligible.filter(x=>x.similarity>=.20).slice(0,50);
 const weightSum=similar.reduce((s,x)=>s+x.similarity,0),similarUpsetRate=weightSum?similar.reduce((s,x)=>s+x.similarity*x.actual.score,0)/weightSum:50,similarStabilityRate=100-similarUpsetRate;
 const winBunching=clamp(100-((profile.winTop5Gap??20)/28*100),0,100),timeCloseness=clamp(100-((profile.timeGap??1.5)/3*100),0,100),marketGap=profile.marketGap,dangerousFavorites=clamp(profile.dangerousFavorites/3*100,0,100),longshotDensity=clamp((profile.longshots*20)+(profile.supportedDeep*20),0,100);
 const components={similar:similarUpsetRate,winBunching,marketGap,dangerousFavorites,longshotDensity,timeCloseness,paceUncertainty:profile.paceUncertainty};
 const rawUpsetScore=Object.entries(VOLATILITY_WEIGHTS).reduce((s,[key,w])=>s+components[key]*w/100,0);
 const dominantWin=clamp(((profile.winGap??0)-8)/22*100,0,100),placeConcentration=clamp(((profile.placeSpread??0)-18)/40*100,0,100),abilitySeparation=clamp((profile.abilityGap??0)/35*100,0,100),timeSeparation=clamp((profile.timeGap??0)/3*100,0,100),marketAlignment=100-profile.marketGap,noRisk=clamp(100-profile.dangerousFavorites*34-profile.longshots*16,0,100);
 const stabilityScore=clamp(similarStabilityRate*.3+dominantWin*.2+placeConcentration*.15+abilitySeparation*.12+timeSeparation*.08+marketAlignment*.1+noRisk*.05,0,100),stabilityAdjustment=stabilityScore*.35,unshrunk=clamp(rawUpsetScore-stabilityAdjustment,0,100);
 const sampleConfidence=similar.length<10?20+similar.length*2:similar.length<20?40+(similar.length-10)*1.5:similar.length<50?55+(similar.length-20):85,confidence=clamp(Math.round(sampleConfidence*(.55+.45*profile.completeness)),0,100),reliability=.25+.65*(confidence/100),volatilityIndex=Math.round(clamp(50+(unshrunk-50)*reliability,0,100));
 const factorLabels=[['winBunching','AI上位が接近'],['marketGap','人気とAI評価の乖離が大きい'],['dangerousFavorites','上位人気に危険評価'],['longshotDensity',profile.supportedDeep?'10人気以下に有力候補':'穴馬候補が複数'],['timeCloseness','予想TIME上位が接近'],['paceUncertainty','脚質構成の不確実性']].sort((a,b)=>components[b[0]]-components[a[0]]);
 const reasons=[];if(similar.length)reasons.push(`類似${similar.length}Rの加重波乱度 ${similarUpsetRate.toFixed(1)}%`);for(const [key,label] of factorLabels)if(components[key]>=60&&reasons.length<3)reasons.push(label);if(!reasons.length)reasons.push('波乱要因は限定的');
 const stabilityReasons=[];if(dominantWin>=60)stabilityReasons.push('AI1位が明確に突出');if(marketAlignment>=70)stabilityReasons.push('人気とAI順位が一致');if(similar.length&&similarStabilityRate>=60)stabilityReasons.push(`類似レースの${similarStabilityRate.toFixed(1)}%が順当寄り`);if(!stabilityReasons.length&&stabilityScore>=55)stabilityReasons.push('能力・TIME差が順当方向');
 return {schemaVersion:1,algorithmVersion:'RVI-1.0',volatilityIndex,label:volatilityLabel(volatilityIndex),confidence,confidenceLabel:volatilityConfidenceLabel(confidence),similarRaceCount:similar.length,similarUpsetRate:Number(similarUpsetRate.toFixed(1)),similarStabilityRate:Number(similarStabilityRate.toFixed(1)),upsetScore:Number(rawUpsetScore.toFixed(1)),stabilityScore:Number(stabilityScore.toFixed(1)),stabilityAdjustment:Number(stabilityAdjustment.toFixed(1)),unshrunkScore:Number(unshrunk.toFixed(1)),dataQuality:Number((profile.completeness*100).toFixed(1)),weights:{...VOLATILITY_WEIGHTS},weightPolicy:{current:'RVI-1.0',candidate:null,autoPromotion:false},walkForward:true,reasons:reasons.slice(0,3),stabilityReasons:stabilityReasons.slice(0,3)};
}
function liveLayerActive(){return false}
function displayHorses(){return activeRaceContext().hasPrediction?(state.horses||[]):[]}
function currentVolatility(){return state.predictionSnapshot?.volatility||state.volatilitySnapshot||null}
function renderScratchLayer(){const bar=$('scratchStatusBar');if(!bar)return;const inactive=activeRaceContext().hasPrediction?confirmedInactiveHorseNos(state).size:0;bar.hidden=!inactive;if(!inactive)return;$('scratchStatusText').textContent=`取消・除外 ${inactive}頭｜Original予想を維持`;$('scratchDiff').textContent='runnerStatusのみ更新。確率・印・期待値・穴馬・波乱指数は再計算しません。';const toggle=bar.querySelector?.('.prediction-layer-toggle');if(toggle)toggle.hidden=true}
function similarityRate(metric){return metric?.rate==null?'—':`${(Number(metric.rate)*100).toFixed(1)}%`}
function renderHistoricalSimilarity(rid=raceId(state.race)){
 const box=$('historicalSimilaritySummary');if(!box)return;const cached=historicalSimilarityCache.get(rid);if(raceTypeOf(state)==='JRA'||!rid||!state.predictionSnapshot){box.hidden=true;return}box.hidden=false;
 if(!cached){$('historicalSimilarityHeadline').textContent='過去類似分析 読込中';$('historicalSimilarityConfidence').textContent='Shadow補助';$('historicalSimilarityStats').innerHTML='';$('historicalSimilarityPatterns').innerHTML='';return}
 if(cached.error){$('historicalSimilarityHeadline').textContent='過去類似分析 利用不可';$('historicalSimilarityConfidence').textContent='現行予想を維持';$('historicalSimilarityStats').innerHTML='';$('historicalSimilarityPatterns').innerHTML=`<p>${esc(cached.error)}</p>`;return}
 const bundle=cached.historicalSimilarity||cached,analysis=predictionViewMode==='live'&&bundle.liveAdjusted?.available?bundle.liveAdjusted:bundle.original;if(!analysis?.available){$('historicalSimilarityHeadline').textContent='過去類似分析 データ不足';$('historicalSimilarityConfidence').textContent='参考度 低';$('historicalSimilarityStats').innerHTML='';$('historicalSimilarityPatterns').innerHTML='<p>予想時点より前に結果取得済みの比較対象がありません。</p>';return}
 const m=analysis.metrics||{};$('historicalSimilarityHeadline').textContent=`類似レース ${analysis.similarRaceCount}R｜平均 ${(Number(analysis.averageSimilarityScore||0)*100).toFixed(0)}%`;$('historicalSimilarityConfidence').textContent=`信頼度 ${analysis.confidenceLabel} ${analysis.similarityConfidence}%`;
 $('historicalSimilarityStats').innerHTML=[["1人気TOP3",similarityRate(m.favoriteTop3Rate)],["7人気以下",similarityRate(m.sevenPlusTop3Rate)],["10人気以下",similarityRate(m.tenPlusTop3Rate)],["人気馬崩壊",similarityRate(m.favoriteCollapseRate)],["先行TOP3",similarityRate(m.frontTop3Rate)],["差しTOP3",similarityRate(m.stalkerTop3Rate)]].map(([label,value])=>`<span>${label}<b>${value}</b></span>`).join('');
 const success=(analysis.successPatterns||[])[0],failure=(analysis.failurePatterns||[])[0],conflict=analysis.historicalConflict?'現行評価と過去傾向が競合':'過去傾向は現行評価と大きな競合なし';$('historicalSimilarityPatterns').innerHTML=`${success?`<p><strong>成功傾向</strong> ${esc(success.label)}｜TOP3 ${success.top3Rate==null?'—':(success.top3Rate*100).toFixed(1)+'%'}｜n=${success.sampleCount}</p>`:''}${failure?`<p><strong>失敗傾向</strong> ${esc(failure.label)}｜凡走 ${failure.failureRate==null?'—':(failure.failureRate*100).toFixed(1)+'%'}｜n=${failure.sampleCount}</p>`:''}<p><strong>Historical ${esc(String(analysis.historicalConsensus||'neutral').toUpperCase())}</strong> ${esc(conflict)}</p>`;
}
function requestHistoricalSimilarity(rid=raceId(state.race)){
 if(raceTypeOf(state)==='JRA')return;const cached=historicalSimilarityCache.get(rid);if(!rid||!state.predictionSnapshot||(cached&&!cached.error)||cached?.checkedAt&&Date.now()-cached.checkedAt<30_000||historicalSimilarityFlights.has(rid))return;renderHistoricalSimilarity(rid);const task=fetchJsonSimple(`/api/db/similarity?raceId=${encodeURIComponent(rid)}`,{timeoutMs:6000}).then(data=>historicalSimilarityCache.set(rid,data)).catch(error=>historicalSimilarityCache.set(rid,{error:`類似分析のみ取得できませんでした（${error?.code||'similarity_unavailable'}）`,checkedAt:Date.now()})).finally(()=>{historicalSimilarityFlights.delete(rid);if(raceId(state.race)===rid)renderHistoricalSimilarity(rid)});historicalSimilarityFlights.set(rid,task)
}
function makeSnapshot(){
 const now=new Date().toISOString(),identity=activeRaceIdentity(),signalSnapshot=resolveSignalSnapshot(state,now),ranked=raceTypeOf(state)==='JRA'?[...state.horses].filter(h=>isEligibleHorse(h)&&!h.warningMark).sort((a,b)=>(b.overall??0)-(a.overall??0)||(b.win??0)-(a.win??0)):rankFinal(),modelVersion=state.race?.jraModelVersion||APP_VERSION;
 const top3=ranked.slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:['◎','○','▲'][i],rank:i+1,finalScore:finalScore(h),score:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,odds:h.odds,popularity:h.popularity,predictedTime:h.predictedTime}));
 if(!state.finalSnapshot||!state.validationCompleted)state.finalSnapshot={schemaVersion:2,raceId:identity.raceId,organization:identity.organization,modelVersion,generatedAt:now,createdAt:now,marketType:state.race.oddsType,oddsSnapshotType:state.race.oddsSnapshotType||'unknown',top3,ranking:ranked.map((h,i)=>({...top3.find(x=>x.horseNo===Number(h.horseNo)),horseNo:Number(h.horseNo),horseName:h.horseName,rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime}))};
 const marks=['◎','○','▲']; state.horses.forEach(h=>h.finalMark='');
 top3.forEach((x,i)=>{const h=state.horses.find(z=>Number(z.horseNo)===Number(x.horseNo));if(h)h.finalMark=marks[i]});
 if(!state.predictionSnapshot){
   const draft={race:snapshotRace(),predictionSnapshot:{createdAt:now,generatedAt:now,race:snapshotRace(),horses:state.horses.map(predictionHorse)},marketSnapshot:{horses:state.horses.map(marketHorse)}};
   const sameTypeHistory=getAllRaces().filter(record=>raceTypeOf(record)===raceTypeOf(state));const volatility=calculateVolatilityIndex(draft,sameTypeHistory);state.race.volatilityIndex=volatility.volatilityIndex;
   const axes={schemaVersion:1,algorithmVersion:'PAR-1.0',mode:'shadow',adopted:false,raceConfidence:state.race.raceConfidence??null,weightPolicy:{current:'9.9.26',candidate:'PAR-1.0',autoPromotion:false},adoptionRule:'walk-forward改善確認後のみ正式昇格',candidateMarks:state.horses.filter(h=>h.predictionAxes?.candidateMark).map(h=>({horseNo:Number(h.horseNo),mark:h.predictionAxes.candidateMark,reason:h.predictionAxes.markReason}))};
   const longshotScenario=ENABLE_LONGSHOT_SCENARIO&&typeof window!=='undefined'&&window.CHASS_LONGSHOT_SCENARIO?window.CHASS_LONGSHOT_SCENARIO.buildLongshotScenario(state.horses,snapshotRace()):null;
   state.predictionSnapshot={schemaVersion:3,featureSchemaVersion:2,raceId:identity.raceId,organization:identity.organization,modelVersion,generatedAt:now,createdAt:now,raceType:raceTypeOf(state),race:snapshotRace(),horses:state.horses.map(predictionHorse),axisModel:axes,volatility,longshotScenario,jraPrediction:state.jraPrediction?cloneData(state.jraPrediction):null,locked:true};
   // Only attach diagnostics to a newly created Snapshot, before its integrity seal.
   // The source cutoff must already exist; never synthesize it from this save time.
   try{
    state.predictionSnapshot.cpsiWaveShadow=window.CHASS_CPSI_WAVE_CORE?.projectAndCalculateMetricShadow?.({
     race:state.race,horses:state.horses,organization:identity.organization,raceId:identity.raceId,
     hasResult:!!(state.result||state.resultSnapshot||state.validationSnapshot||state.validationCompleted)
    })??{version:'CHASS_CPSI_WAVE_SHADOW_V1_REVIEWED',status:'HOLD',reasons:['BROWSER_METRIC_CORE_UNAVAILABLE'],researchOnly:true,formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
   }catch{
    state.predictionSnapshot.cpsiWaveShadow={version:'CHASS_CPSI_WAVE_SHADOW_V1_REVIEWED',status:'HOLD',reasons:['SHADOW_METRIC_COMPUTATION_FAILED'],researchOnly:true,formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
   }
 }
 state.snapshotSchemaVersion=state.predictionSnapshot?.schemaVersion||2;
 if(!state.marketSnapshot||!state.validationCompleted){state.marketSnapshot={schemaVersion:2,raceId:identity.raceId,organization:identity.organization,modelVersion,acquiredAt:state.race.oddsUpdatedAt||now,createdAt:state.race.oddsUpdatedAt||now,oddsSnapshotType:state.race.oddsSnapshotType||'unknown',marketDataSource:state.race.marketDataSource||null,marketDataAvailable:state.race.marketDataAvailable??null,oddsHorseCount:state.race.oddsHorseCount??null,totalHorseCount:state.race.totalHorseCount??null,oddsCoverage:state.race.oddsCoverage??null,evRankStatus:state.race.evRankStatus||null,signalSnapshot:cloneData(signalSnapshot),horses:state.horses.map(marketHorse)}}
 if(state.marketSnapshot&&!state.marketSnapshot.signalSnapshot)state.marketSnapshot.signalSnapshot=cloneData(signalSnapshot);applyFrozenSignalSnapshot(state.horses,state.marketSnapshot?.signalSnapshot||signalSnapshot);
 sealSnapshotIntegrity(state,true);
}
function sealSnapshotIntegrity(record=state,force=false){
 if(record.validationCompleted&&record.snapshotIntegrity&&!force)return record.snapshotIntegrity;
 const hashes={};for(const key of ['predictionSnapshot','marketSnapshot','finalSnapshot'])if(record[key])hashes[key]=snapshotFingerprint(record[key]);
 record.snapshotIntegrity={schemaVersion:1,algorithm:'FNV-1a-32/canonical-json',sealedAt:new Date().toISOString(),hashes};return record.snapshotIntegrity;
}
function verifySnapshotIntegrity(record){
 const expected=record?.snapshotIntegrity?.hashes,predictionAt=Date.parse(record?.predictionCreatedAt||record?.predictionSnapshot?.createdAt||record?.predictionSnapshot?.generatedAt||''),resultAt=Date.parse(record?.resultAcquiredAt||record?.resultSnapshot?.fetchedAt||record?.resultFetchedAt||'');
 const temporalInvalid=Number.isFinite(predictionAt)&&Number.isFinite(resultAt)&&resultAt<predictionAt;
 const referenceOnly=record?.predictionSnapshot?.predictionKind==='backtest_prediction'||record?.race?.predictionKind==='backtest_prediction'||record?.historicalResearch?.predictionKind==='backtest_prediction';
 const chronology=temporalInvalid?(referenceOnly?'historical_post_result':'result_before_prediction'):Number.isFinite(predictionAt)&&Number.isFinite(resultAt)?'ordered':'unknown';
 const context={referenceOnly,chronology};
 if(!expected)return {status:temporalInvalid?'invalid':'legacy',label:referenceOnly?'過去研究（参考・ハッシュ未検証）':temporalInvalid?'時系列異常':'未検証（旧データ）',verified:0,total:0,mismatches:[],temporalInvalid,...context};
 const supported=['predictionSnapshot','marketSnapshot','finalSnapshot'];
 const validMap=typeof expected==='object'&&!Array.isArray(expected),keys=validMap?Object.keys(expected):[];
 const mismatches=[];
 if(!validMap||!keys.length||!keys.includes('predictionSnapshot')
    ||record.snapshotIntegrity.algorithm!=='FNV-1a-32/canonical-json')mismatches.push('snapshotIntegrity');
 for(const key of keys){
  if(!supported.includes(key)||typeof expected[key]!=='string'||!/^fnv1a32:[0-9a-f]{8}$/.test(expected[key])
     ||record?.[key]==null||snapshotFingerprint(record[key])!==expected[key])mismatches.push(key);
 }
 for(const key of supported)if(record?.[key]!=null&&(!validMap||!Object.hasOwn(expected,key)))mismatches.push(key);
 // Chronology classification is descriptive only; do not relax the existing gate.
 const status=temporalInvalid||mismatches.length?'invalid':'verified';
 const label=referenceOnly?(mismatches.length?'過去研究：Snapshot改変要確認':temporalInvalid?'過去研究：結果取得後の予測（参考）':'固定確認済（過去研究・参考）'):status==='verified'?'固定確認済':'改変・時系列要確認';
 return {status,label,verified:keys.filter(key=>!mismatches.includes(key)).length,total:keys.length,mismatches,temporalInvalid,...context};
}
function render(){
 setVersion();const context=activeRaceContext(),jraDraft=context.organization==='JRA'&&!context.hasPrediction?jraRaceInput():null,r=context.hasPrediction?state.race:{...state.race,raceDate:jraDraft?.date||'',track:jraDraft?.racecourse||'',raceNo:jraDraft?.raceNo||'',raceName:jraDraft?.raceName||'',surface:jraDraft?.surface||'',distance:jraDraft?.distance||'',trackCondition:jraDraft?.trackCondition||'',weather:jraDraft?.weather||'',pace:jraDraft?.pace||'標準'},h=displayHorses(),rid=context.hasPrediction?context.raceId:'';
 $('raceTitle').textContent=r.track&&r.raceNo?`${r.track} ${r.raceNo}R`:context.organization==='JRA'?'JRA データ待ち':'レース情報未入力';
 const usefulRaceName=r.raceName&&!/^(地方競馬\s*)?データ情報$/u.test(r.raceName)?r.raceName:'';
 $('raceMeta').textContent=context.hasPrediction?usefulRaceName||'':context.organization==='JRA'?'予想データ未読込':'予想データファイルを読み込むと自動表示します。';
 $('raceMeta').hidden=!$('raceMeta').textContent;
 const volatility=currentVolatility(),volatilityValue=volatility?.volatilityIndex??r.volatilityIndex;
 $('chaosBadge').textContent=volatilityValue==null?'波乱指数 —':`波乱指数 ${volatilityValue}%｜${volatilityLabel(volatilityValue)}`;$('paceBadge').textContent=`展開 ${r.pace||'—'}`;$('biasText').textContent=`馬場 ${r.bias||r.trackCondition||'—'}`;
 const liveConfidence=raceTypeOf(state)==='JRA'?r.predictionConfidence:(liveLayerActive()&&predictionViewMode==='live'?state.liveAdjustedPrediction.raceConfidence:r.raceConfidence);if($('confidenceBadge')){$('confidenceBadge').textContent=liveConfidence==null?(raceTypeOf(state)==='JRA'?'予測信頼度 —':'信頼度 —'):`${raceTypeOf(state)==='JRA'?'予測信頼度':'予想信頼'} ${liveConfidence}%`;$('confidenceBadge').title=raceTypeOf(state)==='JRA'?(r.predictionConfidenceReasons||[]).join('・'):''}
 if($('volatilitySummary')){$('volatilitySummary').hidden=!volatility;$('volatilityHeadline').textContent=volatility?`波乱指数 ${volatility.volatilityIndex}%｜${volatility.label}`:'波乱指数 —';$('volatilityConfidence').textContent=volatility?`波乱判定信頼度 ${volatility.confidenceLabel} ${volatility.confidence}%`:'波乱判定信頼度 —';$('volatilityStats').innerHTML=volatility?`<span>類似 ${volatility.similarRaceCount}R</span><span>類似波乱率 ${volatility.similarUpsetRate.toFixed(1)}%</span><span>順当度 ${volatility.similarStabilityRate.toFixed(1)}%</span>`:'';$('volatilityReasons').innerHTML=volatility?`<strong>${volatility.volatilityIndex<50?'順当要因':'主な波乱要因'}</strong><ul>${(volatility.volatilityIndex<50&&volatility.stabilityReasons?.length?volatility.stabilityReasons:volatility.reasons||[]).slice(0,3).map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
 const prob=h.filter(x=>x.win!=null&&x.place!=null).length,availability=predictionAvailability(h),time=availability.time,marketState=getMarketDisplayState(r,h);
 const names=new Set(h.map(x=>cleanName(x.horseName))); const bad=h.some(x=>!x.horseName)||names.size!==h.length;
 const integrityRows=[['レースID',rid||'—'],['競馬種別',raceTypeOf(state)],['AI確率',`${prob}/${h.length}頭`],['予想TIME',`${time}/${h.length}頭${availability.timeMissing?`（不足${availability.timeMissing}）`:''}`],...(raceTypeOf(state)==='JRA'?[['単勝オッズ',`${h.filter(x=>num(x.odds)!=null).length}/${h.length}`],['人気順',`${h.filter(x=>num(x.popularity)!=null).length}/${h.length}`]]:[['市場',marketState.label]]),['データ状態',bad?'要確認':'正常'],['保存方式',cloudState.available?'クラウド D1':researchStorageMode.includes('indexedDB')?'IndexedDB':'互換保存'],['生成方式',raceTypeOf(state)==='JRA'?'JRA入力':r.autoGenerated?'NAR自動':'JSON'],['評価モード',r.dataMode||'—']];$('integrityGrid').innerHTML=integrityRows.map(([a,b])=>`<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join('');
 const metricShadow=context.hasPrediction?state.predictionSnapshot?.cpsiWaveShadow:null;
 if(metricShadow){
  const c=metricShadow.cpsi,w=metricShadow.wave;
  const ctext=c?`${c.numericMaterializedCount}/${c.activeRunnerCount}頭 数値化｜${c.insufficientCount}頭不足`:`HOLD: ${(metricShadow.reasons||[]).join(',')}`;
  const wtext=Number.isInteger(w?.waveScore)?`${w.waveScore}｜${w.waveClass}｜${w.version}`:`${w?.status||'HOLD'}: ${(w?.reasons||metricShadow.reasons||['SOURCE_NOT_AVAILABLE']).join(',')}`;
  $('integrityGrid').insertAdjacentHTML('beforeend',`<div><span>CPSI（Shadow）</span><strong>${esc(ctext)}</strong></div><div><span>波乱度数（Shadow）</span><strong>${esc(wtext)}</strong></div>`);
 }
 if($('abilitySummary'))$('abilitySummary').textContent=`能力 ${prob}/${h.length||'—'}｜TIME ${time}/${h.length||'—'}｜${raceTypeOf(state)==='JRA'?'入力単勝':marketState.hasReferenceOdds?'予想市場':'市場'} ${marketState.oddsCount||0}/${h.length||'—'}`;
 if($('dateSummary'))$('dateSummary').textContent=`${r.raceDate?String(r.raceDate).slice(5).replace('-','/'):'日付 —'}｜${r.distance?`${r.surface==='芝'?'芝':'ダ'}${r.distance}m`:'距離 —'}｜${r.pace||'展開 —'}｜${r.bias||r.trackCondition||'馬場 —'}`;
 for(const id of ['distanceSummary','timeSummary','marketSummary','paceBadge','biasText'])if($(id))$(id).hidden=true;
 if($('modeSummary'))$('modeSummary').textContent=r.dataMode||'データ待ち';
 if($('integrityStatus')){$('integrityStatus').textContent=bad?'要確認':'正常';$('integrityStatus').classList.toggle('good',!bad);$('integrityStatus').classList.toggle('warn',bad);}
 renderScratchLayer();renderMarketDisplayState();renderResultDisplayState();renderValidationSummary();renderCloudSyncState();renderFinal();renderValuePicks();renderLongshotScenario();renderQuick();renderHorses();renderHistoricalSimilarity(rid);requestHistoricalSimilarity(rid);
}
function renderFinal(){
 const h=displayHorses();if(!h.length){$('finalBody').innerHTML='予想データを読み込むと自動表示します。';return}
 const jra=raceTypeOf(state)==='JRA',picks=(jra?[...h.filter(x=>isEligibleHorse(x)&&!x.warningMark)].sort((a,b)=>(b.overall??0)-(a.overall??0)||(b.win??0)-(a.win??0)):rankFinalFor(h.filter(isEligibleHorse))).slice(0,3), marks=['◎','○','▲']; const diamond=h.filter(x=>isEligibleHorse(x)&&x.valueMark).sort((a,b)=>(b.longshotScore||0)-(a.longshotScore||0)||(b.ev||0)-(a.ev||0))[0]; const warn=h.filter(x=>isEligibleHorse(x)&&x.warningMark).sort((a,b)=>(a.ev||999)-(b.ev||999))[0];
 renderMarketDisplayState();
 $('finalBody').innerHTML=`${jra?'<p class="decision-label">能力評価</p>':''}<div class="final-grid">${picks.map((x,i)=>`<div class="final-pick final-pick-two-row"><div class="final-pick-head"><div class="final-mark">${marks[i]}</div><div class="final-no">${x.horseNo}</div><div class="final-name">${esc(x.horseName)}<small class="final-market">${esc(horseMarketText(x))}</small></div><div class="final-overall"><span>総合</span><b>${x.overall}</b></div></div><div class="final-pick-stats"><div class="final-metric"><span>勝</span><b>${x.win.toFixed(1)}%</b></div><div class="final-metric"><span>3着内</span><b>${x.place.toFixed(1)}%</b></div><div class="final-metric"><span>TIME</span><b>${esc(x.predictedTime||'—')}</b></div></div></div>`).join('')}</div>${jra?'<p class="decision-label">期待値評価</p>':''}<div class="flags"><div class="flag-box diamond">${diamond?`${diamond.valueMark} ${esc(diamond.valueType||'穴候補')} ${diamond.horseNo} ${esc(diamond.horseName)}｜${esc(horseMarketText(diamond))}｜単勝EV ${diamond.ev?.toFixed?.(0)??'—'}%・信頼度 ${esc(diamond.evConfidence||'—')}`:'💎 有力穴馬なし'}</div><div class="flag-box warning">${warn?`${warn.abilityRisk?.length?'⚠️ 能力危険':'⚠️ 市場過熱'} ${warn.horseNo} ${esc(warn.horseName)}｜${esc(horseMarketText(warn))}｜${esc([...(warn.abilityRisk||[]),...(warn.marketHeat||[])].join('・')||'要確認')}`:'⚠ 注意馬なし'}</div></div>`;
}
function renderValuePicks(){const body=$('valuePicksBody');if(!body)return;const picks=displayHorses().filter(h=>isEligibleHorse(h)&&h.valueMark).sort((a,b)=>(b.longshotScore||0)-(a.longshotScore||0)||(b.ev||0)-(a.ev||0));body.innerHTML=picks.length?picks.map(h=>`<article class="value-pick"><div class="value-pick-head"><b>${h.valueMark} ${esc(h.valueType||'穴候補')} ${h.horseNo}番</b><strong>${Math.round(h.longshotScore||0)}</strong></div><h3>${esc(h.horseName)}</h3><p>${esc(horseMarketText(h))}${horseRankGapText(h)?`｜${esc(horseRankGapText(h))}`:''}${h.ev!=null?`｜単勝EV ${Math.round(h.ev)}%・信頼度 ${esc(h.evConfidence||'—')}`:''}</p><div class="value-reasons">${(h.longshotReasons||[]).slice(0,3).map(r=>`<span>${esc(r.label)}</span>`).join('')}</div></article>`).join(''):'<div class="value-empty">💎 有力穴馬なし<br><small>根拠のない人気薄は表示しません。</small></div>'}
function currentLongshotScenario(){return activeRaceContext().hasPrediction?state.predictionSnapshot?.longshotScenario||null:null}
function longshotScenarioValidation(record=state){const engine=typeof window!=='undefined'?window.CHASS_LONGSHOT_SCENARIO:null,scenario=record?.predictionSnapshot?.longshotScenario;if(!ENABLE_LONGSHOT_SCENARIO||!engine||!scenario||!record?.resultSnapshot)return null;return engine.validateLongshotScenario(scenario,record.resultSnapshot)}
function renderLongshotScenario(){const body=$('longshotScenarioBody');if(!body)return;const scenario=currentLongshotScenario();if(!ENABLE_LONGSHOT_SCENARIO||!scenario){body.textContent='Shadow分析データなし';return}const candidates=scenario.candidates||[];body.innerHTML=candidates.length?candidates.slice(0,8).map(h=>`<article><strong>${h.horseNo} ${esc(h.horseName)}</strong><span>${h.popularity==null?'人気未取得':h.popularity+'人気'}｜${h.odds==null?'オッズ未取得':h.odds+'倍'}｜TOP3 ${h.aiTop3==null?'—':Number(h.aiTop3).toFixed(1)+'%'}</span><span>${esc((h.longshotTypes||[]).join('・')||'分類保留')}｜信頼度 ${esc(h.scenarioConfidence)}</span><small>${esc(h.scenario||'根拠不足')}${h.evidence?.length?'｜'+esc(h.evidence.map(x=>x.label).slice(0,3).join('・')):''}</small></article>`).join(''):'<div class="value-empty">Shadow再スキャン候補なし<br><small>本番の印・💎は変更しません。</small></div>'}
function displayMark(h){return [h.finalMark||h.abilityMark,h.valueMark,h.warningMark].filter(Boolean).join(' ')}
function compactMark(h){
 const base=h.finalMark||h.abilityMark||'·';
 const extra=h.valueMark?`💎${h.horseNo}`:h.warningMark?`⚠️${h.horseNo}`:'';
 return extra||base;
}
function renderQuick(){
 const h=displayHorses();if(!h.length){$('quickList').innerHTML='馬データを入力すると一覧表示します。';return}
 const rows=[...h].sort((a,b)=>Number(isEligibleHorse(b))-Number(isEligibleHorse(a))||b.overall-a.overall);
 $('quickList').classList.toggle('show-all',quickExpanded);
 $('quickList').innerHTML=`<div class="quick-table-head horse-data-grid"><span>印</span><span>馬番</span><span>馬名・市場</span><span>勝</span><span>3着内</span><span>TIME</span><span>総合</span></div>`+rows.map((x,i)=>`<div class="quick-row horse-data-grid${i>=4?' is-extra':''}${isEligibleHorse(x)?'':' is-scratched'}" data-horse-no="${x.horseNo}" role="button" tabindex="0" aria-label="${esc(x.horseName)}の詳細分析を開く"><div class="quick-mark${x.valueMark?' is-value':x.warningMark?' is-alert':''}">${isEligibleHorse(x)?esc(compactMark(x)):esc(`元${x.originalMark||'—'}`)}</div><div class="quick-no">${x.horseNo}</div><div class="quick-name">${esc(x.horseName)}<small class="quick-market">${esc(horseMarketText(x))}</small>${isEligibleHorse(x)?'':`<small>${esc(x.statusLabel||horseStatusLabel(x.horseStatus))}</small>`}</div><div class="quick-stat"><span>勝</span><strong>${x.win.toFixed(1)}%</strong></div><div class="quick-stat"><span>3着内</span><strong>${x.place.toFixed(1)}%</strong></div><div class="quick-stat"><span>TIME${x.predictedTimeType?`(${esc(x.predictedTimeType)})`:''}</span><strong>${esc(x.predictedTime||'—')}</strong></div><div class="quick-stat"><span>総合</span><strong>${x.overall}</strong></div></div>`).join('');
 if($('quickToggle'))$('quickToggle').textContent=quickExpanded?'上位4頭に戻す':'全'+rows.length+'頭を見る ›';
}
function renderHorses(){
 const list=$('horseList');list.innerHTML=''; const tpl=$('horseTpl');
 displayHorses().forEach(x=>{
   const n=tpl.content.cloneNode(true);n.querySelector('.horse-no').textContent=x.horseNo;n.querySelector('.horse-mark-name').textContent=`${displayMark(x)} ${x.horseName}`.trim();n.querySelector('.horse-sub').textContent=[x.runningStyle,horseMarketText(x),horseRankGapText(x)].filter(Boolean).join('｜');n.querySelector('.overall-pill').textContent=`総合 ${x.overall}`;n.querySelector('.m-win').textContent=x.win.toFixed(1)+'%';n.querySelector('.m-place').textContent=x.place.toFixed(1)+'%';n.querySelector('.m-time').textContent=x.predictedTime?`${x.predictedTime}${x.predictedTimeType?` ${x.predictedTimeType}`:''}`:'未推定';n.querySelector('.m-overall').textContent=x.overall;const raw=x.raw||{recent:[]},sc=x.predictedTimeScenarios,ft=x.features,ax=x.predictionAxes,ji=x.jraIndices;n.querySelector('.facts').innerHTML=ji?`速度 <small>SPEED</small> ${ji.speed??'—'} / 近走 <small>RECENT</small> ${ji.recent??'—'} / 距離 <small>DISTANCE</small> ${ji.distance??'—'} / コース <small>COURSE</small> ${ji.course??'—'} / 末脚 <small>FINISH</small> ${ji.finish??'—'} / 展開 <small>PACE</small> ${ji.pace??'—'} / 総合 ${ji.total??'—'}`:`最高指数 ${raw.highest??'—'} / 5走平均 ${raw.avg5??'—'} / 距離 ${raw.distance??'—'} / コース ${raw.course??'—'} / 近走 ${(raw.recent||[]).length?raw.recent.join('→'):'—'} / 斤量 ${raw.kg??'—'}kg${sc?` / TIME 標準 ${esc(sc.standard)}・展開ハマり ${esc(sc.paceFavored)}・展開不利 ${esc(sc.paceAdverse)}`:''}`;n.querySelector('.logic').innerHTML=ji?`JRA順位シミュレーション / 予測信頼度 ${x.dataConfidence}% / 距離不確実性 ${x.probabilityUncertainty==null?'—':Math.round(x.probabilityUncertainty*100)+'%'} / 先行実現率 ${ft?.frontRealizationRate==null?'算出不可':(ft.frontRealizationRate*100).toFixed(1)+'%'} / 残存率 ${ft?.remainingRate==null?'算出不可':(ft.remainingRate*100).toFixed(1)+'%'} / 差込率 ${ft?.closingRate==null?'算出不可':(ft.closingRate*100).toFixed(1)+'%'} / 穴分類 ${esc(ft?.longshotClass||'—')}`:`評価モード ${esc(x.dataMode||'—')} / 指数スコア ${x.scores.timeIndex?.toFixed(1)??'—'} / 距離適性 ${x.scores.distanceFit?.toFixed(1)??'—'} / コース適性 ${x.scores.courseFit?.toFixed(1)??'—'} / 斤量補正 ${x.scores.weight?.toFixed(1)??'—'} / 信頼度 ${x.dataConfidence}%${x.predictedTimeConfidence!=null?` / TIME信頼度 ${x.predictedTimeConfidence}%`:''}${ft?` / 特徴量 近走${ft.recentFormScore??'—'}・距離${ft.distanceFit??'—'}・同場${ft.courseFit??'—'}・安定${ft.consistencyScore??'—'}`:''}${x.sourceMark?` / 元印 ${esc(x.sourceMark)}`:''}${ax?`<div class="axis-detail"><strong>予想軸強化（検証候補 ${esc(ax.candidateMark||'—')}）</strong><span>能力上限 ${axisGrade(ax.speedCeilingScore)}</span><span>複勝安定 ${axisGrade(ax.placeStabilityScore)}</span><span>展開適性 ${axisGrade(ax.paceFitScore)}</span><span>距離変化 ${axisGrade(ax.distanceChangeFit)}</span><span>転入補正 ${axisGrade(ax.transferLevelScore)}</span><span>状態 ${axisGrade(ax.conditionProgressScore)}</span><span>一致度 ${ax.consensusLabel||'—'}</span><span>相手穴 ${ax.placeLongshotScore??'—'}</span><small>${esc(ax.primaryReason||'')} ${ax.supportReasons?.length?'｜'+esc(ax.supportReasons.join('・')):''}</small></div>`:''}`;n.querySelector('.reason').textContent=horseShortComment(x);list.appendChild(n);
 });
}
const renderHorsesBase=renderHorses;
renderHorses=function(){renderHorsesBase();const horses=displayHorses(),rows=[...($('horseList')?.children||[])];rows.forEach((row,index)=>{const h=horses[index];if(!h||isEligibleHorse(h))return;row.classList.add('is-scratched');const title=row.querySelector('.horse-mark-name'),pill=row.querySelector('.overall-pill');if(title)title.textContent=`${h.statusLabel||horseStatusLabel(h.horseStatus)}｜元予想 ${h.originalMark||'—'} ${h.horseName}`;if(pill)pill.textContent='評価対象外'})};
function openHorseDetail(no){
 const index=state.horses.findIndex(h=>String(h.horseNo)===String(no));if(index<0)return;
 const panel=$('horseDetailsCard'),row=$('horseList')?.children?.[index];
 if(panel)panel.open=true;
 const detail=row?.querySelector?.('.horse-details');if(detail)detail.open=true;
 row?.scrollIntoView?.({behavior:'smooth',block:'center'});
}
function mergeExisting(next, existing){
 if(!existing)return next;
 const locked=!!(existing.validationCompleted||existing.validated&&existing.result?.finishOrder?.length>=3);
 next.result=existing.result||next.result;
 next.actualTimes=existing.actualTimes||next.actualTimes||{};
 next.finalSnapshot=existing.finalSnapshot||next.finalSnapshot;
 next.predictionSnapshot=existing.predictionSnapshot||next.predictionSnapshot;
 next.marketSnapshot=existing.marketSnapshot||next.marketSnapshot;
 next.liveAdjustedPrediction=existing.liveAdjustedPrediction||next.liveAdjustedPrediction;
 next.scratchAudit=existing.scratchAudit||next.scratchAudit;
 next.resultMarketSnapshot=existing.resultMarketSnapshot||next.resultMarketSnapshot;
 next.predictionSaved=existing.predictionSaved??next.predictionSaved;
 next.resultStatus=existing.result?.finishOrder?.length>=3?'success':existing.resultStatus||next.resultStatus;
 next.resultFetchedAt=existing.resultFetchedAt||next.resultFetchedAt;
 next.resultFetchCheckedAt=existing.resultFetchCheckedAt||next.resultFetchCheckedAt;
 next.validationCompleted=existing.validationCompleted??next.validationCompleted;
 next.validated=existing.validated??next.validated;
 if(locked&&Array.isArray(existing.horses)&&existing.horses.length)next.horses=existing.horses.map(h=>({...h}));
 if(existing.race?.oddsType==='実オッズ'){
   next.race.oddsType='実オッズ'; next.race.oddsUpdatedAt=existing.race.oddsUpdatedAt;
   const oldMap=new Map((existing.horses||[]).map(h=>[String(h.horseNo),h]));
   next.horses.forEach(h=>{const o=oldMap.get(String(h.horseNo));if(o?.odds!=null){h.odds=o.odds;h.popularity=o.popularity;}});
   if(!locked){
     reconcileMarketDerivedValues(next.horses,next.race);applyFrozenSignalSnapshot(next.horses,existing.marketSnapshot?.signalSnapshot||null);
     next.race.marketDerivedVersion='MDV-2';
     next.marketSnapshot={...(next.marketSnapshot||{}),schemaVersion:2,modelVersion:APP_VERSION,acquiredAt:existing.race.oddsUpdatedAt||next.marketSnapshot?.acquiredAt||new Date().toISOString(),marketDerivedVersion:'MDV-2',predictionBasisSignature:marketPredictionBasisSignature(next.horses),horses:next.horses.map(marketHorse)};
   }
 }
 return next;
}

function initAutoRaceControls(){
 const td=$('autoTrack'),rn=$('autoRaceNo'),dd=$('autoRaceDate');
 if(td){
   td.innerHTML=Object.keys(NAR_TRACKS).map(t=>`<option value="${esc(t)}">${esc(t)}</option>`).join('');
   if($('track').value && NAR_TRACKS[$('track').value])td.value=$('track').value;
 }
 if(rn)rn.innerHTML=Array.from({length:12},(_,i)=>`<option value="${i+1}">${i+1}R</option>`).join('');
 if(dd&&!dd.value){
   const now=new Date(),local=new Date(now.getTime()-now.getTimezoneOffset()*60000);
   dd.value=local.toISOString().slice(0,10);
 }
}
function localIsoDate(now=new Date()){return new Date(now.getTime()-now.getTimezoneOffset()*60000).toISOString().slice(0,10)}
function meetingEntryFresh(entry,date,now=Date.now()){if(['金沢','笠松'].includes(entry?.track)&&entry.venueRoutingVersion!=='NAR_VENUE_ROUTING_22_23_V1')return false;if(!entry||!['meeting','non_meeting'].includes(entry.status))return false;if(date<localIsoDate(new Date(now)))return true;const checked=Date.parse(entry.checkedAt||entry.checked_at||'');return Number.isFinite(checked)&&now-checked<MEETING_SELECTOR_TTL_MS}
function meetingEntriesForDate(date,now=Date.now()){const entries={};for(const track of Object.keys(NAR_TRACKS)){const found=meetingCacheEntry(date,track);if(meetingEntryFresh(found,date,now))entries[track]=found}return entries}
function meetingSelectorResolution(entries={}){const values=Object.values(entries),meeting=values.filter(x=>x?.status==='meeting').length,unknown=Object.keys(NAR_TRACKS).filter(track=>!entries[track]||entries[track]?.status==='unknown').length;if(meeting)return {status:unknown?'partial':'ready',fallback:false,meeting,unknown};if(unknown)return {status:'fallback',fallback:true,meeting,unknown};return {status:'empty',fallback:false,meeting,unknown:0}}
function selectorRaceNumbers(track){const entry=meetingSelectorState.entries?.[track];if(entry?.status==='meeting'&&entry.raceNumbers?.length)return [...new Set(entry.raceNumbers.map(Number).filter(n=>n>0))].sort((a,b)=>a-b);if(['partial','fallback'].includes(meetingSelectorState.status)&&entry?.status==='unknown')return Array.from({length:12},(_,i)=>i+1);return []}
function renderMeetingSelector({message=''}={}){
 const td=$('autoTrack'),rn=$('autoRaceNo'),button=$('autoRaceLoad'),status=$('meetingSelectorStatus');if(!td||!rn)return;const state=meetingSelectorState,tracks=Object.keys(NAR_TRACKS),meeting=tracks.filter(t=>state.entries[t]?.status==='meeting'),nonMeeting=tracks.filter(t=>state.entries[t]?.status==='non_meeting'),unknown=tracks.filter(t=>!state.entries[t]||state.entries[t]?.status==='unknown'),previous=td.value;
 const group=(label,items,kind)=>items.length?`<optgroup label="${esc(label)}">${items.map(t=>`<option value="${esc(t)}" ${kind==='non'?'disabled':''}>${esc(t)}${kind==='non'?'（この日は非開催）':kind==='unknown'?'（開催未確認）':''}</option>`).join('')}</optgroup>`:'';
 td.innerHTML=group(state.date===localIsoDate()?'本日開催':'この日の開催',meeting,'meeting')+group('この日は非開催',nonMeeting,'non')+(['partial','fallback'].includes(state.status)?group(state.status==='partial'?'開催情報未確認（手動選択可）':'手動選択',unknown,'unknown'):group('開催情報未確定',unknown,'non'));
 const usable=meeting.includes(previous)||['partial','fallback'].includes(state.status)&&unknown.includes(previous)?previous:meeting[0]||(['partial','fallback'].includes(state.status)?unknown[0]:'');if(usable)td.value=usable;
 const previousRace=Number(rn.value),numbers=selectorRaceNumbers(td.value);rn.innerHTML=numbers.map(n=>`<option value="${n}">${n}R</option>`).join('');if(numbers.includes(previousRace))rn.value=String(previousRace);else if(numbers.length)rn.value=String(numbers[0]);
 const loading=state.status==='loading',noMeeting=state.status==='empty',blocked=loading||noMeeting||!td.value||!numbers.length;td.disabled=loading||noMeeting;rn.disabled=blocked;button.disabled=blocked;
 if($('track'))$('track').value=td.value||'';if($('raceNo'))$('raceNo').value=rn.value||'';
 if(status){if(loading)status.textContent='開催情報を確認中…';else if(noMeeting)status.textContent='この日は地方競馬開催がありません。';else if(state.status==='partial')status.textContent=`${state.date===localIsoDate()?'本日':'この日'}開催 ${meeting.length}場｜一部${unknown.length}場の開催情報を確認できません。確認済み開催場は通常どおり選択できます。`;else if(state.fallback)status.textContent='開催情報を確認できないため手動選択モードです。既存選択は維持できます。';else status.textContent=`${state.date===localIsoDate()?'本日':'この日'}開催 ${meeting.length}場｜${state.source==='local_cache'?'端末cache':state.source==='d1_meeting_calendar'?'共有cache':'NAR開催情報'}`}
 if(message&&$('autoRaceStatus'))$('autoRaceStatus').textContent=message;
}
async function discoverSelectorTrack(date,track,{refresh=false}={}){const code=narCode(track),response=await fetch(`/api/nar/meeting?code=${code}&date=${encodeURIComponent(date)}${refresh?'&refresh=1':''}`,{cache:'no-store'}),data=await responseJson(response);if(!response.ok||!['meeting','non_meeting'].includes(data.status))throw requestError(data.errorCode||'meeting_lookup_failed',data.error||'開催情報を取得できませんでした',response.status);await setMeetingCache(date,track,data);return meetingCacheEntry(date,track)}
async function refreshMeetingSelector(date,{force=false}={}){
 date=String(date||'');if(!date)return null;if(meetingDiscoveryPromises.has(date))return meetingDiscoveryPromises.get(date);const task=(async()=>{const previousTrack=$('autoTrack')?.value||'',previousRace=Number($('autoRaceNo')?.value)||null;meetingSelectorState={date,status:'loading',entries:force?{}:meetingEntriesForDate(date),source:null,fallback:false,error:null};renderMeetingSelector();
  if(!force&&Object.keys(meetingSelectorState.entries).length===Object.keys(NAR_TRACKS).length){const resolution=meetingSelectorResolution(meetingSelectorState.entries);meetingSelectorState.status=resolution.status;meetingSelectorState.fallback=resolution.fallback;meetingSelectorState.source='local_cache';renderMeetingSelector();return meetingSelectorState}
  try{const cached=await cloudRequest(`/api/db/meetings?date=${encodeURIComponent(date)}`);for(const item of cached.tracks||[])if(meetingEntryFresh(item,date)){await setMeetingCache(date,item.track,item);meetingSelectorState.entries[item.track]=meetingCacheEntry(date,item.track)}if((cached.tracks||[]).length)meetingSelectorState.source='d1_meeting_calendar'}catch{}
  const missing=Object.keys(NAR_TRACKS).filter(track=>!meetingEntryFresh(meetingSelectorState.entries[track],date));let failures=0;for(const track of missing){try{meetingSelectorState.entries[track]=await discoverSelectorTrack(date,track,{refresh:force||!!meetingCacheEntry(date,track)});meetingSelectorState.source=meetingSelectorState.source||'nar_discovery'}catch(error){failures++;meetingSelectorState.entries[track]={date,track,status:'unknown',raceNumbers:[],errorCode:error?.code||'meeting_lookup_failed'}}}
  const resolution=meetingSelectorResolution(meetingSelectorState.entries);meetingSelectorState.fallback=resolution.fallback;meetingSelectorState.error=resolution.unknown?`${resolution.unknown}場の開催情報を確認できませんでした`:null;meetingSelectorState.status=resolution.status;renderMeetingSelector({message:previousTrack&&$('autoTrack')?.value!==previousTrack?'開催会場変更に伴い競馬場・レースを変更しました。':previousRace&&Number($('autoRaceNo')?.value)!==previousRace?'開催情報に伴いレースを1Rへ変更しました。':''});return meetingSelectorState})().finally(()=>meetingDiscoveryPromises.delete(date));meetingDiscoveryPromises.set(date,task);return task
}
function meetingSelectionValid(date,track,raceNo){if(meetingSelectorState.date!==date||meetingSelectorState.status==='loading')return false;const entry=meetingSelectorState.entries?.[track];if(entry?.status==='meeting')return (entry.raceNumbers||[]).map(Number).includes(Number(raceNo));return ['partial','fallback'].includes(meetingSelectorState.status)&&entry?.status==='unknown'}
function jraRaceInput(){return {date:$('jraDate')?.value||'',racecourse:$('jraCourse')?.value||'',raceNo:Number($('jraRaceNo')?.value)||null,raceName:$('jraRaceName')?.value||'',surface:$('jraSurface')?.value||'',distance:Number($('jraDistance')?.value)||null,courseType:$('jraCourseType')?.value||'',trackCondition:$('jraCondition')?.value||'不明',weather:$('jraWeather')?.value||'',pace:$('jraPace')?.value||'標準'}}
// CHASS-JRA-RACE-STATE-ISOLATION-v1.9.7
function jraDraftFromSelection(input=jraRaceInput()){
  return {
    category:'中央競馬',
    raceType:'JRA',
    raceDate:input.date||'',
    date:input.date||'',
    track:input.racecourse||'',
    racecourse:input.racecourse||'',
    raceNo:Number(input.raceNo)||null,
    raceName:input.raceName||'',
    surface:input.surface||'',
    distance:input.distance??null,
    courseType:input.courseType||'',
    trackCondition:input.trackCondition||'不明',
    weather:input.weather||'',
    pace:input.pace||'標準'
  };
}
function expectedJraRaceId(date,track,raceNo){
  return raceId({raceDate:date,track,raceNo});
}
// CHASS-JRA-SAVED-PREDICTION-RESTORE-v1.9.8
function exactSavedJraRace(draft){
  const nextId=raceId(draft);
  if(!nextId)return null;
  const sources=[raceCache,store.get(KEY,{}),store.get(LEGACY_KEY,{})];
  for(const source of sources){
    const saved=source?.[nextId];
    if(!saved?.predictionSnapshot)continue;
    const recordIdentity=activeRaceIdentity(saved);
    const predictionIdentity=snapshotIdentity(saved.predictionSnapshot,saved,'prediction');
    if(recordIdentity.organization!=='JRA'||recordIdentity.raceId!==nextId)continue;
    if(predictionIdentity.organization!=='JRA'||predictionIdentity.raceId!==nextId)continue;
    return saved;
  }
  return null;
}

function activateJraSelectionState(draft,{renderNow=true}={}){
  const normalized={
    ...jraDraftFromSelection(),
    ...cloneData(draft||{}),
    raceType:'JRA',
    category:'中央競馬'
  };
  const nextId=raceId(normalized);
  if(!nextId)return false;
  const active=activeRaceIdentity();
  if(active.organization==='JRA'&&active.raceId===nextId)return false;

  activeRaceGeneration++;
  lastRaceFetchAudit=null;
  predictionViewMode='original';
  jraNormalizedDraft=null;

  const saved=exactSavedJraRace(normalized);
  if(saved){
    const restored=restoreSavedRace(saved,{organization:'JRA',raceId:nextId});
    const restoredIdentity=activeRaceIdentity(restored);
    const predictionIdentity=restored?.predictionSnapshot
      ? snapshotIdentity(restored.predictionSnapshot,restored,'prediction')
      : {organization:'',raceId:''};

    if(
      restored?.predictionSnapshot &&
      restoredIdentity.organization==='JRA' &&
      restoredIdentity.raceId===nextId &&
      predictionIdentity.organization==='JRA' &&
      predictionIdentity.raceId===nextId
    ){
      state=restored;
      state.race={...state.race,...cloneData(normalized),raceType:'JRA',category:'中央競馬'};
      state.predictionSaved=state.predictionSaved??true;
      saveCurrentRace(nextId);
      if(renderNow)render();
      if(typeof document!=='undefined'&&$('jraStatus')){
        $('jraStatus').textContent='保存済み予想を復元しました｜現在オッズは必要に応じて更新してください。';
      }
      return true;
    }
  }

  state=emptyRaceState('JRA');
  state.race={...state.race,...cloneData(normalized),raceType:'JRA',category:'中央競馬'};
  clearValidationTransient(state);
  renderRaceFetchDiagnostics(null);
  if(renderNow)render();
  if(typeof document!=='undefined'&&$('jraStatus')){
    $('jraStatus').textContent='予想データ未読込｜JRA公式データを取得してください。';
  }
  return true;
}
function ensureJraRaceSelectionState({renderNow=true}={}){
  if(raceTypeOf(state)!=='JRA')return false;
  return activateJraSelectionState(jraDraftFromSelection(),{renderNow});
}
function jraPayloadMatchesActive(data){
  const expected=expectedJraRaceId(data?.date,data?.track,data?.race);
  const active=activeRaceIdentity();
  return !!expected&&active.organization==='JRA'&&active.raceId===expected;
}
function fillJraRace(race={}){jraMeetingSelector?.manual();if($('jraDate'))$('jraDate').value=race.date||$('jraDate').value;if($('jraCourse')&&race.racecourse)$('jraCourse').value=race.racecourse;if($('jraRaceNo')&&race.raceNo)$('jraRaceNo').value=race.raceNo;if($('jraRaceName'))$('jraRaceName').value=race.raceName||'';if($('jraSurface')&&race.surface)$('jraSurface').value=race.surface;if($('jraDistance')&&race.distance)$('jraDistance').value=race.distance;if($('jraCourseType'))$('jraCourseType').value=race.courseType||'';if($('jraCondition'))$('jraCondition').value=race.trackCondition||'不明';if($('jraWeather'))$('jraWeather').value=race.weather||'';if($('jraPace'))$('jraPace').value=race.pace||'標準'}
function setRaceMode(mode,{announce=true,preserveState=false}={}){const jra=mode==='JRA',changed=raceTypeOf(state)!==mode;if(changed&&!preserveState)beginActiveRaceTransition(mode);else if(changed)activeRaceGeneration++;if($('raceMode'))$('raceMode').value=jra?'JRA':'NAR';if($('narInputPanel'))$('narInputPanel').hidden=jra;if($('jraInputPanel'))$('jraInputPanel').hidden=!jra;if($('jraActualFields'))$('jraActualFields').hidden=!jra;if($('legacyJsonImport'))$('legacyJsonImport').hidden=jra;if($('raceModeStatus'))$('raceModeStatus').textContent=jra?'中央競馬 J5｜公式データ・安全なバックグラウンド更新':'地方競馬 Ver.9.9.35互換モード';if($('category'))$('category').value=jra?'中央競馬':'地方競馬';const marketCard=document.querySelector('.market-card'),autoOddsRow=$('autoOdds')?.closest?.('.switch-row');if(marketCard)marketCard.hidden=false;if(autoOddsRow)autoOddsRow.hidden=true;if($('liveOddsSync')){$('liveOddsSync').disabled=false;$('liveOddsSync').textContent=jra?'JRA公式から事前オッズを取得・固定':'NAR公式から事前オッズを取得・固定'}if($('narSync')){$('narSync').disabled=false;$('narSync').textContent=jra?'JRA公式から結果取得・自動検証':'NAR公式から結果取得・自動保存'}jraMeetingSelector?.setActive(jra,{discover:!preserveState});jraRaceClient?.setActive(jra);jraOddsClient?.setActive(jra);jraResultClient?.setActive(jra);if(announce&&jra&&$('jraStatus'))$('jraStatus').textContent='JRA公式出馬表＋能力先行。オッズは最初の完全な事前Snapshotだけ固定し、現在オッズはチャス側で確認します。';if(changed&&!preserveState)render()}
function mergeJraRace(normalized){return window.CHASS_JRA_NORMALIZER.normalizeJraData({race:{...normalized.race,...jraRaceInput()},horses:normalized.horses})}
function registerJraResultQueue(){const rid=raceId(state.race);registerResultWaiting(state,rid)}
function commitJraNormalized(normalized,provenance=null){const prepared=mergeJraRace(normalized),result=window.CHASS_JRA_ADAPTER.run(prepared);activeRaceGeneration++;state=result.state;abilityMarks(state.horses,state.race);if(provenance){state.race.dataMode='JRA公式出馬表・CHASS独自指数';state.race.dataSource='JRA_OFFICIAL / Existing JRA Adapter';state.race.autoGenerated=true;state.race.parserVersion=provenance.parserVersion;state.race.officialFetchedAt=provenance.fetchedAt;state.race.officialSourceUrl=provenance.sourceUrl;state.race.officialQuality=provenance.quality;}clearValidationTransient(state);state.modelVersion=result.prediction.modelVersion;fillRace(state.race);predictionViewMode='original';makeSnapshot();state.predictionSaved=true;registerJraResultQueue();persist(false);render();renderAutoResultQueue();if($('jraStatus')){$('jraStatus').textContent=`JRA ${state.horses.length}頭｜CHASS指数・確率計算完了｜AI勝率合計 ${result.prediction.quality.winProbabilityTotal.toFixed(2)}%｜TIME ${result.prediction.quality.withTime}/${state.horses.length}｜市場 ${result.prediction.quality.withMarket}/${state.horses.length}`}return result}
function commitJraOfficial(data,generation){
  if(generation!==activeRaceGeneration||raceTypeOf(state)!=='JRA')return false;
  const selected=jraRaceInput();
  const card=data?.race;
  const same=data?.organization==='JRA'&&card?.date===selected.date&&card?.racecourse===selected.racecourse&&Number(card?.raceNo)===Number(selected.raceNo);
  if(!same)return false;
  if(!jraPayloadMatchesActive({date:card.date,track:card.racecourse,race:card.raceNo}))beginActiveRaceTransition('JRA',jraDraftFromSelection(selected));
  fillJraRace(data.race);
  const horses=(data.horses||[]).filter(h=>h.runningStatus==='active');
  const normalized=window.CHASS_JRA_NORMALIZER.normalizeJraData({race:data.race,horses});
  if(!normalized.validation.ok)throw new Error(normalized.validation.errors.join(' / '));
  jraNormalizedDraft=normalized;
  commitJraNormalized(normalized,data);
  return true;
}
function commitJraOdds(data,generation){
  if(generation!==activeRaceGeneration||raceTypeOf(state)!=='JRA'||!state.predictionSnapshot)return false;
  const selected=jraRaceInput();
  const same=data.date===selected.date&&data.track===selected.racecourse&&Number(data.race)===Number(selected.raceNo);
  if(!same||!jraPayloadMatchesActive(data))return false;
  if(!layerMatchesActive(state,state.predictionSnapshot,'prediction'))return false;
  const predictionBefore=snapshotFingerprint(state.predictionSnapshot);
  const count=applyMarketOdds(data.odds,data.acquiredAt,{marketDataSource:data.marketDataSource||'JRA_OFFICIAL_WIN_ODDS',oddsSnapshotType:data.oddsSnapshotType||'live'});
  if(snapshotFingerprint(state.predictionSnapshot)!==predictionBefore)throw new Error('PREDICTION_SNAPSHOT_MUTATED');
  if(count){render();persist(existingValidated(raceId(state.race)))}
  return count;
}
function commitJraResult(data,generation){
  if(generation!==activeRaceGeneration||raceTypeOf(state)!=='JRA'||!state.predictionSnapshot)return false;
  const selected=jraRaceInput();
  const same=data.date===selected.date&&data.track===selected.racecourse&&Number(data.race)===Number(selected.raceNo);
  if(!same||!jraPayloadMatchesActive(data))return false;
  if(!layerMatchesActive(state,state.predictionSnapshot,'prediction'))return false;
  if(state.marketSnapshot&&!layerMatchesActive(state,state.marketSnapshot,'market'))return false;
  const predictionBefore=snapshotFingerprint(state.predictionSnapshot);
  const marketBefore=snapshotFingerprint(state.marketSnapshot);
  state.actualTimes={...state.actualTimes,...(data.actualTimes||{})};
  state.horses.forEach(h=>{const time=state.actualTimes[String(h.horseNo)];if(time)h.actualTime=time});
  const ok=saveFetchedResult(data.finishOrder,{silent:true,source:'JRA公式自動結果取得',resultData:data});
  if(snapshotFingerprint(state.predictionSnapshot)!==predictionBefore||snapshotFingerprint(state.marketSnapshot)!==marketBefore)throw new Error('FROZEN_SNAPSHOT_MUTATED');
  return ok;
}
async function loadJraFile(input){const file=input?.target?.files?.[0]||input;if(!file)return;const generation=++activeRaceGeneration;clearValidationTransient(state);state.horses=[];state.predictionSnapshot=null;state.marketSnapshot=null;state.finalSnapshot=null;state.scratchAudit=null;lastRaceFetchAudit=null;render();try{setButtonBusy('jraAnalyze',true,'読込中…');const normalized=await window.CHASS_JRA_ADAPTER.parseFile(file);if(generation!==activeRaceGeneration||raceTypeOf(state)!=='JRA')return;jraNormalizedDraft=normalized;fillJraRace(normalized.race);if(!normalized.validation.ok)throw new Error(normalized.validation.errors.join(' / '));$('jraAnalyze').disabled=false;$('jraStatus').textContent=`JRA DATA NORMALIZED｜${normalized.horses.length}頭読込｜${normalized.validation.warnings.length?`注意 ${normalized.validation.warnings.length}件`:'必須項目確認済み'}`}catch(error){if(generation!==activeRaceGeneration)return;jraNormalizedDraft=null;$('jraAnalyze').disabled=true;$('jraStatus').textContent=`JRA読込エラー｜${error.message}`}finally{setButtonBusy('jraAnalyze',false);$('jraAnalyze').disabled=!jraNormalizedDraft;if(input?.target)input.target.value=''}}
function analyzeJraManual(){try{const raw=$('jraManualHorses')?.value||'',horses=raw.trim().startsWith('[')?JSON.parse(raw):window.CHASS_JRA_NORMALIZER.parseManualHorses(raw);jraNormalizedDraft=window.CHASS_JRA_NORMALIZER.normalizeJraData({race:jraRaceInput(),horses});if(!jraNormalizedDraft.validation.ok)throw new Error(jraNormalizedDraft.validation.errors.join(' / '));commitJraNormalized(jraNormalizedDraft)}catch(error){$('jraStatus').textContent=`手動入力エラー｜${error.message}`}}
function abilityPlace(win,allWins){const w=Math.pow(Math.max(Number(win)||.01,.01),.72),den=allWins.reduce((s,x)=>s+Math.pow(Math.max(Number(x)||.01,.01),.72),0)||1;return Math.max(1,Math.min(88,300*w/den))}
// Research-only entry points: not wired to UI, timers, cloud or production D1.
function buildNarEarlyResearchRecord(d,{date,track,raceNo}={}){
 const code=narCode(track),now=Date.now(),sourceAt=Date.parse(d?.acquiredAt||''),postAt=Date.parse(`${date}T${d?.postTime||''}:00+09:00`);
 if(!code||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isInteger(raceNo)||raceNo<1||raceNo>99||d?.ok!==true||d?.raceSuccess!==true||d?.organization!=='NAR'||d?.source!=='NAR公式'||String(d?.code)!==String(code)||d?.date!==date||d?.track!==track||Number(d?.race)!==raceNo)throw requestError('nar_early_identity_invalid','研究取得データの識別情報が一致しません。');
 if(d.historicalResearch||d.result||d.resultSnapshot||d.finishOrder?.length||d.predictionSnapshot||d.marketSnapshot||d.finalSnapshot)throw requestError('nar_early_reference_rejected','結果・履歴・既存Snapshotを新規EARLYとして扱いません。');
 if(!Number.isFinite(sourceAt)||sourceAt>now||now-sourceAt>60_000||!Number.isFinite(postAt)||new Date(postAt+9*3600_000).toISOString().slice(0,10)!==date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.postTime||'')||now>=postAt)throw requestError('nar_early_time_invalid','事前取得時刻または発走時刻を確認できません。');
 if(!Array.isArray(d.horses)||d.horses.length<2)throw requestError('nar_early_horses_missing','出走馬データが不足しています。');
 const previous=state;
 try{
  state=transform(buildAbilityRoot(cloneData(d),date,track,raceNo));
  state.race.narSourceAcquiredAt=d.acquiredAt;
  makeSnapshot();
  return cloneData(state);
 }finally{state=previous}
}
async function acquireNarEarlyResearchRecord({raceId:requestedId,enabled=false}={}){
 if(enabled!==true)throw requestError('nar_early_disabled','研究取得は無効です。');
 const parts=String(requestedId||'').split('|'),[date,track,no]=parts,raceNo=Number(no),code=narCode(track);
 if(parts.length!==3||!code||!/^\d{4}-\d{2}-\d{2}$/.test(date)||! /^[1-9]\d?$/.test(no))throw requestError('nar_early_identity_invalid','研究レースIDが不正です。');
 const {data}=await fetchNarSyncApi(`/api/nar/race?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`,{attempts:1});
 const record=buildNarEarlyResearchRecord(data,{date,track,raceNo});
 // Local receipt is not authenticated proof; preserve the server source time.
 return {record,acquiredAt:data.acquiredAt,receivedAt:new Date().toISOString(),acquisitionKind:'fresh',sourceReceipt:{scope:'ALL_RUNNERS',raceId:requestedId,horseNos:data.horses.map(h=>Number(h.horseNo)),capturedAt:data.acquiredAt,sourceRef:`/api/nar/race?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`}};
}
function buildAbilityRoot(d,date,track,raceNo){
 const horses=Array.isArray(d.horses)?d.horses:[],ready=horses.filter(h=>Number.isFinite(Number(h.abilityWinRate))).length,wins=horses.map(h=>Number(h.abilityWinRate)||0),abilityMode=ready>=Math.max(2,Math.ceil(horses.length*.5));
 return {race:{category:'地方競馬',raceDate:date,track:d.track||track,raceNo,postTime:d.postTime||'',raceName:d.raceName||'',distance:d.distance||'',surface:d.surface||'ダート',weather:d.weather||'',trackCondition:d.trackCondition||'不明',chaos:d.chaos??50,pace:d.pace||'標準',bias:d.bias||'',oddsType:Array.isArray(d.odds)&&d.odds.length?'実オッズ':'オッズなし',oddsSnapshotType:d.oddsSnapshotType||(Array.isArray(d.odds)&&d.odds.length?'unknown':'none'),oddsUpdatedAt:Array.isArray(d.odds)&&d.odds.length?(d.acquiredAt||null):null,marketDataSource:Array.isArray(d.odds)&&d.odds.length?'NAR_OFFICIAL_PRE_ODDS':null,autoGenerated:true,dataSource:`NAR公式 Ver.${APP_VERSION}`,dataMode:abilityMode?'NAR自動・能力先行':'NAR自動・能力不足',autoModel:abilityMode?'NAR past-runs ability first + market second':'NAR past-runs insufficient; no market-as-ability fallback',predictedTimePolicy:'NAR公式の同距離・近距離実走TIMEから標準／展開ハマり／展開不利を推定'},horses:horses.map(h=>({horseNo:h.horseNo,horseName:h.horseName||`馬番${h.horseNo}`,popularity:h.popularity??null,realOdds:h.odds??null,runningStyle:h.runningStyle||'不明',weight:h.weight??null,jockey:h.jockey||'',trainer:h.trainer||'',sexAge:h.sexAge||'',runs:Array.isArray(h.runs)?cloneData(h.runs):[],transferOrigin:h.transferOrigin||'',previousOrganization:h.previousOrganization||'',transferStartNo:h.transferStartNo??null,restDays:h.restDays??null,startAfterBreak:h.startAfterBreak??null,debut:!!h.debut,timeIndex:h.timeIndex??null,fiveRaceAvgIndex:h.fiveRaceAvgIndex??null,distanceIndex:h.distanceIndex??null,courseIndex:h.courseIndex??null,recentIndex:Array.isArray(h.recentIndex)?h.recentIndex:[],abilityScore:h.abilityScore??null,features:h.features??null,abilityPriorOdds:h.abilityPriorOdds??null,predictedTime:h.predictedTime||'',predictedTimeType:h.predictedTimeType||'',predictedTimeMissingReason:h.predictedTimeMissingReason||null,predictedTimeConfidence:h.predictedTimeConfidence??null,predictedTimeScenarios:h.predictedTimeScenarios??null,aiWinRate:abilityMode?(h.abilityWinRate??null):null,aiPlaceRate:abilityMode&&Number.isFinite(Number(h.abilityWinRate))?abilityPlace(h.abilityWinRate,wins):null,dataMode:abilityMode?'NAR自動・能力先行':'NAR自動・能力不足',dataConfidence:h.dataConfidence??null,reason:h.reason||(abilityMode?'NAR公式過去走を能力側へ反映。実オッズは期待値判定のみで使用。':'解析可能な過去走が不足。市場を能力の代用には使用しません。')}))};
}
function predictionAvailability(horses=state.horses||[]){const total=horses.length,ability=horses.filter(h=>h.sourceAbilityAvailable===true||h.abilityScore!=null).length,time=horses.filter(h=>h.predictedTime).length,timeActual=horses.filter(h=>h.predictedTime&&h.predictedTimeType==='実績').length,timeAdjusted=horses.filter(h=>h.predictedTime&&h.predictedTimeType==='補正').length,market=horses.filter(h=>num(h.odds??h.realOdds)!=null).length,missingReasons={};for(const h of horses){if(h.predictedTime)continue;const code=h.predictedTimeMissingReason||'time_missing_unknown';missingReasons[code]=(missingReasons[code]||0)+1}return {total,ability,time,timeActual,timeAdjusted,timeMissing:Math.max(0,total-time),market,missingReasons}}
function normalizeResultFetchOutcome({primarySuccess=false,recoverySuccess=false,published=true,finishOrder=[]}={}){const complete=Array.isArray(finishOrder)&&finishOrder.length>=3;if((primarySuccess||recoverySuccess)&&complete)return {resultStatus:'success',resultOutcome:'success',resultFetchMode:primarySuccess?'primary':'recovery',finalStatus:primarySuccess?'success_primary':'success_recovery'};if(!published)return {resultStatus:'waiting',resultOutcome:'waiting',resultFetchMode:null,finalStatus:'result_waiting'};return {resultStatus:'retry',resultOutcome:'retry',resultFetchMode:null,finalStatus:'result_retry'}}
function postRaceFirstCheckAt(race={}){const date=String(race.raceDate||race.date||'').replaceAll('/','-'),time=String(race.postTime||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;const at=new Date(`${date}T${time}:00+09:00`);return Number.isFinite(at.getTime())?new Date(at.getTime()+10*60000).toISOString():null}
function resultFetchReadiness(race={},now=Date.now()){const date=String(race.raceDate||race.date||'').replaceAll('/','-'),time=String(race.postTime||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return {allowed:true,reason:'post_time_unknown',postTime:null};const post=new Date(`${date}T${time}:00+09:00`),postMs=post.getTime();if(!Number.isFinite(postMs))return {allowed:true,reason:'post_time_unknown',postTime:null};return {allowed:now>=postMs,reason:now>=postMs?'post_time_reached':'before_post_time',postTime:post.toISOString()}}
function autoResultEnabled(){return localStore.get(AUTO_RESULT_SETTING,true)!==false}
function registerResultWaiting(record,id=raceId(record?.race),now=new Date().toISOString()){
 if(!id||!record?.predictionSnapshot||(record?.resultSnapshot?.finishOrder||record?.result?.finishOrder||[]).length>=3)return record;
 const enabled=autoResultEnabled(),existing=record.resultQueue||{},nextCheckAt=existing.retryLimitReached||Number(existing.attempts)>=AUTO_RESULT_MAX_ATTEMPTS?null:existing.nextCheckAt||postRaceFirstCheckAt(record.race||record.predictionSnapshot?.race||{});
 record.resultQueue={schemaVersion:1,organization:raceTypeOf(record),raceId:id,raceDate:record.race?.raceDate||record.predictionSnapshot?.race?.raceDate||'',track:record.race?.track||record.predictionSnapshot?.race?.track||'',raceNo:Number(record.race?.raceNo||record.predictionSnapshot?.race?.raceNo)||null,postTime:record.race?.postTime||record.predictionSnapshot?.race?.postTime||'',modelVersion:record.predictionSnapshot?.modelVersion||record.modelVersion||APP_VERSION,predictionSaved:true,enabled,resultStatus:enabled?(existing.resultStatus||'waiting'):'paused',status:enabled?(existing.status||'result_waiting'):'paused',nextCheckAt,attempts:Number(existing.attempts)||0,retryLimitReached:existing.retryLimitReached===true||Number(existing.attempts)>=AUTO_RESULT_MAX_ATTEMPTS,createdAt:existing.createdAt||now,lastResultCheckAt:existing.lastResultCheckAt||null,lastResultError:existing.lastResultError||null,history:Array.isArray(existing.history)?existing.history.slice(-9):[]};
 return record;
}
function nextResultCheckAt(attempts,now=Date.now()){const index=Math.max(0,Math.min(AUTO_RESULT_RETRY_MINUTES.length-1,Number(attempts)-1));return new Date(now+AUTO_RESULT_RETRY_MINUTES[index]*60000).toISOString()}
function resultQueueRetryPatch(record,{kind='network',errorCode='network_error',now=Date.now()}={}){const attempts=(Number(record?.resultQueue?.attempts)||0)+1,exhausted=attempts>=AUTO_RESULT_MAX_ATTEMPTS,waiting=kind==='unpublished';return {status:waiting?'result_pending':'result_retry',resultStatus:waiting?'pending':'retry',attempts,nextCheckAt:exhausted?null:nextResultCheckAt(attempts,now),retryLimitReached:exhausted,lastResultError:errorCode}}
function resultQueueSummary(records=raceCache){const values=Object.values(records||{}),queued=values.map(x=>x?.resultQueue).filter(Boolean);return {waiting:queued.filter(q=>q.enabled!==false&&['result_waiting','result_pending'].includes(q.status)).length,retry:queued.filter(q=>q.enabled!==false&&q.status==='result_retry').length,done:queued.filter(q=>['result_fetched','validated'].includes(q.status)).length,paused:queued.filter(q=>q.enabled===false||q.status==='paused').length}}
function renderAutoResultQueue(){if(typeof document==='undefined')return;const s=resultQueueSummary();if($('autoResultWaiting'))$('autoResultWaiting').textContent=String(s.waiting);if($('autoResultDone'))$('autoResultDone').textContent=String(s.done);if($('autoResultRetry'))$('autoResultRetry').textContent=String(s.retry);if($('autoResultToggle'))$('autoResultToggle').checked=autoResultEnabled();if($('autoResultStatus'))$('autoResultStatus').textContent=autoResultRunInProgress?'結果確認中…':autoResultEnabled()?'発走時刻+10分から低頻度で確認':'自動回収は停止中';renderAutoResultDetails()}
function dueResultQueue(now=Date.now()){return Object.entries(raceCache).filter(([,record])=>{const q=record?.resultQueue;if(!q||q.enabled===false||!['result_waiting','result_pending','result_retry'].includes(q.status))return false;if((record?.resultSnapshot?.finishOrder||record?.result?.finishOrder||[]).length>=3)return false;return q.nextCheckAt&&Date.parse(q.nextCheckAt)<=now}).sort((a,b)=>Date.parse(a[1].resultQueue.nextCheckAt)-Date.parse(b[1].resultQueue.nextCheckAt))}
function updateQueuedRecord(id,record,patch,now=new Date().toISOString()){const q={...(record.resultQueue||{}),...patch,lastResultCheckAt:now,history:[...((record.resultQueue?.history)||[]).slice(-8),{checkedAt:now,status:patch.status||record.resultQueue?.status||'',attempt:patch.attempts??record.resultQueue?.attempts??0,errorCode:patch.lastResultError||null}]};const updated={...record,resultQueue:q,updatedAt:now};saveRaceRecord(id,updated);renderAutoResultQueue();return updated}
function autoResultSelectionMatches(id,record,selection={}){
 if(!selection||typeof selection!=='object'||Array.isArray(selection)||!record?.predictionSnapshot||cloudMergeBindingIssue(record,id)||activeRaceIdentity(record).raceId!==id)return false;
 const race=record.race||{},identity=activeRaceIdentity(record),model=String(record.predictionSnapshot.modelVersion||record.modelVersion||APP_VERSION);
 for(const key of ['raceId','organization','modelVersion'])if(selection[key]!=null&&String(selection[key])!==String({raceId:id,organization:identity.organization,modelVersion:model}[key]))return false;
 for(const key of ['date','raceDate'])if(selection[key]!=null&&selection[key]!==race.raceDate)return false;
 if(selection.track!=null&&selection.track!==race.track)return false;
 for(const key of ['race','raceNo'])if(selection[key]!=null&&(!['number','string'].includes(typeof selection[key])||String(selection[key]).trim()===''||Number(selection[key])!==Number(race.raceNo)))return false;
 return true;
}
function validAutoResultPayload(id,record,data){
 if(!autoResultSelectionMatches(id,record,data)||data?.ok===false||data?.resultSuccess===false||!Array.isArray(data?.finishOrder)||data.finishOrder.length<3)return false;
 if((record.resultSnapshot?.finishOrder||record.result?.finishOrder||[]).length>=3)return false;
 const known=new Set((record.predictionSnapshot.horses||[]).map(h=>Number(h.horseNo))),validNo=n=>['number','string'].includes(typeof n)&&String(n).trim()!==''&&Number.isInteger(Number(n))&&Number(n)>0&&known.has(Number(n));
 if(data.finishOrder.some(n=>!validNo(n))||new Set(data.finishOrder.map(Number)).size!==data.finishOrder.length)return false;
 if(data.results!=null&&(!Array.isArray(data.results)||data.results.some(h=>!h||!validNo(h.horseNo))||new Set(data.results.map(h=>Number(h.horseNo))).size!==data.results.length))return false;
 if(data.results?.length){const ranked=data.results.filter(h=>Number.isInteger(Number(h.position))&&Number(h.position)>0).sort((a,b)=>Number(a.position)-Number(b.position)).slice(0,3).map(h=>Number(h.horseNo));if(stableStringify(ranked)!==stableStringify(data.finishOrder.slice(0,3).map(Number)))return false;}
 if(data.acquiredAt!=null&&!Number.isFinite(Date.parse(data.acquiredAt)))return false;
 if(data.actualTimes!=null&&(typeof data.actualTimes!=='object'||Array.isArray(data.actualTimes)||Object.keys(data.actualTimes).some(n=>!validNo(n))))return false;
 return true;
}
function applyAutoFetchedResult(id,record,data,now=new Date().toISOString()){
 if(!validAutoResultPayload(id,record,data))return null;
 const finish=data.finishOrder.map(Number).slice(0,3);
 const next=cloneData(record),identity=activeRaceIdentity(next),actualTimes={...(next.actualTimes||{}),...(data.actualTimes||{})},source=identity.organization==='JRA'?'JRA公式 自動結果回収':'NAR公式 自動結果回収';next.result={finishOrder:finish,memo:next.result?.memo||'',autoDiagnosis:'',at:now,actualTimes,source,resultSource:identity.organization==='JRA'?'JRA_OFFICIAL':'NAR_OFFICIAL',autoSaved:true};next.actualTimes=actualTimes;next.resultSnapshot={schemaVersion:3,raceId:identity.raceId,organization:identity.organization,source,resultSource:identity.organization==='JRA'?'JRA_OFFICIAL':'NAR_OFFICIAL',fetchedAt:data.acquiredAt||now,parserVersion:data.parserVersion||null,finishOrder:finish,actualTimes,horses:Array.isArray(data.results)?data.results.map(x=>({...x,horseNo:Number(x.horseNo),position:x.position==null?null:Number(x.position)})):finish.map((horseNo,i)=>({position:i+1,positionText:String(i+1),horseNo})),weather:data.weather||data.resultMeta?.weather||'',trackCondition:data.trackCondition||data.resultMeta?.trackCondition||'',quality:data.quality||null,market:next.resultMarketSnapshot||null};next.predictionSaved=true;next.resultStatus='success';next.resultOutcome='success';next.resultFetchMode='auto';next.resultFetchedAt=data.acquiredAt||now;next.resultAcquiredAt=data.acquiredAt||now;next.validationCompleted=true;next.validated=true;const diagnostics=diagnosticsForRace(next);next.validationSnapshot={schemaVersion:3,raceId:identity.raceId,organization:identity.organization,modelVersion:next.predictionSnapshot?.modelVersion||next.modelVersion||APP_VERSION,generatedAt:now,finishOrder:finish,failures:diagnostics.failures,checks:diagnostics.checks,dataQuality:diagnostics.quality,automaticResultQueue:true};if(identity.organization==='JRA')next.validationSnapshot.jraCalibration=buildJraValidationMetrics(next);next.validationSnapshot.longshotScenario=longshotScenarioValidation(next);next.resultQueue={...(next.resultQueue||{}),status:'validated',resultStatus:'validated',nextCheckAt:null,retryLimitReached:false,lastResultCheckAt:now,lastResultError:null,completedAt:now,history:[...((next.resultQueue?.history)||[]).slice(-8),{checkedAt:now,status:'validated',attempt:next.resultQueue?.attempts||0,errorCode:null}]};next.updatedAt=now;return next
}
const applyAutoFetchedResultBase=applyAutoFetchedResult;
applyAutoFetchedResult=function(id,record,data,now=new Date().toISOString()){if(raceCache[id]&&stableStringify(raceCache[id])!==stableStringify(record))return null;const saved=applyAutoFetchedResultBase(id,cloneData(record),data,now);if(saved){const horses=saved.resultSnapshot?.horses||[],at=saved.resultSnapshot?.fetchedAt||now,jra=raceTypeOf(saved)==='JRA',source=jra?'JRA_RESULT':'NAR_RESULT';applyScratchStatuses(saved,horses,at,{source:`${source}_STATUS`});applyScratchStatuses(saved,horses.filter(h=>Number(h?.position??h?.finish)>0||!!h?.time||!!h?.actualTime||!!h?.cornerPositions),at,{source,resultAuthority:true});if(saved.validationSnapshot)saved.validationSnapshot.scratchEvaluation=buildScratchValidation(saved);saveRaceRecord(id,saved)}return saved};
async function runAutoResultQueue({limit=1,allowHistoricalBoundary=false,retryId=null}={}){
 if(autoResultRunInProgress)return retryId?{processed:0,busy:true}:autoResultRunInProgress;
 if(retryId&&!resultRetryAvailability(retryId,raceCache[retryId]).allowed)return {processed:0,deferred:1};
 if(!autoResultEnabled()||resultFetchInProgress||raceLoadController||liveOddsController||historyCollectorRunning&&!allowHistoricalBoundary)return {processed:0,busy:true};
 autoResultRunInProgress=(async()=>{
  let processed=0,completed=0,retry=0,deferred=0;renderAutoResultQueue();
  for(const [id,original] of (retryId?[[retryId,raceCache[retryId]]]:dueResultQueue().slice(0,limit))){
   if(resultFetchInProgress||raceLoadController||liveOddsController||!autoResultEnabled())break;
   const record=raceCache[id],q=record?.resultQueue;
   if(!record||stableStringify(record)!==stableStringify(original)||!q||q.enabled===false||!['result_waiting','result_pending','result_retry'].includes(q.status)||!autoResultSelectionMatches(id,record,q)){deferred++;continue;}
   const revision=stableStringify(record),unchanged=()=>autoResultEnabled()&&stableStringify(raceCache[id])===revision,jra=raceTypeOf(record)==='JRA',code=jra?null:narCode(q.track||record.race?.track);
   if(!jra&&!code){deferred++;continue;}
   processed++;
   try{
    const url=jra?`/api/jra/result?date=${encodeURIComponent(q.raceDate)}&track=${encodeURIComponent(q.track)}&race=${q.raceNo}`:`/api/nar/sync?code=${code}&date=${encodeURIComponent(q.raceDate)}&race=${q.raceNo}`,res=await fetchJsonSimple(url,{timeoutMs:12000}),data=res.data;
    if(!unchanged()){deferred++;continue;}
    if(Array.isArray(data?.finishOrder)&&data.finishOrder.length>=3){
     if(applyAutoFetchedResult(id,record,data))completed++;
     else{updateQueuedRecord(id,record,resultQueueRetryPatch(record,{errorCode:'AUTO_RESULT_INVALID'}));retry++;}
    }else{const malformed=data?.finishOrder!=null&&!Array.isArray(data.finishOrder);updateQueuedRecord(id,record,resultQueueRetryPatch(record,{kind:malformed?'network':'unpublished',errorCode:malformed?'AUTO_RESULT_INVALID':'result_unpublished'}));retry++;}
   }catch(error){
    if(!unchanged()){deferred++;continue;}
    const pending=['JRA_RESULT_UNPUBLISHED','JRA_RESULT_BEFORE_POST','result_unpublished'].includes(error?.code);
    updateQueuedRecord(id,record,resultQueueRetryPatch(record,{kind:pending?'unpublished':'network',errorCode:error?.code==='http_error'&&Number(error?.status)>=400&&Number(error?.status)<=599?`http_${Number(error.status)}`:error?.code||'network_error'}));retry++;
   }
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  return {processed,completed,retry,deferred};
 })().finally(()=>{autoResultRunInProgress=null;renderAutoResultQueue()});renderAutoResultQueue();return autoResultRunInProgress
}
function setAutoResult(on){localStore.set(AUTO_RESULT_SETTING,!!on);for(const [id,record] of Object.entries(raceCache)){const complete=(record?.resultSnapshot?.finishOrder||record?.result?.finishOrder||[]).length>=3;if(!record?.predictionSnapshot||complete)continue;registerResultWaiting(record,id);record.resultQueue.enabled=!!on;record.resultQueue.status=on?(record.resultQueue.lastResultError?'result_retry':'result_waiting'):'paused';record.resultQueue.resultStatus=on?'waiting':'paused';record.updatedAt=new Date().toISOString();saveRaceRecord(id,record)}renderAutoResultQueue();if(on)runAutoResultQueue().catch(()=>{})}
function startAutoResultScheduler(){if(autoResultTimer)clearInterval(autoResultTimer);autoResultTimer=setInterval(()=>runAutoResultQueue().catch(()=>{}),60000);renderAutoResultQueue();setTimeout(()=>runAutoResultQueue().catch(()=>{}),1500)}
function commitAutoRaceData(d,{date,track,raceNo,recovered=false}={}){if(!Array.isArray(d.horses)||d.horses.length<2)throw requestError('parser_error','出走馬データを取得できませんでした');activeRaceGeneration++;lastRaceFetchAudit=d.raceFetchAudit||null;renderRaceFetchDiagnostics();const root=buildAbilityRoot(d,date,track,raceNo),rid=raceId(root.race),db=store.get(KEY,{}),old=db[rid];state=mergeExisting(transform(root),old);fillRace(state.race);render();if(!state.finalSnapshot)makeSnapshot();state.predictionSaved=true;state.resultStatus=state.result?.finishOrder?.length>=3?'success':state.resultStatus||'waiting';state.validationCompleted=!!(state.validationCompleted||state.validated&&state.result?.finishOrder?.length>=3);registerResultWaiting(state,rid);persist(old?.validated||false);renderAutoResultQueue();const a=predictionAvailability(state.horses),invalidNames=d.quality?.invalidHorseNames??d.horses.filter(h=>!h.horseName||/^\d+(?:円)?$/.test(String(h.horseName))).length,timeExtra=a.timeMissing?`・${a.timeMissing}頭データ不足`:'',base=`Ver.${APP_VERSION}：公式取得成功｜NAR取得 ${a.total}/${a.total} ✅｜馬名異常 ${invalidNames}頭｜能力 ${a.ability}/${a.total} ${a.ability===a.total?'✅':'△'}｜TIME ${a.time}/${a.total} ${a.time===a.total?'✅':'△'}（実績${a.timeActual}・補正${a.timeAdjusted}${timeExtra}）｜市場 ${a.market}/${a.total} ${a.market===a.total?'✅':'△'}`;$('autoRaceBadge').textContent=`能力 ${a.ability}/${a.total}`;$('autoRaceStatus').textContent=`${base}｜予想保存済${recovered?'（診断復旧）':''}`;$('importStatus').textContent=`✓ Ver.${APP_VERSION} 自動生成：${state.horses.length}頭 / データ源 NAR公式 / Snapshot固定済`;return {base,ready:a.ability}}
const commitAutoRaceDataBase=commitAutoRaceData;
commitAutoRaceData=function(d,options={}){const result=commitAutoRaceDataBase(d,options),at=d?.acquiredAt||new Date().toISOString();applyScratchStatuses(state,d?.horses||[],at,{source:'NAR_RACE_CARD_CURRENT',authoritativeActive:true});const changes=currentMeetingChangesForRace(d);if(changes.length)applyScratchStatuses(state,changes,at,{source:'NAR_CHANGE_INFO'});predictionViewMode='original';if(state.scratchAudit){render();persist(existingValidated(raceId(state.race)))}return result};
async function loadAutoRace(){
 if(autoResultRunInProgress)await autoResultRunInProgress;
 const date=$('autoRaceDate')?.value,track=$('autoTrack')?.value,raceNo=Number($('autoRaceNo')?.value);
 const code=narCode(track);
 if(!date||!code||!raceNo){$('autoRaceStatus').textContent='日付・競馬場・レースを確認してください。';return}
 if(meetingSelectorState.date!==date||['idle','loading'].includes(meetingSelectorState.status))await refreshMeetingSelector(date);
 if(!meetingSelectionValid(date,track,raceNo)){$('autoRaceStatus').textContent=meetingSelectorState.status==='empty'?'この日は地方競馬開催がありません。':'選択した競馬場・レースは開催情報にありません。開催会場と実在レースを選択してください。';renderMeetingSelector();return}
 raceLoadController?.abort();liveOddsController?.abort();
 const controller=new AbortController(),generation=++raceLoadGeneration,requestedId=raceId({raceDate:date,track,raceNo});raceLoadController=controller;
 const isCurrent=()=>generation===raceLoadGeneration&&!controller.signal.aborted&&currentSelectionId()===requestedId;
 setButtonBusy('autoRaceLoad',true,'予想取得中…');
 $('autoRaceBadge').textContent='能力取得中';
 $('autoRaceStatus').textContent='NAR公式の過去走・同距離時計・距離/コース適性を解析しています…';
 try{
   const u=`/api/nar/race?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`;
   const apiFetch=await fetchNarSyncApi(u,{signal:controller.signal,attempts:1}),d=apiFetch.data;
   d.clientAttemptCount=apiFetch.clientAttemptCount;
   if(!isCurrent())throw requestError('stale_request','古いレース取得を破棄しました。');
   const committed=commitAutoRaceData(d,{date,track,raceNo});
   setTimeout(()=>{if(!isCurrent())return;syncNar({auto:true}).then(resultCheck=>{if(!isCurrent())return;const suffix=resultCheck?.complete?'｜公式結果・検証を自動保存':resultCheck?.pending?'｜結果待ち':resultCheck?.status==='retry'?'｜予想取得成功・結果確認のみ再試行可':'';$('autoRaceStatus').textContent=committed.base+suffix}).catch(()=>{if(isCurrent())$('autoRaceStatus').textContent=committed.base+'｜予想取得成功・結果確認のみ再試行可'})},800);
 }catch(e){
   if(e?.name==='AbortError'||e?.code==='stale_request'||e?.code==='aborted')return;
   if(!isCurrent())return;
   try{const diag=await fetchNarSyncApi(`/api/nar/race-diagnostic?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`,{signal:controller.signal,attempts:1}),d=diag.data;if(!isCurrent())return;const committed=commitAutoRaceData(d,{date,track,raceNo,recovered:true});$('autoRaceStatus').textContent=committed.base+'｜通常経路失敗後、診断復旧で予想保存済';setTimeout(()=>{if(isCurrent())syncNar({auto:true}).catch(()=>{})},800);return}catch(recoveryError){if(!isCurrent())return;lastRaceFetchAudit=recoveryError?.raceFetchAudit||null;renderRaceFetchDiagnostics();const hasSaved=state?.horses?.length>=2&&raceId(state.race)===requestedId;$('autoRaceBadge').textContent=hasSaved?'保存済み':'取得失敗';$('autoRaceStatus').textContent=hasSaved?`保存済み予想を表示中｜最新データ更新のみ失敗（${errorLabel(recoveryError)}）`:`取得エラー｜${errorLabel(recoveryError)} 予想済みデータは削除していません。`}
 }finally{
   if(generation===raceLoadGeneration){raceLoadController=null;setButtonBusy('autoRaceLoad',false);renderMeetingSelector()}
 }
}

async function importFile(f){
 const text=(await f.text()).replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let root;try{root=JSON.parse(text)}catch(e){throw new Error('JSON構文エラー: '+e.message)}
 previewCpsiFirst(root);
 if(root?.format==='CHASS_CPSI_PRE_INPUT_V1')return;
 if(typeof requestAnimationFrame==='function')await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
 let next=transform(root);fillRace(next.race);const rid=raceId(next.race);const db=store.get(KEY,{});const legacy=store.get(LEGACY_KEY,{});next=mergeExisting(next,db[rid]||legacy[rid]);state=next;render(); if(!state.finalSnapshot)makeSnapshot();
 state.predictionSaved=true;
 state.resultStatus=state.result?.finishOrder?.length>=3?'success':state.resultStatus||'waiting';
 state.validationCompleted=!!(state.validated&&state.result?.finishOrder?.length>=3);
 registerResultWaiting(state,rid);
 persist(existingValidated(rid));$('importStatus').textContent=`✓ Ver.${APP_VERSION}：${state.horses.length}頭読込 / AI勝率・TOP3率計算済 / TIME ${state.horses.filter(x=>x.predictedTime).length}頭 / ${state.race.oddsType}`;
}
function existingValidated(rid){
 const db=store.get(KEY,{}),legacy=store.get(LEGACY_KEY,{});
 return !!(db[rid]?.validated||legacy[rid]?.validated||state.result?.finishOrder?.length>=3);
}
function persistRecordIfChanged(rid,draft){
 const old=raceCache[rid]||store.get(KEY,{})[rid],changed=!old||researchContentFingerprint(old)!==researchContentFingerprint(draft),record={...draft,updatedAt:changed?new Date().toISOString():stableRecordUpdatedAt(old)};
 if(!changed){storageDiagnostic('unchangedPersist');storageDiagnostic('cacheHit');saveCurrentRace(rid);return {changed:false,raceId:rid,record:old}}
 saveRaceRecord(rid,record);saveCurrentRace(rid);return {changed:true,raceId:rid,record};
}
function persist(validated=false){
 state.race=raceFromForm();const rid=raceId(state.race);if(!rid)return;
 const db=store.get(KEY,{}),old=db[rid];
 if(!state.finalSnapshot&&state.horses.length)makeSnapshot();
 if(!state.validationCompleted)sealSnapshotIntegrity(state,true);
 const draft={...old,...state,validated:validated||old?.validated||false,modelVersion:state.predictionSnapshot?.modelVersion||state.modelVersion||APP_VERSION,predictionCreatedAt:state.predictionSnapshot?.createdAt||state.predictionSnapshot?.generatedAt||state.predictionCreatedAt||null,resultAcquiredAt:state.resultSnapshot?.fetchedAt||state.resultFetchedAt||state.resultAcquiredAt||null};
 return persistRecordIfChanged(rid,draft);
}
function currentPublicApiUrl(){const context=activeRaceContext();if(!context.hasPrediction)return null;const race=state.race,date=String(race.raceDate||race.date||'').replaceAll('/','-'),track=String(race.track||''),raceNo=Number(race.raceNo);if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!track||!Number.isInteger(raceNo))return null;const url=new URL('/api/chass/v1/public/race',window.location.origin);url.searchParams.set('date',date);url.searchParams.set('track',track);url.searchParams.set('race',String(raceNo));url.searchParams.set('organization',context.organization);url.searchParams.set('format','compact');return url.toString()}
function currentPublicDayApiUrl(){const context=activeRaceContext();if(!context.hasPrediction)return null;const race=state.race,date=String(race.raceDate||race.date||'').replaceAll('/','-'),track=String(race.track||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!track)return null;const url=new URL('/api/chass/v1/public/day-ai',window.location.origin);url.searchParams.set('date',date);url.searchParams.set('track',track);url.searchParams.set('organization',context.organization);url.searchParams.set('format','compact');return url.toString()}
async function checkPublicApi(){const status=$('publicApiStatus');if(status)status.textContent='接続確認中…';try{const response=await fetch('/api/chass/v1/public/health',{headers:{accept:'application/json'}}),body=await response.json();if(!response.ok||body?.ok!==true)throw Object.assign(new Error(body?.error?.code||`HTTP ${response.status}`),{status:response.status});const checkedAt=new Date().toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'});if(status)status.textContent=`接続正常｜Read-Only｜API v${body.apiVersion||'1'}｜最終確認 ${checkedAt}`}catch(error){if(status)status.textContent=`接続失敗｜${error?.status?`HTTP ${error.status}`:error?.message||'通信エラー'}`}}
async function copyCurrentPublicApiUrl(){const status=$('publicApiStatus'),url=currentPublicApiUrl();if(!url){if(status)status.textContent='現在レースを特定できません';return false}try{await navigator.clipboard.writeText(url);if(status)status.textContent='現在レースAPI URLをコピーしました';return true}catch{if(status)status.textContent='URLをコピーできませんでした';return false}}
async function copyCurrentPublicDayApiUrl(){const status=$('publicApiStatus'),url=currentPublicDayApiUrl();if(!url){if(status)status.textContent='現在の開催日・競馬場を特定できません';return false}try{await navigator.clipboard.writeText(url);if(status)status.textContent='1日一括API URLをコピーしました';return true}catch{if(status)status.textContent='URLをコピーできませんでした';return false}}
function narCode(track){return NAR_TRACKS[track]||null}
function assertJraMarketIdentity(items=[]){
 if(raceTypeOf(state)!=='JRA')return true;
 const active=(state.horses||[]).filter(isEligibleHorse);
 const stateNos=active.map(h=>Number(h.horseNo));
 const officialNos=(items||[]).map(x=>Number(x?.horseNo)).filter(Number.isFinite);
 const duplicateState=stateNos.some((n,i)=>stateNos.indexOf(n)!==i);
 const duplicateOfficial=officialNos.some((n,i)=>officialNos.indexOf(n)!==i);
 const missingInState=officialNos.filter(n=>!stateNos.includes(n));
 if(duplicateState||duplicateOfficial||missingInState.length){
   const error=new Error(`JRA_HORSE_IDENTITY_MISMATCH:state=${stateNos.join(',')}:official=${officialNos.join(',')}`);
   error.code='JRA_HORSE_IDENTITY_MISMATCH';
   throw error;
 }
 return true;
}
function applyMarketOdds(items, acquiredAt, options={}){
 if(!Array.isArray(items)||!items.length)return 0;
 assertJraMarketIdentity(items);
 const valid=items.map(x=>({horseNo:String(x.horseNo),odds:num(x.odds),popularity:num(x.popularity)})).filter(x=>x.horseNo&&x.odds!=null);
 const pop=[...valid].sort((a,b)=>a.odds-b.odds),popMap=new Map(pop.map((x,i)=>[x.horseNo,x.popularity??i+1])),map=new Map(valid.map(x=>[x.horseNo,x.odds]));
 const eligible=state.horses.filter(isEligibleHorse),totalHorseCount=eligible.length,oddsHorseCount=valid.filter(x=>eligible.some(h=>String(h.horseNo)===x.horseNo)).length,oddsCoverage=totalHorseCount?Number((oddsHorseCount/totalHorseCount).toFixed(4)):0,evRankStatus=oddsHorseCount===0?'unavailable':oddsHorseCount===totalHorseCount?'complete':'partial';
 const normalized=valid.map(x=>({horseNo:Number(x.horseNo),odds:x.odds,popularity:popMap.get(x.horseNo)||null})),signature=list=>JSON.stringify((list||[]).map(x=>[Number(x.horseNo),num(x.odds),num(x.popularity)]).sort((a,b)=>a[0]-b[0])),previous=state.validationCompleted?state.resultMarketSnapshot?.horses:state.marketSnapshot?.horses,basisSignature=marketPredictionBasisSignature(state.horses),previousBasisSignature=state.validationCompleted?state.resultMarketSnapshot?.predictionBasisSignature:state.marketSnapshot?.predictionBasisSignature;
 state.oddsLastCheckedAt=acquiredAt||new Date().toISOString();state.lastOddsApplyChanged=signature(previous)!==signature(normalized)||previousBasisSignature!==basisSignature||(!state.validationCompleted&&!state.marketSnapshot?.marketDataSource);
 if(!state.lastOddsApplyChanged){storageDiagnostic('cacheHit');return valid.length}
 const marketDataSource=options.marketDataSource||'OddsTanFuku',snapshotType=options.oddsSnapshotType||'live';
 if(state.validationCompleted){state.resultMarketSnapshot={schemaVersion:2,createdAt:state.oddsLastCheckedAt,oddsSnapshotType:snapshotType,marketDataSource,marketDataAvailable:oddsHorseCount>0,oddsHorseCount,totalHorseCount,oddsCoverage,evRankStatus,horses:normalized};persist(true);return valid.length}
 state.horses.forEach(h=>{const k=String(h.horseNo),o=map.get(k);if(o!=null){h.odds=o;h.popularity=popMap.get(k)||null;}else if(isEligibleHorse(h)){h.odds=null;h.popularity=null;}});
 const previousSignal=state.marketSnapshot?.signalSnapshot||null,preserveSignal=previousSignal?.status==='frozen'?previousSignal:null;reconcileMarketDerivedValues(state.horses,state.race,preserveSignal); state.race.oddsType='実オッズ';state.race.oddsSnapshotType=snapshotType; state.race.oddsUpdatedAt=state.oddsLastCheckedAt;state.race.oddsChangedAt=state.oddsLastCheckedAt;state.race.marketDerivedVersion='MDV-2';
 state.race.marketDataSource=marketDataSource;state.race.marketDataAvailable=oddsHorseCount>0;state.race.oddsHorseCount=oddsHorseCount;state.race.totalHorseCount=totalHorseCount;state.race.oddsCoverage=oddsCoverage;state.race.evRankStatus=evRankStatus;
 if(!state.validationCompleted){const signalSnapshot=preserveSignal||resolveSignalSnapshot(state,state.race.oddsUpdatedAt);state.marketSnapshot={schemaVersion:2,modelVersion:APP_VERSION,acquiredAt:state.race.oddsUpdatedAt,createdAt:state.race.oddsUpdatedAt,oddsSnapshotType:snapshotType,marketDataSource,marketDataAvailable:oddsHorseCount>0,oddsHorseCount,totalHorseCount,oddsCoverage,evRankStatus,marketDerivedVersion:'MDV-2',predictionBasisSignature:basisSignature,signalSnapshot:cloneData(signalSnapshot),horses:state.horses.map(marketHorse)};applyFrozenSignalSnapshot(state.horses,signalSnapshot)}
 makeSnapshot();
 const rid=raceId(state.race);
 if(rid){
   const history=[...(store.get(ODDS_HISTORY,{})[rid]||[])],previousHistory=history.at(-1);
   if(history.length<24&&(!previousHistory||signature(previousHistory.odds)!==signature(normalized)))history.push({at:state.race.oddsUpdatedAt,odds:normalized});
   saveOddsHistory(rid,history);
 }
 return valid.length;
}
function preOddsStats(record=state){
 const eligible=(record?.horses||[]).filter(isEligibleHorse),totalHorseCount=eligible.length,oddsHorseCount=eligible.filter(h=>num(h?.odds??h?.realOdds)!=null).length;
 return {totalHorseCount,oddsHorseCount,oddsCoverage:totalHorseCount?Number((oddsHorseCount/totalHorseCount).toFixed(4)):0,complete:totalHorseCount>0&&oddsHorseCount===totalHorseCount};
}
function preOddsFrozen(record=state){return record?.marketSnapshot?.marketPolicyVersion===PREODDS_POLICY_VERSION&&record?.marketSnapshot?.preOddsFrozen===true}
function preOddsStamp(record=state,{acquiredAt=null,sourceOddsSnapshotType=null}={}){
 if(!record||record.validationCompleted)return false;
 const market=record.marketSnapshot;if(!market)return false;
 const stats=preOddsStats(record),hasAny=stats.oddsHorseCount>0,at=acquiredAt||market.acquiredAt||record.race?.oddsUpdatedAt||new Date().toISOString(),alreadyFrozen=preOddsFrozen(record);
 market.marketPolicyVersion=PREODDS_POLICY_VERSION;market.marketRole=PREODDS_MARKET_ROLE;market.sourceOddsSnapshotType=sourceOddsSnapshotType||market.sourceOddsSnapshotType||market.oddsSnapshotType||null;
 market.oddsHorseCount=stats.oddsHorseCount;market.totalHorseCount=stats.totalHorseCount;market.oddsCoverage=stats.oddsCoverage;market.evRankStatus=!hasAny?'unavailable':stats.complete?'complete':'partial';
 market.preOddsFrozen=alreadyFrozen||stats.complete;market.preOddsFrozenAt=market.preOddsFrozen?(market.preOddsFrozenAt||at):null;market.preOddsStatus=market.preOddsFrozen?'frozen':hasAny?'provisional':'unavailable';
 record.race=record.race||{};record.race.marketPolicyVersion=PREODDS_POLICY_VERSION;record.race.marketRole=PREODDS_MARKET_ROLE;record.race.preOddsStatus=market.preOddsStatus;record.race.oddsType=market.preOddsFrozen?'事前オッズ（固定）':hasAny?'事前オッズ（暫定）':'オッズなし';
 record.race.oddsHorseCount=stats.oddsHorseCount;record.race.totalHorseCount=stats.totalHorseCount;record.race.oddsCoverage=stats.oddsCoverage;record.race.evRankStatus=market.evRankStatus;
 if(hasAny){record.race.oddsUpdatedAt=market.preOddsFrozenAt||at;record.race.marketDataAvailable=true}else record.race.marketDataAvailable=false;
 sealSnapshotIntegrity(record,true);
 return market.preOddsFrozen;
}
function preOddsFallbackTargetMs(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;
 const target=Date.parse(`${date}T00:30:00.000Z`);
 return Number.isFinite(target)?target:null;
}
function schedulePreOddsFallback(record=state){
 if(preOddsFallbackTimer){clearTimeout(preOddsFallbackTimer);preOddsFallbackTimer=null}
 if(!record||record.validationCompleted||preOddsFrozen(record))return false;
 const target=preOddsFallbackTargetMs(record?.race?.raceDate),delay=target==null?null:target-Date.now();
 if(delay==null||delay<=0||delay>36*60*60_000)return false;
 preOddsFallbackTimer=setTimeout(async()=>{
  preOddsFallbackTimer=null;
  if(state.validationCompleted||preOddsFrozen(state))return;
  state.race.preOddsFallbackAttemptedAt=new Date().toISOString();
  try{await syncLiveOdds(true)}catch{}
  try{persist(existingValidated(raceId(state.race)))}catch{}
 },delay);
 return true;
}
const makeSnapshotPreOddsBase=makeSnapshot;
makeSnapshot=function(...args){
 const sourceType=state?.race?.oddsSnapshotType||null,value=makeSnapshotPreOddsBase(...args);
 if(!state.validationCompleted)preOddsStamp(state,{acquiredAt:state?.marketSnapshot?.acquiredAt||state?.race?.oddsUpdatedAt||null,sourceOddsSnapshotType:sourceType});
 schedulePreOddsFallback(state);
 return value;
};
const applyMarketOddsBase=applyMarketOdds;
applyMarketOdds=function(items,acquiredAt,options={}){
 if(!state.validationCompleted&&preOddsFrozen(state)&&options?.forcePreOddsRefresh!==true){
  state.oddsLastCheckedAt=acquiredAt||new Date().toISOString();state.lastOddsApplyChanged=false;
  return Number(state.marketSnapshot?.oddsHorseCount)||0;
 }
 const sourceOddsSnapshotType=options?.oddsSnapshotType||null,count=applyMarketOddsBase(items,acquiredAt,options);
 if(!state.validationCompleted&&count)preOddsStamp(state,{acquiredAt,sourceOddsSnapshotType});
 return count;
};
async function syncLiveOdds(silent=false){
 if(!state.validationCompleted&&preOddsFrozen(state)){
  if($('liveOddsStatus'))$('liveOddsStatus').textContent='事前オッズは固定済みです。現在オッズはチャス側のLive Assessmentで確認します。';
  return {ok:true,status:'pre_odds_frozen',marketPolicyVersion:PREODDS_POLICY_VERSION};
 }
 if(raceTypeOf(state)==='JRA'){
  return jraOddsClient?.load()||{ok:false,status:'jra_odds_unavailable'};
 }
 if(autoResultRunInProgress)await autoResultRunInProgress;
 const r=raceFromForm(),code=narCode(r.track);if(!code){$('liveOddsStatus').textContent='現在オッズ自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('liveOddsStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 liveOddsController?.abort();const controller=new AbortController(),generation=++liveOddsGeneration,requestedId=raceId(r);liveOddsController=controller;
 const isCurrent=()=>generation===liveOddsGeneration&&!controller.signal.aborted&&raceId(raceFromForm())===requestedId;
 if(!silent)setButtonBusy('liveOddsSync',true,'オッズ取得中…');
 if(!silent)$('liveOddsStatus').textContent='NAR公式の事前オッズを1回確認中…';
 try{
   storageDiagnostic('oddsFetch');storageDiagnostic('externalFetch');const u=`/api/nar/odds?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`,res=await fetch(u,{cache:'no-store',signal:controller.signal}),d=await responseJson(res);
   if(!res.ok)throw requestError(d.errorCode||'nar_temporary',d.error||'取得失敗',res.status);if(!isCurrent())throw requestError('stale_request','古いオッズ取得を破棄しました。');
   const count=applyMarketOdds(d.odds,d.acquiredAt);if(!count)throw requestError('odds_unpublished','現在オッズはまだ公開されていません。');
   render();persist(existingValidated(raceId(r)));const changed=state.lastOddsApplyChanged,t=new Date(changed?state.race.oddsUpdatedAt:state.oddsLastCheckedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});renderMarketDisplayState();$('liveOddsStatus').textContent=preOddsFrozen(state)?`NAR公式 事前オッズ ${count}頭を固定｜${t}｜以後アプリでは追跡しません`:`NAR公式 事前オッズ ${count}頭を暫定反映｜${t}｜全頭揃うまで固定待ち`;
 }catch(e){if(e?.name==='AbortError'||e?.code==='stale_request'||!isCurrent())return;renderMarketDisplayState();$('liveOddsStatus').textContent=e?.code==='odds_unpublished'?'現在オッズはまだ公開されていません。':`取得エラー｜${errorLabel(e)}`}
 finally{if(generation===liveOddsGeneration){liveOddsController=null;if(!silent)setButtonBusy('liveOddsSync',false)}}
}
function setAutoOdds(){if(oddsTimer){clearInterval(oddsTimer);oddsTimer=null}if($('autoOdds')){$('autoOdds').checked=false;$('autoOdds').disabled=true}if($('autoOddsState')){$('autoOddsState').textContent='固定運用';$('autoOddsState').classList.remove('is-on')}}

function saveFetchedResult(finishOrder,{silent=true,source='NAR公式自動保存',resultData=null,onStage=null}={}){
 const stage=name=>{if(typeof onStage==='function')onStage(name)};
 stage('validate_result');
 const f=(finishOrder||[]).map(num).filter(x=>x!=null).slice(0,3);
 if(f.length<3)return false;
 $('finish1').value=f[0];$('finish2').value=f[1];$('finish3').value=f[2];
 stage('freeze_snapshot');
 if(!state.finalSnapshot)makeSnapshot();
 stage('build_result');
 const tmp={...state,result:{finishOrder:f,actualTimes:{...state.actualTimes}}};
 const autoReasons=failureReasonsForRace(tmp).map(x=>x.label).join(' / ');
 state.result={
   finishOrder:f,
   memo:$('memo').value,
   autoDiagnosis:autoReasons,
   at:new Date().toISOString(),
   actualTimes:{...state.actualTimes},
   source,resultSource:source==='手動修正保存'?'manual':'official',verificationSource:'none',verificationStatus:'unverified',
   autoSaved:true
 };
 const identity=activeRaceIdentity();
 state.resultSnapshot={
   schemaVersion:3,
   raceId:identity.raceId,
   organization:identity.organization,
   source,
   fetchedAt:resultData?.acquiredAt||new Date().toISOString(),
   finishOrder:(resultData?.finishOrder||f).map(Number).filter(Number.isFinite),
   actualTimes:{...state.actualTimes},
   horses:Array.isArray(resultData?.results)?resultData.results.map(x=>({...x,horseNo:Number(x.horseNo),position:x.position==null?null:Number(x.position)})):f.map((horseNo,i)=>({position:i+1,positionText:String(i+1),horseNo})),
   weather:resultData?.resultMeta?.weather||'',
   trackCondition:resultData?.resultMeta?.trackCondition||'',
   predictionWeather:state.predictionSnapshot?.race?.weather||state.race?.weather||'',
   predictionTrackCondition:state.predictionSnapshot?.race?.trackCondition||state.race?.trackCondition||'',
   actualWeather:resultData?.resultMeta?.weather||'',
   actualTrackCondition:resultData?.resultMeta?.trackCondition||'',
   resultSource:source==='手動修正保存'?'manual':'official',verificationSource:'none',verificationStatus:'unverified',
   quality:resultData?.quality||null,
   market:state.resultMarketSnapshot||null
 };
 state.predictionSaved=true;
 state.resultStatus='success';state.resultOutcome='success';state.resultFetchMode=source.includes('診断')?'recovery':'primary';
 state.resultErrorType=null;
 state.resultFetchError='';
 state.resultFetchedAt=new Date().toISOString();
 state.validationCompleted=true;
 state.validated=true;
 state.resultQueue={...(state.resultQueue||{}),status:'validated',resultStatus:'validated',nextCheckAt:null,lastResultCheckAt:new Date().toISOString(),lastResultError:null,completedAt:new Date().toISOString()};
 stage('build_validation');
 const diagnostics=diagnosticsForRace(state);
 state.validationSnapshot={schemaVersion:3,raceId:identity.raceId,organization:identity.organization,modelVersion:state.predictionSnapshot?.modelVersion||APP_VERSION,generatedAt:new Date().toISOString(),finishOrder:[...state.resultSnapshot.finishOrder],failures:diagnostics.failures,checks:diagnostics.checks,dataQuality:diagnostics.quality,jraCalibration:raceTypeOf(state)==='JRA'?buildJraValidationMetrics(state):null};
 state.validationSnapshot.longshotScenario=longshotScenarioValidation(state);
 stage('persist');
 persist(true);
 stage('render_result');
 renderResultDisplayState();
 renderValidationSummary();
 stage('render_dashboard');
 renderDashboard();
 stage('complete');
 if(!silent)alert('検証結果を保存しました。');
 return true;
}

const saveFetchedResultBase=saveFetchedResult;
saveFetchedResult=function(finishOrder,options={}){const ok=saveFetchedResultBase(finishOrder,options);if(ok){const horses=state.resultSnapshot?.horses||[],at=state.resultSnapshot?.fetchedAt||new Date().toISOString(),jra=raceTypeOf(state)==='JRA',source=jra?'JRA_RESULT':'NAR_RESULT';applyScratchStatuses(state,horses,at,{source:`${source}_STATUS`});applyScratchStatuses(state,horses.filter(h=>Number(h?.position??h?.finish)>0||!!h?.time||!!h?.actualTime||!!h?.cornerPositions),at,{source,resultAuthority:true});if(state.validationSnapshot)state.validationSnapshot.scratchEvaluation=buildScratchValidation(state);persist(true)}return ok};
function syncNar(options={}){
 if(options instanceof Event)options={};
 if(raceTypeOf(state)==='JRA'){
  return jraResultClient?.load()||Promise.resolve({complete:false,pending:false,status:'jra_result_unavailable'});
 }
 if(autoResultRunInProgress)return autoResultRunInProgress.then(()=>syncNar(options));
 if(resultFetchInProgress)return resultFetchInProgress;
 const context=activeRaceContext();
 if(!context.hasPrediction){if($('narStatus'))$('narStatus').textContent='現在レースの予想データがありません。';return Promise.resolve({complete:false,pending:false,status:'prediction_missing'})}
 const r={...state.race},flight={raceId:context.raceId,organization:context.organization,generation:activeRaceGeneration,race:r,priority:options.auto?'auto':'manual',startedMs:Date.now()};
 const readiness=resultFetchReadiness(r);
 if(!readiness.allowed){state.resultStatus='waiting';registerResultWaiting(state,flight.raceId);if($('narStatus'))$('narStatus').textContent=`発走前のため結果取得を行いません。発走 ${r.postTime}（結果は発走後に確認）`;renderResultDisplayState();return Promise.resolve({complete:false,pending:true,status:'before_post_time',postTime:readiness.postTime})}
 resultFetchInProgress=performResultFetch(options,flight).finally(()=>{resultFetchInProgress=null;setButtonBusy('narSync',false);renderResultDisplayState()});
 return resultFetchInProgress;
}
async function performResultFetch(options={},flight){
 const auto=!!options.auto;
 const r=flight.race,code=narCode(r.track);if(!code){$('narStatus').textContent='NAR自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('narStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 const requestedId=flight.raceId;
 const isCurrent=()=>activeRequestMatches(flight);
 const u=`/api/nar/sync?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`;
 if(!state.result?.finishOrder?.length){state.resultStatus='fetching';renderResultDisplayState()}
 setButtonBusy('narSync',true,'結果取得中…');
 $('narStatus').textContent='NAR公式から結果本体を取得中…';
 try{
   // 結果を参照する前に予想時点の値を固定する。結果データから予想を再計算しない。
   if(!state.predictionSnapshot||!state.finalSnapshot){makeSnapshot();state.predictionSaved=true;persist(false)}
   const apiFetch=await fetchJsonSimple(u,{timeoutMs:10000}),res=apiFetch.res,d=apiFetch.data;
   d.resultMeta={weather:d.weather||'',trackCondition:d.trackCondition||''};
   if(!isCurrent())throw requestError('stale_request','古い結果取得を破棄しました。');

   if(d.actualTimes&&typeof d.actualTimes==='object'){
     state.actualTimes={...state.actualTimes,...d.actualTimes};
     state.horses.forEach(h=>{
       const t=state.actualTimes[String(h.horseNo)];
       if(t)h.actualTime=t;
     });
   }
   if(Array.isArray(d.odds)&&d.odds.length){
     // 結果確認時点のオッズは予想用 horses / marketSnapshot へ上書きしない。
     state.resultMarketSnapshot={
       createdAt:d.acquiredAt||new Date().toISOString(),
       oddsSnapshotType:d.oddsSnapshotType||'unknown',
       horses:d.odds.map(x=>({horseNo:Number(x.horseNo),odds:num(x.odds),popularity:num(x.popularity)}))
     };
   }

   const complete=Array.isArray(d.finishOrder)&&d.finishOrder.length>=3;
   const alreadyComplete=(state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).length>=3;
   state.resultFetchCheckedAt=new Date().toISOString();
   state.resultFetchAudit={raceId:flight.raceId,organization:flight.organization,resultFetchSuccess:complete,primarySyncAudit:{success:complete,stage:complete?'parse_complete':'result_rows_insufficient',httpStatus:res.status,route:'/api/nar/sync',parsedRows:d.results?.length||0,finishOrder:d.finishOrder?.slice(0,3)||[],attemptCount:1,errorCode:null},recoveryAudit:null,postFetchAudit:{success:null,stage:'not_started'},checkedAt:state.resultFetchCheckedAt};
   state.resultFetchError='';state.resultErrorType='';
   if(complete){
     Object.assign(state,normalizeResultFetchOutcome({primarySuccess:true,finishOrder:d.finishOrder}));
     state.resultFetchAudit={...state.resultFetchAudit,finalStatus:'success_primary'};
     // API取得成功と保存・再描画を分離する。後段で例外が起きても取得成功を失敗扱いへ戻さない。
     let postFetchStage='save_start';
     try{
       saveFetchedResult(d.finishOrder,{silent:true,source:'NAR公式取得時に自動保存',resultData:d,onStage:stage=>{postFetchStage=stage;state.resultFetchAudit={...state.resultFetchAudit,postFetchAudit:{success:null,stage}}}});
       state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:true,stage:'complete',persist:'success',cloud:'pending',validation:'success',render:'success'}};
     }catch(saveError){
       const message=String(saveError?.message||saveError).slice(0,180);
       state.resultStatus='success';state.resultOutcome='success';state.resultFetchMode='primary';
       state.resultErrorType=null;
       state.resultFetchError='';
       const postCode=postFetchStage==='persist'?'persist_failed':postFetchStage==='build_validation'?'validation_failed':postFetchStage.startsWith('render')?'render_failed':'response_build_failed';state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:false,stage:postFetchStage,errorCode:postCode,message}};
       // 少なくとも取得済み着順は保持する。saveFetchedResultが途中まで進んでいればその内容を尊重する。
       if(!(state.resultSnapshot?.finishOrder||[]).length){
         state.result={finishOrder:d.finishOrder.slice(0,3).map(Number),memo:$('memo')?.value||'',autoDiagnosis:'',at:new Date().toISOString(),actualTimes:{...state.actualTimes},source:'NAR公式取得（後段エラー）',autoSaved:true};
         state.resultSnapshot={schemaVersion:3,raceId:flight.raceId,organization:flight.organization,source:'NAR公式取得（後段エラー）',fetchedAt:d.acquiredAt||new Date().toISOString(),finishOrder:d.finishOrder.slice(0,3).map(Number),actualTimes:{...state.actualTimes},horses:Array.isArray(d.results)?d.results:[],weather:d.resultMeta?.weather||'',trackCondition:d.resultMeta?.trackCondition||'',quality:d.quality||null,market:state.resultMarketSnapshot||null};
       }
       state.predictionSaved=true;state.resultFetchedAt=d.acquiredAt||new Date().toISOString();
       try{persist(existingValidated(raceId(r)))}catch{}
       try{renderResultDisplayState()}catch{}
       try{renderResultDiagnostics()}catch{}
       $('narStatus').textContent=`結果取得成功：${d.finishOrder.slice(0,3).join('-')}｜保存・再集計の後段処理でエラー（${postFetchStage}）｜取得結果は保持しています。`;
       return {complete:true,pending:false,status:'success',resultFetchMode:'primary',data:d,postFetchError:saveError,postFetchStage};
     }
   }else{
     state.predictionSaved=true;
     if(alreadyComplete){state.resultStatus='success';state.resultOutcome='success'}else Object.assign(state,normalizeResultFetchOutcome({published:false}));
     state.resultErrorType='result_unpublished';
     state.validationCompleted=alreadyComplete||false;
     if(!alreadyComplete){registerResultWaiting(state,requestedId);state.resultQueue={...state.resultQueue,...resultQueueRetryPatch(state,{kind:'unpublished',errorCode:'result_unpublished'}),lastResultCheckAt:new Date().toISOString()}}
     persist(existingValidated(raceId(r)));
   }

   render();
   const base=`NAR公式反映：着順 ${d.finishOrder?.slice(0,3).join('-')||'未確定'} / 全馬結果 ${d.results?.length||0}頭 / 実走TIME ${Object.keys(d.actualTimes||{}).length}頭`;
   const qualityWarning=complete&&d.quality&&(d.quality.actualTimeRate<70||d.quality.resultParseRate<100)?' / データ要確認':'';
   $('narStatus').textContent=complete
     ? `${base} / 検証結果まで自動保存済み${d.fallbackUsed?' / 予備経路で取得':''}${d.partialSuccess?' / 付随データ一部未取得':''}${qualityWarning}`
     : alreadyComplete?`${base} / 保存済みの検証結果は維持しました`:`結果待ち｜公式結果はまだ公開されていません。予想は保存済みです。`;
   return {complete:complete||alreadyComplete,pending:!complete&&!alreadyComplete,status:complete||alreadyComplete?'success':'waiting',resultFetchMode:complete?'primary':null,data:d};
  }catch(e){
   if(e?.code==='aborted'||e?.code==='stale_request')return {complete:false,pending:false,status:'cancelled'};
   if(!isCurrent())return {complete:false,pending:false,status:'cancelled'};
   state.predictionSaved=!!(state.predictionSaved||state.predictionSnapshot);
   const alreadyComplete=(state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).length>=3;
   state.resultStatus=alreadyComplete?'success':'retry';state.resultOutcome=alreadyComplete?'success':'retry';
   state.resultErrorType=e?.code||(e instanceof TypeError?'fetch_failed':'post_process_failed');
   state.resultFetchError=String(e.message||e);
   state.resultFetchCheckedAt=new Date().toISOString();
   state.resultFetchAudit={raceId:flight.raceId,organization:flight.organization,resultFetchSuccess:false,primarySyncAudit:{success:false,stage:e?.stage||'api_fetch',errorCode:state.resultErrorType,errorName:e?.name||'',errorMessage:String(e?.message||e).slice(0,180),httpStatus:e?.status||null,route:'/api/nar/sync',attemptCount:1},recoveryAudit:null,postFetchAudit:{success:null,stage:'not_started'},checkedAt:state.resultFetchCheckedAt};
   const recoveryStarted=Date.now();const diag=await fetchResultDiagnostic(r);flight.recoveryMs=Date.now()-recoveryStarted;
   if(!isCurrent())return {complete:false,pending:false,status:'cancelled'};
   if(diag){
     state.resultFetchAudit={...state.resultFetchAudit,recoveryAudit:{success:!!(diag.ok&&diag.resultSuccess),stage:diag.stage||(diag.ok?'diagnostic_received':'diagnostic_failed'),errorCode:diag.errorCode||null,httpStatus:diag.httpStatus??null,route:diag.urlType||'RaceMarkTable',parsedRows:diag.results?.length||0,finishOrder:diag.finishOrder?.slice(0,3)||[]},diagnosticCheckedAt:diag.checkedAt||new Date().toISOString()};
     // Ver.9.9.17: the diagnostic endpoint uses the same official RaceMarkTable parser.
     // If it proves HTTP+parse success and returns a complete finish order, promote that
     // result to authoritative success instead of leaving the UI as a primary-fetch failure.
     const recoveredOrder=Array.isArray(diag.finishOrder)?diag.finishOrder.map(Number).filter(Number.isFinite).slice(0,3):[];
     if(diag.ok&&recoveredOrder.length>=3){
       const recoveredData={...diag,finishOrder:recoveredOrder,results:Array.isArray(diag.results)?diag.results:[],actualTimes:diag.actualTimes&&typeof diag.actualTimes==='object'?diag.actualTimes:{},resultMeta:diag.resultMeta||{},quality:diag.quality||null,acquiredAt:diag.checkedAt||new Date().toISOString(),source:'NAR公式 診断経路復旧'};
       if(recoveredData.actualTimes&&typeof recoveredData.actualTimes==='object'){
         state.actualTimes={...state.actualTimes,...recoveredData.actualTimes};
         state.horses.forEach(h=>{const t=state.actualTimes[String(h.horseNo)];if(t)h.actualTime=t});
       }
       state.resultFetchCheckedAt=new Date().toISOString();
       state.resultFetchAudit={...state.resultFetchAudit,finalStatus:'success_recovery',resultFetchSuccess:true,recoveryAudit:{success:true,stage:'diagnostic_recovery_complete',errorCode:null,httpStatus:diag.httpStatus??200,route:diag.urlType||'RaceMarkTable',parsedRows:diag.results?.length||0,finishOrder:recoveredOrder,recoveryMs:flight.recoveryMs},postFetchAudit:{success:null,stage:'not_started'},diagnosticCheckedAt:diag.checkedAt||state.resultFetchCheckedAt};
       state.resultErrorType=null;state.resultFetchError='';Object.assign(state,normalizeResultFetchOutcome({recoverySuccess:true,finishOrder:recoveredOrder}));
       let postFetchStage='save_start';
       try{
         saveFetchedResult(recoveredOrder,{silent:true,source:'NAR公式 診断経路復旧',resultData:recoveredData,onStage:stage=>{postFetchStage=stage;state.resultFetchAudit={...state.resultFetchAudit,postFetchAudit:{success:null,stage}}}});
         state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:true,stage:'complete',persist:'success',cloud:'pending',validation:'success',render:'success'}};
       }catch(saveError){
         const postCode=postFetchStage==='persist'?'persist_failed':postFetchStage==='build_validation'?'validation_failed':postFetchStage.startsWith('render')?'render_failed':'response_build_failed';state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:false,stage:postFetchStage,errorCode:postCode,message:String(saveError?.message||saveError).slice(0,180)}};
         if(!(state.resultSnapshot?.finishOrder||[]).length){
           state.result={finishOrder:recoveredOrder,memo:$('memo')?.value||'',autoDiagnosis:'',at:new Date().toISOString(),actualTimes:{...state.actualTimes},source:'NAR公式 診断経路復旧',autoSaved:true};
           state.resultSnapshot={schemaVersion:3,raceId:flight.raceId,organization:flight.organization,source:'NAR公式 診断経路復旧',fetchedAt:recoveredData.acquiredAt,finishOrder:recoveredOrder,actualTimes:{...state.actualTimes},horses:recoveredData.results,weather:recoveredData.resultMeta?.weather||'',trackCondition:recoveredData.resultMeta?.trackCondition||'',quality:recoveredData.quality||null,market:state.resultMarketSnapshot||null};
         }
         try{persist(true)}catch{}
       }
       try{render()}catch{try{renderResultDisplayState();renderResultDiagnostics()}catch{}}
       $('narStatus').textContent=`結果取得成功：${recoveredOrder.join('-')}｜通常経路失敗後、RaceMarkTable診断経路から復旧しました。`;
       return {complete:true,pending:false,status:'success',resultFetchMode:'recovery',data:recoveredData,recovered:true};
     }
   }
   if(!alreadyComplete){registerResultWaiting(state,requestedId);state.resultQueue={...state.resultQueue,...resultQueueRetryPatch(state,{kind:'network',errorCode:state.resultErrorType}),lastResultCheckAt:new Date().toISOString()}}
   persist(existingValidated(raceId(r)));
   renderResultDisplayState();renderResultDiagnostics();
   $('narStatus').textContent=alreadyComplete?`結果取得済：${((state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).slice(0,3)).join('-')}｜${resultFetchFeedback({code:state.resultErrorType,status:e?.status,hasResult:true}).text}`:resultFetchFeedback({code:state.resultErrorType,status:e?.status}).text;
   return {complete:alreadyComplete,pending:false,status:alreadyComplete?'success':'retry',error:e};
 }finally{}
}
function saveValidation(){
 const f=[num($('finish1').value),num($('finish2').value),num($('finish3').value)].filter(x=>x!=null);
 if(f.length<3){alert('1〜3着を入力してください');return}
 const actualTimes={};String($('actualTimesInput')?.value||'').split(/\r?\n/).forEach(line=>{const m=line.match(/^\s*(\d+)\s*[=:：]\s*(\d+:\d+(?:\.\d+)?)\s*$/);if(m)actualTimes[m[1]]=m[2]});state.actualTimes={...state.actualTimes,...actualTimes};
 saveFetchedResult(f,{silent:false,source:'手動修正保存',resultData:{finishOrder:f,actualTimes,resultMeta:{weather:$('actualWeather')?.value||'',trackCondition:$('actualTrackCondition')?.value||''},results:Object.entries(actualTimes).map(([horseNo,time])=>({horseNo:Number(horseNo),time}))}});
}

function buildJraValidationMetrics(record=state){
 const finish=(record.resultSnapshot?.finishOrder||record.result?.finishOrder||[]).map(Number).slice(0,3);
 const top3=new Set(finish),predicted=frozenHorses(record),byNo=new Map(predicted.map(h=>[Number(h.horseNo),h]));
 const finalRows=(record.finalSnapshot?.top3||[]).slice(0,3).map((x,i)=>({
  ...byNo.get(Number(x.horseNo)),horseNo:Number(x.horseNo),mark:x.mark||['◎','○','▲'][i]
 }));
 const longshots=predicted.filter(h=>h.valueMark),danger=predicted.filter(h=>h.warningMark);
 const errors=predicted.map(h=>{
  const p=timeToSec(h.predictedTime),a=timeToSec(record.resultSnapshot?.actualTimes?.[String(h.horseNo)]||record.actualTimes?.[String(h.horseNo)]);
  return p!=null&&a!=null?{horseNo:Number(h.horseNo),horseName:h.horseName,error:Math.abs(p-a)}:null;
 }).filter(Boolean).sort((a,b)=>a.error-b.error);
 const mae=errors.length?errors.reduce((s,x)=>s+x.error,0)/errors.length:null;
 return {finishOrder:finish,finalRows:finalRows.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,
  mark:h.mark,finish:finish.indexOf(Number(h.horseNo))+1||null,top3:top3.has(Number(h.horseNo))})),
  captured:finalRows.filter(h=>top3.has(Number(h.horseNo))).length,
  winPickWon:Number(finalRows[0]?.horseNo)===finish[0],winPickTop3:top3.has(Number(finalRows[0]?.horseNo)),
  longshots:longshots.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,valueMark:h.valueMark,valueType:h.valueType,top3:top3.has(Number(h.horseNo))})),
  danger:danger.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,warningMark:h.warningMark,top3:top3.has(Number(h.horseNo))})),
  time:{count:errors.length,mae:mae==null?null:Number(mae.toFixed(3)),min:errors[0]||null,max:errors.at(-1)||null}};
}
function renderValidationSummary(){const box=$('validationSummary');if(!box)return;const result=getResultDisplayState();if(!result.done){box.hidden=true;box.innerHTML='';return}const v=buildJraValidationMetrics(state),rows=v.finalRows.map(h=>`<span>${esc(h.mark)} ${h.horseNo} ${esc(h.horseName)} → ${h.finish?`${h.finish}着 ${h.top3?'○':'×'}`:'圏外 ×'}</span>`),longshotRows=v.longshots.map(h=>`<span>${esc(h.valueMark)}${esc(h.valueType||'穴候補')} ${h.horseNo} → ${h.top3?'TOP3捕捉':'不発'}</span>`),dangerRows=v.danger.map(h=>`<span>${esc(h.warningMark)} ${h.horseNo} → ${h.top3?'危険評価過剰':'TOP3外'}</span>`),predCond=state.resultSnapshot?.predictionTrackCondition||state.predictionSnapshot?.race?.trackCondition||'',actualCond=state.resultSnapshot?.actualTrackCondition||state.resultSnapshot?.trackCondition||'',predWeather=state.resultSnapshot?.predictionWeather||state.predictionSnapshot?.race?.weather||'',actualWeather=state.resultSnapshot?.actualWeather||state.resultSnapshot?.weather||'',weatherChanged=predWeather!==actualWeather||predCond!==actualCond,source=state.resultSnapshot?.resultSource==='manual'?'🟠 手動入力':'🟢 公式自動取得';box.hidden=false;box.innerHTML=`<strong>自動答え合わせ</strong><div class="validation-source">結果データ ${source}</div><div class="validation-hits">${[...rows,...longshotRows,...dangerRows].join('')}</div><div class="validation-kpis"><span>本命勝利 <b>${v.winPickWon?'○':'×'}</b></span><span>本命TOP3 <b>${v.winPickTop3?'○':'×'}</b></span><span>能力印TOP3捕捉 <b>${v.captured}/3</b></span><span>穴馬捕捉 <b>${v.longshots.filter(x=>x.top3).length}</b></span><span>TIME MAE <b>${v.time.mae==null?'未算出':v.time.mae.toFixed(2)+'秒'}</b></span><span>最大誤差 <b>${v.time.max?`${v.time.max.horseNo} ${esc(v.time.max.horseName)} ${v.time.max.error.toFixed(1)}秒`:'—'}</b></span><span>最小誤差 <b>${v.time.min?`${v.time.min.horseNo} ${esc(v.time.min.horseName)} ${v.time.min.error.toFixed(1)}秒`:'—'}</b></span></div>${weatherChanged?`<p class="validation-weather">馬場・天候変化あり｜${esc(predWeather||'—')}・${esc(predCond||'—')} → ${esc(actualWeather||'—')}・${esc(actualCond||'—')}<br><small>TIME誤差の馬場変化要因として別保存</small></p>`:''}`}

function historyDefaultState(){
 const today=new Date(),end=new Date(today);end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-29);const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 return {schemaVersion:2,status:'idle',phase:'meeting_discovery',preset:'30',startDate:iso(start),endDate:iso(end),tracks:['浦和','船橋','大井','川崎'],meetingCursor:0,meetingChecked:0,meetingTotal:0,meetingFound:0,nonMeetingDays:0,unknownMeetings:[],discoveredMeetings:[],collectionMeetingIndex:0,raceIndex:0,raceTargets:0,raceProcessed:0,saved:0,alreadySaved:0,raceNotScheduled:0,resultWaiting:0,networkFailure:0,parseFailure:0,cloudFailure:0,unexpectedFailure:0,lastItem:'',startedAt:null,updatedAt:null,errors:[],requestStats:{meetingRequests:0,raceRequests:0,resultRequests:0,cacheHits:0},trackStats:{}};
}
function migrateHistoryState(value){if(value?.schemaVersion===2)return value;const fresh=historyDefaultState();if(value){fresh.startDate=value.startDate||fresh.startDate;fresh.endDate=value.endDate||fresh.endDate;fresh.tracks=Array.isArray(value.tracks)?value.tracks:fresh.tracks;fresh.preset=value.preset||fresh.preset}return fresh}
function getHistoryState(){if(!historyCollection)historyCollection=migrateHistoryState(localStore.get(HISTORY_COLLECTION_KEY,null));return historyCollection}
function saveHistoryState(){const st=getHistoryState();st.updatedAt=new Date().toISOString();localStore.set(HISTORY_COLLECTION_KEY,st);renderHistoryCollector()}
function historyDateRange(start,end){const out=[],a=new Date(`${start}T00:00:00`),b=new Date(`${end}T00:00:00`);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a>b)return out;for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10));return out}
function historyMeetingPair(st,index){const dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]);if(!tracks.length)return null;const date=dates[Math.floor(index/tracks.length)],track=tracks[index%tracks.length];return date&&track?{date,track,key:`${date}_${track}`} :null}
function historyRequestMetrics(st=getHistoryState()){const dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]),legacyCandidateCount=dates.length*tracks.length*12,estimatedLegacyRequests=legacyCandidateCount+(st.raceTargets||0),actualRequests=(st.requestStats?.meetingRequests||0)+(st.requestStats?.raceRequests||0)+(st.requestStats?.resultRequests||0),reductionRate=estimatedLegacyRequests?Math.max(0,100*(1-actualRequests/estimatedLegacyRequests)):0;return {legacyCandidateCount,estimatedLegacyRequests,actualRequests,reductionRate:Number(reductionRate.toFixed(1))}}
function resetHistoryProgress(st){const fresh=historyDefaultState();for(const key of ['status','phase','meetingCursor','meetingChecked','meetingTotal','meetingFound','nonMeetingDays','unknownMeetings','discoveredMeetings','collectionMeetingIndex','raceIndex','raceTargets','raceProcessed','saved','alreadySaved','raceNotScheduled','resultWaiting','networkFailure','parseFailure','cloudFailure','unexpectedFailure','lastItem','startedAt','updatedAt','errors','requestStats','trackStats'])st[key]=cloneData(fresh[key]);return st}
function historyPresetDays(days){const st=getHistoryState(),end=new Date();end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-Math.max(0,Number(days||1)-1));const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);st.startDate=iso(start);st.endDate=iso(end);st.preset=String(days);resetHistoryProgress(st);saveHistoryState()}
function meetingCacheEntry(date,track){const entry=meetingCalendarCache.entries?.[`${date}_${track}`];if(['金沢','笠松'].includes(track)&&entry?.venueRoutingVersion!=='NAR_VENUE_ROUTING_22_23_V1')return null;return entry||null}
function currentMeetingChangesForRace(data={}){const date=String(data.date||state?.race?.raceDate||state?.race?.date||''),track=String(data.track||state?.race?.track||''),raceNo=Number(data.race||data.raceNo||state?.race?.raceNo),entry=meetingCacheEntry(date,track);return (entry?.changes||[]).filter(item=>String(item.date||date)===date&&String(item.track||track)===track&&Number(item.raceNo)===raceNo&&Number(item.horseNo)>0).map(item=>({...item,horseStatus:item.horseStatus||normalizeHorseStatus(item.type),statusText:item.type||item.statusText||''}))}
async function saveMeetingCalendarCache(){meetingCalendarCache.updatedAt=new Date().toISOString();localStore.set(MEETING_CALENDAR_KEY,meetingCalendarCache);if(researchDb)await idbPut('settings',{key:'meetingCalendar',value:meetingCalendarCache})}
async function setMeetingCache(date,track,value){if(!['meeting','non_meeting'].includes(value?.status))return;meetingCalendarCache.entries=meetingCalendarCache.entries||{};meetingCalendarCache.entries[`${date}_${track}`]={...value,date,track,checkedAt:value.checkedAt||new Date().toISOString()};await saveMeetingCalendarCache()}
function historyTrackStat(st,track){return st.trackStats[track]||(st.trackStats[track]={meetingDays:0,nonMeetingDays:0,raceTargets:0,raceProcessed:0,saved:0,alreadySaved:0})}
function addDiscoveredMeeting(st,item){if(st.discoveredMeetings.some(x=>x.date===item.date&&x.track===item.track))return;const raceNumbers=[...new Set((item.raceNumbers||[]).map(Number).filter(n=>n>0))].sort((a,b)=>a-b);if(!raceNumbers.length)return;st.discoveredMeetings.push({date:item.date,track:item.track,raceNumbers});st.meetingFound++;st.raceTargets+=raceNumbers.length;const ts=historyTrackStat(st,item.track);ts.meetingDays++;ts.raceTargets+=raceNumbers.length}
async function discoverMeeting(st,pair){const cached=meetingCacheEntry(pair.date,pair.track);if(cached){st.requestStats.cacheHits++;return cached}let lastError=null;for(let attempt=1;attempt<=3;attempt++){if(attempt>1)await new Promise(r=>setTimeout(r,attempt===2?2000:5000));try{st.requestStats.meetingRequests++;const code=narCode(pair.track),response=await fetch(`/api/nar/meeting?code=${code}&date=${encodeURIComponent(pair.date)}`,{cache:'no-store'}),data=await responseJson(response);if(!response.ok)throw requestError(data.errorCode||'network_failure',data.error||'開催日取得失敗',response.status);if(data.status==='meeting'&&data.raceNumbers?.length){await setMeetingCache(pair.date,pair.track,data);return data}if(data.status==='non_meeting'){await setMeetingCache(pair.date,pair.track,data);return data}lastError=requestError('meeting_unknown','開催日を確定できませんでした')}catch(e){lastError=e}}throw lastError||requestError('meeting_unknown','開催日を確定できませんでした')}
async function waitForCollectorPriority(){while(!historyCollectorAbort&&(raceLoadController||liveOddsController||resultFetchInProgress||autoResultRunInProgress))await new Promise(r=>setTimeout(r,500));if(!historyCollectorAbort&&dueResultQueue().length)await runAutoResultQueue({limit:1,allowHistoricalBoundary:true})}
function historySampleLabel(n){return n<30?'低信頼':n<100?'参考':n<300?'中':'高'}
function historicalRecord(root,resultData){
 const previous=state,now=new Date().toISOString();
 try{
  state=transform(root);state.race={...state.race,historicalResearch:true,researchMode:'historical_research',predictionKind:'backtest_prediction',dataMode:`${state.race.dataMode||'NAR自動'}・過去研究`};
  const originalPredictionSnapshot=state.predictionSnapshot?structuredClone(state.predictionSnapshot):null;
  const originalMarketSnapshot=state.marketSnapshot?structuredClone(state.marketSnapshot):null;
  makeSnapshot();
  if(state.predictionSnapshot){
   const originalGeneratedAt=originalPredictionSnapshot?.generatedAt||originalPredictionSnapshot?.createdAt||state.predictionSnapshot.generatedAt||now;
   const originalCreatedAt=originalPredictionSnapshot?.createdAt||originalGeneratedAt;
   state.predictionSnapshot.historicalResearch=true;state.predictionSnapshot.predictionKind='backtest_prediction';state.predictionSnapshot.generatedAt=originalGeneratedAt;state.predictionSnapshot.createdAt=originalCreatedAt;state.predictionSnapshot.race={...state.predictionSnapshot.race,historicalResearch:true,researchMode:'historical_research'}
  }
  if(state.marketSnapshot){
   const originalMarketCreatedAt=originalMarketSnapshot?.createdAt||originalMarketSnapshot?.acquiredAt||state.marketSnapshot.createdAt||now;
   const originalMarketAcquiredAt=originalMarketSnapshot?.acquiredAt||originalMarketCreatedAt;
   state.marketSnapshot.historicalResearch=true;state.marketSnapshot.oddsSnapshotType='historical_official';state.marketSnapshot.createdAt=originalMarketCreatedAt;state.marketSnapshot.acquiredAt=originalMarketAcquiredAt
  }
  const record=cloneData(state);record.modelVersion=APP_VERSION;record.predictionCreatedAt=now;record.historicalResearch={schemaVersion:1,mode:'historical_research',predictionKind:'backtest_prediction',collectedAt:now,resultLeakageGuard:true,notes:'過去レース研究用。現在モデルによるバックテスト予測であり、当時のリアルタイム予想とは区別する。'};
  if(resultData?.finishOrder?.length>=3){
   record.actualTimes={...(resultData.actualTimes||{})};record.result={finishOrder:resultData.finishOrder.map(Number),actualTimes:{...record.actualTimes},source:'NAR公式 過去研究取得',at:now,autoSaved:true};
   record.resultSnapshot={schemaVersion:3,source:'NAR公式 過去研究取得',fetchedAt:resultData.acquiredAt||now,finishOrder:resultData.finishOrder.map(Number),actualTimes:{...record.actualTimes},horses:Array.isArray(resultData.results)?resultData.results.map(x=>({...x,horseNo:Number(x.horseNo),position:x.position==null?null:Number(x.position)})):[],weather:resultData?.resultMeta?.weather||'',trackCondition:resultData?.resultMeta?.trackCondition||'',quality:resultData?.quality||null,market:null};
   record.resultAcquiredAt=resultData.acquiredAt||now;record.validationCompleted=true;record.validated=true;
   // Finalize the newly generated backtest snapshots before diagnosing them.
   // Never repair existing records or rewrite timestamps to pass chronology checks.
   sealSnapshotIntegrity(record,true);
   const diag=diagnosticsForRace(record);record.validationSnapshot={schemaVersion:3,modelVersion:APP_VERSION,generatedAt:now,finishOrder:[...record.resultSnapshot.finishOrder],failures:diag.failures,checks:diag.checks,dataQuality:diag.quality,historicalResearch:true};record.validationSnapshot.longshotScenario=longshotScenarioValidation(record);
  }
  sealSnapshotIntegrity(record,true);record.updatedAt=now;return record;
 }finally{state=previous}
}
async function persistHistoricalRecord(id,record){raceCache[id]=record;if(researchDb)await idbPut('races',{id,data:record,updatedAt:record.updatedAt});else localStore.set(KEY,raceCache)}
async function syncHistoricalBatch(batch){
 if(!batch.length)return cloudSyncSummary();
 const records=await sendCloudSyncBatch(batch),summary={...cloudSyncSummary(records),records};
 if(summary.held||summary.failed||summary.pending)throw Object.assign(new Error('SYNC_PARTIAL_HOLD'),{code:'SYNC_PARTIAL_HOLD',syncSummary:summary});
 return summary;
}
function renderHistoryCollector(){
 const box=$('historyCollector');if(!box)return;const st=getHistoryState(),dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]),existing=cloudResearchAudit.counts?.d1PredictionSaved??Object.keys(raceCache).length,remaining1=Math.max(0,1000-existing),remaining3=Math.max(0,3000-existing);st.meetingTotal=dates.length*tracks.length;
 const discovery=st.meetingTotal?Math.min(100,100*(st.meetingChecked||0)/st.meetingTotal):0,collection=st.raceTargets?Math.min(100,100*(st.raceProcessed||0)/st.raceTargets):0,isDiscovery=['meeting_discovery','meeting_retry'].includes(st.phase),progress=isDiscovery?discovery:collection,metrics=historyRequestMetrics(st);
 if($('historyStartDate'))$('historyStartDate').value=st.startDate||'';if($('historyEndDate'))$('historyEndDate').value=st.endDate||'';if($('historyPreset'))$('historyPreset').value=st.preset||'30';
 const trackBox=$('historyTrackGrid');if(trackBox&&!trackBox.dataset.ready){trackBox.innerHTML=Object.keys(NAR_TRACKS).map(t=>`<label><input type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join('');trackBox.dataset.ready='1'}
 trackBox?.querySelectorAll('input').forEach(i=>i.checked=(st.tracks||[]).includes(i.value));
 const statusLabel=st.status==='running'?'収集中':st.status==='paused'?'一時停止':st.status==='done'?'収集完了':st.status==='done_with_retry'?'完了・再試行あり':'待機',phaseLabel=isDiscovery?'開催日探索':st.phase==='collection'?'レース収集':'完了';
 if($('historyProgressText'))$('historyProgressText').textContent=`${statusLabel}｜${phaseLabel} ${isDiscovery?`${st.meetingChecked||0}/${st.meetingTotal||0}組`:`${st.raceProcessed||0}/${st.raceTargets||0}R`} (${progress.toFixed(1)}%)`;
 if($('historyProgressBar'))$('historyProgressBar').style.width=`${progress}%`;
 if($('historyCounts'))$('historyCounts').innerHTML=`<span>保存 ${st.saved||0}R</span><span>既取得 ${st.alreadySaved||0}R</span><span>非開催 ${st.nonMeetingDays||0}日</span><span>対象外R ${st.raceNotScheduled||0}R</span><span>結果待ち ${st.resultWaiting||0}R</span><span>通信失敗 ${st.networkFailure||0}R</span>`;
 if($('historyTrackProgress'))$('historyTrackProgress').innerHTML=Object.entries(st.trackStats||{}).map(([track,x])=>`<span><b>${esc(track)}</b> 開催${x.meetingDays||0}日・非開催${x.nonMeetingDays||0}日・収集${x.raceProcessed||0}/${x.raceTargets||0}R</span>`).join('');
 if($('historyEfficiency'))$('historyEfficiency').textContent=`旧候補 ${metrics.legacyCandidateCount.toLocaleString()}件 → NAR要求 ${metrics.actualRequests.toLocaleString()}件｜推定削減 ${metrics.reductionRate.toFixed(1)}%｜Cache ${st.requestStats?.cacheHits||0}件`;
 if($('historyGoals'))$('historyGoals').innerHTML=`<strong>研究母数 ${existing}R</strong><span>第一目標1,000Rまで あと${remaining1}R</span><span>推奨3,000Rまで あと${remaining3}R</span>`;
 if($('historyLast'))$('historyLast').textContent=st.lastItem?`最後: ${st.lastItem}`:'既取得race_idは安全にスキップします。';
 if($('historyStart'))$('historyStart').disabled=historyCollectorRunning;if($('historyPause'))$('historyPause').disabled=!historyCollectorRunning;
}
function updateHistoryOptionsFromUi(){const st=getHistoryState();st.startDate=$('historyStartDate')?.value||st.startDate;st.endDate=$('historyEndDate')?.value||st.endDate;st.preset=$('historyPreset')?.value||'custom';st.tracks=[...($('historyTrackGrid')?.querySelectorAll('input:checked')||[])].map(x=>x.value);resetHistoryProgress(st);saveHistoryState()}
async function runHistoricalCollectorForeground(){
 if(historyCollectorRunning)return;const st=getHistoryState(),dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]);if(!dates.length||!tracks.length){if($('historyLast'))$('historyLast').textContent='期間と競馬場を選択してください。';return}
 if(autoResultRunInProgress)await autoResultRunInProgress;
 const retryUnknown=st.status==='done_with_retry';historyCollectorRunning=true;historyCollectorAbort=false;if(retryUnknown)st.phase='meeting_retry';st.status='running';st.startedAt=st.startedAt||new Date().toISOString();st.meetingTotal=dates.length*tracks.length;saveHistoryState();let batch=[];
 try{
  if(st.phase==='meeting_discovery')for(let i=st.meetingCursor||0;i<st.meetingTotal;i++){
   if(historyCollectorAbort){st.status='paused';break}await waitForCollectorPriority();if(historyCollectorAbort)break;
   const pair=historyMeetingPair(st,i);st.lastItem=`Meeting Discovery ${pair.date} ${pair.track}`;saveHistoryState();
   try{const found=await discoverMeeting(st,pair);if(found.status==='meeting')addDiscoveredMeeting(st,{...found,...pair});else{st.nonMeetingDays++;historyTrackStat(st,pair.track).nonMeetingDays++}}catch(e){st.unknownMeetings.push({...pair,errorCode:e?.code||'meeting_unknown'});st.errors=(st.errors||[]).slice(-19);st.errors.push({at:new Date().toISOString(),item:st.lastItem,error:e?.code||e?.message})}
   st.meetingCursor=i+1;st.meetingChecked=i+1;saveHistoryState();
  }
  if(!historyCollectorAbort&&st.phase==='meeting_discovery'){st.phase='collection';st.collectionMeetingIndex=st.collectionMeetingIndex||0;st.raceIndex=st.raceIndex||0;saveHistoryState()}
  if(!historyCollectorAbort&&st.phase==='meeting_retry'){
   const retryItems=[...(st.unknownMeetings||[])];st.unknownMeetings=[];for(const pair of retryItems){if(historyCollectorAbort)break;await waitForCollectorPriority();try{const found=await discoverMeeting(st,pair);if(found.status==='meeting')addDiscoveredMeeting(st,{...found,...pair});else{st.nonMeetingDays++;historyTrackStat(st,pair.track).nonMeetingDays++}}catch(e){st.unknownMeetings.push({...pair,errorCode:e?.code||'meeting_unknown'})}}st.phase='collection';saveHistoryState();
  }
  for(let mi=st.collectionMeetingIndex||0;!historyCollectorAbort&&mi<st.discoveredMeetings.length;mi++){
   const meeting=st.discoveredMeetings[mi],numbers=meeting.raceNumbers||[];
   for(let ri=mi===(st.collectionMeetingIndex||0)?(st.raceIndex||0):0;ri<numbers.length;ri++){
    if(historyCollectorAbort){st.status='paused';break}await waitForCollectorPriority();if(historyCollectorAbort)break;
    const item={date:meeting.date,track:meeting.track,raceNo:Number(numbers[ri])};item.id=raceId({raceDate:item.date,track:item.track,raceNo:item.raceNo});st.collectionMeetingIndex=mi;st.raceIndex=ri;st.lastItem=`Race Fetch ${item.date} ${item.track}${item.raceNo}R`;saveHistoryState();
   if(raceCache[item.id]||cloudResearchAudit.datasetRaceIds?.includes(item.id)){st.alreadySaved++;st.raceProcessed++;historyTrackStat(st,item.track).alreadySaved++;historyTrackStat(st,item.track).raceProcessed++;st.raceIndex=ri+1;continue}
   const code=narCode(item.track);
   try{
    st.requestStats.raceRequests++;const raceRes=await fetch(`/api/nar/race?code=${code}&date=${encodeURIComponent(item.date)}&race=${item.raceNo}`,{cache:'no-store'}),raceData=await responseJson(raceRes);
    if(!raceRes.ok||!Array.isArray(raceData.horses)||raceData.horses.length<2){if(raceRes.status===404||raceData.errorCode==='race_not_found'){st.raceNotScheduled++;continue}throw requestError(raceData.errorCode||'parse_failure',raceData.error||'出走馬取得失敗',raceRes.status)}
    const root=buildAbilityRoot(raceData,item.date,item.track,item.raceNo);root.race.historicalResearch=true;root.race.researchMode='historical_research';root.race.predictionKind='backtest_prediction';
    let resultData=null;try{st.requestStats.resultRequests++;const resultRes=await fetch(`/api/nar/sync?code=${code}&date=${encodeURIComponent(item.date)}&race=${item.raceNo}`,{cache:'no-store'}),rd=await responseJson(resultRes);if(resultRes.ok&&rd.finishOrder?.length>=3)resultData=rd;else st.resultWaiting++}catch{st.resultWaiting++}
    const record=historicalRecord(root,resultData);await persistHistoricalRecord(item.id,record);batch.push({raceId:item.id,record});st.saved++;historyTrackStat(st,item.track).saved++;
    if(batch.length>=10){try{await syncHistoricalBatch(batch);batch=[]}catch(e){st.cloudFailure+=e.syncSummary?(e.syncSummary.held+e.syncSummary.failed+e.syncSummary.pending):batch.length;st.errors=(st.errors||[]).slice(-19);st.errors.push({at:new Date().toISOString(),item:st.lastItem,error:e.code||e.message});batch=[]}}
   }catch(e){if(e?.code==='parse_failure'||e?.code==='parser_error')st.parseFailure++;else if(['network_error','network_failure','timeout','nar_timeout','http_error'].includes(e?.code)||e?.status)st.networkFailure++;else st.unexpectedFailure++;st.errors=(st.errors||[]).slice(-19);st.errors.push({at:new Date().toISOString(),item:st.lastItem,error:e.code||e.message})}
   finally{st.raceProcessed++;historyTrackStat(st,item.track).raceProcessed++;st.raceIndex=ri+1}
   saveHistoryState();await new Promise(r=>setTimeout(r,700+Math.floor(Math.random()*700)));
   }
   if(!historyCollectorAbort){st.collectionMeetingIndex=mi+1;st.raceIndex=0}
  }
  if(batch.length){try{await syncHistoricalBatch(batch)}catch(e){st.cloudFailure+=e.syncSummary?(e.syncSummary.held+e.syncSummary.failed+e.syncSummary.pending):batch.length}}
  if(!historyCollectorAbort){st.phase='done';st.status=st.unknownMeetings.length?'done_with_retry':'done'}
 }finally{
  historyCollectorRunning=false;historyCollectorAbort=false;saveHistoryState();try{await refreshCloudResearchDataset({persist:true,render:false});renderCloudDatasetSummary();renderDashboard()}catch{}renderHistoryCollector();
 }
}
function backgroundJobLabel(job){return ({running:'バックグラウンド収集中',paused:'一時停止',completed:'収集完了',failed:'停止・要確認',cancelled:'取消済',queued:'開始待ち'})[job?.status]||'待機'}
function backgroundReasonLabel(reason){return ({processed:'処理あり',no_active_job:'有効Jobなし',locked:'別Cronが処理中',not_due:'次回時刻待ち',no_remaining_pairs:'残り対象なし',all_cached:'全件cache済み',non_meeting:'非開催のみ',deadline_guard:'時間上限で安全終了',paused:'一時停止',invalid_cursor:'進捗位置を要確認',error:'処理エラー',lock_not_acquired:'lock取得不可'})[reason]||reason||'—'}
function renderBackgroundHistoricalJob(){
 const job=backgroundHistoricalJob;if(!job)return;const st=job.state||{},meetingTotal=(st.dates?.length||job.periodDays||0)*(st.tracks?.length||job.tracks?.length||0),isDiscovery=['meeting_discovery','race_discovery'].includes(job.phase),done=isDiscovery?(st.meetingChecked||0):(st.raceProcessed||0),total=isDiscovery?meetingTotal:(st.raceTargets||0),progress=total?Math.min(100,100*done/total):(job.status==='completed'?100:0);
 if($('historyProgressText'))$('historyProgressText').textContent=`${backgroundJobLabel(job)}｜${isDiscovery?'開催日探索':'レース収集'} ${done}/${total}${isDiscovery?'組':'R'} (${progress.toFixed(1)}%)`;
 if($('historyProgressBar'))$('historyProgressBar').style.width=`${progress}%`;
 if($('historyCounts'))$('historyCounts').innerHTML=`<span>保存 ${st.saved||0}R</span><span>既取得 ${st.alreadySaved||0}R</span><span>非開催 ${st.nonMeetingDays||0}日</span><span>結果待ち ${st.resultWaiting||0}R</span><span>通信失敗 ${st.networkFailure||0}R</span>`;
 if($('historyEfficiency')){const requests=(st.requestStats?.meetingRequests||0)+(st.requestStats?.raceRequests||0)+(st.requestStats?.resultRequests||0),legacy=meetingTotal*12,reduction=legacy?Math.max(0,100*(1-requests/legacy)):0;$('historyEfficiency').textContent=`旧候補 ${legacy.toLocaleString()}件 → NAR要求 ${requests.toLocaleString()}件｜推定削減 ${reduction.toFixed(1)}%｜Cache ${st.requestStats?.cacheHits||0}件`}
 if($('historyBackgroundState'))$('historyBackgroundState').textContent=`${backgroundJobLabel(job)}｜Phase ${job.phase||'—'}｜最終実行 ${job.lastRunAt?new Date(job.lastRunAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'}｜次回予定 ${job.nextRunAt?'約'+new Date(job.nextRunAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'—'}｜処理 ${st.raceProcessed||st.meetingChecked||0} / 保存 ${st.saved||0} / 既取得 ${st.alreadySaved||0} / 失敗 ${(st.networkFailure||0)+(st.parseFailure||0)+(st.unexpectedFailure||0)}｜Runs ${job.backgroundRuns||0} / Last ${job.lastBatchCount||0}（${backgroundReasonLabel(job.lastBatchReason)}）`;
 if($('historyLast'))$('historyLast').textContent=job.lastError?`前回: ${job.lastError}`:`Job ${job.id}`;
 if($('historyStart'))$('historyStart').disabled=job.status==='running';if($('historyPause'))$('historyPause').disabled=job.status!=='running';
}
async function refreshBackgroundHistoricalJob(){
 try{const data=await cloudRequest('/api/db/historical-job');backgroundHistoricalJob=data.job||null;renderHistoryCollector();renderBackgroundHistoricalJob();return backgroundHistoricalJob}catch{return null}
}
async function runHistoricalCollector(){
 if(backgroundHistoricalJob?.status==='paused'){try{const data=await cloudRequest('/api/db/historical-job/resume',{method:'POST',body:'{}'});backgroundHistoricalJob=data.job;renderBackgroundHistoricalJob();return}catch(error){if(error.code!=='d1_binding_unavailable')throw error}}
 const st=getHistoryState(),dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]);if(!dates.length||!tracks.length){if($('historyLast'))$('historyLast').textContent='期間と競馬場を選択してください。';return}
 try{const data=await cloudRequest('/api/db/historical-job/start',{method:'POST',body:JSON.stringify({startDate:dates[0],endDate:dates.at(-1),tracks})});backgroundHistoricalJob=data.job;renderHistoryCollector();renderBackgroundHistoricalJob()}
 catch(error){if(['d1_binding_unavailable','background_collector_unavailable_local'].includes(error.code))return runHistoricalCollectorForeground();if($('historyLast'))$('historyLast').textContent=`開始失敗：${error.code||error.message}`}
}
async function pauseHistoricalCollector(){if(backgroundHistoricalJob?.status==='running'){try{const data=await cloudRequest('/api/db/historical-job/pause',{method:'POST',body:'{}'});backgroundHistoricalJob=data.job;renderBackgroundHistoricalJob();return}catch{}}historyCollectorAbort=true;const st=getHistoryState();st.status='paused';saveHistoryState()}
async function resetHistoricalCollector(){if(historyCollectorRunning)return;if(backgroundHistoricalJob&&['paused','completed','failed','cancelled'].includes(backgroundHistoricalJob.status)){try{const data=await cloudRequest('/api/db/historical-job/reset',{method:'POST',body:'{}'});backgroundHistoricalJob=data.job;renderBackgroundHistoricalJob();return}catch{}}const old=getHistoryState(),fresh=historyDefaultState();fresh.startDate=old.startDate;fresh.endDate=old.endDate;fresh.preset=old.preset;fresh.tracks=[...(old.tracks||[])];historyCollection=fresh;saveHistoryState()}
async function resetMeetingCalendarCache(){if(historyCollectorRunning)return;meetingCalendarCache={schemaVersion:1,entries:{},updatedAt:new Date().toISOString()};await saveMeetingCalendarCache();try{await cloudRequest('/api/db/historical-job/meeting-cache/reset',{method:'POST',body:'{}'})}catch{}if($('historyLast'))$('historyLast').textContent='開催日キャッシュをリセットしました。研究データは保持しています。'}
function bindHistoricalCollector(){
 const box=$('historyCollector');if(!box)return;historyCollection=migrateHistoryState(localStore.get(HISTORY_COLLECTION_KEY,null));
 $('historyPreset')?.addEventListener('change',e=>{const v=e.target.value;if(v==='custom')return;historyPresetDays(Number(v))});
 for(const id of ['historyStartDate','historyEndDate'])$(id)?.addEventListener('change',()=>{const st=getHistoryState();st.preset='custom';updateHistoryOptionsFromUi()});
 $('historyTrackGrid')?.addEventListener('change',updateHistoryOptionsFromUi);$('historyStart')?.addEventListener('click',runHistoricalCollector);$('historyPause')?.addEventListener('click',pauseHistoricalCollector);$('historyReset')?.addEventListener('click',resetHistoricalCollector);$('historyCacheReset')?.addEventListener('click',resetMeetingCalendarCache);renderHistoryCollector();refreshBackgroundHistoricalJob();if(typeof window!=='undefined'&&!window.__CHASS_TEST__){clearInterval(backgroundHistoricalPollTimer);backgroundHistoricalPollTimer=setInterval(()=>{if(document.visibilityState==='visible')refreshBackgroundHistoricalJob()},45_000);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshBackgroundHistoricalJob()})}
}

function createResearchBackup(){
 return {format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:BACKUP_SCHEMA_VERSION,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),counts:{races:Object.keys(raceCache).length,oddsHistories:Object.keys(oddsHistoryCache).length},races:cloneData(raceCache),oddsHistory:cloneData(oddsHistoryCache),currentRace:currentRaceCache||'',syncDiagnostics:{schemaVersion:1,operation:cloneData(cloudReadOperation),holdAudit:cloneData(cloudHoldAudit),holdEvidence:exportCloudHoldEvidence(),holds:cloudSyncActiveHolds().map(h=>({raceId:h.raceId,modelVersion:h.modelVersion,reason:cloudSyncReason(h.reason),heldAt:typeof h.heldAt==='string'?h.heldAt:''}))}};
}
function validateResearchBackup(data){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('バックアップ形式が不正です。');
 if(data.format!=='CHASS_KEIBA_RESEARCH_BACKUP')throw new Error('CHASS研究バックアップではありません。');
 const schema=Number(data.schemaVersion);if(!Number.isInteger(schema)||schema<1)throw new Error('schemaVersionが不正です。');
 if(schema>BACKUP_SCHEMA_VERSION)throw new Error(`このバックアップは新しい形式です（schema ${schema}）。先にアプリを更新してください。`);
 if(!data.races||typeof data.races!=='object'||Array.isArray(data.races))throw new Error('保存レースが含まれていません。');
 return {schemaVersion:schema,raceCount:Object.keys(data.races).length,oddsCount:data.oddsHistory&&typeof data.oddsHistory==='object'&&!Array.isArray(data.oddsHistory)?Object.keys(data.oddsHistory).length:0};
}
function mergeResearchBackup(data,existing=raceCache){
 validateResearchBackup(data);const merged={...existing};let imported=0,skipped=0,invalid=0;
 for(const [sourceId,raw] of Object.entries(data.races)){
   if(!raw||typeof raw!=='object'){invalid++;continue}
   const record=cloneData(raw),id=raceId(record.race)||sourceId;if(!id){invalid++;continue}
   migrateSnapshotRecord(record);const old=merged[id],incomingAt=Date.parse(record.updatedAt||record.resultAcquiredAt||'')||0,oldAt=Date.parse(old?.updatedAt||old?.resultAcquiredAt||'')||0;
   if(old&&incomingAt<=oldAt){skipped++;continue}
   merged[id]=record;imported++;
 }
 return {merged,imported,skipped,invalid};
}
function downloadResearchBackup(){
 const data=createResearchBackup(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'),stamp=data.exportedAt.slice(0,10).replaceAll('-','');a.href=url;a.download=`CHASS-research-backup-${stamp}-v${APP_VERSION}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return {...data.counts,holdEvidence:data.syncDiagnostics.holdEvidence?.captured||0};
}
async function importResearchBackup(file){
 if(!file)throw new Error('ファイルを選択してください。');if(file.size>50*1024*1024)throw new Error('バックアップが50MBを超えています。');
 let data;try{data=JSON.parse((await file.text()).replace(/^\uFEFF/,''))}catch{throw new Error('JSONを解析できません。')}
 const result=mergeResearchBackup(data);raceCache=result.merged;store.set(KEY,raceCache);
 const incomingOdds=data.oddsHistory&&typeof data.oddsHistory==='object'&&!Array.isArray(data.oddsHistory)?data.oddsHistory:{};for(const [id,history] of Object.entries(incomingOdds)){if(Array.isArray(history)&&history.length>(oddsHistoryCache[id]?.length||0))oddsHistoryCache[id]=history}store.set(ODDS_HISTORY,oddsHistoryCache);
 if(!currentRaceCache&&data.currentRace&&raceCache[data.currentRace])store.set(CURRENT,data.currentRace);
 renderDashboard();return result;
}
function getAllRaces(){
 const legacy=store.get(LEGACY_KEY,{}),now=store.get(KEY,{}),merged={...legacy,...now};
 const cloudIds=cloudState.available&&cloudState.source==='cloud'&&cloudResearchAudit.loadedAt?new Set(cloudResearchAudit.eligibleRaceIds||[]):null;
 return Object.entries(merged).filter(([id,x])=>x?.validated&&x.cloudEligible!==false&&resultOrder(x).length>=3&&(!cloudIds||cloudIds.has(id))).map(([,x])=>x);
}
function frozenHorses(r){
 const prediction=Array.isArray(r?.predictionSnapshot?.horses)?r.predictionSnapshot.horses:[];
 if(!prediction.length)return enforceSignalMarkExclusion(cloneData(r?.horses||[]));
 const market=new Map((r.marketSnapshot?.horses||[]).map(h=>[Number(h.horseNo),h]));
 const finals=new Map((r.finalSnapshot?.ranking||r.finalSnapshot?.top3||[]).map(h=>[Number(h.horseNo),h]));
 // Prediction is the sole owner of ability, probabilities, TIME and identity.
 // Join only named display/market fields; FINAL never overwrites those inputs.
 const marketFields=['odds','popularity','ev','valueMark','valueType','winValueMark','placeValueMark',
  'winValueFlag','placeValueFlag','warningMark','warningScenario','marketHeat','abilityRisk',
  'longshotScore','marketGapScore','timeValueScore','courseValueScore','paceFitScore','reboundScore',
  'popularityPercentile','timeValueFlag','longshotReasons','longshotScenario'];
 const rows=prediction.map(h=>{
  const row=cloneData(h),m=market.get(Number(h.horseNo)),f=finals.get(Number(h.horseNo));
  for(const key of marketFields)if(m&&Object.hasOwn(m,key))row[key]=cloneData(m[key]);
  for(const key of ['mark','rank','finalScore','score'])if(f&&Object.hasOwn(f,key))row[key]=cloneData(f[key]);
  row.horseNo=Number(h.horseNo);return row;
 });
 const signal=r.marketSnapshot?.signalSnapshot;
 if(signal?.status==='frozen')applyFrozenSignalSnapshot(rows,signal);
 else applyFrozenWarnings(rows,signal);
 return rows;
}
function frozenHorseByNo(r,no){return frozenHorses(r).find(h=>Number(h.horseNo)===Number(no))||null}
function resultOrder(r){return (r?.resultSnapshot?.finishOrder||r?.result?.finishOrder||[]).map(Number)}
function resultTop3(r){return resultOrder(r).slice(0,3)}
function isTop3(r,horseNo){return resultTop3(r).includes(Number(horseNo))}
function officialPlaceLimit(r){const starters=resultOrder(r).length;return starters>=8?3:starters>=5?2:0}
function isOfficialPlace(r,horseNo){const limit=officialPlaceLimit(r);return limit?resultOrder(r).slice(0,limit).includes(Number(horseNo)):null}
function wilsonInterval(success,total,z=1.96){
 if(!total)return null;
 const p=success/total,z2=z*z,den=1+z2/total,center=(p+z2/(2*total))/den,margin=z*Math.sqrt((p*(1-p)+z2/(4*total))/total)/den;
 return {low:Math.max(0,center-margin)*100,high:Math.min(1,center+margin)*100};
}
function resultTimes(r){return r?.resultSnapshot?.actualTimes||r?.result?.actualTimes||r?.actualTimes||{}}
function resultHorseByNo(r,no){return (r?.resultSnapshot?.horses||[]).find(h=>Number(h.horseNo)===Number(no))||null}
function settledWinOdds(r,no){const odds=num(resultHorseByNo(r,no)?.finalOdds);return odds!=null&&odds>=1?odds:null}
function modelPerformance(races,pick){
 const out={target:0,wins:0,top3:0,positions:[],popularity:[],forecastOdds:[],roiN:0,roiReturn:0,roiWins:0};
 for(const r of races){const h=pick(r);if(!h)continue;out.target++;const pos=horsePosition(r,h);if(pos===1)out.wins++;if(isTop3(r,h.horseNo))out.top3++;if(pos!=null)out.positions.push(pos);if(h.popularity!=null)out.popularity.push(Number(h.popularity));if(h.odds!=null)out.forecastOdds.push(Number(h.odds));const finalOdds=settledWinOdds(r,h.horseNo);if(finalOdds!=null){out.roiN++;if(pos===1){out.roiWins++;out.roiReturn+=finalOdds}}}
 out.roi=out.roiN?out.roiReturn/out.roiN*100:null;return out;
}
function migrateSnapshotRecord(r){
 if(!r||typeof r!=='object')return false;
 let changed=false;const hadResultSnapshot=r.resultSnapshot!=null,fillMissingSnapshots=!r.snapshotIntegrity,now=r.updatedAt||r.result?.at||r.predictionCreatedAt||r.resultAcquiredAt||'1970-01-01T00:00:00.000Z',horses=r.horses||[];
 if(fillMissingSnapshots&&r.predictionSnapshot==null){r.predictionSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',generatedAt:now,createdAt:now,race:snapshotRace(r.race||{}),horses:horses.map(predictionHorse),locked:true,legacyDerived:true};changed=true}
 if(fillMissingSnapshots&&r.marketSnapshot==null){r.marketSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',acquiredAt:r.race?.oddsUpdatedAt||now,createdAt:r.race?.oddsUpdatedAt||now,oddsSnapshotType:r.race?.oddsSnapshotType||'unknown',horses:horses.map(marketHorse),legacyDerived:true};changed=true}
 if(fillMissingSnapshots&&r.finalSnapshot==null){const ranked=rankFinalFor(horses);r.finalSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',generatedAt:now,createdAt:now,top3:ranked.slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:['◎','○','▲'][i],rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime})),ranking:ranked.map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime})),legacyDerived:true};changed=true}
 if(r.result?.finishOrder?.length>=3&&!r.resultSnapshot){r.resultSnapshot={schemaVersion:2,source:r.result.source||'legacy',fetchedAt:r.resultFetchedAt||r.result.at||now,finishOrder:r.result.finishOrder.map(Number),actualTimes:{...(r.result.actualTimes||r.actualTimes||{})},legacyDerived:true};changed=true}
 if(!hadResultSnapshot&&r.resultSnapshot&&!Array.isArray(r.resultSnapshot.horses)){const times=r.resultSnapshot.actualTimes||r.result?.actualTimes||r.actualTimes||{};r.resultSnapshot.horses=(r.resultSnapshot.finishOrder||[]).map((horseNo,i)=>({position:i+1,positionText:String(i+1),horseNo:Number(horseNo),time:times[String(horseNo)]||''}));r.resultSnapshot.legacyDerived=true;changed=true}
 // Migration fills absent legacy layers only. Never recalculate an existing
 // market, add Signal, reseal evidence, or rewrite source timestamps on load.
 const metadata={modelVersion:r.modelVersion||r.predictionSnapshot?.modelVersion||'legacy-unknown',predictionCreatedAt:r.predictionCreatedAt||r.predictionSnapshot?.createdAt||r.predictionSnapshot?.generatedAt||null,resultAcquiredAt:r.resultAcquiredAt||r.resultSnapshot?.fetchedAt||r.resultFetchedAt||null,updatedAt:r.updatedAt||now,snapshotSchemaVersion:r.snapshotSchemaVersion??2};
 for(const [key,value]of Object.entries(metadata))if(r[key]!==value){r[key]=value;changed=true;}
 return changed;
}
function horsePosition(r,h){const no=Number(h?.horseNo),i=resultOrder(r).indexOf(no);return i>=0?i+1:null}

function timeToSec(v){
 const s=String(v||'').trim();
 const m=s.match(/^(\d+):([0-5]\d(?:\.\d+)?)$/);
 if(!m)return null;
 return Number(m[1])*60+Number(m[2]);
}
function pct(n,d){return d?`${(n/d*100).toFixed(1)}%`:'—'}
function getHorseByNo(r,no){return frozenHorseByNo(r,no)}
function top3Snapshot(r){
 const snap=r.finalSnapshot?.top3;
 if(Array.isArray(snap)&&snap.length)return snap.slice(0,3);
 return rankFinalFor(frozenHorses(r)).slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),mark:['◎','○','▲'][i]}));
}
function aggregateAdvanced(races){
 const adv={
   races:races.length,
   top3Any:0,top3Perfect:0,top3Captured:0,
   diamondN:0,diamondPlace:0,diamondWin:0,diamondOfficialN:0,diamondOfficialHit:0,diamondPop:[],diamondOdds:[],
   valueTypes:{},warningN:0,warningOut:0,warningBaseN:0,warningBaseOut:0,
   ev100N:0,ev100Win:0,ev100Place:0,
   winMae:[],placeMae:[],winBrier:[],placeBrier:[],
   winCalibration:{},placeCalibration:{},
   timeAbs:[],timeError:[],timeByType:{実績:[],補正:[]},timeScenario:{standard:0,paceFavored:0,paceAdverse:0},finalRankAbs:[],
   byDistance:{},byPopularity:{},byEvBand:{}
 };
 const confidence=n=>n<10?'低信頼':n<30?'参考':n<100?'中':'高';
 const calibrationBand=(kind,p)=>kind==='win'?(p<10?'0-9%':p<20?'10-19%':p<30?'20-29%':p<40?'30-39%':p<50?'40-49%':'50%以上'):(p<20?'0-19%':p<40?'20-39%':p<60?'40-59%':p<80?'60-79%':'80%以上');
 const pushCalibration=(obj,key,p,y)=>{const g=(obj[key]??={n:0,predicted:0,actual:0});g.n++;g.predicted+=p;g.actual+=y};
 const band=(o)=>{
   if(o==null)return '不明';
   if(o<=3)return '1-3人気';
   if(o<=6)return '4-6人気';
   if(o<=9)return '7-9人気';
   return '10人気以下';
 };
 const evBand=(e)=>{
   if(e==null)return '未取得';
   if(e<100)return '<100%';
   if(e<150)return '100-149%';
   if(e<250)return '150-249%';
   return '250%以上';
 };
 const pushGroup=(obj,key,hit,win,winError=null,placeError=null,timeError=null)=>{
   const g=(obj[key]??={n:0,place:0,win:0,winError:[],placeError:[],timeError:[]});g.n++;if(hit)g.place++;if(win)g.win++;if(winError!=null)g.winError.push(winError);if(placeError!=null)g.placeError.push(placeError);if(timeError!=null)g.timeError.push(timeError);
 };
 for(const r of races){
   const order=resultOrder(r);
   const top3=resultTop3(r);
   const snap=top3Snapshot(r);
   const captured=snap.filter(x=>top3.includes(Number(x.horseNo))).length;
   if(captured>0)adv.top3Any++;
   if(captured===3)adv.top3Perfect++;
   adv.top3Captured+=captured;

   // FINAL rank vs actual rank, for top3 only
   snap.forEach((x,i)=>{
     const pos=order.indexOf(Number(x.horseNo));
     if(pos>=0)adv.finalRankAbs.push(Math.abs((i+1)-(pos+1)));
   });

   for(const h of frozenHorses(r)){
     const no=Number(h.horseNo), pos=order.indexOf(no), placed=top3.includes(no), officialPlaced=isOfficialPlace(r,no), won=pos===0;
     const vm=h.valueMark|| (h.mark?.includes?.('💎')?h.mark:'');
     const wm=h.warningMark||h.warning||'';
     if(vm){
       adv.diamondN++; if(placed)adv.diamondPlace++; if(won)adv.diamondWin++;if(officialPlaced!==null){adv.diamondOfficialN++;if(officialPlaced)adv.diamondOfficialHit++;}
       const type=h.valueType||((h.winValueFlag||h.winValueMark)?'勝ち穴':(h.placeValueFlag||h.placeValueMark)?'相手穴':String(vm).length>=6?'大穴':'未分類');
       const value=(adv.valueTypes[type]??={n:0,win:0,top3:0,pop:[],odds:[],ev:[],roiN:0,roiWins:0,roiReturn:0});value.n++;if(won)value.win++;if(placed)value.top3++;if(h.popularity!=null)value.pop.push(Number(h.popularity));if(h.odds!=null)value.odds.push(Number(h.odds));if(h.ev!=null)value.ev.push(Number(h.ev));const settled=settledWinOdds(r,no);if(settled!=null){value.roiN++;if(won){value.roiWins++;value.roiReturn+=settled}}
       if(h.popularity!=null)adv.diamondPop.push(Number(h.popularity));
       if(h.odds!=null)adv.diamondOdds.push(Number(h.odds));
     }
     if(wm){adv.warningN++; if(!placed)adv.warningOut++;}
     if(h.popularity!=null&&h.popularity<=3&&!wm){adv.warningBaseN++;if(!placed)adv.warningBaseOut++;}
     if(h.ev!=null&&h.ev>=100){adv.ev100N++; if(won)adv.ev100Win++; if(placed)adv.ev100Place++;}

     if(h.win!=null){
       const y=won?1:0, p=Number(h.win)/100;
       adv.winMae.push(Math.abs(p-y)*100);adv.winBrier.push((p-y)**2);
       pushCalibration(adv.winCalibration,calibrationBand('win',Number(h.win)),Number(h.win),y);
     }
     if(h.place!=null){
       const y=placed?1:0, p=Number(h.place)/100;
       adv.placeMae.push(Math.abs(p-y)*100);adv.placeBrier.push((p-y)**2);
       pushCalibration(adv.placeCalibration,calibrationBand('place',Number(h.place)),Number(h.place),y);
     }
     const pred=timeToSec(h.predictedTime), actual=timeToSec(resultTimes(r)[String(h.horseNo)]);
     let signedTimeError=null;
     if(pred!=null&&actual!=null){signedTimeError=pred-actual;adv.timeAbs.push(Math.abs(signedTimeError));adv.timeError.push(signedTimeError);const type=h.predictedTimeType;if(adv.timeByType[type])adv.timeByType[type].push(signedTimeError);const scenarios=h.predictedTimeScenarios;if(scenarios){const options=['standard','paceFavored','paceAdverse'].map(key=>({key,diff:Math.abs((timeToSec(scenarios[key])??Infinity)-actual)})).sort((a,b)=>a.diff-b.diff);if(Number.isFinite(options[0].diff))adv.timeScenario[options[0].key]++;}}

     const dist=String(r.race?.distance||'不明');
     const winError=h.win==null?null:Math.abs(Number(h.win)-(won?100:0)),placeError=h.place==null?null:Math.abs(Number(h.place)-(placed?100:0));
     pushGroup(adv.byDistance,dist,placed,won,winError,placeError,signedTimeError==null?null:Math.abs(signedTimeError));
     pushGroup(adv.byPopularity,band(h.popularity),placed,won);
     pushGroup(adv.byEvBand,evBand(h.ev),placed,won);
   }
 }
 adv.confidence=confidence;
 return adv;
}
function volatilityCalibration(races){
 const samples=[];
 for(const r of races){const prediction=r?.predictionSnapshot?.volatility;if(prediction?.volatilityIndex==null||resultOrder(r).length<3)continue;const actual=actualUpsetScore(r),p=clamp(Number(prediction.volatilityIndex),0,100),topPops=resultTop3(r).map(no=>Number(frozenHorseByNo(r,no)?.popularity)).filter(Number.isFinite);samples.push({race:r,p,actual:actual.score,event:actual.upset,has7:topPops.some(x=>x>=7),has10:topPops.some(x=>x>=10)})}
 const group=items=>({n:items.length,upset:items.filter(x=>x.event).length,orderly:items.filter(x=>!x.event).length,has7:items.filter(x=>x.has7).length,has10:items.filter(x=>x.has10).length});
 const high=group(samples.filter(x=>x.p>=70)),low=group(samples.filter(x=>x.p<=30)),mae=samples.length?mean(samples.map(x=>Math.abs(x.p-x.actual))):null,brier=samples.length?mean(samples.map(x=>(x.p/100-(x.event?1:0))**2)):null;
 const bands=[['0–29',0,29],['30–49',30,49],['50–69',50,69],['70–84',70,84],['85–100',85,100]].map(([label,min,max])=>({label,...group(samples.filter(x=>x.p>=min&&x.p<=max))}));
 const distanceBand=r=>{const d=Number(r?.race?.distance||r?.predictionSnapshot?.race?.distance);return d<=1000?'800–1000':d<=1400?'1200–1400':d<=1700?'1500–1700':d<=2000?'1800–2000':'2100以上'},fieldBand=r=>{const n=frozenHorses(r).length;return n<=8?'少頭数':n<=12?'中頭数':'多頭数'};
 const summarizeBy=keyFn=>{const out={};for(const x of samples){const key=keyFn(x.r),g=(out[key]??=[]);g.push(x)}return Object.fromEntries(Object.entries(out).map(([k,v])=>[k,group(v)]))};
 return {samples,high,low,mae,brier,bands,byTrack:summarizeBy(r=>r?.race?.track||r?.predictionSnapshot?.race?.track||'その他'),byDistance:summarizeBy(distanceBand),byField:summarizeBy(fieldBand)};
}
function renderVolatilityCalibration(races){
 const c=volatilityCalibration(races),rate=(n,d)=>d?`${(n/d*100).toFixed(1)}%`:'—';
 const headline=c.samples.length?`n=${c.samples.length}`:'蓄積待ち';
 const summary=`<div class="audit-grid"><div><span>波乱70%以上・実波乱率</span><strong>${rate(c.high.upset,c.high.n)}</strong><small>${c.high.upset}/${c.high.n}R</small></div><div><span>波乱30%以下・順当率</span><strong>${rate(c.low.orderly,c.low.n)}</strong><small>${c.low.orderly}/${c.low.n}R</small></div><div><span>指数 MAE</span><strong>${c.mae==null?'—':c.mae.toFixed(1)}</strong></div><div><span>Brier相当</span><strong>${c.brier==null?'—':c.brier.toFixed(3)}</strong></div><div><span>高波乱群 7人気以下TOP3</span><strong>${rate(c.high.has7,c.high.n)}</strong></div><div><span>高波乱群 10人気以下TOP3</span><strong>${rate(c.high.has10,c.high.n)}</strong></div></div>`;
 const rows=c.bands.map(g=>`<div class="calibration-row"><strong>${g.label}%</strong><span>対象 ${g.n}R・${sampleLabel(g.n)}</span><span>実波乱 ${rate(g.upset,g.n)} / 順当 ${rate(g.orderly,g.n)}</span><span>7人気以下 ${rate(g.has7,g.n)} / 10人気以下 ${rate(g.has10,g.n)}</span></div>`).join('');
 const groupRows=(title,obj)=>`<div class="volatility-group"><strong>${title}</strong>${Object.entries(obj).sort((a,b)=>b[1].n-a[1].n).slice(0,7).map(([key,g])=>`<span>${esc(key)} ${g.n}R｜実波乱 ${rate(g.upset,g.n)}</span>`).join('')||'<span>データなし</span>'}</div>`;
 const breakdown=`<div class="condition-grid volatility-breakdown">${groupRows('競馬場別',c.byTrack)}${groupRows('距離帯別',c.byDistance)}${groupRows('頭数別',c.byField)}</div>`;
 const note=c.samples.length?'<div class="metric-definition">予想時点に固定保存した波乱指数だけを、結果取得後の実波乱ラベルと比較します。候補重みは現行重みと分離し、自動で本番へ昇格しません。</div>':'<div class="metric-definition">Ver.9.9.26以降に予想時点の波乱指数Snapshotが蓄積されると較正結果を表示します。旧レースを結果から逆算して本番Snapshotへ書き戻すことはありません。</div>';
 return dashAccordion('volatility','波乱指数較正',headline,summary+rows+breakdown+note,{summaryText:c.samples.length?`高波乱 実波乱${rate(c.high.upset,c.high.n)}`:'データ不足'});
}
function dashAccordion(key,title,count,body,{open=false,summaryText=''}={}){
 const isOpen=dashboardUi.open[key]??open;
 return `<details class="dash-section stat-section dash-accordion" data-dash-key="${key}" ${isOpen?'open':''}><summary><strong>${title}</strong>${summaryText?`<span class="accordion-summary">${esc(summaryText)}</span>`:''}${count?`<b>${esc(count)}</b>`:''}<i></i></summary><div class="accordion-body">${body}</div></details>`;
}
function sampleLabel(n){return n<10?'低信頼':n<30?'参考':n<100?'中':'高'}
function ciLabel(success,total){const ci=wilsonInterval(success,total);return ci?`95%CI ${ci.low.toFixed(1)}–${ci.high.toFixed(1)}%`:'95%CI —'}
function renderGroupTable(title,obj,key){
 const entries=Object.entries(obj),row=([k,g])=>`<div class="condition-row"><strong>${esc(k)}</strong><span>対象 ${g.n}・${sampleLabel(g.n)}</span><span>勝 ${pct(g.win,g.n)}</span><span>TOP3 ${pct(g.place,g.n)}${g.timeError?.length?`・TIME ${mean(g.timeError).toFixed(2)}秒`:''}</span></div>`;
 const notable=[...entries].sort((a,b)=>b[1].n-a[1].n)[0];
 const note=notable?`${notable[0]} 複${pct(notable[1].place,notable[1].n)}`:'データなし';
 return dashAccordion(key,title,entries.length?`${entries.length}件`:'',entries.map(row).join('')||'<p class="muted">データなし</p>',{summaryText:note});
}


function validationQuality(r){
 const horses=frozenHorses(r),times=resultTimes(r),prob=horses.filter(h=>h.win!=null&&h.place!=null).length,market=horses.filter(h=>h.odds!=null&&h.popularity!=null).length,time=horses.filter(h=>times[String(h.horseNo)]).length,detail=(r.resultSnapshot?.horses||[]).filter(h=>h.last3f!=null||h.cornerPositions||h.bodyWeight!=null).length,total=horses.length;
 const integrity=verifySnapshotIntegrity(r),issues=[];if(prob<total)issues.push({code:'PROB_MISSING',label:'AI確率不足',detail:`${prob}/${total}頭`});if(!market)issues.push({code:'MARKET_MISSING',label:'実オッズ不足',detail:'予想時点の市場Snapshotなし'});if(time<Math.max(1,Math.ceil(total*.7)))issues.push({code:'TIME_MISSING',label:'実TIME不足',detail:`${time}/${total}頭`});if(detail<Math.max(1,Math.ceil(total*.5)))issues.push({code:'RESULT_DETAIL_MISSING',label:'結果詳細不足',detail:`${detail}/${total}頭`});if(integrity.status==='legacy')issues.push({code:'SNAPSHOT_UNVERIFIED',label:'Snapshot未検証',detail:'旧データのため改変検知情報なし'});if(integrity.mismatches.length)issues.push({code:'SNAPSHOT_CHANGED',label:'Snapshot改変検知',detail:integrity.mismatches.join(' / ')});if(integrity.temporalInvalid)issues.push({code:'TEMPORAL_INVALID',label:'時系列異常',detail:'結果取得日時が予想生成日時より前です'});
 if(integrity.referenceOnly){
  const temporalIssue=issues.find(x=>x.code==='TEMPORAL_INVALID');
  if(temporalIssue)Object.assign(temporalIssue,{code:'HISTORICAL_POST_RESULT',label:'過去研究・事後生成',detail:'結果取得後に生成したバックテスト予測。レース前予測の証明には使用しません'});
  issues.push({code:'BACKTEST_REFERENCE_ONLY',label:'過去研究・参考限定',detail:'EARLYの正式KPIとは分離。取得時刻と固定Snapshotは書き換えません'});
 }
 const score=[prob===total,market===total,time>=total*.7,detail>=total*.5].filter(Boolean).length;let grade=score===4?'A':score>=2?'B':'C';if(integrity.status==='legacy'&&grade==='A')grade='B';if(integrity.status==='invalid'||integrity.referenceOnly)grade='C';
 return {grade,score,total,probabilityCount:prob,marketCount:market,timeCount:time,detailCount:detail,integrity,issues};
}
function diagnosticsForRace(r){
 const order=resultOrder(r);
 const snap=top3Snapshot(r);
 const failures=[],checks=[];
 const topPick=snap[0] ? getHorseByNo(r,snap[0].horseNo) : null;
 const winner=getHorseByNo(r,order[0]);

 if(topPick && Number(topPick.horseNo)!==order[0]){
   if(topPick.popularity!=null && topPick.popularity<=3 && topPick.ev!=null && topPick.ev<90){
     failures.push({code:'MARKET_OVER',label:'人気・市場過大評価',detail:`FINAL◎ ${topPick.horseNo}番は${topPick.popularity}人気・期待${Math.round(topPick.ev)}%`});
   }
   if(topPick.valueMark){
     failures.push({code:'VALUE_OVER',label:'穴馬/期待値過大評価',detail:`FINAL◎に${topPick.valueMark}が重なり市場妙味を強く見過ぎた可能性`});
   }
   if(topPick.win!=null && topPick.win>=35 && !isTop3(r,topPick.horseNo)){
     checks.push({code:'PROB_CHECK',label:'AI勝率高評価馬敗退',detail:`AI勝率${topPick.win.toFixed(1)}%でTOP3外。単発では過大評価と断定しません。`});
   }
   const pt=timeToSec(topPick.predictedTime);
   const at=timeToSec(resultTimes(r)[String(topPick.horseNo)]);
   if(pt!=null && at!=null && Math.abs(pt-at)>=1.5){
     failures.push({code:'TIME_ERROR',label:'予想TIME誤差',detail:`FINAL◎のTIME誤差 ${Math.abs(pt-at).toFixed(2)}秒`});
   }
   const ax=topPick.predictionAxes;
   if(ax?.paceFitScore!=null&&ax.paceFitScore<45)failures.push({code:'PACE_AXIS_MISS',label:'展開評価ミス候補',detail:`FINAL◎の事前展開適性 ${ax.paceFitScore}`});
   if(ax?.distanceChangeFit!=null&&ax.distanceChangeFit<45)failures.push({code:'DISTANCE_CHANGE_MISS',label:'距離変更評価ミス候補',detail:`FINAL◎の距離変更適性 ${ax.distanceChangeFit}`});
   if(ax?.transferLevelScore>=75)failures.push({code:'TRANSFER_OVER',label:'転入レベル過大評価候補',detail:`FINAL◎の転入補正 ${ax.transferLevelScore}`});
   if(ax?.placeStabilityScore>=75&&!isTop3(r,topPick.horseNo))failures.push({code:'PLACE_STABILITY_OVER',label:'複勝安定性過大評価候補',detail:`FINAL◎の複勝安定 ${ax.placeStabilityScore}でTOP3外`});
 }
 if(winner){
   const winnerSnapRank=snap.findIndex(x=>Number(x.horseNo)===Number(winner.horseNo));
   if(winnerSnapRank<0){
     if(winner.overall!=null && topPick?.overall!=null && winner.overall+10 < topPick.overall){
       failures.push({code:'ABILITY_UNDER',label:'勝ち馬能力過小評価',detail:`勝ち馬${winner.horseNo}番の総合${winner.overall}を上位評価できず`});
     }
   }
 }
 const simulated=cloneData(frozenHorses(r));evaluateLongshots(simulated,r.predictionSnapshot?.race||r.race||{});const simMap=new Map(simulated.map(h=>[Number(h.horseNo),h]));
 order.slice(0,3).forEach(no=>{const original=getHorseByNo(r,no),candidate=simMap.get(Number(no));if(!original||Number(original.popularity)<7||original.valueMark)return;let code='LONGSHOT_MISS_GAP',label='市場乖離評価不足';if(candidate?.timeRank==null||candidate.timeRank>3){code='LONGSHOT_MISS_TIME';label='TIME評価不足'}else if((candidate.courseValueScore??0)<55){code='LONGSHOT_MISS_COURSE';label='条件適性評価不足'}else if((candidate.placeRank??99)>5){code='LONGSHOT_MISS_PLACE';label='AI TOP3率評価不足'}else if((candidate.paceFitScore??0)<55){code='LONGSHOT_MISS_PACE';label='展開評価不足'}failures.push({code,label,detail:`${original.horseNo}番（${original.popularity}人気）がTOP3。予想時Snapshotを基に取りこぼし要因を分類`})});
 const pace=String(r.race?.pace||'');
 const bias=String(r.predictionSnapshot?.race?.bias||r.race?.bias||'').trim();
 if(pace && /速|遅|ハイ|スロー/.test(pace)){
   checks.push({code:'PACE_CHECK',label:'展開確認',detail:`事前展開「${pace}」と実際のレース内容を要確認`});
 }
 if(/^(内有利|外有利|前有利|差し有利|フラット)(?:$|[・／/\s])/u.test(bias)){
   checks.push({code:'BIAS_CHECK',label:'馬場バイアス確認',detail:`事前馬場評価「${bias}」を結果と照合`});
 }
 if(topPick){const resultHorse=resultHorseByNo(r,topPick.horseNo),firstCorner=Number(String(resultHorse?.cornerPositions||'').match(/\d+/)?.[0]),field=Math.max(order.length,1),style=String(topPick.runningStyle||'');if(Number.isFinite(firstCorner)&&((/逃げ|先行/.test(style)&&firstCorner>Math.max(4,Math.ceil(field*.5)))||(/差し|追込/.test(style)&&firstCorner<=2)))checks.push({code:'POSITION_CHECK',label:'位置取り確認',detail:`事前脚質「${style}」に対し初角${firstCorner}番手。失敗断定せず展開を確認してください。`})}
 const quality=validationQuality(r);
 return {failures:failures.slice(0,4),checks:checks.slice(0,4),data:quality.issues,quality};
}
function failureReasonsForRace(r){return diagnosticsForRace(r).failures}
function legacyValueCandidates(horses){const copy=cloneData(horses);copy.forEach(h=>{h.valueMark='';h.valueType='';const p=num(h.popularity),overall=num(h.overall)??0,confidence=num(h.dataConfidence)??0,win=num(h.win)??0,place=num(h.place)??0,ev=num(h.ev);if(p!=null&&ev!=null&&overall>=72&&confidence>=58&&p>=6&&win>=5&&ev>=120){h.valueMark='💎';h.valueType='勝ち穴'}else if(p!=null&&overall>=60&&confidence>=50&&p>=7&&place>=18){h.valueMark='💎';h.valueType=p>=10?'大穴':'相手穴'}});return copy}
function compareLongshotModels(races){const models={legacy:{label:'旧穴馬ルール（参考再計算）',candidates:0,top3:0,win:0,roiN:0,roiReturn:0,capture7:0,target7:0,capture10:0,target10:0},next:{label:'現行シグナルルール（参考再計算）',candidates:0,top3:0,win:0,roiN:0,roiReturn:0,capture7:0,target7:0,capture10:0,target10:0}};for(const r of races){const frozen=frozenHorses(r),sets={legacy:legacyValueCandidates(frozen),next:evaluateLongshots(cloneData(frozen),r.predictionSnapshot?.race||r.race||{})};for(const [key,horses] of Object.entries(sets)){const g=models[key],picked=horses.filter(h=>h.valueMark),pickedNos=new Set(picked.map(h=>Number(h.horseNo)));g.candidates+=picked.length;for(const h of picked){if(isTop3(r,h.horseNo))g.top3++;if(horsePosition(r,h)===1)g.win++;const odds=settledWinOdds(r,h.horseNo);if(odds!=null){g.roiN++;if(horsePosition(r,h)===1)g.roiReturn+=odds}}for(const no of resultOrder(r).slice(0,3)){const h=frozenHorseByNo(r,no),p=Number(h?.popularity);if(p>=7){g.target7++;if(pickedNos.has(Number(no)))g.capture7++}if(p>=10){g.target10++;if(pickedNos.has(Number(no)))g.capture10++}}}}return models}
function predictionAxisEffectiveness(races){
 const defs=[['speedCeilingScore','speed_ceiling'],['placeStabilityScore','place_stability'],['paceFitScore','pace_fit'],['distanceChangeFit','distance_change'],['transferLevelScore','transfer_level'],['conditionProgressScore','condition_progress'],['predictionConsensus','prediction_consensus']],groups=Object.fromEntries(defs.map(([,label])=>[label,{label,n:0,top3:0}]));
 for(const r of races)for(const h of frozenHorses(r)){for(const [key,label] of defs){const value=num(h.predictionAxes?.[key]);if(value!=null&&value>=80){groups[label].n++;if(isTop3(r,h.horseNo))groups[label].top3++}}}
 return Object.values(groups);
}
function comparePredictionAxisModels(races){
 const make=label=>({label,races:0,topPickTop3:0,captured:0,winBrier:[],placeBrier:[],placeLongshots:0,placeLongshotTop3:0,capture7:0,target7:0,capture10:0,target10:0,marks:{'◎':{n:0,top3:0},'○':{n:0,top3:0},'▲':{n:0,top3:0}}}),current=make('現行モデル'),candidate=make('Prediction Axis候補');
 for(const r of races){const frozen=frozenHorses(r),finish=resultOrder(r),actual=new Set(finish.slice(0,3));if(!frozen.length||actual.size<3)continue;current.races++;candidate.races++;
   const official=top3Snapshot(r).slice(0,3);if(official[0]&&actual.has(Number(official[0].horseNo)))current.topPickTop3++;current.captured+=official.filter(h=>actual.has(Number(h.horseNo))).length;
   for(const h of frozen){const no=Number(h.horseNo),won=finish[0]===no?1:0,placed=actual.has(no)?1:0;if(num(h.win)!=null)current.winBrier.push((num(h.win)/100-won)**2);if(num(h.place)!=null)current.placeBrier.push((num(h.place)/100-placed)**2)}
   const simulated=cloneData(frozen);applyPredictionAxisReinforcement(simulated,r.predictionSnapshot?.race||r.race||{});const selected=simulated.filter(h=>['◎','○','▲'].includes(h.predictionAxes?.candidateMark));const selectedNos=new Set(selected.map(h=>Number(h.horseNo))),first=simulated.find(h=>h.predictionAxes?.candidateMark==='◎');if(first&&actual.has(Number(first.horseNo)))candidate.topPickTop3++;candidate.captured+=selected.filter(h=>actual.has(Number(h.horseNo))).length;
   for(const h of simulated){const no=Number(h.horseNo),won=finish[0]===no?1:0,placed=actual.has(no)?1:0,ax=h.predictionAxes;if(num(ax?.candidateWinRate)!=null)candidate.winBrier.push((num(ax.candidateWinRate)/100-won)**2);if(num(ax?.candidatePlaceRate)!=null)candidate.placeBrier.push((num(ax.candidatePlaceRate)/100-placed)**2);if(ax?.placeLongshotCandidate){candidate.placeLongshots++;if(placed)candidate.placeLongshotTop3++}const mark=ax?.candidateMark;if(candidate.marks[mark]){candidate.marks[mark].n++;if(placed)candidate.marks[mark].top3++}}
   for(const no of actual){const original=frozen.find(h=>Number(h.horseNo)===no),pop=num(original?.popularity);if(pop>=7){current.target7++;candidate.target7++;if(official.some(h=>Number(h.horseNo)===no))current.capture7++;if(selectedNos.has(no))candidate.capture7++}if(pop>=10){current.target10++;candidate.target10++;if(official.some(h=>Number(h.horseNo)===no))current.capture10++;if(selectedNos.has(no))candidate.capture10++}}
 }
 const finish=g=>({...g,topPickTop3Rate:g.races?pct(g.topPickTop3,g.races):'—',captureRate:g.races?pct(g.captured,g.races*3):'—',winBrier:g.winBrier.length?mean(g.winBrier):null,placeBrier:g.placeBrier.length?mean(g.placeBrier):null});return {current:finish(current),candidate:finish(candidate),adopted:false,decision:'実データのwalk-forwardで改善を確認後のみ正式採用'};
}
function aggregateDiagnostics(races,key='failures'){
 const map={};
 races.forEach(r=>diagnosticsForRace(r)[key].forEach(x=>{
   const g=(map[x.code]??={code:x.code,label:x.label,count:0});g.count++;
 }));
 return Object.values(map).sort((a,b)=>b.count-a.count);
}
function diagnosisSeverity(reasons){
 const codes=new Set(reasons.map(x=>x.code));
 if(['TIME_ERROR','ABILITY_UNDER'].some(x=>codes.has(x)))return {key:'major',label:'重大'};
 if(['MARKET_OVER','VALUE_OVER','LONGSHOT_MISS'].some(x=>codes.has(x)))return {key:'check',label:'要確認'};
 return {key:'minor',label:'軽微'};
}
function renderFailureAnalysis(races){
 const agg=aggregateDiagnostics(races,'failures'),checkAgg=aggregateDiagnostics(races,'checks'),dataAgg=aggregateDiagnostics(races,'data');
 const ranks=agg.length?agg.slice(0,6).map((x,i)=>{const rate=races.length?x.count/races.length*100:0;return `<button class="failure-rank${i<3?' is-top':''}" type="button" data-failure-code="${esc(x.code||'')}"><span class="rank-no">${i+1}</span><strong>${esc(x.label)}</strong><span>${x.count}R</span><b>${rate.toFixed(1)}%</b><i style="--rank-rate:${Math.min(100,rate)}%"></i></button>`}).join(''):'<p class="muted">データなし</p>';
 const summary=dashAccordion('failures','失敗原因ランキング',agg.length?`${agg.length}件`:'',ranks,{open:true,summaryText:agg[0]?.label||''});
 const compact=(list,label,key)=>dashAccordion(key,label,list.length?`${list.length}件`:'',list.map(x=>`<div class="condition-row"><strong>${esc(x.label)}</strong><span>${x.count}R</span><span>${races.length?(x.count/races.length*100).toFixed(1)+'%':'—'}</span></div>`).join('')||'<p class="muted">該当なし</p>',{summaryText:list[0]?.label||''});
 const filter=dashboardUi.diagnosisFilter;
 const rows=races.map(r=>{const diagnostics=diagnosticsForRace(r);return {r,diagnostics,reasons:[...diagnostics.failures,...diagnostics.checks,...diagnostics.data]}}).filter(x=>!filter||x.reasons.some(y=>y.code===filter)).sort((a,b)=>{
   const ac=a.reasons.filter(x=>x.code!=='NO_CLEAR').length,bc=b.reasons.filter(x=>x.code!=='NO_CLEAR').length;
   return bc-ac||String(b.r.race?.raceDate||'').localeCompare(String(a.r.race?.raceDate||''));
 });
 const cards=rows.map(({r,reasons,diagnostics})=>{
   const severity=diagnosisSeverity(diagnostics.failures),issueCount=diagnostics.failures.length;
   const section=(title,items)=>items.length?`<h4>${title}</h4>${items.map(x=>`<div class="failure-item"><strong>${esc(x.label)}</strong><span>${esc(x.detail)}</span></div>`).join('')}`:'';
   return `<details class="failure-card diagnosis-card severity-${severity.key}"><summary><span><strong>${esc(r.race?.track)} ${esc(r.race?.raceNo)}R</strong><small>${esc(r.race?.raceDate)}・品質${diagnostics.quality.grade}</small></span><b class="severity"><i></i>${issueCount?severity.label:'検証候補'}</b><em>失敗 ${issueCount}件</em></summary><div class="diagnosis-card-body">${section('実績ベースの失敗',diagnostics.failures)}${section('検証候補',diagnostics.checks)}${section('データ不足',diagnostics.data)}</div></details>`;
 }).join('')||'<p class="muted">該当レースはありません。</p>';
 const filterNote=filter?`<div class="diagnosis-filter-note"><span>${esc(agg.find(x=>x.code===filter)?.label||filter)}のみ表示</span><button type="button" id="clearDiagnosisFilter">解除</button></div>`:'';
 const detail=dashAccordion('diagnosis','レース別自動診断',`${rows.length}R`,`${filterNote}<div class="diagnosis-list">${cards}</div>`,{summaryText:filter?'絞り込み中':'問題レースを確認'}).replace('class="dash-section','id="diagnosisSection" class="dash-section');
 return summary+compact(checkAgg,'検証候補','validationChecks')+compact(dataAgg,'データ品質','dataQuality')+detail;
}

function renderImprovementPoints(races,adv){
 const agg=aggregateDiagnostics(races,'failures'),items=[];
 if(agg[0])items.push({tone:'warn',text:`${agg[0].label} ${agg[0].count}R`});
 const high=adv.byEvBand['250%以上'];if(high)items.push({tone:high.place/high.n<.15?'warn':'good',text:`期待値250%以上 TOP3 ${pct(high.place,high.n)}（n=${high.n}・${sampleLabel(high.n)}）`});
 const low=adv.byPopularity['10人気以下'];if(low)items.push({tone:low.place/low.n<.15?'warn':'good',text:`10人気以下 TOP3 ${pct(low.place,low.n)}（n=${low.n}・${sampleLabel(low.n)}）`});
 if(adv.timeAbs.length)items.push({tone:mean(adv.timeAbs)<=2?'good':'warn',text:`TIME MAE ${mean(adv.timeAbs).toFixed(2)}秒`});
 return `<section class="improvement-card"><div><p class="eyebrow">NEXT FOCUS</p><h3>今回の重要改善ポイント</h3></div><div class="improvement-list">${items.slice(0,4).map(x=>`<span class="is-${x.tone}">${x.tone==='good'?'✓':'⚠'} ${esc(x.text)}</span>`).join('')||'<span>検証データがありません。</span>'}</div></section>`;
}

function raceTimeMae(r){
 const times=resultTimes(r),values=frozenHorses(r).map(h=>{const p=timeToSec(h.predictedTime),a=timeToSec(times[String(h.horseNo)]);return p!=null&&a!=null?Math.abs(p-a):null}).filter(x=>x!=null);
 return values.length?mean(values):null;
}
function raceCaptured(r){const top3=resultTop3(r);return top3Snapshot(r).filter(x=>top3.includes(Number(x.horseNo))).length}
function renderSavedRaces(races){
 const isCentral=r=>raceTypeOf(r)==='JRA';
 let rows=races.filter(r=>dashboardUi.raceType==='all'||(dashboardUi.raceType==='central'?isCentral(r):!isCentral(r)));
 rows=rows.map(r=>({r,mae:raceTimeMae(r),captured:raceCaptured(r)}));
 rows.sort((a,b)=>dashboardUi.raceSort==='old'?String(a.r.race?.raceDate||'').localeCompare(String(b.r.race?.raceDate||'')):dashboardUi.raceSort==='mae'?(b.mae??-1)-(a.mae??-1):dashboardUi.raceSort==='capture'?a.captured-b.captured:String(b.r.race?.raceDate||'').localeCompare(String(a.r.race?.raceDate||'')));
 const visible=rows.slice(0,dashboardUi.raceLimit);
 const cards=visible.map(({r,mae,captured})=>{const resultState=getResultDisplayState(r),quality=validationQuality(r),timeN=Object.keys(resultTimes(r)).length,version=r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy',finalNo=r.finalSnapshot?.top3?.[0]?.horseNo,finalOdds=settledWinOdds(r,finalNo);return `<details class="dash-race-card"><summary><div><strong>${esc(r.race?.track)} ${esc(r.race?.raceNo)}R</strong><span>${esc(r.race?.raceDate)}</span></div><div><b>${resultState.finishOrder.join('-')}</b><span>結果</span></div><div><strong>◎○▲ ${captured}/3</strong><span>捕捉</span></div><div><strong>${mae!=null?mae.toFixed(2)+'秒':'—'}</strong><span>TIME MAE</span></div></summary><div class="saved-race-detail"><span>品質 ${quality.grade}</span><span class="integrity-${quality.integrity.status}">固定 ${quality.integrity.label}</span><span>モデル ${esc(version)}</span><span>市場 ${quality.marketCount}/${quality.total}</span><span>実TIME ${timeN}頭</span><span>FINAL確定単勝 ${finalOdds==null?'—':finalOdds.toFixed(1)+'倍'}</span><button type="button" class="open-saved-race" data-race-id="${esc(raceId(r.race))}">この予想を開く</button></div></details>`}).join('')||'<p class="muted">該当する保存レースはありません。</p>';
 const controls=`<div class="saved-filters"><label>区分<select id="savedRaceType"><option value="all">すべて</option><option value="central">中央</option><option value="local">地方</option></select></label><label>並び順<select id="savedRaceSort"><option value="new">新しい順</option><option value="old">古い順</option><option value="mae">TIME誤差大</option><option value="capture">捕捉低い順</option></select></label></div>`;
 const more=visible.length<rows.length?`<button type="button" id="moreSavedRaces" class="more-races">さらに${Math.min(10,rows.length-visible.length)}件表示</button>`:'';
 return dashAccordion('saved','保存レース',`${rows.length}件`,`${controls}<div class="saved-race-list">${cards}</div>${more}`,{summaryText:'10件ずつ表示'});
}
function renderIntegrityAudit(races){const counts={verified:0,legacy:0,invalid:0,snapshotComplete:0,snapshotMissing:0,resultComplete:0,resultMissing:0,cloudDiff:0};races.forEach(r=>{counts[verifySnapshotIntegrity(r).status]++;(r.predictionSnapshot?.horses?.length&&r.finalSnapshot?.top3?.length?counts.snapshotComplete++:counts.snapshotMissing++);(r.resultSnapshot?.finishOrder?.length>=3?counts.resultComplete++:counts.resultMissing++);if(r.cloudConflict)counts.cloudDiff++});const body=`<div class="audit-grid"><div><span>固定確認済</span><strong>${counts.verified}R</strong></div><div><span>旧データ未検証</span><strong>${counts.legacy}R</strong></div><div><span>改変・時系列要確認</span><strong>${counts.invalid}R</strong></div><div><span>Snapshot完全 / 不足</span><strong>${counts.snapshotComplete} / ${counts.snapshotMissing}</strong></div><div><span>結果完全 / 不足</span><strong>${counts.resultComplete} / ${counts.resultMissing}</strong></div><div><span>D1/ローカル差異</span><strong>${counts.cloudDiff}R</strong></div></div><div class="metric-definition">予想Snapshotは結果取得後も変更しません。D1と端末の同一キーに差異がある場合は自動上書きせず競合として保護します。</div>`;return dashAccordion('integrityAudit','研究データ監査',`${races.length}R`,body,{summaryText:counts.invalid||counts.cloudDiff?`要確認 ${counts.invalid+counts.cloudDiff}R`:'異常なし'})}

function renderPredictionAxisComparison(races){
 const c=comparePredictionAxisModels(races),row=g=>`<div class="calibration-row"><strong>${esc(g.label)}</strong><span>対象 ${g.races}R・◎TOP3 ${g.topPickTop3Rate}・3印捕捉 ${g.captureRate}</span><span>勝Brier ${g.winBrier==null?'—':g.winBrier.toFixed(3)} / 複Brier ${g.placeBrier==null?'—':g.placeBrier.toFixed(3)}</span><span>7人気以下 ${g.target7?pct(g.capture7,g.target7):'—'} / 10人気以下 ${g.target10?pct(g.capture10,g.target10):'—'}</span></div>`;
 const marks=Object.entries(c.candidate.marks).map(([mark,g])=>`<span>${mark} TOP3 ${g.n?pct(g.top3,g.n):'—'}（${g.top3}/${g.n}）</span>`).join('');
 const axes=predictionAxisEffectiveness(races).map(g=>`<div class="condition-row"><strong>${esc(g.label)} 80+</strong><span>n=${g.n}・${sampleLabel(g.n)}</span><span>実TOP3 ${g.n?pct(g.top3,g.n):'—'}</span></div>`).join('');
 const body=`${row(c.current)}${row(c.candidate)}<div class="axis-mark-summary">${marks||'<span>候補印データなし</span>'}</div><div class="condition-grid">${axes}</div><div class="metric-definition">候補軸は保存済み予想Snapshotの入力だけで読み取り比較します。結果から予想値を逆算せず、公式AI勝率・AI3着内率・FINAL・穴馬印は変更しません。${esc(c.decision)}</div>`;
 return dashAccordion('predictionAxes','Prediction Axis比較',c.candidate.races?`${c.candidate.races}R`:'蓄積待ち',body,{summaryText:'候補モデル・未採用'});
}

function renderCalibrationResearch(records){
 const engine=typeof window!=='undefined'?window.CHASS_CALIBRATION_RESEARCH:null;
 if(!ENABLE_CALIBRATION_RESEARCH||!engine)return '';
 const report=engine.buildCalibrationResearch(records,{minRaces:50});
 const metric=value=>value==null?'—':Number(value).toFixed(3);
 const seconds=value=>value==null?'—':`${Number(value).toFixed(2)}秒`;
 const organizationCard=organization=>{const data=report.organizations[organization],candidate=data.calibrationCandidates.win,topCandidate=data.calibrationCandidates.top3,eligibility=candidate.eligible||topCandidate.eligible?'Shadow比較可能':'50R未満・参考度低';return `<article class="calibration-research-card"><header><strong>${organization}</strong><span>${data.raceCount}R｜${eligibility}</span></header><div class="calibration-research-grid"><div><span>勝率 Brier</span><b>${metric(data.win.brier)}</b></div><div><span>勝率 Log Loss</span><b>${metric(data.win.logLoss)}</b></div><div><span>勝率 ECE</span><b>${metric(data.win.ece)}</b></div><div><span>TOP3 Brier</span><b>${metric(data.top3.brier)}</b></div><div><span>TOP3 Log Loss</span><b>${metric(data.top3.logLoss)}</b></div><div><span>TOP3 ECE</span><b>${metric(data.top3.ece)}</b></div><div><span>TIME MAE</span><b>${seconds(data.time.mae)}</b></div><div><span>TIME 中央値誤差</span><b>${seconds(data.time.medianError)}</b></div><div><span>TIME 最大誤差</span><b>${seconds(data.time.maxAbsoluteError)}</b></div></div><p>将来側30%で比較：勝率 ${esc(candidate.recommendedCandidate||'採用候補なし')}／TOP3 ${esc(topCandidate.recommendedCandidate||'採用候補なし')}</p><small>時間順不整合の除外 ${data.excludedTemporalCount}R。候補はtemperature・logistic・isotonic。自動昇格なし。</small></article>`};
 return dashAccordion('calibrationResearch','JRA / NAR 較正研究','Shadow',`<div class="calibration-research-list">${organizationCard('JRA')}${organizationCard('NAR')}</div><div class="metric-definition">固定Prediction Snapshotと後続Resultだけを時間順に評価します。本番の12,000回Simulation、TIME係数、AI確率は変更しません。50R未満は候補比較を行わず、50〜99Rも研究用低サンプルとして扱います。</div>`,{summaryText:'Brier・Log Loss・ECE・TIME'});
}

function dashboardKpiScope(records){
 try{
  const boundary=typeof window!=='undefined'?window.CHASS_EARLY_KPI_BOUNDARY:null;
  if(typeof boundary?.summarizeBrowserReferenceCohort==='function')return boundary.summarizeBrowserReferenceCohort(records);
 }catch{/* Missing or failed boundary never promotes reference records. */}
 return {status:'HOLD',reason:'BOUNDARY_READER_UNAVAILABLE',formalRaceCount:0,
  formalKpiReadiness:'HOLD',referenceRaceCount:Array.isArray(records)?records.length:null,
  sourceOriginAuthenticated:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
}
function dashboardBoundaryHtml(records){
 const scope=dashboardKpiScope(records),count=Array.isArray(records)?records.length:0;
 return `<h3>EARLY正式集計：HOLD</h3><p>この画面の保存データだけでは、レース前の正式固定を確認できません。下の数値は参考集計です。</p><p>参考表示 ${count}R｜この入口から正式成績への加算 0R</p><small>${scope.reason==='BOUNDARY_READER_UNAVAILABLE'?'境界確認を読み込めないため、正式判定を保留しています。':'JRA・NARの証拠付き集計は別の確認経路で扱います。T15/T5の欠損だけでEARLYを除外しません。'}</small>`;
}
function renderDashboard(){
 renderAutoResultQueue();
 renderCloudSyncState();
 renderCloudDatasetSummary();
 styleCloudDatasetHierarchy();
 const allRaces=getAllRaces(),tracks=[...new Set(allRaces.map(r=>r.race?.track).filter(Boolean))].sort(),modelVersions=[...new Set(allRaces.map(r=>r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy'))].sort(),now=new Date();
 const daysAgo=date=>{const d=new Date(`${date}T00:00:00`);return Number.isFinite(d.getTime())?Math.floor((now-d)/86400000):Infinity};
 const isCentral=r=>/中央|JRA/i.test(String(r.race?.category||''));
 const races=allRaces.filter(r=>{const version=String(r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy'),legacy=/legacy/i.test(version);return (dashboardUi.format==='all'||(dashboardUi.format==='legacy'?legacy:!legacy))&&(dashboardUi.raceType==='all'||(dashboardUi.raceType==='central'?isCentral(r):!isCentral(r)))&&(dashboardUi.track==='all'||r.race?.track===dashboardUi.track)&&(dashboardUi.period==='all'||daysAgo(r.race?.raceDate)<=Number(dashboardUi.period))&&(dashboardUi.quality==='all'||validationQuality(r).grade===dashboardUi.quality)&&(dashboardUi.modelVersion==='all'||version===dashboardUi.modelVersion)});
 if($('earlyKpiBoundary'))$('earlyKpiBoundary').innerHTML=dashboardBoundaryHtml(races);
 const filterBar=`<div class="dashboard-filterbar"><label>区分<select id="dashTypeFilter"><option value="central">中央（JRA）</option><option value="local">地方（NAR）</option></select></label><label>競馬場<select id="dashTrackFilter"><option value="all">全競馬場</option>${tracks.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>期間<select id="dashPeriodFilter"><option value="all">全期間</option><option value="0">今日</option><option value="7">直近7日</option><option value="30">直近30日</option></select></label><label>モデルVer.<select id="dashModelVersion"><option value="all">全Ver.</option>${modelVersions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>一覧品質<select id="dashQualityFilter"><option value="all">全品質</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label><label>分析品質<select id="dashAnalysisQuality"><option value="AB">A/B以上</option><option value="A">Aのみ</option><option value="all">全品質</option></select></label></div>`;
 document.querySelector('.dashboard-filterbar')?.remove();$('dashKpis').insertAdjacentHTML('beforebegin',filterBar);document.querySelector('.dashboard-filterbar')?.insertAdjacentHTML('beforeend','<label>形式<select id="dashFormatFilter"><option value="all">全形式</option><option value="current">現行形式</option><option value="legacy">旧形式</option></select></label>');
 const horses=races.flatMap(frozenHorses),diamonds=horses.filter(x=>x.valueMark||x.mark?.includes?.('💎')),warnings=horses.filter(x=>x.warningMark||x.warning);
 const hit=(race,h)=>isTop3(race,h.horseNo),win=(race,h)=>horsePosition(race,h)===1;
 let dh=0,wh=0;for(const race of races){frozenHorses(race).filter(h=>h.valueMark||h.mark?.includes?.('💎')).forEach(h=>{if(hit(race,h))dh++});frozenHorses(race).filter(h=>h.warningMark||h.warning).forEach(h=>{if(!hit(race,h))wh++})}
 const analysisRaces=races.filter(r=>dashboardUi.analysisQuality==='all'||validationQuality(r).grade==='A'||(dashboardUi.analysisQuality==='AB'&&validationQuality(r).grade==='B'));
 const adv=aggregateAdvanced(analysisRaces);
 const longshotKpi=compareLongshotModels(analysisRaces).next;
 let odds20Target=0,odds20Captured=0,diamondRoiN=0,diamondRoiWins=0,diamondRoiReturn=0;
 for(const race of analysisRaces){
   const frozen=frozenHorses(race),diamondNos=new Set(frozen.filter(h=>h.valueMark||h.mark?.includes?.('💎')).map(h=>Number(h.horseNo)));
   for(const no of resultOrder(race).slice(0,3)){const h=frozenHorseByNo(race,no),odds=settledWinOdds(race,no)??num(h?.odds);if(odds!=null&&odds>=20){odds20Target++;if(diamondNos.has(Number(no)))odds20Captured++}}
   for(const h of frozen.filter(x=>x.valueMark||x.mark?.includes?.('💎'))){const odds=settledWinOdds(race,h.horseNo);if(odds==null)continue;diamondRoiN++;if(horsePosition(race,h.horseNo)===1){diamondRoiWins++;diamondRoiReturn+=odds}}
 }
 $('dashKpis').innerHTML=[
   ['参考検証レース数',`${analysisRaces.length}R`],
   ['FINAL TOP3捕捉（参考）',adv.races?`${pct(adv.top3Captured,adv.races*3)}（${adv.top3Captured}/${adv.races*3}）`:'—'],
   ['穴候補の再計算捕捉（参考）',longshotKpi.target7?`${pct(longshotKpi.capture7,longshotKpi.target7)}（${longshotKpi.capture7}/${longshotKpi.target7}）`:'—'],
   ['TIME MAE（参考）',adv.timeAbs.length?`${mean(adv.timeAbs).toFixed(2)}秒（n=${adv.timeAbs.length}）`:'—']
 ].map(([a,b],i)=>`<div class="kpi dashboard-kpi kpi-${i+1}"><span>${a}</span><strong>${b}</strong></div>`).join('');
 document.querySelector('.validation-kpi-details')?.remove();
 $('dashKpis').insertAdjacentHTML('afterend',`<details class="validation-kpi-details"><summary>参考集計（${dashboardUi.raceType==='central'?'JRA':'NAR'}）</summary><div class="validation-kpi-grid">${[
   ['7人気以下TOP3捕捉',longshotKpi.target7?`${pct(longshotKpi.capture7,longshotKpi.target7)}（${longshotKpi.capture7}/${longshotKpi.target7}）`:'—'],
   ['10人気以下TOP3捕捉',longshotKpi.target10?`${pct(longshotKpi.capture10,longshotKpi.target10)}（${longshotKpi.capture10}/${longshotKpi.target10}）`:'—'],
   ['20倍以上TOP3捕捉',odds20Target?`${pct(odds20Captured,odds20Target)}（${odds20Captured}/${odds20Target}）`:'—'],
   ['💎複勝率',adv.diamondOfficialN?`${pct(adv.diamondOfficialHit,adv.diamondOfficialN)}（${adv.diamondOfficialHit}/${adv.diamondOfficialN}）`:'—'],
   ['💎単勝ROI',diamondRoiN?`${(diamondRoiReturn/diamondRoiN*100).toFixed(1)}%（${diamondRoiWins}/${diamondRoiN}）`:'—'],
   ['⚠️圏外率',warnings.length?`${pct(wh,warnings.length)}（${wh}/${warnings.length}）`:'—']
 ].map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('')}</div><p>TOP3捕捉率は◎○▲3頭のうち実際にTOP3へ入った割合。穴馬捕捉率は実際の7人気以下TOP3馬を💎候補が事前捕捉した割合です。</p></details>`);
 document.querySelector('.improvement-card')?.remove();
 document.querySelector('.validation-kpi-details').insertAdjacentHTML('afterend',renderImprovementPoints(races,adv));

 const modelStats=[
  ['勝率モデル',r=>[...frozenHorses(r)].sort((a,b)=>b.win-a.win)[0]],
  ['総合モデル',r=>[...frozenHorses(r)].sort((a,b)=>b.overall-a.overall)[0]],
  ['期待値モデル',r=>[...frozenHorses(r)].filter(h=>h.ev!=null).sort((a,b)=>b.ev-a.ev)[0]],
  ['CHASS FINAL',r=>{const no=r.finalSnapshot?.top3?.[0]?.horseNo;return frozenHorseByNo(r,no)||rankFinalFor(frozenHorses(r))[0]}]
 ];
 const modelRows=modelStats.map(([name,pick])=>{const m=modelPerformance(analysisRaces,pick);return `<div class="model-row"><strong>${name}</strong><span>対象 ${m.target}・${sampleLabel(m.target)}</span><b>${m.target?(m.wins/m.target*100).toFixed(1):'—'}%</b><small>TOP3 ${m.target?(m.top3/m.target*100).toFixed(1):'—'}%（${ciLabel(m.top3,m.target)}）・平均着順 ${m.positions.length?mean(m.positions).toFixed(2):'—'}・人気 ${m.popularity.length?mean(m.popularity).toFixed(1):'—'}・予想時オッズ ${m.forecastOdds.length?mean(m.forecastOdds).toFixed(1):'—'}</small><small class="roi-line">仮想単勝ROI ${m.roi==null?'—':m.roi.toFixed(1)+'%'}（的中 ${m.roiWins}/${m.roiN}・${sampleLabel(m.roiN)}）</small></div>`}).join('');
 const modelHtml=dashAccordion('models','モデル別成績','4モデル',`${modelRows}<div class="metric-definition">仮想単勝ROIは各モデル1位へ毎回100円相当を投じた参考計算です。NAR結果に確定単勝オッズがある対象だけを使用し、欠損レースは除外します。実際の購入成績ではありません。</div>`,{open:true,summaryText:'勝率・TOP3・ROI'});

 const calibrationRows=(title,obj)=>`<h4>${title}</h4>`+Object.entries(obj).map(([band,g])=>{const predicted=g.predicted/g.n,actual=g.actual/g.n*100,diff=actual-predicted;return `<div class="calibration-row"><strong>${band}</strong><span>n=${g.n}・${sampleLabel(g.n)}・${ciLabel(g.actual,g.n)}</span><span>平均 ${predicted.toFixed(1)}% / 実績 ${actual.toFixed(1)}% / ${diff>=0?'+':''}${diff.toFixed(1)}pt</span></div>`}).join('');
 const valueRows=Object.entries(adv.valueTypes).map(([type,g])=>`<div class="calibration-row"><strong>${esc(type)}</strong><span>n=${g.n}・${sampleLabel(g.n)}</span><span>勝 ${pct(g.win,g.n)} / TOP3 ${pct(g.top3,g.n)} / 単勝ROI ${g.roiN?(g.roiReturn/g.roiN*100).toFixed(1)+'%':'—'}（${g.roiWins}/${g.roiN}） / 人気 ${g.pop.length?mean(g.pop).toFixed(1):'—'}</span></div>`).join('');
 const warningRate=adv.warningN?adv.warningOut/adv.warningN*100:null,warningBase=adv.warningBaseN?adv.warningBaseOut/adv.warningBaseN*100:null;
 const calRows=`
   <div class="calibration-row"><strong>AI勝率</strong><span>Brier <b>${adv.winBrier.length?mean(adv.winBrier).toFixed(3):'—'}</b></span><span>MAE <b>${adv.winMae.length?mean(adv.winMae).toFixed(1)+'pt':'—'}</b></span></div>
   <div class="calibration-row"><strong>AI TOP3率</strong><span>Brier <b>${adv.placeBrier.length?mean(adv.placeBrier).toFixed(3):'—'}</b></span><span>MAE <b>${adv.placeMae.length?mean(adv.placeMae).toFixed(1)+'pt':'—'}</b></span></div>
   <div class="calibration-row"><strong>FINAL順位差</strong><span>平均 <b>${adv.finalRankAbs.length?mean(adv.finalRankAbs).toFixed(2):'—'}</b></span><span></span></div>
   <div class="calibration-row"><strong>💎成績</strong><span>対象 <b>${adv.diamondN}</b></span><span>勝 ${pct(adv.diamondWin,adv.diamondN)}・TOP3 ${pct(adv.diamondPlace,adv.diamondN)}</span></div><div class="calibration-row"><strong>💎正式複勝</strong><span>${adv.diamondOfficialN?`${pct(adv.diamondOfficialHit,adv.diamondOfficialN)}（${adv.diamondOfficialHit}/${adv.diamondOfficialN}）`:'—'}</span><span>${ciLabel(adv.diamondOfficialHit,adv.diamondOfficialN)}</span></div><div class="metric-definition">AI TOP3率は常に3着以内。正式複勝は8頭以上＝3着まで、5〜7頭＝2着まで、4頭以下＝発売対象外として別集計します。</div><div class="calibration-row"><strong>⚠圏外比較</strong><span>対象 ${warningRate==null?'—':warningRate.toFixed(1)+'%'}（${adv.warningOut}/${adv.warningN}）</span><span>同人気帯参考 ${warningBase==null?'—':warningBase.toFixed(1)+'%'} / 差 ${warningRate==null||warningBase==null?'—':`${warningRate-warningBase>=0?'+':''}${(warningRate-warningBase).toFixed(1)}pt`}</span></div>${valueRows?`<h4>穴馬タイプ別</h4>${valueRows}`:''}${calibrationRows('AI勝率帯別',adv.winCalibration)}${calibrationRows('AI TOP3率帯別',adv.placeCalibration)}`;
 const calHtml=dashAccordion('calibration','確率較正・精度','4指標',calRows,{summaryText:adv.winMae.length?`AI勝率 MAE ${mean(adv.winMae).toFixed(1)}pt`:''});

 const timeN=adv.timeError.length,timeMae=adv.timeAbs.length?mean(adv.timeAbs):null,timeMe=timeN?mean(adv.timeError):null,fast=adv.timeError.filter(x=>x<0).length,slow=adv.timeError.filter(x=>x>0).length,within1=adv.timeError.filter(x=>Math.abs(x)<=1).length,within2=adv.timeError.filter(x=>Math.abs(x)<=2).length,scenarioN=Object.values(adv.timeScenario).reduce((a,b)=>a+b,0);
 const timeRows=`<div class="calibration-row"><strong>全体</strong><span>n=${timeN}</span><span>MAE ${timeMae==null?'—':timeMae.toFixed(2)+'秒'} / ME ${timeMe==null?'—':timeMe.toFixed(2)+'秒'}</span></div><div class="calibration-row"><strong>方向</strong><span>速すぎ ${pct(fast,timeN)} / 遅すぎ ${pct(slow,timeN)}</span><span>±1秒 ${pct(within1,timeN)} / ±2秒 ${pct(within2,timeN)}</span></div>${['実績','補正'].map(type=>`<div class="calibration-row"><strong>${type}TIME</strong><span>n=${adv.timeByType[type].length}</span><span>MAE ${adv.timeByType[type].length?mean(adv.timeByType[type].map(Math.abs)).toFixed(2)+'秒':'—'}</span></div>`).join('')}<div class="calibration-row"><strong>最接近シナリオ</strong><span>標準 ${pct(adv.timeScenario.standard,scenarioN)} / 有利 ${pct(adv.timeScenario.paceFavored,scenarioN)}</span><span>不利 ${pct(adv.timeScenario.paceAdverse,scenarioN)}</span></div>`;
 const timeHtml=dashAccordion('timeValidation','TIME検証',timeN?`n=${timeN}`:'',timeRows,{summaryText:timeMae==null?'データ不足':`MAE ${timeMae.toFixed(2)}秒`});
 const versions={};analysisRaces.forEach(r=>{const version=r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy',g=(versions[version]??={n:0,win:0,top3:0,time:[]}),pick=r.finalSnapshot?.top3?.[0];g.n++;if(pick&&horsePosition(r,pick)===1)g.win++;if(pick&&isTop3(r,pick.horseNo))g.top3++;g.time.push(...aggregateAdvanced([r]).timeAbs)});
 const versionHtml=dashAccordion('modelVersions','モデルバージョン別',`${Object.keys(versions).length}件`,Object.entries(versions).map(([version,g])=>{const vr=analysisRaces.filter(r=>(r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy')===version),ls=compareLongshotModels(vr).next;return `<div class="condition-row"><strong>${esc(version)}</strong><span>${g.n}R・${sampleLabel(g.n)}</span><span>FINAL勝 ${pct(g.win,g.n)} / TOP3 ${pct(g.top3,g.n)}</span><span>TIME ${g.time.length?mean(g.time).toFixed(2)+'秒':'—'} / 穴TOP3 ${pct(ls.top3,ls.candidates)}</span><span>7人気以下捕捉 ${ls.target7?pct(ls.capture7,ls.target7):'—'} / 10人気以下 ${ls.target10?pct(ls.capture10,ls.target10):'—'}</span></div>`}).join('')||'<p class="muted">データなし</p>',{summaryText:Object.entries(versions).sort((a,b)=>b[1].n-a[1].n)[0]?.[0]||''});
 const longshotComparison=compareLongshotModels(analysisRaces),comparisonRows=Object.values(longshotComparison).map(g=>`<div class="calibration-row"><strong>${g.label}</strong><span>候補 ${g.candidates}頭 / TOP3 ${g.top3} / 勝 ${g.win}</span><span>7人気以下捕捉 ${g.target7?pct(g.capture7,g.target7):'—'}（${g.capture7}/${g.target7}）・10人気以下 ${g.target10?pct(g.capture10,g.target10):'—'}（${g.capture10}/${g.target10}）・単勝ROI ${g.roiN?(g.roiReturn/g.roiN*100).toFixed(1)+'%':'—'}</span></div>`).join(''),comparisonHtml=dashAccordion('longshotCompare','穴馬ロジック比較','シミュレーション',`${comparisonRows}<div class="metric-definition">保存済みの予想Snapshotを読み取り専用で比較します。過去データは書き換えず、結果から穴馬判定を作り直すこともありません。</div>`,{summaryText:`新 TOP3 ${longshotComparison.next.top3}頭`});
 const excluded=races.length-analysisRaces.length,analysisNote=`<div class="analysis-scope">参考母集団 ${races.length}R｜分析対象 ${analysisRaces.length}R｜品質フィルター除外 ${excluded}R</div>`;
 $('dashModels').innerHTML=`${analysisNote}<div class="dashboard-expand-tools"><span>詳細分析</span><button type="button" data-dash-expand="all">すべて開く</button><button type="button" data-dash-expand="none">すべて閉じる</button></div>${renderIntegrityAudit(races)}${renderVolatilityCalibration(analysisRaces)}${renderPredictionAxisComparison(analysisRaces)}${modelHtml}${versionHtml}${calHtml}${renderCalibrationResearch(analysisRaces)}${timeHtml}${comparisonHtml}${renderFailureAnalysis(analysisRaces)}<div class="condition-grid">${renderGroupTable('距離別',adv.byDistance,'distance')}${renderGroupTable('人気帯別',adv.byPopularity,'popularity')}${renderGroupTable('期待値帯別',adv.byEvBand,'ev')}</div>`;
 $('dashRaces').innerHTML=renderSavedRaces(races);
 bindDashboardUi();
}

function bindDashboardUi(){
 document.querySelectorAll('[data-dash-key]').forEach(d=>d.addEventListener('toggle',()=>{dashboardUi.open[d.dataset.dashKey]=d.open}));
 document.querySelectorAll('[data-dash-expand]').forEach(b=>b.onclick=()=>{const open=b.dataset.dashExpand==='all';document.querySelectorAll('[data-dash-key]').forEach(d=>{d.open=open;dashboardUi.open[d.dataset.dashKey]=open})});
 document.querySelectorAll('[data-failure-code]').forEach(b=>b.onclick=()=>{dashboardUi.diagnosisFilter=b.dataset.failureCode;dashboardUi.open.diagnosis=true;renderDashboard();requestAnimationFrame(()=>$('diagnosisSection')?.scrollIntoView({behavior:'smooth',block:'start'}))});
 if($('clearDiagnosisFilter'))$('clearDiagnosisFilter').onclick=()=>{dashboardUi.diagnosisFilter='';renderDashboard()};
 if($('savedRaceType')){$('savedRaceType').value=dashboardUi.raceType;$('savedRaceType').onchange=e=>{dashboardUi.raceType=e.target.value;dashboardUi.raceLimit=10;renderDashboard()}}
 if($('savedRaceSort')){$('savedRaceSort').value=dashboardUi.raceSort;$('savedRaceSort').onchange=e=>{dashboardUi.raceSort=e.target.value;dashboardUi.raceLimit=10;renderDashboard()}}
 if($('moreSavedRaces'))$('moreSavedRaces').onclick=()=>{dashboardUi.raceLimit+=10;dashboardUi.open.saved=true;renderDashboard()};
 const filters=[['dashTypeFilter','raceType'],['dashTrackFilter','track'],['dashPeriodFilter','period'],['dashModelVersion','modelVersion'],['dashFormatFilter','format'],['dashQualityFilter','quality'],['dashAnalysisQuality','analysisQuality']];
 filters.forEach(([id,key])=>{const el=$(id);if(!el)return;el.value=dashboardUi[key];el.onchange=e=>{dashboardUi[key]=e.target.value;dashboardUi.raceLimit=10;renderDashboard()}});
 document.querySelectorAll('.open-saved-race').forEach(button=>button.onclick=()=>{const saved=store.get(KEY,{})[button.dataset.raceId]||store.get(LEGACY_KEY,{})[button.dataset.raceId];if(!saved)return;activeRaceGeneration++;state=restoreSavedRace(saved);setRaceMode(raceTypeOf(state),{announce:false,preserveState:true});fillRace(state.race);document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='predictionView'));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='predictionView'));render();requestAnimationFrame(()=>$('finalCard')?.scrollIntoView({behavior:'smooth',block:'start'}))});
}
function migrateLegacy(){
 const old=store.get(LEGACY_KEY,{}),now=store.get(KEY,{});
 let changed=false;
 Object.entries(old).forEach(([rid,r])=>{if(!now[rid]){now[rid]=r;changed=true;}});
 Object.values(now).forEach(r=>{if(migrateSnapshotRecord(r))changed=true});
 if(changed)store.set(KEY,now);
 const lc=store.get(LEGACY_CURRENT,'');if(!store.get(CURRENT,'')&&lc)store.set(CURRENT,lc);
}
if(typeof window!=='undefined'&&window.__CHASS_TEST__){
 window.CHASS_TEST={
   APP_VERSION,BACKUP_SCHEMA_VERSION,dashboardKpiScope,dashboardBoundaryHtml,raceId,timeToSec,migrateSnapshotRecord,failureReasonsForRace,diagnosticsForRace,validationQuality,aggregateAdvanced,frozenHorses,resultTop3,isTop3,officialPlaceLimit,isOfficialPlace,wilsonInterval,resultHorseByNo,settledWinOdds,modelPerformance,stableStringify,snapshotFingerprint,cloudDescriptor,manifestMatches,researchContentFingerprint,stableRecordUpdatedAt,mergeCloudResearchRecord,restoreResearchFromCloud,refreshCloudResearchDataset,applyCloudResearchDataset,sealSnapshotIntegrity,verifySnapshotIntegrity,createResearchBackup,validateResearchBackup,mergeResearchBackup,initResearchStorage,initCloudResearch,syncRaceToCloud,syncAllResearchToCloud,fetchJsonSimple,evaluateLongshots,buildSignalSnapshot,applyFrozenSignalSnapshot,applyFrozenWarnings,resolveSignalSnapshot,warningScenarioFor,enforceSignalMarkExclusion,marketReadyForSignals,legacyValueCandidates,compareLongshotModels,axisGrade,distanceChangeAxis,transferLevelAxis,conditionProgressAxis,applyPredictionAxisReinforcement,predictionAxisEffectiveness,comparePredictionAxisModels,getResultDisplayState,predictionAvailability,normalizeResultFetchOutcome,postRaceFirstCheckAt,registerResultWaiting,nextResultCheckAt,resultQueueRetryPatch,resultQueueSummary,dueResultQueue,applyAutoFetchedResult,runAutoResultQueue,calculateCpsiFirst,previewCpsiFirst,runCpsiSourceAction,loadCpsiFromDrive,cpsiDriveSelection,cancelCpsiDriveRead,importCpsiFirstFile,renderCpsiFirstPreview,getCpsiFirstPreview(){return cloneData(cpsiFirstPreview)},resultFetchFeedback,resultQueueDetails,resultRetryAvailability,retryAutoResultFromUi,renderAutoResultDetails,diagnosticRows,volatilityLabel,volatilityRaceProfile,actualUpsetScore,volatilitySimilarity,volatilityHistoryBefore,calculateVolatilityIndex,volatilityCalibration,meetingSelectorResolution,transform,getStorageMode(){return researchStorageMode},getCloudState(){return {...cloudState,pending:cloudPending.size}},getCloudAudit(){return cloneData(cloudResearchAudit)},
   historicalRecord,buildNarEarlyResearchRecord,acquireNarEarlyResearchRecord,normalizeHorseStatus,horseStatusLabel,isEligibleHorse,applyScratchStatuses,buildScratchValidation,emptyRaceState,clearValidationTransient,restoreSavedRace,activeRaceIdentity,snapshotIdentity,layerMatchesActive,activeRaceContext,beginActiveRaceTransition,activeRequestMatches,resultFetchReadiness,historyDefaultState,migrateHistoryState,historyDateRange,historyMeetingPair,historyRequestMetrics,resetHistoryProgress,meetingEntryFresh,meetingEntriesForDate,selectorRaceNumbers,meetingSelectionValid,refreshMeetingSelector,getMeetingSelectorState(){return cloneData(meetingSelectorState)},setMeetingSelectorState(value){meetingSelectorState=cloneData(value)},raceTypeOf,marketSourceLabel,horseMarketText,horseRankGapText,horseShortComment,makeSnapshot,rankFinalFor,abilityMarks,reconcileMarketDerivedValues,setState(value){state=value},getState(){return state},getActiveRaceGeneration(){return activeRaceGeneration},saveRaceRecord,persistRecordIfChanged,PREODDS_POLICY_VERSION,preOddsFrozen,preOddsStats,preOddsStamp,schedulePreOddsFallback,applyMarketOdds,currentPublicApiUrl,currentPublicDayApiUrl,checkPublicApi,copyCurrentPublicApiUrl,copyCurrentPublicDayApiUrl,getStorageDiagnostics(){return {...storageDiagnostics}},resetStorageDiagnostics(){Object.keys(storageDiagnostics).forEach(key=>storageDiagnostics[key]=0)},getRaceCache(){return raceCache}
 };
 return;
}
initAutoRaceControls();
jraMeetingSelector=window.CHASS_JRA_MEETING?.create({isActive:()=>raceTypeOf(state)==='JRA',getGeneration:()=>activeRaceGeneration,onSelection:()=>{ensureJraRaceSelectionState({renderNow:true});$('jraRaceNo')?.dispatchEvent(new Event('input',{bubbles:true}));jraRaceClient?.selectionChanged();jraOddsClient?.cancel();jraResultClient?.cancel();}});
jraRaceClient=window.CHASS_JRA_RACE_CLIENT?.create({isActive:()=>raceTypeOf(state)==='JRA',getSelection:()=>({date:$('jraDate')?.value||'',track:$('jraCourse')?.value||'',race:Number($('jraRaceNo')?.value)}),getGeneration:()=>activeRaceGeneration,commit:commitJraOfficial});
jraOddsClient=window.CHASS_JRA_ODDS_CLIENT?.create({isActive:()=>raceTypeOf(state)==='JRA',getSelection:()=>({date:$('jraDate')?.value||'',track:$('jraCourse')?.value||'',race:Number($('jraRaceNo')?.value)}),getGeneration:()=>activeRaceGeneration,apply:commitJraOdds});
jraResultClient=window.CHASS_JRA_RESULT_CLIENT?.create({isActive:()=>raceTypeOf(state)==='JRA',getSelection:()=>({date:$('jraDate')?.value||'',track:$('jraCourse')?.value||'',race:Number($('jraRaceNo')?.value)}),getGeneration:()=>activeRaceGeneration,apply:commitJraResult,formatFailure:error=>resultFetchFeedback({...error,hasResult:(state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).length>=3}).text});
for(const id of ['jraDate','jraCourse','jraRaceNo']){
  const el=$(id);
  if(!el)continue;
  el.addEventListener('change',()=>{
    if(raceTypeOf(state)!=='JRA')return;
    ensureJraRaceSelectionState({renderNow:true});
    jraRaceClient?.selectionChanged();
    jraOddsClient?.cancel();
    jraResultClient?.cancel();
  });
}
if($('jraDate')&&!$('jraDate').value)$('jraDate').value=localIsoDate();
if($('autoRaceLoad'))$('autoRaceLoad').onclick=loadAutoRace;
if($('raceMode'))$('raceMode').onchange=e=>setRaceMode(e.target.value);
if($('jraDataFile'))$('jraDataFile').onchange=loadJraFile;
if($('jraAnalyze'))$('jraAnalyze').onclick=()=>{if(jraNormalizedDraft)commitJraNormalized(jraNormalizedDraft);else $('jraStatus').textContent='先にJRA JSONまたはCSVを読み込んでください。'};
if($('jraManualAnalyze'))$('jraManualAnalyze').onclick=analyzeJraManual;
function switchActiveRaceDraft(next,mode){const before=activeRaceIdentity(),after={organization:mode,raceId:raceId(next)};if(before.organization===after.organization&&before.raceId===after.raceId)return false;if(mode==='JRA')return activateJraSelectionState(next,{renderNow:false});beginActiveRaceTransition(mode,next);return true}
if($('autoTrack'))$('autoTrack').onchange=e=>{
  if($('track'))$('track').value=e.target.value;
  const before=Number($('autoRaceNo')?.value)||null;renderMeetingSelector({message:before&&!selectorRaceNumbers(e.target.value).includes(before)?'開催会場変更に伴いレースを1Rへ変更しました。':''});switchActiveRaceDraft(raceFromForm(),'NAR');render();
};
if($('autoRaceDate'))$('autoRaceDate').onchange=e=>{
  if($('raceDate'))$('raceDate').value=e.target.value;
  switchActiveRaceDraft(raceFromForm(),'NAR');render();refreshMeetingSelector(e.target.value).catch(()=>{});
};
if($('autoRaceNo'))$('autoRaceNo').onchange=e=>{
  if($('raceNo'))$('raceNo').value=e.target.value;
  switchActiveRaceDraft(raceFromForm(),'NAR');render();
};
$('raceImportFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importFile(f)}catch(err){$('importStatus').textContent='取込失敗：'+err.message;alert($('importStatus').textContent)}e.target.value=''});
['category','raceDate','track','raceNo','distance','trackCondition','chaos','pace'].forEach(id=>$(id).addEventListener('input',()=>{const next=raceFromForm(),mode=/中央|JRA/.test(String(next.category||''))?'JRA':'NAR';if(!switchActiveRaceDraft(next,mode))state.race=next;render()}));
['jraDate','jraCourse','jraRaceNo'].forEach(id=>$(id)?.addEventListener('input',()=>{if(raceTypeOf(state)!=='JRA')return;const draft=jraRaceInput(),next={raceDate:draft.date,track:draft.racecourse,raceNo:draft.raceNo,raceName:draft.raceName,surface:draft.surface,distance:draft.distance,trackCondition:draft.trackCondition,weather:draft.weather,pace:draft.pace};if(switchActiveRaceDraft(next,'JRA'))render()}));
$('themeToggle').onclick=()=>document.body.classList.toggle('light');
document.querySelectorAll('.tab').forEach(b=>b.onclick=async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));if(b.dataset.view==='dashboardView'){renderDashboard();if(cloudState.available)await refreshCloudResearchDataset({persist:true,render:true})}});
bindHistoricalCollector();
$('narSync').onclick=syncNar;$('liveOddsSync').onclick=()=>syncLiveOdds(false);$('autoOdds').onchange=e=>setAutoOdds(e.target.checked);setAutoOdds(false);if($('autoResultToggle'))$('autoResultToggle').onchange=e=>setAutoResult(e.target.checked);$('saveValidation').onclick=saveValidation;$('recalcDash').onclick=async()=>{if(cloudState.available)await refreshCloudResearchDataset({persist:true,render:false});renderDashboard()};
if($('exportResearch'))$('exportResearch').onclick=()=>{try{const counts=downloadResearchBackup();$('backupStatus').textContent=`書き出し完了｜保存レース ${counts.races}件・オッズ履歴 ${counts.oddsHistories}件・照合資料 ${counts.holdEvidence}件`}catch(e){$('backupStatus').textContent='書き出し失敗｜'+e.message}};
if($('researchImportFile'))$('researchImportFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{setButtonBusy('exportResearch',true,'復元中');const result=await importResearchBackup(file);$('backupStatus').textContent=`復元完了｜追加・更新 ${result.imported}件 / 既存保持 ${result.skipped}件 / 不正 ${result.invalid}件`}catch(err){$('backupStatus').textContent='復元失敗｜'+err.message}finally{setButtonBusy('exportResearch',false);e.target.value=''}};
if($('cpsiDriveLoad'))$('cpsiDriveLoad').onclick=()=>loadCpsiFromDrive();
for(const id of ['raceMode','autoRaceDate','autoTrack','autoRaceNo','jraDate','jraCourse','jraRaceNo'])$(id)?.addEventListener('change',cancelCpsiDriveRead);
window.addEventListener('pagehide',()=>{cancelCpsiDriveRead();cpsiDriveReaderToken='';if($('cpsiDriveReaderKey'))$('cpsiDriveReaderKey').value='';});
for(const [id,action] of [['cpsiSourceSave','save'],['cpsiSourceRecover','recover'],['cpsiSourceExport','export']])if($(id))$(id).onclick=()=>runCpsiSourceAction(action);
if($('cpsiSourceFile'))$('cpsiSourceFile').onchange=event=>{const file=event.target.files?.[0];if(file)runCpsiSourceAction('import',file);event.target.value=''};
if($('cpsiFirstFile'))$('cpsiFirstFile').onchange=event=>{const file=event.target.files?.[0];if(file)importCpsiFirstFile(file);event.target.value=''};
if($('autoResultDetailsBody'))$('autoResultDetailsBody').onclick=event=>{const button=event.target.closest?.('[data-result-retry]');if(button&&!button.disabled)retryAutoResultFromUi(button.dataset.resultRetry)};
if($('autoResultMore'))$('autoResultMore').onclick=()=>{autoResultDetailLimit+=20;renderAutoResultDetails()};
if($('cloudSyncButton'))$('cloudSyncButton').onclick=async()=>{if(cloudState.status==='syncing')return;setButtonBusy('cloudSyncButton',true,'差分確認中');try{await syncAllResearchToCloud();renderCloudSyncState();renderDashboard()}catch(e){cloudState.status='error';cloudState.error=e.code||e.message;renderCloudSyncState()}finally{setButtonBusy('cloudSyncButton',false)} };
if($('publicApiCheck'))$('publicApiCheck').onclick=checkPublicApi;
if($('publicApiCopy'))$('publicApiCopy').onclick=copyCurrentPublicApiUrl;
if($('publicApiDayCopy'))$('publicApiDayCopy').onclick=copyCurrentPublicDayApiUrl;
if($('cloudRestoreButton'))$('cloudRestoreButton').onclick=()=>runCloudReadAction('restore');
if($('cloudRecheckButton'))$('cloudRecheckButton').onclick=()=>runCloudReadAction('recheck');
if($('cloudResultRepairButton'))$('cloudResultRepairButton').onclick=()=>runCloudReadAction('repair');
if($('cloudFingerprintRecoverButton'))$('cloudFingerprintRecoverButton').onclick=()=>runCloudReadAction('recover');
if($('cloudHoldAuditButton'))$('cloudHoldAuditButton').onclick=()=>runCloudReadAction('audit');
if($('cloudReferenceRestoreButton'))$('cloudReferenceRestoreButton').onclick=()=>runCloudReadAction('reference');
if($('quickPredict'))$('quickPredict').onclick=()=>raceTypeOf(state)==='JRA'?(jraNormalizedDraft?$('jraAnalyze')?.click():$('jraOfficialLoad')?.click()):$('autoRaceLoad')?.click();
if($('quickOdds'))$('quickOdds').onclick=()=>{const card=document.querySelector('.market-card');if(card)card.open=true;$('liveOddsSync')?.click();requestAnimationFrame(()=>card?.scrollIntoView({behavior:'smooth',block:'start'}))};
if($('quickResult'))$('quickResult').onclick=openResultValidation;
if($('quickToggle'))$('quickToggle').onclick=()=>{quickExpanded=!quickExpanded;renderQuick()};
document.querySelectorAll('[data-prediction-layer]').forEach(button=>button.onclick=()=>{predictionViewMode='original';render()});
if($('quickList')){
 $('quickList').onclick=e=>{const row=e.target.closest?.('.quick-row[data-horse-no]');if(row)openHorseDetail(row.dataset.horseNo)};
 $('quickList').onkeydown=e=>{if(e.key!=='Enter'&&e.key!==' ')return;const row=e.target.closest?.('.quick-row[data-horse-no]');if(row){e.preventDefault();openHorseDetail(row.dataset.horseNo)}};
}

async function bootApp(){
 ['autoRaceLoad','narSync','liveOddsSync'].forEach(id=>{const button=$(id);if(button)button.disabled=true});
 migrateLegacy();
 await initResearchStorage();
 await initCloudResearch();
 migrateLegacy();
 for(const [id,record] of Object.entries(raceCache)){if(!record?.predictionSnapshot||(record?.resultSnapshot?.finishOrder||record?.result?.finishOrder||[]).length)continue;if(!record.resultQueue)registerResultWaiting(record,id);if(record.resultQueue?.nextCheckAt)saveRaceRecord(id,{...record,updatedAt:record.updatedAt||new Date().toISOString()})}
 storageReady=true;setVersion();
 ['autoRaceLoad','narSync','liveOddsSync'].forEach(id=>{const button=$(id);if(button)button.disabled=false});
 const last=store.get(CURRENT,'')||store.get(LEGACY_CURRENT,''),db=store.get(KEY,{});
 if(last&&db[last]){state=restoreSavedRace(db[last]);state.predictionSaved=state.predictionSaved??!!state.predictionSnapshot;state.resultStatus=state.result?.finishOrder?.length>=3?'success':state.resultStatus||'waiting';state.validationCompleted=state.validationCompleted??!!(state.validated&&state.result?.finishOrder?.length>=3);state.horses=(state.horses||[]).map(h=>({...h,sourceMark:h.sourceMark||'',abilityMark:h.abilityMark||(['◎','○','▲','△'].includes(h.mark)?h.mark:''),valueMark:h.valueMark||(h.mark?.includes?.('💎')?h.mark:''),warningMark:h.warningMark||h.warning||'',finalMark:h.finalMark||''}));setRaceMode(raceTypeOf(state),{announce:false,preserveState:true});fillRace(state.race);render()}else{setRaceMode('NAR',{announce:false,preserveState:true});fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()}
 await refreshMeetingSelector($('autoRaceDate')?.value).catch(()=>{});
 renderAutoResultQueue();startAutoResultScheduler();
}
bootApp().catch(error=>{storageReady=true;researchStorageMode='localStorage-fallback';console.error('Storage initialization failed:',error);['autoRaceLoad','narSync','liveOddsSync'].forEach(id=>{const button=$(id);if(button)button.disabled=false});fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()});
})();
