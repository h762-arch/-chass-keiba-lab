import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {raceJobKey} from '../src/prediction/background-precompute.mjs';
import {selectPrecomputeJobs} from '../src/prediction/precompute-job-budget.mjs';

const job=(overrides={})=>{
  const base={organization:'JRA',date:'2026-09-20',track:'中山',raceNo:1},value={...base,...overrides};
  let raceId=overrides.raceId;
  if(raceId===undefined){try{raceId=raceJobKey(value)}catch{raceId='invalid-race-id'}}
  return {...value,raceId};
};
const select=(jobs,maxJobs,organization='JRA')=>selectPrecomputeJobs({organization,jobs,maxJobs});

test('maxJobs partitions canonical jobs and reports internally consistent counts',()=>{
  const result=select([job({raceNo:3}),job({raceNo:1}),job({raceNo:2})],2);
  assert.deepEqual(result.selectedJobs.map(x=>x.raceNo),[1,2]);
  assert.deepEqual(result.deferredJobs.map(x=>x.raceNo),[3]);
  assert.deepEqual({total:result.totalJobs,selected:result.selectedCount,deferred:result.deferredCount},{total:3,selected:2,deferred:1});
  assert.equal(result.selectedCount+result.deferredCount,result.totalJobs);
  assert.equal(result.selectedJobs.some(a=>result.deferredJobs.some(b=>a.raceId===b.raceId)),false);
});

test('equal and oversized maxJobs select every unique job',()=>{
  const jobs=[job({raceNo:1}),job({raceNo:2})];
  for(const maxJobs of [2,99,Number.MAX_SAFE_INTEGER]){
    const result=select(jobs,maxJobs);
    assert.equal(result.selectedCount,2);
    assert.equal(result.deferredCount,0);
  }
});

test('empty jobs and maxJobs zero have explicit composable results',()=>{
  assert.deepEqual(select([],0),{organization:'JRA',selectedJobs:[],deferredJobs:[],totalJobs:0,selectedCount:0,deferredCount:0});
  const zero=select([job({raceNo:2}),job({raceNo:1})],0);
  assert.deepEqual(zero.selectedJobs,[]);
  assert.deepEqual(zero.deferredJobs.map(x=>x.raceNo),[1,2]);
});

test('maxJobs must be an explicit finite non-negative safe integer',()=>{
  for(const maxJobs of [undefined,null,'1',true,-1,1.5,NaN,Infinity,-Infinity,Number.MAX_SAFE_INTEGER+1]){
    assert.throws(()=>select([job()],maxJobs),/invalid_precompute_max_jobs/);
  }
});

test('JRA and NAR select independently while mixed jurisdictions reject',()=>{
  assert.equal(select([job()],1).selectedJobs[0].organization,'JRA');
  const nar=job({organization:'NAR',track:'大井'});
  assert.equal(select([nar],1,'NAR').selectedJobs[0].organization,'NAR');
  assert.throws(()=>select([job(),nar],2),/precompute_job_organization_mismatch/);
  assert.throws(()=>select([nar],1),/precompute_job_organization_mismatch/);
  assert.throws(()=>select([job()],1,'XYZ'),/unsupported_precompute_job_organization/);
});

test('malformed descriptors and identity mismatches reject instead of being repaired',()=>{
  for(const value of [null,[],true])assert.throws(()=>select([value],1),/invalid_precompute_job_descriptor/);
  for(const patch of [
    {date:'2026-02-30'},{date:'2026/09/20'},{track:''},{track:12},{raceNo:0},{raceNo:13},{raceNo:true},{raceNo:' 1'},
    {raceId:''},{raceId:'20260920-JRA-中山-02'},{raceId:'20260920-jra-中山-01'}
  ])assert.throws(()=>select([job(patch)],1),/invalid_precompute_job|precompute_job_identity_mismatch/);
});

test('duplicates collapse before maxJobs and conflicting identity is rejected',()=>{
  const duplicate=job({raceNo:'01',track:' 中山 ',raceId:job().raceId}),result=select([job(),duplicate,job({raceNo:2})],1);
  assert.equal(result.totalJobs,2);
  assert.deepEqual(result.selectedJobs.map(x=>x.raceNo),[1]);
  assert.deepEqual(result.deferredJobs.map(x=>x.raceNo),[2]);
  assert.throws(()=>select([job(),job({track:'阪神',raceId:job().raceId})],2),/precompute_job_identity_mismatch/);
});

test('selection is deterministic across input ordering and uses date track raceNo raceId order',()=>{
  const jobs=[
    job({date:'2026-09-21',track:'中山',raceNo:1}),
    job({date:'2026-09-20',track:'阪神',raceNo:2}),
    job({date:'2026-09-20',track:'中山',raceNo:2}),
    job({date:'2026-09-20',track:'中山',raceNo:1})
  ];
  const first=select(jobs,1),second=select(jobs.toReversed(),1);
  assert.deepEqual(first,second);
  assert.equal(first.selectedJobs[0].raceId,'20260920-JRA-中山-01');
});

test('numeric race strings follow the existing identity boundaries',()=>{
  assert.equal(select([job({raceNo:'1'})],1).selectedJobs[0].raceNo,1);
  assert.equal(select([job({raceNo:'12'})],1).selectedJobs[0].raceNo,12);
  for(const raceNo of ['0','13'])assert.throws(()=>select([job({raceNo})],1),/invalid_precompute_job_race_no/);
});

test('outputs contain only canonical discovery fields and block payload leakage',()=>{
  const result=select([job({SOURCE:{horses:[1]},DATA:{score:1},MARKET:{odds:2},odds:2,popularity:1,snapshot:{},revision:9,unexpected:'secret'})],1);
  const selected=result.selectedJobs[0];
  assert.deepEqual(Object.keys(selected),['organization','date','track','raceNo','raceId']);
  for(const key of ['SOURCE','DATA','MARKET','odds','popularity','snapshot','revision','unexpected'])assert.equal(key in selected,false);
});

test('input remains unchanged and frozen inputs are supported',()=>{
  const input=Object.freeze([Object.freeze(job({raceNo:2})),Object.freeze(job({raceNo:1}))]),before=structuredClone(input);
  select(input,1);
  assert.deepEqual(input,before);
});

test('result, arrays and descriptors are immutable',()=>{
  const result=select([job({raceNo:1}),job({raceNo:2})],1);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.selectedJobs));
  assert.ok(Object.isFrozen(result.deferredJobs));
  assert.ok([...result.selectedJobs,...result.deferredJobs].every(Object.isFrozen));
  assert.throws(()=>result.selectedJobs.push(job({raceNo:3})),TypeError);
  assert.throws(()=>{result.deferredJobs[0].raceNo=9},TypeError);
});

test('budget module is pure, has no production defaults and remains runtime-disconnected',async()=>{
  const source=await readFile(new URL('../src/prediction/precompute-job-budget.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|DB|D1|env|process|Date\.now|performance\.now|setTimeout|setInterval|Math\.random|calculator|save|DEFAULT_MAX_JOBS|deadline|retry)\b/);
  const [worker,entry,discovery]=await Promise.all([
    readFile(new URL('../worker.js',import.meta.url),'utf8'),
    readFile(new URL('../worker-entry.mjs',import.meta.url),'utf8'),
    readFile(new URL('../src/prediction/precompute-job-discovery.mjs',import.meta.url),'utf8')
  ]);
  assert.doesNotMatch(worker,/precompute-job-budget/);
  assert.doesNotMatch(entry,/precompute-job-budget/);
  assert.doesNotMatch(discovery,/precompute-job-budget/);
});
