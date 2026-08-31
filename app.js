(() => {
'use strict';
const APP_VERSION='9.9.22';
const BACKUP_SCHEMA_VERSION=1;
const $=id=>document.getElementById(id);
const KEY='chass_v90_races';
const LEGACY_KEY='chass_v80_races';
const CURRENT='chass_v90_current';
const LEGACY_CURRENT='chass_v80_current';
const ODDS_HISTORY='chass_v90_odds_history';
let oddsTimer=null;
let autoRaceSelectTimer=null;
let raceLoadController=null,liveOddsController=null;
let raceLoadGeneration=0,liveOddsGeneration=0;
let resultFetchInProgress=null;
let lastRaceFetchAudit=null;
let quickExpanded=false;
const dashboardUi={
 open:{models:true,calibration:false,failures:true,distance:false,popularity:false,ev:false,diagnosis:false,saved:false},
 diagnosisFilter:'',raceType:'all',track:'all',period:'all',quality:'all',analysisQuality:'AB',modelVersion:'all',format:'all',raceSort:'new',raceLimit:10
};
const NAR_TRACKS={
  '盛岡':10,'水沢':11,'浦和':18,'船橋':19,'大井':20,'川崎':21,'笠松':22,'金沢':23,
  '名古屋':24,'園田':27,'姫路':28,'高知':31,'佐賀':32,'門別':36
};
const HISTORY_COLLECTION_KEY='chass_history_collection_v1';
let historyCollection=null;
let historyCollectorRunning=false,historyCollectorAbort=false;
const num=v=>{const n=parseFloat(v);return Number.isFinite(n)?n:null};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cloneData=v=>v==null?v:JSON.parse(JSON.stringify(v));
function stableStringify(value){
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;
 return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function snapshotFingerprint(value){let hash=2166136261;const text=stableStringify(value);for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`}
const cleanName=s=>String(s??'').replace(/\s+/g,'').trim();
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function requestError(code,message,status=0){const e=new Error(message);e.code=code;e.status=status;return e}
async function responseJson(res){try{return await res.json()}catch{throw requestError('parser_error','API応答を解析できませんでした。',res.status)}}
async function fetchJsonSimple(url,{signal,timeoutMs=10000}={}){
 const controller=signal?null:new AbortController(),activeSignal=signal||controller.signal;
 const timer=controller?setTimeout(()=>controller.abort(),timeoutMs):null;
 try{
  const res=await fetch(url,{cache:'no-store',signal:activeSignal});
  const text=await res.text();
  let data;try{data=JSON.parse(text)}catch{throw requestError('parse_error','API応答を解析できませんでした。',res.status)}
  if(!res.ok)throw requestError(data?.errorCode||'http_error',data?.error||`HTTP ${res.status}`,res.status);
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
function diagnosticRows(audit={}){const rows=[],flight=audit.singleFlight,transport=audit.transportAudit;if(audit.requestId)rows.push(['Request ID',audit.requestId]);if(flight){rows.push(['取得種別',flight.priority||'']);rows.push(['Single-Flight',flight.mode||'']);rows.push(['Active raceId',flight.raceId||'']);if(flight.abortReason)rows.push(['Abort理由',flight.abortReason]);rows.push(['開始visibility',String(flight.visibilityStart??'')]);rows.push(['終了visibility',String(flight.visibilityEnd??'')]);rows.push(['開始online',String(flight.onlineStart??'')]);rows.push(['終了online',String(flight.onlineEnd??'')])}if(transport){for(const [key,label] of [['request','Request'],['headers','Headers'],['body','Body'],['json','JSON'],['payload','Payload']]){const x=transport[key];if(!x)continue;rows.push([`通常経路・${label}`,x.success?'成功':'失敗']);if(x.httpStatus!=null)rows.push([`${label}・HTTP`,String(x.httpStatus)]);if(x.bodyBytes!=null)rows.push([`${label}・Bytes`,String(x.bodyBytes)]);if(x.errorCode)rows.push([`${label}・エラー`,x.errorCode])}if(transport.primaryMs!=null)rows.push(['Primary時間',`${transport.primaryMs}ms`]);if(transport.totalMs!=null)rows.push(['Total時間',`${transport.totalMs}ms`]);if(transport.errorName)rows.push(['Error name',transport.errorName]);if(transport.errorMessage)rows.push(['Error message',transport.errorMessage])}const section=(title,x)=>{if(!x)return;rows.push([title,x.success===true?'成功':x.success===false?'失敗':'未使用']);if(x.stage)rows.push([`${title}・段階`,x.stage==='diagnostic_recovery_complete'?'復旧完了':x.stage]);if(x.httpStatus!=null)rows.push([`${title}・HTTP`,String(x.httpStatus)]);if(x.errorCode)rows.push([`${title}・エラー`,x.errorCode]);if(x.route)rows.push([`${title}・経路`,x.route]);if(x.parsedRows!=null)rows.push([`${title}・解析`,`${x.parsedRows}頭${x.finishOrder?.length?' / '+x.finishOrder.join('-'):''}`]);if(x.recoveryMs!=null)rows.push(['Recovery時間',`${x.recoveryMs}ms`]);for(const key of ['persist','cloud','validation','render'])if(x[key])rows.push([`${title}・${key}`,x[key]])};section('通常経路',audit.primarySyncAudit);section('復旧経路',audit.recoveryAudit);section('後処理',audit.postFetchAudit);if(transport||audit.primarySyncAudit||audit.recoveryAudit||audit.postFetchAudit)return rows;if(audit.apiOk!=null)rows.push(['API取得',audit.apiOk?'成功':'失敗']);if(audit.stage)rows.push(['取得段階',String(audit.stage)]);if(audit.errorCode)rows.push(['エラー',audit.errorCode]);return rows}
function renderResultDiagnostics(audit=state.resultFetchAudit){const box=$('resultDiagnostics'),body=$('resultDiagnosticsBody');if(!box||!body)return;const rows=diagnosticRows(audit||{});box.hidden=!rows.length;body.innerHTML=rows.map(([k,v])=>`<div class="diag-row"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join('')}
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
function stableRecordUpdatedAt(record){return record?.updatedAt||record?.predictionSnapshot?.createdAt||record?.predictionSnapshot?.generatedAt||record?.predictionCreatedAt||record?.resultSnapshot?.fetchedAt||record?.resultAcquiredAt||'1970-01-01T00:00:00.000Z'}
function cloudFingerprint(value){return value==null?null:snapshotFingerprint(value)}
function cloudDescriptor(raceId,record){return {raceId,modelVersion:String(record?.predictionSnapshot?.modelVersion||record?.modelVersion||'Legacy'),updatedAt:stableRecordUpdatedAt(record),status:record?.validationCompleted?'validated':record?.resultSnapshot?'result_fetched':'prediction_saved',predictionFingerprint:cloudFingerprint(record?.predictionSnapshot),marketFingerprint:cloudFingerprint(record?.marketSnapshot),finalFingerprint:cloudFingerprint(record?.finalSnapshot),resultFingerprint:cloudFingerprint(record?.resultSnapshot),validationFingerprint:cloudFingerprint(record?.validationSnapshot)}}
function manifestKey(item){return `${item?.raceId||''}|${item?.modelVersion||'Legacy'}`}
function manifestMatches(local,remote){return !!remote&&['predictionFingerprint','marketFingerprint','finalFingerprint','resultFingerprint','validationFingerprint'].every(key=>(local[key]||null)===(remote[key]||null))&&local.status===remote.status}
function researchContentFingerprint(record){return snapshotFingerprint({race:record?.race||null,predictionSnapshot:record?.predictionSnapshot||null,marketSnapshot:record?.marketSnapshot||null,finalSnapshot:record?.finalSnapshot||null,resultSnapshot:record?.resultSnapshot||null,validationSnapshot:record?.validationSnapshot||null,validationCompleted:!!record?.validationCompleted})}
function idbRequest(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB request failed'))})}
function openResearchDb(){return new Promise((resolve,reject)=>{if(!('indexedDB' in window)){reject(new Error('IndexedDB unavailable'));return}const req=indexedDB.open(RESEARCH_DB,RESEARCH_DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('races'))db.createObjectStore('races',{keyPath:'id'});if(!db.objectStoreNames.contains('oddsHistory'))db.createObjectStore('oddsHistory',{keyPath:'raceId'});if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'})};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error('IndexedDB open failed'));req.onblocked=()=>reject(new Error('IndexedDB upgrade blocked'))})}
async function idbGetAll(name){return idbRequest(researchDb.transaction(name,'readonly').objectStore(name).getAll())}
function idbPut(name,value){if(!researchDb)return Promise.reject(new Error('IndexedDB unavailable'));return new Promise((resolve,reject)=>{const tx=researchDb.transaction(name,'readwrite');tx.objectStore(name).put(value);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}
function idbPutMany(name,values){if(!researchDb)return Promise.reject(new Error('IndexedDB unavailable'));return new Promise((resolve,reject)=>{const tx=researchDb.transaction(name,'readwrite'),objectStore=tx.objectStore(name);values.forEach(value=>objectStore.put(value));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed'));tx.onabort=()=>reject(tx.error||new Error('IndexedDB write aborted'))})}
function queueStorageWrite(promise,fallback){promise.catch(()=>{researchStorageMode='localStorage-fallback';fallback?.()})}
function setCloudPending(id,pending=true){if(pending)cloudPending.add(id);else cloudPending.delete(id);localStore.set(CLOUD_PENDING_KEY,[...cloudPending]);renderCloudSyncState()}
function hydrateCloudRecord(record){if(!record)return record;const p=record.predictionSnapshot?.horses||[],m=new Map((record.marketSnapshot?.horses||[]).map(h=>[Number(h.horseNo),h])),f=new Map((record.finalSnapshot?.ranking||record.finalSnapshot?.top3||[]).map(h=>[Number(h.horseNo),h]));record.horses=p.map(h=>({...h,...m.get(Number(h.horseNo)),...f.get(Number(h.horseNo))}));record.actualTimes=record.resultSnapshot?.actualTimes||{};record.result=record.resultSnapshot?{finishOrder:record.resultSnapshot.finishOrder||[],actualTimes:record.actualTimes}:null;return record}
function mergeCloudResearchRecord(local,cloud,meta={}){const incoming=cloneData(cloud);if(!local)return hydrateCloudRecord({...incoming,cloudEligible:meta.eligible!==false,cloudExclusionReason:meta.exclusionReason||null});const sameModel=String(local?.predictionSnapshot?.modelVersion||local?.modelVersion||'Legacy')===String(incoming?.predictionSnapshot?.modelVersion||incoming?.modelVersion||'Legacy'),conflict=sameModel&&local.predictionSnapshot&&incoming.predictionSnapshot&&cloudFingerprint(local.predictionSnapshot)!==cloudFingerprint(incoming.predictionSnapshot);if(conflict)return hydrateCloudRecord({...local,cloudConflict:true,cloudConflictReason:'DUPLICATE_OR_CONFLICT'});const merged={...local};for(const key of ['race','predictionSnapshot','marketSnapshot','finalSnapshot','resultSnapshot','validationSnapshot'])if(!merged[key]&&incoming[key])merged[key]=incoming[key];for(const key of ['predictionCreatedAt','resultAcquiredAt','modelVersion'])if(!merged[key]&&incoming[key])merged[key]=incoming[key];if(merged.resultSnapshot?.finishOrder?.length>=3){merged.validationCompleted=true;merged.validated=true}merged.cloudEligible=meta.eligible!==false;merged.cloudExclusionReason=meta.exclusionReason||null;merged.updatedAt=merged.updatedAt||incoming.updatedAt;return hydrateCloudRecord(merged)}
function applyCloudResearchDataset(data,{merge=true}={}){const records=Array.isArray(data?.records)?data.records:[],conflicts=[];if(merge){for(const item of records){if(!item?.raceId||!item.record)continue;const merged=mergeCloudResearchRecord(raceCache[item.raceId],item.record,item);if(merged.cloudConflict)conflicts.push({raceId:item.raceId,modelVersion:item.record?.modelVersion,reason:'DUPLICATE_OR_CONFLICT'});raceCache[item.raceId]=merged}}cloudResearchAudit={counts:data?.counts||null,exclusions:data?.exclusions||[],missingResults:data?.missingResults||[],warnings:data?.warnings||[],conflicts,eligibleRaceIds:records.filter(x=>x?.eligible).map(x=>x.raceId),datasetRaceIds:records.map(x=>x?.raceId).filter(Boolean),loadedAt:new Date().toISOString()};return records}
async function refreshCloudResearchDataset({persist=false,render=true}={}){if(typeof fetch!=='function'||!cloudState.available)return false;const generation=++cloudAuditRefreshGeneration;cloudState.status='refreshing';renderCloudSyncState();try{const data=await cloudRequest('/api/db/research');if(generation!==cloudAuditRefreshGeneration)return false;applyCloudResearchDataset(data,{merge:true});if(persist){if(researchDb)await idbPutMany('races',Object.entries(raceCache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));else localStore.set(KEY,raceCache)}cloudState={...cloudState,available:true,source:'cloud',status:'synced',error:'',lastSyncedAt:new Date().toISOString()};if(render){renderCloudDatasetSummary();renderDashboard()}return data}catch(e){if(generation===cloudAuditRefreshGeneration){cloudState={...cloudState,status:'error',error:e.code||e.message};renderCloudSyncState()}return false}}
function scheduleCloudResearchRefresh(delay=900){if(typeof window==='undefined'||window.__CHASS_TEST__)return;clearTimeout(cloudAuditRefreshTimer);cloudAuditRefreshTimer=setTimeout(()=>{cloudAuditRefreshTimer=null;refreshCloudResearchDataset({persist:true,render:true})},delay)}
async function restoreResearchFromCloud(){const data=await cloudRequest('/api/db/research'),before=Object.keys(raceCache).length,previous=new Map(Object.entries(raceCache).map(([id,record])=>[id,researchContentFingerprint(record)]));applyCloudResearchDataset(data,{merge:true});let added=0,enriched=0;for(const item of data.records||[]){if(!item?.raceId||!item.record)continue;const oldFingerprint=previous.get(item.raceId);if(oldFingerprint==null)added++;else if(researchContentFingerprint(raceCache[item.raceId])!==oldFingerprint)enriched++}if(researchDb)await idbPutMany('races',Object.entries(raceCache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));else localStore.set(KEY,raceCache);renderCloudDatasetSummary();return {added,enriched,total:Object.keys(raceCache).length,before,counts:data.counts||{}}}
async function cloudRequest(path,options={}){const response=await fetch(path,{cache:'no-store',...options,headers:{'content-type':'application/json',...(options.headers||{})}}),data=await response.json().catch(()=>({ok:false,error:'invalid_response'}));if(!response.ok||!data.ok)throw Object.assign(new Error(data.error||`HTTP ${response.status}`),{status:response.status,code:data.error});return data}
async function syncRaceToCloud(id,data){if(typeof fetch!=='function'||!id||!data?.predictionSnapshot)return false;setCloudPending(id,true);try{const response=await cloudRequest('/api/db/sync',{method:'POST',body:JSON.stringify({raceId:id,record:data})});cloudState={...cloudState,available:true,source:'cloud',status:'synced',error:'',lastSyncedAt:new Date().toISOString()};setCloudPending(id,false);scheduleCloudResearchRefresh();return response.records?.[0]||{status:'unchanged',written:false}}catch(e){cloudState={...cloudState,status:cloudState.available?'error':'local',error:e.code||e.message};renderCloudSyncState();return false}}
async function syncAllResearchToCloud(){const entries=Object.entries(raceCache).filter(([,record])=>record?.predictionSnapshot);if(!entries.length)return {created:0,updated:0,unchanged:0,failed:0,total:0,target:0};cloudState.status='syncing';renderCloudSyncState();const manifest=await cloudRequest('/api/db/manifest'),remote=new Map((manifest.records||[]).map(item=>[manifestKey(item),item])),targets=entries.filter(([raceId,record])=>cloudPending.has(raceId)||!manifestMatches(cloudDescriptor(raceId,record),remote.get(manifestKey(cloudDescriptor(raceId,record)))));let created=0,updated=0,failed=0;for(let i=0;i<targets.length;i+=25){const batch=targets.slice(i,i+25).map(([raceId,record])=>({raceId,record}));batch.forEach(x=>setCloudPending(x.raceId,true));try{const result=await cloudRequest('/api/db/sync',{method:'POST',body:JSON.stringify({records:batch})});created+=result.created||0;updated+=result.updated||0;const successful=new Set((result.records||[]).map(x=>x.raceId));batch.forEach(x=>{if(successful.has(x.raceId))setCloudPending(x.raceId,false)})}catch(e){failed+=batch.length;cloudState={...cloudState,status:'error',error:e.code||e.message};break}}const unchanged=entries.length-targets.length;cloudState={...cloudState,available:true,source:'cloud',status:failed?'error':'synced',error:failed?cloudState.error:'',lastSyncedAt:new Date().toISOString(),summary:{created,updated,unchanged,failed}};renderCloudSyncState();if(!failed)await refreshCloudResearchDataset({persist:true,render:false});return {created,updated,unchanged,failed,total:entries.length,target:targets.length,synced:created+updated}}
async function initCloudResearch(){
 if(typeof fetch!=='function')return false;
 try{
  await cloudRequest('/api/db/health');cloudState={...cloudState,available:true,status:'connected',error:''};
  const manifest=await cloudRequest('/api/db/manifest'),remoteManifest=new Map((manifest.records||[]).map(item=>[manifestKey(item),item])),data=await cloudRequest('/api/db/research');applyCloudResearchDataset(data,{merge:true});
  const localDiff=new Set(Object.entries(raceCache).filter(([id,record])=>{if(!record?.predictionSnapshot)return false;const local=cloudDescriptor(id,record),remote=remoteManifest.get(manifestKey(local));return cloudPending.has(id)||!manifestMatches(local,remote)}).map(([id])=>id));
  if(researchDb)await idbPutMany('races',Object.entries(raceCache).map(([id,record])=>({id,data:record,updatedAt:stableRecordUpdatedAt(record)})));
  cloudState.source='cloud';researchStorageMode='d1+indexedDB';
  for(const id of new Set([...cloudPending,...localDiff]))if(raceCache[id])await syncRaceToCloud(id,raceCache[id]);
  renderCloudSyncState();renderCloudDatasetSummary();return true;
 }catch(e){cloudState={...cloudState,available:false,source:'local',status:'local',error:e.code||e.message};renderCloudSyncState();return false}
}
function saveRaceRecord(id,data){raceCache[id]=data;if(researchDb){const localWrite=idbPut('races',{id,data,updatedAt:stableRecordUpdatedAt(data)});queueStorageWrite(localWrite,()=>localStore.set(KEY,raceCache));localWrite.then(()=>syncRaceToCloud(id,data)).catch(()=>{})}else{localStore.set(KEY,raceCache);syncRaceToCloud(id,data)}}
function saveOddsHistory(id,history){oddsHistoryCache[id]=history;if(researchDb)queueStorageWrite(idbPut('oddsHistory',{raceId:id,history,updatedAt:new Date().toISOString()}),()=>localStore.set(ODDS_HISTORY,oddsHistoryCache));else localStore.set(ODDS_HISTORY,oddsHistoryCache)}
function saveCurrentRace(id){currentRaceCache=id;localStore.set(CURRENT,id);if(researchDb)queueStorageWrite(idbPut('settings',{key:'currentRace',value:id}),null)}
const store={get(k,d){if(k===KEY)return raceCache;if(k===ODDS_HISTORY)return oddsHistoryCache;if(k===CURRENT)return currentRaceCache;return localStore.get(k,d)},set(k,v){if(k===KEY){raceCache=v;if(researchDb)queueStorageWrite(idbPutMany('races',Object.entries(v).map(([id,data])=>({id,data,updatedAt:stableRecordUpdatedAt(data)}))),()=>localStore.set(KEY,raceCache));else localStore.set(KEY,v);return}if(k===ODDS_HISTORY){oddsHistoryCache=v;if(researchDb)queueStorageWrite(idbPutMany('oddsHistory',Object.entries(v).map(([raceId,history])=>({raceId,history,updatedAt:new Date().toISOString()}))),()=>localStore.set(ODDS_HISTORY,oddsHistoryCache));else localStore.set(ODDS_HISTORY,v);return}if(k===CURRENT){saveCurrentRace(v);return}localStore.set(k,v)}};
async function initResearchStorage(){
 try{
   researchDb=await openResearchDb();const [savedRaces,savedOdds,settings]=await Promise.all([idbGetAll('races'),idbGetAll('oddsHistory'),idbGetAll('settings')]);
   for(const row of savedRaces){const local=raceCache[row.id],localAt=Date.parse(local?.updatedAt||'')||0,dbAt=Date.parse(row.data?.updatedAt||row.updatedAt||'')||0;if(!local||dbAt>localAt)raceCache[row.id]=row.data}
   for(const row of savedOdds){if(!oddsHistoryCache[row.raceId])oddsHistoryCache[row.raceId]=row.history||[]}
   const savedCurrent=settings.find(x=>x.key==='currentRace')?.value;if(savedCurrent)currentRaceCache=savedCurrent;
   await Promise.all([idbPutMany('races',Object.entries(raceCache).map(([id,data])=>({id,data,updatedAt:stableRecordUpdatedAt(data)}))),idbPutMany('oddsHistory',Object.entries(oddsHistoryCache).map(([raceId,history])=>({raceId,history,updatedAt:new Date().toISOString()}))),idbPut('settings',{key:'migration',value:{schemaVersion:1,completedAt:new Date().toISOString(),source:'localStorage',legacyPreserved:true}})]);
   researchStorageMode='indexedDB';localStore.set(CURRENT,currentRaceCache);
 }catch(e){researchDb=null;researchStorageMode='localStorage-fallback';console.warn('IndexedDB fallback:',e?.message||e)}
}

let state={race:{},horses:[],result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null};
let resultFormRaceId='';

function setVersion(){
  document.title=`チャス競馬研究所 Ver.${APP_VERSION}`;
  const sp=document.querySelector('.topbar h1 span'); if(sp) sp.textContent=`Ver.${APP_VERSION}`;
}
function renderCloudSyncState(){if(typeof document==='undefined')return;const source=$('cloudSource'),status=$('cloudSyncStatus'),button=$('cloudSyncButton');if(source)source.textContent=cloudState.available?'クラウド D1':'ローカル IndexedDB';if(status){status.className='';if(cloudState.status==='syncing')status.textContent='差分確認中';else if(cloudState.status==='refreshing')status.textContent='D1再集計中';else if(cloudState.status==='error'){status.textContent=`同期エラー${cloudPending.size?`｜待ち ${cloudPending.size}件`:''}`;status.className='is-error'}else if(cloudPending.size)status.textContent=`同期待ち ${cloudPending.size}件`;else if(cloudState.status==='synced'){const s=cloudState.summary;status.textContent=s?(s.created+s.updated?`☁ 同期完了｜新規 ${s.created}件・更新 ${s.updated}件・変更なし ${s.unchanged}件`:'☁ 最新です｜同期対象 0件'):'☁ 同期済'}else status.textContent='ローカルのみ'}if(button)button.disabled=cloudState.status==='syncing'}
function renderCloudDatasetSummary(){if(typeof document==='undefined')return;const target=$('cloudDatasetSummary'),list=$('cloudExclusionList'),details=$('cloudExclusions'),c=cloudResearchAudit.counts;if(!target)return;if(!c){target.innerHTML='<span>Source: Local Cache｜クラウド未接続・ローカル集計</span>';if(details)details.hidden=true;return}const consistent=(c.consistency?.predictionBalance??(c.d1PredictionSaved===c.d1ResultFetched+c.resultMissing))&&(c.consistency?.resultBalance??(c.d1ResultFetched===c.validationEligible+c.excluded));target.innerHTML=`<div class="cloud-source-label">Source: Cloudflare D1</div><div class="cloud-summary-grid"><div class="cloud-stat"><span>予想保存</span><strong>${Number(c.d1PredictionSaved)||0}R</strong></div><div class="cloud-stat"><span>結果取得済</span><strong>${Number(c.d1ResultFetched)||0}R</strong></div><div class="cloud-stat"><span>検証可能</span><strong>${Number(c.validationEligible)||0}R</strong></div><div class="cloud-stat"><span>結果未取得</span><strong>${Number(c.resultMissing)||0}R</strong><small>予想保存済・結果待ち</small></div><div class="cloud-stat cloud-stat-wide"><span>データ不備除外</span><strong>${Number(c.excluded)||0}R</strong></div></div>${consistent?'':'<p class="cloud-consistency-warning">⚠ 集計整合性に差異あり</p>'}<div class="cloud-sync-help"><span>クラウドへ同期：端末の新規データをD1へ送信</span><span>クラウドから復元：D1のみのデータを端末キャッシュへ追加</span></div>`;const reasonLabel={PREDICTION_MISSING:'予想Snapshotなし',SNAPSHOT_INCOMPLETE:'Snapshot不完全',RESULT_INCOMPLETE:'結果不完全',LEGACY_UNVERIFIED:'旧データ未検証',DATA_QUALITY:'データ品質',DUPLICATE_OR_CONFLICT:'重複・競合',SCHEMA_MISMATCH:'スキーマ不一致'};const exclusions=[...(cloudResearchAudit.exclusions||[]),...(cloudResearchAudit.conflicts||[])];if(list)list.innerHTML=exclusions.map(x=>`<div class="cloud-exclusion-row"><strong>${esc(x.raceId)}</strong><span>${reasonLabel[x.reason]||esc(x.reason)}</span><small>${esc(x.date||'')} ${esc(x.track||'')} ${esc(x.raceNo||'')}R｜${esc(x.modelVersion||'Legacy')}</small></div>`).join('')||'<p class="muted">検証除外はありません。</p>';if(details)details.hidden=false;let missing=$('cloudMissingResults');if(!missing){target.insertAdjacentHTML('afterend','<details id="cloudMissingResults" class="cloud-exclusions"><summary>結果未取得の一覧</summary><div id="cloudMissingList"></div></details>');missing=$('cloudMissingResults')}const missingList=$('cloudMissingList'),items=cloudResearchAudit.missingResults||[];missing.querySelector('summary').textContent=`結果未取得の一覧 ${items.length}R`;missingList.innerHTML=items.map(x=>`<div class="cloud-exclusion-row"><strong>${esc(x.date)}｜${esc(x.track)} ${esc(x.raceNo)}R</strong><span>${esc(x.modelVersion||'Legacy')}</span><button type="button" class="cloud-open-missing" data-race-id="${esc(x.raceId)}">結果を取得</button></div>`).join('')||'<p class="muted">結果未取得はありません。</p>';missing.querySelectorAll('.cloud-open-missing').forEach(b=>b.onclick=()=>openMissingResultRace(b.dataset.raceId))}
function openMissingResultRace(id){const saved=raceCache[id];if(!saved)return;state=cloneData(saved);fillRace();render();setView('prediction');requestAnimationFrame(()=>{$('resultCard')?.scrollIntoView({behavior:'smooth',block:'start'});syncNar({auto:false})})}
function raceId(r={}){
 const d=String(r.raceDate||r.date||'').replaceAll('/','-');
 const t=String(r.track||'').trim();
 const n=String(r.raceNo||'').match(/\d+/)?.[0]||'';
 return d&&t&&n?`${d}|${t}|${n}`:'';
}
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
function abilityMarks(horses){
 const sorted=[...horses].sort((a,b)=>b.win-a.win);
 sorted.forEach(h=>h.abilityMark='');
 sorted.slice(0,4).forEach((h,i)=>h.abilityMark=['◎','○','▲','△'][i]);
}
function numericFeature(h,...keys){for(const key of keys){const path=key.split('.');let v=h;for(const part of path)v=v?.[part];const n=num(v);if(n!=null)return clamp(key.startsWith('scores.')&&n<=10?n*10:n,0,100)}return null}
function rankValues(horses,getter,{lower=false}={}){const rows=horses.map((h,i)=>({h,i,v:num(getter(h))})).filter(x=>x.v!=null).sort((a,b)=>lower?a.v-b.v:b.v-a.v),map=new Map();rows.forEach((x,i)=>map.set(x.h,i+1));return {map,count:rows.length,score(h){const rank=map.get(h);return rank==null?null:rows.length===1?100:100*(rows.length-rank)/(rows.length-1)}}}
function paceValueScore(h,horses,race){const stored=numericFeature(h,'features.paceFit','paceFitScore');if(stored!=null)return stored;const pace=String(race?.pace||''),style=String(h.runningStyle||''),escapeCount=horses.filter(x=>/逃げ/.test(String(x.runningStyle||''))).length;if(/逃げ/.test(style)&&escapeCount===1)return 90;if(/スロー|遅/.test(pace))return /逃げ|先行/.test(style)?82:/差し|追込/.test(style)?38:55;if(/ハイ|速/.test(pace))return /差し|追込/.test(style)?82:/逃げ/.test(style)?38:55;return null}
function weightedAvailable(parts){const valid=parts.filter(x=>x.value!=null&&Number.isFinite(x.value)),den=valid.reduce((s,x)=>s+x.weight,0);return den?valid.reduce((s,x)=>s+x.value*x.weight,0)/den:null}
function evaluateLongshots(horses,race={}){
 const ranks={win:rankValues(horses,h=>h.win),place:rankValues(horses,h=>h.place),overall:rankValues(horses,h=>h.overall),time:rankValues(horses,h=>timeToSec(h.predictedTime),{lower:true}),distance:rankValues(horses,h=>numericFeature(h,'features.distanceFit','scores.distanceFit','raw.distance')),course:rankValues(horses,h=>numericFeature(h,'features.courseFit','scores.courseFit','raw.course'))};
 const field=Math.max(horses.length,1),chaos=num(race.chaos)??50,threshold=chaos>=70?58:chaos<40?66:62;
 horses.forEach(h=>{h.valueMark='';h.valueType='';h.winValueMark='';h.placeValueMark='';h.timeValueFlag='';h.warningMark='';h.longshotReasons=[];const popularity=num(h.popularity),popPct=popularity==null?null:field===1?0:100*(popularity-1)/(field-1),abilityRanks=[ranks.win.map.get(h),ranks.place.map.get(h),ranks.overall.map.get(h),ranks.time.map.get(h)].filter(Boolean),abilityRank=abilityRanks.length?mean(abilityRanks):null,gap=popularity==null||abilityRank==null?null:clamp(100*(popularity-abilityRank)/Math.max(1,field-1),0,100),timeScore=ranks.time.score(h),distanceScore=numericFeature(h,'features.distanceFit')??ranks.distance.score(h),courseScore=numericFeature(h,'features.courseFit')??ranks.course.score(h),recentScore=numericFeature(h,'features.recentFormScore','features.consistencyScore'),paceScore=paceValueScore(h,horses,race),last3f=numericFeature(h,'features.last3fAbility'),rebound=numericFeature(h,'features.reboundScore','features.restPattern'),support=numericFeature(h,'features.weightEffect','features.trainerJockeyScore'),confidence=num(h.dataConfidence),base=clamp((num(h.overall)??0),0,100),marketGapScore=gap;
   const score=weightedAvailable([{value:base,weight:20},{value:timeScore==null?null:timeScore*(h.predictedTimeType==='補正'?.88:1),weight:15},{value:distanceScore,weight:10},{value:courseScore,weight:10},{value:recentScore,weight:10},{value:paceScore,weight:10},{value:marketGapScore,weight:10},{value:last3f,weight:5},{value:rebound,weight:5},{value:support,weight:5}]);
   h.longshotScore=score==null?null:Number(clamp(score+(chaos>=70?3:chaos<40?-3:0),0,100).toFixed(1));h.marketGapScore=marketGapScore==null?null:Number(marketGapScore.toFixed(1));h.timeValueScore=timeScore==null?null:Number(timeScore.toFixed(1));h.courseValueScore=weightedAvailable([{value:distanceScore,weight:1},{value:courseScore,weight:1}]);h.paceFitScore=paceScore;h.reboundScore=rebound;h.popularityPercentile=popPct;h.abilityRank=abilityRank==null?null:Number(abilityRank.toFixed(1));h.winRank=ranks.win.map.get(h)??null;h.placeRank=ranks.place.map.get(h)??null;h.overallRank=ranks.overall.map.get(h)??null;h.timeRank=ranks.time.map.get(h)??null;
   const reasons=[];if(h.timeRank!=null&&h.timeRank<=3&&timeScore>=55)reasons.push({code:'TIME_TOP',strength:timeScore>=75?2:1,label:`TIME ${h.timeRank}位`});if(gap!=null&&gap>=35)reasons.push({code:'MARKET_GAP',strength:gap>=60?2:1,label:`AI能力${Math.max(1,Math.round(abilityRank))}位 / ${popularity}人気`});if(distanceScore!=null&&(ranks.distance.map.get(h)<=3||distanceScore>=72))reasons.push({code:'DISTANCE_FIT',strength:distanceScore>=80?2:1,label:`距離適性 ${ranks.distance.map.get(h)||'上位'}`});if(courseScore!=null&&(ranks.course.map.get(h)<=3||courseScore>=72))reasons.push({code:'COURSE_FIT',strength:courseScore>=80?2:1,label:`同コース適性 ${ranks.course.map.get(h)||'上位'}`});if(recentScore>=72)reasons.push({code:'RECENT_CONTENT',strength:recentScore>=82?2:1,label:'近走内容・安定性'});if(paceScore>=75)reasons.push({code:'PACE_FIT',strength:paceScore>=88?2:1,label:/逃げ/.test(String(h.runningStyle))?'単騎・展開利':'展開適性'});if(last3f>=75)reasons.push({code:'LAST3F',strength:last3f>=85?2:1,label:'上がり性能'});if(rebound>=72)reasons.push({code:'REBOUND',strength:rebound>=82?2:1,label:'巻き返し余地'});h.longshotReasons=reasons.sort((a,b)=>b.strength-a.strength).slice(0,3);
   if(h.timeRank!=null&&h.timeRank<=3&&popularity>=7&&(h.overall??0)>=50)h.timeValueFlag='TIME穴';
   if(popularity>=1&&popularity<=3&&h.ev!=null&&h.ev<75)h.warningMark=h.ev<55?'⚠️⚠️⚠️':h.ev<65?'⚠️⚠️':'⚠️';
   h.longshotEligible=popularity!=null&&h.odds!=null&&h.ev!=null&&(popularity>=6||popPct>=45)&&(h.overall??0)>=50&&(confidence??0)>=42&&h.longshotScore>=threshold;
 });
 const eligible=horses.filter(h=>h.longshotEligible),reasonStrength=h=>h.longshotReasons.reduce((s,x)=>s+x.strength,0),canByOverall=h=>(h.overall>=70&&h.longshotReasons.length>=1)||(h.overall>=60&&h.longshotReasons.length>=1)||(h.overall>=50&&h.longshotReasons.length>=2),sort=(a,b)=>(b.longshotScore-a.longshotScore)||((b.ev||0)-(a.ev||0));
 const big=eligible.filter(h=>(h.popularity>=10||h.popularityPercentile>=75)&&h.longshotReasons.length>=2&&reasonStrength(h)>=3&&h.longshotScore>=70&&canByOverall(h)).sort(sort).slice(0,1),bigSet=new Set(big),win=eligible.filter(h=>!bigSet.has(h)&&canByOverall(h)&&(h.winRank<=Math.min(5,Math.ceil(field*.42))||h.win>=5)&&(h.ev>=105)&&(h.timeRank<=3||h.marketGapScore>=35||h.winRank<=4)).sort(sort).slice(0,2),used=new Set([...big,...win]),place=eligible.filter(h=>!used.has(h)&&canByOverall(h)&&(h.popularity>=7||h.popularityPercentile>=55)&&(h.placeRank<=Math.min(5,Math.ceil(field*.45))||h.place>=18)).sort(sort).slice(0,3);
 const assign=(h,type)=>{h.valueType=type;const power=reasonStrength(h);h.valueMark=type==='大穴'?'💎💎💎':h.longshotScore>=75&&power>=3?'💎💎':'💎';if(type==='勝ち穴')h.winValueMark=h.valueMark;else h.placeValueMark=h.valueMark};big.forEach(h=>assign(h,'大穴'));win.forEach(h=>assign(h,'勝ち穴'));place.forEach(h=>assign(h,'相手穴'));return horses;
}
function applyValueFlags(horses,race={}){return evaluateLongshots(horses,race)}
function transform(root){
 const r={...(root.meta||{}),...(root.race||{})};
 const src=Array.isArray(root.horses)?root.horses:[];
 if(src.length<2)throw new Error('horses配列が2頭未満です。');
 const dm=derive(src); const ot=oddsType(r.oddsType??root.oddsType); r.oddsType=ot; r.raceId=raceId(r);
 const horses=src.map((h,i)=>{
   const d=dm[i], win=num(h.aiWinRate??h.winRate??h.win??h.AI勝率)??d.win, place=num(h.aiPlaceRate??h.placeRate??h.place??h.AI複勝率)??d.place;
   return {
     horseNo:h.horseNo??h.horseNumber??h.馬番??i+1,
     horseName:h.horseName??h.horse??h.name??h.馬名??'',
     sourceMark:String(h.sourceMark??h.mark??''),
     popularity:num(h.popularity??h.pop??h.人気),
     odds:num(h.realOdds??h.finalOdds??h.odds??h.単勝オッズ),
     runningStyle:h.runningStyle??h.style??h.脚質??'不明',
     predictedTime:h.predictedTime??h.time??h.予想走破タイム??'',
     predictedTimeType:h.predictedTimeType??h.timeType??'',
     predictedTimeConfidence:num(h.predictedTimeConfidence)??null,
     predictedTimeScenarios:h.predictedTimeScenarios&&typeof h.predictedTimeScenarios==='object'?cloneData(h.predictedTimeScenarios):null,
     features:h.features&&typeof h.features==='object'?cloneData(h.features):null,
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
 abilityMarks(horses);
 if(ot==='実オッズ'){
   horses.forEach(h=>{if(h.odds!=null){h.ev=h.odds*h.win;h.fair=h.win>0?100/h.win:null;}});
   applyValueFlags(horses,r);
 }
 return {race:r,horses,result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null};
}
function normalizeCategory(v){
 const s=String(v||'').trim();
 if(s==='地方'||s==='地方競馬')return '地方競馬';
 if(s==='中央'||s==='中央競馬')return '中央競馬';
 return '地方競馬';
}
function fillRace(r){
 $('category').value=normalizeCategory(r.category);$('raceDate').value=(r.raceDate||r.date||'').replaceAll('/','-');$('track').value=r.track||'';$('raceNo').value=r.raceNo||'';
 if($('autoRaceDate'))$('autoRaceDate').value=$('raceDate').value;
 if($('autoTrack')&&NAR_TRACKS[r.track])$('autoTrack').value=r.track;
 if($('autoRaceNo')&&r.raceNo)$('autoRaceNo').value=String(r.raceNo);$('distance').value=r.distance||'';$('trackCondition').value=r.trackCondition||'不明';$('chaos').value=r.chaos??50;$('pace').value=r.pace||'標準';
}
function raceFromForm(){
 return {...state.race,category:$('category').value,raceDate:$('raceDate').value,track:$('track').value,raceNo:Number($('raceNo').value)||'',distance:Number($('distance').value)||'',trackCondition:$('trackCondition').value,chaos:Number($('chaos').value)||50,pace:$('pace').value||'標準'};
}
function finalScore(h){
 const evRaw=(h.ev??100)-100;
 const evBonus=evRaw<=0?clamp(evRaw*.025,-8,0):(h.overall??0)>=60?clamp(evRaw*.025,0,10):clamp(evRaw*.01,0,2);
 return (h.win||0)*.45+(h.place||0)*.15+(h.overall||0)*.25+evBonus+(h.dataConfidence||0)*.07;
}
function rankFinalFor(horses){
 const ability=[...horses].sort((a,b)=>(b.overall??0)-(a.overall??0)||(b.win??0)-(a.win??0));
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
 return {realCount,totalCount,hasRealOdds,hasReferenceOdds,label,finalLabel,mode};
}
function renderMarketDisplayState(){
 const m=getMarketDisplayState();
 if($('marketSummary'))$('marketSummary').textContent=m.hasRealOdds?`市場 ${m.realCount}/${m.totalCount}`:m.hasReferenceOdds?'市場 参考':'市場 未取得';
 if($('marketStatus'))$('marketStatus').textContent=m.finalLabel;
 if($('liveOddsBadge'))$('liveOddsBadge').textContent=m.label;
 return m;
}
function getResultDisplayState(raceState=state){
 const finishOrder=(raceState?.resultSnapshot?.finishOrder||raceState?.result?.finishOrder||[]).map(Number).filter(Number.isFinite).slice(0,3);
 const done=finishOrder.length>=3,manual=done&&raceState?.result?.source==='手動修正保存';
 const status=done?'fetched':raceState?.resultStatus||(!raceId(raceState?.race)?'unavailable':'pending');
 const label=manual?'手動修正あり':done&&raceState?.resultFetchError?'取得済｜再取得失敗':done?'検証済':status==='fetching'?'結果取得中':status==='error'?'通信失敗・再試行可能':status==='pending'?'結果待ち':'未取得';
 return {done,manual,finishOrder,status,label};
}
function restoreSavedResultFields(resultState=getResultDisplayState()){
 const rid=raceId(state.race);
 if(resultFormRaceId!==rid){['finish1','finish2','finish3','memo'].forEach(id=>{if($(id))$(id).value=''});if($('narStatus'))$('narStatus').textContent='';resultFormRaceId=rid}
 if(!resultState.done)return;
 resultState.finishOrder.forEach((no,i)=>{const input=$(`finish${i+1}`);if(input&&!input.value)input.value=no});
 if($('memo')&&!$('memo').value&&state.result?.memo)$('memo').value=state.result.memo;
}
function renderResultDisplayState(){
 const resultState=getResultDisplayState();
 if($('resultStatusBadge')){$('resultStatusBadge').textContent=resultState.label;$('resultStatusBadge').classList.toggle('is-done',resultState.done);$('resultStatusBadge').classList.toggle('is-manual',resultState.manual)}
 if($('resultState'))$('resultState').textContent=resultState.label;
 if($('narSync'))$('narSync').textContent=resultState.done?'結果を再取得・再検証':resultState.status==='error'?'結果を再取得':'結果を確認・検証';renderResultDiagnostics();
 if($('narStatus')&&!$('narStatus').textContent){
   $('narStatus').textContent=resultState.done?'公式結果を取得済みです。':resultState.status==='error'?'公式結果を確認できませんでした。再取得できます。':'結果待ち｜レース終了後に公式結果を取得できます。';
 }
 restoreSavedResultFields(resultState);
}
function openResultValidation(){
 const card=$('resultCard');if(!card)return;
 requestAnimationFrame(()=>card.scrollIntoView({behavior:'smooth',block:'start'}));
}
function snapshotRace(r=state.race){return {category:r.category||'',raceDate:r.raceDate||'',track:r.track||'',raceNo:r.raceNo||'',distance:r.distance||'',surface:r.surface||'',trackCondition:r.trackCondition||'',bias:r.bias||'',pace:r.pace||'',chaos:r.chaos??null}}
function longshotHorse(h){return {valueType:h.valueType||'',valueMark:h.valueMark||'',winValueFlag:h.winValueMark||'',placeValueFlag:h.placeValueMark||'',longshotScore:h.longshotScore??null,marketGapScore:h.marketGapScore??null,timeValueScore:h.timeValueScore??null,courseValueScore:h.courseValueScore??null,paceFitScore:h.paceFitScore??null,reboundScore:h.reboundScore??null,popularityPercentile:h.popularityPercentile??null,abilityRank:h.abilityRank??null,winRank:h.winRank??null,placeRank:h.placeRank??null,overallRank:h.overallRank??null,timeRank:h.timeRank??null,timeValueFlag:h.timeValueFlag||'',longshotReasons:Array.isArray(h.longshotReasons)?cloneData(h.longshotReasons):[]}}
function predictionHorse(h){return {horseNo:Number(h.horseNo),horseName:h.horseName,win:h.win,place:h.place,overall:h.overall,abilityScore:h.abilityScore??h.scores?.timeIndex??null,features:h.features?cloneData(h.features):null,predictedTime:h.predictedTime,predictedTimeType:h.predictedTimeType||'',predictedTimeConfidence:h.predictedTimeConfidence??null,predictedTimeScenarios:h.predictedTimeScenarios?cloneData(h.predictedTimeScenarios):null,abilityMark:h.abilityMark,sourceMark:h.sourceMark||'',dataConfidence:h.dataConfidence,runningStyle:h.runningStyle||'',weight:h.weight??null,...longshotHorse(h)}}
function marketHorse(h){return {horseNo:Number(h.horseNo),odds:h.odds??null,popularity:h.popularity??null,ev:h.ev??null,warningMark:h.warningMark||'',...longshotHorse(h)}}
function makeSnapshot(){
 const now=new Date().toISOString(),ranked=rankFinal();
 const top3=ranked.slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:['◎','○','▲'][i],rank:i+1,finalScore:finalScore(h),score:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,odds:h.odds,popularity:h.popularity,predictedTime:h.predictedTime}));
 if(!state.finalSnapshot||!state.validationCompleted)state.finalSnapshot={schemaVersion:2,modelVersion:APP_VERSION,generatedAt:now,createdAt:now,marketType:state.race.oddsType,oddsSnapshotType:state.race.oddsSnapshotType||'unknown',top3,ranking:ranked.map((h,i)=>({...top3.find(x=>x.horseNo===Number(h.horseNo)),horseNo:Number(h.horseNo),horseName:h.horseName,rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime}))};
 const marks=['◎','○','▲']; state.horses.forEach(h=>h.finalMark='');
 top3.forEach((x,i)=>{const h=state.horses.find(z=>Number(z.horseNo)===Number(x.horseNo));if(h)h.finalMark=marks[i]});
 if(!state.predictionSnapshot){
   state.predictionSnapshot={schemaVersion:3,featureSchemaVersion:1,modelVersion:APP_VERSION,generatedAt:now,createdAt:now,race:snapshotRace(),horses:state.horses.map(predictionHorse),locked:true};
 }
 state.snapshotSchemaVersion=state.predictionSnapshot?.schemaVersion||2;
 if(!state.marketSnapshot||!state.validationCompleted){state.marketSnapshot={schemaVersion:2,modelVersion:APP_VERSION,acquiredAt:state.race.oddsUpdatedAt||now,createdAt:state.race.oddsUpdatedAt||now,oddsSnapshotType:state.race.oddsSnapshotType||'unknown',horses:state.horses.map(marketHorse)}}
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
 if(!expected)return {status:temporalInvalid?'invalid':'legacy',label:temporalInvalid?'時系列異常':'未検証（旧データ）',verified:0,total:0,mismatches:[],temporalInvalid};
 const mismatches=[],keys=Object.keys(expected);for(const key of keys)if(record?.[key]&&snapshotFingerprint(record[key])!==expected[key])mismatches.push(key);
 const status=temporalInvalid||mismatches.length?'invalid':'verified';return {status,label:status==='verified'?'固定確認済':'改変・時系列要確認',verified:keys.length-mismatches.length,total:keys.length,mismatches,temporalInvalid};
}
function render(){
 setVersion(); state.race=raceFromForm(); const r=state.race,h=state.horses; const rid=raceId(r);
 $('raceTitle').textContent=r.track&&r.raceNo?`${r.track} ${r.raceNo}R`:'レース情報未入力';
 const usefulRaceName=r.raceName&&!/^(地方競馬\s*)?データ情報$/u.test(r.raceName)?r.raceName:'';
 $('raceMeta').textContent=usefulRaceName||(!h.length?'予想データファイルを読み込むと自動表示します。':'');
 $('raceMeta').hidden=!$('raceMeta').textContent;
 $('chaosBadge').textContent=`波乱 ${r.chaos??'—'}%`;$('paceBadge').textContent=`展開 ${r.pace||'—'}`;$('biasText').textContent=`馬場 ${r.bias||r.trackCondition||'—'}`;
 const prob=h.filter(x=>x.win!=null&&x.place!=null).length,time=h.filter(x=>x.predictedTime).length,marketState=getMarketDisplayState(r,h);
 const names=new Set(h.map(x=>cleanName(x.horseName))); const bad=h.some(x=>!x.horseName)||names.size!==h.length;
 $('integrityGrid').innerHTML=[['レースID',rid||'—'],['AI確率',`${prob}/${h.length}頭`],['予想TIME',`${time}/${h.length}頭`],['市場',marketState.label],['データ状態',bad?'要確認':'正常'],['保存方式',cloudState.available?'クラウド D1':researchStorageMode.includes('indexedDB')?'IndexedDB':'互換保存'],['生成方式',r.autoGenerated?'NAR自動':'JSON'],['評価モード',r.dataMode||'—']].map(([a,b])=>`<div><span>${a}</span><strong>${esc(b)}</strong></div>`).join('');
 if($('abilitySummary'))$('abilitySummary').textContent=`能力 ${prob}/${h.length||'—'}`;
 if($('dateSummary'))$('dateSummary').textContent=r.raceDate?String(r.raceDate).slice(5).replace('-','/'):'日付 —';
 if($('distanceSummary'))$('distanceSummary').textContent=r.distance?`${r.surface==='芝'?'芝':'ダ'}${r.distance}m`:'距離 —';
 if($('timeSummary'))$('timeSummary').textContent=`TIME ${time}/${h.length||'—'}`;
 if($('modeSummary'))$('modeSummary').textContent=r.dataMode||'データ待ち';
 if($('integrityStatus')){$('integrityStatus').textContent=bad?'要確認':'正常';$('integrityStatus').classList.toggle('good',!bad);$('integrityStatus').classList.toggle('warn',bad);}
 renderMarketDisplayState();renderResultDisplayState();renderCloudSyncState();renderFinal();renderValuePicks();renderQuick();renderHorses();
}
function renderFinal(){
 const h=state.horses;if(!h.length){$('finalBody').innerHTML='予想データを読み込むと自動表示します。';return}
 const picks=rankFinal().slice(0,3), marks=['◎','○','▲']; const diamond=h.filter(x=>x.valueMark).sort((a,b)=>(b.longshotScore||0)-(a.longshotScore||0)||(b.ev||0)-(a.ev||0))[0]; const warn=h.filter(x=>x.warningMark).sort((a,b)=>(a.ev||999)-(b.ev||999))[0];
 renderMarketDisplayState();
 $('finalBody').innerHTML=`<div class="final-grid">${picks.map((x,i)=>`<div class="final-pick final-pick-two-row"><div class="final-pick-head"><div class="final-mark">${marks[i]}</div><div class="final-no">${x.horseNo}</div><div class="final-name">${esc(x.horseName)}</div><div class="final-overall"><span>総合</span><b>${x.overall}</b></div></div><div class="final-pick-stats"><div class="final-metric"><span>勝</span><b>${x.win.toFixed(1)}%</b></div><div class="final-metric"><span>3着内</span><b>${x.place.toFixed(1)}%</b></div><div class="final-metric"><span>TIME</span><b>${esc(x.predictedTime||'—')}</b></div></div></div>`).join('')}</div><div class="flags"><div class="flag-box diamond">${diamond?`${diamond.valueMark} ${diamond.horseNo} ${esc(diamond.horseName)}｜穴スコア${diamond.longshotScore?.toFixed?.(0)??'—'}`:'💎 有力穴馬なし'}</div><div class="flag-box warning">${warn?`⚠ ${warn.horseNo} ${esc(warn.horseName)}｜期待${warn.ev.toFixed(0)}%`:'⚠ 注意馬なし'}</div></div>`;
}
function renderValuePicks(){const body=$('valuePicksBody');if(!body)return;const picks=state.horses.filter(h=>h.valueMark).sort((a,b)=>(b.longshotScore||0)-(a.longshotScore||0)||(b.ev||0)-(a.ev||0));body.innerHTML=picks.length?picks.map(h=>`<article class="value-pick"><div class="value-pick-head"><b>${h.valueMark} ${esc(h.valueType||'穴候補')} ${h.horseNo}番</b><strong>${Math.round(h.longshotScore||0)}</strong></div><h3>${esc(h.horseName)}</h3><p>AI能力${h.abilityRank==null?'—':Math.max(1,Math.round(h.abilityRank))}位 / ${h.popularity??'—'}人気${h.ev!=null?`｜期待${Math.round(h.ev)}%`:''}</p><div class="value-reasons">${(h.longshotReasons||[]).slice(0,3).map(r=>`<span>${esc(r.label)}</span>`).join('')}</div></article>`).join(''):'<div class="value-empty">💎 有力穴馬なし<br><small>根拠のない人気薄は表示しません。</small></div>'}
function displayMark(h){return [h.finalMark||h.abilityMark,h.valueMark,h.warningMark].filter(Boolean).join(' ')}
function compactMark(h){
 const base=h.finalMark||h.abilityMark||'·';
 const extra=h.valueMark?`💎${h.horseNo}`:h.warningMark?`⚠️${h.horseNo}`:'';
 return extra||base;
}
function renderQuick(){
 const h=state.horses;if(!h.length){$('quickList').innerHTML='馬データを入力すると一覧表示します。';return}
 const rows=[...h].sort((a,b)=>b.overall-a.overall);
 $('quickList').classList.toggle('show-all',quickExpanded);
 $('quickList').innerHTML=`<div class="quick-table-head horse-data-grid"><span>印</span><span>馬番</span><span>馬名</span><span>勝</span><span>3着内</span><span>TIME</span><span>総合</span></div>`+rows.map((x,i)=>`<div class="quick-row horse-data-grid${i>=4?' is-extra':''}" data-horse-no="${x.horseNo}" role="button" tabindex="0" aria-label="${esc(x.horseName)}の詳細分析を開く"><div class="quick-mark${x.valueMark?' is-value':x.warningMark?' is-alert':''}">${esc(compactMark(x))}</div><div class="quick-no">${x.horseNo}</div><div class="quick-name">${esc(x.horseName)}</div><div class="quick-stat"><span>勝</span><strong>${x.win.toFixed(1)}%</strong></div><div class="quick-stat"><span>3着内</span><strong>${x.place.toFixed(1)}%</strong></div><div class="quick-stat"><span>TIME${x.predictedTimeType?`(${esc(x.predictedTimeType)})`:''}</span><strong>${esc(x.predictedTime||'—')}</strong></div><div class="quick-stat"><span>総合</span><strong>${x.overall}</strong></div></div>`).join('');
 if($('quickToggle'))$('quickToggle').textContent=quickExpanded?'上位4頭に戻す':'全'+rows.length+'頭を見る ›';
}
function renderHorses(){
 const list=$('horseList');list.innerHTML=''; const tpl=$('horseTpl');
 state.horses.forEach(x=>{
   const n=tpl.content.cloneNode(true);n.querySelector('.horse-no').textContent=x.horseNo;n.querySelector('.horse-mark-name').textContent=`${displayMark(x)} ${x.horseName}`.trim();n.querySelector('.horse-sub').textContent=[x.runningStyle,x.popularity?`${x.popularity}人気`:'',x.odds?`${x.odds}倍`:''].filter(Boolean).join('｜');n.querySelector('.overall-pill').textContent=`総合 ${x.overall}`;n.querySelector('.m-win').textContent=x.win.toFixed(1)+'%';n.querySelector('.m-place').textContent=x.place.toFixed(1)+'%';n.querySelector('.m-time').textContent=x.predictedTime?`${x.predictedTime}${x.predictedTimeType?` ${x.predictedTimeType}`:''}`:'未推定';n.querySelector('.m-overall').textContent=x.overall; const raw=x.raw,sc=x.predictedTimeScenarios,ft=x.features;n.querySelector('.facts').innerHTML=`最高指数 ${raw.highest??'—'} / 5走平均 ${raw.avg5??'—'} / 距離 ${raw.distance??'—'} / コース ${raw.course??'—'} / 近走 ${raw.recent.length?raw.recent.join('→'):'—'} / 斤量 ${raw.kg??'—'}kg${sc?` / TIME 標準 ${esc(sc.standard)}・展開ハマり ${esc(sc.paceFavored)}・展開不利 ${esc(sc.paceAdverse)}`:''}`;n.querySelector('.logic').innerHTML=`評価モード ${esc(x.dataMode||'—')} / 指数スコア ${x.scores.timeIndex?.toFixed(1)??'—'} / 距離適性 ${x.scores.distanceFit?.toFixed(1)??'—'} / コース適性 ${x.scores.courseFit?.toFixed(1)??'—'} / 斤量補正 ${x.scores.weight?.toFixed(1)??'—'} / 信頼度 ${x.dataConfidence}%${x.predictedTimeConfidence!=null?` / TIME信頼度 ${x.predictedTimeConfidence}%`:''}${ft?` / 特徴量 近走${ft.recentFormScore??'—'}・距離${ft.distanceFit??'—'}・同場${ft.courseFit??'—'}・安定${ft.consistencyScore??'—'}`:''}${x.sourceMark?` / 元印 ${esc(x.sourceMark)}`:''}`;n.querySelector('.reason').textContent=x.reason||'根拠データなし';list.appendChild(n);
 });
}
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
 next.resultMarketSnapshot=existing.resultMarketSnapshot||next.resultMarketSnapshot;
 next.predictionSaved=existing.predictionSaved??next.predictionSaved;
 next.resultStatus=existing.result?.finishOrder?.length>=3?'fetched':existing.resultStatus||next.resultStatus;
 next.resultFetchedAt=existing.resultFetchedAt||next.resultFetchedAt;
 next.resultFetchCheckedAt=existing.resultFetchCheckedAt||next.resultFetchCheckedAt;
 next.validationCompleted=existing.validationCompleted??next.validationCompleted;
 next.validated=existing.validated??next.validated;
 if(locked&&Array.isArray(existing.horses)&&existing.horses.length)next.horses=existing.horses.map(h=>({...h}));
 if(existing.race?.oddsType==='実オッズ'){
   next.race.oddsType='実オッズ'; next.race.oddsUpdatedAt=existing.race.oddsUpdatedAt;
   const oldMap=new Map((existing.horses||[]).map(h=>[String(h.horseNo),h]));
   next.horses.forEach(h=>{const o=oldMap.get(String(h.horseNo));if(o?.odds!=null){h.odds=o.odds;h.popularity=o.popularity;h.ev=o.ev;h.fair=o.fair;h.valueMark=o.valueMark||'';h.warningMark=o.warningMark||'';}});
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
function abilityPlace(win,allWins){const w=Math.pow(Math.max(Number(win)||.01,.01),.72),den=allWins.reduce((s,x)=>s+Math.pow(Math.max(Number(x)||.01,.01),.72),0)||1;return Math.max(1,Math.min(88,300*w/den))}
function buildAbilityRoot(d,date,track,raceNo){
 const horses=Array.isArray(d.horses)?d.horses:[],ready=horses.filter(h=>Number.isFinite(Number(h.abilityWinRate))).length,wins=horses.map(h=>Number(h.abilityWinRate)||0),abilityMode=ready>=Math.max(2,Math.ceil(horses.length*.5));
 return {race:{category:'地方競馬',raceDate:date,track:d.track||track,raceNo,raceName:d.raceName||'',distance:d.distance||'',surface:d.surface||'ダート',weather:d.weather||'',trackCondition:d.trackCondition||'不明',chaos:d.chaos??50,pace:d.pace||'標準',bias:d.bias||'',oddsType:Array.isArray(d.odds)&&d.odds.length?'実オッズ':'オッズなし',oddsSnapshotType:d.oddsSnapshotType||(Array.isArray(d.odds)&&d.odds.length?'unknown':'none'),autoGenerated:true,dataSource:`NAR公式 Ver.${APP_VERSION}`,dataMode:abilityMode?'NAR自動・能力先行':'NAR自動・能力不足',autoModel:abilityMode?'NAR past-runs ability first + market second':'NAR past-runs insufficient; no market-as-ability fallback',predictedTimePolicy:'NAR公式の同距離・近距離実走TIMEから標準／展開ハマり／展開不利を推定'},horses:horses.map(h=>({horseNo:h.horseNo,horseName:h.horseName||`馬番${h.horseNo}`,popularity:h.popularity??null,realOdds:h.odds??null,runningStyle:h.runningStyle||'不明',weight:h.weight??null,jockey:h.jockey||'',trainer:h.trainer||'',sexAge:h.sexAge||'',timeIndex:h.timeIndex??null,fiveRaceAvgIndex:h.fiveRaceAvgIndex??null,distanceIndex:h.distanceIndex??null,courseIndex:h.courseIndex??null,recentIndex:Array.isArray(h.recentIndex)?h.recentIndex:[],abilityScore:h.abilityScore??null,features:h.features??null,abilityPriorOdds:h.abilityPriorOdds??null,predictedTime:h.predictedTime||'',predictedTimeType:h.predictedTimeType||'',predictedTimeConfidence:h.predictedTimeConfidence??null,predictedTimeScenarios:h.predictedTimeScenarios??null,aiWinRate:abilityMode?(h.abilityWinRate??null):null,aiPlaceRate:abilityMode&&Number.isFinite(Number(h.abilityWinRate))?abilityPlace(h.abilityWinRate,wins):null,dataMode:abilityMode?'NAR自動・能力先行':'NAR自動・能力不足',dataConfidence:h.dataConfidence??null,reason:h.reason||(abilityMode?'NAR公式過去走を能力側へ反映。実オッズは期待値判定のみで使用。':'解析可能な過去走が不足。市場を能力の代用には使用しません。')}))};
}
function commitAutoRaceData(d,{date,track,raceNo,recovered=false}={}){if(!Array.isArray(d.horses)||d.horses.length<2)throw requestError('parser_error','出走馬データを取得できませんでした');lastRaceFetchAudit=d.raceFetchAudit||null;renderRaceFetchDiagnostics();const root=buildAbilityRoot(d,date,track,raceNo),rid=raceId(root.race),db=store.get(KEY,{}),old=db[rid];state=mergeExisting(transform(root),old);fillRace(state.race);render();if(!state.finalSnapshot)makeSnapshot();state.predictionSaved=true;state.resultStatus=state.result?.finishOrder?.length>=3?'fetched':state.resultStatus||'pending';state.validationCompleted=!!(state.validationCompleted||state.validated&&state.result?.finishOrder?.length>=3);persist(old?.validated||false);const ready=d.quality?.abilityData??d.horses.filter(h=>h.abilityScore!=null).length,times=d.quality?.predictedTime??d.horses.filter(h=>h.predictedTime).length,actualTimes=d.quality?.predictedTimeActual??d.horses.filter(h=>h.predictedTimeType==='実績').length,adjustedTimes=d.quality?.predictedTimeAdjusted??d.horses.filter(h=>h.predictedTimeType==='補正').length,invalidNames=d.quality?.invalidHorseNames??d.horses.filter(h=>!h.horseName||/^\d+(?:円)?$/.test(String(h.horseName))).length,market=Array.isArray(d.odds)&&d.odds.length?`${d.odds.length}/${d.horses.length}`:'未取得',base=`Ver.${APP_VERSION}：NAR公式 ${d.horses.length}頭｜馬名異常 ${invalidNames}頭｜能力 ${ready}/${d.horses.length}｜TIME ${times}/${d.horses.length}（実績${actualTimes}・補正${adjustedTimes}）｜市場 ${market}`;$('autoRaceBadge').textContent=`能力 ${ready}/${d.horses.length}`;$('autoRaceStatus').textContent=`${base}｜予想保存済${recovered?'（診断復旧）':''}`;$('importStatus').textContent=`✓ Ver.${APP_VERSION} 自動生成：${state.horses.length}頭 / データ源 NAR公式 / Snapshot固定済`;return {base,ready}}
async function loadAutoRace(){
 const date=$('autoRaceDate')?.value,track=$('autoTrack')?.value,raceNo=Number($('autoRaceNo')?.value);
 const code=narCode(track);
 if(!date||!code||!raceNo){$('autoRaceStatus').textContent='日付・競馬場・レースを確認してください。';return}
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
   setTimeout(()=>{if(!isCurrent())return;syncNar({auto:true}).then(resultCheck=>{if(!isCurrent())return;const suffix=resultCheck?.complete?'｜公式結果・検証を自動保存':resultCheck?.pending?'｜結果待ち':resultCheck?.status==='error'?'｜予想取得成功・結果確認のみ再試行可':'';$('autoRaceStatus').textContent=committed.base+suffix}).catch(()=>{if(isCurrent())$('autoRaceStatus').textContent=committed.base+'｜予想取得成功・結果確認のみ再試行可'})},800);
 }catch(e){
   if(e?.name==='AbortError'||e?.code==='stale_request'||e?.code==='aborted')return;
   if(!isCurrent())return;
   try{const diag=await fetchNarSyncApi(`/api/nar/race-diagnostic?code=${code}&date=${encodeURIComponent(date)}&race=${raceNo}`,{signal:controller.signal,attempts:1}),d=diag.data;if(!isCurrent())return;const committed=commitAutoRaceData(d,{date,track,raceNo,recovered:true});$('autoRaceStatus').textContent=committed.base+'｜通常経路失敗後、診断復旧で予想保存済';setTimeout(()=>{if(isCurrent())syncNar({auto:true}).catch(()=>{})},800);return}catch(recoveryError){if(!isCurrent())return;lastRaceFetchAudit=recoveryError?.raceFetchAudit||null;renderRaceFetchDiagnostics();const hasSaved=state?.horses?.length>=2&&raceId(state.race)===requestedId;$('autoRaceBadge').textContent=hasSaved?'前回取得済':'取得失敗';$('autoRaceStatus').textContent=hasSaved?`前回取得済｜再取得失敗（${errorLabel(recoveryError)}） 保存済み予想は維持しています。`:`取得エラー｜${errorLabel(recoveryError)} 予想済みデータは削除していません。`}
 }finally{
   if(generation===raceLoadGeneration){raceLoadController=null;setButtonBusy('autoRaceLoad',false)}
 }
}

async function importFile(f){
 const text=(await f.text()).replace(/^\uFEFF/,'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');let root;try{root=JSON.parse(text)}catch(e){throw new Error('JSON構文エラー: '+e.message)}
 let next=transform(root);fillRace(next.race);const rid=raceId(next.race);const db=store.get(KEY,{});const legacy=store.get(LEGACY_KEY,{});next=mergeExisting(next,db[rid]||legacy[rid]);state=next;render(); if(!state.finalSnapshot)makeSnapshot();
 state.predictionSaved=true;
 state.resultStatus=state.result?.finishOrder?.length>=3?'fetched':state.resultStatus||'pending';
 state.validationCompleted=!!(state.validated&&state.result?.finishOrder?.length>=3);
 persist(existingValidated(rid));$('importStatus').textContent=`✓ Ver.${APP_VERSION}：${state.horses.length}頭読込 / AI勝率・TOP3率計算済 / TIME ${state.horses.filter(x=>x.predictedTime).length}頭 / ${state.race.oddsType}`;
}
function existingValidated(rid){
 const db=store.get(KEY,{}),legacy=store.get(LEGACY_KEY,{});
 return !!(db[rid]?.validated||legacy[rid]?.validated||state.result?.finishOrder?.length>=3);
}
function persist(validated=false){
 state.race=raceFromForm();const rid=raceId(state.race);if(!rid)return;
 const db=store.get(KEY,{}),old=db[rid];
 if(!state.finalSnapshot&&state.horses.length)makeSnapshot();
 if(!state.validationCompleted)sealSnapshotIntegrity(state,true);
 const draft={...old,...state,validated:validated||old?.validated||false,modelVersion:state.predictionSnapshot?.modelVersion||state.modelVersion||APP_VERSION,predictionCreatedAt:state.predictionSnapshot?.createdAt||state.predictionSnapshot?.generatedAt||state.predictionCreatedAt||null,resultAcquiredAt:state.resultSnapshot?.fetchedAt||state.resultFetchedAt||state.resultAcquiredAt||null},changed=!old||researchContentFingerprint(old)!==researchContentFingerprint(draft),record={...draft,updatedAt:changed?new Date().toISOString():stableRecordUpdatedAt(old)};
 saveRaceRecord(rid,record);saveCurrentRace(rid);
}
function narCode(track){return NAR_TRACKS[track]||null}
function applyMarketOdds(items, acquiredAt){
 if(!Array.isArray(items)||!items.length)return 0;
 const valid=items.map(x=>({horseNo:String(x.horseNo),odds:num(x.odds),popularity:num(x.popularity)})).filter(x=>x.horseNo&&x.odds!=null);
 if(state.validationCompleted){state.resultMarketSnapshot={schemaVersion:2,createdAt:acquiredAt||new Date().toISOString(),oddsSnapshotType:'unknown',horses:valid.map(x=>({horseNo:Number(x.horseNo),odds:x.odds,popularity:x.popularity}))};persist(true);return valid.length}
 const pop=[...valid].sort((a,b)=>a.odds-b.odds),popMap=new Map(pop.map((x,i)=>[x.horseNo,x.popularity??i+1])),map=new Map(valid.map(x=>[x.horseNo,x.odds]));
 state.horses.forEach(h=>{const k=String(h.horseNo),o=map.get(k);if(o!=null){h.odds=o;h.popularity=popMap.get(k)||null;h.ev=o*h.win;h.fair=h.win>0?100/h.win:null;}});
 abilityMarks(state.horses); applyValueFlags(state.horses,state.race); state.race.oddsType='実オッズ'; state.race.oddsUpdatedAt=acquiredAt||new Date().toISOString();
 if(!state.validationCompleted)state.marketSnapshot={schemaVersion:2,modelVersion:APP_VERSION,acquiredAt:state.race.oddsUpdatedAt,createdAt:state.race.oddsUpdatedAt,oddsSnapshotType:state.race.oddsSnapshotType||'unknown',horses:state.horses.map(marketHorse)};
 makeSnapshot();
 const rid=raceId(raceFromForm());
 if(rid){
   const history=[...(store.get(ODDS_HISTORY,{})[rid]||[])],previous=history.at(-1);
   const signature=list=>JSON.stringify((list||[]).map(x=>[Number(x.horseNo),num(x.odds),num(x.popularity)]));
   if(history.length<24&&(!previous||signature(previous.odds)!==signature(valid)))history.push({at:state.race.oddsUpdatedAt,odds:valid});
   saveOddsHistory(rid,history);
 }
 return valid.length;
}
async function syncLiveOdds(silent=false){
 const r=raceFromForm(),code=narCode(r.track);if(!code){$('liveOddsStatus').textContent='現在オッズ自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('liveOddsStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 liveOddsController?.abort();const controller=new AbortController(),generation=++liveOddsGeneration,requestedId=raceId(r);liveOddsController=controller;
 const isCurrent=()=>generation===liveOddsGeneration&&!controller.signal.aborted&&raceId(raceFromForm())===requestedId;
 if(!silent)setButtonBusy('liveOddsSync',true,'オッズ取得中…');
 if(!silent)$('liveOddsStatus').textContent='NAR公式の現在オッズを確認中…';
 try{
   const u=`/api/nar/odds?code=${code}&date=${encodeURIComponent(r.raceDate)}&race=${r.raceNo}`,res=await fetch(u,{cache:'no-store',signal:controller.signal}),d=await responseJson(res);
   if(!res.ok)throw requestError(d.errorCode||'nar_temporary',d.error||'取得失敗',res.status);if(!isCurrent())throw requestError('stale_request','古いオッズ取得を破棄しました。');
   const count=applyMarketOdds(d.odds,d.acquiredAt);if(!count)throw requestError('odds_unpublished','現在オッズはまだ公開されていません。');
   render();persist(existingValidated(raceId(r)));const t=new Date(state.race.oddsUpdatedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',second:'2-digit'});renderMarketDisplayState();$('liveOddsStatus').textContent=`NAR公式 現在オッズ ${count}頭反映｜更新 ${t}｜人気・期待回収率・穴馬/危険馬を再計算済み`;
 }catch(e){if(e?.name==='AbortError'||e?.code==='stale_request'||!isCurrent())return;renderMarketDisplayState();$('liveOddsStatus').textContent=e?.code==='odds_unpublished'?'現在オッズはまだ公開されていません。':`取得エラー｜${errorLabel(e)}`}
 finally{if(generation===liveOddsGeneration){liveOddsController=null;if(!silent)setButtonBusy('liveOddsSync',false)}}
}
function setAutoOdds(on){if(oddsTimer){clearInterval(oddsTimer);oddsTimer=null}if(on){syncLiveOdds();oddsTimer=setInterval(()=>syncLiveOdds(true),60000)}if($('autoOddsState')){$('autoOddsState').textContent=on?'ON':'OFF';$('autoOddsState').classList.toggle('is-on',on)}}

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
   source,
   autoSaved:true
 };
 state.resultSnapshot={
   schemaVersion:3,
   source,
   fetchedAt:resultData?.acquiredAt||new Date().toISOString(),
   finishOrder:(resultData?.finishOrder||f).map(Number).filter(Number.isFinite),
   actualTimes:{...state.actualTimes},
   horses:Array.isArray(resultData?.results)?resultData.results.map(x=>({...x,horseNo:Number(x.horseNo),position:x.position==null?null:Number(x.position)})):f.map((horseNo,i)=>({position:i+1,positionText:String(i+1),horseNo})),
   weather:resultData?.resultMeta?.weather||'',
   trackCondition:resultData?.resultMeta?.trackCondition||'',
   quality:resultData?.quality||null,
   market:state.resultMarketSnapshot||null
 };
 state.predictionSaved=true;
 state.resultStatus='fetched';
 state.resultErrorType=null;
 state.resultFetchError='';
 state.resultFetchedAt=new Date().toISOString();
 state.validationCompleted=true;
 state.validated=true;
 stage('build_validation');
 const diagnostics=diagnosticsForRace(state);
 state.validationSnapshot={schemaVersion:3,modelVersion:state.predictionSnapshot?.modelVersion||APP_VERSION,generatedAt:new Date().toISOString(),finishOrder:[...state.resultSnapshot.finishOrder],failures:diagnostics.failures,checks:diagnostics.checks,dataQuality:diagnostics.quality};
 stage('persist');
 persist(true);
 stage('render_result');
 renderResultDisplayState();
 stage('render_dashboard');
 renderDashboard();
 stage('complete');
 if(!silent)alert('検証結果を保存しました。');
 return true;
}

function syncNar(options={}){
 if(options instanceof Event)options={};
 if(resultFetchInProgress)return resultFetchInProgress;
 const r=raceFromForm(),flight={raceId:raceId(r),race:{...r},priority:options.auto?'auto':'manual',startedMs:Date.now()};
 resultFetchInProgress=performResultFetch(options,flight).finally(()=>{resultFetchInProgress=null;setButtonBusy('narSync',false);renderResultDisplayState()});
 return resultFetchInProgress;
}
async function performResultFetch(options={},flight){
 const auto=!!options.auto;
 const r=flight.race,code=narCode(r.track);if(!code){$('narStatus').textContent='NAR自動取得：この競馬場は未対応です。';return}
 if(!r.raceDate||!r.raceNo){$('narStatus').textContent='日付・競馬場・レース番号を確認してください。';return}
 const requestedId=flight.raceId;
 const isCurrent=()=>raceId(raceFromForm())===requestedId;
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
   state.resultFetchAudit={resultFetchSuccess:complete,primarySyncAudit:{success:complete,stage:complete?'parse_complete':'result_rows_insufficient',httpStatus:res.status,route:'/api/nar/sync',parsedRows:d.results?.length||0,finishOrder:d.finishOrder?.slice(0,3)||[],attemptCount:1,errorCode:null},recoveryAudit:null,postFetchAudit:{success:null,stage:'not_started'},checkedAt:state.resultFetchCheckedAt};
   state.resultFetchError='';state.resultErrorType='';
   if(complete){
     // API取得成功と保存・再描画を分離する。後段で例外が起きても取得成功を失敗扱いへ戻さない。
     let postFetchStage='save_start';
     try{
       saveFetchedResult(d.finishOrder,{silent:true,source:'NAR公式取得時に自動保存',resultData:d,onStage:stage=>{postFetchStage=stage;state.resultFetchAudit={...state.resultFetchAudit,postFetchAudit:{success:null,stage}}}});
       state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:true,stage:'complete',persist:'success',cloud:'pending',validation:'success',render:'success'}};
     }catch(saveError){
       const message=String(saveError?.message||saveError).slice(0,180);
       state.resultStatus='fetched';
       state.resultErrorType=null;
       state.resultFetchError='';
       const postCode=postFetchStage==='persist'?'persist_failed':postFetchStage==='build_validation'?'validation_failed':postFetchStage.startsWith('render')?'render_failed':'response_build_failed';state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:false,stage:postFetchStage,errorCode:postCode,message}};
       // 少なくとも取得済み着順は保持する。saveFetchedResultが途中まで進んでいればその内容を尊重する。
       if(!(state.resultSnapshot?.finishOrder||[]).length){
         state.result={finishOrder:d.finishOrder.slice(0,3).map(Number),memo:$('memo')?.value||'',autoDiagnosis:'',at:new Date().toISOString(),actualTimes:{...state.actualTimes},source:'NAR公式取得（後段エラー）',autoSaved:true};
         state.resultSnapshot={schemaVersion:3,source:'NAR公式取得（後段エラー）',fetchedAt:d.acquiredAt||new Date().toISOString(),finishOrder:d.finishOrder.slice(0,3).map(Number),actualTimes:{...state.actualTimes},horses:Array.isArray(d.results)?d.results:[],weather:d.resultMeta?.weather||'',trackCondition:d.resultMeta?.trackCondition||'',quality:d.quality||null,market:state.resultMarketSnapshot||null};
       }
       state.predictionSaved=true;state.resultFetchedAt=d.acquiredAt||new Date().toISOString();
       try{persist(existingValidated(raceId(r)))}catch{}
       try{renderResultDisplayState()}catch{}
       try{renderResultDiagnostics()}catch{}
       $('narStatus').textContent=`結果取得成功：${d.finishOrder.slice(0,3).join('-')}｜保存・再集計の後段処理でエラー（${postFetchStage}）｜取得結果は保持しています。`;
       return {complete:true,pending:false,status:'fetched',data:d,postFetchError:saveError,postFetchStage};
     }
   }else{
     state.predictionSaved=true;
     state.resultStatus=alreadyComplete?'fetched':'pending';
     state.resultErrorType='result_unpublished';
     state.validationCompleted=alreadyComplete||false;
     persist(existingValidated(raceId(r)));
   }

   render();
   const base=`NAR公式反映：着順 ${d.finishOrder?.slice(0,3).join('-')||'未確定'} / 全馬結果 ${d.results?.length||0}頭 / 実走TIME ${Object.keys(d.actualTimes||{}).length}頭`;
   const qualityWarning=complete&&d.quality&&(d.quality.actualTimeRate<70||d.quality.resultParseRate<100)?' / データ要確認':'';
   $('narStatus').textContent=complete
     ? `${base} / 検証結果まで自動保存済み${d.fallbackUsed?' / 予備経路で取得':''}${d.partialSuccess?' / 付随データ一部未取得':''}${qualityWarning}`
     : alreadyComplete?`${base} / 保存済みの検証結果は維持しました`:`結果待ち｜公式結果はまだ公開されていません。予想は保存済みです。`;
   return {complete:complete||alreadyComplete,pending:!complete&&!alreadyComplete,status:complete||alreadyComplete?'fetched':'pending',data:d};
  }catch(e){
   if(e?.code==='aborted'||e?.code==='stale_request')return {complete:false,pending:false,status:'cancelled'};
   if(!isCurrent())return {complete:false,pending:false,status:'cancelled'};
   state.predictionSaved=!!(state.predictionSaved||state.predictionSnapshot);
   const alreadyComplete=(state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).length>=3;
   state.resultStatus=alreadyComplete?'fetched':'error';
   state.resultErrorType=e?.code||(e instanceof TypeError?'fetch_failed':'post_process_failed');
   state.resultFetchError=String(e.message||e);
   state.resultFetchCheckedAt=new Date().toISOString();
   state.resultFetchAudit={resultFetchSuccess:false,primarySyncAudit:{success:false,stage:e?.stage||'api_fetch',errorCode:state.resultErrorType,errorName:e?.name||'',errorMessage:String(e?.message||e).slice(0,180),httpStatus:e?.status||null,route:'/api/nar/sync',attemptCount:1},recoveryAudit:null,postFetchAudit:{success:null,stage:'not_started'},checkedAt:state.resultFetchCheckedAt};
   const recoveryStarted=Date.now();const diag=await fetchResultDiagnostic(r);flight.recoveryMs=Date.now()-recoveryStarted;
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
       state.resultFetchAudit={...state.resultFetchAudit,finalStatus:'success_with_recovery',resultFetchSuccess:true,recoveryAudit:{success:true,stage:'diagnostic_recovery_complete',errorCode:null,httpStatus:diag.httpStatus??200,route:diag.urlType||'RaceMarkTable',parsedRows:diag.results?.length||0,finishOrder:recoveredOrder,recoveryMs:flight.recoveryMs},postFetchAudit:{success:null,stage:'not_started'},diagnosticCheckedAt:diag.checkedAt||state.resultFetchCheckedAt};
       state.resultErrorType=null;state.resultFetchError='';state.resultStatus='fetched';
       let postFetchStage='save_start';
       try{
         saveFetchedResult(recoveredOrder,{silent:true,source:'NAR公式 診断経路復旧',resultData:recoveredData,onStage:stage=>{postFetchStage=stage;state.resultFetchAudit={...state.resultFetchAudit,postFetchAudit:{success:null,stage}}}});
         state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:true,stage:'complete',persist:'success',cloud:'pending',validation:'success',render:'success'}};
       }catch(saveError){
         const postCode=postFetchStage==='persist'?'persist_failed':postFetchStage==='build_validation'?'validation_failed':postFetchStage.startsWith('render')?'render_failed':'response_build_failed';state.resultFetchAudit={...state.resultFetchAudit,resultFetchSuccess:true,postFetchAudit:{success:false,stage:postFetchStage,errorCode:postCode,message:String(saveError?.message||saveError).slice(0,180)}};
         if(!(state.resultSnapshot?.finishOrder||[]).length){
           state.result={finishOrder:recoveredOrder,memo:$('memo')?.value||'',autoDiagnosis:'',at:new Date().toISOString(),actualTimes:{...state.actualTimes},source:'NAR公式 診断経路復旧',autoSaved:true};
           state.resultSnapshot={schemaVersion:3,source:'NAR公式 診断経路復旧',fetchedAt:recoveredData.acquiredAt,finishOrder:recoveredOrder,actualTimes:{...state.actualTimes},horses:recoveredData.results,weather:recoveredData.resultMeta?.weather||'',trackCondition:recoveredData.resultMeta?.trackCondition||'',quality:recoveredData.quality||null,market:state.resultMarketSnapshot||null};
         }
         try{persist(true)}catch{}
       }
       try{render()}catch{try{renderResultDisplayState();renderResultDiagnostics()}catch{}}
       $('narStatus').textContent=`結果取得成功：${recoveredOrder.join('-')}｜通常経路失敗後、RaceMarkTable診断経路から復旧しました。`;
       return {complete:true,pending:false,status:'fetched',data:recoveredData,recovered:true};
     }
   }
   persist(existingValidated(raceId(r)));
   renderResultDisplayState();renderResultDiagnostics();
   $('narStatus').textContent=alreadyComplete?`結果：取得済 ${((state.resultSnapshot?.finishOrder||state.result?.finishOrder||[]).slice(0,3)).join('-')}｜再取得：失敗（保存済み結果には影響なし）｜${errorLabel(e)}`:`取得エラー｜${errorLabel(e)} 予想データは保存されています。再取得できます。`;
   return {complete:alreadyComplete,pending:false,status:alreadyComplete?'fetched':'error',error:e};
 }finally{}
}
function saveValidation(){
 const f=[num($('finish1').value),num($('finish2').value),num($('finish3').value)].filter(x=>x!=null);
 if(f.length<3){alert('1〜3着を入力してください');return}
 saveFetchedResult(f,{silent:false,source:'手動修正保存'});
}

function historyDefaultState(){
 const today=new Date(),end=new Date(today);end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-29);const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);
 return {schemaVersion:1,status:'idle',preset:'30',startDate:iso(start),endDate:iso(end),tracks:['浦和','船橋','大井','川崎'],cursor:0,total:0,done:0,saved:0,skipped:0,failed:0,pending:0,lastItem:'',startedAt:null,updatedAt:null,errors:[]};
}
function getHistoryState(){if(!historyCollection)historyCollection=localStore.get(HISTORY_COLLECTION_KEY,null)||historyDefaultState();return historyCollection}
function saveHistoryState(){const st=getHistoryState();st.updatedAt=new Date().toISOString();localStore.set(HISTORY_COLLECTION_KEY,st);renderHistoryCollector()}
function historyDateRange(start,end){const out=[],a=new Date(`${start}T00:00:00`),b=new Date(`${end}T00:00:00`);if(!Number.isFinite(a.getTime())||!Number.isFinite(b.getTime())||a>b)return out;for(let d=new Date(a);d<=b;d.setDate(d.getDate()+1))out.push(new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10));return out}
function historyPlan(st=getHistoryState()){const dates=historyDateRange(st.startDate,st.endDate),tracks=(st.tracks||[]).filter(t=>NAR_TRACKS[t]);const plan=[];for(const date of dates)for(const track of tracks)for(let raceNo=1;raceNo<=12;raceNo++)plan.push({date,track,raceNo,id:raceId({raceDate:date,track,raceNo})});return plan}
function historyPresetDays(days){const st=getHistoryState(),end=new Date();end.setDate(end.getDate()-1);const start=new Date(end);start.setDate(start.getDate()-Math.max(0,Number(days||1)-1));const iso=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);st.startDate=iso(start);st.endDate=iso(end);st.preset=String(days);st.cursor=0;saveHistoryState()}
function historySampleLabel(n){return n<30?'低信頼':n<100?'参考':n<300?'中':'高'}
function historicalRecord(root,resultData){
 const previous=state,now=new Date().toISOString();
 try{
  state=transform(root);state.race={...state.race,historicalResearch:true,researchMode:'historical_research',predictionKind:'backtest_prediction',dataMode:`${state.race.dataMode||'NAR自動'}・過去研究`};
  makeSnapshot();
  if(state.predictionSnapshot){state.predictionSnapshot.historicalResearch=true;state.predictionSnapshot.predictionKind='backtest_prediction';state.predictionSnapshot.generatedAt=now;state.predictionSnapshot.createdAt=now;state.predictionSnapshot.race={...state.predictionSnapshot.race,historicalResearch:true,researchMode:'historical_research'}}
  if(state.marketSnapshot){state.marketSnapshot.historicalResearch=true;state.marketSnapshot.oddsSnapshotType='historical_official';state.marketSnapshot.createdAt=now;state.marketSnapshot.acquiredAt=now}
  const record=cloneData(state);record.modelVersion=APP_VERSION;record.predictionCreatedAt=now;record.historicalResearch={schemaVersion:1,mode:'historical_research',predictionKind:'backtest_prediction',collectedAt:now,resultLeakageGuard:true,notes:'過去レース研究用。現在モデルによるバックテスト予測であり、当時のリアルタイム予想とは区別する。'};
  if(resultData?.finishOrder?.length>=3){
   record.actualTimes={...(resultData.actualTimes||{})};record.result={finishOrder:resultData.finishOrder.map(Number),actualTimes:{...record.actualTimes},source:'NAR公式 過去研究取得',at:now,autoSaved:true};
   record.resultSnapshot={schemaVersion:3,source:'NAR公式 過去研究取得',fetchedAt:resultData.acquiredAt||now,finishOrder:resultData.finishOrder.map(Number),actualTimes:{...record.actualTimes},horses:Array.isArray(resultData.results)?resultData.results.map(x=>({...x,horseNo:Number(x.horseNo),position:x.position==null?null:Number(x.position)})):[],weather:resultData?.resultMeta?.weather||'',trackCondition:resultData?.resultMeta?.trackCondition||'',quality:resultData?.quality||null,market:null};
   record.resultAcquiredAt=resultData.acquiredAt||now;record.validationCompleted=true;record.validated=true;const diag=diagnosticsForRace(record);record.validationSnapshot={schemaVersion:3,modelVersion:APP_VERSION,generatedAt:now,finishOrder:[...record.resultSnapshot.finishOrder],failures:diag.failures,checks:diag.checks,dataQuality:diag.quality,historicalResearch:true};
  }
  sealSnapshotIntegrity(record,true);record.updatedAt=now;return record;
 }finally{state=previous}
}
async function persistHistoricalRecord(id,record){raceCache[id]=record;if(researchDb)await idbPut('races',{id,data:record,updatedAt:record.updatedAt});else localStore.set(KEY,raceCache)}
async function syncHistoricalBatch(batch){if(!batch.length)return {created:0,updated:0,unchanged:0};try{return await cloudRequest('/api/db/sync',{method:'POST',body:JSON.stringify({records:batch})})}catch(e){batch.forEach(x=>setCloudPending(x.raceId,true));throw e}}
function renderHistoryCollector(){
 const box=$('historyCollector');if(!box)return;const st=getHistoryState(),plan=historyPlan(st),existing=cloudResearchAudit.counts?.d1PredictionSaved??Object.keys(raceCache).length,remaining1=Math.max(0,1000-existing),remaining3=Math.max(0,3000-existing);st.total=plan.length;
 const progress=st.total?Math.min(100,100*(st.cursor||0)/st.total):0;
 if($('historyStartDate'))$('historyStartDate').value=st.startDate||'';if($('historyEndDate'))$('historyEndDate').value=st.endDate||'';if($('historyPreset'))$('historyPreset').value=st.preset||'30';
 const trackBox=$('historyTrackGrid');if(trackBox&&!trackBox.dataset.ready){trackBox.innerHTML=Object.keys(NAR_TRACKS).map(t=>`<label><input type="checkbox" value="${esc(t)}">${esc(t)}</label>`).join('');trackBox.dataset.ready='1'}
 trackBox?.querySelectorAll('input').forEach(i=>i.checked=(st.tracks||[]).includes(i.value));
 if($('historyProgressText'))$('historyProgressText').textContent=`${st.status==='running'?'収集中':st.status==='paused'?'一時停止':st.status==='done'?'完了':'待機'}｜${st.cursor||0}/${st.total||0} (${progress.toFixed(1)}%)`;
 if($('historyProgressBar'))$('historyProgressBar').style.width=`${progress}%`;
 if($('historyCounts'))$('historyCounts').innerHTML=`<span>保存 ${st.saved||0}</span><span>スキップ ${st.skipped||0}</span><span>結果待ち ${st.pending||0}</span><span>失敗 ${st.failed||0}</span>`;
 if($('historyGoals'))$('historyGoals').innerHTML=`<strong>研究母数 ${existing}R</strong><span>第一目標1,000Rまで あと${remaining1}R</span><span>推奨3,000Rまで あと${remaining3}R</span>`;
 if($('historyLast'))$('historyLast').textContent=st.lastItem?`最後: ${st.lastItem}`:'既取得race_idは安全にスキップします。';
 if($('historyStart'))$('historyStart').disabled=historyCollectorRunning;if($('historyPause'))$('historyPause').disabled=!historyCollectorRunning;
}
function updateHistoryOptionsFromUi(){const st=getHistoryState();st.startDate=$('historyStartDate')?.value||st.startDate;st.endDate=$('historyEndDate')?.value||st.endDate;st.preset=$('historyPreset')?.value||'custom';st.tracks=[...($('historyTrackGrid')?.querySelectorAll('input:checked')||[])].map(x=>x.value);st.cursor=0;st.status='idle';saveHistoryState()}
async function runHistoricalCollector(){
 if(historyCollectorRunning)return;const st=getHistoryState();const plan=historyPlan(st);if(!plan.length){if($('historyLast'))$('historyLast').textContent='期間と競馬場を選択してください。';return}
 historyCollectorRunning=true;historyCollectorAbort=false;st.status='running';st.startedAt=st.startedAt||new Date().toISOString();st.total=plan.length;saveHistoryState();let batch=[];
 try{
  for(let i=st.cursor||0;i<plan.length;i++){
   if(historyCollectorAbort){st.status='paused';break}
   const item=plan[i];st.cursor=i;st.lastItem=`${item.date} ${item.track}${item.raceNo}R`;saveHistoryState();
   if(raceCache[item.id]||cloudResearchAudit.datasetRaceIds?.includes(item.id)){st.skipped++;st.cursor=i+1;continue}
   const code=narCode(item.track);
   try{
    const raceRes=await fetch(`/api/nar/race?code=${code}&date=${encodeURIComponent(item.date)}&race=${item.raceNo}`,{cache:'no-store'}),raceData=await responseJson(raceRes);
    if(!raceRes.ok||!Array.isArray(raceData.horses)||raceData.horses.length<2){if(raceRes.status===404||raceData.errorCode==='race_not_found'){st.skipped++;st.cursor=i+1;continue}throw requestError(raceData.errorCode||'parser_error',raceData.error||'出走馬取得失敗',raceRes.status)}
    const root=buildAbilityRoot(raceData,item.date,item.track,item.raceNo);root.race.historicalResearch=true;root.race.researchMode='historical_research';root.race.predictionKind='backtest_prediction';
    let resultData=null;try{const resultRes=await fetch(`/api/nar/sync?code=${code}&date=${encodeURIComponent(item.date)}&race=${item.raceNo}`,{cache:'no-store'}),rd=await responseJson(resultRes);if(resultRes.ok&&rd.finishOrder?.length>=3)resultData=rd;else st.pending++}catch{st.pending++}
    const record=historicalRecord(root,resultData);await persistHistoricalRecord(item.id,record);batch.push({raceId:item.id,record});st.saved++;st.cursor=i+1;
    if(batch.length>=10){try{await syncHistoricalBatch(batch);batch=[]}catch(e){st.failed+=batch.length;st.errors=(st.errors||[]).slice(-19);st.errors.push({at:new Date().toISOString(),item:st.lastItem,error:e.code||e.message});batch=[]}}
   }catch(e){st.failed++;st.errors=(st.errors||[]).slice(-19);st.errors.push({at:new Date().toISOString(),item:st.lastItem,error:e.code||e.message})}
   saveHistoryState();await new Promise(r=>setTimeout(r,700+Math.floor(Math.random()*700)));
  }
  if(batch.length){try{await syncHistoricalBatch(batch)}catch(e){st.failed+=batch.length}}
  if(!historyCollectorAbort&&st.cursor>=plan.length){st.status='done'}
 }finally{
  historyCollectorRunning=false;historyCollectorAbort=false;saveHistoryState();try{await refreshCloudResearchDataset({persist:true,render:false});renderCloudDatasetSummary();renderDashboard()}catch{}renderHistoryCollector();
 }
}
function pauseHistoricalCollector(){historyCollectorAbort=true;const st=getHistoryState();st.status='paused';saveHistoryState()}
function resetHistoricalCollector(){if(historyCollectorRunning)return;historyCollection=historyDefaultState();saveHistoryState()}
function bindHistoricalCollector(){
 const box=$('historyCollector');if(!box)return;historyCollection=localStore.get(HISTORY_COLLECTION_KEY,null)||historyDefaultState();
 $('historyPreset')?.addEventListener('change',e=>{const v=e.target.value;if(v==='custom')return;historyPresetDays(Number(v))});
 for(const id of ['historyStartDate','historyEndDate'])$(id)?.addEventListener('change',()=>{const st=getHistoryState();st.preset='custom';updateHistoryOptionsFromUi()});
 $('historyTrackGrid')?.addEventListener('change',updateHistoryOptionsFromUi);$('historyStart')?.addEventListener('click',runHistoricalCollector);$('historyPause')?.addEventListener('click',pauseHistoricalCollector);$('historyReset')?.addEventListener('click',resetHistoricalCollector);renderHistoryCollector();
}

function createResearchBackup(){
 return {format:'CHASS_KEIBA_RESEARCH_BACKUP',schemaVersion:BACKUP_SCHEMA_VERSION,appVersion:APP_VERSION,exportedAt:new Date().toISOString(),counts:{races:Object.keys(raceCache).length,oddsHistories:Object.keys(oddsHistoryCache).length},races:cloneData(raceCache),oddsHistory:cloneData(oddsHistoryCache),currentRace:currentRaceCache||''};
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
 const data=createResearchBackup(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a'),stamp=data.exportedAt.slice(0,10).replaceAll('-','');a.href=url;a.download=`CHASS-research-backup-${stamp}-v${APP_VERSION}.json`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return data.counts;
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
 if(!prediction.length)return r?.horses||[];
 const market=new Map((r.marketSnapshot?.horses||[]).map(h=>[Number(h.horseNo),h]));
 const finals=new Map((r.finalSnapshot?.ranking||r.finalSnapshot?.top3||[]).map(h=>[Number(h.horseNo),h]));
 return prediction.map(h=>({...h,...market.get(Number(h.horseNo)),...finals.get(Number(h.horseNo)),horseNo:Number(h.horseNo)}));
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
 let changed=false;const now=r.updatedAt||r.result?.at||r.predictionCreatedAt||r.resultAcquiredAt||'1970-01-01T00:00:00.000Z',horses=r.horses||[];
 if(!r.predictionSnapshot?.horses?.length){r.predictionSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',generatedAt:now,createdAt:now,race:snapshotRace(r.race||{}),horses:horses.map(predictionHorse),locked:true,legacyDerived:true};changed=true}
 if(!r.marketSnapshot?.horses?.length){r.marketSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',acquiredAt:r.race?.oddsUpdatedAt||now,createdAt:r.race?.oddsUpdatedAt||now,oddsSnapshotType:r.race?.oddsSnapshotType||'unknown',horses:horses.map(marketHorse),legacyDerived:true};changed=true}
 if(!r.finalSnapshot?.top3?.length){const ranked=rankFinalFor(horses);r.finalSnapshot={schemaVersion:2,modelVersion:r.modelVersion||'legacy-unknown',generatedAt:now,createdAt:now,top3:ranked.slice(0,3).map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,mark:['◎','○','▲'][i],rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime})),ranking:ranked.map((h,i)=>({horseNo:Number(h.horseNo),horseName:h.horseName,rank:i+1,finalScore:finalScore(h),win:h.win,place:h.place,overall:h.overall,ev:h.ev,predictedTime:h.predictedTime})),legacyDerived:true};changed=true}
 if(r.result?.finishOrder?.length>=3&&!r.resultSnapshot){r.resultSnapshot={schemaVersion:2,source:r.result.source||'legacy',fetchedAt:r.resultFetchedAt||r.result.at||now,finishOrder:r.result.finishOrder.map(Number),actualTimes:{...(r.result.actualTimes||r.actualTimes||{})},legacyDerived:true};changed=true}
 if(r.resultSnapshot&&!Array.isArray(r.resultSnapshot.horses)){const times=r.resultSnapshot.actualTimes||r.result?.actualTimes||r.actualTimes||{};r.resultSnapshot.horses=(r.resultSnapshot.finishOrder||[]).map((horseNo,i)=>({position:i+1,positionText:String(i+1),horseNo:Number(horseNo),time:times[String(horseNo)]||''}));r.resultSnapshot.legacyDerived=true;changed=true}
 r.modelVersion=r.modelVersion||r.predictionSnapshot?.modelVersion||'legacy-unknown';r.predictionCreatedAt=r.predictionCreatedAt||r.predictionSnapshot?.createdAt||r.predictionSnapshot?.generatedAt||null;r.resultAcquiredAt=r.resultAcquiredAt||r.resultSnapshot?.fetchedAt||r.resultFetchedAt||null;r.updatedAt=r.updatedAt||now;r.snapshotSchemaVersion=2;
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
 const score=[prob===total,market===total,time>=total*.7,detail>=total*.5].filter(Boolean).length;let grade=score===4?'A':score>=2?'B':'C';if(integrity.status==='legacy'&&grade==='A')grade='B';if(integrity.status==='invalid')grade='C';
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
function compareLongshotModels(races){const models={legacy:{label:'現行9.9.2',candidates:0,top3:0,win:0,roiN:0,roiReturn:0,capture7:0,target7:0,capture10:0,target10:0},next:{label:'新9.9.3',candidates:0,top3:0,win:0,roiN:0,roiReturn:0,capture7:0,target7:0,capture10:0,target10:0}};for(const r of races){const frozen=frozenHorses(r),sets={legacy:legacyValueCandidates(frozen),next:evaluateLongshots(cloneData(frozen),r.predictionSnapshot?.race||r.race||{})};for(const [key,horses] of Object.entries(sets)){const g=models[key],picked=horses.filter(h=>h.valueMark),pickedNos=new Set(picked.map(h=>Number(h.horseNo)));g.candidates+=picked.length;for(const h of picked){if(isTop3(r,h.horseNo))g.top3++;if(horsePosition(r,h)===1)g.win++;const odds=settledWinOdds(r,h.horseNo);if(odds!=null){g.roiN++;if(horsePosition(r,h)===1)g.roiReturn+=odds}}for(const no of resultOrder(r).slice(0,3)){const h=frozenHorseByNo(r,no),p=Number(h?.popularity);if(p>=7){g.target7++;if(pickedNos.has(Number(no)))g.capture7++}if(p>=10){g.target10++;if(pickedNos.has(Number(no)))g.capture10++}}}}return models}
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
 const isCentral=r=>/中央|JRA/i.test(String(r.race?.category||''));
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

function renderDashboard(){
 renderCloudSyncState();
 renderCloudDatasetSummary();
 styleCloudDatasetHierarchy();
 const allRaces=getAllRaces(),tracks=[...new Set(allRaces.map(r=>r.race?.track).filter(Boolean))].sort(),modelVersions=[...new Set(allRaces.map(r=>r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy'))].sort(),now=new Date();
 const daysAgo=date=>{const d=new Date(`${date}T00:00:00`);return Number.isFinite(d.getTime())?Math.floor((now-d)/86400000):Infinity};
 const isCentral=r=>/中央|JRA/i.test(String(r.race?.category||''));
 const races=allRaces.filter(r=>{const version=String(r.predictionSnapshot?.modelVersion||r.modelVersion||'Legacy'),legacy=/legacy/i.test(version);return (dashboardUi.format==='all'||(dashboardUi.format==='legacy'?legacy:!legacy))&&(dashboardUi.raceType==='all'||(dashboardUi.raceType==='central'?isCentral(r):!isCentral(r)))&&(dashboardUi.track==='all'||r.race?.track===dashboardUi.track)&&(dashboardUi.period==='all'||daysAgo(r.race?.raceDate)<=Number(dashboardUi.period))&&(dashboardUi.quality==='all'||validationQuality(r).grade===dashboardUi.quality)&&(dashboardUi.modelVersion==='all'||version===dashboardUi.modelVersion)});
 const filterBar=`<div class="dashboard-filterbar"><label>区分<select id="dashTypeFilter"><option value="all">全体</option><option value="central">中央</option><option value="local">地方</option></select></label><label>競馬場<select id="dashTrackFilter"><option value="all">全競馬場</option>${tracks.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>期間<select id="dashPeriodFilter"><option value="all">全期間</option><option value="0">今日</option><option value="7">直近7日</option><option value="30">直近30日</option></select></label><label>モデルVer.<select id="dashModelVersion"><option value="all">全Ver.</option>${modelVersions.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join('')}</select></label><label>一覧品質<select id="dashQualityFilter"><option value="all">全品質</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></label><label>分析品質<select id="dashAnalysisQuality"><option value="AB">A/B以上</option><option value="A">Aのみ</option><option value="all">全品質</option></select></label></div>`;
 document.querySelector('.dashboard-filterbar')?.remove();$('dashKpis').insertAdjacentHTML('beforebegin',filterBar);document.querySelector('.dashboard-filterbar')?.insertAdjacentHTML('beforeend','<label>形式<select id="dashFormatFilter"><option value="all">全形式</option><option value="current">現行形式</option><option value="legacy">旧形式</option></select></label>');
 const horses=races.flatMap(frozenHorses),diamonds=horses.filter(x=>x.valueMark||x.mark?.includes?.('💎')),warnings=horses.filter(x=>x.warningMark||x.warning);
 const hit=(race,h)=>isTop3(race,h.horseNo),win=(race,h)=>horsePosition(race,h)===1;
 let dh=0,wh=0;for(const race of races){frozenHorses(race).filter(h=>h.valueMark||h.mark?.includes?.('💎')).forEach(h=>{if(hit(race,h))dh++});frozenHorses(race).filter(h=>h.warningMark||h.warning).forEach(h=>{if(!hit(race,h))wh++})}
 const analysisRaces=races.filter(r=>dashboardUi.analysisQuality==='all'||validationQuality(r).grade==='A'||(dashboardUi.analysisQuality==='AB'&&validationQuality(r).grade==='B'));
 const adv=aggregateAdvanced(analysisRaces);
 $('dashKpis').innerHTML=[
   ['検証母集団',`${races.length}R`],
   ['評価馬数',`${horses.length}頭`],
   ['◎○▲ 1頭以上',`${pct(adv.top3Any,adv.races)}（${adv.top3Any}/${adv.races}）`],
   ['平均捕捉',adv.races?`${(adv.top3Captured/adv.races).toFixed(2)}頭`:'—'],
   ['💎TOP3率',diamonds.length?`${(dh/diamonds.length*100).toFixed(1)}%（${dh}/${diamonds.length}）`:'—'],
   ['⚠️圏外率',warnings.length?`${(wh/warnings.length*100).toFixed(1)}%（${wh}/${warnings.length}）`:'—'],
   ['TIME MAE',adv.timeAbs.length?`${mean(adv.timeAbs).toFixed(2)}秒（n=${adv.timeAbs.length}）`:'—'],
   ['期待100%+TOP3',adv.ev100N?`${pct(adv.ev100Place,adv.ev100N)}（${adv.ev100Place}/${adv.ev100N}）`:'—'],
   ['7人気以下捕捉',(()=>{const g=compareLongshotModels(analysisRaces).next;return g.target7?`${pct(g.capture7,g.target7)}（${g.capture7}/${g.target7}）`:'—'})()],
   ['10人気以下捕捉',(()=>{const g=compareLongshotModels(analysisRaces).next;return g.target10?`${pct(g.capture10,g.target10)}（${g.capture10}/${g.target10}）`:'—'})()]
 ].map(([a,b],i)=>`<div class="kpi dashboard-kpi kpi-${i+1}"><span>${a}</span><strong>${b}</strong></div>`).join('');
 document.querySelector('.improvement-card')?.remove();
 $('dashKpis').insertAdjacentHTML('afterend',renderImprovementPoints(races,adv));

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
 const excluded=races.length-analysisRaces.length,analysisNote=`<div class="analysis-scope">検証母集団 ${races.length}R｜分析対象 ${analysisRaces.length}R｜品質フィルター除外 ${excluded}R</div>`;
 $('dashModels').innerHTML=`${analysisNote}<div class="dashboard-expand-tools"><span>詳細分析</span><button type="button" data-dash-expand="all">すべて開く</button><button type="button" data-dash-expand="none">すべて閉じる</button></div>${renderIntegrityAudit(races)}${modelHtml}${versionHtml}${calHtml}${timeHtml}${comparisonHtml}${renderFailureAnalysis(analysisRaces)}<div class="condition-grid">${renderGroupTable('距離別',adv.byDistance,'distance')}${renderGroupTable('人気帯別',adv.byPopularity,'popularity')}${renderGroupTable('期待値帯別',adv.byEvBand,'ev')}</div>`;
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
 document.querySelectorAll('.open-saved-race').forEach(button=>button.onclick=()=>{const saved=store.get(KEY,{})[button.dataset.raceId]||store.get(LEGACY_KEY,{})[button.dataset.raceId];if(!saved)return;state=cloneData(saved);state.actualTimes=state.actualTimes||state.result?.actualTimes||{};fillRace(state.race);document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='predictionView'));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id==='predictionView'));render();requestAnimationFrame(()=>$('finalCard')?.scrollIntoView({behavior:'smooth',block:'start'}))});
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
   APP_VERSION,BACKUP_SCHEMA_VERSION,raceId,timeToSec,migrateSnapshotRecord,failureReasonsForRace,diagnosticsForRace,validationQuality,aggregateAdvanced,frozenHorses,resultTop3,isTop3,officialPlaceLimit,isOfficialPlace,wilsonInterval,resultHorseByNo,settledWinOdds,modelPerformance,stableStringify,snapshotFingerprint,cloudDescriptor,manifestMatches,researchContentFingerprint,stableRecordUpdatedAt,mergeCloudResearchRecord,restoreResearchFromCloud,refreshCloudResearchDataset,applyCloudResearchDataset,sealSnapshotIntegrity,verifySnapshotIntegrity,createResearchBackup,validateResearchBackup,mergeResearchBackup,initResearchStorage,initCloudResearch,syncRaceToCloud,syncAllResearchToCloud,fetchJsonSimple,evaluateLongshots,legacyValueCandidates,compareLongshotModels,getResultDisplayState,getStorageMode(){return researchStorageMode},getCloudState(){return {...cloudState,pending:cloudPending.size}},getCloudAudit(){return cloneData(cloudResearchAudit)},
   makeSnapshot,setState(value){state=value},getState(){return state},saveRaceRecord,getRaceCache(){return raceCache}
 };
 return;
}
initAutoRaceControls();
if($('autoRaceLoad'))$('autoRaceLoad').onclick=loadAutoRace;
if($('autoTrack'))$('autoTrack').onchange=e=>{
  if($('track'))$('track').value=e.target.value;
  if($('autoRaceNo')?.value){if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);}
};
if($('autoRaceDate'))$('autoRaceDate').onchange=e=>{
  if($('raceDate'))$('raceDate').value=e.target.value;
  if($('autoRaceNo')?.value){if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);}
};
if($('autoRaceNo'))$('autoRaceNo').onchange=e=>{
  if($('raceNo'))$('raceNo').value=e.target.value;
  if(autoRaceSelectTimer)clearTimeout(autoRaceSelectTimer);
  autoRaceSelectTimer=setTimeout(()=>loadAutoRace(),180);
};
$('raceImportFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{await importFile(f)}catch(err){$('importStatus').textContent='取込失敗：'+err.message;alert($('importStatus').textContent)}e.target.value=''});
['category','raceDate','track','raceNo','distance','trackCondition','chaos','pace'].forEach(id=>$(id).addEventListener('input',()=>{state.race=raceFromForm();render()}));
$('themeToggle').onclick=()=>document.body.classList.toggle('light');
document.querySelectorAll('.tab').forEach(b=>b.onclick=async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===b.dataset.view));if(b.dataset.view==='dashboardView'){renderDashboard();if(cloudState.available)await refreshCloudResearchDataset({persist:true,render:true})}});
bindHistoricalCollector();
$('narSync').onclick=syncNar;$('liveOddsSync').onclick=()=>syncLiveOdds(false);$('autoOdds').onchange=e=>setAutoOdds(e.target.checked);$('saveValidation').onclick=saveValidation;$('recalcDash').onclick=async()=>{if(cloudState.available)await refreshCloudResearchDataset({persist:true,render:false});renderDashboard()};
if($('exportResearch'))$('exportResearch').onclick=()=>{try{const counts=downloadResearchBackup();$('backupStatus').textContent=`書き出し完了｜保存レース ${counts.races}件・オッズ履歴 ${counts.oddsHistories}件`}catch(e){$('backupStatus').textContent='書き出し失敗｜'+e.message}};
if($('researchImportFile'))$('researchImportFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{setButtonBusy('exportResearch',true,'復元中');const result=await importResearchBackup(file);$('backupStatus').textContent=`復元完了｜追加・更新 ${result.imported}件 / 既存保持 ${result.skipped}件 / 不正 ${result.invalid}件`}catch(err){$('backupStatus').textContent='復元失敗｜'+err.message}finally{setButtonBusy('exportResearch',false);e.target.value=''}};
if($('cloudSyncButton'))$('cloudSyncButton').onclick=async()=>{if(cloudState.status==='syncing')return;setButtonBusy('cloudSyncButton',true,'差分確認中');try{await syncAllResearchToCloud();renderCloudSyncState();renderDashboard()}catch(e){cloudState.status='error';cloudState.error=e.code||e.message;renderCloudSyncState()}finally{setButtonBusy('cloudSyncButton',false)} };
if($('cloudRestoreButton'))$('cloudRestoreButton').onclick=async()=>{setButtonBusy('cloudRestoreButton',true,'復元中');try{const result=await restoreResearchFromCloud();cloudState={...cloudState,available:true,source:'cloud',status:'synced'};renderDashboard();$('cloudSyncStatus').textContent=`☁ 復元完了｜追加 ${result.added}件・補完 ${result.enriched}件`}catch(e){cloudState.status='error';cloudState.error=e.code||e.message;renderCloudSyncState()}finally{setButtonBusy('cloudRestoreButton',false)} };
if($('quickPredict'))$('quickPredict').onclick=()=>$('autoRaceLoad')?.click();
if($('quickOdds'))$('quickOdds').onclick=()=>{const card=document.querySelector('.market-card');if(card)card.open=true;$('liveOddsSync')?.click();requestAnimationFrame(()=>card?.scrollIntoView({behavior:'smooth',block:'start'}))};
if($('quickResult'))$('quickResult').onclick=openResultValidation;
if($('quickToggle'))$('quickToggle').onclick=()=>{quickExpanded=!quickExpanded;renderQuick()};
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
 storageReady=true;setVersion();
 ['autoRaceLoad','narSync','liveOddsSync'].forEach(id=>{const button=$(id);if(button)button.disabled=false});
 const last=store.get(CURRENT,'')||store.get(LEGACY_CURRENT,''),db=store.get(KEY,{});
 if(last&&db[last]){state=db[last];state.actualTimes=state.actualTimes||state.result?.actualTimes||{};state.predictionSaved=state.predictionSaved??!!state.predictionSnapshot;state.resultStatus=state.result?.finishOrder?.length>=3?'fetched':state.resultStatus||'pending';state.validationCompleted=state.validationCompleted??!!(state.validated&&state.result?.finishOrder?.length>=3);state.horses=(state.horses||[]).map(h=>({...h,sourceMark:h.sourceMark||'',abilityMark:h.abilityMark||(['◎','○','▲','△'].includes(h.mark)?h.mark:''),valueMark:h.valueMark||(h.mark?.includes?.('💎')?h.mark:''),warningMark:h.warningMark||h.warning||'',finalMark:h.finalMark||''}));fillRace(state.race);render()}else{fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()}
}
bootApp().catch(error=>{storageReady=true;researchStorageMode='localStorage-fallback';console.error('Storage initialization failed:',error);['autoRaceLoad','narSync','liveOddsSync'].forEach(id=>{const button=$(id);if(button)button.disabled=false});fillRace({category:'地方競馬',chaos:50,pace:'標準'});render()});
})();
