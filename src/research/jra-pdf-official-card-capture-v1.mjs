// Explicit Node research capture only. No Cron, app, Drive, DB or Freeze writes.
import {createHash} from 'node:crypto';
import {buildJraPdfOfficialCardEvidence} from './jra-pdf-official-card-evidence-v1.mjs';
const fail=r=>{throw new TypeError(r);};
function cardUrl(value) {
 let u;try{u=new URL(value);}catch{fail('OFFICIAL_CAPTURE_URL_INVALID');}
 if(u.origin!=='https://www.jra.go.jp'||u.pathname!=='/JRADB/accessD.html'||u.username||u.password||u.hash)fail('OFFICIAL_CAPTURE_URL_INVALID');
 return u.href;
}
function timestamp(clock) {
 const v=clock();if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))fail('OFFICIAL_CAPTURE_CLOCK_INVALID');return v;
}
export async function captureJraPdfOfficialCard({pdfInput,sourceUrl,fetchImpl=globalThis.fetch,clock=()=>new Date().toISOString(),timeoutMs=10000,maxBytes=1000000}={}) {
 const url=cardUrl(sourceUrl);
 if(typeof fetchImpl!=='function'||typeof clock!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1000000)fail('OFFICIAL_CAPTURE_LIMIT_INVALID');
 const startedAt=timestamp(clock),controller=new AbortController();let reader,timer;
 const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new TypeError('OFFICIAL_CAPTURE_DEADLINE'));},timeoutMs);});
 try {
  return await Promise.race([expired,(async()=>{
   const response=await fetchImpl(url,{method:'GET',redirect:'manual',signal:controller.signal});
   if(controller.signal.aborted){if(response.body)void response.body.cancel().catch(()=>{});fail('OFFICIAL_CAPTURE_DEADLINE');}
   if(!response.ok||response.status!==200||response.redirected)fail('OFFICIAL_CAPTURE_HTTP_REJECTED');
   if(response.url&&cardUrl(response.url)!==url)fail('OFFICIAL_CAPTURE_RESPONSE_URL_CONFLICT');
   const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>maxBytes))fail('OFFICIAL_CAPTURE_SIZE_LIMIT');
   if(!response.body?.getReader)fail('OFFICIAL_CAPTURE_STREAM_REQUIRED');
   reader=response.body.getReader();const chunks=[];let size=0;
   while(true){const next=await reader.read();if(controller.signal.aborted)fail('OFFICIAL_CAPTURE_DEADLINE');if(next.done)break;
    if(!(next.value instanceof Uint8Array))fail('OFFICIAL_CAPTURE_BODY_INVALID');size+=next.value.byteLength;if(size>maxBytes)fail('OFFICIAL_CAPTURE_SIZE_LIMIT');chunks.push(Buffer.from(next.value));}
   if(controller.signal.aborted)fail('OFFICIAL_CAPTURE_DEADLINE');
   const raw=Buffer.concat(chunks),capturedAt=timestamp(clock),observedAt=timestamp(clock);
   if(Date.parse(capturedAt)<Date.parse(startedAt)||Date.parse(observedAt)<Date.parse(capturedAt)||Date.parse(observedAt)-Date.parse(startedAt)>timeoutMs)fail('OFFICIAL_CAPTURE_CLOCK_INVALID');
   const type=response.headers.get('content-type')||'';
   if(!/^text\/html\b/i.test(type))fail('OFFICIAL_CAPTURE_CONTENT_TYPE_INVALID');
   const headerCharset=type.match(/charset\s*=\s*["']?([^\s;"']+)/i)?.[1];
   const metaCharset=raw.subarray(0,4096).toString('latin1').match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
   const normalize=v=>/^(shift[_-]?jis|sjis|windows-31j)$/i.test(v||'')?'shift_jis':/^utf-?8$/i.test(v||'')?'utf-8':null;
   const encoding=normalize(headerCharset||metaCharset);
   if(!encoding||headerCharset&&metaCharset&&normalize(headerCharset)!==normalize(metaCharset))fail('OFFICIAL_CAPTURE_ENCODING_INVALID');
   let html;try{html=new TextDecoder(encoding,{fatal:true}).decode(raw);}catch{fail('OFFICIAL_CAPTURE_DECODE_INVALID');}
   const evidence=buildJraPdfOfficialCardEvidence({pdfInput,html,sourceUrl:url,capturedAt,nowAt:observedAt,maxAgeMs:timeoutMs});
   return {schemaVersion:'JRA_PDF_OFFICIAL_CAPTURE_V1',capture:{sourceUrl:url,startedAt,capturedAt,observedAt,encoding,byteLength:size,rawSha256:createHash('sha256').update(raw).digest('hex'),timingProof:'PROCESS_CLOCK_UNAUTHENTICATED'},evidence,
    researchOnly:true,formalKpiEligible:false,productionActivationReady:false,freezeMutation:'NONE'};
  })()]);
 } finally {
  clearTimeout(timer);controller.abort();
  // Cancellation must not itself extend the capture deadline.
  if(reader)void reader.cancel().catch(()=>{});
 }
}
