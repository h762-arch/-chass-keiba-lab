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
import {runNarAppInitialShadowResearch as appSession,createNarShadowAppAcquire,NAR_SHADOW_WORKER_ORIGIN} from '../src/research/nar-shadow-app-source.mjs';
import {runNarInitialShadowSession as session} from '../src/research/nar-initial-shadow-session.mjs';
import {observeNarSqlCommitResearch,saveNarCommitObservationResearch as saveObservation,readNarInitialAdmissionResearch as admission,verifyNarCommitObservationResearch} from '../src/research/nar-commit-admission.mjs';
import {NAR_EARLY_RESEARCH_SCHEMA_SQL} from '../src/research/nar-early-sql-store.mjs';
import {inspectNarInitialReadinessResearch as readiness} from '../src/research/nar-initial-readiness-research.mjs';
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

// Separate append-only audit namespace in the local research fixture only.
async function journal(db){await db.exec('CREATE TABLE IF NOT EXISTS research_nar_commit_observations (storage_key TEXT PRIMARY KEY NOT NULL,snapshot_json TEXT NOT NULL)');return journalReader(db)}
function journalReader(db){return {async get(key){return (await db.first('SELECT snapshot_json FROM research_nar_commit_observations WHERE storage_key=?',[key]))?.snapshot_json??null},async insertIfAbsent(key,json){return (await db.run('INSERT OR IGNORE INTO research_nar_commit_observations VALUES (?,?)',[key,json])).changes===1}}}
async function rehashReceipt(receipt){const {contentSha256,...body}=receipt,h=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(body)));return {...body,contentSha256:[...new Uint8Array(h)].map(n=>n.toString(16).padStart(2,'0')).join('')}}
const observed={outcome:'RESOLVED',startedAt:now,returnedAt:now};
async function gate(db,j){return admission({store:store(db,'read-only'),receiptStore:j,raceId})}

test('admission: observed in-window receipt persists across reconnect but never certifies formal EARLY',async t=>{
 const f=await fixture(t),j=await journal(f.db),observer=observeNarSqlCommitResearch({db:f.db,clock:()=>now});
 const x=await capture(args(observer.db)),raw=await storedText(f.db);assert.equal(x.status,'CREATED');
 const events=observer.observations();assert.deepEqual(events,[observed]);assert.ok(Object.isFrozen(events[0]));
 const saved=await saveObservation({enabled:true,snapshot:x.snapshot,observation:events[0],receiptStore:j});assert.equal(saved.status,'CREATED');
 await f.db.close();const db=f.connection(),start=db.calls.length,y=await gate(db,journalReader(db));
 assert.equal(y.status,'HOLD');assert.equal(y.timing,'OBSERVED_WITHIN_WINDOW');assert.equal(y.reason,'DURABLE_TIME_AND_FORMAL_POLICY_UNVERIFIED');
 assert.equal(y.formalKpiEligible,false);assert.equal(y.adopted,false);assert.equal(y.receipt.trustedDurableTime,false);assert.equal(await storedText(db),raw);
 assert.ok(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('admission: late real COMMIT row is retained with late HOLD after journal reconnect',async t=>{
 const f=await fixture(t),j=await journal(f.db);let tick=now;
 const probe=commitProbe(f.db,async commit=>{tick=now+60001;return commit()}),observer=observeNarSqlCommitResearch({db:probe.db,clock:()=>tick});
 const x=await capture({...args(observer.db),store:store(observer.db,'research-write',()=>tick),clock:()=>tick});assert.equal(x.status,'CREATED');
 const raw=await storedText(f.db);assert.equal((await saveObservation({enabled:true,snapshot:x.snapshot,observation:observer.observations()[0],receiptStore:j})).timing,'OBSERVED_OUTSIDE_WINDOW');
 await f.db.close();const db=f.connection(),y=await gate(db,journalReader(db));assert.equal(y.reason,'COMMIT_OBSERVED_LATE');assert.equal(y.status,'HOLD');assert.equal(await storedText(db),raw);
});
test('admission: exact post time is late even when observed freshness is exactly sixty seconds',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture({...args(f.db),acquire:async()=>receipt('12:01')});
 const a=await saveObservation({enabled:true,snapshot:x.snapshot,observation:{...observed,returnedAt:now+60000},receiptStore:j});assert.equal(a.timing,'OBSERVED_OUTSIDE_WINDOW');assert.equal((await gate(f.db,j)).reason,'COMMIT_OBSERVED_LATE');
});
test('admission: missing or unreadable journal stays HOLD without source writes or new acquisition',async t=>{
 const f=await fixture(t),j=await journal(f.db);await capture(args(f.db));const raw=await storedText(f.db),start=f.db.calls.length;
 const x=await gate(f.db,j);assert.equal(x.reason,'COMMIT_EVIDENCE_MISSING');assert.equal(x.status,'HOLD');
 assert.equal((await gate(f.db,{get(){throw Error('unavailable')}})).reason,'COMMIT_EVIDENCE_UNAVAILABLE');
 assert.equal((await gate(f.db,null)).reason,'COMMIT_EVIDENCE_UNAVAILABLE');assert.equal(await storedText(f.db),raw);assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('admission: lost acknowledgement is persisted as unknown and stays HOLD across restart',async t=>{
 const f=await fixture(t),j=await journal(f.db),probe=commitProbe(f.db,async commit=>{await commit();throw Error('lost ack')}),observer=observeNarSqlCommitResearch({db:probe.db,clock:()=>now});
 assert.equal((await capture(args(observer.db))).status,'REJECTED');const x=await read({store:store(f.db,'read-only'),raceId});assert.equal(x.status,'PRESERVED');
 const raw=await storedText(f.db);assert.equal(observer.observations()[0].outcome,'REJECTED');
 assert.equal((await saveObservation({enabled:true,snapshot:x.snapshot,observation:observer.observations()[0],receiptStore:j})).timing,'UNKNOWN');
 await f.db.close();const db=f.connection(),y=await gate(db,journalReader(db));assert.equal(y.reason,'COMMIT_TIMING_UNCONFIRMED');assert.equal(await storedText(db),raw);
});
test('admission: journal write failure cannot delete or repair first content',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db)),raw=await storedText(f.db);
 const saved=await saveObservation({enabled:true,snapshot:x.snapshot,observation:observed,receiptStore:{...j,insertIfAbsent(){throw Error('audit write failed')}}});assert.equal(saved.status,'REJECTED');
 assert.equal((await gate(f.db,j)).reason,'COMMIT_EVIDENCE_MISSING');assert.equal(await storedText(f.db),raw);
});
test('admission: first unknown receipt is immutable; later favourable claim cannot replace it',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db));
 const a=await saveObservation({enabled:true,snapshot:x.snapshot,observation:{outcome:'UNOBSERVED',startedAt:null,returnedAt:null},receiptStore:j});
 const b=await saveObservation({enabled:true,snapshot:x.snapshot,observation:observed,receiptStore:j});assert.equal(a.status,'CREATED');assert.equal(b.status,'PRESERVED');assert.equal(b.timing,'UNKNOWN');assert.deepEqual(b.receipt,a.receipt);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,1);
});
test('admission: changed evidence, rehashed trust claims and foreign bundle hash are rejected without repair',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db)),a=await saveObservation({enabled:true,snapshot:x.snapshot,observation:observed,receiptStore:j});
 for(const change of [r=>{r.observation.returnedAt++},r=>{r.trustedDurableTime=true},r=>{r.sourceBundleSha256='0'.repeat(64)}]){
  const bad=structuredClone(a.receipt);change(bad);const input=bad.trustedDurableTime||bad.sourceBundleSha256!==a.receipt.sourceBundleSha256?await rehashReceipt(bad):bad;
  assert.equal((await verifyNarCommitObservationResearch({snapshot:x.snapshot,receipt:input})).status,'REJECTED');
 }
 const bad=JSON.stringify({...a.receipt,trustedDurableTime:true});await f.db.run('UPDATE research_nar_commit_observations SET snapshot_json=?',[bad]);const start=f.db.calls.length;
 assert.equal((await gate(f.db,j)).status,'REJECTED');assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));assert.equal((await f.db.first('SELECT snapshot_json FROM research_nar_commit_observations')).snapshot_json,bad);
});
test('admission: invalid source and disabled saving never touch journal storage',async t=>{
 const forbidden={get(){assert.fail()},insertIfAbsent(){assert.fail()}};
 assert.equal((await saveObservation({receiptStore:forbidden})).status,'DISABLED');
 assert.equal((await saveObservation({enabled:true,snapshot:{},observation:observed,receiptStore:forbidden})).status,'REJECTED');
 const f=await fixture(t);assert.equal((await gate(f.db,forbidden)).status,'MISSING');
});
test('admission: null, reversed and pre-seal observations cannot be certified from saved seal time',async t=>{
 for(const observation of [{...observed,returnedAt:null},{...observed,returnedAt:now-1},{...observed,startedAt:now-1}]){
  const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db)),a=await saveObservation({enabled:true,snapshot:x.snapshot,observation,receiptStore:j});assert.equal(a.timing,'UNKNOWN');assert.equal((await gate(f.db,j)).reason,'COMMIT_TIMING_UNCONFIRMED');
 }
});
test('admission: observer records rejected commit without leaking driver errors and invalid clock as null',async t=>{
 const f=await fixture(t),probe=commitProbe(f.db,async()=>{throw Error('private driver detail')}),observer=observeNarSqlCommitResearch({db:probe.db,clock(){throw Error('clock unavailable')}});
 assert.equal((await capture(args(observer.db))).status,'REJECTED');assert.deepEqual(observer.observations(),[{outcome:'REJECTED',startedAt:null,returnedAt:null}]);assert.equal(await storedText(f.db),undefined);
});

test('admission: sixty-second freshness is inclusive before post time but remains research HOLD',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db)),a=await saveObservation({enabled:true,snapshot:x.snapshot,observation:{...observed,returnedAt:now+60000},receiptStore:j});
 assert.equal(a.timing,'OBSERVED_WITHIN_WINDOW');assert.equal((await gate(f.db,j)).status,'HOLD');assert.equal((await gate(f.db,j)).formalKpiEligible,false);
});
test('admission: legacy EARLY is preserved with unconfirmed timing and no receipt namespace access',async t=>{
 const f=await fixture(t),legacy=await freezeNarEarlySnapshot({raceId,record:receipt().record,now,freshAcquisition:true}),raw=JSON.stringify(legacy.snapshot);
 await f.db.run('INSERT INTO research_nar_early_snapshots VALUES (?,?)',[oldKey,raw]);const start=f.db.calls.length;
 const x=await gate(f.db,{get(){assert.fail('legacy timing must not be invented')}});assert.equal(x.status,'HOLD');assert.equal(x.reason,'LEGACY_TIMING_UNCONFIRMED');assert.deepEqual(x.snapshot,legacy.snapshot);
 assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));assert.equal((await f.db.first('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key=?',[oldKey])).snapshot_json,raw);
});
test('admission: concurrent independent journal connections preserve one first observation',async t=>{
 const f=await fixture(t),j=await journal(f.db),db2=f.connection(),j2=journalReader(db2),x=await capture(args(f.db)),raw=await storedText(f.db);
 const [a,b]=await Promise.all([saveObservation({enabled:true,snapshot:x.snapshot,observation:observed,receiptStore:j}),saveObservation({enabled:true,snapshot:x.snapshot,observation:{outcome:'UNOBSERVED',startedAt:null,returnedAt:null},receiptStore:j2})]);
 assert.deepEqual([a.status,b.status].sort(),['CREATED','PRESERVED']);assert.equal(a.receipt.contentSha256,b.receipt.contentSha256);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,1);assert.equal(await storedText(f.db),raw);
 await f.db.run('UPDATE research_nar_commit_observations SET snapshot_json=?',['invalid json']);const start=f.db.calls.length;assert.equal((await gate(f.db,j)).reason,'OBSERVATION_UNREADABLE');assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});

const sessionArgs=(db,j)=>({enabled:true,db,receiptStore:j,raceId,clock:()=>now,acquire:async()=>receipt()});
test('session: disabled and invalid contracts perform no SQL or acquisition',async()=>{
 const forbidden={exec(){assert.fail()},first(){assert.fail()},run(){assert.fail()}};
 assert.equal((await session({db:forbidden,acquire(){assert.fail()}})).status,'DISABLED');
 assert.equal((await session({enabled:true,db:{},acquire(){assert.fail()}})).status,'REJECTED');
});
test('session: one fresh capture binds commit evidence and restart becomes SELECT-only HOLD',async t=>{
 const f=await fixture(t),j=await journal(f.db);let acquisitions=0;
 const x=await session({...sessionArgs(f.db,j),acquire:async()=>{acquisitions++;return receipt()}});
 assert.equal(x.status,'HOLD');assert.equal(x.captureStatus,'CREATED');assert.equal(x.auditStatus,'CREATED');assert.equal(x.commitObservationCount,1);
 assert.equal(x.admission.timing,'OBSERVED_WITHIN_WINDOW');assert.equal(x.formalKpiEligible,false);assert.equal(x.adopted,false);assert.equal(acquisitions,1);
 const raw=await storedText(f.db),evidence=(await f.db.first('SELECT snapshot_json FROM research_nar_commit_observations')).snapshot_json;
 await f.db.close();const db=f.connection(),start=db.calls.length,y=await session({...sessionArgs(db,journalReader(db)),clock:()=>now+12*3600000,acquire(){assert.fail()}});
 assert.equal(y.status,'HOLD');assert.equal(y.captureStatus,'NOT_RUN');assert.equal(y.auditStatus,'NOT_RUN');assert.equal(await storedText(db),raw);assert.equal((await db.first('SELECT snapshot_json FROM research_nar_commit_observations')).snapshot_json,evidence);assert.ok(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('session: late COMMIT is automatically journaled and retained as late HOLD',async t=>{
 const f=await fixture(t),j=await journal(f.db);let tick=now;
 const probe=commitProbe(f.db,async commit=>{tick=now+60001;return commit()});
 const x=await session({...sessionArgs(probe.db,j),clock:()=>tick});assert.equal(x.captureStatus,'CREATED');assert.equal(x.auditStatus,'CREATED');assert.equal(x.reason,'COMMIT_OBSERVED_LATE');assert.equal(x.status,'HOLD');assert.ok(await storedText(f.db));
});
test('session: lost acknowledgement keeps committed content and records unknown evidence',async t=>{
 const f=await fixture(t),j=await journal(f.db),probe=commitProbe(f.db,async commit=>{await commit();throw Error('lost ack')});
 const x=await session(sessionArgs(probe.db,j));assert.equal(x.captureStatus,'REJECTED');assert.equal(x.auditStatus,'CREATED');assert.equal(x.status,'HOLD');assert.equal(x.reason,'COMMIT_TIMING_UNCONFIRMED');assert.equal(x.admission.receipt.observation.outcome,'REJECTED');assert.ok(await storedText(f.db));
});
test('session: pre-COMMIT failure rolls back and cannot manufacture an audit receipt',async t=>{
 const f=await fixture(t),j=await journal(f.db),probe=commitProbe(f.db,async()=>{throw Error('before commit')});
 const x=await session(sessionArgs(probe.db,j));assert.equal(x.status,'REJECTED');assert.equal(x.captureStatus,'REJECTED');assert.equal(x.auditStatus,'SOURCE_UNCONFIRMED');assert.equal(await storedText(f.db),undefined);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});
test('session: failed journal write preserves data and later session does not invent evidence',async t=>{
 const f=await fixture(t),j=await journal(f.db),broken={...j,insertIfAbsent(){throw Error('journal unavailable')}};
 const x=await session(sessionArgs(f.db,broken));assert.equal(x.status,'HOLD');assert.equal(x.auditStatus,'REJECTED');assert.equal(x.reason,'COMMIT_EVIDENCE_MISSING');const raw=await storedText(f.db),start=f.db.calls.length;
 const y=await session({...sessionArgs(f.db,j),acquire(){assert.fail()}});assert.equal(y.status,'HOLD');assert.equal(y.auditStatus,'NOT_RUN');assert.equal(await storedText(f.db),raw);assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('session: winner from another connection is never assigned the losing capture event',async t=>{
 const f=await fixture(t),j=await journal(f.db),other=f.connection();let winner;
 const x=await session({...sessionArgs(f.db,j),acquire:async()=>{winner=await capture(args(other));return receipt()}});
 assert.equal(winner.status,'CREATED');assert.equal(x.captureStatus,'PRESERVED');assert.equal(x.commitObservationCount,0);assert.equal(x.auditStatus,'NOT_RUN');assert.equal(x.reason,'COMMIT_EVIDENCE_MISSING');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});
test('session: same dedicated connection serializes callers into one acquisition and one receipt',async t=>{
 const f=await fixture(t),j=await journal(f.db);let acquisitions=0;const inputs={...sessionArgs(f.db,j),acquire:async()=>{acquisitions++;return receipt()}};
 const [a,b]=await Promise.all([session(inputs),session(inputs)]);assert.equal(acquisitions,1);assert.deepEqual([a.captureStatus,b.captureStatus],['CREATED','NOT_RUN']);assert.equal(a.status,'HOLD');assert.equal(b.status,'HOLD');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,1);
});
test('session: post-COMMIT source corruption rejects without attaching or repairing receipt',async t=>{
 const f=await fixture(t),j=await journal(f.db),probe=commitProbe(f.db,async commit=>{await commit();await f.db.run('UPDATE research_nar_initial_bundles SET snapshot_json=?',['corrupted']);});
 const x=await session(sessionArgs(probe.db,j));assert.equal(x.status,'REJECTED');assert.equal(x.auditStatus,'SOURCE_UNCONFIRMED');assert.equal(await storedText(f.db),'corrupted');assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});
test('session: legacy first EARLY stays HOLD without acquisition or new audit namespace access',async t=>{
 const f=await fixture(t),legacy=await freezeNarEarlySnapshot({raceId,record:receipt().record,now,freshAcquisition:true});await f.db.run('INSERT INTO research_nar_early_snapshots VALUES (?,?)',[oldKey,JSON.stringify(legacy.snapshot)]);const start=f.db.calls.length;
 const x=await session({...sessionArgs(f.db,{get(){assert.fail()},insertIfAbsent(){assert.fail()}}),acquire(){assert.fail()}});assert.equal(x.status,'HOLD');assert.equal(x.reason,'LEGACY_TIMING_UNCONFIRMED');assert.equal(x.captureStatus,'NOT_RUN');assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});

test('session: another valid bundle cannot receive the original insert observation',async t=>{
 const f=await fixture(t),j=await journal(f.db),replacement=await fixture(t);
 const other=await capture({...args(replacement.db),acquire:async()=>{const r=receipt();r.record.predictionSnapshot.horses[0].predictedTime='1:34.0';r.record.snapshotIntegrity.hashes.predictionSnapshot=fp(r.record.predictionSnapshot);return r}});assert.equal(other.status,'CREATED');
 const different=await storedText(replacement.db),probe=commitProbe(f.db,async commit=>{await commit();await f.db.run('UPDATE research_nar_initial_bundles SET snapshot_json=?',[different])});
 const x=await session(sessionArgs(probe.db,j));assert.equal(x.captureStatus,'REJECTED');assert.equal(x.auditStatus,'TARGET_MISMATCH');assert.equal(x.status,'HOLD');assert.equal(x.reason,'COMMIT_EVIDENCE_MISSING');assert.equal(await storedText(f.db),different);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});

function appPayload(){return {ok:true,raceSuccess:true,organization:'NAR',source:'NAR公式',code:'27',date:'2026-10-07',track:'園田',race:7,postTime:'13:50',distance:1400,surface:'ダート',trackCondition:'良',acquiredAt:at,oddsSnapshotType:'pre',horses:Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:`試験馬${i+1}`,popularity:i+1,odds:5+i*3,abilityWinRate:20-i,abilityScore:80-i,dataConfidence:80,predictedTime:'1:33.5',predictedTimeType:'実績',predictedTimeConfidence:90,runningStyle:'先行・好位',features:{distanceFit:90,courseFit:88,evidence:{sameDistance:2,sameTrack:2}}})),odds:Array.from({length:9},(_,i)=>({horseNo:i+1,odds:5+i*3,popularity:i+1}))}}
const appResponse=data=>({ok:true,status:200,json:async()=>data});
test('app session: actual app computation feeds real SQLite source, audit and HOLD with one mocked Worker request',async t=>{
 const f=await fixture(t),j=await journal(f.db),payload=appPayload(),before=structuredClone(payload),requests=[];
 const x=await appSession({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,fetchImpl:(url,options)=>{requests.push({url,options});return appResponse(payload)}});
 assert.equal(x.captureStatus,'CREATED');assert.equal(x.auditStatus,'CREATED');assert.equal(x.status,'HOLD');assert.equal(x.formalKpiEligible,false);assert.equal(x.admission.snapshot.sourceEarlySnapshot.data.predictionSnapshot.horses.length,9);assert.equal(x.admission.snapshot.assessments.length,4);
 assert.equal(requests.length,1);assert.equal(requests[0].url,NAR_SHADOW_WORKER_ORIGIN+'/api/nar/race?code=27&date=2026-10-07&race=7');assert.equal(requests[0].options.cache,'no-store');assert.deepEqual(payload,before);
});
test('app source: server acquisition and delayed local receipt remain separate without time repair',async()=>{
 let tick=now;const source=await createNarShadowAppAcquire({clock:()=>tick,fetchImpl:()=>{tick=now+1250;return appResponse(appPayload())}}),r=await source({raceId});
 assert.equal(r.acquiredAt,at);assert.equal(r.record.race.narSourceAcquiredAt,at);assert.equal(r.receivedAt,new Date(now+1250).toISOString());assert.notEqual(r.acquiredAt,r.receivedAt);
});
test('app session: delayed response can save source time intact and journal local COMMIT observation',async t=>{
 const f=await fixture(t),j=await journal(f.db);let tick=now;
 const x=await appSession({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>tick,fetchImpl:()=>{tick=now+1250;return appResponse(appPayload())}});
 assert.equal(x.captureStatus,'CREATED');assert.equal(x.status,'HOLD');assert.equal(x.admission.snapshot.acquiredAt,at);assert.equal(x.admission.receipt.observation.returnedAt,now+1250);
});
test('app session: OFF and reopened first data bypass app fetch entirely',async t=>{
 const f=await fixture(t),j=await journal(f.db);let calls=0;const options={enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,fetchImpl:()=>{calls++;return appResponse(appPayload())}};
 assert.equal((await appSession({...options,enabled:false})).status,'DISABLED');assert.equal(calls,0);await appSession(options);const raw=await storedText(f.db);await f.db.close();const db=f.connection(),start=db.calls.length;
 const x=await appSession({...options,db,receiptStore:journalReader(db),clock:()=>now+12*3600000,fetchImpl(){assert.fail()}});assert.equal(x.captureStatus,'NOT_RUN');assert.equal(x.status,'HOLD');assert.equal(calls,1);assert.equal(await storedText(db),raw);assert.ok(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('app session: HTTP failure makes one request, no diagnostic/result fallback and no stored rows',async t=>{
 const f=await fixture(t),j=await journal(f.db);let calls=0;const x=await appSession({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,fetchImpl:()=>{calls++;return {ok:false,status:503,json:async()=>({errorCode:'nar_temporary',error:'fixture'})}}});assert.equal(x.status,'REJECTED');assert.equal(calls,1);assert.equal(await storedText(f.db),undefined);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});
test('app session: prior-to-request source time and incomplete market are rejected without retimestamping',async t=>{
 for(const change of [p=>{p.acquiredAt=new Date(now-1).toISOString()},p=>{p.odds=[];p.horses.forEach(h=>{h.odds=null;h.popularity=null})}]){
  const f=await fixture(t),j=await journal(f.db),payload=appPayload();change(payload);const before=structuredClone(payload);
  const x=await appSession({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,fetchImpl:()=>appResponse(payload)});assert.equal(x.status,'REJECTED');assert.equal(await storedText(f.db),undefined);assert.deepEqual(payload,before);
 }
});

test('market rejection: provisional app Signal reports explicit reason with no bundle, audit or COMMIT',async t=>{
 const f=await fixture(t),j=await journal(f.db),payload=appPayload();payload.odds=[];payload.horses.forEach(h=>{h.odds=null;h.popularity=null});const start=f.db.calls.length;
 const x=await appSession({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,fetchImpl:()=>appResponse(payload)});
 assert.equal(x.status,'REJECTED');assert.equal(x.reason,'MARKET_ELIGIBILITY_INVALID');assert.equal(x.captureStatus,'REJECTED');assert.equal(x.auditStatus,'NOT_RUN');assert.equal(x.commitObservationCount,0);assert.equal(await storedText(f.db),undefined);assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);assert.ok(!f.db.calls.slice(start).includes('COMMIT'));
});
test('market rejection: incomplete, duplicate, zero-odds or invalid rank remains rejected before storage',async t=>{
 for(const mutate of [r=>r.record.marketSnapshot.signalSnapshot.horses.pop(),r=>r.record.marketSnapshot.signalSnapshot.horses[1].horseNo=1,r=>r.record.marketSnapshot.signalSnapshot.horses[0].oddsAtFreeze=0,r=>r.record.marketSnapshot.signalSnapshot.horses[0].popularityAtFreeze=0]){
  const f=await fixture(t),r=receipt();mutate(r);const x=await capture({...args(f.db),acquire:async()=>r});assert.equal(x.status,'REJECTED');assert.equal(x.reason,'MARKET_ELIGIBILITY_INVALID');assert.equal(await storedText(f.db),undefined);assert.ok(!f.db.calls.includes('COMMIT'));
 }
});
test('market rejection: external errors cannot impersonate internal market reason or expose private details',async t=>{
 const f=await fixture(t);
 for(const message of ['MARKET_ELIGIBILITY_INVALID','private transport detail']){
  const x=await capture({...args(f.db),acquire(){throw Error(message)}});assert.equal(x.reason,'CAPTURE_FAILED');assert.equal(x.status,'REJECTED');assert.ok(!JSON.stringify(x).includes('private transport detail'));
 }
 assert.equal(await storedText(f.db),undefined);
});

test('readiness: verified in-window local evidence lists unresolved policies without promoting or changing bytes',async t=>{
 const f=await fixture(t),j=await journal(f.db);
 await session({enabled:true,db:f.db,receiptStore:j,raceId,clock:()=>now,acquire:async()=>receipt()});
 const before=await storedText(f.db),start=f.db.calls.length;
 const x=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(x.status,'HOLD');assert.equal(x.checks.bundleIntegrity,'VERIFIED_LOCAL');assert.equal(x.checks.commitTiming,'OBSERVED_WITHIN_WINDOW');assert.equal(x.checks.frozenMarketCoverage,'VERIFIED_LOCAL');assert.equal(x.checks.insufficientAssessmentCount,4);assert.equal(x.checks.candidateSignalStatus,'WITHHELD');
 assert.deepEqual(x.blockers,['SOURCE_AUTHENTICATION_UNVERIFIED','TRUSTED_DURABLE_TIME_UNVERIFIED','TRUSTED_TRANSACTION_IDENTITY_UNVERIFIED','SCENARIO_POLICY_UNAPPROVED','MARKET_POLICY_UNAPPROVED','STRONG_SUPPORT_POLICY_UNAPPROVED']);
 assert.equal(x.formalKpiEligible,false);assert.equal(x.adopted,false);assert.equal(x.productionActivationReady,false);assert.ok(Object.isFrozen(x.checks.assessedHorseNos));assert.ok(Object.isFrozen(x.blockers));assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));assert.equal(await storedText(f.db),before);
});
test('readiness: missing commit evidence cannot be inferred from seal time or regenerated',async t=>{
 const f=await fixture(t),j=await journal(f.db);await capture(args(f.db));const start=f.db.calls.length;
 const x=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(x.status,'HOLD');assert.equal(x.checks.commitEvidence,'UNAVAILABLE');assert.equal(x.checks.commitTiming,'UNKNOWN');assert.ok(x.blockers.includes('COMMIT_EVIDENCE_MISSING'));assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));assert.equal((await f.db.first('SELECT count(*) AS n FROM research_nar_commit_observations')).n,0);
});
test('readiness: late observed commit remains HOLD and explicitly blocks readiness',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db));
 await saveObservation({enabled:true,snapshot:x.snapshot,receiptStore:j,observation:{outcome:'RESOLVED',startedAt:now,returnedAt:now+60001}});
 const y=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(y.status,'HOLD');assert.equal(y.checks.commitTiming,'OBSERVED_OUTSIDE_WINDOW');assert.ok(y.blockers.includes('COMMIT_OBSERVED_LATE'));assert.equal(y.productionActivationReady,false);
});
test('readiness: absent source has no fabricated positive checks',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(x.status,'MISSING');assert.equal(x.checks,null);assert.deepEqual(x.blockers,['INITIAL_SOURCE_MISSING']);assert.equal(x.formalKpiEligible,false);
});
test('readiness: corrupt evidence rejects without reporting successful checks or exposing stored text',async t=>{
 const f=await fixture(t),j=await journal(f.db),x=await capture(args(f.db));
 await f.db.run('INSERT INTO research_nar_commit_observations VALUES (?,?)',['nar-commit-observation:v1:'+raceId+':'+x.snapshot.contentSha256,'private corrupt evidence']);
 const start=f.db.calls.length,y=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(y.status,'REJECTED');assert.equal(y.checks,null);assert.ok(!JSON.stringify(y).includes('private corrupt evidence'));assert.ok(f.db.calls.slice(start).every(sql=>sql.startsWith('SELECT')));
});
test('readiness: legacy EARLY is not reported as a verified initial market bundle',async t=>{
 const f=await fixture(t),j=await journal(f.db),legacy=await freezeNarEarlySnapshot({raceId,record:receipt().record,now,freshAcquisition:true});
 await f.db.run('INSERT INTO research_nar_early_snapshots VALUES (?,?)',[oldKey,JSON.stringify(legacy.snapshot)]);
 const x=await readiness({store:store(f.db,'read-only'),receiptStore:j,raceId});
 assert.equal(x.status,'HOLD');assert.equal(x.checks.sourceKind,'LEGACY_EARLY');assert.equal(x.checks.bundleIntegrity,'NOT_EVALUATED');assert.ok(x.blockers.includes('LEGACY_INITIAL_BUNDLE_UNCONFIRMED'));assert.equal(x.adopted,false);
});
