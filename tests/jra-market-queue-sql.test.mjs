import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {snapshotToD1Values,readLatestPrecomputedSnapshot} from '../src/prediction/precomputed-store.mjs';
import {createJraPrecomputedMarketBridge} from '../src/prediction/jra-precomputed-market-bridge.mjs';
import {runJraMarketQueue} from '../src/prediction/jra-market-queue.mjs';
import {createMarketQueueRecorder,inspectMarketQueueJob,createJraMarketQueueWorkerRunner} from '../src/prediction/jra-market-queue-worker.mjs';
import {summarizeMarketQueueEvents,readMarketQueueAudit} from '../scripts/jra-market-queue-audit-reader.mjs';

function local(t){
 const directory=mkdtempSync(join(tmpdir(),'chass-market-queue-')),path=join(directory,'audit.sqlite');t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const python=`import json,sqlite3,sys
x=json.load(sys.stdin)
with sqlite3.connect(x['path']) as db:
 db.row_factory=sqlite3.Row
 if x['script']: db.executescript(x['sql']); print('null')
 else:
  c=db.execute(x['sql'],x['args'])
  print(json.dumps(([dict(r) for r in c.fetchall()] if x['all'] else (dict(r) if (r:=c.fetchone()) is not None else None)) if x['first'] else {'success':True,'meta':{'changes':max(c.rowcount,0)}}))`;
 const query=(sql,args=[],first=false,all=false,script=false)=>{const p=spawnSync('python3',['-c',python],{input:JSON.stringify({path,sql,args,first,all,script}),encoding:'utf8'});if(p.status!==0)throw Error('LOCAL_SQL_FAILED');return JSON.parse(p.stdout)};
 const DB={prepare(sql){return {first:async()=>query(sql,[],true),bind(...args){return {first:async()=>query(sql,args,true),run:async()=>query(sql,args)}}}}};
 for(const file of ['0012_precomputed_snapshots.sql','0013_jra_market_queue_audit.sql'])query(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'),[],false,false,true);
 query('CREATE TABLE jra_official_cache (kind TEXT,cache_key TEXT,payload_json TEXT,source_url TEXT,fetched_at TEXT,expires_at TEXT,parser_version TEXT,content_hash TEXT)');
 return {DB,query};
}
const date='2026-10-10',time=Date.parse('2026-10-10T00:00:00Z');
async function seed(f){
 const jobs=[];
 for(let no=1;no<=4;no++){
  const raceId=`20261010-JRA-東京-${String(no).padStart(2,'0')}`,job={organization:'JRA',date,track:'東京',raceNo:no,raceId};jobs.push(job);
  const s=await createPrecomputedSnapshot({organization:'JRA',raceId,source:{organization:'JRA',raceId,race:{date,racecourse:'東京',raceNo:no,postTime:'10:00'},horses:[{horseNo:1,runningStatus:'active'},{horseNo:2,runningStatus:'active'}]},data:{scores:[80,70]},now:'2026-10-09T23:00:00Z'});
  const cols='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';
  f.query(`INSERT INTO precomputed_race_snapshots (${cols}) VALUES (${Array(21).fill('?').join(',')})`,snapshotToD1Values(s,{revision:1}));
  if(no!==2){
   const body={ok:true,organization:'JRA',date,track:'東京',race:no,source:'JRA_OFFICIAL',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html',parserVersion:'jra-official-win-odds-v1',acquiredAt:'2026-10-09T23:59:00Z',oddsSnapshotType:'live',odds:[{horseNo:1,odds:2,popularity:1},{horseNo:2,odds:3,popularity:2}],quality:{complete:true,oddsCoverage:1,activeHorseCount:2,oddsHorseCount:2}};
   const text=JSON.stringify(body);
   f.query('INSERT INTO jra_official_cache VALUES (?,?,?,?,?,?,?,?)',['odds',`odds|${date}|東京|${no}`,text,body.sourceUrl,body.acquiredAt,'2026-10-10T00:20:00Z',body.parserVersion,createHash('sha256').update(text).digest('hex')]);
  }
 }
 return jobs;
}
test('real SQLite bridge chain records success, missing odds, already frozen, then reopens unchanged',async t=>{
 const f=local(t),jobs=await seed(f),now=()=>time;
 const runner=createJraPrecomputedMarketBridge({DB:f.DB,now,deadline:time+5000});
 assert.equal((await runner(jobs[2])).status,'FROZEN');
 const before=await readLatestPrecomputedSnapshot(f.DB,'JRA',jobs[2].raceId);
 const opts={enabled:true,jobs,selectionTurn:0,runId:'sql-run',maxInspections:4,maxAttempts:4,deadline:time+5000,now,
  inspect:job=>inspectMarketQueueJob(f.DB,job,now),runner,record:createMarketQueueRecorder(f.DB)};
 const result=await runJraMarketQueue(opts);assert.equal(result.savedCount,2);assert.equal(result.attemptedCount,3);
 const rows=f.query('SELECT * FROM jra_market_queue_events ORDER BY event_no',[],true,true);
 const report=await summarizeMarketQueueEvents(rows,{date});assert.equal(report.status,'RECORDED');
 assert.deepEqual(report.reasonCounts,{FROZEN:2,ODDS_UNAVAILABLE:1,ALREADY_FROZEN:1});
 assert.equal((await readLatestPrecomputedSnapshot(f.DB,'JRA',jobs[2].raceId)).snapshotHash,before.snapshotHash);
 const again=await runJraMarketQueue({...opts,runId:'sql-run-2'});assert.equal(again.savedCount,0);assert.equal(again.attemptedCount,1);
 assert.equal(f.query('SELECT COUNT(*) AS n FROM precomputed_race_snapshots WHERE market_json IS NOT NULL',[],true).n,3);
});
test('audit detects tampering in reopened event JSON',async t=>{
 const f=local(t),jobs=await seed(f);
 await runJraMarketQueue({enabled:true,jobs,selectionTurn:0,runId:'tamper',maxInspections:1,maxAttempts:1,deadline:time+1,now:()=>time,inspect:async()=>({reason:'DATA_MISSING'}),runner:async()=>assert.fail(),record:createMarketQueueRecorder(f.DB)});
 f.query("UPDATE jra_market_queue_events SET event_json='{}' WHERE event_no=1");
 await assert.rejects(summarizeMarketQueueEvents(f.query('SELECT * FROM jra_market_queue_events',[],true,true),{date}),/integrity/);
});
test('unresolved STARTED is UNKNOWN_UNFINISHED, not missing odds or saved=false',async t=>{
 const f=local(t),jobs=await seed(f),rec=createMarketQueueRecorder(f.DB);
 await runJraMarketQueue({enabled:true,jobs:jobs.slice(0,1),selectionTurn:0,runId:'partial',maxInspections:1,maxAttempts:1,deadline:time+1,now:()=>time,
  inspect:async()=>({reason:'READY'}),runner:async()=>({status:'FROZEN',saved:true}),record:async e=>{if(e.phase==='TERMINAL')throw Error('interrupted');await rec(e)}});
 const r=await summarizeMarketQueueEvents(f.query('SELECT * FROM jra_market_queue_events',[],true,true),{date});
 assert.equal(r.status,'INCOMPLETE');assert.equal(r.races[0].reason,'UNKNOWN_UNFINISHED');assert.equal(r.races[0].saved,null);
});
test('audit table/query unavailable is explicitly UNAVAILABLE',async()=>{
 assert.equal((await readMarketQueueAudit(date,{execute:async()=>{throw Error('no table')}})).status,'UNAVAILABLE');
});
test('Worker missing audit schema fails before meeting or MARKET I/O',async()=>{
 let reads=0;
 const env={ENABLE_JRA_MARKET_QUEUE:'true',JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',JRA_MARKET_QUEUE_MAX_INSPECTIONS:'4',JRA_MARKET_QUEUE_MAX_ATTEMPTS:'3',JRA_MARKET_QUEUE_WINDOW_MS:'5000',DB:{prepare(sql){reads++;assert.match(sql,/jra_market_queue_events LIMIT 0/);return {first:async()=>{throw Error('no such table')}}}}};
 await assert.rejects(createJraMarketQueueWorkerRunner(env,{scheduledTime:time,wallNow:()=>time})());assert.equal(reads,1);
});
