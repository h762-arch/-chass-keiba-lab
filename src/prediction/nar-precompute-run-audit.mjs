const JST_OFFSET_MS=9*60*60*1000;
const MAX_EVENTS=64;

const text=(value,max=120)=>value==null?null:String(value).slice(0,max);
const count=value=>Number.isSafeInteger(Number(value))&&Number(value)>=0?Number(value):0;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
const meetingAttempt=value=>{const route=['RaceList','RaceList_ipat','RaceList_mobile'].includes(value?.route)?value.route:null,reason=['SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_URL','SOURCE_DECODE','MEETING_UNCONFIRMED','MEETING_SOURCE_FAILED'].includes(value?.reason)?value.reason:null,status=reason==='SOURCE_HTTP'&&Number.isInteger(Number(value?.httpStatus))&&Number(value.httpStatus)>=100&&Number(value.httpStatus)<=599?Number(value.httpStatus):null;return route&&reason?{route,reason,...(status?{httpStatus:status}:{})}:null;};

function iso(value){
 const ms=value instanceof Date?value.getTime():typeof value==='number'?value:Date.parse(String(value||''));
 if(!Number.isFinite(ms))throw Error('NAR_RUN_AUDIT_SCHEDULED_AT');
 return new Date(ms).toISOString();
}

function runDate(scheduledAt){
 return new Date(Date.parse(scheduledAt)+JST_OFFSET_MS).toISOString().slice(0,10);
}

function compactEvent(event={}){
 const out={};
 const raceId=text(event.raceId,80),track=text(event.track,40),reason=text(event.reason,80);
 if(raceId)out.raceId=raceId;
 if(track)out.track=track;
 if(reason)out.reason=reason;
 const meetingAttempts=(Array.isArray(event.meetingAttempts)?event.meetingAttempts:[]).slice(0,3).map(meetingAttempt).filter(Boolean);
 if(meetingAttempts.length)out.meetingAttempts=meetingAttempts;
 return out;
}

export function normalizeNarPrecomputeRunAudit({scheduledAt,result={},autoResultProcessed=0}={}){
 const at=iso(scheduledAt),events=(Array.isArray(result?.events)?result.events:[]).slice(0,MAX_EVENTS).map(compactEvent);
 return {
  scheduledAt:at,
  runDate:runDate(at),
  runStatus:text(result?.status||'UNKNOWN',40),
  reason:text(result?.reason,80),
  attempted:count(result?.attempted),
  saved:count(result?.saved),
  autoResultProcessed:count(autoResultProcessed),
  events
 };
}

function rowToAudit(row){
 let events=[];
 try{const parsed=JSON.parse(row?.events_json||'[]');if(Array.isArray(parsed))events=parsed.slice(0,MAX_EVENTS).map(compactEvent);}catch{}
 return {
  status:'RECORDED',
  scheduledAt:row.scheduled_at,
  runDate:row.run_date,
  runStatus:row.run_status,
  reason:row.reason||null,
  attempted:count(row.attempted),
  saved:count(row.saved),
  autoResultProcessed:count(row.auto_result_processed),
  events
 };
}

export async function writeNarPrecomputeRunAudit(DB,input={}){
 if(!DB?.prepare)throw Error('NAR_RUN_AUDIT_DB_UNAVAILABLE');
 const audit=normalizeNarPrecomputeRunAudit(input),recordedAt=new Date().toISOString();
 const write=await DB.prepare('INSERT OR IGNORE INTO nar_precompute_run_audit (scheduled_at,run_date,run_status,reason,attempted,saved,auto_result_processed,events_json,recorded_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .bind(audit.scheduledAt,audit.runDate,audit.runStatus,audit.reason,audit.attempted,audit.saved,audit.autoResultProcessed,JSON.stringify(audit.events),recordedAt).run();
 if(write?.success!==true)throw Error('NAR_RUN_AUDIT_WRITE_FAILED');
 const row=await DB.prepare('SELECT scheduled_at,run_date,run_status,reason,attempted,saved,auto_result_processed,events_json,recorded_at FROM nar_precompute_run_audit WHERE scheduled_at=? LIMIT 1').bind(audit.scheduledAt).first();
 if(!row)throw Error('NAR_RUN_AUDIT_READBACK_FAILED');
 return rowToAudit(row);
}

export async function readNarPrecomputeRunAudit(DB,{date}={}){
 if(!validDate(date))return {status:'UNAVAILABLE',reason:'INVALID_DATE',scheduledAt:null,runStatus:null,attempted:null,saved:null,events:[]};
 if(!DB?.prepare)return {status:'UNAVAILABLE',reason:'AUDIT_DB_UNAVAILABLE',scheduledAt:null,runStatus:null,attempted:null,saved:null,events:[]};
 try{
  const row=await DB.prepare('SELECT scheduled_at,run_date,run_status,reason,attempted,saved,auto_result_processed,events_json,recorded_at FROM nar_precompute_run_audit WHERE run_date=? ORDER BY scheduled_at DESC LIMIT 1').bind(date).first();
  return row?rowToAudit(row):{status:'NO_RUN_RECORDED',reason:null,scheduledAt:null,runDate:date,runStatus:null,attempted:null,saved:null,autoResultProcessed:null,events:[]};
 }catch{
  return {status:'UNAVAILABLE',reason:'AUDIT_SCHEMA_UNAVAILABLE',scheduledAt:null,runDate:date,runStatus:null,attempted:null,saved:null,autoResultProcessed:null,events:[]};
 }
}

export function publicNarRunAuditFields(audit){
 const value=audit||{status:'UNAVAILABLE',reason:'AUDIT_READ_NOT_ATTEMPTED',events:[]};
 return {
  narRunAudit:value,
  lastNarRunAt:value.scheduledAt??null,
  lastNarStatus:value.runStatus??null,
  lastNarReason:value.reason??null,
  lastNarAttempted:value.attempted??null,
  lastNarSaved:value.saved??null,
  lastNarEvents:Array.isArray(value.events)?value.events:[]
 };
}
