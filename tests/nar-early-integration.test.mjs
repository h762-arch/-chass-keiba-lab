import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureNarEarlyResearch} from '../src/research/nar-early-capture.mjs';
import {createNarEarlySqlStore,NAR_EARLY_RESEARCH_SCHEMA_SQL} from '../src/research/nar-early-sql-store.mjs';
import {readNarEarly} from '../src/research/nar-early-store.mjs';

// Entire fixture is synthetic; no official network, production DB or KPI input.
const now=Date.parse('2026-10-07T01:00:00Z'),at=new Date(now).toISOString(),raceId='2026-10-07|川崎|1',key='nar-early:v1:'+raceId;
function source(odds=3){
 const race={raceType:'NAR',raceDate:'2026-10-07',track:'川崎',raceNo:1,postTime:'15:00',pace:'標準',trackCondition:'良'};
 const r={race,predictionSnapshot:{race,createdAt:at,generatedAt:at,horses:[
  {horseNo:1,abilityMark:'◎',win:40,place:70,predictedTime:'1:16.0'},
  {horseNo:2,abilityMark:'',valueMark:'💎',win:5,place:25,predictedTime:'1:16.8',supportReasons:['差しが届く2〜3着シナリオ','同距離実績']},
  {horseNo:3,abilityMark:'',sourceMark:'⚠️',win:20,place:40,predictedTime:'1:17.1',supportReasons:['先行競合で4着以下のシナリオ']}
 ]},marketSnapshot:{createdAt:at,horses:[{horseNo:1,odds,popularity:1},{horseNo:2,odds:25,popularity:6},{horseNo:3,odds:4,popularity:2}]},finalSnapshot:{createdAt:at,top3:[{horseNo:1,mark:'◎'},{horseNo:2,valueMark:'💎'}]}};
 const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
 const hash=v=>{let h=2166136261;for(const c of canonical(v).split(''))h=Math.imul(h^c.charCodeAt(0),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0')};
 r.snapshotIntegrity={algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:Object.fromEntries(['predictionSnapshot','marketSnapshot','finalSnapshot'].map(k=>[k,hash(r[k])]))};return r;
}
const python=`import json,sqlite3,sys
x=json.load(sys.stdin)
with sqlite3.connect(x['path']) as db:
 db.row_factory=sqlite3.Row
 c=db.execute(x['sql'],x['args'])
 print(json.dumps((dict(r) if (r:=c.fetchone()) is not None else None) if x['first'] else {'success':True,'meta':{'changes':max(c.rowcount,0)}}))`;
function database(t,setup=true){
 const directory=mkdtempSync(join(tmpdir(),'chass-early-chain-')),path=join(directory,'research.sqlite');t.after(()=>rmSync(directory,{recursive:true,force:true}));const calls=[];
 function query(sql,args=[],first=false){calls.push(sql);const r=spawnSync('python3',['-c',python],{input:JSON.stringify({path,sql,args,first}),encoding:'utf8'});if(r.status!==0)throw Error('LOCAL_SQL_FAILURE');return JSON.parse(r.stdout)}
 const db={prepare(sql){return {bind(...args){return {async first(){return query(sql,args,true)},async run(){return query(sql,args)}}}}}};
 if(setup)query(NAR_EARLY_RESEARCH_SCHEMA_SQL);
 return {calls,query,open:mode=>createNarEarlySqlStore({db,mode})};
}
const receipt=record=>({record,acquiredAt:at,acquisitionKind:'fresh'});
const capture=(store,options={})=>captureNarEarlyResearch({enabled:true,store,raceId,clock:()=>now,acquire:()=>receipt(source()),...options});

test('full acquisition-freeze-SQL-reopen chain preserves all original source fields',async t=>{
 const db=database(t),r=source(),before=structuredClone(r);let acquisitions=0;
 const first=await capture(db.open('research-write'),{acquire:()=>{acquisitions++;return receipt(r)}});
 assert.equal(first.status,'CREATED');assert.equal(acquisitions,1);assert.deepEqual(r,before);
 const reread=await readNarEarly({store:db.open('read-only'),raceId});assert.equal(reread.status,'PRESERVED');assert.deepEqual(reread.snapshot,first.snapshot);
 assert.deepEqual(reread.snapshot.data,{race:r.race,predictionSnapshot:r.predictionSnapshot,marketSnapshot:r.marketSnapshot,finalSnapshot:r.finalSnapshot,sourceIntegrity:r.snapshotIntegrity});
 assert.equal(reread.snapshot.formalKpiEligible,false);assert.equal(reread.snapshot.researchOnly,true);
});
test('reopened chain after results does not reacquire or overwrite EARLY',async t=>{
 const db=database(t),first=await capture(db.open('research-write')),json=db.query('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key=?',[key],true).snapshot_json;
 const later=source(99);later.resultSnapshot={finishOrder:[3,1,2]};later.predictionSnapshot.horses[1].valueMark='';const start=db.calls.length;
 const restored=await capture(db.open('read-only'),{clock:()=>now+12*3600_000,acquire:()=>assert.fail('must not acquire later data')});
 assert.equal(restored.status,'PRESERVED');assert.deepEqual(restored.snapshot,first.snapshot);assert.equal(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')),true);
 assert.equal(db.query('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key=?',[key],true).snapshot_json,json);
});
test('competing full-chain acquisitions produce one SQLite first revision',async t=>{
 const db=database(t),all=await Promise.all([capture(db.open('research-write')),capture(db.open('research-write'),{acquire:()=>receipt(source(99))})]);
 assert.deepEqual(all.map(x=>x.status).sort(),['CREATED','PRESERVED']);assert.equal(all[0].snapshot.contentSha256,all[1].snapshot.contentSha256);assert.equal(all[0].snapshot.revision,1);
 assert.equal(db.query('SELECT count(*) AS n FROM research_nar_early_snapshots',[],true).n,1);
});
test('out-of-band stored signal tamper blocks entire chain without repair',async t=>{
 const db=database(t);await capture(db.open('research-write'));const raw=db.query('SELECT snapshot_json FROM research_nar_early_snapshots WHERE storage_key=?',[key],true).snapshot_json,x=JSON.parse(raw);x.data.predictionSnapshot.horses[1].valueMark='💎💎';
 db.query('UPDATE research_nar_early_snapshots SET snapshot_json=? WHERE storage_key=?',[JSON.stringify(x),key]);const start=db.calls.length;
 const rejected=await capture(db.open('research-write'),{acquire:()=>assert.fail('must not fall forward')});assert.equal(rejected.reason,'EARLY_CONTENT_MISMATCH');assert.equal(db.calls.slice(start).every(sql=>sql.startsWith('SELECT')),true);
});
test('OFF chain performs no acquisition or SQL even with a writable adapter',async t=>{
 const db=database(t,false);const x=await capture(db.open('research-write'),{enabled:false,acquire:()=>assert.fail(),clock:()=>assert.fail()});assert.equal(x.status,'DISABLED');assert.equal(db.calls.length,0);
});
test('absent research table rejects before acquisition and never auto-migrates',async t=>{
 const db=database(t,false),x=await capture(db.open('research-write'),{acquire:()=>assert.fail()});assert.equal(x.reason,'STORE_READ_FAILED');assert.equal(db.calls.some(sql=>/CREATE|INSERT/.test(sql)),false);
});
test('historical, result-present or cross-race input never reaches SQL insert',async t=>{
 const db=database(t);for(const alter of [r=>r.race.historicalResearch=true,r=>r.resultSnapshot={},r=>r.race.raceNo=2]){const r=source();alter(r);assert.equal((await capture(db.open('research-write'),{acquire:()=>receipt(r)})).status,'REJECTED')}
 assert.equal(db.calls.some(sql=>sql.startsWith('INSERT')),false);assert.equal(db.query('SELECT count(*) AS n FROM research_nar_early_snapshots',[],true).n,0);
});
test('acquisition crossing saved post time cannot create an EARLY row',async t=>{
 const db=database(t),post=Date.parse('2026-10-07T06:00:00Z');let ticks=0;
 const x=await capture(db.open('research-write'),{clock:()=>ticks++?post:now,acquire:()=>({...receipt(source()),acquiredAt:new Date(post).toISOString()})});
 assert.equal(x.reason,'NOT_PRE_POST');assert.equal(db.calls.some(sql=>sql.startsWith('INSERT')),false);
});
