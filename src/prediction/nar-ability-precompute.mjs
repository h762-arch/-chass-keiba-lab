import {NAR_VENUE_ROUTING_VERSION,snapshotNarTrackCode} from '../nar/nar-venue-routing.mjs';
import {diagnoseNarRaceQuality,diagnoseNarRestoredRaceBatch} from './nar-quality-diagnostics.mjs';
import {materializeNarSharedHistory,narSharedHistorySchemaReady,verifyNarRollingHistory} from './nar-shared-history-store.mjs';
import {attachNarHistoryIdentity,verifyNarHistoryIdentity} from './nar-history-identity-bridge.mjs';
import {retainNarCardHistory} from './nar-history-pack.mjs';
import {buildNarPreAnalysisPack,verifyNarPreAnalysisPack} from './nar-pre-analysis-pack.mjs';
import {retainNarAbilityEvidence,auditNarAbilityEvidence} from './nar-ability-evidence.mjs';
import {narAbilityRunWindow} from './nar-ability-run-window.mjs';
import {meetingText,parseNarRaceList} from '../../meeting-discovery.mjs';
import {createPrecomputedSnapshot,createSnapshotHash} from './precomputed-snapshot.mjs';
import {snapshotToD1Values,readLatestPrecomputedSnapshot,d1RowToSnapshot} from './precomputed-store.mjs';
export const NAR_ABILITY_VERSION='NAR_ABILITY_PRECOMPUTE_V1';
export const NAR_ABILITY_VIEWER_MODE='nar-precomputed-ability-research';
const TRACKS={10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'金沢',23:'笠松',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'};
const respond=(body,options={})=>Response.json(body,{...options,headers:{'access-control-allow-origin':'*','cache-control':'no-store'}});
const flags={researchOnly:true,formalKpiEligible:false,productionActivationReady:false};
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const number=v=>v!=null&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const id=(date,code,race)=>`${date.replaceAll('-','')}-NAR-${code}-${String(race).padStart(2,'0')}`;
const off=(date,time)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(time||'')?Date.parse(`${date}T${time}:00+09:00`):NaN;
const fail=reason=>{throw new Error(reason);};
const meetingAttemptAudit=value=>Array.isArray(value)?value.slice(0,3).flatMap(item=>{const route=['RaceList','RaceList_ipat','RaceList_mobile'].includes(item?.route)?item.route:null,reason=['SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_URL','SOURCE_DECODE','MEETING_UNCONFIRMED','MEETING_SOURCE_FAILED'].includes(item?.reason)?item.reason:null,status=reason==='SOURCE_HTTP'&&Number.isInteger(Number(item?.httpStatus))&&Number(item.httpStatus)>=100&&Number(item.httpStatus)<=599?Number(item.httpStatus):null;return route&&reason?[{route,reason,...(status?{httpStatus:status}:{})}]:[];}):[];
const escapeRegExp=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function parseNarMobileRaceList(html,{code,track,date}={}){
 if(!TRACKS[String(code)]||TRACKS[String(code)]!==track||!validDate(date))return {status:'meeting_unknown',meeting:false,track,date,raceNumbers:[],source:'NAR公式 Mobile RaceList',reason:'invalid_request'};
 const text=meetingText(html).normalize('NFKC'),[y,m,d]=date.split('-').map(Number),header=new RegExp(`${escapeRegExp(track)}競馬(?:場)?\\s*${y}年\\s*${m}月\\s*${d}日`).test(text),numbers=[];
 for(const match of String(html).matchAll(/href=["']([^"']*\/KeibaWebSP\/TodayRaceInfo\/S_DebaTable[^"']*)["']/gi)){
  try{const u=new URL(match[1].replaceAll('&amp;','&'),'https://sp.keiba.go.jp');if(u.origin!=='https://sp.keiba.go.jp'||u.pathname!=='/KeibaWebSP/TodayRaceInfo/S_DebaTable'||u.searchParams.get('k_babaCode')!==String(code)||u.searchParams.get('k_raceDate')!==date.replaceAll('-','/'))continue;const race=Number(u.searchParams.get('k_raceNo'));if(Number.isInteger(race)&&race>=1&&race<=20)numbers.push(race);}catch{}
 }
 const raceNumbers=[...new Set(numbers)].sort((a,b)=>a-b),explicitNonMeeting=/(?:開催はありません|開催情報はありません|レース情報がありません|該当するレースはありません)/.test(text);
 if(header&&raceNumbers.length)return {status:'meeting',meeting:true,track,date,raceNumbers,changes:[],source:'NAR公式 Mobile RaceList'};
 if(header&&explicitNonMeeting)return {status:'non_meeting',meeting:false,track,date,raceNumbers:[],changes:[],source:'NAR公式 Mobile RaceList'};
 return {status:'meeting_unknown',meeting:false,track,date,raceNumbers:[],changes:[],source:'NAR公式 Mobile RaceList',reason:header?'race_numbers_missing':'identity_mismatch'};
}
export function assertNarAbilityCardIdentity(html,{date,track,race}){
 const header=meetingText(String(html).split(/<(?:tr\b[^>]*class=["'][^"']*\bdbitem\b|font\b[^>]*class=["'][^"']*\bbamei\b)/i)[0]).normalize('NFKC').replace(/\s+/g,'');
 const [y,m,d]=String(date).split('-').map(Number);
 if(!validDate(date)||!Object.values(TRACKS).includes(track)||!Number.isInteger(race)||race<1||race>99||!new RegExp(`${y}年0?${m}月0?${d}日`).test(header)||!header.includes(track)||!header.includes(`第${race}競走`))fail('CARD_IDENTITY');
}
export async function fetchNarPrecomputeHtml(url,{timeoutMs=5000,fetchImpl=globalThis.fetch}={}){
 const u=new URL(url),allowed=(u.origin==='https://www.keiba.go.jp'&&['/KeibaWeb/TodayRaceInfo/RaceList','/KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat','/KeibaWeb/TodayRaceInfo/DebaTableSmall','/KeibaWeb/TodayRaceInfo/DebaTable'].includes(u.pathname))||(u.origin==='https://sp.keiba.go.jp'&&u.pathname==='/KeibaWebSP/TodayRaceInfo/S_RaceList');if(!allowed||u.username||u.password)fail('SOURCE_URL');
 const controller=new AbortController();let reader,timer;
 try{return await Promise.race([new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('SOURCE_DEADLINE'));},timeoutMs);}), (async()=>{
  const r=await fetchImpl(url,{redirect:'manual',signal:controller.signal});if(controller.signal.aborted){void r.body?.cancel();fail('SOURCE_DEADLINE');}if(!r.ok||r.redirected||r.status!==200){const error=new Error('SOURCE_HTTP');error.httpStatus=Number.isInteger(Number(r.status))?Number(r.status):null;throw error;}reader=r.body.getReader();const parts=[];let size=0;
  while(true){const next=await reader.read();if(controller.signal.aborted)fail('SOURCE_DEADLINE');if(next.done)break;size+=next.value.byteLength;if(size>1000000)fail('SOURCE_SIZE');parts.push(next.value);}
  const raw=new Uint8Array(size);let at=0;for(const p of parts){raw.set(p,at);at+=p.byteLength;}try{return new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('SOURCE_DECODE');}
 })()]);}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
export async function fetchNarPrecomputeMeeting({code,date,timeoutMs=5000,fetchImpl=globalThis.fetch}={}){
 const track=TRACKS[String(code)];
 if(!track||!validDate(date)||!Number.isFinite(Number(timeoutMs))||Number(timeoutMs)<500)fail('MEETING_CONFIGURATION_INVALID');
 const query=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(date.replaceAll('-','/'))}`;
 const routes=[
  {name:'RaceList',url:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?${query}`},
  {name:'RaceList_ipat',url:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat?${query}`},
  {name:'RaceList_mobile',url:`https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?${query}`,mobile:true}
 ];
 const started=Date.now(),audit=[];
 for(let i=0;i<routes.length;i++){
  const remaining=Math.max(0,Number(timeoutMs)-(Date.now()-started));if(remaining<250)break;
  const attemptTimeout=i===routes.length-1?remaining:Math.max(250,Math.floor(remaining/2));
  try{
   const html=await fetchNarPrecomputeHtml(routes[i].url,{timeoutMs:attemptTimeout,fetchImpl}),parsed=routes[i].mobile?parseNarMobileRaceList(html,{code:String(code),track,date}):parseNarRaceList(html,{track,date});
   if(parsed.track!==track||parsed.date!==date||!['meeting','non_meeting'].includes(parsed.status))fail('MEETING_UNCONFIRMED');
   return {...parsed,sourceRoute:routes[i].name,attemptCount:i+1};
  }catch(error){const reason=['SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_URL','SOURCE_DECODE','MEETING_UNCONFIRMED'].includes(error?.message)?error.message:'MEETING_SOURCE_FAILED',status=reason==='SOURCE_HTTP'&&Number.isInteger(Number(error?.httpStatus))&&Number(error.httpStatus)>=100&&Number(error.httpStatus)<=599?Number(error.httpStatus):null;audit.push({route:routes[i].name,reason,...(status?{httpStatus:status}:{})});}
 }
 const error=new Error('MEETING_SOURCE_UNAVAILABLE');error.meetingAudit=audit;throw error;
}
export function createNarAbilityPrecomputeRunner(env,{meeting,card,historyLinks,wallNow=Date.now,scheduledTime=Date.now()}={}){
 if(String(env?.ENABLE_NAR_ABILITY_PRECOMPUTE||'false')!=='true')return null;
 return async()=>{
  const codes=String(env.NAR_PRECOMPUTE_TRACK_CODES||'').split(',').map(v=>v.trim()).filter(Boolean),limit=Number(env.NAR_PRECOMPUTE_MAX_JOBS||3),budget=Number(env.NAR_PRECOMPUTE_BUDGET_MS||20000);
  if(!codes.length||codes.length>3||new Set(codes).size!==codes.length||codes.some(c=>!TRACKS[c])||!Number.isInteger(limit)||limit<1||limit>4||!Number.isInteger(budget)||budget<1000||budget>30000||!env.DB?.prepare||typeof meeting!=='function'||typeof card!=='function')return {status:'BLOCKED',reason:'CONFIGURATION_INVALID'};
  const start=wallNow(),date=new Date(start+9*3600000).toISOString().slice(0,10),deadline=start+budget,events=[],jobs=[];
  const window=narAbilityRunWindow(env,start);
  if(!window.active)return {status:window.status,reason:window.reason,date};
  const stop=window.stop;
  const remaining=()=>Math.max(0,Math.min(deadline,stop)-wallNow());
  try{await env.DB.prepare('SELECT organization,race_id,revision,source_json,data_json,calculation_version,model_version FROM precomputed_race_snapshots LIMIT 0').all();}catch{return {status:'BLOCKED',reason:'SCHEMA_UNAVAILABLE'};}
  for(const code of codes){
   if(!remaining()){events.push({track:TRACKS[code],reason:'DEADLINE'});continue;}
   try{const m=await meeting({code,date,timeoutMs:Math.min(5000,remaining())});if(m.track!==TRACKS[code]||m.date!==date||!['meeting','non_meeting'].includes(m.status)||!Array.isArray(m.raceNumbers))fail('MEETING_UNCONFIRMED');
    if(m.status==='non_meeting'){events.push({track:m.track,reason:'NON_MEETING'});continue;}
    if(!m.raceNumbers.length||m.raceNumbers.length>99||m.raceNumbers.some(r=>!Number.isInteger(r)||r<1||r>99)||new Set(m.raceNumbers).size!==m.raceNumbers.length)fail('MEETING_UNCONFIRMED');
    for(const race of m.raceNumbers){const raceId=id(date,code,race),existing=await readLatestPrecomputedSnapshot(env.DB,'NAR',raceId);if(existing){events.push({raceId,reason:'ALREADY_SAVED'});continue;}jobs.push({code,date,race,track:m.track,raceId});}
   }catch(error){const reason=['MEETING_SOURCE_UNAVAILABLE','MEETING_UNCONFIRMED','MEETING_CONFIGURATION_INVALID'].includes(error?.message)?error.message:'MEETING_UNAVAILABLE',attempts=meetingAttemptAudit(error?.meetingAudit);events.push({track:TRACKS[code],reason,...(attempts.length?{meetingAttempts:attempts}:{})});}
  }
  const offset=jobs.length?Math.floor(Number(scheduledTime)/300000)*limit%jobs.length:0,queue=[...jobs.slice(offset),...jobs.slice(0,offset)];let attempted=0,saved=0;
  for(const job of queue){
   if(attempted>=limit||!remaining()){events.push({raceId:job.raceId,reason:remaining()?'NOT_SELECTED_LIMIT':'DEADLINE'});continue;}attempted++;
   try{
    const p=await card({...job,timeoutMs:Math.min(5000,remaining())}),at=wallNow(),post=off(date,p.postTime);
    if(p.historicalResearch||p.resultSnapshot||p.finishOrder?.length)fail('CARD_IDENTITY');
    if(p.ok!==true||p.organization!=='NAR'||p.date!==date||p.track!==job.track||String(p.code)!==job.code||Number(p.race)!==job.race)fail('CARD_IDENTITY');
    if(!Number.isFinite(post))fail('POST_TIME_UNKNOWN');if(at>=post)fail('POST_TIME_REACHED');if(!remaining())fail('DEADLINE');
    if(!['ダート','芝'].includes(p.surface)||!Number.isInteger(Number(p.distance))||Number(p.distance)<800||Number(p.distance)>3600)fail('RACE_CONTEXT_INVALID');
    if(!Array.isArray(p.horses)||p.horses.length<2||p.horses.length>30||new Set(p.horses.map(h=>Number(h.horseNo))).size!==p.horses.length||p.horses.some(h=>!Number.isInteger(Number(h.horseNo))||Number(h.horseNo)<1||Number(h.horseNo)>30||typeof h.horseName!=='string'||!h.horseName.trim()||h.horseName.length>80))fail('FIELD_INVALID');
    const active=p.horses.filter(h=>!['scratched','excluded','withdrawn'].includes(h.horseStatus||h.runnerStatus)),scored=active.filter(h=>number(h.abilityScore)!=null);if(scored.length<2)fail('ABILITY_INSUFFICIENT');
    const ranks=new Map([...scored].sort((a,b)=>b.abilityScore-a.abilityScore||a.horseNo-b.horseNo).map((h,i)=>[Number(h.horseNo),i+1]));
    let links=null,linkAudit={status:'DISABLED',reasonCode:'HISTORY_LINKS_DISABLED'};
    if(String(env.ENABLE_NAR_HISTORY_LINKS||'false')==='true'){
     if(typeof historyLinks!=='function')linkAudit={status:'HOLD',reasonCode:'HISTORY_PROVIDER_NOT_CONNECTED'};
     else if(remaining()>0){try{links=await historyLinks({...job,expectedHorses:p.horses,timeoutMs:Math.min(2000,remaining())});if(!links)throw Error('LINKS_UNAVAILABLE');linkAudit={status:'RESOLVED',reasonCode:null};}catch{links=null;linkAudit={status:'HOLD',reasonCode:'HISTORY_SOURCE_OR_IDENTITY_FAILED'};}}
    }
    if(wallNow()>=post||!remaining())fail('DEADLINE');
    const data={venueRoutingVersion:NAR_VENUE_ROUTING_VERSION,race:{date,track:job.track,raceNo:job.race,raceName:p.raceName||'',postTime:p.postTime,surface:p.surface,distance:p.distance},horses:p.horses.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,abilityScore:number(h.abilityScore),abilityRank:ranks.get(Number(h.horseNo))??null,predictedTime:h.predictedTime||null,runnerStatus:h.horseStatus||h.runnerStatus||'active',evidence:retainNarAbilityEvidence(h)})),...flags};
    const iso=new Date(at).toISOString();data.horses=await Promise.all(data.horses.map(async(h,i)=>({...h,history:await retainNarCardHistory({raceId:job.raceId,horseNo:h.horseNo,sourceAcquiredAt:iso,runs:p.horses[i].runs})})));if(links){try{const enriched=await Promise.all(data.horses.map(h=>attachNarHistoryIdentity(h.history,links,{raceId:job.raceId,horseNo:h.horseNo,horseName:h.horseName,sourceAcquiredAt:iso})));data.horses=data.horses.map((h,i)=>({...h,history:enriched[i]}));data.historyLinks=links;linkAudit={status:'RESOLVED',reasonCode:null,providerHorseCount:enriched.length,resolvedEpisodeCount:enriched.reduce((n,h)=>n+h.body.identity.resolvedEpisodeCount,0),heldEpisodeCount:enriched.reduce((n,h)=>n+h.body.identity.references.filter(r=>r.status==='HOLD').length,0)};}catch{linkAudit={status:'HOLD',reasonCode:'HISTORY_FACT_JOIN_FAILED'};}}data.historyLinkAudit={...linkAudit,recoveryAction:linkAudit.status==='RESOLVED'?'Connect canonical episodes to the shared history store.':'Retry only in a new eligible run; preserve frozen DATA.'};data.historyStoreAudit={status:'DISABLED',reasonCode:'SHARED_HISTORY_STORE_DISABLED'};
    if(String(env.ENABLE_NAR_SHARED_HISTORY||'false')==='true'){
     if(!data.historyLinks)data.historyStoreAudit={status:'HOLD',reasonCode:'HISTORY_IDENTITY_UNAVAILABLE'};
     else try{const stored=await materializeNarSharedHistory(env.DB,{raceId:job.raceId,sourceAcquiredAt:iso,cutoffAt:new Date(wallNow()).toISOString(),horses:data.horses,links:data.historyLinks,canContinue:()=>remaining()>0&&wallNow()<post});data.horses=stored.horses;data.historyStoreAudit=stored.audit;data.historyLinkAudit.recoveryAction='Review shared research projection; resolve held episodes before model use.';}catch(e){data.historyStoreAudit={status:'HOLD',reasonCode:['HISTORY_SCHEMA_UNAVAILABLE','HISTORY_DEADLINE','HISTORY_OBSERVATION_LIMIT','HISTORY_READ_UNVERIFIED','HISTORY_SAVE_UNVERIFIED','HISTORY_IDENTITY_UNVERIFIED','HISTORY_WRITE_CONTEXT'].includes(e.message)?e.message:'HISTORY_STORE_UNAVAILABLE',recoveryAction:'Provision and validate the research store before a new eligible run; preserve original DATA.'};}
    }
    data.preAnalysisPack=await buildNarPreAnalysisPack({raceId:job.raceId,race:data.race,sourceAcquiredAt:iso,horses:data.horses});
    const snapshot=await createPrecomputedSnapshot({organization:'NAR',raceId:job.raceId,source:{organization:'NAR',raceId:job.raceId,date,track:job.track,raceNo:job.race,acquiredAt:iso,source:'NAR_OFFICIAL_CARD',...flags},data,versions:{calculationVersion:NAR_ABILITY_VERSION,modelVersion:NAR_ABILITY_VERSION},now:new Date(wallNow()).toISOString()});
    if(wallNow()>=post||!remaining())fail('DEADLINE');
    const values=snapshotToD1Values(snapshot,{revision:1,createdAt:new Date(wallNow()).toISOString()});
    const write=await env.DB.prepare('INSERT OR IGNORE INTO precomputed_race_snapshots (organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(...values).run();
    const checked=await readLatestPrecomputedSnapshot(env.DB,'NAR',job.raceId);if(!checked)fail('SAVE_UNVERIFIED');const own=checked.snapshotHash===snapshot.snapshotHash&&Number(write?.meta?.changes)>0;if(own)saved++;events.push({raceId:job.raceId,reason:own?'SAVED':'ALREADY_SAVED'});
   }catch(e){events.push({raceId:job.raceId,reason:['CARD_IDENTITY','POST_TIME_UNKNOWN','POST_TIME_REACHED','DEADLINE','FIELD_INVALID','RACE_CONTEXT_INVALID','ABILITY_INSUFFICIENT','SAVE_UNVERIFIED'].includes(e.message)?e.message:'SOURCE_OR_SAVE_FAILED'});}
  }
  return {status:'COMPLETED',date,attempted,saved,events,...flags};
 };
}
export async function handleNarAbilityViewer(request,env){
 const url=new URL(request.url);if(String(env?.ENABLE_NAR_ABILITY_VIEWER||'false')!=='true'||url.searchParams.get('organization')!=='NAR'||!['/api/chass/v1/public/races','/api/chass/v1/public/day','/api/chass/v1/public/day-ai','/api/chass/v1/public/race'].includes(url.pathname))return null;
 const date=url.searchParams.get('date'),track=url.searchParams.get('track')||'';if(!validDate(date)||track&&!Object.values(TRACKS).includes(track))return respond({ok:false,error:'INVALID_PARAMETER'},{status:400});
 const prefix=`${date.replaceAll('-','')}-NAR-`,rows=await env.DB.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id>=? AND race_id<? AND calculation_version=? AND model_version=? ORDER BY race_id,revision ASC LIMIT 500').bind('NAR',prefix,prefix+'\uffff',NAR_ABILITY_VERSION,NAR_ABILITY_VERSION).all(),seen=new Set(),races=[];
 for(const row of rows.results||[]){try{const s=d1RowToSnapshot(row),d=s.layers.DATA;if(seen.has(s.raceId)||d.race.date!==date||d.formalKpiEligible!==false||s.layers.MARKET||s.layers.FINAL||s.layers.RESULT)continue;if(track&&d.race.track!==track)continue;
  const code=snapshotNarTrackCode(d);
  if(s.raceId!==id(date,code,d.race.raceNo)||await createSnapshotHash({...s,layers:s.layers})!==s.snapshotHash||!Number.isFinite(Date.parse(s.sourceAcquiredAt)))continue;
  if(!Object.values(TRACKS).includes(d.race.track)||!s.raceId.startsWith(prefix)||!Number.isFinite(off(date,d.race.postTime))||Date.parse(s.sourceAcquiredAt)>=off(date,d.race.postTime))continue;
  if((await Promise.all(d.horses.map(h=>h.history?verifyNarHistoryIdentity(h.history,d.historyLinks,{raceId:s.raceId,horseNo:h.horseNo,horseName:h.horseName,sourceAcquiredAt:s.sourceAcquiredAt}):true))).some(valid=>!valid))continue;
  if((await Promise.all(d.horses.map(h=>h.rollingHistory?verifyNarRollingHistory(h.rollingHistory,{horseKey:h.history?.body.globalHorseIdentity,targetDate:date,sourceAcquiredAt:s.sourceAcquiredAt,postTime:d.race.postTime,calculatedAt:s.dataCalculatedAt}):true))).some(valid=>!valid))throw Error('invalid rolling history');
  if(d.preAnalysisPack&&!await verifyNarPreAnalysisPack(d.preAnalysisPack,{raceId:s.raceId,race:d.race,sourceAcquiredAt:s.sourceAcquiredAt,horses:d.horses}))continue;
  seen.add(s.raceId);races.push({preAnalysisPack:d.preAnalysisPack||null,historyStoreAudit:d.historyStoreAudit||null,historyLinkAudit:d.historyLinkAudit||null,preAnalysisStatus:d.preAnalysisPack?'PARTIAL':'NOT_MATERIALIZED',raceId:s.raceId,organization:'NAR',date,track:d.race.track,raceNo:d.race.raceNo,raceName:d.race.raceName,postTime:d.race.postTime,distance:d.race.distance,surface:d.race.surface,quality:auditNarAbilityEvidence(d.horses),horses:d.horses.map(h=>({...h,ability:{score:h.abilityScore},predictedTime:h.predictedTime?{text:h.predictedTime}:{},probability:{win:null,top3:null,status:'MODEL_HOLD',reasonCode:'PROBABILITY_MODEL_NOT_CONNECTED'},market:{odds:null,popularity:null},mark:null})),...flags});
 }catch{}}
 if(!races.length)return null;
 if(url.pathname.endsWith('/races'))return respond({ok:true,date,organization:'NAR',races:races.map(({horses,preAnalysisPack,...r})=>r),...flags});
 const raceNo=Number(url.searchParams.get('race'));const selected=url.pathname.endsWith('/race')?races.filter(r=>r.raceNo===raceNo):races;
 if(url.pathname.endsWith('/race'))return selected.length?respond({ok:true,...selected[0],viewerMode:NAR_ABILITY_VIEWER_MODE,marketEvaluation:'disabled'}):respond({ok:false,error:'RACE_NOT_FOUND'},{status:404});
 return respond({ok:true,date,track,organization:'NAR',count:selected.length,races:selected,viewerMode:NAR_ABILITY_VIEWER_MODE,marketEvaluation:'disabled',...flags});
}

export async function readNarAbilityCanaryStatus(env,{date,now=Date.now(),includeDiagnostics=false,diagnoseRace=diagnoseNarRaceQuality}={}){
 if(!validDate(date))return {ok:false,error:'INVALID_DATE'};
 const enabled=String(env.ENABLE_NAR_ABILITY_PRECOMPUTE||'false')==='true',window=narAbilityRunWindow(env,now);
 const base={ok:true,date,enabled,viewerEnabled:String(env.ENABLE_NAR_ABILITY_VIEWER||'false')==='true',historyStoreEnabled:String(env.ENABLE_NAR_SHARED_HISTORY||'false')==='true',canaryDate:env.NAR_PRECOMPUTE_CANARY_DATE||null,stopAt:window.stop?new Date(window.stop).toISOString():env.NAR_PRECOMPUTE_STOP_AT||null,active:enabled&&window.active&&window.date===date,scheduleMode:window.mode,scheduleStatus:window.status,scheduleReason:window.reason||null,dailyFrom:env.NAR_PRECOMPUTE_DAILY_FROM||null,dailyUntil:env.NAR_PRECOMPUTE_DAILY_UNTIL||null,dailyStartJst:env.NAR_PRECOMPUTE_DAILY_START_JST||null,dailyStopJst:env.NAR_PRECOMPUTE_DAILY_STOP_JST||null,trackCodes:String(env.NAR_PRECOMPUTE_TRACK_CODES||'').split(',').filter(Boolean),...flags};
 const diagnosticInputs=[];let restoredStatus;
 try{
  const prefix=`${date.replaceAll('-','')}-NAR-`,rows=await env.DB.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id>=? AND race_id<? AND calculation_version=? AND model_version=? ORDER BY race_id,revision ASC LIMIT 500').bind('NAR',prefix,prefix+'\uffff',NAR_ABILITY_VERSION,NAR_ABILITY_VERSION).all();
  const races=[],seen=new Set();let rejected=0;
  for(const row of rows.results||[]){try{const s=d1RowToSnapshot(row),d=s.layers.DATA,code=snapshotNarTrackCode(d);
   if(s.raceId!==id(date,code,d.race.raceNo)||await createSnapshotHash({...s,layers:s.layers})!==s.snapshotHash||d.formalKpiEligible!==false||s.layers.MARKET||s.layers.FINAL||s.layers.RESULT||!Number.isFinite(Date.parse(s.sourceAcquiredAt))||!Number.isFinite(off(date,d.race.postTime))||Date.parse(s.sourceAcquiredAt)>=off(date,d.race.postTime))throw Error('invalid');
   if((await Promise.all(d.horses.map(h=>h.history?verifyNarHistoryIdentity(h.history,d.historyLinks,{raceId:s.raceId,horseNo:h.horseNo,horseName:h.horseName,sourceAcquiredAt:s.sourceAcquiredAt}):true))).some(valid=>!valid))throw Error('invalid history');
   if((await Promise.all(d.horses.map(h=>h.rollingHistory?verifyNarRollingHistory(h.rollingHistory,{horseKey:h.history?.body.globalHorseIdentity,targetDate:date,sourceAcquiredAt:s.sourceAcquiredAt,postTime:d.race.postTime,calculatedAt:s.dataCalculatedAt}):true))).some(valid=>!valid))throw Error('invalid rolling history');
   if(d.preAnalysisPack&&!await verifyNarPreAnalysisPack(d.preAnalysisPack,{raceId:s.raceId,race:d.race,sourceAcquiredAt:s.sourceAcquiredAt,horses:d.horses}))throw Error('invalid pack');
   if(seen.has(s.raceId))continue;seen.add(s.raceId);races.push({historyStoreAudit:d.historyStoreAudit||null,historyLinkAudit:d.historyLinkAudit||null,preAnalysisStatus:d.preAnalysisPack?'PARTIAL':'NOT_MATERIALIZED',preAnalysisPackHash:d.preAnalysisPack?.packHash||null,raceId:s.raceId,track:d.race.track,raceNo:d.race.raceNo,horseCount:d.horses.length,abilityCount:d.horses.filter(h=>number(h.abilityScore)!=null).length,timeCount:d.horses.filter(h=>h.predictedTime!=null).length,quality:auditNarAbilityEvidence(d.horses)});
   if(includeDiagnostics===true)diagnosticInputs.push({raceId:s.raceId,data:d});
  }catch{rejected++;}}
  restoredStatus={...base,historyStoreSchemaReady:await narSharedHistorySchemaReady(env.DB),schemaReady:true,savedRaceCount:races.length,rejectedRowCount:rejected,races};
 }catch{return {...base,schemaReady:false,status:'BLOCKED',reason:'SCHEMA_OR_READ_UNAVAILABLE',savedRaceCount:null,races:[]};}
 // Diagnostics execute only after all row restoration/rejection and schema reads.
 // They never control races, counts, quality, Pack verification or DATA hashes.
 if(includeDiagnostics!==true)return restoredStatus;
 let qualityDiagnostics;
 try{qualityDiagnostics=diagnoseNarRestoredRaceBatch(diagnosticInputs,{diagnoseRace});}
 catch{qualityDiagnostics={schemaVersion:1,status:'UNAVAILABLE',reasonCode:'DIAGNOSTIC_ERROR',races:[]};}
 return {...restoredStatus,qualityDiagnostics};
}
