import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ORIGIN='https://chass-keiba-lab7.h7625421.workers.dev';
export const BASE='065852fa52e1a3c27492e0f8f045835406747fef';
const expectedBlobs={'app.js':'45be5ab821ac0d0faa653e96380891c90f1e04df','index.html':'1485f7e958f269633e65a0bfc737ee85b0656287'};
const gates={formalKpi:'HOLD',probability:'MODEL_HOLD',production:'NO-GO'};
const hash=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest('hex');
const blobHash=b=>createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const canonical=x=>JSON.stringify(x,(_key,value)=>object(value)?Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]])):value);
const key=x=>JSON.stringify([x?.raceId,x?.modelVersion]);
const identity=x=>typeof x?.raceId==='string'&&x.raceId.trim()!==''&&typeof x?.modelVersion==='string'&&x.modelVersion.trim()!=='';
const instant=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
const finalProjection=x=>object(x)&&(x.status==='frozen'||x.warningFrozenAt)?x:null;

// A narrow byte/structure comparison of supplied captures. Never a runtime acceptance gate.
export function compareFrozenCaptures(input){
 const result={schema:'chass-frozen-capture-report-v1',gates,provenance:'SUPPLIED_CAPTURE_NOT_AUTHENTICATED',scope:'predictionSnapshot_frozen_market_signal_and_frozen_final',status:'INVALID',issues:[],targets:[]};
 if(!object(input)||input.schema!=='chass-cloud-sync-capture-v1'||input.origin!==ORIGIN||input.sourceCommit!==BASE||!Array.isArray(input.targets)||!input.targets.length||input.targets.length>250||!Array.isArray(input.captures)||input.captures.length>1000){result.issues.push('INVALID_ENVELOPE');return result;}
 const seen=new Set();
 for(const t of input.targets){if(!identity(t)||seen.has(key(t))){result.issues.push('INVALID_OR_DUPLICATE_TARGET');return result;}seen.add(key(t));}
 const sources=new Set(['device-before','device-after','d1-before','d1-after']);
 for(const c of input.captures){if(!identity(c)||!seen.has(key(c))||!sources.has(c.source)||!instant(c.capturedAt)||!object(c.record)){result.issues.push('INVALID_OR_UNBOUND_CAPTURE');return result;}}
 for(const target of input.targets){
  const issues=[],rows=input.captures.filter(c=>key(c)===key(target)),groups=new Map();
  for(const c of rows){const list=groups.get(c.source)||[];list.push(c);groups.set(c.source,list);}
  for(const source of sources)if((groups.get(source)||[]).length!==1)issues.push('MISSING_OR_DUPLICATE_'+source.toUpperCase().replaceAll('-','_'));
  if(!issues.length){
   for(const c of rows){const p=c.record.predictionSnapshot;if(!object(p)||!Array.isArray(p.horses)||!p.horses.length||p.raceId!==target.raceId||p.modelVersion!==target.modelVersion||c.record.modelVersion!==target.modelVersion||c.record.raceId!==target.raceId||![c.record.marketSnapshot,c.record.finalSnapshot].every(x=>x===null||object(x)))issues.push('SNAPSHOT_IDENTITY_OR_CONTENT_INVALID');}
   if(!issues.length)for(const source of ['device','d1']){
    const a=groups.get(source+'-before')[0],b=groups.get(source+'-after')[0];
    if(Date.parse(a.capturedAt)>Date.parse(b.capturedAt))issues.push(source.toUpperCase()+'_CAPTURE_TIME_REVERSED');
    if(canonical(a.record.predictionSnapshot)!==canonical(b.record.predictionSnapshot))issues.push(source.toUpperCase()+'_ORIGINAL_CHANGED');
    const frozen=finalProjection(a.record.finalSnapshot);
    if(frozen&&canonical(frozen)!==canonical(finalProjection(b.record.finalSnapshot)))issues.push(source.toUpperCase()+'_FROZEN_FINAL_CHANGED');
    const signal=finalProjection(a.record.marketSnapshot?.signalSnapshot);
    if(signal&&canonical(signal)!==canonical(finalProjection(b.record.marketSnapshot?.signalSnapshot)))issues.push(source.toUpperCase()+'_FROZEN_MARKET_SIGNAL_CHANGED');
   }
  }
  const device=groups.get('device-after')?.[0]?.record.predictionSnapshot,cloud=groups.get('d1-after')?.[0]?.record.predictionSnapshot;
  result.targets.push({raceId:target.raceId,modelVersion:target.modelVersion,status:issues.length?'HOLD':'SUPPLIED_ORIGINALS_UNCHANGED',deviceCloudOriginalMatch:device&&cloud?canonical(device)===canonical(cloud):null,issues});
 }
 result.status=result.targets.some(t=>t.status==='HOLD')?'HOLD':'COMPARISON_COMPLETE';
 result.unverified=['capture_authenticity','worker_deployment_revision','partial_success_accounting','request_deduplication','hold_persistence','source_ledger','formal_early_readiness'];
 return result;
}

async function boundedGet(url,fetchImpl){
 const controller=new AbortController();let timer;
 try{return await Promise.race([(async()=>{
  const response=await fetchImpl(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{accept:'*/*','cache-control':'no-cache'}});
  if(!response.ok)throw Error('HTTP_'+response.status);
  if(Number(response.headers.get('content-length'))>2_000_000)throw Error('BODY_TOO_LARGE');
  if(!response.body)throw Error('BODY_MISSING');
  const reader=response.body.getReader(),chunks=[];let count=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>2_000_000)throw Error('BODY_TOO_LARGE');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return {bytes:Buffer.concat(chunks),status:response.status,contentType:response.headers.get('content-type')||''};
 })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('TIMEOUT'),{name:'AbortError'}));},15000);})]);
 }finally{clearTimeout(timer);}
}

export async function probeRuntime({sourceDir,fetchImpl=fetch,readImpl=readFile}={}){
 const report={schema:'chass-runtime-probe-v1',origin:ORIGIN,expectedSourceCommit:BASE,startedAt:new Date().toISOString(),gates,checks:[],workerRevision:'UNVERIFIED',deviceEvidence:'UNVERIFIED',dbRecordComparison:'UNVERIFIED'};
 const assets=[];
 // Validate ALL local reference bytes before contacting production.
 for(const [path,expected] of Object.entries(expectedBlobs)){
  let bytes;try{bytes=Buffer.from(await readImpl(resolve(sourceDir||'.',path)));}catch{report.checks.push({path,status:'LOCAL_SOURCE_UNAVAILABLE'});}
  if(bytes){const actual=blobHash(bytes);if(actual!==expected)report.checks.push({path,status:'LOCAL_SOURCE_NOT_PR265',expectedBlob:expected,actualBlob:actual});else assets.push({path,bytes});}
 }
 if(assets.length!==2){report.status='LOCAL_REFERENCE_INVALID';return report;}
 for(const asset of assets){try{const live=await boundedGet(ORIGIN+'/'+asset.path,fetchImpl),actual=hash(live.bytes),expected=hash(asset.bytes);report.checks.push({path:asset.path,status:actual===expected?'MATCH':'MISMATCH',expectedSha256:expected,actualSha256:actual,bytes:live.bytes.length});}catch(e){report.checks.push({path:asset.path,status:'UNAVAILABLE',reason:safeError(e)});}}
 for(const path of ['/api/chass/v1/public/health','/api/db/health']){
  try{const response=await boundedGet(ORIGIN+path,fetchImpl),data=JSON.parse(response.bytes.toString('utf8'));
   const valid=object(data)&&data.ok===true&&(path.includes('/public/')?data.database===true&&data.version==='10.0.1'&&data.mode==='read-only':data.database==='connected');
   report.checks.push({path,status:valid?'HEALTH_CONTRACT_OK':'HEALTH_CONTRACT_INVALID'});
  }catch(e){report.checks.push({path,status:'UNAVAILABLE',reason:safeError(e)});}
 }
 report.completedAt=new Date().toISOString();report.status=report.checks.every(c=>['MATCH','HEALTH_CONTRACT_OK'].includes(c.status))?'READ_ONLY_PROBES_COMPLETE':'HOLD';
 return report;
}
function safeError(e){const message=String(e?.message||'');return /^HTTP_\d{3}$|^BODY_TOO_LARGE$|^BODY_MISSING$/.test(message)?message:e?.name==='AbortError'?'TIMEOUT':'REQUEST_OR_RESPONSE_FAILED';}

export async function main(args){
 if(args.length===2&&args[0]==='--probe-source')return probeRuntime({sourceDir:args[1]});
 if(args.length===2&&args[0]==='--captures'){
  try{const bytes=await readFile(args[1]);if(bytes.length>16_000_000)throw Error();return {...compareFrozenCaptures(JSON.parse(bytes.toString('utf8'))),inputSha256:hash(bytes)};}catch{return {status:'INVALID_INPUT',gates};}
 }
 return {status:'USAGE',usage:['node scripts/audit-cloud-sync-runtime-v1.mjs --probe-source .','node scripts/audit-cloud-sync-runtime-v1.mjs --captures private-capture.json'],gates};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const report=await main(process.argv.slice(2));process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=['READ_ONLY_PROBES_COMPLETE','COMPARISON_COMPLETE'].includes(report.status)?0:2;}
