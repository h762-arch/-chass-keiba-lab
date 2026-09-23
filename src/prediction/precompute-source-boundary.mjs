function sourceTimeoutError(){
  const error=new Error('precompute_source_timeout');
  error.code='precompute_source_timeout';
  return error;
}

export function createPrecomputeSourceBoundary({
  loadSource,
  timeoutMs,
  setTimer=setTimeout,
  clearTimer=clearTimeout,
  AbortControllerImpl=AbortController
}={}){
  if(typeof loadSource!=='function')throw new Error('invalid_precompute_source_loader');
  if(typeof timeoutMs!=='number'||!Number.isFinite(timeoutMs)||timeoutMs<=0)throw new Error('invalid_precompute_source_timeout');
  if(typeof setTimer!=='function'||typeof clearTimer!=='function'||typeof AbortControllerImpl!=='function'){
    throw new Error('invalid_precompute_source_timer');
  }

  return function loadSourceWithinBoundary(job){
    const controller=new AbortControllerImpl();
    return new Promise((resolve,reject)=>{
      let settled=false,timer;
      function finish(value,isError){
        if(settled)return;
        settled=true;
        if(timer!==undefined)clearTimer(timer);
        if(isError)reject(value);
        else resolve(value);
      }
      try{
        const pending=loadSource(job,{signal:controller.signal});
        // Keep both handlers attached even if scheduling fails or the timeout fires.
        Promise.resolve(pending).then(value=>finish(value,false),error=>finish(error,true));
        timer=setTimer(()=>{
          if(settled)return;
          controller.abort();
          finish(sourceTimeoutError(),true);
        },timeoutMs);
      }catch(error){
        finish(error,true);
      }
    });
  };
}
