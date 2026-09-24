import {createJraPrecomputeSourceLoader} from './jra-precompute-source-loader.mjs';
import {createPrecomputeSourceBoundary} from './precompute-source-boundary.mjs';
import {createPrecomputeRaceRunnerAdapter} from './precompute-race-runner-adapter.mjs';

export function createJraPrecomputeRaceRunner({
  fetchImpl,
  sourceTimeoutMs,
  now,
  calculate,
  loadLatest,
  save,
  versions,
  cryptoImpl,
  setTimer,
  clearTimer,
  AbortControllerImpl
}={}){
  const isolatedSourceLoader=createJraPrecomputeSourceLoader({fetchImpl,now});
  const boundaryOptions={loadSource:isolatedSourceLoader,timeoutMs:sourceTimeoutMs};
  if(setTimer!==undefined)boundaryOptions.setTimer=setTimer;
  if(clearTimer!==undefined)boundaryOptions.clearTimer=clearTimer;
  if(AbortControllerImpl!==undefined)boundaryOptions.AbortControllerImpl=AbortControllerImpl;
  const loadSource=createPrecomputeSourceBoundary(boundaryOptions);
  return createPrecomputeRaceRunnerAdapter({
    loadSource,calculate,loadLatest,save,versions,now,cryptoImpl
  });
}
