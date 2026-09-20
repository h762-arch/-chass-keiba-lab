import {runPrecomputePipeline} from './precompute-pipeline.mjs';

export function createPrecomputeRuntimeRunner({
  organization,
  loadMeetings,
  maxJobs,
  deadline,
  now,
  raceRunner,
  pipeline=runPrecomputePipeline
}={}){
  if(typeof loadMeetings!=='function')throw new Error('invalid_precompute_meeting_provider');
  if(typeof raceRunner!=='function')throw new Error('invalid_precompute_race_runner');
  if(typeof pipeline!=='function')throw new Error('invalid_precompute_pipeline');

  return async function precomputeRuntimeRunner(){
    const meetings=await loadMeetings({organization});
    return pipeline({
      organization,
      meetings,
      maxJobs,
      deadline,
      now,
      runner:raceRunner
    });
  };
}
