/** Explicit, default-OFF acquisition adapter. No implicit fetch, keys, trust provisioning or PRE admission. */
import {ATTESTATION_FORMAT,acquisitionSigningBytes} from './cpsi-acquisition-attestation-v1.mjs';
import {verifyCpsiProducerReceipt} from './cpsi-pre-producer-v1.mjs';
const flags={researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false,importable:false,productionActivationDecision:'NO-GO',originalEarlyMutation:false,productionWritePerformed:false};
const captures=new WeakMap(),MAX=1048576;
const fail=code=>{throw Object.assign(Error(code),{code});};
const denied=e=>({status:'HOLD',reason:e.code||'COLLECTOR_OPERATION_FAILED',...flags});
const off=()=>({status:'DISABLED',...flags});
const sha=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),n=>n.toString(16).padStart(2,'0')).join('');
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
function instant(s){
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))fail('COLLECTOR_POLICY_TIME');
 const t=Date.parse(s),z=s.slice(-6),offset=s.endsWith('Z')?0:(z[0]==='-'?-1:1)*(Number(z.slice(1,3))*60+Number(z.slice(4)))*60000;
 if(new Date(t+offset).toISOString().slice(0,19)!==s.slice(0,19))fail('COLLECTOR_POLICY_TIME');return t;
}
function https(s){let u;try{u=new URL(s);}catch{fail('COLLECTOR_SOURCE_URL');}if(typeof s!=='string'||s.length>2048||u.href!==s||u.protocol!=='https:'||u.username||u.password||u.hash)fail('COLLECTOR_SOURCE_URL');return s;}
function timestamp(clock){const n=clock();if(!Number.isFinite(n))fail('COLLECTOR_CLOCK');return n;}
async function policy(k,url,at){
 const keys=['collectorId','keyId','publicKeySpkiBase64','allowedSourceUrls','validFrom','validUntil','revoked'];
 if(!k||Object.keys(k).length!==keys.length||!keys.every(x=>Object.hasOwn(k,x))||![k.collectorId,k.keyId].every(x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x))||k.revoked!==false||!Array.isArray(k.allowedSourceUrls)||!k.allowedSourceUrls.length||k.allowedSourceUrls.length>16)fail('COLLECTOR_TRUST_POLICY');
 k.allowedSourceUrls.forEach(https);if(!k.allowedSourceUrls.includes(https(url)))fail('COLLECTOR_SOURCE_NOT_ALLOWED');
 if(at<instant(k.validFrom)||at>=instant(k.validUntil))fail('COLLECTOR_KEY_VALIDITY');
 let raw;try{raw=atob(k.publicKeySpkiBase64);}catch{fail('COLLECTOR_PUBLIC_KEY');}
 if(raw.length!==44||btoa(raw)!==k.publicKeySpkiBase64)fail('COLLECTOR_PUBLIC_KEY');
 return crypto.subtle.importKey('spki',Uint8Array.from(raw,c=>c.charCodeAt(0)),{name:'Ed25519'},false,['verify']);
}
async function deadline(operation,ms){
 if(!Number.isInteger(ms)||ms<100||ms>30000)fail('COLLECTOR_DEADLINE');
 const controller=new AbortController();let timer;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(Error('COLLECTOR_TIMEOUT'),{code:'COLLECTOR_TIMEOUT'}));},ms);});
 try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),timeout]);}finally{clearTimeout(timer);controller.abort();}
}
/** Supply a separately authorized key record and fetch adapter; no ambient network/authentication is used. */
export async function captureCollectorResponse(options={}){
 if(options.enabled!==true)return off();
 const {sourceUrl,key,fetchResponse,clock=Date.now,timeoutMs=10000}=options;
 try{
  if(typeof fetchResponse!=='function')fail('COLLECTOR_FETCH_REQUIRED');
  const pinned=structuredClone(key),started=timestamp(clock);await policy(pinned,sourceUrl,started);
  const bytes=await deadline(async signal=>{
   const response=await fetchResponse(sourceUrl,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal});
   if(response?.status!==200||response.redirected||response.url!==sourceUrl)fail('COLLECTOR_RESPONSE_IDENTITY');
   const length=response.headers?.get('content-length');if(length!=null&&(!/^\d+$/.test(length)||Number(length)>MAX))fail('COLLECTOR_RESPONSE_SIZE');
   if(!response.body?.getReader)fail('COLLECTOR_RESPONSE_BODY');
   if(signal.aborted)fail('COLLECTOR_TIMEOUT');
   const reader=response.body.getReader(),chunks=[];let size=0,done=false;
   const cancel=()=>{try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}};signal.addEventListener('abort',cancel,{once:true});
   try{
    for(;;){const part=await reader.read();if(signal.aborted)fail('COLLECTOR_TIMEOUT');if(part.done){done=true;break;}
     if(!(part.value instanceof Uint8Array))fail('COLLECTOR_RESPONSE_BODY');size+=part.value.length;if(size>MAX)fail('COLLECTOR_RESPONSE_SIZE');chunks.push(part.value.slice());
    }
   }finally{signal.removeEventListener('abort',cancel);if(!done)cancel();try{reader.releaseLock();}catch{}}
   if(!size)fail('COLLECTOR_RESPONSE_EMPTY');const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  },timeoutMs);
  const acquired=timestamp(clock);if(acquired<started||acquired-started>30000)fail('COLLECTOR_CAPTURE_TIME');await policy(pinned,sourceUrl,acquired);
  const handle=Object.freeze({}),record={key:pinned,sourceUrl,bytes,acquiredAt:new Date(acquired).toISOString(),providerBytesSha256:await sha(bytes)};captures.set(handle,record);
  return {status:'CAPTURED_RESEARCH_ONLY',...flags,handle,sourceBytes:bytes.slice(),acquiredAtClaim:record.acquiredAt,providerBytesSha256:record.providerBytesSha256,timeAuthority:'CALLER_CLOCK_NOT_INDEPENDENTLY_ATTESTED'};
 }catch(e){return denied(e);}
}
/** One-use same-process handle prevents signing a caller-replaced response or arbitrary historical blob. */
export async function signCollectorAcquisition(options={}){
 if(options.enabled!==true)return off();
 const {handle,receiptRaw,imageBytes,sign,clock=Date.now,timeoutMs=10000}=options;
 const record=captures.get(handle);if(record)captures.delete(handle);
 try{
  if(!record)fail('COLLECTOR_CAPTURE_HANDLE_REQUIRED');if(typeof sign!=='function')fail('COLLECTOR_SIGNER_REQUIRED');
  if(typeof receiptRaw!=='string'||new TextEncoder().encode(receiptRaw).length>1500000)fail('COLLECTOR_RECEIPT_SIZE');
  const receipt=JSON.parse(receiptRaw),now=timestamp(clock),input=receipt?.body?.artifact?.input;
  await verifyCpsiProducerReceipt(receipt,{now});
  const acquired=Date.parse(record.acquiredAt),observed=Date.parse(receipt.body.indexObservation.observedAt),post=Date.parse(input.postAt);
  if(now<acquired||now-acquired>60000||observed<acquired||observed-acquired>60000||now>=post)fail('COLLECTOR_PRE_TIME');
  const png=[137,80,78,71,13,10,26,10];if(!(imageBytes instanceof Uint8Array)||imageBytes.length<8||imageBytes.length>786432||png.some((v,i)=>imageBytes[i]!==v))fail('COLLECTOR_IMAGE');
  const publicKey=await policy(record.key,record.sourceUrl,now);
  const payload={collectorId:record.key.collectorId,sourceUrl:record.sourceUrl,requestMethod:'GET',httpStatus:200,acquiredAt:record.acquiredAt,signedAt:new Date(now).toISOString(),receiptContentHash:receipt.contentHash,sourceHash:receipt.body.artifact.contentHash,imageSha256:await sha(imageBytes),providerBytesSha256:record.providerBytesSha256,raceId:input.raceId,runId:input.runId};
  const envelope={format:ATTESTATION_FORMAT,algorithm:'Ed25519',keyId:record.key.keyId,payload},message=acquisitionSigningBytes(envelope);
  const signature=await deadline(()=>sign(message.slice()),timeoutMs);
  if(!(signature instanceof Uint8Array)||signature.length!==64||!await crypto.subtle.verify('Ed25519',publicKey,signature,message))fail('COLLECTOR_SIGNER_KEY_MISMATCH');
  const completed=timestamp(clock);if(completed<now||completed-acquired>60000||completed>=post)fail('COLLECTOR_SIGN_COMPLETED_LATE');await policy(record.key,record.sourceUrl,completed);
  return {status:'SIGNED_RESEARCH_ONLY',...flags,attestation:{...envelope,signatureBase64:b64(signature)},sourceBytes:record.bytes.slice(),signatureVerifiedAgainstPinnedKey:true,timeAuthority:'CALLER_CLOCK_NOT_INDEPENDENTLY_ATTESTED',providerContentParsed:false};
 }catch(e){return denied(e);}
}
