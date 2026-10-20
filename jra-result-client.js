(()=>{
'use strict';
window.CHASS_JRA_RESULT_CLIENT={create({isActive,getSelection,getGeneration,apply,formatFailure}){
 const button=document.getElementById('narSync'),status=document.getElementById('narStatus');
 let active=false,token=0,controller;
 const cancel=()=>{token++;controller?.abort();controller=null;if(active){button.disabled=false;button.textContent='JRA公式から結果取得・自動検証'}};
 async function load({silent=false}={}){
  cancel();if(!active||!isActive())return {ok:false};
  const own=token,generation=getGeneration(),selection=getSelection(),requestController=new AbortController();controller=requestController;
  const current=()=>own===token&&active&&isActive()&&generation===getGeneration();
  if(!silent){button.disabled=true;button.textContent='結果取得中…';status.textContent='JRA公式のレース結果を確認中…'}
  const timeout=setTimeout(()=>requestController.abort(),12000);
  try{
   const q=new URLSearchParams({date:selection.date,track:selection.track,race:String(selection.race)}),response=await fetch('/api/jra/result?'+q,{cache:'no-store',signal:requestController.signal});
   let data;try{data=await response.json()}catch{throw Object.assign(Error('JRA_RESULT_PARSE_ERROR'),{code:'JRA_RESULT_PARSE_ERROR',status:response.status})}
   if(!current())return {ok:false,stale:true};
   if(!response.ok||!data?.ok){const code=data?.errorCode||data?.error||'JRA_OFFICIAL_UNAVAILABLE';throw Object.assign(Error(code),{code,status:response.status})}
   if(!Array.isArray(data.finishOrder)||data.finishOrder.length<3||data.quality?.finishOrderCount<3)throw Object.assign(Error('JRA_RESULT_PARSE_ERROR'),{code:'JRA_RESULT_PARSE_ERROR'});
   apply(data,generation);status.textContent=`JRA公式結果 ${data.quality?.resultRows??data.results?.length??'—'}頭｜着順・実測TIME取得｜検証保存済み`;return {ok:true,data};
  }catch(error){
   if(!current())return {ok:false,stale:true};
   const code=error.name==='AbortError'?'JRA_FETCH_TIMEOUT':error.code||((error instanceof TypeError||error.name==='TypeError')?'network_error':error.message);
   if(!silent)status.textContent=typeof formatFailure==='function'?formatFailure({code,status:error.status||0}):code==='JRA_RESULT_BEFORE_POST'?'発走前のため結果取得を行いません。':code==='JRA_RESULT_UNPUBLISHED'?'JRA公式結果はまだ掲載されていません。':code==='JRA_RESULT_FETCH_DISABLED'?'JRA結果取得は現在OFFです。':`JRA結果取得エラー｜${code}`;
   return {ok:false,error:code};
  }finally{clearTimeout(timeout);if(own===token){controller=null;button.disabled=false;button.textContent='JRA公式から結果取得・自動検証'}}
 }
 return {load,cancel,setActive(value){active=value;if(!value)cancel();else{button.disabled=false;button.textContent='JRA公式から結果取得・自動検証';status.textContent='発走5分後からJRA公式結果を確認できます。'}}};
}};
})();
