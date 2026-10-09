// Node-only GET of preregistered immutable snapshots; never scrape or promote.
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
const guard=(v,r)=>{if(!v)throw Error(r)};
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const failure=reason=>({status:'HOLD',reason,readers:null,persisted:false,formalKpiEligible:false,adopted:false,productionActivationReady:false});
const receipt=(sourceRef,reasonCode,result='CONFLICT')=>({sourceRef,receipt:{result,reasonCode}});
function endpoint(value){
 const u=new URL(value);
 guard(u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&u.href===value&&!isIP(u.hostname.replace(/^\[|\]$/g,''))&&u.hostname!=='localhost'&&!u.hostname.endsWith('.localhost'),'HTTPS_ENDPOINT_REQUIRED');
 return u;
}
function abortable(promise,signal){
 return new Promise((resolve,reject)=>{
  const stop=()=>{cleanup();reject(Error('REQUEST_ABORTED'))},cleanup=()=>signal.removeEventListener('abort',stop);
  if(signal.aborted){Promise.resolve(promise).catch(()=>{});stop();return}
  signal.addEventListener('abort',stop,{once:true});
  Promise.resolve(promise).then(v=>{cleanup();resolve(v)},e=>{cleanup();reject(e)});
 });
}
export function createPredictionHttpsSnapshotReadersV2155({environment,allowedOrigins,bindings,authorizationByReader={},fetchImpl=globalThis.fetch}={}){
 try{
  guard(environment==='QUARANTINE','QUARANTINE_REQUIRED');
  guard(typeof fetchImpl==='function'&&Array.isArray(allowedOrigins)&&allowedOrigins.length>=1&&allowedOrigins.length<=4,'TRUSTED_HTTPS_ORIGINS_REQUIRED');
  const origins=new Set(allowedOrigins.map(o=>{const u=endpoint(o+'/');guard(u.origin===o,'TRUSTED_HTTPS_ORIGINS_REQUIRED');return o}));
  guard(Array.isArray(bindings)&&bindings.length>=1&&bindings.length<=4,'BOUNDED_HTTPS_BINDINGS_REQUIRED');
  const readers=Object.create(null),ids=new Set();
  for(const b of bindings){
   guard(b&&text(b.readerId)&&!ids.has(b.readerId)&&hex(b.planHash)&&hex(b.expectedSha256)&&Number.isInteger(b.expectedBytes)&&b.expectedBytes>=1&&b.expectedBytes<=50000&&Number.isInteger(b.maxRequestMs)&&b.maxRequestMs>=1&&b.maxRequestMs<=30000,'HTTPS_BINDING_REQUIRED');
   const u=endpoint(b.sourceRef);guard(origins.has(u.origin),'HTTPS_ORIGIN_NOT_ALLOWED');ids.add(b.readerId);
   const config=Object.freeze({...b}),authorization=authorizationByReader[b.readerId];
   guard(authorization===undefined||(text(authorization)&&!/[\r\n]/.test(authorization)),'AUTH_CONFIGURATION_INVALID');
   readers[b.readerId]=async({context,registration,signal}={})=>{
    if(context?.planHash!==config.planHash||registration?.readerId!==config.readerId||registration?.sourceRef!==config.sourceRef)return receipt(config.sourceRef,'HTTPS_READER_BINDING_MISMATCH');
    if(signal?.aborted)return receipt(config.sourceRef,'REQUEST_ABORTED');
    const controller=new AbortController(),stop=()=>controller.abort();let timedOut=false,reader,response;
    signal?.addEventListener('abort',stop,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort()},config.maxRequestMs);
    try{
     const headers={Accept:'application/json','Accept-Encoding':'identity'};
     if(authorization!==undefined)headers.Authorization=authorization;
     response=await abortable(fetchImpl(config.sourceRef,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',headers,signal:controller.signal}),controller.signal);
     guard(!response.redirected&&response.url===config.sourceRef,'SOURCE_ENDPOINT_CHANGED');
     if(response.status===404)return receipt(config.sourceRef,'REGISTERED_HTTPS_SNAPSHOT_NOT_FOUND','NOT_FOUND');
     guard(response.status!==401&&response.status!==403,'SOURCE_AUTH_REQUIRED');
     guard(response.status===200,'SOURCE_HTTP_STATUS_HOLD');
     guard(/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''),'SOURCE_CONTENT_TYPE_INVALID');
     const encoding=response.headers.get('content-encoding');guard(!encoding||encoding.toLowerCase()==='identity','SOURCE_ENCODING_UNSUPPORTED');
     const length=response.headers.get('content-length');guard(length===null||(/^[0-9]+$/.test(length)&&Number(length)===config.expectedBytes),'SOURCE_SIZE_MISMATCH');
     guard(response.body&&typeof response.body.getReader==='function','SOURCE_BODY_REQUIRED');
     reader=response.body.getReader();const chunks=[];let count=0;
     for(;;){const {done,value}=await abortable(reader.read(),controller.signal);if(done)break;guard(value instanceof Uint8Array,'SOURCE_BODY_INVALID');count+=value.byteLength;guard(count<=config.expectedBytes,'SOURCE_SIZE_MISMATCH');chunks.push(Buffer.from(value))}
     guard(count===config.expectedBytes,'SOURCE_SIZE_MISMATCH');
     const raw=Buffer.concat(chunks),sha=createHash('sha256').update(raw).digest('hex');guard(sha===config.expectedSha256,'SOURCE_BYTE_HASH_MISMATCH');
     const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
     guard(snapshot?.sourceRef===config.sourceRef&&Object.hasOwn(snapshot,'payload')&&snapshot.payload!==null&&text(snapshot.sourceSnapshotId),'SOURCE_ENVELOPE_INVALID');
     for(const k of ['runId','raceId','eligibilityId','fieldId','scopeKey'])guard(snapshot[k]===context[k],'SOURCE_IDENTITY_MISMATCH');
     guard(snapshot.sourceStage==='EARLY'&&snapshot.identityStatus==='PASS'&&snapshot.sourceLineage==='PASS'&&snapshot.leakageGuard==='PASS','SOURCE_PROVENANCE_INVALID');
     guard(!controller.signal.aborted,'REQUEST_ABORTED');
     const found={result:'FOUND'};
     for(const k of ['sourceSnapshotId','runId','raceId','eligibilityId','fieldId','scopeKey','sourceStage','identityStatus','sourceLineage','leakageGuard','capturedAt','dataAsOf','value'])found[k]=snapshot[k];
     return {sourceRef:config.sourceRef,receipt:found,sourceSnapshot:{...snapshot,httpsReadEvidence:{bodySha256:sha,bodyBytes:count,rawBase64:raw.toString('base64'),contentEncoding:'identity',httpStatus:200,receivedAt:new Date().toISOString()}}};
    }catch(e){
     const reasons=['SOURCE_ENDPOINT_CHANGED','SOURCE_AUTH_REQUIRED','SOURCE_HTTP_STATUS_HOLD','SOURCE_CONTENT_TYPE_INVALID','SOURCE_ENCODING_UNSUPPORTED','SOURCE_SIZE_MISMATCH','SOURCE_BODY_REQUIRED','SOURCE_BODY_INVALID','SOURCE_BYTE_HASH_MISMATCH','SOURCE_ENVELOPE_INVALID','SOURCE_IDENTITY_MISMATCH','SOURCE_PROVENANCE_INVALID','REQUEST_ABORTED'];
     return receipt(config.sourceRef,timedOut?'HTTPS_REQUEST_TIMEOUT':controller.signal.aborted?'REQUEST_ABORTED':reasons.includes(e?.message)?e.message:'HTTPS_SOURCE_READ_INVALID');
    }finally{
     clearTimeout(timer);signal?.removeEventListener('abort',stop);controller.abort();
     // Cancellation may itself be uncooperative; do not hold up the terminal receipt.
     try{
      if(reader){Promise.resolve(reader.cancel()).catch(()=>{});reader.releaseLock()}
      else if(response?.body)Promise.resolve(response.body.cancel()).catch(()=>{});
     }catch{} // Cleanup errors must not turn a safe terminal receipt into a throw.
    }
   };
  }
  return Object.freeze({status:'READERS_READY',readers:Object.freeze(readers),assessmentOnly:true,persisted:false,formalKpiEligible:false,adopted:false,productionActivationReady:false});
 }catch(e){return failure(['QUARANTINE_REQUIRED','TRUSTED_HTTPS_ORIGINS_REQUIRED','HTTPS_ENDPOINT_REQUIRED','HTTPS_ORIGIN_NOT_ALLOWED','BOUNDED_HTTPS_BINDINGS_REQUIRED','HTTPS_BINDING_REQUIRED','AUTH_CONFIGURATION_INVALID'].includes(e?.message)?e.message:'HTTPS_READER_SETUP_FAILED')}
}
