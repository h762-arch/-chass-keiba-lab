import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {captureNarInitialResearchBundle as capture,readNarInitialResearchBundle as read} from '../src/research/nar-initial-research-bundle.mjs';
import {freezeNarEarlySnapshot} from '../src/research/nar-early-freeze.mjs';
import {createNarInitialSqlStore,NAR_INITIAL_RESEARCH_SCHEMA_SQL} from '../src/research/nar-initial-sql-store.mjs';
import {NAR_EARLY_RESEARCH_SCHEMA_SQL} from '../src/research/nar-early-sql-store.mjs';
const now=Date.parse('2026-10-07T03:00:00Z'),at=new Date(now).toISOString(),raceId='2026-10-07|園田|7',oldKey='nar-early:v1:'+raceId,bundleKey='nar-initial-research:v1:'+raceId;
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
function fp(v){let h=2166136261;const s=canonical(v);for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0')}
function receipt(postTime='13:50'){const race={raceDate:'2026-10-07',track:'園田',raceNo:7,raceType:'NAR',postTime,narSourceAcquiredAt:at},horses=Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,runningStyle:'先行・好位',predictedTime:'1:33.5',predictedTimeConfidence:90,features:{distanceFit:90,courseFit:88,evidence:{sameDistance:2,sameTrack:2}}})),predictionSnapshot={race,createdAt:at,generatedAt:at,horses},marketSnapshot={createdAt:at,acquiredAt:at,horses:horses.map(h=>({horseNo:h.horseNo})),signalSnapshot:{status:'frozen',horses:horses.map(h=>({horseNo:h.horseNo,popularityAtFreeze:h.horseNo,oddsAtFreeze:30,valueMark:h.horseNo===9?'💎💎💎':'',warningMark:''}))}},finalSnapshot={createdAt:at,generatedAt:at,top3:[{horseNo:1}]},record={race,predictionSnapshot,marketSnapshot,finalSnapshot,snapshotIntegrity:{algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:{predictionSnapshot:fp(predictionSnapshot),marketSnapshot:fp(marketSnapshot),finalSnapshot:fp(finalSnapshot)}}};return {record,acquiredAt:at,acquisitionKind:'fresh'}}
const python=`import sys,json,sqlite3
c=sqlite3.connect(sys.argv[1],timeout=5,isolation_level=None)
c.row_factory=sqlite3.Row
for line in sys.stdin:
 try:
  x=json.loads(line)
  if x['op']=='close':
   c.close();print(json.dumps({'value':None}),flush=True);break
  q=c.execute(x['sql'],x.get('args',[]))
  r=q.fetchone() if x['op']=='first' else None
  print(json.dumps({'value':dict(r) if r is not None else None if x['op']=='first' else {'changes':max(q.rowcount,0)}}),flush=True)
 except Exception as e:print(json.dumps({'error':str(e)}),flush=True)
`;
function open(path){const child=spawn('python3',['-u','-c',python,path],{stdio:['pipe','pipe','pipe']}),pending=[],calls=[];let closed=false,error='';child.stderr.on('data',b=>error+=b);const lines=createInterface({input:child.stdout});lines.on('line',line=>{const p=pending.shift();if(!p)return;const x=JSON.parse(line);x.error?p.reject(Error(x.error)):p.resolve(x.value)});child.on('error',e=>pending.splice(0).forEach(p=>p.reject(e)));child.on('exit',code=>pending.splice(0).forEach(p=>p.reject(Error('SQL_CHILD_EXIT:'+code+error))));const ask=(op,sql,args=[])=>new Promise((resolve,reject)=>{calls.push(sql||'close');pending.push({resolve,reject});child.stdin.write(JSON.stringify({op,sql,args})+'\n')});return {calls,exec:sql=>ask('exec',sql),first:(sql,args)=>ask('first',sql,args),run:(sql,args)=>ask('run',sql,args),async close(){if(closed)return;closed=true;await ask('close');child.stdin.end()}}}
async function fixture(t,setup=true){const dir=mkdtempSync(join(tmpdir(),'chass-bundle-sql-')),path=join(dir,'research.sqlite'),connections=[];const connection=()=>{const db=open(path);connections.push(db);return db};t.after(async()=>{for(const db of connections){try{await db.close()}catch{}}rmSync(dir,{recursive:true,force:true})});const db=connection();if(setup){await db.exec(NAR_EARLY_RESEARCH_SCHEMA_SQL);await db.exec(NAR_INITIAL_RESEARCH_SCHEMA_SQL)}return {path,db,connection}}
const store=(db,mode='research-write',clock=()=>now)=>createNarInitialSqlStore({db,mode,clock});const args=db=>({enabled:true,store:store(db),raceId,clock:()=>now,acquire:async()=>receipt()});
test('disk persistence survives SQLite close and new Node process with read-only hash verification',async t=>{const f=await fixture(t),x=await capture(args(f.db));assert.equal(x.status,'CREATED');const raw=(await f.db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key=?',[bundleKey])).snapshot_json;await f.db.close();const code=`import {spawnSync} from 'node:child_process';import {createNarInitialSqlStore} from ${JSON.stringify(new URL('../src/research/nar-initial-sql-store.mjs',import.meta.url).href)};import {readNarInitialResearchBundle} from ${JSON.stringify(new URL('../src/research/nar-initial-research-bundle.mjs',import.meta.url).href)};const db={async first(sql,args){const p=spawnSync('python3',['-c',"import sqlite3,json,sys;c=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;x=json.loads(sys.argv[2]);r=c.execute(x['sql'],x['args']).fetchone();print(json.dumps(dict(r) if r else None))",process.argv[1],JSON.stringify({sql,args})],{encoding:'utf8'});if(p.status!==0)throw Error(p.stderr);return JSON.parse(p.stdout)},exec(){throw Error('write forbidden')},run(){throw Error('write forbidden')}};const x=await readNarInitialResearchBundle({store:createNarInitialSqlStore({db,mode:'read-only'}),raceId:${JSON.stringify(raceId)}});console.log(JSON.stringify({status:x.status,sha:x.snapshot?.contentSha256}));`;const child=spawnSync(process.execPath,['--input-type=module','-e',code,f.path],{encoding:'utf8',timeout:15000});assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{status:'PRESERVED',sha:x.snapshot.contentSha256});const db=f.connection(),after=(await db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key=?',[bundleKey])).snapshot_json;assert.equal(after,raw)});
test('post-race reopened capture preserves first bytes with no acquisition or write',async t=>{const f=await fixture(t),x=await capture(args(f.db));await f.db.close();const db=f.connection(),start=db.calls.length,y=await capture({...args(db),store:store(db,'read-only'),clock:()=>now+12*3600000,acquire(){assert.fail()}});assert.equal(y.status,'PRESERVED');assert.deepEqual(y.snapshot,x.snapshot);assert.ok(db.calls.slice(start).every(s=>s.startsWith('SELECT')))});
test('two independent connections serialize competing captures into one first row',async t=>{const f=await fixture(t),db2=f.connection(),[a,b]=await Promise.all([capture(args(f.db)),capture(args(db2))]);assert.deepEqual([a.status,b.status].sort(),['CREATED','PRESERVED']);assert.equal(a.snapshot.contentSha256,b.snapshot.contentSha256);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,1)});
test('legacy row inserted during acquisition wins without any new bundle row',async t=>{const f=await fixture(t),legacy=await freezeNarEarlySnapshot({raceId,record:receipt().record,now,freshAcquisition:true}),x=await capture({...args(f.db),acquire:async()=>{await f.db.run('INSERT INTO research_nar_early_snapshots VALUES (?,?)',[oldKey,JSON.stringify(legacy.snapshot)]);return receipt()}});assert.equal(x.kind,'LEGACY_EARLY');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,0)});
test('deadline expiry after INSERT rolls back durable row and releases writer lock',async t=>{const f=await fixture(t);let calls=0;const x=await capture({...args(f.db),store:store(f.db,'research-write',()=>++calls===1?now:now+60001)});assert.equal(x.status,'REJECTED');assert.ok(f.db.calls.includes('ROLLBACK'));assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,0);assert.equal((await capture(args(f.db))).status,'CREATED')});
test('backward or post-time adapter clock rejects before a committed write',async t=>{for(const clock of [()=>now-1,()=>Date.parse('2026-10-07T04:50:00Z')]){const f=await fixture(t),x=await capture({...args(f.db),store:store(f.db,'research-write',clock)});assert.equal(x.status,'REJECTED');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,0)}});
test('corrupted saved text rejects after reconnect with SELECT-only and no repair',async t=>{const f=await fixture(t);await capture(args(f.db));const raw=JSON.parse((await f.db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key=?',[bundleKey])).snapshot_json);raw.assessments[0].routes[0].hypothesis='改変';const bad=JSON.stringify(raw);await f.db.run('UPDATE research_nar_initial_bundles SET snapshot_json=? WHERE storage_key=?',[bad,bundleKey]);await f.db.close();const db=f.connection(),start=db.calls.length,x=await capture({...args(db),acquire(){assert.fail()}});assert.equal(x.status,'REJECTED');assert.ok(db.calls.slice(start).every(s=>s.startsWith('SELECT')));assert.equal((await db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key=?',[bundleKey])).snapshot_json,bad)});
test('missing schema rejects before acquisition and never auto-migrates',async t=>{const f=await fixture(t,false),x=await capture({...args(f.db),acquire(){assert.fail()}});assert.equal(x.status,'REJECTED');assert.ok(!f.db.calls.some(s=>/CREATE|INSERT/.test(s)))});
test('OFF and read-only modes cannot perform transaction writes',async t=>{const f=await fixture(t),off=store(f.db,'off'),start=f.db.calls.length;await assert.rejects(off.get(bundleKey));assert.equal((await capture({...args(f.db),store:off,enabled:false})).status,'DISABLED');assert.equal(f.db.calls.length,start);const ro=store(f.db,'read-only');await assert.rejects(ro.insertBundleIfBothAbsent(oldKey,bundleKey,'{}',{}));assert.equal(f.db.calls.length,start)});
test('mismatched keys and widened deadline cannot bypass adapter validation',async t=>{const f=await fixture(t),x=await capture(args(f.db)),s=store(f.db);await assert.rejects(s.insertBundleIfBothAbsent(oldKey+'x',bundleKey,JSON.stringify(x.snapshot),{}));await assert.rejects(s.insertBundleIfBothAbsent(oldKey,bundleKey,JSON.stringify(x.snapshot),{acquiredAt:now,notBefore:now,notAfter:now+86400000,maxAgeMs:60000}));assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,1)});

// Characterization tests below intentionally expose the unresolved deadline gap.
// Passing them is NOT proof of strict commit-completion enforcement.
function commitProbe(db,hook){
 const commits=[];
 return {commits,db:{first:(...a)=>db.first(...a),run:(...a)=>db.run(...a),async exec(sql){
  if(sql!=='COMMIT')return db.exec(sql);
  const entry={acknowledged:false};commits.push(entry);
  return hook(async()=>{const value=await db.exec(sql);entry.acknowledged=true;return value},entry);
 }}};
}
async function storedText(db){return (await db.first('SELECT snapshot_json FROM research_nar_initial_bundles WHERE storage_key=?',[bundleKey]))?.snapshot_json}
async function assertReopenedPreserves(t,f,raw,expectedHash){
 await f.db.close();const db=f.connection(),start=db.calls.length;
 const x=await capture({...args(db),store:store(db,'read-only'),clock:()=>now+12*3600000,acquire(){assert.fail('reopened record must not reacquire')}});
 assert.equal(x.status,'PRESERVED');assert.equal(x.snapshot.contentSha256,expectedHash);
 assert.equal(await storedText(db),raw);
 assert.ok(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
 assert.ok(!db.calls.slice(start).some(sql=>/UPDATE|DELETE|INSERT/.test(sql)));
 return x;
}
test('deadline audit: delaying COMMIT execution past freshness still creates a durable row',async t=>{
 const f=await fixture(t);let tick=now;
 const probe=commitProbe(f.db,async commit=>{tick=now+60001;return commit()});
 const x=await capture({...args(probe.db),store:store(probe.db,'research-write',()=>tick),clock:()=>tick});
 assert.equal(x.status,'CREATED');assert.equal(probe.commits[0].acknowledged,true);
 assert.equal(tick-Date.parse(x.snapshot.acquiredAt),60001);
 const raw=await storedText(f.db);assert.ok(raw);
 assert.ok(!f.db.calls.includes('ROLLBACK'));
 await assertReopenedPreserves(t,f,raw,x.snapshot.contentSha256);
});
test('deadline audit: COMMIT executed at exact post time bypasses pre-COMMIT-only gate',async t=>{
 const f=await fixture(t);let tick=now;
 const post=now+60000,probe=commitProbe(f.db,async commit=>{tick=post;return commit()});
 const x=await capture({...args(probe.db),store:store(probe.db,'research-write',()=>tick),clock:()=>tick,acquire:async()=>receipt('12:01')});
 assert.equal(x.status,'CREATED');assert.equal(probe.commits[0].acknowledged,true);
 assert.equal(Date.parse(x.snapshot.sourceEarlySnapshot.data.race.raceDate+'T'+x.snapshot.sourceEarlySnapshot.data.race.postTime+':00+09:00'),post);
 assert.equal(tick-Date.parse(x.snapshot.acquiredAt),60000);
 const raw=await storedText(f.db);await assertReopenedPreserves(t,f,raw,x.snapshot.contentSha256);
});
test('deadline audit: late acknowledgement alone cannot establish actual durable commit time',async t=>{
 const f=await fixture(t);let tick=now;const observations=[];
 const probe=commitProbe(f.db,async commit=>{await commit();observations.push({phase:'sqlite_return',at:tick});tick=now+60001;observations.push({phase:'driver_return',at:tick})});
 const x=await capture({...args(probe.db),store:store(probe.db,'research-write',()=>tick),clock:()=>tick});
 assert.equal(x.status,'CREATED');assert.deepEqual(observations,[{phase:'sqlite_return',at:now},{phase:'driver_return',at:now+60001}]);
 assert.ok(await storedText(f.db));
 // These are injected application-clock observations, not database timestamp evidence.
 assert.equal(x.snapshot.sealedAt,at);
});
test('deadline audit: lost acknowledgement leaves committed data despite capture rejection',async t=>{
 const f=await fixture(t),probe=commitProbe(f.db,async commit=>{await commit();throw Error('SIMULATED_LOST_COMMIT_ACK')});
 const x=await capture(args(probe.db));assert.equal(x.status,'REJECTED');assert.equal(x.reason,'CAPTURE_FAILED');
 assert.equal(probe.commits[0].acknowledged,true);assert.ok(f.db.calls.includes('ROLLBACK'));
 const raw=await storedText(f.db);assert.ok(raw);
 const hash=JSON.parse(raw).contentSha256;
 await assertReopenedPreserves(t,f,raw,hash);
});
test('deadline audit: failure before SQLite COMMIT rolls back and permits a later fresh capture',async t=>{
 const f=await fixture(t),probe=commitProbe(f.db,async()=>{throw Error('SIMULATED_BEFORE_COMMIT_FAILURE')});
 const x=await capture(args(probe.db));assert.equal(x.status,'REJECTED');assert.equal(probe.commits[0].acknowledged,false);
 assert.ok(f.db.calls.includes('ROLLBACK'));assert.equal(await storedText(f.db),undefined);
 const next=await capture(args(f.db));assert.equal(next.status,'CREATED');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_initial_bundles')).n,1);
});
test('deadline audit: invalid or reversed clock introduced during COMMIT is not checked on return',async t=>{
 for(const after of [NaN,now-1]){
  const f=await fixture(t);let tick=now;
  const probe=commitProbe(f.db,async commit=>{await commit();tick=after});
  const x=await capture({...args(probe.db),store:store(probe.db,'research-write',()=>tick),clock:()=>tick});
  assert.equal(x.status,'CREATED');assert.equal(probe.commits[0].acknowledged,true);assert.ok(await storedText(f.db));
 }
});
