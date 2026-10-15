import {createHash} from 'node:crypto';
import {buildNarMaterialInvestigationPlan} from './nar-material-investigation-plan.mjs';
import {acceptNarMaterialDiagnostics} from './nar-material-diagnostic-acceptance.mjs';
import {reportNarMaterialConditions} from './nar-material-condition-report.mjs';
import {narStatusSourceUrl} from './nar-status-mirror-audit.mjs';

const flags={scope:'BOUNDED_PUBLIC_DIAGNOSTIC_READ_AND_ACCEPTANCE',researchOnly:true,formalKpiEligible:false,acquisitionCertified:false,currentStatusEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',diagnosisStatus:'NOT_ESTABLISHED',taskCompletion:'NOT_CLAIMED'};
const limit=1000000;
const clock=f=>{const n=f();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime()))throw Error('READ_CLOCK_INVALID');return n;};
const fail=reason=>{throw Error(reason);};

// One fixed-origin public GET, never a URL/credential taken from bundle content.
// The original bundle is cloned before awaiting IO to preserve the read target.
export async function readNarMaterialDiagnostics(bundle,{expectedDate,mode='CURRENT',wallNow=Date.now,fetchImpl=globalThis.fetch,timeoutMs=8000,includeConditionReport=false}={}){
 let started,reader,timer,controller,readAudit={status:'NOT_ATTEMPTED',requestCount:0};
 const hold=reason=>({...flags,status:'HOLD',reasonCodes:[reason],readAudit,acceptance:null,...(includeConditionReport?{conditionReport:null}:{})});
 const finish=(result,source,response,now)=>{
  if(!includeConditionReport)return result;
  if(result.status==='HOLD')return {...result,conditionReport:null};
  // Use the exact decoded response and pinned source, not a second GET or an
  // accepted projection. Recheck every report gate at the same completion clock.
  const conditionReport=reportNarMaterialConditions(source,response,{expectedDate,mode,now});
  return {...result,status:conditionReport.status,reasonCodes:[...conditionReport.reasonCodes],conditionReport};
 };
 try{
  if(typeof includeConditionReport!=='boolean'||typeof wallNow!=='function'||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)return hold('READ_CONFIGURATION_INVALID');
  started=clock(wallNow);const source=structuredClone(bundle);
  const plan=buildNarMaterialInvestigationPlan(source,{expectedDate,mode,now:started});
  if(!['PLAN_READY','HISTORICAL_PLAN_READY'].includes(plan.status))return hold('SOURCE_PLAN_HOLD');
  if(!plan.requests.length)return finish({...flags,status:'NO_DIAGNOSTIC_TASKS',reasonCodes:[],readAudit:{status:'NOT_REQUIRED',requestCount:0},acceptance:null},source,null,started);
  const sourceUrl=narStatusSourceUrl(expectedDate)+'&diagnostics=1';
  controller=new AbortController();readAudit={status:'STARTED',requestCount:1,sourceUrl,attemptedAt:new Date(started).toISOString(),timeoutMs,maxResponseBytes:limit,transportBasis:'FIXED_PUBLIC_ENDPOINT_GET'};
  const value=await Promise.race([
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('READ_TIMEOUT'));},timeoutMs);}),
   (async()=>{
    const r=await fetchImpl(sourceUrl,{method:'GET',headers:{accept:'application/json'},credentials:'omit',redirect:'manual',signal:controller.signal});
    if(controller.signal.aborted){void r?.body?.cancel().catch(()=>{});fail('READ_TIMEOUT');}
    if(!r||r.status!==200||r.redirected)fail('HTTP_UNAVAILABLE');
    if(!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))fail('CONTENT_TYPE_INVALID');
    if(Number(r.headers.get('content-length'))>limit)fail('RESPONSE_TOO_LARGE');
    if(!r.body)fail('BODY_UNAVAILABLE');
    reader=r.body.getReader();const parts=[];let bytes=0;
    for(;;){const item=await reader.read();if(controller.signal.aborted)fail('READ_TIMEOUT');if(item.done)break;bytes+=item.value.byteLength;if(bytes>limit)fail('RESPONSE_TOO_LARGE');parts.push(item.value);}
    const raw=new Uint8Array(bytes);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}
    let response;try{response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('RESPONSE_JSON_INVALID');}
    return {response,bytes,bytesSha256:createHash('sha256').update(raw).digest('hex')};
   })()
  ]);
  const finished=clock(wallNow);if(finished<started)fail('READ_CLOCK_INVALID');
  readAudit={...readAudit,status:'CAPTURED',finishedAt:new Date(finished).toISOString(),responseBytes:value.bytes,responseBytesSha256:value.bytesSha256};
  // Revalidate at completion, not at the pre-fetch clock. No stale fallback.
  const acceptance=acceptNarMaterialDiagnostics(source,value.response,{expectedDate,mode,now:finished});
  return finish({...flags,status:acceptance.status,reasonCodes:[...acceptance.reasonCodes],readAudit,acceptance},source,value.response,finished);
 }catch(e){
  const allowed=['READ_CLOCK_INVALID','READ_TIMEOUT','HTTP_UNAVAILABLE','CONTENT_TYPE_INVALID','RESPONSE_TOO_LARGE','BODY_UNAVAILABLE','RESPONSE_JSON_INVALID'];
  const reason=allowed.includes(e?.message)?e.message:'DIAGNOSTIC_READ_UNAVAILABLE';
  let finishedAt=null;try{const at=clock(wallNow);if(started!==undefined&&at>=started)finishedAt=new Date(at).toISOString();}catch{}
  readAudit={...readAudit,status:readAudit.requestCount?'FAILED':'NOT_ATTEMPTED',finishedAt,reasonCode:reason};return hold(reason);
 }finally{clearTimeout(timer);controller?.abort();if(reader)void reader.cancel().catch(()=>{});}
}
