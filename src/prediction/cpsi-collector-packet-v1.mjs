/** Default-OFF research orchestration. No production activation or ambient I/O. */
import {captureCollectorResponse,signCollectorAcquisition} from './cpsi-live-collector-v1.mjs';
import {captureCpsiPreRun} from './cpsi-pre-producer-v1.mjs';
import {createIndexEvidence,verifyIndexEvidence} from './cpsi-index-evidence-v1.mjs';
import {verifyAcquisitionAttestation,TRUST_FORMAT} from './cpsi-acquisition-attestation-v1.mjs';
import {sourceSha256,stableSourceJson} from './cpsi-source-recovery-v1.mjs';
export const PACKET_FORMAT='CHASS_CPSI_COLLECTOR_PACKET_V1';
const flags={researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false,importable:false,productionActivationDecision:'NO-GO',originalEarlyMutation:false,productionWritePerformed:false};
const fail=code=>{throw Object.assign(Error(code),{code});};
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bytes(s){
 if(typeof s!=='string'||!s.length||s.length>1398104||s.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(s))fail('PACKET_RESPONSE_ENCODING');
 let raw;try{raw=atob(s);}catch{fail('PACKET_RESPONSE_ENCODING');}if(!raw.length||raw.length>1048576||btoa(raw)!==s)fail('PACKET_RESPONSE_ENCODING');return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function tick(clock){const n=clock();if(!Number.isFinite(n))fail('PACKET_CLOCK');return n;}
/** Historical cryptographic review only; never live/formal PRE admission. Policy is external, not embedded. */
export async function verifyCollectorPacket(packet,{trustPolicy,now=Date.now()}={}){
 if(!exact(packet,['format','contentHash','body'])||packet.format!==PACKET_FORMAT||!exact(packet.body,['archive','attestation','responseBase64',...Object.keys(flags)]))fail('PACKET_SCHEMA');
 if(new TextEncoder().encode(stableSourceJson(packet)).length>4194304)fail('PACKET_SIZE');
 for(const [k,v]of Object.entries(flags))if(packet.body[k]!==v)fail('PACKET_GOVERNANCE');
 if(await sourceSha256(packet.body)!==packet.contentHash)fail('PACKET_HASH');
 const {archive,attestation,responseBase64}=packet.body;await verifyIndexEvidence(archive);
 const sourceBytes=bytes(responseBase64),receipt=JSON.parse(archive.body.receiptRaw);
 if(utf8.decode(sourceBytes)!==receipt.body.indexObservation.raw)fail('PACKET_OBSERVATION_BYTES_MISMATCH');
 const verification=await verifyAcquisitionAttestation({enabled:true,archive,attestation,trustPolicy,sourceBytes,now});
 if(verification.status!=='COLLECTOR_SIGNATURE_VERIFIED_RESEARCH_ONLY')fail(verification.reason);
 return {status:'COLLECTOR_PACKET_VERIFIED_RESEARCH_ONLY',...flags,contentHash:packet.contentHash,runId:archive.body.runId,raceId:archive.body.raceId,collectorSignatureVerified:true,observationBytesMatchResponse:true,liveAdmissionChecked:false};
}
/** All adapters are trusted operator code, including independently managed trust loading and local-only storage. */
export async function collectCpsiResearchPacket(options={}){
 if(options.enabled!==true)return {status:'DISABLED',...flags};
 let storageState='NOT_ATTEMPTED';
 try{
  const {sourceUrl,keyId,fetchResponse,acquireCard,prepareEvidence,sign,loadTrustPolicy,store,clock=Date.now,timeoutMs=10000}=options;
  if(![fetchResponse,acquireCard,prepareEvidence,sign,loadTrustPolicy,clock,store?.insertIfAbsent,store?.get].every(x=>typeof x==='function'))fail('PACKET_DEPENDENCIES');
  const policy=structuredClone(await loadTrustPolicy());
  if(policy?.format!==TRUST_FORMAT||!Array.isArray(policy.collectors)||policy.collectors.filter(k=>k.keyId===keyId).length!==1)fail('PACKET_TRUST_KEY_SELECTION');
  const key=policy.collectors.find(k=>k.keyId===keyId);let captured,storedReceipt;
  const producer=await captureCpsiPreRun({enabled:true,clock,
   async acquireIndex(){captured=await captureCollectorResponse({enabled:true,sourceUrl,key,fetchResponse,clock,timeoutMs});if(captured.status!=='CAPTURED_RESEARCH_ONLY')fail(captured.reason);return utf8.decode(captured.sourceBytes);},
   acquireCard,
   store:{async insertIfAbsent(id,value){if(storedReceipt)return false;storedReceipt=structuredClone(value);return true;},async get(){return structuredClone(storedReceipt);}}
  });
  if(producer.status!=='LOCAL_PRE_SOURCE_READY')fail(producer.reason);
  const receiptRaw=JSON.stringify(producer.receipt),post=Date.parse(producer.receipt.body.artifact.input.postAt),frozen=Date.parse(producer.receipt.body.artifact.input.freezeAt);
  const evidence=await prepareEvidence({sourceBytes:captured.sourceBytes.slice(),receipt:structuredClone(producer.receipt)});
  if(!exact(evidence,['imageBytes','transcriptionRaw'])||!(evidence.imageBytes instanceof Uint8Array)||typeof evidence.transcriptionRaw!=='string')fail('PACKET_EVIDENCE_SHAPE');
  const imageBytes=evidence.imageBytes.slice(),transcriptionRaw=evidence.transcriptionRaw;
  // Validate transcription before requesting any signature. Local archive time is not acquisition time.
  await createIndexEvidence({receiptRaw,transcriptionRaw,imageBytes,recordedAt:tick(clock)});
  const signed=await signCollectorAcquisition({enabled:true,handle:captured.handle,receiptRaw,imageBytes,sign,clock,timeoutMs});
  if(signed.status!=='SIGNED_RESEARCH_ONLY')fail(signed.reason);
  const recordedAt=tick(clock),signedAt=Date.parse(signed.attestation.payload.signedAt);
  if(recordedAt<signedAt||recordedAt>=post)fail('PACKET_LATE_ARCHIVE');
  const archive=await createIndexEvidence({receiptRaw,transcriptionRaw,imageBytes,recordedAt});
  const body={...flags,archive,attestation:signed.attestation,responseBase64:b64(signed.sourceBytes)},packet={format:PACKET_FORMAT,contentHash:await sourceSha256(body),body};
  const beforeStore=tick(clock);if(beforeStore<recordedAt||beforeStore>=post||beforeStore-frozen>60000)fail('PACKET_NOT_FRESH_BEFORE_SAVE');
  await verifyCollectorPacket(packet,{trustPolicy:await loadTrustPolicy(),now:beforeStore});
  storageState='INSERT_ATTEMPTED';if(await store.insertIfAbsent(archive.body.runId,structuredClone(packet))!==true)fail('PACKET_ALREADY_EXISTS');storageState='INSERTED_UNVERIFIED';
  const readback=await store.get(archive.body.runId),readAt=tick(clock);
  const verified=await verifyCollectorPacket(readback,{trustPolicy:await loadTrustPolicy(),now:readAt});
  if(stableSourceJson(readback)!==stableSourceJson(packet))fail('PACKET_READBACK_MISMATCH');
  const complete=tick(clock);if(readAt<beforeStore||complete<readAt||complete>=post||complete-frozen>60000)fail('PACKET_READBACK_COMPLETED_LATE');
  storageState='READBACK_VERIFIED';return {...verified,status:'COLLECTOR_PACKET_READBACK_VERIFIED_RESEARCH_ONLY',storageState,readbackVerified:true,readbackScope:'CALLER_STORE_ADAPTER',freshPreResearchCheck:true};
 }catch(e){return {status:'HOLD',reason:e.code||'COLLECTOR_PACKET_FAILED',...flags,storageState,readbackVerified:false};}
}
