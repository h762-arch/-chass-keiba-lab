import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import worker,{VERSION,buildBackgroundHistoricalRecord,runScheduledTasks} from '../worker.js';

class JobDb {
  row=null;
  prepare(sql){
    const db=this;
    return {args:[],bind(...args){this.args=args;return this},async first(){
      if(sql.includes("SELECT id,status")&&sql.includes("status IN"))return db.row&&['queued','running','paused'].includes(db.row.status)?{id:db.row.id,status:db.row.status}:null;
      if(sql.includes('SELECT * FROM historical_collector_jobs'))return db.row;
      return null;
    },async run(){
      if(sql.startsWith('INSERT INTO historical_collector_jobs')){const a=this.args;db.row={id:a[0],status:a[1],period_days:a[2],start_date:a[3],end_date:a[4],tracks_json:a[5],phase:a[6],current_date:a[7],current_track:a[8],current_race:a[9],state_json:a[10],created_at:a[11],updated_at:a[12],started_at:a[13],completed_at:null,paused_at:null,last_run_at:null,next_run_at:a[14],locked_until:null,last_error:null,background_runs:a[15],last_batch_count:a[16]}}
      if(sql.startsWith('UPDATE historical_collector_jobs SET status=')){const a=this.args;Object.assign(db.row,{status:a[0],phase:a[1],current_date:a[2],current_track:a[3],current_race:a[4],state_json:a[5],updated_at:a[6],started_at:a[7],completed_at:a[8],paused_at:a[9],last_run_at:a[10],next_run_at:a[11],locked_until:a[12],last_error:a[13],background_runs:a[14],last_batch_count:a[15]})}
      return {success:true,meta:{changes:1}};
    }};
  }
  async batch(){return []}
}

function post(path,body={}){return new Request(`https://example.test${path}`,{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify(body)})}

test('version and additive D1 job schema are present',async()=>{
  assert.equal(VERSION,'10.0-dev');
  const migration=await readFile(new URL('../migrations/0002_background_historical_collector.sql',import.meta.url),'utf8');
  assert.match(migration,/historical_collector_jobs/);assert.match(migration,/meeting_calendar/);assert.doesNotMatch(migration,/DROP\s+TABLE/i);
});

test('same-origin API creates one finite job and pause/resume keeps its cursor',async()=>{
  const DB=new JobDb(),env={DB};
  let response=await worker.fetch(post('/api/db/historical-job/start',{startDate:'2026-08-01',endDate:'2026-08-30',tracks:['浦和','船橋']}),env),data=await response.json();
  assert.equal(response.status,201);assert.equal(data.job.status,'running');assert.equal(data.job.periodDays,30);assert.deepEqual(data.job.tracks,['浦和','船橋']);
  DB.row.state_json=JSON.stringify({...JSON.parse(DB.row.state_json),meetingCursor:7});
  response=await worker.fetch(post('/api/db/historical-job/pause'),env);data=await response.json();assert.equal(data.job.status,'paused');assert.equal(data.job.state.meetingCursor,7);
  response=await worker.fetch(post('/api/db/historical-job/resume'),env);data=await response.json();assert.equal(data.job.status,'running');assert.equal(data.job.state.meetingCursor,7);
  response=await worker.fetch(post('/api/db/historical-job/start',{startDate:'2026-08-01',endDate:'2026-08-30',tracks:['浦和']}),env);assert.equal(response.status,409);
});

test('job mutation rejects cross-origin callers',async()=>{
  const response=await worker.fetch(new Request('https://example.test/api/db/historical-job/start',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}),{DB:new JobDb()});
  assert.equal(response.status,403);
});

test('scheduled tasks always run Auto Result first and dynamically throttle history',async()=>{
  const calls=[];
  const result=await runScheduledTasks({}, {resultRunner:async()=>{calls.push('auto');return {processed:1}},historicalRunner:async(_db,options)=>{calls.push('history');return {processed:options.raceLimit}}});
  assert.deepEqual(calls,['auto','history']);assert.equal(result.historical.processed,1);
  calls.length=0;const busy=await runScheduledTasks({}, {resultRunner:async()=>{calls.push('auto');return {processed:3}},historicalRunner:async()=>{calls.push('history');return {}}});
  assert.deepEqual(calls,['auto']);assert.equal(busy.historical.reason,'auto_result_priority');
});

test('background records are isolated backtests and never rewrite realtime snapshots',()=>{
  const record=buildBackgroundHistoricalRecord({date:'2026-08-01',track:'浦和',race:1,horses:[{horseNo:1,horseName:'一号',abilityScore:80},{horseNo:2,horseName:'二号',abilityScore:70}]},{finishOrder:[1,2,3]});
  assert.equal(record.historicalResearch.source,'historical_background');assert.equal(record.predictionSnapshot.predictionKind,'backtest_prediction');assert.equal(record.predictionSnapshot.locked,true);assert.match(record.modelVersion,/background$/);
});

test('collector remains sequential, meeting-aware, locked and UI polls D1 only',async()=>{
  const [source,app,wrangler,similarity]=await Promise.all([
    readFile(new URL('../worker.js',import.meta.url),'utf8'),readFile(new URL('../app.js',import.meta.url),'utf8'),readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'),readFile(new URL('../similarity-intelligence.mjs',import.meta.url),'utf8')
  ]);
  const run=source.slice(source.indexOf('export async function runBackgroundHistoricalCollector'),source.indexOf('function bridgeTimeSeconds'));
  assert.match(run,/readMeetingCalendar/);assert.match(run,/if\(cached\)state\.requestStats\.cacheHits\+\+/);assert.match(run,/SELECT race_id FROM races/);assert.doesNotMatch(run,/Promise\.all/);assert.match(source,/locked_until<\?/);assert.match(source,/HISTORICAL_JOB_LOCK_MS=120_000/);assert.match(source,/HISTORICAL_JOB_DEADLINE_MS=18_000/);
  assert.match(app,/setInterval\([^]*45_000/);assert.match(app,/cloudRequest\('\/api\/db\/historical-job'\)/);assert.match(wrangler,/"\*\/5 \* \* \* \*"/);assert.equal((wrangler.match(/"crons"/g)||[]).length,1);
  assert.match(similarity,/predictionKind==='backtest_prediction'/);
});
