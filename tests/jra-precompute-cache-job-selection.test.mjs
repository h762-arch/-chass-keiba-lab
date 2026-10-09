import test from 'node:test';
import assert from 'node:assert/strict';
import {selectJraPrecomputeCacheJobs} from '../src/prediction/jra-precompute-cache-job-selection.mjs';
import {createPrecomputedIdentity} from '../src/prediction/precomputed-snapshot.mjs';

const date='2026-10-10';
const versions={calculationVersion:'jra-ability-data-v2',modelVersion:'10.0.1-jra-drive1-ability'};
const job=no=>Object.freeze({
 organization:'JRA',date,track:'東京',raceNo:no,
 raceId:`20261010-JRA-東京-${String(no).padStart(2,'0')}`
});
const source=candidate=>Object.freeze({
 organization:'JRA',raceId:candidate.raceId,
 race:{date,track:'東京',raceNo:candidate.raceNo},
 horses:[{horseNo:1,horseName:`fixture-${candidate.raceNo}`}]
});

async function calculatedSnapshot(candidate){
 const payload=source(candidate);
 const identity=await createPrecomputedIdentity({organization:'JRA',source:payload,versions});
 return Object.freeze({
  layers:Object.freeze({DATA:Object.freeze({ability:true})}),
  inputHash:identity.inputHash,
  calculationVersion:versions.calculationVersion,
  modelVersion:versions.modelVersion,
  sourceValidatedAt:'2026-10-10T00:00:00.000Z'
 });
}

test('selector rotation never lets a calculated revisit outrank an uncalculated job',async()=>{
 const jobs=[job(1),job(2)];
 const done=await calculatedSnapshot(jobs[1]);
 const result=await selectJraPrecomputeCacheJobs({
  jobs,maxJobs:1,selectionTurn:1,versions,
  loadFreshSource:async candidate=>source(candidate),
  readLatest:async candidate=>candidate.raceNo===2?done:null
 });
 assert.equal(result.selectedCount,1);
 assert.equal(result.selected[0].job.raceNo,1);
 assert.equal(result.selected[0].calculated,false);
 assert.equal(result.deferred[0].job.raceNo,2);
 assert.equal(result.deferred[0].calculated,true);
});

test('selection turn still rotates fairly inside the uncalculated priority bucket',async()=>{
 const jobs=[job(1),job(2),job(3),job(4)];
 const done=await calculatedSnapshot(jobs[3]);
 const picked=[];
 for(let turn=0;turn<3;turn++){
  const result=await selectJraPrecomputeCacheJobs({
   jobs,maxJobs:1,selectionTurn:turn,versions,
   loadFreshSource:async candidate=>source(candidate),
   readLatest:async candidate=>candidate.raceNo===4?done:null
  });
  assert.equal(result.selected[0].calculated,false);
  picked.push(result.selected[0].job.raceNo);
 }
 assert.deepStrictEqual(picked,[1,2,3]);
});
