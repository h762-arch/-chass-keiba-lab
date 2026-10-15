import {createHash} from 'node:crypto';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const STATUS_ORIGIN='https://chass-keiba-lab7.h7625421.workers.dev';
export const STATUS_BODY_LIMIT=100000;
const schemaVersion='chass-nar-status-snapshot-v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const dateJst=at=>new Date(at.getTime()+9*3600000).toISOString().slice(0,10);
const fail=reason=>{throw new Error(reason);};
export function validateNarStatusPayload(p,date){
 if(!p||p.ok!==true||p.date!==date||!Array.isArray(p.races)||p.races.length>500||typeof p.schemaReady!=='boolean')fail('PAYLOAD_INVALID');
 for(const key of ['researchOnly','formalKpiEligible','productionActivationReady'])if(typeof p[key]!=='boolean')fail('PAYLOAD_INVALID');
 if(p.schemaReady){
  if(!Number.isInteger(p.savedRaceCount)||p.savedRaceCount<0||p.savedRaceCount!==p.races.length||!Number.isInteger(p.rejectedRowCount)||p.rejectedRowCount<0||p.rejectedRowCount>500)fail('PAYLOAD_INVALID');
 }else if(p.savedRaceCount!==null||p.races.length!==0)fail('PAYLOAD_INVALID');
 return p;
}
async function capture(date,{fetchImpl,now,timeoutMs}){
 const sourceUrl=`${STATUS_ORIGIN}/api/chass/v1/public/nar-precompute-status?date=${date}&format=compact`,attemptedAt=now().toISOString(),controller=new AbortController();let timer,reader;
 try{
  const payload=await Promise.race([
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('FETCH_TIMEOUT'));},timeoutMs);}),
   (async()=>{
    const response=await fetchImpl(sourceUrl,{method:'GET',headers:{accept:'application/json'},redirect:'manual',signal:controller.signal});
    if(!response||response.status!==200||response.redirected)fail('HTTP_UNAVAILABLE');
    if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))fail('CONTENT_TYPE_INVALID');
    if(Number(response.headers.get('content-length'))>STATUS_BODY_LIMIT)fail('BODY_TOO_LARGE');
    if(!response.body)fail('BODY_UNAVAILABLE');
    reader=response.body.getReader();const parts=[];let bytes=0;
    for(;;){const item=await reader.read();if(item.done)break;bytes+=item.value.byteLength;if(bytes>STATUS_BODY_LIMIT)fail('BODY_TOO_LARGE');parts.push(item.value);}
    const raw=new Uint8Array(bytes);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}
    let p;try{p=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{fail('JSON_INVALID');}
    return validateNarStatusPayload(p,date);
   })()
  ]);
  const capturedAt=now().toISOString();
  return {schemaVersion,status:'CAPTURED',date,sourceUrl,attemptedAt,capturedAt,payloadSha256:hash(JSON.stringify(payload)),hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload};
 }catch(error){
  const allowed=['FETCH_TIMEOUT','HTTP_UNAVAILABLE','CONTENT_TYPE_INVALID','BODY_TOO_LARGE','BODY_UNAVAILABLE','JSON_INVALID','PAYLOAD_INVALID'];
  return {schemaVersion,status:'FAILED',date,sourceUrl,attemptedAt,finishedAt:now().toISOString(),reasonCode:allowed.includes(error?.message)?error.message:'FETCH_UNAVAILABLE',readOnlyCapture:true};
 }finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
async function atomicJson(file,value){
 const tmp=file+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8');await rename(tmp,file);}finally{await rm(tmp,{force:true});}
}
// This publisher writes only mirror output files; no production writer/DB port.
export async function publishNarStatusSnapshot({date,outputRoot='.',fetchImpl=globalThis.fetch,now=()=>new Date(),timeoutMs=15000}={}){
 const selected=date===undefined||date===''?dateJst(now()):date;
 if(!validDate(selected)||typeof outputRoot!=='string'||!outputRoot||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail('PUBLISH_CONFIGURATION_INVALID');
 const report=await capture(selected,{fetchImpl,now,timeoutMs}),relative=`chat-snapshot/status/${selected}`,root=path.resolve(outputRoot),dir=path.join(root,relative);
 await mkdir(dir,{recursive:true});
 const snapshotPath=`${relative}/nar-precompute-status.json`;
 if(report.status==='CAPTURED')await atomicJson(path.join(root,snapshotPath),report);
 const {payload,...attempt}=report;
 const index={...attempt,snapshotPath:report.status==='CAPTURED'?snapshotPath:null};
 await atomicJson(path.join(dir,'latest-attempt.json'),index);
 await atomicJson(path.join(root,'chat-snapshot/status/latest-attempt.json'),index);
 return {ok:report.status==='CAPTURED',status:report.status,date:selected,reasonCode:report.reasonCode||null,snapshotPath:index.snapshotPath,attemptPath:`${relative}/latest-attempt.json`};
}
export async function runNarStatusPublisherCli(args,env=process.env){
 if(args.length)fail('CLI_ARGUMENTS_UNSUPPORTED');
 return publishNarStatusSnapshot({date:env.SNAPSHOT_DATE,outputRoot:env.OUTPUT_ROOT||'.'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await runNarStatusPublisherCli(process.argv.slice(2))));}
 catch{console.error('NAR_STATUS_PUBLISH_FAILED');process.exitCode=1;}
}
