import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {savePrecomputedSnapshot} from '../src/prediction/precomputed-store.mjs';
import {readEarlyExactRevisionV1 as read,EXACT_REVISION_SQL} from '../src/prediction/early-revision-readback-v1.mjs';
async function fixture(organization='JRA',ability=80){return createPrecomputedSnapshot({organization,raceId:'synthetic-race',source:{acquiredAt:'2026-10-17T00:00:00Z',runners:[{horseNo:1,canonicalId:'synthetic'}],generation:ability},data:{ability},now:'2026-10-17T00:01:00Z'});}
function expectation(snapshot,revision=1){return {schemaVersion:'CHASS_EARLY_REVISION_EXPECTATION_V1',organization:snapshot.organization,raceId:snapshot.raceId,revision,sourceHash:snapshot.sourceHash,inputHash:snapshot.inputHash,snapshotHash:snapshot.snapshotHash};}
function database(){
 const db=new DatabaseSync(':memory:'),calls=[];
 db.exec(readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'));
 return {db,calls,prepare(sql){const call={sql,args:[]};calls.push(call);let args;return {bind(...values){args=values;call.args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};},close(){db.close();}};
}
function safe(r){assert.equal(r.formalReadiness,'HOLD');for(const k of ['formalKpiEligible','persistenceVerified','acquisitionCertified','earlyFreezeVerified','externalAnchorAuthenticated'])assert.equal(r[k],false);assert.equal(r.earlyImmutable,null);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.ok(Object.isFrozen(r));}
for(const organization of ['JRA','NAR'])test(`actual ${organization} save/readback with newer revision present`,async()=>{
 const DB=database();try{
  const original=await fixture(organization),later=await fixture(organization,90);
  assert.deepEqual(await savePrecomputedSnapshot(DB,original),{saved:true,reason:'SAVED',revision:1});
  assert.deepEqual(await savePrecomputedSnapshot(DB,later),{saved:true,reason:'SAVED',revision:2});
  DB.calls.length=0;const r=await read(DB,JSON.stringify(expectation(original)));
  assert.equal(r.status,'EXACT_REVISION_CONTENT_MATCH');assert.equal(r.revision,1);assert.equal(r.snapshotHash,original.snapshotHash);safe(r);
  assert.deepEqual(DB.calls,[{sql:EXACT_REVISION_SQL,args:[organization,'synthetic-race',1]}]);
 }finally{DB.close();}
});
test('missing requested revision never falls back to latest',async()=>{const DB=database();try{const x=await fixture();await savePrecomputedSnapshot(DB,x);const r=await read(DB,JSON.stringify(expectation(x,2)));assert.equal(r.reason,'REVISION_NOT_FOUND');safe(r);}finally{DB.close();}});
test('organization and race are scoped exactly',async()=>{const DB=database();try{const x=await fixture();await savePrecomputedSnapshot(DB,x);for(const change of [{organization:'NAR'},{raceId:'different'}]){const r=await read(DB,JSON.stringify({...expectation(x),...change}));assert.equal(r.reason,'REVISION_NOT_FOUND');}}finally{DB.close();}});
for(const [column,value,reason] of [
 ['source_json','{"generation":999}','SOURCE_INPUT_HASH_MISMATCH'],
 ['data_json','{"ability":999}','SNAPSHOT_HASH_MISMATCH'],
 ['market_json','{"odds":2}','SNAPSHOT_HASH_MISMATCH'],
 ['snapshot_hash','c'.repeat(64),'SNAPSHOT_HASH_MISMATCH'],
 ['source_hash','c'.repeat(64),'SOURCE_INPUT_HASH_MISMATCH'],
 ['input_hash','c'.repeat(64),'SOURCE_INPUT_HASH_MISMATCH'],
 ['model_version','different','SOURCE_INPUT_HASH_MISMATCH'],
 ['source_validated_at','2026-10-17T00:02:00Z','SNAPSHOT_HASH_MISMATCH'],
 ['data_json','{','READ_OR_VALIDATION_FAILED'],
 ['source_json','null','INVALID_SNAPSHOT_LAYERS'],
 ['snapshot_hash','placeholder','INVALID_STORED_HASH']
])test(`tampered ${column} is rejected`,async()=>{const DB=database();try{
 const x=await fixture();await savePrecomputedSnapshot(DB,x);DB.db.prepare(`UPDATE precomputed_race_snapshots SET ${column}=?`).run(value);
 const r=await read(DB,JSON.stringify(expectation(x)));assert.equal(r.reason,reason);safe(r);
}finally{DB.close();}});
for(const field of ['sourceHash','inputHash','snapshotHash'])test(`expected ${field} mismatch holds`,async()=>{const DB=database();try{
 const x=await fixture();await savePrecomputedSnapshot(DB,x);const e=expectation(x);e[field]='d'.repeat(64);const r=await read(DB,JSON.stringify(e));assert.equal(r.reason,'EXPECTED_HASH_MISMATCH');safe(r);
}finally{DB.close();}});
test('invalid expectations perform no IO and never execute callbacks',async()=>{
 let calls=0;const DB={prepare(){calls++;throw Error();}},x=await fixture(),e=expectation(x),cb={toJSON(){calls++;throw Error();}};
 const inputs=[null,cb,'{','[]','null','x'.repeat(4097),...[
 {revision:0},{revision:1.5},{revision:'1'},{revision:Number.MAX_SAFE_INTEGER+1},{organization:'OTHER'},{raceId:' bad '},{sourceHash:'fake'},{schemaVersion:'other'}
 ].map(c=>JSON.stringify({...e,...c}))];
 for(const raw of inputs){const r=await read(DB,raw);assert.equal(r.reason,'INVALID_EXPECTATION');safe(r);}assert.equal(calls,0);
});
test('binding mismatch from a faulty port is rejected',async()=>{const DB=database();try{
 const x=await fixture();await savePrecomputedSnapshot(DB,x);const row=DB.db.prepare('SELECT * FROM precomputed_race_snapshots').get();
 for(const change of [{revision:2},{revision:'1'},{race_id:'other'},{organization:'NAR'}]){
  const port={prepare(){return {bind(){return this;},async first(){return {...row,...change};}};}};
  assert.equal((await read(port,JSON.stringify(expectation(x)))).reason,'REVISION_BINDING_MISMATCH');
 }
}finally{DB.close();}});
test('port errors remain fixed reasons without private details',async()=>{
 const raw=JSON.stringify(expectation(await fixture()));
 for(const DB of [null,{}, {prepare(){throw Error('PRIVATE_SECRET');}}]){const r=await read(DB,raw);assert.equal(r.reason,'READ_OR_VALIDATION_FAILED');assert.equal(JSON.stringify(r).includes('PRIVATE_SECRET'),false);safe(r);}
});
test('row accessors are rejected without execution',async()=>{let calls=0;const row={};Object.defineProperty(row,'source_json',{enumerable:true,get(){calls++;throw Error();}});const DB={prepare(){return {bind(){return this;},async first(){return row;}};}};assert.equal((await read(DB,JSON.stringify(expectation(await fixture())))).reason,'READ_OR_VALIDATION_FAILED');assert.equal(calls,0);});
test('oversized or deeply nested row JSON holds',async()=>{const raw=JSON.stringify(expectation(await fixture()));for(const source_json of [JSON.stringify({text:'馬'.repeat(340000)}),'['.repeat(34)+'0'+']'.repeat(34)]){const DB={prepare(){return {bind(){return this;},async first(){return {source_json};}};}};assert.equal((await read(DB,raw)).reason,'READ_OR_VALIDATION_FAILED');}});
test('stalled exact read times out without fallback or write',async()=>{let calls=0;const DB={prepare(){calls++;return {bind(){return this;},first(){return new Promise(()=>{});}};}};const r=await read(DB,JSON.stringify(expectation(await fixture())),{timeoutMs:10});assert.equal(r.reason,'READ_TIMEOUT');assert.equal(calls,1);safe(r);});
test('invalid timeout performs no IO',async()=>{let calls=0;const DB={prepare(){calls++;}};for(const timeoutMs of [0,-1,5001,1.5,'10'])assert.equal((await read(DB,JSON.stringify(expectation(await fixture())),{timeoutMs})).reason,'INVALID_READ_TIMEOUT');assert.equal(calls,0);});
test('self-supplied database and matching expectation never certify origin or EARLY freeze',async()=>{const DB=database();try{const x=await fixture();await savePrecomputedSnapshot(DB,x);const r=await read(DB,JSON.stringify({...expectation(x),formalKpiEligible:true,trusted:true}));assert.equal(r.status,'EXACT_REVISION_CONTENT_MATCH');assert.equal(r.storeReadPerformed,true);assert.equal(r.contentHashesVerified,true);safe(r);}finally{DB.close();}});
