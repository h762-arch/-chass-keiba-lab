import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {snapshotToD1Values} from '../src/prediction/precomputed-store.mjs';
import {profileCapturedMarketQueue,createCapturedMarketReadDB,marketQueueReadinessQueries,marketQueueSchemaReadiness,readMarketQueueReadiness,marketQueueReadinessSummary} from '../scripts/jra-market-queue-readiness.mjs';
const date='2026-10-10',time=Date.parse('2026-10-10T00:00:00Z');
const fields='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at'.split(',');
async function fixture(count=1){
 const meetings=['東京','京都'].slice(0,count>12?2:1).map((track,i)=>({organization:'JRA',date,track,status:'meeting',raceNumbers:Array.from({length:Math.min(count-i*12,12)},(_,n)=>n+1)}));
 const meetingRows=[{date,status:'complete',meetings_json:JSON.stringify(meetings),next_refresh_at:'2026-10-10T09:00:00Z'}],snapshotRows=[],oddsRows=[];
 for(const m of meetings)for(const no of m.raceNumbers){
  const id=`20261010-JRA-${m.track}-${String(no).padStart(2,'0')}`;
  const s=await createPrecomputedSnapshot({organization:'JRA',raceId:id,source:{organization:'JRA',raceId:id,race:{date,racecourse:m.track,raceNo:no,postTime:'13:00'},horses:[{horseNo:1,runningStatus:'active'},{horseNo:2,runningStatus:'active'}]},data:{scores:[80,70]},now:'2026-10-09T23:00:00Z'});
  snapshotRows.push(Object.fromEntries(fields.map((k,i)=>[k,snapshotToD1Values(s,{revision:1})[i]])));
  const b={ok:true,organization:'JRA',date,track:m.track,race:no,source:'JRA_OFFICIAL',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html',parserVersion:'jra-official-win-odds-v1',acquiredAt:'2026-10-09T23:59:00Z',oddsSnapshotType:'live',odds:[{horseNo:1,odds:2,popularity:1},{horseNo:2,odds:3,popularity:2}],quality:{complete:true,oddsCoverage:1,activeHorseCount:2,oddsHorseCount:2}},payload=JSON.stringify(b);
  oddsRows.push({kind:'odds',cache_key:`odds|${date}|${m.track}|${no}`,payload_json:payload,source_url:b.sourceUrl,fetched_at:b.acquiredAt,expires_at:'2026-10-10T01:00:00Z',parser_version:b.parserVersion,content_hash:createHash('sha256').update(payload).digest('hex')});
 }
 return {date,meetingRows,snapshotRows,oddsRows,now:()=>time};
}
function schema(){
 const script=readFileSync(new URL('../migrations/0013_jra_market_queue_audit.sql',import.meta.url),'utf8');
 const p=spawnSync('python3',['-c',`import sqlite3,json,sys\ndb=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row;db.executescript(sys.stdin.read());print(json.dumps({'rows':[dict(r) for r in db.execute('SELECT name,type,"notnull" AS required,pk FROM pragma_table_info("jra_market_queue_events")')],'objects':[dict(r) for r in db.execute('SELECT name,type,sql FROM sqlite_master WHERE tbl_name="jra_market_queue_events"')]}))`],{input:script,encoding:'utf8'});
 assert.equal(p.status,0);return JSON.parse(p.stdout);
}
test('actual local migration matches readiness columns, keys and indexes',()=>{const s=schema();assert.equal(marketQueueSchemaReadiness(s.rows,s.objects).status,'MATCH')});
test('missing table requires migration without provisioning it',()=>{assert.equal(marketQueueSchemaReadiness([],[]).status,'MISSING')});
test('wrong keys, extra column, missing check/index and trigger block readiness',()=>{
 const s=schema();s.rows[0].pk=0;s.rows.push({name:'extra'});s.objects=s.objects.filter(o=>o.type!=='index');s.objects.find(o=>o.type==='table').sql='CREATE TABLE x(a)';s.objects.push({name:'write',type:'trigger'});
 const r=marketQueueSchemaReadiness(s.rows,s.objects);assert.equal(r.status,'MISMATCH');for(const reason of ['COLUMN_run_id','EXTRA_COLUMNS','EVENT_NUMBER_CHECK','INDEX_idx_jra_market_queue_date','UNREVIEWED_TRIGGER'])assert.ok(r.issues.includes(reason));
});
test('readiness queries are SELECT-only and date injection is rejected',()=>{
 for(const q of Object.values(marketQueueReadinessQueries(date))){assert.match(q,/^SELECT /);assert.ok(!/\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(q))}
 assert.throws(()=>marketQueueReadinessQueries("2026-10-10' OR 1=1"));
});
test('24-race captured validation reaches WOULD_FREEZE without any writes or mutated rows',async()=>{
 const f=await fixture(24),before=JSON.stringify(f),r=await profileCapturedMarketQueue(f);
 assert.equal(r.expectedCount,24);assert.equal(r.reasonCounts.WOULD_FREEZE,24);assert.equal(r.productionSaveCount,0);assert.equal(r.simulatedSaveCount,24);assert.equal(JSON.stringify(f),before);
 assert.equal(r.auditWriteTimingMeasured,false);assert.equal(r.workerD1TimingMeasured,false);assert.equal(r.budgetDecision,'UNDECIDED');assert.ok(r.races.every(x=>x.saved===false));
});
test('missing odds falls through to later eligible races',async()=>{const f=await fixture(3);f.oddsRows.shift();const r=await profileCapturedMarketQueue(f);assert.equal(r.reasonCounts.ODDS_UNAVAILABLE,1);assert.equal(r.reasonCounts.WOULD_FREEZE,2)});
test('corrupt odds hash is VALIDATION_FAILED, never a fabricated Freeze',async()=>{const f=await fixture();f.oddsRows[0].content_hash='0'.repeat(64);assert.equal((await profileCapturedMarketQueue(f)).reasonCounts.VALIDATION_FAILED,1)});
test('DATA missing, already frozen and post time reached avoid bridge evaluation',async()=>{
 const f=await fixture(3);f.snapshotRows[0].data_json=null;f.snapshotRows[1].market_json='{}';const r=await profileCapturedMarketQueue({...f,now:()=>Date.parse('2026-10-10T05:00:00Z')});assert.deepEqual(r.reasonCounts,{DATA_MISSING:1,ALREADY_FROZEN:1,POST_TIME_REACHED:1});assert.ok(r.races.every(x=>!x.bridgeEvaluated));
});
test('duplicate odds rows fail per race and retain zero production saves',async()=>{const f=await fixture();f.oddsRows.push(f.oddsRows[0]);const r=await profileCapturedMarketQueue(f);assert.equal(r.reasonCounts.VALIDATION_FAILED,1);assert.equal(r.productionSaveCount,0)});
test('captured DB rejects SQL changes, writes and caller mutation',async()=>{
 const f=await fixture(),db=createCapturedMarketReadDB(f);assert.throws(()=>db.prepare('INSERT INTO x VALUES(1)'),/SQL_REJECTED/);assert.throws(()=>db.prepare('SELECT * FROM x; DELETE FROM x'),/SQL_REJECTED/);
 const stmt=db.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? ORDER BY revision DESC LIMIT 1').bind('JRA',f.snapshotRows[0].race_id);
 assert.throws(()=>stmt.run(),/WRITE_REJECTED/);f.snapshotRows[0].data_json=null;const a=await stmt.first();assert.ok(a.data_json);a.data_json=null;assert.ok((await stmt.first()).data_json);
});
test('reversed validation clock is rejected',async()=>{const f=await fixture();let n=3;await assert.rejects(profileCapturedMarketQueue({...f,clock:()=>n--}),/profile_clock/)});
test('stale meeting is blocked rather than expanding an unknown cohort',async()=>{const f=await fixture();f.meetingRows[0].next_refresh_at='2026-10-09T00:00:00Z';await assert.rejects(profileCapturedMarketQueue(f),/stale/)});
test('remote readiness uses three SELECTs and keeps missing schema separate from data validation',async()=>{
 const f=await fixture(),calls=[];const r=await readMarketQueueReadiness(date,{...f,execute:async q=>{calls.push(q);return q.includes('jra_official_cache')?f.oddsRows:[]}});
 assert.equal(calls.length,3);assert.equal(r.schema.status,'MISSING');assert.equal(r.reasonCounts.WOULD_FREEZE,1);assert.equal(r.activationReady,false);assert.equal(r.readTimings.length,3);assert.match(marketQueueReadinessSummary(r),/NOT MEASURED/);
});
test('remote schema/read failures stay UNKNOWN/BLOCKED and never expose raw errors',async()=>{
 const f=await fixture();const r=await readMarketQueueReadiness(date,{...f,execute:async()=>{throw Error('private secret')}});assert.equal(r.status,'BLOCKED');assert.equal(r.schema.status,'UNKNOWN');assert.ok(!JSON.stringify(r).includes('secret'));assert.equal(r.productionSaveCount,0);
});
test('existing preflight explicitly enables read-only profiling without changing runtime flags',()=>{
 const text=readFileSync(new URL('../scripts/jra-production-preflight.mjs',import.meta.url),'utf8');assert.match(text,/profileQueue:true/);
 const c=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.equal(c.vars.ENABLE_JRA_MARKET_QUEUE,undefined);assert.equal(c.vars.JRA_PRECOMPUTE_MAX_JOBS,'1');
});
