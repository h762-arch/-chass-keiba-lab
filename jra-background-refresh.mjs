import {handleJraMeetingRequest,validDate} from './jra-meeting-discovery.mjs';

export const JRA_BACKGROUND_REFRESH_VERSION='jra-background-v1';
export const JRA_MEETING_CACHE_SCHEMA=`CREATE TABLE IF NOT EXISTS jra_meeting_calendar (
  date TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  meetings_json TEXT NOT NULL DEFAULT '[]',
  checked_at TEXT NOT NULL,
  next_refresh_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'JRA_OFFICIAL',
  parser_version TEXT,
  error_code TEXT
)`;

const enabled=value=>value===true||value==='true';
const iso=value=>new Date(value).toISOString();
export function tokyoDate(value=new Date()){const d=value instanceof Date?value:new Date(value);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
export function jraMeetingRefreshTargets(value=new Date()){const today=tokyoDate(value),tomorrow=new Date(`${today}T00:00:00+09:00`);tomorrow.setUTCDate(tomorrow.getUTCDate()+1);return [today,tokyoDate(tomorrow)];}
export function jraMeetingRefreshTtl(date,now=new Date(),ok=true){if(!ok)return 15*60_000;const today=tokyoDate(now);if(date<today)return 24*60*60_000;return date===today?30*60_000:6*60*60_000;}

async function ensureSchema(DB){if(DB?.prepare)await DB.prepare(JRA_MEETING_CACHE_SCHEMA).run();}
async function readRow(DB,date){return DB.prepare(`SELECT date,status,meetings_json,checked_at,next_refresh_at,source,parser_version,error_code FROM jra_meeting_calendar WHERE date=?`).bind(date).first();}
function rowBody(row){if(!row)return null;let meetings=[];try{meetings=JSON.parse(row.meetings_json||'[]')}catch{}return {ok:row.status==='complete',status:row.status==='complete'?'meeting':'unknown',organization:'JRA',date:row.date,meetings,checkedAt:row.checked_at,source:row.source,parserVersion:row.parser_version,error:row.error_code||undefined,scheduleOnly:true,persistentCache:true};}
async function writeRow(DB,date,body,nowMs){const ok=body?.ok===true&&Array.isArray(body.meetings)&&body.meetings.every(x=>x?.organization==='JRA'&&x?.date===date&&['meeting','non_meeting'].includes(x?.status));const checkedAt=new Date(nowMs).toISOString(),nextRefreshAt=new Date(nowMs+jraMeetingRefreshTtl(date,new Date(nowMs),ok)).toISOString(),status=ok?'complete':'unknown',meetings=ok?body.meetings:[];await DB.prepare(`INSERT INTO jra_meeting_calendar (date,status,meetings_json,checked_at,next_refresh_at,source,parser_version,error_code) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(date) DO UPDATE SET status=excluded.status,meetings_json=excluded.meetings_json,checked_at=excluded.checked_at,next_refresh_at=excluded.next_refresh_at,source=excluded.source,parser_version=excluded.parser_version,error_code=excluded.error_code`).bind(date,status,JSON.stringify(meetings),checkedAt,nextRefreshAt,body?.source||'JRA_OFFICIAL',body?.parserVersion||null,ok?null:body?.error||'JRA_OFFICIAL_UNAVAILABLE').run();return {ok,status,checkedAt,nextRefreshAt,meetings,error:ok?null:body?.error||'JRA_OFFICIAL_UNAVAILABLE'};}
async function fetchMeeting(date,env,handler,nowMs){const request=new Request(`https://chass.internal/api/jra/meeting?date=${encodeURIComponent(date)}`),response=await handler(request,env),body=await response.json();return {response,body,saved:await writeRow(env.DB,date,body,nowMs)};}

export async function handleJraMeetingPersistent(request,env={},options={}){const handler=options.handler||handleJraMeetingRequest,nowMs=Number(options.now?.())||Date.now(),url=new URL(request.url),date=url.searchParams.get('date')||'';if(!env.DB?.prepare||!validDate(date)||!['GET','HEAD'].includes(request.method))return handler(request,env);try{await ensureSchema(env.DB);if(url.searchParams.get('refresh')!=='1'){const row=await readRow(env.DB,date);if(row&&Date.parse(row.next_refresh_at)>nowMs){const body=rowBody(row);return new Response(request.method==='HEAD'?null:JSON.stringify(body),{status:body.ok?200:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-Meeting-Cache':'D1-HIT'}});}}const {response,body}=await fetchMeeting(date,env,handler,nowMs);return new Response(request.method==='HEAD'?null:JSON.stringify(body),{status:response.status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-CHASS-Meeting-Cache':'D1-MISS'}});}catch{return handler(request,env);}}

export async function runScheduledJraMeetingRefresh(DB,{now=new Date(),env={},handler=handleJraMeetingRequest}={}){if(!DB?.prepare)return {processed:0,skipped:true,reason:'d1_unavailable'};if(!enabled(env.ENABLE_JRA_BACKGROUND_REFRESH)||!enabled(env.ENABLE_JRA_MEETING_DISCOVERY))return {processed:0,skipped:true,reason:'feature_disabled'};const nowMs=new Date(now).getTime();await ensureSchema(DB);const targets=jraMeetingRefreshTargets(now);for(const date of targets){const row=await readRow(DB,date);if(row&&Date.parse(row.next_refresh_at)>nowMs)continue;const {body,saved}=await fetchMeeting(date,{...env,DB},handler,nowMs);return {processed:1,date,status:saved.status,meetingCount:saved.meetings.filter(x=>x.status==='meeting').length,error:saved.error||body?.error||null,nextRefreshAt:saved.nextRefreshAt};}return {processed:0,skipped:true,reason:'fresh_cache'};}
