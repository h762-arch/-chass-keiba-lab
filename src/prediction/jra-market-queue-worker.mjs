import {createJraPrecomputeMeetingProvider} from './jra-precompute-meeting-provider.mjs';
import {discoverPrecomputeRaceJobs} from './precompute-job-discovery.mjs';
import {jraPrecomputeSchedule,jraPrecomputeWallNow} from './jra-precompute-scheduling-contract.mjs';
import {readLatestPrecomputedSnapshot} from './precomputed-store.mjs';
import {createJraPrecomputedMarketBridge} from './jra-precomputed-market-bridge.mjs';
import {stableHash} from './precomputed-snapshot.mjs';
import {runJraMarketQueue} from './jra-market-queue.mjs';

function setting(v){if(typeof v!=='string'||! /^[1-9]\d*$/.test(v)||!Number.isSafeInteger(Number(v)))throw Error('market_queue_explicit_limits_required');return Number(v);}

export function createMarketQueueRecorder(DB){
 return async event=>{
  const hash=await stableHash(event);
  const r=await DB.prepare('INSERT INTO jra_market_queue_events (run_id,event_no,race_id,target_date,recorded_at,event_json,event_hash) VALUES (?,?,?,?,?,?,?)')
   .bind(event.runId,event.eventNo,event.raceId,event.targetDate,event.recordedAt,JSON.stringify(event),hash).run();
  if(r?.success!==true||r?.meta?.changes!==1)throw Error('market_queue_audit_write_failed');
 };
}

export async function inspectMarketQueueJob(DB,job,now){
 const prior=await DB.prepare('SELECT revision FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND market_json IS NOT NULL ORDER BY revision ASC LIMIT 1').bind('JRA',job.raceId).first();
 if(prior)return {reason:'ALREADY_FROZEN'};
 const base=await readLatestPrecomputedSnapshot(DB,'JRA',job.raceId);
 if(!base?.layers?.DATA)return {reason:'DATA_MISSING'};
 const source=base.layers.SOURCE,r=source?.race;
 if(base.organization!=='JRA'||base.raceId!==job.raceId||source?.organization!=='JRA'||source.raceId!==job.raceId||r?.date!==job.date||r.racecourse!==job.track||r.raceNo!==job.raceNo)return {reason:'DATA_IDENTITY'};
 if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.postTime||''))return {reason:'POST_TIME_UNKNOWN'};
 const post=Date.parse(`${job.date}T${r.postTime}:00+09:00`);
 return {reason:now()>=post?'POST_TIME_REACHED':'READY'};
}

// A completely separate Cron runner: no DATA inspection list, maxJobs,
// calculation runner or shared DATA deadline crosses this boundary.
export function createJraMarketQueueWorkerRunner(env={}, {scheduledTime,wallNow=Date.now}={}){
 if(env.ENABLE_JRA_MARKET_QUEUE!=='true')return undefined;
 return async()=>{
  if(env.ENABLE_JRA_PRECOMPUTED_MARKET_BRIDGE==='true')throw Error('market_queue_requires_legacy_bridge_off');
  if(env.JRA_PRECOMPUTE_SOURCE_MODE!=='official-cache'||!env.DB?.prepare)throw Error('invalid_market_queue_configuration');
  const maxInspections=setting(env.JRA_MARKET_QUEUE_MAX_INSPECTIONS),maxAttempts=setting(env.JRA_MARKET_QUEUE_MAX_ATTEMPTS),windowMs=setting(env.JRA_MARKET_QUEUE_WINDOW_MS);
  const {targetDate,selectionTurn}=jraPrecomputeSchedule(scheduledTime);
  let previous=-Infinity;
  const now=()=>{const t=jraPrecomputeWallNow(wallNow);if(t<previous)throw Error('market_clock_reversed');previous=t;return t;};
  const started=now(),deadline=started+windowMs;
  if(!Number.isSafeInteger(deadline)||!Number.isFinite(new Date(deadline).getTime()))throw Error('invalid_market_queue_deadline');
  // Fail before any MARKET save if audit storage is not provisioned.
  await env.DB.prepare('SELECT run_id,event_no,race_id,target_date,recorded_at,event_json,event_hash FROM jra_market_queue_events LIMIT 0').first();
  const meetings=await createJraPrecomputeMeetingProvider({DB:env.DB,date:targetDate,now})({organization:'JRA'});
  const jobs=discoverPrecomputeRaceJobs(meetings);
  const runner=createJraPrecomputedMarketBridge({DB:env.DB,now,deadline});
  return runJraMarketQueue({enabled:true,jobs,selectionTurn,runId:globalThis.crypto.randomUUID(),
   maxInspections,maxAttempts,deadline,now,inspect:job=>inspectMarketQueueJob(env.DB,job,now),runner,record:createMarketQueueRecorder(env.DB)});
 };
}
