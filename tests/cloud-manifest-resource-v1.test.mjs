import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{readD1Manifest} from '../worker.js';

function row(overrides={}){return {race_id:'2026-10-19|浦和|1',model_version:'10.0.1',updated_at:'2026-10-19T00:00:00Z',status:'validated',race_fp:'r',prediction_fp:'p',market_fp:null,final_fp:null,result_fp:'result',validation_fp:null,live_fp:'live',...overrides};}
function dbWith(read){const sql=[];return {sql,prepare(query){sql.push(query);assert.match(query,/^SELECT /);assert.doesNotMatch(query,/_json|\b(?:CREATE|ALTER|UPDATE|INSERT|DELETE|DROP)\b/i);return {all:()=>read(query,sql.length)};},batch(){throw Error('GET_MUST_NOT_WRITE_OR_INITIALIZE_SCHEMA')}};}

test('stored scalar fingerprints are returned unchanged with one SELECT and zero schema writes',async()=>{
 const input=row(),before=JSON.stringify(input),db=dbWith(async()=>({results:[input]})),[out]=await readD1Manifest(db);
 assert.equal(db.sql.length,1);assert.equal(out.fingerprintStatus,'stored');assert.equal(out.predictionFingerprint,'p');assert.equal(out.marketFingerprint,null);assert.equal(out.liveFingerprint,'live');assert.equal(JSON.stringify(input),before);
});
test('1657 legacy rows do not read or parse snapshot JSON and use only one scalar query',async()=>{
 const inputs=Array.from({length:1657},(_,i)=>{const r=row({race_id:`synthetic-${i}`,prediction_fp:null});Object.defineProperty(r,'prediction_json',{get(){throw Error('SNAPSHOT_BODY_READ')}});return r;});
 const db=dbWith(async()=>({results:inputs})),out=await readD1Manifest(db);assert.equal(out.length,1657);assert.equal(db.sql.length,1);assert.ok(out.every(x=>x.fingerprintStatus==='unavailable'&&x.predictionFingerprint===null&&x.liveFingerprint===null));assert.ok(JSON.stringify(out).length<1_000_000);
});
test('missing fingerprint columns use metadata-only compatibility query, not snapshot fallback',async()=>{
 const db=dbWith(async(q,n)=>{if(n===1)throw Error('D1_ERROR: no such column: race_fp');return {results:[row({race_fp:undefined,prediction_fp:undefined,live_fp:undefined})]};});
 const [out]=await readD1Manifest(db);assert.equal(db.sql.length,2);assert.match(db.sql[1],/^SELECT race_id,model_version,updated_at,status FROM races /);assert.equal(out.fingerprintStatus,'unavailable');assert.equal(out.raceFingerprint,null);
});
test('general DB failures never trigger an expensive retry or expose raw details',async()=>{
 const db=dbWith(async()=>{throw Error('PRIVATE_SQL_TOKEN timeout')});await assert.rejects(readD1Manifest(db),e=>e.code==='d1_read_failed'&&!e.message.includes('PRIVATE'));assert.equal(db.sql.length,1);
});
test('metadata compatibility read failures remain failures instead of empty success',async()=>{
 const db=dbWith(async(q,n)=>{throw Error(n===1?'no such column: race_fp':'PRIVATE_READ_FAILED')});await assert.rejects(readD1Manifest(db),e=>e.code==='d1_read_failed');assert.equal(db.sql.length,2);
});
test('missing required or undefined optional fingerprint columns never fabricate a complete descriptor',async()=>{
 for(const overrides of [{prediction_fp:null},{race_fp:''},{live_fp:undefined},{market_fp:undefined},{final_fp:23}]){const db=dbWith(async()=>({results:[row(overrides)]})),[out]=await readD1Manifest(db);assert.equal(out.fingerprintStatus,'unavailable');assert.equal(out.predictionFingerprint,null);}
});
test('manifest API keeps its response shape and remains SELECT-only even for legacy rows',async()=>{
 const db=dbWith(async()=>({results:[row({prediction_fp:null})]})),res=await worker.fetch(new Request('https://example.com/api/db/manifest'),{DB:db}),body=await res.json();assert.equal(res.status,200);assert.equal(body.ok,true);assert.equal(body.source,'cloudflare_d1');assert.equal(body.records[0].fingerprintStatus,'unavailable');assert.equal(db.sql.length,1);
});
test('manifest API reports sanitized failures with no raw server details',async()=>{
 const db=dbWith(async()=>{throw Error('PRIVATE_TOKEN')});const res=await worker.fetch(new Request('https://example.com/api/db/manifest'),{DB:db}),body=await res.json();assert.equal(res.status,500);assert.equal(body.error,'d1_read_failed');assert.equal('detail'in body,false);assert.doesNotMatch(JSON.stringify(body),/PRIVATE/);
});
test('missing DB binding remains an explicit failure',async()=>{await assert.rejects(readD1Manifest(null),e=>e.code==='d1_binding_unavailable');});
