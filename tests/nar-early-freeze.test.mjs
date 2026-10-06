import test from 'node:test';
import assert from 'node:assert/strict';
import {freezeNarEarlySnapshot,verifyNarEarlySnapshot} from '../src/research/nar-early-freeze.mjs';
const now=Date.parse('2026-10-07T01:00:00Z'),raceId='2026-10-07|川崎|1';
function canonical(v){if(v===null||typeof v!=='object')return JSON.stringify(v);return Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'}
function hash(v){let h=2166136261;for(const x of canonical(v).split(''))h=Math.imul(h^x.charCodeAt(0),16777619);return 'fnv1a32:'+(h>>>0).toString(16).padStart(8,'0')}
function record(){const race={raceType:'NAR',raceDate:'2026-10-07',track:'川崎',raceNo:1,postTime:'15:00'},at=new Date(now).toISOString(),r={race,predictionSnapshot:{race:{...race},createdAt:at,generatedAt:at,horses:[{horseNo:1,abilityMark:'◎'},{horseNo:2,abilityMark:'',valueMark:'💎',supportReasons:['展開']} ]},marketSnapshot:{createdAt:at,horses:[{horseNo:1,odds:3},{horseNo:2,odds:20}]},finalSnapshot:{createdAt:at,top3:[{horseNo:1,mark:'◎'}]}};r.snapshotIntegrity={algorithm:'FNV-1a-32/canonical-json',sealedAt:at,hashes:Object.fromEntries(['predictionSnapshot','marketSnapshot','finalSnapshot'].map(k=>[k,hash(r[k])]))};return r}
const capture=options=>freezeNarEarlySnapshot({raceId,record:record(),now,freshAcquisition:true,...options});
test('fresh pre-post NAR capture clones and deeply freezes first version without KPI promotion',async()=>{
 const r=record(),before=structuredClone(r),x=await capture({record:r});assert.equal(x.status,'CREATED');assert.equal(x.snapshot.formalKpiEligible,false);assert.deepEqual(r,before);r.marketSnapshot.horses[0].odds=99;assert.equal(x.snapshot.data.marketSnapshot.horses[0].odds,3);assert.throws(()=>x.snapshot.data.marketSnapshot.horses[0].odds=88);assert.equal(x.snapshot.data.predictionSnapshot.horses[1].valueMark,'💎');
});
test('serialized first version is preserved despite later odds or result data',async()=>{
 const first=(await capture()).snapshot,existing=JSON.parse(JSON.stringify(first)),r=record();r.result={finishOrder:[1,2,3]};r.marketSnapshot.horses[0].odds=99;
 const x=await capture({record:r,existing,now:now+12*3600_000,freshAcquisition:false});assert.equal(x.status,'PRESERVED');assert.deepEqual(x.snapshot,first);
});
test('corrupted first version never falls forward to a valid new candidate',async()=>{
 const first=JSON.parse(JSON.stringify((await capture()).snapshot));first.data.marketSnapshot.horses[0].odds=99;const x=await capture({existing:first});assert.equal(x.status,'REJECTED');assert.equal(x.reason,'EARLY_CONTENT_MISMATCH');assert.equal(x.snapshot,null);
});
test('legacy records cannot be relabeled EARLY without fresh acquisition',async()=>{assert.equal((await capture({freshAcquisition:false})).reason,'FRESH_ACQUISITION_REQUIRED');assert.equal((await capture({now:now+61_000})).reason,'INITIAL_CAPTURE_WINDOW_INVALID')});
test('historical, post-result and post-time captures are rejected',async()=>{
 let r=record();r.race.historicalResearch=true;assert.equal((await capture({record:r})).reason,'HISTORICAL_REFERENCE_ONLY');r=record();r.resultSnapshot={};assert.equal((await capture({record:r})).reason,'RESULT_ALREADY_PRESENT');assert.equal((await capture({now:Date.parse('2026-10-07T06:00:00Z')})).reason,'NOT_PRE_POST');
});
test('unknown or invalid post dates and times fail closed',async()=>{for(const patch of [{postTime:''},{postTime:'25:00'},{raceDate:'2026-02-30'}]){const r=record();Object.assign(r.race,patch);Object.assign(r.predictionSnapshot.race,patch);const id=`${r.race.raceDate}|川崎|1`;assert.equal((await capture({record:r,raceId:id})).reason,'POST_TIME_UNVERIFIED')}});
test('mismatched source seal and missing seal are never repaired',async()=>{
 const r=record();r.marketSnapshot.horses[0].odds=99;assert.equal((await capture({record:r})).reason,'SOURCE_SNAPSHOT_MISMATCH');delete r.snapshotIntegrity;assert.equal((await capture({record:r})).reason,'SOURCE_SEAL_REQUIRED');
});
test('JRA and another race identity cannot enter the NAR contract',async()=>{const r=record();r.race.raceType='JRA';assert.equal((await capture({record:r})).reason,'NAR_IDENTITY_REQUIRED');assert.equal((await capture({raceId:'2026-10-07|川崎|2'})).reason,'NAR_IDENTITY_REQUIRED')});
test('read verifier rejects mismatched identity and unparseable stored first version',async()=>{const first=(await capture()).snapshot;assert.equal((await verifyNarEarlySnapshot(first,{raceId:'wrong'})).status,'REJECTED');assert.equal((await capture({existing:{}})).status,'REJECTED')});
test('future market timestamps and mixed runner identities are rejected',async()=>{
 let r=record();r.marketSnapshot.acquiredAt=new Date(now+1000).toISOString();r.snapshotIntegrity.hashes.marketSnapshot=hash(r.marketSnapshot);assert.equal((await capture({record:r})).reason,'SOURCE_LAYER_TIME_INVALID');
 r=record();r.finalSnapshot.top3[0].horseNo=99;assert.equal((await capture({record:r})).reason,'RUNNER_IDENTITY_INVALID');
});
