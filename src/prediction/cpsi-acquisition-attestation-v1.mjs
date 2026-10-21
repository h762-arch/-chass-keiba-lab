/** Verify independently provisioned collector signatures. Never grants formal PRE/KPI admission. */
import {verifyIndexEvidence} from './cpsi-index-evidence-v1.mjs';
import {stableSourceJson} from './cpsi-source-recovery-v1.mjs';
export const ATTESTATION_FORMAT='CHASS_CPSI_ACQUISITION_ATTESTATION_V1';
export const TRUST_FORMAT='CHASS_CPSI_COLLECTOR_TRUST_V1';
const flags={researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false,importable:false,productionActivationDecision:'NO-GO',originalEarlyMutation:false};
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const text=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
function time(s){
 if(typeof s!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(s)||!Number.isFinite(Date.parse(s)))fail('ATTESTATION_TIME_INVALID');
 const epoch=Date.parse(s),zone=s.slice(-6),offset=s.endsWith('Z')?0:(zone[0]==='-'?-1:1)*(Number(zone.slice(1,3))*60+Number(zone.slice(4)))*60000;
 if(new Date(epoch+offset).toISOString().slice(0,19)!==s.slice(0,19))fail('ATTESTATION_TIME_INVALID');return epoch;
}
function url(s){let u;try{u=new URL(s);}catch{fail('ATTESTATION_URL_INVALID');}if(typeof s!=='string'||s.length>2048||u.href!==s||u.protocol!=='https:'||u.username||u.password||u.hash)fail('ATTESTATION_URL_INVALID');return s;}
function base64(s,size){
 if(typeof s!=='string'||s.length>512||s.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))fail('ATTESTATION_KEY_OR_SIGNATURE_ENCODING');
 let raw;try{raw=atob(s);}catch{fail('ATTESTATION_KEY_OR_SIGNATURE_ENCODING');}
 if(raw.length!==size||btoa(raw)!==s)fail('ATTESTATION_KEY_OR_SIGNATURE_ENCODING');return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');}
export function acquisitionSigningBytes({keyId,payload}){
 return new TextEncoder().encode(ATTESTATION_FORMAT+'\n'+stableSourceJson({keyId,payload}));
}
/** trustPolicy must come from an authorized out-of-band source, NEVER from the evidence packet. */
export async function verifyAcquisitionAttestation({enabled=false,archive,attestation,trustPolicy,sourceBytes,now=Date.now()}={}){
 const denied=(status,reason)=>({status,reason,collectorSignatureVerified:false,...flags});
 if(enabled!==true)return denied('DISABLED','ACQUISITION_ATTESTATION_DISABLED');
 try{
  if(!attestation)return denied('HOLD','SIGNED_ACQUISITION_RECEIPT_MISSING');
  if(!trustPolicy)return denied('HOLD','APPROVED_COLLECTOR_TRUST_MISSING');
  if(!Number.isFinite(now))fail('ATTESTATION_CLOCK_INVALID');
  if(!exact(trustPolicy,['format','collectors'])||trustPolicy.format!==TRUST_FORMAT||!Array.isArray(trustPolicy.collectors)||!trustPolicy.collectors.length||trustPolicy.collectors.length>16)fail('ATTESTATION_TRUST_SCHEMA');
  const ids=new Set();
  for(const key of trustPolicy.collectors){
   if(!exact(key,['collectorId','keyId','publicKeySpkiBase64','allowedSourceUrls','validFrom','validUntil','revoked'])||!text(key.collectorId)||!text(key.keyId)||ids.has(key.keyId)||typeof key.revoked!=='boolean'||!Array.isArray(key.allowedSourceUrls)||!key.allowedSourceUrls.length||key.allowedSourceUrls.length>16)fail('ATTESTATION_TRUST_SCHEMA');
   ids.add(key.keyId);key.allowedSourceUrls.forEach(url);base64(key.publicKeySpkiBase64,44);if(time(key.validFrom)>=time(key.validUntil))fail('ATTESTATION_TRUST_SCHEMA');
  }
  if(!exact(attestation,['format','algorithm','keyId','payload','signatureBase64'])||attestation.format!==ATTESTATION_FORMAT||attestation.algorithm!=='Ed25519'||!text(attestation.keyId))fail('ATTESTATION_SCHEMA');
  const p=attestation.payload;
  if(!exact(p,['collectorId','sourceUrl','requestMethod','httpStatus','acquiredAt','signedAt','receiptContentHash','sourceHash','imageSha256','providerBytesSha256','raceId','runId']))fail('ATTESTATION_PAYLOAD_SCHEMA');
  const key=trustPolicy.collectors.find(k=>k.keyId===attestation.keyId);
  if(!key||key.revoked||p.collectorId!==key.collectorId)fail('ATTESTATION_COLLECTOR_NOT_TRUSTED');
  if(p.requestMethod!=='GET'||p.httpStatus!==200||!key.allowedSourceUrls.includes(url(p.sourceUrl)))fail('ATTESTATION_SOURCE_NOT_ALLOWED');
  const acquired=time(p.acquiredAt),signed=time(p.signedAt);
  if(acquired<time(key.validFrom)||signed>=time(key.validUntil)||signed<acquired||signed>now||signed-acquired>60000)fail('ATTESTATION_CAPTURE_TIME');
  if(!(sourceBytes instanceof Uint8Array)||!sourceBytes.length||sourceBytes.length>1048576||!/^[a-f0-9]{64}$/.test(p.providerBytesSha256)||await digest(sourceBytes)!==p.providerBytesSha256)fail('ATTESTATION_PROVIDER_BYTES_MISMATCH');
  const publicKey=await crypto.subtle.importKey('spki',base64(key.publicKeySpkiBase64,44),{name:'Ed25519'},false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',publicKey,base64(attestation.signatureBase64,64),acquisitionSigningBytes(attestation)))fail('ATTESTATION_SIGNATURE_INVALID');
  await verifyIndexEvidence(archive);
  const b=archive.body,receipt=JSON.parse(b.receiptRaw),input=receipt.body.artifact.input,indexAt=time(receipt.body.indexObservation.observedAt);
  if(p.receiptContentHash!==b.receiptContentHash||p.sourceHash!==b.sourceHash||p.imageSha256!==b.image.sha256||p.runId!==b.runId||p.raceId!==b.raceId)fail('ATTESTATION_RUN_BINDING');
  if(acquired>indexAt||indexAt-acquired>60000||signed>=time(input.postAt)||time(b.recordedAt)<signed)fail('ATTESTATION_PRE_CAPTURE_BINDING');
  return {status:'COLLECTOR_SIGNATURE_VERIFIED_RESEARCH_ONLY',...flags,collectorSignatureVerified:true,
   collectorId:key.collectorId,keyId:key.keyId,sourceUrl:p.sourceUrl,providerBytesSha256:p.providerBytesSha256,
   receiptContentHash:p.receiptContentHash,runId:p.runId,acquiredAtClaim:p.acquiredAt,signedAtClaim:p.signedAt,
   providerIdentityIndependentlyVerified:false,providerContentParsed:false,independentCaptureTimeVerified:false,
   verificationScope:'PINNED_COLLECTOR_SIGNED_CLAIMS_AND_BYTES_NOT_PROVIDER_CERTIFICATE',
   livePreAdmissionChecked:false};
 }catch(e){return denied('HOLD',e.code||'ACQUISITION_ATTESTATION_INVALID');}
}
