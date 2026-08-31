const TRACK_NAMES={3:"帯広",10:"盛岡",11:"水沢",18:"浦和",19:"船橋",20:"大井",21:"川崎",22:"笠松",23:"金沢",24:"名古屋",27:"園田",28:"姫路",31:"高知",32:"佐賀",36:"門別"};
export const VERSION="9.9.14";
function json(data,status=200){return new Response(JSON.stringify(data,null,2),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}})}
function errorPayload(e){const status=Number(e?.status)||0,raw=String(e?.message||e);let errorCode='nar_temporary';if(status===404)errorCode='race_not_found';else if(e?.code==='nar_timeout'||/timeout|タイムアウト/i.test(raw))errorCode='nar_timeout';else if(e?.code==='parser_error'||/parse|解析/i.test(raw))errorCode='parser_error';else if(e?.code==='network_error'||/network|fetch|通信/i.test(raw))errorCode='network_error';return {error:raw,errorCode,httpStatus:status||null,attemptCount:Number(e?.attemptCount)||1,urlType:e?.urlType||null,fallbackTried:!!e?.fallbackTried,diagnostics:Array.isArray(e?.diagnostics)?e.diagnostics:[],checkedAt:new Date().toISOString()}}
export function getResearchDb(env){return env?.DB||null}
const D1_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS races (race_id TEXT NOT NULL, model_version TEXT NOT NULL, race_json TEXT NOT NULL, prediction_json TEXT NOT NULL, market_json TEXT, final_json TEXT, result_json TEXT, validation_json TEXT, prediction_created_at TEXT, result_acquired_at TEXT, status TEXT NOT NULL DEFAULT 'prediction_saved', updated_at TEXT NOT NULL, PRIMARY KEY (race_id, model_version))`,
 `CREATE TABLE IF NOT EXISTS predictions (race_id TEXT NOT NULL, model_version TEXT NOT NULL, horse_no INTEGER NOT NULL, horse_name TEXT, mark TEXT, ai_win_rate REAL, ai_place_rate REAL, overall REAL, predicted_time TEXT, predicted_time_type TEXT, popularity INTEGER, odds REAL, expected_value REAL, longshot_score REAL, value_type TEXT, market_gap_score REAL, snapshot_json TEXT NOT NULL, prediction_created_at TEXT, PRIMARY KEY (race_id, model_version, horse_no))`,
 `CREATE TABLE IF NOT EXISTS results (race_id TEXT NOT NULL, horse_no INTEGER NOT NULL, finish INTEGER, actual_time TEXT, final_3f REAL, passing_order TEXT, result_acquired_at TEXT, result_json TEXT NOT NULL, PRIMARY KEY (race_id, horse_no))`,
 `CREATE INDEX IF NOT EXISTS idx_races_updated_at ON races(updated_at)`,
 `CREATE INDEX IF NOT EXISTS idx_results_race_id ON results(race_id)`
];
const D1_SCHEMA_READY=new WeakSet();
export async function ensureD1Schema(DB){if(!DB)throw Object.assign(new Error('d1_binding_unavailable'),{code:'d1_binding_unavailable'});if(D1_SCHEMA_READY.has(DB))return true;try{await DB.batch(D1_SCHEMA.map(sql=>DB.prepare(sql)));D1_SCHEMA_READY.add(DB);return true}catch(error){throw Object.assign(new Error(error?.message||'D1 schema initialization failed'),{code:'d1_schema_error',cause:error})}}
function snapshotMap(snapshot){return new Map((snapshot?.horses||[]).map(h=>[Number(h.horseNo),h]))}
function stableStringify(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return `[${value.map(stableStringify).join(',')}]`;return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`}
export function d1Fingerprint(value){if(value==null)return null;let hash=2166136261,text=stableStringify(value);for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}return `fnv1a32:${(hash>>>0).toString(16).padStart(8,'0')}`}
function parseJson(value){try{return value?JSON.parse(value):null}catch{return null}}
function jsonFingerprint(value){return d1Fingerprint(typeof value==='string'?parseJson(value):value)}
export function d1SyncDescriptor(raceId,record){const prediction=record?.predictionSnapshot,modelVersion=String(prediction?.modelVersion||record?.modelVersion||'Legacy');return {raceId,modelVersion,updatedAt:record?.updatedAt||prediction?.createdAt||prediction?.generatedAt||record?.predictionCreatedAt||record?.resultSnapshot?.fetchedAt||record?.resultAcquiredAt||'1970-01-01T00:00:00.000Z',status:record?.validationCompleted?'validated':record?.resultSnapshot?'result_fetched':'prediction_saved',predictionFingerprint:d1Fingerprint(prediction),marketFingerprint:d1Fingerprint(record?.marketSnapshot),finalFingerprint:d1Fingerprint(record?.finalSnapshot),resultFingerprint:d1Fingerprint(record?.resultSnapshot),validationFingerprint:d1Fingerprint(record?.validationSnapshot)}}
export function d1RecordRows(raceId,record){const prediction=record?.predictionSnapshot;if(!raceId||!prediction?.horses?.length)throw Object.assign(new Error('prediction_snapshot_required'),{code:'prediction_snapshot_required'});const descriptor=d1SyncDescriptor(raceId,record),modelVersion=descriptor.modelVersion,market=snapshotMap(record.marketSnapshot),final=snapshotMap({horses:record.finalSnapshot?.ranking||record.finalSnapshot?.top3||[]}),createdAt=prediction.createdAt||prediction.generatedAt||record.predictionCreatedAt||null,resultAt=record.resultSnapshot?.fetchedAt||record.resultAcquiredAt||null;const predictions=prediction.horses.map(p=>{const no=Number(p.horseNo),m=market.get(no)||{},f=final.get(no)||{};return {raceId,modelVersion,horseNo:no,horseName:p.horseName||'',mark:f.mark||p.abilityMark||'',aiWinRate:p.win??null,aiPlaceRate:p.place??null,overall:p.overall??null,predictedTime:p.predictedTime||'',predictedTimeType:p.predictedTimeType||'',popularity:m.popularity??p.popularity??null,odds:m.odds??p.odds??null,expectedValue:m.ev??p.ev??null,longshotScore:m.longshotScore??p.longshotScore??null,valueType:m.valueType??p.valueType??'',marketGapScore:m.marketGapScore??p.marketGapScore??null,snapshotJson:JSON.stringify({...p,...m,final:f}),predictionCreatedAt:createdAt}});const detailedResults=record.resultSnapshot?.horses||[],finishOrder=record.resultSnapshot?.finishOrder||record.result?.finishOrder||[],resultSource=detailedResults.length?detailedResults:finishOrder.map((horseNo,index)=>({horseNo:Number(horseNo),position:index+1})),resultTimes=record.resultSnapshot?.actualTimes||record.actualTimes||{},results=resultSource.map(x=>({raceId,horseNo:Number(x.horseNo),finish:x.position??null,actualTime:x.time||resultTimes[String(x.horseNo)]||'',final3F:x.last3f??null,passingOrder:x.cornerPositions||'',resultAcquiredAt:resultAt,resultJson:JSON.stringify(x)}));return {race:{raceId,modelVersion,raceJson:JSON.stringify(record.race||prediction.race||{}),predictionJson:JSON.stringify(prediction),marketJson:record.marketSnapshot?JSON.stringify(record.marketSnapshot):null,finalJson:record.finalSnapshot?JSON.stringify(record.finalSnapshot):null,resultJson:record.resultSnapshot?JSON.stringify(record.resultSnapshot):null,validationJson:record.validationSnapshot?JSON.stringify(record.validationSnapshot):null,predictionCreatedAt:createdAt,resultAcquiredAt:resultAt,status:descriptor.status,updatedAt:descriptor.updatedAt},predictions,results,descriptor}}
export async function readD1Manifest(DB){await ensureD1Schema(DB);const response=await DB.prepare(`SELECT race_id,model_version,prediction_json,market_json,final_json,result_json,validation_json,updated_at,status FROM races ORDER BY updated_at DESC LIMIT 5000`).all();return (response.results||[]).map(row=>({raceId:row.race_id,modelVersion:row.model_version,updatedAt:row.updated_at,status:row.status,predictionFingerprint:jsonFingerprint(row.prediction_json),marketFingerprint:jsonFingerprint(row.market_json),finalFingerprint:jsonFingerprint(row.final_json),resultFingerprint:jsonFingerprint(row.result_json),validationFingerprint:jsonFingerprint(row.validation_json)}))}
export async function saveD1Record(DB,raceId,record){await ensureD1Schema(DB);const rows=d1RecordRows(raceId,record),r=rows.race,existing=await DB.prepare(`SELECT race_id,model_version,prediction_json,market_json,final_json,result_json,validation_json,updated_at,status FROM races WHERE race_id=? AND model_version=?`).bind(r.raceId,r.modelVersion).first(),incoming=rows.descriptor;if(existing){const current={predictionFingerprint:jsonFingerprint(existing.prediction_json),marketFingerprint:jsonFingerprint(existing.market_json),finalFingerprint:jsonFingerprint(existing.final_json),resultFingerprint:jsonFingerprint(existing.result_json),validationFingerprint:jsonFingerprint(existing.validation_json)},resultChanged=!!incoming.resultFingerprint&&incoming.resultFingerprint!==current.resultFingerprint,validationChanged=!!incoming.validationFingerprint&&incoming.validationFingerprint!==current.validationFingerprint;if(!resultChanged&&!validationChanged)return {raceId:r.raceId,modelVersion:r.modelVersion,status:'unchanged',written:false,predictions:0,results:0};const statements=[];if(resultChanged&&validationChanged)statements.push(DB.prepare(`UPDATE races SET result_json=?,validation_json=?,result_acquired_at=?,status=?,updated_at=? WHERE race_id=? AND model_version=?`).bind(r.resultJson,r.validationJson,r.resultAcquiredAt,r.status,r.updatedAt,r.raceId,r.modelVersion));else if(resultChanged)statements.push(DB.prepare(`UPDATE races SET result_json=?,result_acquired_at=?,status=?,updated_at=? WHERE race_id=? AND model_version=?`).bind(r.resultJson,r.resultAcquiredAt,r.status,r.updatedAt,r.raceId,r.modelVersion));else statements.push(DB.prepare(`UPDATE races SET validation_json=?,status=?,updated_at=? WHERE race_id=? AND model_version=?`).bind(r.validationJson,r.status,r.updatedAt,r.raceId,r.modelVersion));if(resultChanged)for(const x of rows.results)statements.push(DB.prepare(`INSERT INTO results (race_id,horse_no,finish,actual_time,final_3f,passing_order,result_acquired_at,result_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(race_id,horse_no) DO UPDATE SET finish=excluded.finish,actual_time=excluded.actual_time,final_3f=excluded.final_3f,passing_order=excluded.passing_order,result_acquired_at=excluded.result_acquired_at,result_json=excluded.result_json`).bind(x.raceId,x.horseNo,x.finish,x.actualTime,x.final3F,x.passingOrder,x.resultAcquiredAt,x.resultJson));await DB.batch(statements);return {raceId:r.raceId,modelVersion:r.modelVersion,status:'updated',written:true,predictions:0,results:resultChanged?rows.results.length:0}}
 const statements=[DB.prepare(`INSERT INTO races (race_id,model_version,race_json,prediction_json,market_json,final_json,result_json,validation_json,prediction_created_at,result_acquired_at,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(r.raceId,r.modelVersion,r.raceJson,r.predictionJson,r.marketJson,r.finalJson,r.resultJson,r.validationJson,r.predictionCreatedAt,r.resultAcquiredAt,r.status,r.updatedAt)];for(const p of rows.predictions)statements.push(DB.prepare(`INSERT OR IGNORE INTO predictions (race_id,model_version,horse_no,horse_name,mark,ai_win_rate,ai_place_rate,overall,predicted_time,predicted_time_type,popularity,odds,expected_value,longshot_score,value_type,market_gap_score,snapshot_json,prediction_created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(p.raceId,p.modelVersion,p.horseNo,p.horseName,p.mark,p.aiWinRate,p.aiPlaceRate,p.overall,p.predictedTime,p.predictedTimeType,p.popularity,p.odds,p.expectedValue,p.longshotScore,p.valueType,p.marketGapScore,p.snapshotJson,p.predictionCreatedAt));for(const x of rows.results)statements.push(DB.prepare(`INSERT INTO results (race_id,horse_no,finish,actual_time,final_3f,passing_order,result_acquired_at,result_json) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(race_id,horse_no) DO UPDATE SET finish=excluded.finish,actual_time=excluded.actual_time,final_3f=excluded.final_3f,passing_order=excluded.passing_order,result_acquired_at=excluded.result_acquired_at,result_json=excluded.result_json`).bind(x.raceId,x.horseNo,x.finish,x.actualTime,x.final3F,x.passingOrder,x.resultAcquiredAt,x.resultJson));await DB.batch(statements);return {raceId:r.raceId,modelVersion:r.modelVersion,status:'created',written:true,predictions:rows.predictions.length,results:rows.results.length}}
export async function readD1Records(DB){await ensureD1Schema(DB);const response=await DB.prepare(`SELECT * FROM races ORDER BY updated_at DESC LIMIT 2000`).all(),records=[];for(const row of response.results||[]){const parse=(value,fallback)=>{try{return value?JSON.parse(value):fallback}catch{return fallback}};records.push({raceId:row.race_id,record:{race:parse(row.race_json,{}),predictionSnapshot:parse(row.prediction_json,null),marketSnapshot:parse(row.market_json,null),finalSnapshot:parse(row.final_json,null),resultSnapshot:parse(row.result_json,null),validationSnapshot:parse(row.validation_json,null),predictionCreatedAt:row.prediction_created_at,resultAcquiredAt:row.result_acquired_at,validationCompleted:row.status==='validated',validated:row.status==='validated',modelVersion:row.model_version,updatedAt:row.updated_at}})}return records}
function reconstructedResultSnapshot(raceId,rows){if(!rows?.length)return null;const horses=rows.map(row=>{const detail=parseJson(row.result_json)||{};return {...detail,horseNo:Number(row.horse_no),position:row.finish??detail.position??null,positionText:String(row.finish??detail.positionText??''),time:row.actual_time||detail.time||'',last3f:row.final_3f??detail.last3f??null,cornerPositions:row.passing_order||detail.cornerPositions||''}}).sort((a,b)=>(a.position??999)-(b.position??999)||a.horseNo-b.horseNo),finishOrder=horses.filter(x=>Number.isFinite(Number(x.position))).map(x=>Number(x.horseNo)),actualTimes={};horses.forEach(x=>{if(x.time)actualTimes[String(x.horseNo)]=x.time});const fetchedAt=rows.map(x=>x.result_acquired_at).filter(Boolean).sort().at(-1)||null;return {schemaVersion:2,source:'Cloudflare D1 results reconstruction',fetchedAt,finishOrder,actualTimes,horses,reconstructedFromResults:true,raceId}}
export async function readD1ResearchDataset(DB){await ensureD1Schema(DB);const [raceResponse,predictionResponse,resultResponse]=await Promise.all([DB.prepare(`SELECT * FROM races ORDER BY updated_at DESC LIMIT 5000`).all(),DB.prepare(`SELECT race_id,model_version,COUNT(*) AS horse_count FROM predictions GROUP BY race_id,model_version`).all(),DB.prepare(`SELECT * FROM results ORDER BY race_id,finish,horse_no`).all()]),raceRows=raceResponse.results||[],predictionRows=predictionResponse.results||[],resultRows=resultResponse.results||[],predictionCounts=new Map(predictionRows.map(x=>[`${x.race_id}|${x.model_version}`,Number(x.horse_count)||0])),resultsByRace=new Map();for(const row of resultRows){const group=resultsByRace.get(row.race_id)||[];group.push(row);resultsByRace.set(row.race_id,group)}
 const selected=new Map();for(const row of raceRows)if(!selected.has(row.race_id))selected.set(row.race_id,row);
 const records=[],exclusions=[],missingResults=[],warnings=[],predictionRaceIds=new Set(),resultRaceIds=new Set();
 for(const [raceId,row] of selected){const prediction=parseJson(row.prediction_json),market=parseJson(row.market_json),final=parseJson(row.final_json),storedResult=parseJson(row.result_json),rebuiltResult=storedResult||reconstructedResultSnapshot(raceId,resultsByRace.get(raceId)),validation=parseJson(row.validation_json),race=parseJson(row.race_json)||prediction?.race||{},predictionCount=prediction?.horses?.length||predictionCounts.get(`${raceId}|${row.model_version}`)||0,finishCount=rebuiltResult?.finishOrder?.length||0,resultCount=resultsByRace.get(raceId)?.length||0,parts=raceId.split('|'),meta={raceId,date:race.raceDate||race.date||parts[0]||'',track:race.track||parts[1]||'',raceNo:race.raceNo||parts[2]||'',modelVersion:row.model_version,predictionCount,resultCount,finishCount};if(predictionCount)predictionRaceIds.add(raceId);if(rebuiltResult)resultRaceIds.add(raceId);let reason='';if(!predictionCount)reason='PREDICTION_MISSING';else if(!rebuiltResult)missingResults.push({...meta,reason:'RESULT_MISSING'});else if(!prediction?.horses?.length||!final?.top3?.length)reason='SNAPSHOT_INCOMPLETE';else if(finishCount<3)reason='RESULT_INCOMPLETE';if(reason)exclusions.push({...meta,reason});if(prediction&&!prediction.integrity&&!prediction.fingerprint)warnings.push({...meta,reason:'LEGACY_UNVERIFIED'});const eligible=!!rebuiltResult&&!reason;records.push({raceId,eligible,exclusionReason:reason||(!rebuiltResult?'RESULT_MISSING':null),resultMissing:!rebuiltResult,reconstructedResult:!storedResult&&!!rebuiltResult,record:{race,predictionSnapshot:prediction,marketSnapshot:market,finalSnapshot:final,resultSnapshot:rebuiltResult,validationSnapshot:validation,predictionCreatedAt:row.prediction_created_at,resultAcquiredAt:rebuiltResult?.fetchedAt||row.result_acquired_at,validationCompleted:eligible,validated:eligible,modelVersion:row.model_version,updatedAt:row.updated_at}})}
 const counts={d1PredictionSaved:predictionRaceIds.size,d1ResultFetched:resultRaceIds.size,validationEligible:records.filter(x=>x.eligible).length,resultMissing:missingResults.length,excluded:exclusions.filter(x=>resultRaceIds.has(x.raceId)).length,totalRaces:selected.size};counts.consistency={predictionBalance:counts.d1PredictionSaved===counts.d1ResultFetched+counts.resultMissing,resultBalance:counts.d1ResultFetched===counts.validationEligible+counts.excluded};return {counts,records,exclusions,missingResults,warnings}}
function fmtDate(d){return String(d||"").replaceAll("-","/")}
function cleanText(html=""){return String(html).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<br\s*\/?>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/\s+/g," ").trim()}
function rowBlocks(html=""){
 const parts=String(html).split(/<tr\b[^>]*>/i).slice(1);
 return parts.map(part=>part.split(/(?=<tr\b)|<\/tr\s*>/i)[0]);
}
function cellBlocks(rowHtml=""){
 const out=[];const re=/<t([dh])\b([^>]*)>/gi;const hits=[...String(rowHtml).matchAll(re)];
 for(let i=0;i<hits.length;i++){
   const start=hits[i].index+hits[i][0].length,end=i+1<hits.length?hits[i+1].index:String(rowHtml).length;
   out.push({tag:hits[i][1].toLowerCase(),attrs:hits[i][2]||'',html:String(rowHtml).slice(start,end).replace(/<\/t[dh]\s*>[\s\S]*$/i,''),text:''});
 }
 out.forEach(x=>x.text=cleanText(x.html));return out;
}
function tableRows(html=""){return rowBlocks(html).map(raw=>{const blocks=cellBlocks(raw),cells=blocks.map(x=>x.text);return {raw,blocks,cells,text:cells.join(" ")}})}
function plausibleHorseName(value=""){
 const s=cleanText(value).replace(/^[\s　]+|[\s　]+$/g,'');
 if(s.length<2||s.length>40)return false;
 if(/^\d+(?:[.,]\d+)?(?:円|倍|人気|番)?$/.test(s))return false;
 if(/[¥￥]|\d+\s*円/.test(s))return false;
 if(/^(?:馬|枠)?番|馬名|馬主|生産牧場|単勝|複勝|オッズ|人気(?:順位)?|金額|払戻|着順|騎手|調教師$/.test(s))return false;
 return /[一-龠々〆ヵヶぁ-んァ-ヶーA-Za-z]/.test(s);
}
async function fetchText(url){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const r=await fetch(url,{headers:{"user-agent":`Mozilla/5.0 (compatible; ChassKeibaLab/${VERSION})`,"accept":"text/html,application/xhtml+xml","accept-language":"ja"},redirect:"follow",signal:controller.signal});if(!r.ok){const e=new Error(`NAR HTTP ${r.status}`);e.status=r.status;throw e}return await r.text()}catch(error){if(error?.name==='AbortError'){const e=new Error('NAR通信がタイムアウトしました');e.code='nar_timeout';throw e}if(error instanceof TypeError&&!error.code)error.code='network_error';throw error}finally{clearTimeout(timer)}}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function retryableNarError(error){return error?.code==='network_error'||error?.code==='nar_timeout'||[429,500,502,503,504].includes(Number(error?.status))}
export async function fetchNarResultWithRetry(url,{attempts=3,delays=[0,700,1500],fetcher=fetchText,sleeper=wait,urlType='RaceMarkTable',diagnostics=[]}={}){let lastError;for(let attempt=1;attempt<=attempts;attempt++){if(delays[attempt-1])await sleeper(delays[attempt-1]);const started=Date.now();try{const value=await fetcher(url),html=typeof value==='string'?value:value?.html??String(value??'');diagnostics.push({urlType,attempt,ok:true,httpStatus:value?.status??200,durationMs:Date.now()-started,bytes:html.length});return {html,attemptCount:attempt,urlType,diagnostics}}catch(error){lastError=error;error.attemptCount=attempt;error.urlType=urlType;diagnostics.push({urlType,attempt,ok:false,httpStatus:Number(error?.status)||null,errorCode:error?.code||'fetch_error',message:String(error?.message||error).slice(0,160),durationMs:Date.now()-started});if(!retryableNarError(error)||attempt===attempts){error.diagnostics=diagnostics;throw error}}}if(lastError)lastError.diagnostics=diagnostics;throw lastError}
export async function fetchNarResultResilient(primaryUrl,fallbackUrl,{fetcher=fetchText,sleeper=wait}={}){
 const endpoints=[
  {url:primaryUrl,urlType:'RaceMarkTable',attempts:3,delays:[0,700,1600]},
  {url:fallbackUrl,urlType:'RaceMarkTable_ipat',attempts:2,delays:[500,1400]}
 ].filter(x=>x.url);
 let lastError=null,firstPending=null,totalAttempts=0;const diagnostics=[];
 for(const ep of endpoints){
  try{
   const fetched=await fetchNarResultWithRetry(ep.url,{attempts:ep.attempts,delays:ep.delays,fetcher,sleeper,urlType:ep.urlType,diagnostics});
   totalAttempts+=fetched.attemptCount;
   const parsed=parseResult(fetched.html);diagnostics.push({urlType:ep.urlType,stage:'parse',ok:parsed.finishOrder.length>=3,finishCount:parsed.finishOrder.length,resultRows:parsed.results?.length||0});
   const payload={...fetched,parsed,totalAttemptCount:totalAttempts,fallbackUsed:ep.urlType!=='RaceMarkTable',diagnostics:[...diagnostics]};
   if(parsed.finishOrder.length>=3)return payload;
   if(!firstPending)firstPending=payload;
  }catch(error){
   totalAttempts+=Number(error?.attemptCount)||1;lastError=error;
   // 404 is endpoint-specific; try the alternate endpoint before giving up.
   if(!retryableNarError(error)&&Number(error?.status)!==404)break;
  }
 }
 if(firstPending)return {...firstPending,totalAttemptCount:totalAttempts,fallbackTried:endpoints.length>1,diagnostics:[...diagnostics]};
 if(lastError){lastError.attemptCount=totalAttempts||lastError.attemptCount;lastError.fallbackTried=endpoints.length>1;lastError.diagnostics=[...diagnostics];throw lastError}
 const error=new Error('NAR結果取得経路を利用できません');error.code='network_error';error.attemptCount=totalAttempts||1;error.fallbackTried=endpoints.length>1;error.diagnostics=[...diagnostics];throw error;
}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const stddev=a=>{const values=(a||[]).filter(Number.isFinite);if(values.length<2)return null;const avg=mean(values);return Math.sqrt(mean(values.map(x=>(x-avg)**2)))};

function resultColumn(headers,...patterns){return headers.findIndex(h=>patterns.some(p=>p.test(String(h||'').replace(/\s+/g,''))))}
function numericCell(v,min=-Infinity,max=Infinity){const m=String(v??'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/),n=m?Number(m[0]):null;return Number.isFinite(n)&&n>=min&&n<=max?n:null}
export function parseResult(html){
 const results=[],actualTimes={};let headers=[];
 for(const row of tableRows(html)){
   const c=row.cells.map(x=>String(x||'').trim()),joined=c.join('|');
   if(/着順/.test(joined)&&/馬番/.test(joined)){headers=c;continue}
   if(!headers.length||c.length<4)continue;
   const ix={position:resultColumn(headers,/^着順$/,/着順/),frameNo:resultColumn(headers,/枠番/,/^枠$/),horseNo:resultColumn(headers,/馬番/),horseName:resultColumn(headers,/馬名/),carriedWeight:resultColumn(headers,/斤量/),jockey:resultColumn(headers,/騎手/),time:resultColumn(headers,/タイム/,/走破時計/),margin:resultColumn(headers,/着差/),last3f:resultColumn(headers,/上り3F/,/上がり3F/,/^上り$/),corner:resultColumn(headers,/コーナー/,/通過順位/),popularity:resultColumn(headers,/人気/),odds:resultColumn(headers,/単勝/,/オッズ/),bodyWeight:resultColumn(headers,/馬体重/)};
   const at=k=>ix[k]>=0?c[ix[k]]:'';
   const positionText=at('position'),position=numericCell(positionText,1,99),horseNo=numericCell(at('horseNo'),1,99);
   if(horseNo==null||(!position&&!/(取消|除外|中止|失格)/.test(positionText)))continue;
   const horseName=plausibleHorseName(at('horseName'))?at('horseName'):'';
   const time=at('time').match(/\b\d+:[0-5]\d(?:\.\d+)?\b/)?.[0]||'';
   const bw=at('bodyWeight').match(/(\d{3,4})(?:\s*\(([+\-−]?\d+)\))?/);
   const item={position,positionText:position?String(position):positionText,frameNo:numericCell(at('frameNo'),1,8),horseNo,horseName,time,margin:at('margin')||'',last3f:numericCell(at('last3f'),25,60),cornerPositions:at('corner')||'',popularity:numericCell(at('popularity'),1,99),finalOdds:numericCell(at('odds'),1,9999),bodyWeight:bw?Number(bw[1]):null,bodyWeightChange:bw?.[2]!=null?Number(String(bw[2]).replace('−','-')):null,carriedWeight:numericCell(at('carriedWeight'),40,80),jockey:at('jockey')||''};
   results.push(item);if(time)actualTimes[String(horseNo)]=time;
 }
 if(!results.length){
   const legacyOrder=[];
   for(const row of tableRows(html)){
     const c=row.cells,pos=String(c[0]||'').match(/^(\d{1,2})$/);if(!pos||c.length<4)continue;
     const nums=[];for(let i=1;i<Math.min(c.length,7);i++){const m=String(c[i]||'').match(/^(\d{1,2})$/);if(m&&Number(m[1])>=1&&Number(m[1])<=18)nums.push(m[1])}
     const horseNo=Number(nums.length>=2?nums[1]:nums[0]);if(!horseNo)continue;const position=Number(pos[1]),time=row.text.match(/\b\d+:[0-5]\d(?:\.\d+)?\b/)?.[0]||'';
     if(position>=1&&position<=3)legacyOrder[position-1]=String(horseNo);if(time)actualTimes[String(horseNo)]=time;results.push({position,positionText:String(position),horseNo,horseName:'',time,parserFallback:true});
   }
   results.sort((a,b)=>a.position-b.position);return {finishOrder:legacyOrder.filter(Boolean),actualTimes,results,parserFallback:true};
 }
 results.sort((a,b)=>(a.position??999)-(b.position??999)||a.horseNo-b.horseNo);
 const finishOrder=results.filter(x=>x.position!=null).map(x=>String(x.horseNo));
 return {finishOrder,actualTimes,results};
}
export function parseRaceMeta(html){
 const text=cleanText(html);
 const dists=[...text.matchAll(/(?:ダート|芝|右|左|外|内)?\s*(\d{3,4})\s*[mｍ]/gi)].map(m=>Number(m[1])).filter(v=>v>=800&&v<=3600);
 const distance=dists.length?dists[0]:null;
 const weather=text.match(/天候[:：]?\s*(晴|曇|雨|雪)/)?.[1]||'';
 const trackCondition=text.match(/(?:馬場|馬場状態)[:：]?\s*(良|稍重|重|不良)/)?.[1]||'不明';
 const candidates=[...[...String(html).matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)].map(m=>cleanText(m[1])),...[...String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)].map(m=>cleanText(m[1]))].filter(Boolean);
 let raceName=candidates.find(x=>!/(地方競馬情報サイト|NAR|Keiba|競馬情報)/i.test(x)&&x.length>=2&&x.length<=100)||'';
 raceName=raceName.replace(/^\d{1,2}R\s*/,'').trim();
 return {raceName,distance,weather,trackCondition,surface:/芝\s*\d{3,4}\s*[mｍ]/.test(text)?'芝':'ダート'};
}
export function parseRaceCard(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<2)continue;
   const marked=row.raw.match(/<font\b[^>]*class=["']?bamei["']?[^>]*>[\s\S]*?<b[^>]*>([\s\S]*?)<\/b>/i);
   const nameIndex=marked?row.blocks.findIndex(x=>/class=["']?bamei/i.test(x.html)):-1;
   const before=c.slice(0,nameIndex>=0?nameIndex:c.length);
   const nums=before.map(x=>String(x).trim().match(/^(\d{1,2})$/)?.[1]).filter(x=>x&&Number(x)>=1&&Number(x)<=18);
   const no=nums.length?String(Number(nums.at(-1))):null;
   let name=marked?cleanText(marked[1]):'';
   if(!name&&no){
     const at=c.findIndex(x=>String(Number(String(x).trim()))===no);
     name=c.slice(at+1,Math.min(c.length,at+4)).find(plausibleHorseName)||'';
   }
   if(!no||!plausibleHorseName(name))continue;
   const start=Math.max(0,nameIndex+1);
   let weight=null,sexAge='',jockey='',trainer='';
   for(let i=start;i<c.length;i++){
     const s=String(c[i]||'').trim();
     if(!sexAge&&/^[牡牝セ騙]\s*\d+$/.test(s))sexAge=s.replace(/\s+/g,'');
     const wm=s.match(/^(\d{2}(?:\.\d)?)$/);if(weight==null&&wm){const v=Number(wm[1]);if(v>=45&&v<=65)weight=v;}
   }
   const texts=c.slice(start).filter(x=>x&&!/^\d+(?:\.\d+)?$/.test(String(x)));
   if(texts.length)jockey=String(texts[0]||'').trim();
   if(texts.length>1)trainer=String(texts[texts.length-1]||'').trim();
   out.push({horseNo:no,horseName:cleanText(name),weight,sexAge,jockey,trainer,rowHtml:row.raw});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 return [...byNo.values()].sort((a,b)=>Number(a.horseNo)-Number(b.horseNo));
}
export function parseTanFuku(html){
 const out=[];
 for(const row of tableRows(html)){
   const c=row.cells;if(c.length<4)continue;
   const frame=String(c[0]||"").match(/^(\d{1,2})$/)?.[1];
   const no=String(c[1]||"").match(/^(\d{1,2})$/)?.[1];if(!no||Number(no)<1||Number(no)>18)continue;
   const name=String(c[2]||"").trim();if(!plausibleHorseName(name))continue;
   const cand=String(c[3]||"").replace(/,/g,"").match(/(\d+(?:\.\d+)?)/);if(!cand)continue;
   const odds=Number(cand[1]);if(!Number.isFinite(odds)||odds<1||odds>=1000)continue;
   out.push({frameNo:frame?Number(frame):null,horseNo:String(Number(no)),horseName:name,odds});
 }
 const byNo=new Map();for(const x of out)if(!byNo.has(x.horseNo))byNo.set(x.horseNo,x);
 const result=[...byNo.values()];[...result].sort((a,b)=>a.odds-b.odds).forEach((x,i)=>x.popularity=i+1);return result;
}
export function compactTimeToSec(v){
 const s=String(v||'').replace(/\D/g,'');if(s.length<3||s.length>4)return null;
 const tenth=Number(s.at(-1)),sec=Number(s.slice(-3,-1)),min=Number(s.slice(0,-3)||0);
 if(sec>59)return null;return min*60+sec+tenth/10;
}
function locateHorseSegments(detailHtml,horses){
 const detailHorses=parseRaceCard(detailHtml),byNo=new Map(detailHorses.map(h=>[String(h.horseNo),h.rowHtml]));
 const byName=new Map(detailHorses.map(h=>[String(h.horseName),h.rowHtml]));
 return horses.map(h=>cleanText(byNo.get(String(h.horseNo))||byName.get(String(h.horseName))||''));
}
export function parseRuns(segment,targetDistance,trackName){
 const runs=[];
 // NAR DebaTableSmall actual format:
 // 船橋08.06 良 左 1200 ... 5/7 2人 ... 1159（2.3） 2-2-1 39.5
 // Ver.9.5 incorrectly expected "着順 YY.MM.DD". Ver.9.6 anchors on the real MM.DD block.
 const re=/([^\s]{0,8}?)(\d{2}\.\d{2})\s*(良|稍重|重|不良)\s*(?:ナ\s*)?(右|左|直|外|内)?\s*(\d{3,4})/g;
 const hits=[...segment.matchAll(re)].slice(0,5);
 for(let i=0;i<hits.length;i++){
   const m=hits[i],start=m.index,end=i+1<hits.length?hits[i+1].index:Math.min(segment.length,start+420);
   const chunk=segment.slice(start,end);
   const finishField=chunk.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})\s+(\d{1,2})人/);
   if(!finishField)continue;
   const finish=Number(finishField[1]),fieldSize=Number(finishField[2]);
   if(!Number.isFinite(finish)||finish<1||finish>fieldSize||fieldSize<2)continue;
   const dist=Number(m[5])||null,popularity=Number(finishField[3])||null;
   const compact=chunk.match(/\b(\d{3,4})（[^）]*）/)?.[1]||null;
   const timeSec=compactTimeToSec(compact);
   const corners=chunk.match(/\b(\d{1,2}(?:-\d{1,2}){1,4})\b/)?.[1]||'';
   const decimals=[...chunk.matchAll(/\b([2-5]\d\.\d)\b/g)].map(x=>Number(x[1])).filter(v=>v>=30&&v<=55);
   const last3f=decimals.length?decimals[decimals.length-1]:null;
   const venue=(String(m[1]||'').match(/[一-龠々ヶァ-ヶー]+/)||[])[0]||'';
   const exactDistance=!!(dist&&targetDistance&&dist===targetDistance);
   const nearDistance=!!(dist&&targetDistance&&Math.abs(dist-targetDistance)<=100);
   const sameTrack=!!(trackName&&(venue===trackName||chunk.startsWith(trackName)||chunk.includes(trackName+m[2])));
   let score=clamp(104-(finish-1)*6.5,40,104);
   if(exactDistance)score+=6;else if(nearDistance)score+=2;
   if(sameTrack)score+=3;
   if(last3f!=null)score+=clamp((41-last3f)*1.15,-8,8);
   runs.push({
     finish,fieldSize,popularity,date:m[2],condition:m[3],direction:m[4]||'',venue,distance:dist,timeSec,last3f,corners,
     exactDistance,nearDistance,sameDistance:exactDistance,sameTrack,
     score:clamp(score,30,110)
   });
 }
 return runs;
}
export function secToRaceTime(sec){
 if(!Number.isFinite(sec)||sec<=0)return '';
 const rounded=Math.round(sec*10)/10,m=Math.floor(rounded/60),s=(rounded-m*60).toFixed(1).padStart(4,'0');
 return `${m}:${s}`;
}
export function buildAbilityFeatures(runs,targetDistance,currentWeight=null){
 const valid=(runs||[]).filter(r=>Number.isFinite(r.score)),sameDistance=valid.filter(r=>r.sameDistance),nearDistance=valid.filter(r=>r.nearDistance),sameTrack=valid.filter(r=>r.sameTrack);
 const weights=[.35,.25,.20,.12,.08],recent=valid.slice(0,5),weightSum=weights.slice(0,recent.length).reduce((a,b)=>a+b,0)||1;
 const recentFormScore=recent.length?recent.reduce((sum,r,i)=>sum+r.score*weights[i],0)/weightSum:null;
 const fit=(primary,fallback)=>{const source=primary.length?primary:fallback;if(!source.length)return null;const coverage=Math.min(1,source.length/3);return clamp((mean(source.map(r=>r.score))||0)*.72+coverage*28,30,100)};
 const last3f=valid.map(r=>r.last3f).filter(Number.isFinite),firstCorners=valid.map(r=>Number(String(r.corners||'').split('-')[0])).filter(Number.isFinite);
 const scoreSpread=stddev(valid.map(r=>r.score)),cornerSpread=stddev(firstCorners);
 return {
   schemaVersion:1,
   recentFormScore:recentFormScore==null?null:Number(recentFormScore.toFixed(2)),
   distanceFit:sameDistance.length||nearDistance.length?Number(fit(sameDistance,nearDistance).toFixed(2)):null,
   courseFit:sameTrack.length?Number(fit(sameTrack,[]).toFixed(2)):null,
   timeAbility:null,
   last3fAbility:last3f.length?Number(clamp(100-(mean(last3f)-35)*5,30,100).toFixed(2)):null,
   paceFit:cornerSpread==null?null:Number(clamp(100-cornerSpread*12,35,100).toFixed(2)),
   runningStyleFit:null,
   weightEffect:Number.isFinite(Number(currentWeight))?Number(clamp(50+(56-Number(currentWeight))*2,35,65).toFixed(2)):null,
   classStrength:null,
   consistencyScore:scoreSpread==null?null:Number(clamp(100-scoreSpread*4,30,100).toFixed(2)),
   restPattern:null,
   trainerJockeyScore:null,
   evidence:{runs:valid.length,sameDistance:sameDistance.length,nearDistance:nearDistance.length,sameTrack:sameTrack.length,last3f:last3f.length}
 };
}
export function predictTimeFromRuns(runs,targetDistance){
 const exact=(runs||[]).filter(r=>r.distance===targetDistance&&Number.isFinite(r.timeSec)).slice(0,3);
 if(exact.length){
   const weights=[1,.82,.68].slice(0,exact.length),den=weights.reduce((a,b)=>a+b,0);
   const sec=exact.reduce((s,r,i)=>s+r.timeSec*weights[i],0)/den;
   const observedSpread=stddev(exact.map(r=>r.timeSec)),spread=clamp(observedSpread??.6,.4,1.8);
   return {time:secToRaceTime(sec),type:'実績',confidence:Math.round(clamp(72+exact.length*7,72,93)),scenarios:{standard:secToRaceTime(sec),paceFavored:secToRaceTime(sec-spread),paceAdverse:secToRaceTime(sec+spread),spreadSeconds:Number(spread.toFixed(2)),basis:'同距離実走TIMEのばらつき'}};
 }
 const near=(runs||[]).filter(r=>Number.isFinite(r.timeSec)&&r.distance&&targetDistance&&Math.abs(r.distance-targetDistance)<=300).slice(0,3);
 if(!near.length)return {time:'',type:'',confidence:null,scenarios:null};
 const weights=[1,.78,.6].slice(0,near.length),den=weights.reduce((a,b)=>a+b,0);
 const adjustedValues=near.map(r=>r.timeSec*targetDistance/r.distance),adjusted=adjustedValues.reduce((s,value,i)=>s+value*weights[i],0)/den;
 const avgGap=mean(near.map(r=>Math.abs(r.distance-targetDistance)))||0;
 const observedSpread=stddev(adjustedValues),spread=clamp(observedSpread??1,.6,2.2);
 return {time:secToRaceTime(adjusted),type:'補正',confidence:Math.round(clamp(66-avgGap/12+near.length*4,42,70)),scenarios:{standard:secToRaceTime(adjusted),paceFavored:secToRaceTime(adjusted-spread),paceAdverse:secToRaceTime(adjusted+spread),spreadSeconds:Number(spread.toFixed(2)),basis:'近距離TIMEの距離補正後ばらつき'}};
}
function enrichAbility(detailHtml,horses,targetDistance,trackName){
 const segments=locateHorseSegments(detailHtml,horses);
 const enriched=horses.map((h,i)=>{
   const runs=parseRuns(segments[i]||'',targetDistance,trackName);
   const recentIndex=runs.map(r=>Math.round(r.score));
   const sameD=runs.filter(r=>r.sameDistance),sameC=runs.filter(r=>r.sameTrack);
   const avg=mean(recentIndex),distScore=mean(sameD.map(r=>r.score)),courseScore=mean(sameC.map(r=>r.score));
   const firstCorners=runs.map(r=>Number(String(r.corners).split('-')[0])).filter(n=>Number.isFinite(n));
   const cornerAvg=mean(firstCorners);const runningStyle=cornerAvg==null?'不明':cornerAvg<=2.3?'逃げ・先行':cornerAvg<=5?'先行・好位':'差し・追込';
   const pt=predictTimeFromRuns(runs,targetDistance),features=buildAbilityFeatures(runs,targetDistance,h.weight);
   return {...h,runs,recentIndex,fiveRaceAvgIndex:avg==null?null:Math.round(avg),distanceIndex:distScore==null?null:Math.round(distScore),courseIndex:courseScore==null?null:Math.round(courseScore),features,runningStyle,predictedTime:pt.time,predictedTimeType:pt.type,predictedTimeConfidence:pt.confidence,predictedTimeScenarios:pt.scenarios,dataConfidence:Math.round(clamp(38+runs.length*8+sameD.length*4+sameC.length*2,38,92))};
 });
 const sameDistanceTimes=enriched.flatMap(h=>h.runs.filter(r=>r.sameDistance&&r.timeSec!=null).map(r=>r.timeSec));
 const best=sameDistanceTimes.length?Math.min(...sameDistanceTimes):null,worst=sameDistanceTimes.length?Math.max(...sameDistanceTimes):null;
 enriched.forEach(h=>{
   const own=h.runs.filter(r=>r.sameDistance&&r.timeSec!=null).map(r=>r.timeSec);const ownBest=own.length?Math.min(...own):null;
   h.timeIndex=ownBest==null?null:(best===worst?78:Math.round(clamp(95-35*(ownBest-best)/(worst-best),55,95)));
   h.features.timeAbility=h.timeIndex;
   const abilityParts=[h.timeIndex,h.fiveRaceAvgIndex,h.distanceIndex,h.courseIndex].filter(v=>v!=null);
   h.abilityScore=abilityParts.length?mean(abilityParts):null;
   const facts=[];if(h.recentIndex.length)facts.push(`近${h.recentIndex.length}走指数 ${h.recentIndex.join('→')}`);if(h.timeIndex!=null)facts.push(`同距離時計指数 ${h.timeIndex}`);if(h.distanceIndex!=null)facts.push(`距離適性 ${h.distanceIndex}`);if(h.courseIndex!=null)facts.push(`コース適性 ${h.courseIndex}`);
   h.reason=facts.length?`NAR公式過去走から市場非依存で算出：${facts.join(' / ')}。オッズは能力計算に未使用。`:'NAR公式出馬表は取得済みですが、解析可能な過去走が不足しています。';
 });
 const scored=enriched.filter(h=>h.abilityScore!=null);
 if(scored.length>=2){
   const max=Math.max(...scored.map(h=>h.abilityScore));
   const ex=scored.map(h=>({h,x:Math.exp((h.abilityScore-max)/7)}));
   const sum=ex.reduce((s,z)=>s+z.x,0)||1;
   ex.forEach(z=>{const p=z.x/sum;z.h.abilityWinRate=clamp(p*100,0.5,70);z.h.abilityPriorOdds=clamp(1/p,1.05,999);});
 }
 return enriched;
}

export default{
 async fetch(request,env){
 const u=new URL(request.url);
  if(u.pathname==="/api/health")return json({ok:true,version:VERSION,service:"chass-keiba-lab"});
  if(u.pathname==="/api/db/health"){
    const DB=getResearchDb(env);if(!DB)return json({ok:false,error:"d1_binding_unavailable"},503);
    try{await DB.prepare("SELECT 1 AS ok").first();return json({ok:true,database:"connected"})}catch(e){return json({ok:false,error:"d1_query_failed",detail:String(e?.message||e)},503)}
  }
  if(u.pathname==="/api/db/races"&&request.method==="GET"){
    const DB=getResearchDb(env);if(!DB)return json({ok:false,error:"d1_binding_unavailable"},503);
    try{return json({ok:true,source:"cloudflare_d1",records:await readD1Records(DB)})}catch(e){return json({ok:false,error:e?.code||"d1_read_failed",detail:String(e?.message||e)},500)}
  }
  if(u.pathname==="/api/db/research"&&request.method==="GET"){
    const DB=getResearchDb(env);if(!DB)return json({ok:false,error:"d1_binding_unavailable"},503);
    try{return json({ok:true,source:"cloudflare_d1",...await readD1ResearchDataset(DB)})}catch(e){return json({ok:false,error:e?.code||"d1_research_read_failed",detail:String(e?.message||e)},500)}
  }
  if(u.pathname==="/api/db/manifest"&&request.method==="GET"){
    const DB=getResearchDb(env);if(!DB)return json({ok:false,error:"d1_binding_unavailable"},503);
    try{return json({ok:true,source:"cloudflare_d1",records:await readD1Manifest(DB)})}catch(e){return json({ok:false,error:e?.code||"d1_manifest_failed",detail:String(e?.message||e)},500)}
  }
  if(u.pathname==="/api/db/sync"&&request.method==="POST"){
    const DB=getResearchDb(env);if(!DB)return json({ok:false,error:"d1_binding_unavailable"},503);
    try{const length=Number(request.headers.get('content-length')||0);if(length>8_000_000)return json({ok:false,error:'payload_too_large'},413);const body=await request.json(),items=Array.isArray(body?.records)?body.records:body?.raceId&&body?.record?[body]:[];if(!items.length||items.length>250)return json({ok:false,error:'invalid_sync_payload'},400);const synced=[];for(const item of items){if(!item?.raceId||!item?.record)continue;synced.push(await saveD1Record(DB,String(item.raceId),item.record))}const created=synced.filter(x=>x.status==='created').length,updated=synced.filter(x=>x.status==='updated').length,unchanged=synced.filter(x=>x.status==='unchanged').length;return json({ok:true,synced:created+updated,written:created+updated,created,updated,unchanged,records:synced})}catch(e){return json({ok:false,error:e?.code||"d1_sync_failed",detail:String(e?.message||e)},400)}
  }
  if(u.pathname==="/api/nar/race"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;
    const urls={card:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,detail:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?${q}`,odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`};
    try{
      const [ch,dh,oh]=await Promise.all([fetchText(urls.card),fetchText(urls.detail).catch(()=>""),fetchText(urls.odds).catch(()=>"")]);
      const meta=parseRaceMeta(dh||ch),detailHorses=parseRaceCard(dh),fallbackHorses=parseRaceCard(ch),cardHorses=detailHorses.length?detailHorses:fallbackHorses,odds=parseTanFuku(oh),track=TRACK_NAMES[Number(code)]||"";
      const enriched=enrichAbility(dh,cardHorses,meta.distance,track),cm=new Map(enriched.map(x=>[String(x.horseNo),x])),om=new Map(odds.map(x=>[String(x.horseNo),x]));
      const numbers=[...new Set([...enriched.map(x=>String(x.horseNo)),...odds.map(x=>String(x.horseNo))])].sort((a,b)=>Number(a)-Number(b));
      const merged=numbers.map(no=>{const c=cm.get(no)||{},o=om.get(no)||{};const cardName=String(c.horseName||'').trim(),oddsName=String(o.horseName||'').trim();const cardOk=plausibleHorseName(cardName),oddsOk=plausibleHorseName(oddsName);const horseName=cardOk?cardName:oddsOk?oddsName:`馬番${no}`;return {...c,horseNo:no,horseName,odds:o.odds??null,popularity:o.popularity??null,nameSource:cardOk?'出馬表':oddsOk?'オッズ表':'fallback'};});
      const abilityCount=merged.filter(x=>x.abilityScore!=null).length;
      const invalidHorseNames=merged.filter(x=>!plausibleHorseName(x.horseName)).length;
      return json({source:"NAR公式",version:VERSION,track,code,date,race,...meta,horses:merged,odds,quality:{horseNames:merged.length-invalidHorseNames,invalidHorseNames,total:merged.length,abilityData:abilityCount,abilityRate:merged.length?Math.round(100*abilityCount/merged.length):0,featureData:merged.filter(x=>x.features?.evidence?.runs>0).length,marketSeparated:true,parser:"DebaTableSmall-row-v9.8",predictedTime:merged.filter(x=>x.predictedTime).length,predictedTimeActual:merged.filter(x=>x.predictedTimeType==='実績').length,predictedTimeAdjusted:merged.filter(x=>x.predictedTimeType==='補正').length,predictedTimeScenarios:merged.filter(x=>x.predictedTimeScenarios).length},acquiredAt:new Date().toISOString()});
    }catch(e){return json(errorPayload(e),e?.status===404?404:502)}
  }
  if(u.pathname==="/api/nar/odds"||u.pathname==="/api/nar/sync"||u.pathname==="/api/nar/result-diagnostic"){
    const code=u.searchParams.get("code"),date=u.searchParams.get("date"),race=u.searchParams.get("race");if(!code||!date||!race)return json({error:"code,date,race are required"},400);
    const q=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(fmtDate(date))}&k_raceNo=${encodeURIComponent(race)}`;const urls={result:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceMarkTable?${q}`,resultIpat:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceMarkTable_ipat?${q}`,odds:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/OddsTanFuku?${q}`};
    try{
      if(u.pathname==="/api/nar/odds"){const oh=await fetchText(urls.odds),oo=parseTanFuku(oh);return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,odds:oo,acquiredAt:new Date().toISOString()});}
      if(u.pathname==="/api/nar/result-diagnostic"){try{const rf=await fetchNarResultResilient(urls.result,urls.resultIpat);return json({ok:true,source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,resultStatus:rf.parsed?.finishOrder?.length>=3?'available':'result_unpublished',finishOrder:rf.parsed?.finishOrder?.slice(0,3)||[],urlType:rf.urlType,fallbackUsed:!!rf.fallbackUsed,attemptCount:rf.totalAttemptCount||rf.attemptCount,diagnostics:rf.diagnostics||[],checkedAt:new Date().toISOString()})}catch(e){return json({ok:false,version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,...errorPayload(e)},200)}}
      const [resultFetch,oh]=await Promise.all([fetchNarResultResilient(urls.result,urls.resultIpat),fetchText(urls.odds).catch(()=>"")]),rh=resultFetch.html,rr=resultFetch.parsed||parseResult(rh),oo=parseTanFuku(oh),meta=parseRaceMeta(rh),om=new Map(oo.map(x=>[Number(x.horseNo),x]));
      rr.results=rr.results.map(x=>({...x,finalOdds:x.finalOdds??om.get(Number(x.horseNo))?.odds??null,popularity:x.popularity??om.get(Number(x.horseNo))?.popularity??null}));
      const total=rr.results.length,timeCount=rr.results.filter(x=>x.time).length,nameCount=rr.results.filter(x=>x.horseName).length,detailCount=rr.results.filter(x=>x.last3f!=null||x.cornerPositions||x.bodyWeight!=null).length;
      return json({source:"NAR公式",version:VERSION,track:TRACK_NAMES[Number(code)]||"",code,date,race,...rr,odds:oo,resultMeta:{weather:meta.weather,trackCondition:meta.trackCondition},quality:{resultRows:total,resultParseRate:rr.parserFallback?50:total?100:0,actualTimeRate:total?Math.round(100*timeCount/total):0,resultHorseNameRate:total?Math.round(100*nameCount/total):0,resultDetailRate:total?Math.round(100*detailCount/total):0,parser:rr.parserFallback?'legacy-fallback':'header-mapped-v1'},acquiredAt:new Date().toISOString(),pending:rr.finishOrder.length<3,resultStatus:rr.finishOrder.length<3?'result_unpublished':'available',attemptCount:resultFetch.totalAttemptCount||resultFetch.attemptCount,urlType:resultFetch.urlType,fallbackUsed:!!resultFetch.fallbackUsed,fallbackTried:!!resultFetch.fallbackTried,diagnostics:resultFetch.diagnostics||[],checkedAt:new Date().toISOString()});
    }catch(e){return json(errorPayload(e),e?.status===404?404:502)}
  }
  if(env?.ASSETS){const reqUrl=new URL(request.url);if(u.pathname==="/")reqUrl.pathname="/index.html";return env.ASSETS.fetch(new Request(reqUrl,request))}
  return new Response("Not Found",{status:404});
 }
};
