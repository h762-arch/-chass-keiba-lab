import {discoverPrecomputeRaceJobs} from './precompute-job-discovery.mjs';
import {selectPrecomputeJobs} from './precompute-job-budget.mjs';
import {runBoundedPrecomputeJobs} from './precompute-execution-budget.mjs';

export async function runPrecomputePipeline({organization,meetings,maxJobs,deadline,now,runner}={}){
  const discoveredJobs=discoverPrecomputeRaceJobs(meetings);
  const selection=selectPrecomputeJobs({organization,jobs:discoveredJobs,maxJobs});
  const execution=await runBoundedPrecomputeJobs({
    organization,
    jobs:selection.selectedJobs,
    runner,
    deadline,
    now
  });
  return Object.freeze({
    organization,
    discoveredCount:discoveredJobs.length,
    selection,
    execution
  });
}
