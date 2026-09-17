import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {appendLayerRevision,createPrecomputedSnapshot,createSnapshotHash} from '../src/prediction/precomputed-snapshot.mjs';
import {d1RowToSnapshot,findPrecomputedInput,findPrecomputedRevision,savePrecomputedSnapshot,snapshotToD1Values} from '../src/prediction/precomputed-store.mjs';

async function fixture(organization='JRA'){
  return createPrecomputedSnapshot({raceId:`20260910-${organization}-中山-01`,organization,source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:{mark:'◎'},now:'2026-09-10T01:00:00Z'});
}

function mockDb({existingInput=null,existingRevision=null,latest=0}={}){
  const calls=[];
  return {calls,prepare(sql){const call={sql,args:[],run:false};calls.push(call);return {bind(...args){call.args=args;return this;},async first(){if(sql.includes('input_hash=?'))return existingInput;if(sql.includes('snapshot_hash=?'))return existingRevision;if(sql.includes('MAX(revision)'))return {revision:latest};return null;},async run(){call.run=true;return {success:true};}};}};
}

function sqliteD1({barrierMaxReads=0,alwaysConflict=false,insertError=null}={}){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'));
  let maxReads=0,insertAttempts=0,releaseBarrier;
  const barrier=new Promise(resolve=>{releaseBarrier=resolve;});
  return {
    prepare(sql){
      let args=[];
      return {
        bind(...values){args=values;return this;},
        async first(){
          if(barrierMaxReads&&sql.includes('MAX(revision)')){
            maxReads++;
            if(maxReads===barrierMaxReads)releaseBarrier();
            if(maxReads<=barrierMaxReads)await barrier;
          }
          return sqlite.prepare(sql).get(...args)||null;
        },
        async run(){
          insertAttempts++;
          if(insertError)throw insertError;
          if(alwaysConflict&&sql.startsWith('INSERT'))throw new Error('D1_ERROR: UNIQUE constraint failed: precomputed_race_snapshots.organization, precomputed_race_snapshots.race_id, precomputed_race_snapshots.revision');
          return sqlite.prepare(sql).run(...args);
        }
      };
    },
    rows(organization,raceId){
      return sqlite.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? ORDER BY revision').all(organization,raceId);
    },
    insertAttempts(){return insertAttempts;},
    close(){sqlite.close();}
  };
}

test('D1 row serialization preserves separated five layers',async()=>{
  const snapshot=await fixture();
  const values=snapshotToD1Values(snapshot,{revision:1,createdAt:'2026-09-10T01:00:01Z'});
  assert.equal(values[0],'JRA');
  assert.equal(values[2],1);
  assert.match(values[5],/^[a-f0-9]{64}$/);
  assert.equal(values[7],'2026-09-10T01:00:00Z');
  assert.equal(values[8],'2026-09-10T01:00:00Z');
  assert.equal(JSON.parse(values[15]).ability,80);
  assert.equal(JSON.parse(values[16]).odds,4);
  assert.equal(JSON.parse(values[17]).mark,'◎');
  assert.equal(values[19],'CALCULATED');
});

test('D1 save is idempotent only for an identical snapshotHash',async()=>{
  const snapshot=await fixture(),DB=mockDb({existingRevision:{revision:3}});
  const result=await savePrecomputedSnapshot(DB,snapshot);
  assert.deepEqual(result,{saved:false,reason:'UNCHANGED',revision:3});
  assert.equal(DB.calls.some(call=>call.sql.startsWith('INSERT')),false);
});

test('D1 save appends one revision without mixing organization',async()=>{
  const snapshot=await fixture('NAR'),DB=mockDb({latest:2});
  const result=await savePrecomputedSnapshot(DB,snapshot,{createdAt:'2026-09-10T01:00:01Z'});
  assert.deepEqual(result,{saved:true,reason:'SAVED',revision:3});
  const insert=DB.calls.find(call=>call.sql.startsWith('INSERT'));
  assert.equal(insert.args[0],'NAR');
  assert.equal(insert.args[1],snapshot.raceId);
  assert.equal(insert.args[2],3);
  assert.equal(insert.run,true);
});

test('RESULT append keeps inputHash and saves a new revision',async()=>{
  const original=await fixture(),withResult=await appendLayerRevision(original,'RESULT',{finishOrder:[1]}),DB=mockDb({latest:1});
  assert.equal(withResult.inputHash,original.inputHash);
  assert.notEqual(withResult.snapshotHash,original.snapshotHash);
  const result=await savePrecomputedSnapshot(DB,withResult);
  assert.deepEqual(result,{saved:true,reason:'SAVED',revision:2});
  assert.equal(DB.calls.find(call=>call.sql.startsWith('INSERT')).args[18],JSON.stringify({finishOrder:[1]}));
});

test('SOURCE freshness-only revision persists under a new snapshotHash',async()=>{
  const original=await fixture();
  const refreshed=await appendLayerRevision(original,'SOURCE',{...original.layers.SOURCE,acquiredAt:'2026-09-10T01:16:00Z'},{at:'2026-09-10T01:16:00Z'});
  const DB=mockDb({latest:1});
  assert.equal(refreshed.inputHash,original.inputHash);
  assert.notEqual(refreshed.snapshotHash,original.snapshotHash);
  assert.equal(refreshed.sourceValidatedAt,'2026-09-10T01:16:00Z');
  assert.deepEqual(await savePrecomputedSnapshot(DB,refreshed),{saved:true,reason:'SAVED',revision:2});
});

test('same RESULT revision is a no-op',async()=>{
  const original=await fixture(),withResult=await appendLayerRevision(original,'RESULT',{finishOrder:[1]}),DB=mockDb({existingRevision:{revision:2}});
  const result=await savePrecomputedSnapshot(DB,withResult);
  assert.deepEqual(result,{saved:false,reason:'UNCHANGED',revision:2});
  assert.equal(DB.calls.some(call=>call.sql.startsWith('INSERT')),false);
});

test('pre-FINAL MARKET change saves a new revision under the same inputHash',async()=>{
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-01',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:null,now:'2026-09-10T01:00:00Z'});
  const changed=await appendLayerRevision(partial,'MARKET',{odds:5}),DB=mockDb({latest:1});
  assert.equal(changed.inputHash,partial.inputHash);
  assert.notEqual(changed.snapshotHash,partial.snapshotHash);
  assert.deepEqual(await savePrecomputedSnapshot(DB,changed),{saved:true,reason:'SAVED',revision:2});
});

test('input lookup binds organization race and hash independently',async()=>{
  const DB=mockDb();
  await findPrecomputedInput(DB,'JRA','race-1','hash-1');
  assert.deepEqual(DB.calls[0].args,['JRA','race-1','hash-1']);
});

test('input lookup reconstructs the full snapshot needed for freshness decisions',async()=>{
  const row={organization:'JRA',race_id:'race-1',revision:2,source_hash:'s',input_hash:'i',snapshot_hash:'h',source_acquired_at:'a',source_validated_at:'sv',data_calculated_at:'dc',calculated_at:'dc',calculation_version:'v',model_version:'m',cluster_version:null,signal_rule_version:null,status:'PARTIAL',source_json:'{}',data_json:'{"ability":80}',market_json:null,final_json:null,result_json:null};
  const found=await findPrecomputedInput(mockDb({existingInput:row}),'JRA','race-1','i');
  assert.equal(found.sourceValidatedAt,'sv');
  assert.equal(found.dataCalculatedAt,'dc');
  assert.deepEqual(found.layers.DATA,{ability:80});
});

test('revision lookup binds organization race and snapshot hash independently',async()=>{
  const DB=mockDb({existingRevision:{revision:1}});
  await findPrecomputedRevision(DB,'NAR','race-1','snapshot-1');
  assert.deepEqual(DB.calls[0].args,['NAR','race-1','snapshot-1']);
});

test('D1 row read keeps FINAL separate from later RESULT',()=>{
  const snapshot=d1RowToSnapshot({organization:'JRA',race_id:'r',revision:2,source_hash:'s',input_hash:'i',snapshot_hash:'h',source_acquired_at:'a',source_validated_at:'sv',data_calculated_at:'dc',calculated_at:'c',calculation_version:'v',model_version:'m',cluster_version:null,signal_rule_version:null,status:'CALCULATED',source_json:'{}',data_json:'{"ability":80}',market_json:'{"odds":4}',final_json:'{"mark":"◎"}',result_json:'{"finish":1}'});
  assert.deepEqual(snapshot.layers.FINAL,{mark:'◎'});
  assert.deepEqual(snapshot.layers.RESULT,{finish:1});
  assert.equal(Object.isFrozen(snapshot.layers.FINAL),true);
  assert.throws(()=>{snapshot.layers.FINAL.mark='○';},TypeError);
});

test('concurrent identical snapshot saves resolve to one SAVED and one UNCHANGED',async()=>{
  const snapshot=await fixture(),DB=sqliteD1({barrierMaxReads:2});
  try{
    const results=await Promise.all([savePrecomputedSnapshot(DB,snapshot),savePrecomputedSnapshot(DB,snapshot)]);
    assert.deepEqual(results.map(result=>result.reason).sort(),['SAVED','UNCHANGED']);
    assert.equal(DB.rows(snapshot.organization,snapshot.raceId).length,1);
  }finally{DB.close();}
});

test('many concurrent identical snapshot saves persist one revision without exceptions',async()=>{
  const snapshot=await fixture(),writers=6,DB=sqliteD1({barrierMaxReads:writers});
  try{
    const results=await Promise.all(Array.from({length:writers},()=>savePrecomputedSnapshot(DB,snapshot)));
    assert.equal(results.filter(result=>result.reason==='SAVED').length,1);
    assert.equal(results.filter(result=>result.reason==='UNCHANGED').length,writers-1);
    assert.deepEqual(DB.rows(snapshot.organization,snapshot.raceId).map(row=>row.revision),[1]);
  }finally{DB.close();}
});

test('different snapshots concurrently append unique revisions without loss',async()=>{
  const first=await fixture();
  const second=await appendLayerRevision(first,'RESULT',{finishOrder:[1]});
  const third=await appendLayerRevision(first,'RESULT',{finishOrder:[2]});
  const DB=sqliteD1({barrierMaxReads:2});
  try{
    const results=await Promise.all([savePrecomputedSnapshot(DB,second),savePrecomputedSnapshot(DB,third)]);
    assert.deepEqual(results.map(result=>result.reason),['SAVED','SAVED']);
    const rows=DB.rows(first.organization,first.raceId);
    assert.deepEqual(rows.map(row=>row.revision),[1,2]);
    assert.deepEqual(new Set(rows.map(row=>row.snapshot_hash)),new Set([second.snapshotHash,third.snapshotHash]));
  }finally{DB.close();}
});

test('multiple different concurrent snapshots all survive append-only revision allocation',async()=>{
  const original=await fixture();
  const snapshots=[original];
  for(let index=1;index<4;index++)snapshots.push(await appendLayerRevision(original,'RESULT',{finishOrder:[index]}));
  const DB=sqliteD1({barrierMaxReads:snapshots.length});
  try{
    const results=await Promise.all(snapshots.map(snapshot=>savePrecomputedSnapshot(DB,snapshot)));
    assert.equal(results.every(result=>result.reason==='SAVED'),true);
    const rows=DB.rows(original.organization,original.raceId);
    assert.deepEqual(rows.map(row=>row.revision),[1,2,3,4]);
    assert.deepEqual(new Set(rows.map(row=>row.snapshot_hash)),new Set(snapshots.map(snapshot=>snapshot.snapshotHash)));
  }finally{DB.close();}
});

test('concurrent MARKET FINAL RESULT revisions keep lifecycle and FINAL byte-equivalent',async()=>{
  const source={acquiredAt:'2026-09-10T00:00:00Z'};
  const data={ability:80};
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-02',organization:'JRA',source,data,market:null,final:null,now:'2026-09-10T01:00:00Z'});
  const market=await appendLayerRevision(partial,'MARKET',{odds:4});
  const final=await appendLayerRevision(market,'FINAL',{mark:'◎'});
  const finalBytes=JSON.stringify(final.layers.FINAL);
  const result=await appendLayerRevision(final,'RESULT',{finishOrder:[1]});
  const DB=sqliteD1({barrierMaxReads:3});
  try{
    const saves=await Promise.all([market,final,result].map(snapshot=>savePrecomputedSnapshot(DB,snapshot)));
    assert.equal(saves.every(item=>item.reason==='SAVED'),true);
    const rows=DB.rows(partial.organization,partial.raceId);
    assert.deepEqual(rows.map(row=>row.revision),[1,2,3]);
    assert.equal(rows[0].final_json,null);
    assert.equal(rows[0].result_json,null);
    assert.equal(rows[1].final_json,finalBytes);
    assert.equal(rows[1].result_json,null);
    assert.equal(rows[2].final_json,finalBytes);
    assert.equal(JSON.stringify(result.layers.FINAL),finalBytes);
  }finally{DB.close();}
});

test('reverse concurrent lifecycle writers cannot regress latest RESULT state',async()=>{
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-03',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:null,final:null,now:'2026-09-10T01:00:00Z'});
  const market=await appendLayerRevision(partial,'MARKET',{odds:4});
  const final=await appendLayerRevision(market,'FINAL',{mark:'◎'});
  const result=await appendLayerRevision(final,'RESULT',{finishOrder:[1]});
  const finalBytes=JSON.stringify(final.layers.FINAL);
  const DB=sqliteD1({barrierMaxReads:3});
  try{
    const saves=await Promise.all([result,final,market].map(snapshot=>savePrecomputedSnapshot(DB,snapshot)));
    assert.deepEqual(saves.map(item=>item.reason),['SAVED','SUPERSEDED','SUPERSEDED']);
    const rows=DB.rows(partial.organization,partial.raceId);
    assert.equal(rows.length,1);
    assert.equal(rows[0].result_json,JSON.stringify(result.layers.RESULT));
    assert.equal(rows[0].final_json,finalBytes);
    assert.equal(rows[0].status,'CALCULATED');
  }finally{DB.close();}
});

test('metadata-only SOURCE differences cannot let a delayed MARKET regress RESULT',async()=>{
  const source={horses:[{number:1}],acquiredAt:'2026-09-10T00:00:00Z'};
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-04',organization:'JRA',source,data:{ability:80},market:null,final:null,now:'2026-09-10T01:00:00Z'});
  const market=await appendLayerRevision(partial,'MARKET',{odds:4});
  const final=await appendLayerRevision(market,'FINAL',{mark:'◎'});
  const result=await appendLayerRevision(final,'RESULT',{finishOrder:[1]});
  const refreshedPartial=await createPrecomputedSnapshot({raceId:partial.raceId,organization:'JRA',source:{...source,acquiredAt:'2026-09-10T01:01:00Z'},data:{ability:80},market:null,final:null,now:'2026-09-10T01:01:00Z'});
  const delayedMarket=await appendLayerRevision(refreshedPartial,'MARKET',{odds:4});
  assert.equal(delayedMarket.inputHash,result.inputHash);
  const DB=sqliteD1({barrierMaxReads:2});
  try{
    const saves=await Promise.all([savePrecomputedSnapshot(DB,result),savePrecomputedSnapshot(DB,delayedMarket)]);
    assert.deepEqual(saves.map(item=>item.reason),['SAVED','SUPERSEDED']);
    const rows=DB.rows(partial.organization,partial.raceId);
    assert.equal(rows.length,1);
    assert.notEqual(rows[0].result_json,null);
    assert.notEqual(rows[0].final_json,null);
  }finally{DB.close();}
});

test('concurrent conflicting FINAL values cannot both commit for one inputHash',async()=>{
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-05',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:null,now:'2026-09-10T01:00:00Z'});
  const finalA=await appendLayerRevision(partial,'FINAL',{mark:'◎'});
  const finalB=await appendLayerRevision(partial,'FINAL',{mark:'○'});
  const DB=sqliteD1({barrierMaxReads:2});
  try{
    const saves=await Promise.allSettled([savePrecomputedSnapshot(DB,finalA),savePrecomputedSnapshot(DB,finalB)]);
    assert.equal(saves.filter(item=>item.status==='fulfilled'&&item.value.reason==='SAVED').length,1);
    assert.equal(saves.filter(item=>item.status==='rejected'&&item.reason?.code==='finalized_snapshot_conflict').length,1);
    const rows=DB.rows(partial.organization,partial.raceId);
    assert.equal(rows.length,1);
    assert.ok([JSON.stringify(finalA.layers.FINAL),JSON.stringify(finalB.layers.FINAL)].includes(rows[0].final_json));
  }finally{DB.close();}
});

test('RESULT based on FINAL A conflicts with concurrent FINAL B',async()=>{
  const partial=await createPrecomputedSnapshot({raceId:'20260910-JRA-中山-06',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:null,now:'2026-09-10T01:00:00Z'});
  const finalA=await appendLayerRevision(partial,'FINAL',{mark:'◎'});
  const resultA=await appendLayerRevision(finalA,'RESULT',{finishOrder:[1]});
  const finalB=await appendLayerRevision(partial,'FINAL',{mark:'○'});
  const DB=sqliteD1({barrierMaxReads:2});
  try{
    const saves=await Promise.allSettled([savePrecomputedSnapshot(DB,resultA),savePrecomputedSnapshot(DB,finalB)]);
    assert.equal(saves.filter(item=>item.status==='fulfilled'&&item.value.reason==='SAVED').length,1);
    assert.equal(saves.filter(item=>item.status==='rejected'&&item.reason?.code==='finalized_snapshot_conflict').length,1);
    assert.equal(DB.rows(partial.organization,partial.raceId).length,1);
  }finally{DB.close();}
});

test('out-of-order identical finalized freshness revisions cannot move timestamps backward',async()=>{
  const input={raceId:'20260910-JRA-中山-07',organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:{mark:'◎'}};
  const newer=await createPrecomputedSnapshot({...input,now:'2026-09-10T02:00:00Z'});
  const older=await createPrecomputedSnapshot({...input,now:'2026-09-10T01:30:00Z'});
  assert.equal(newer.inputHash,older.inputHash);
  const DB=sqliteD1({barrierMaxReads:2});
  try{
    const saves=await Promise.all([savePrecomputedSnapshot(DB,newer),savePrecomputedSnapshot(DB,older)]);
    assert.deepEqual(saves.map(item=>item.reason),['SAVED','SUPERSEDED']);
    const rows=DB.rows(newer.organization,newer.raceId);
    assert.equal(rows.length,1);
    assert.equal(rows[0].source_validated_at,'2026-09-10T02:00:00Z');
    assert.equal(rows[0].data_calculated_at,'2026-09-10T02:00:00Z');
  }finally{DB.close();}
});

for(const [label,sourceValidatedAt,dataCalculatedAt] of [
  ['sourceValidatedAt only','2026-09-10T01:30:00Z','2026-09-10T02:00:00Z'],
  ['dataCalculatedAt only','2026-09-10T02:00:00Z','2026-09-10T01:30:00Z'],
  ['new source validation with stale DATA','2026-09-10T03:00:00Z','2026-09-10T01:30:00Z']
])test(`${label} cannot regress persisted freshness`,async()=>{
  const latest=await createPrecomputedSnapshot({raceId:`freshness-${label}`,organization:'JRA',source:{acquiredAt:'2026-09-10T00:00:00Z'},data:{ability:80},market:{odds:4},final:{mark:'◎'},now:'2026-09-10T02:00:00Z'});
  const candidate={...latest,sourceValidatedAt,dataCalculatedAt,calculatedAt:dataCalculatedAt};
  candidate.snapshotHash=await createSnapshotHash(candidate);
  const DB=sqliteD1();
  try{
    assert.equal((await savePrecomputedSnapshot(DB,latest)).reason,'SAVED');
    assert.equal((await savePrecomputedSnapshot(DB,candidate)).reason,'SUPERSEDED');
    const row=DB.rows(latest.organization,latest.raceId).at(-1);
    assert.equal(row.source_validated_at,'2026-09-10T02:00:00Z');
    assert.equal(row.data_calculated_at,'2026-09-10T02:00:00Z');
  }finally{DB.close();}
});

test('concurrent JRA and NAR saves use independent revision namespaces',async()=>{
  const jra=await fixture('JRA'),nar=await fixture('NAR'),DB=sqliteD1({barrierMaxReads:2});
  try{
    const results=await Promise.all([savePrecomputedSnapshot(DB,jra),savePrecomputedSnapshot(DB,nar)]);
    assert.deepEqual(results.map(result=>result.revision),[1,1]);
    assert.equal(DB.rows('JRA',jra.raceId).length,1);
    assert.equal(DB.rows('NAR',nar.raceId).length,1);
  }finally{DB.close();}
});

test('persistent revision conflicts stop at the explicit retry limit with diagnostics',async()=>{
  const snapshot=await fixture(),DB=sqliteD1({alwaysConflict:true});
  try{
    await assert.rejects(
      savePrecomputedSnapshot(DB,snapshot,{maxRetries:2}),
      error=>error?.code==='precomputed_snapshot_save_retry_exhausted'
        &&error.organization===snapshot.organization
        &&error.raceId===snapshot.raceId
        &&error.snapshotHash===snapshot.snapshotHash
        &&error.attempts===3
    );
  }finally{DB.close();}
});

for(const code of ['SQLITE_CONSTRAINT_NOTNULL','SQLITE_CONSTRAINT_CHECK','SQLITE_CONSTRAINT_FOREIGNKEY']){
  test(`${code} is not retried or hidden as revision contention`,async()=>{
    const original=new Error(code),snapshot=await fixture(),DB=sqliteD1({insertError:original});
    try{
      await assert.rejects(savePrecomputedSnapshot(DB,snapshot),error=>error===original);
      assert.equal(DB.insertAttempts(),1);
    }finally{DB.close();}
  });
}

test('non-constraint D1 errors are rethrown after one insert attempt',async()=>{
  const original=new Error('D1_ERROR: disk I/O error'),snapshot=await fixture(),DB=sqliteD1({insertError:original});
  try{
    await assert.rejects(savePrecomputedSnapshot(DB,snapshot),error=>error===original);
    assert.equal(DB.insertAttempts(),1);
  }finally{DB.close();}
});
