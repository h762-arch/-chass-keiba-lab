import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFileSync,statSync} from 'node:fs';
import {auditNarStatusMirror,validMirrorDate,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';

const repo='h762-arch/-chass-keiba-lab',readLimit=1000000;
async function jsonGet(url,fetchImpl,timeoutMs){
 const controller=new AbortController();let reader,timer;
 try{return await Promise.race([
  new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('READ_TIMEOUT'));},timeoutMs);}),
  (async()=>{
   const r=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'manual',signal:controller.signal});
   if(!r||r.status!==200||r.redirected||!r.body||Number(r.headers.get('content-length'))>readLimit)throw Error('READ_UNAVAILABLE');
   reader=r.body.getReader();const parts=[];let n=0;
   for(;;){const item=await reader.read();if(item.done)break;n+=item.value.byteLength;if(n>readLimit)throw Error('READ_LIMIT');parts.push(item.value);}
   const bytes=new Uint8Array(n);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  })()
 ]);}finally{clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}
// Resolve the data ref ONCE. Every subsequent content URL is pinned to that SHA.
export async function readAndAuditNarStatusMirror({expectedDate,now=Date.now(),fetchImpl=globalThis.fetch,timeoutMs=8000}={}){
 const fail=reason=>({scope:'MIRROR_INTEGRITY_FRESHNESS_AND_READINESS_ONLY',status:'HOLD',reasonCodes:[reason],acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
 if(!validMirrorDate(expectedDate)||!Number.isFinite(now)||typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)return fail('AUDIT_CONFIGURATION_INVALID');
 try{
  const branch=await jsonGet(`https://api.github.com/repos/${repo}/branches/chass-data`,fetchImpl,timeoutMs),commitSha=branch?.commit?.sha;
  if(typeof commitSha!=='string'||!/^[a-f0-9]{40}$/.test(commitSha))return fail('DATA_REF_INVALID');
  const raw=p=>`https://raw.githubusercontent.com/${repo}/${commitSha}/${p}`;
  const [attempt,manifest]=await Promise.all([jsonGet(raw('chat-snapshot/status/latest-attempt.json'),fetchImpl,timeoutMs),jsonGet(raw('manifest.json'),fetchImpl,timeoutMs)]);
  // Never follow a snapshotPath supplied by remote content or fetch an old row
  // on failure. The only permitted target is the expected date's fixed path.
  const snapshot=attempt?.status==='CAPTURED'&&attempt.date===expectedDate&&attempt.snapshotPath===narStatusSnapshotPath(expectedDate)?await jsonGet(raw(narStatusSnapshotPath(expectedDate)),fetchImpl,timeoutMs):null;
  return {...auditNarStatusMirror({expectedDate,commitSha,attempt,snapshot,manifest,now}),sourceReferenceBasis:'GITHUB_BRANCH_RESOLVED'};
 }catch{return fail('GITHUB_READ_UNAVAILABLE');}
}
export async function runNarStatusMirrorAuditCli(args,{now=Date.now(),fetchImpl=globalThis.fetch}={}){
 if((args.length===2||args.length===4)&&args[0]==='--bundle'&&(args.length===2||args[2]==='--date')){
  const hold=reason=>({scope:'MIRROR_INTEGRITY_FRESHNESS_AND_READINESS_ONLY',sourceReferenceBasis:'DECLARED_LOCAL_BUNDLE',status:'HOLD',reasonCodes:[reason],acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
  if(!Number.isFinite(now)||!Number.isFinite(new Date(now).getTime()))return hold('AUDIT_CONFIGURATION_INVALID');
  const expectedDate=args.length===4?args[3]:new Date(now+9*3600000).toISOString().slice(0,10);
  if(!validMirrorDate(expectedDate))return hold('AUDIT_CONFIGURATION_INVALID');
  try{
   if(!statSync(args[1]).isFile()||statSync(args[1]).size>readLimit)return hold('BUNDLE_READ_UNAVAILABLE');
   const bytes=readFileSync(args[1]);if(bytes.byteLength>readLimit)return hold('BUNDLE_READ_UNAVAILABLE');
   const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
   return {...auditNarStatusMirror({expectedDate,commitSha:b.commitSha,attempt:b.attempt,snapshot:b.snapshot,manifest:b.manifest,now}),sourceReferenceBasis:'DECLARED_LOCAL_BUNDLE'};
  }catch{return hold('BUNDLE_READ_UNAVAILABLE');}
 }
 const expectedDate=args.length===0?new Date(now+9*3600000).toISOString().slice(0,10):args.length===2&&args[0]==='--date'?args[1]:null;
 return readAndAuditNarStatusMirror({expectedDate,now,fetchImpl});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const result=await runNarStatusMirrorAuditCli(process.argv.slice(2));process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode=result.status==='VERIFIED'?0:1;}
