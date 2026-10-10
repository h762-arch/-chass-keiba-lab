import {validDate} from '../jra-meeting-discovery.mjs';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';

export function marketQueueAuditQuery(date){
 if(!validDate(date))throw Error('invalid_queue_audit_date');
 return `SELECT run_id,event_no,race_id,target_date,recorded_at,event_json,event_hash FROM jra_market_queue_events WHERE target_date='${date}' AND run_id=(SELECT run_id FROM jra_market_queue_events WHERE target_date='${date}' GROUP BY run_id ORDER BY MAX(recorded_at) DESC,run_id DESC LIMIT 1) ORDER BY event_no`;
}

export async function summarizeMarketQueueEvents(rows,{date}={}){
 if(!validDate(date)||!Array.isArray(rows))throw Error('invalid_queue_audit');
 if(!rows.length)return {status:'NO_RECORDED_RUN',runId:null,races:[],reasonCounts:{}};
 const events=[],seen=new Set();
 for(const r of rows){
  const e=JSON.parse(r.event_json);
  if(r.run_id!==rows[0].run_id||e?.schemaVersion!==1||e.runId!==r.run_id||e.eventNo!==r.event_no||
   e.raceId!==r.race_id||e.targetDate!==date||r.target_date!==date||e.recordedAt!==r.recorded_at||
   !Number.isSafeInteger(e.eventNo)||e.eventNo<1||seen.has(e.eventNo)||await stableHash(e)!==r.event_hash)throw Error('queue_audit_integrity');
  seen.add(e.eventNo);events.push(e);
 }
 events.sort((a,b)=>a.eventNo-b.eventNo);
 if(events.some((e,i)=>e.eventNo!==i+1))throw Error('queue_audit_sequence');
 const groups=new Map();
 for(const e of events){
  if(!groups.has(e.raceId))groups.set(e.raceId,[]);groups.get(e.raceId).push(e);
 }
 const races=[];
 for(const [raceId,list] of groups){
  if(list[0].phase!=='DISCOVERED'||list.filter(e=>e.phase==='DISCOVERED').length!==1||list.filter(e=>e.phase==='TERMINAL').length>1)throw Error('queue_audit_lifecycle');
  if(list.some(e=>!['DISCOVERED','ATTEMPT_STARTED','TERMINAL'].includes(e.phase)||e.queueRank!==list[0].queueRank||e.selectionTurn!==list[0].selectionTurn)||list.filter(e=>e.phase==='ATTEMPT_STARTED').length>1||list.some((e,i)=>e.phase==='TERMINAL'&&i!==list.length-1))throw Error('queue_audit_lifecycle');
  const final=list.find(e=>e.phase==='TERMINAL'),start=list.find(e=>e.phase==='ATTEMPT_STARTED');
  races.push({raceId,selectionTurn:list[0].selectionTurn,queueRank:list[0].queueRank,
   reason:final?.reason||'UNKNOWN_UNFINISHED',selected:final?.selected??start?.selected??false,
   attemptedAt:final?.attemptedAt||start?.attemptedAt||null,saved:final?.saved??null,
   elapsedMs:final?.elapsedMs??null,runnerElapsedMs:final?.runnerElapsedMs??null});
 }
 const reasonCounts={};for(const r of races)reasonCounts[r.reason]=(reasonCounts[r.reason]||0)+1;
 return {status:races.some(r=>r.reason==='UNKNOWN_UNFINISHED')?'INCOMPLETE':'RECORDED',runId:rows[0].run_id,
  lastRecordedAt:events.at(-1).recordedAt,races,reasonCounts,
  limitation:'Latest recorded run only. No pre-Phase107 reasons can be reconstructed; unresolved attempts have unknown save outcomes.'};
}

export async function readMarketQueueAudit(date,{execute}={}){
 try{return await summarizeMarketQueueEvents(await execute(marketQueueAuditQuery(date)),{date})}
 catch{return {status:'UNAVAILABLE',reason:'QUEUE_AUDIT_READ_OR_VALIDATION_FAILED',runId:null,races:[],reasonCounts:{}}}
}
