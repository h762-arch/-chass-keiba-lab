// Explicit Node research orchestration. Never an app/Worker/Drive/Freeze writer.
import {createHash,randomUUID} from 'node:crypto';
import {open,realpath,stat,lstat,writeFile,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {captureJraPdfOfficialCard} from './jra-pdf-official-card-capture-v1.mjs';
import {prepareJraDriveSnapshotArtifact,persistJraDriveSnapshotQuarantine,readJraDriveSnapshotQuarantine} from './jra-drive-snapshot-quarantine-v1.mjs';
const VERSION='JRA_PDF_CAPTURE_ATTEMPT_V1',MAX=300000;
const flags={researchOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
const guard=(ok,r)=>{if(!ok)throw new TypeError(r);};
const safe=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(v);
function canonical(v,depth=0){
 guard(depth<=40,'ATTEMPT_JSON_INVALID');
 if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 if(v&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
 throw new TypeError('ATTEMPT_JSON_INVALID');
}
const hash=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>hash(canonical(v));
const reasons=new Set(['OFFICIAL_CAPTURE_URL_INVALID','OFFICIAL_CAPTURE_CLOCK_INVALID','OFFICIAL_CAPTURE_LIMIT_INVALID','OFFICIAL_CAPTURE_DEADLINE','OFFICIAL_CAPTURE_HTTP_REJECTED','OFFICIAL_CAPTURE_RESPONSE_URL_CONFLICT','OFFICIAL_CAPTURE_SIZE_LIMIT','OFFICIAL_CAPTURE_STREAM_REQUIRED','OFFICIAL_CAPTURE_BODY_INVALID','OFFICIAL_CAPTURE_CONTENT_TYPE_INVALID','OFFICIAL_CAPTURE_ENCODING_INVALID','OFFICIAL_CAPTURE_DECODE_INVALID','OFFICIAL_CARD_CAPTURE_STALE','OFFICIAL_CARD_CLOCK_REQUIRED','OFFICIAL_CARD_HTML_REQUIRED','OFFICIAL_PDF_RACE_CONTEXT_CONFLICT','OFFICIAL_PDF_FIELD_CONFLICT','OFFICIAL_PDF_RUNNER_CONFLICT','OFFICIAL_HORSE_ID_REUSED','CAPTURE_FAILED','SNAPSHOT_TIMING_CONFLICT','SNAPSHOT_PREPARE_FAILED','SNAPSHOT_SAVE_FAILED']);
const hold=reason=>({...flags,status:'HOLD',reason,persisted:false,readbackVerified:false});
async function location(root,identity){
 guard(typeof root==='string'&&isAbsolute(root)&&safe(identity.attemptId)&&safe(identity.runId)&&safe(identity.modelVersion)&&typeof identity.raceId==='string'&&identity.raceId.length>0&&identity.raceId.length<=200,'ATTEMPT_LOCATION_INVALID');
 const actual=await realpath(root);guard((await stat(actual)).isDirectory(),'ATTEMPT_LOCATION_INVALID');
 return join(actual,'attempt-'+digest(identity)+'.json');
}
function timing(capture,context){
 const s=capture.evidence.source,cutoff=Date.parse(context.cutoffAt),off=Date.parse(context.offAt),available=Date.parse(context.source?.availableAt);
 guard(Number.isFinite(cutoff)&&Number.isFinite(off)&&Number.isFinite(available)&&off===Date.parse(s.offAt)&&Date.parse(s.nowAt)<=cutoff&&cutoff<off&&available>=Date.parse(s.nowAt),'SNAPSHOT_TIMING_CONFLICT');
}
function validateReceipt(receipt){
 guard(receipt&&typeof receipt.sourceUrl==='string'&&/^[a-f0-9]{64}$/.test(receipt.rawSha256)&&Number.isInteger(receipt.byteLength)&&receipt.byteLength>0&&receipt.byteLength<=1000000&&['utf-8','shift_jis'].includes(receipt.encoding),'ATTEMPT_RECEIPT_INVALID');
 const u=new URL(receipt.sourceUrl);guard(u.origin==='https://www.jra.go.jp'&&u.pathname==='/JRADB/accessD.html'&&!u.username&&!u.password&&!u.hash,'ATTEMPT_RECEIPT_INVALID');
 const t=[receipt.startedAt,receipt.capturedAt,receipt.observedAt].map(Date.parse);
 guard(t.every(Number.isFinite)&&t[0]<=t[1]&&t[1]<=t[2]&&t[2]-t[0]<=10000&&receipt.timingProof==='PROCESS_CLOCK_UNAUTHENTICATED','ATTEMPT_RECEIPT_INVALID');
}
export async function readJraPdfCaptureAttempt({root,snapshotRoot,environment,anchor}={}){
 let handle;
 try{
  guard(environment==='QUARANTINE'&&anchor?.schemaVersion===VERSION&&/^[a-f0-9]{64}$/.test(anchor.payloadHash)&&Number.isInteger(anchor.byteLength)&&anchor.byteLength>0&&anchor.byteLength<=MAX,'ATTEMPT_ANCHOR_INVALID');
  const identity={attemptId:anchor.attemptId,runId:anchor.runId,raceId:anchor.raceId,modelVersion:anchor.modelVersion},target=await location(root,identity);
  handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await handle.stat();guard(before.isFile()&&before.size===anchor.byteLength,'ATTEMPT_SIZE_MISMATCH');
  const bytes=Buffer.alloc(anchor.byteLength+1);let size=0;
  while(size<bytes.length){const r=await handle.read(bytes,size,bytes.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}
  const after=await handle.stat();guard(size===anchor.byteLength&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'ATTEMPT_SIZE_MISMATCH');
  const raw=bytes.subarray(0,size);guard(hash(raw)===anchor.payloadHash,'ATTEMPT_HASH_MISMATCH');
  const a=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  guard(a.schemaVersion===VERSION&&a.environment==='QUARANTINE'&&canonical(a.identity)===canonical(identity)&&Object.entries(flags).every(([k,v])=>a[k]===v)&&canonical(a)===raw.toString('utf8'),'ATTEMPT_IDENTITY_MISMATCH');
  guard(typeof a.attemptedAt==='string'&&Number.isFinite(Date.parse(a.attemptedAt))&&/^[a-f0-9]{64}$/.test(a.pdfInputHash),'ATTEMPT_STATE_INVALID');
  if(a.receipt)validateReceipt(a.receipt);
  let saved=null;
  if(a.snapshotAnchor){
   guard(['SNAPSHOT_SAVED','RESOLUTION_HOLD'].includes(a.outcome)&&a.reason===null&&a.receipt,'ATTEMPT_STATE_INVALID');
   saved=await readJraDriveSnapshotQuarantine({root:snapshotRoot,environment,anchor:a.snapshotAnchor});
   guard(saved.readbackVerified,'ATTEMPT_SNAPSHOT_READBACK_FAILED');
   const artifact=saved.artifact;
   guard(artifact.runId===identity.runId&&artifact.raceId===identity.raceId&&artifact.modelVersion===identity.modelVersion&&digest(artifact.inputs.resolutionInput)===a.resolutionInputHash&&digest(artifact.inputs.snapshotContext)===a.snapshotContextHash,'ATTEMPT_SNAPSHOT_CONFLICT');
   guard(a.outcome===(artifact.snapshot?'SNAPSHOT_SAVED':'RESOLUTION_HOLD'),'ATTEMPT_STATE_INVALID');
   guard(artifact.inputs.resolutionInput.mapSpreadsheetId===`OFFICIAL_CARD_SHA256:${a.source.htmlSha256}`,'ATTEMPT_RECEIPT_INVALID');
   guard(a.source.sourceUrl===a.receipt.sourceUrl&&a.source.capturedAt===a.receipt.capturedAt&&a.source.nowAt===a.receipt.observedAt,'ATTEMPT_RECEIPT_INVALID');
   if(artifact.snapshot)timing({evidence:{source:a.source}},artifact.inputs.snapshotContext);
  } else guard(['CAPTURE_HOLD','SNAPSHOT_HOLD'].includes(a.outcome)&&reasons.has(a.reason)&& (a.outcome!=='CAPTURE_HOLD'||a.receipt===null),'ATTEMPT_STATE_INVALID');
  return {...flags,status:'ATTEMPT_READBACK_VERIFIED',persisted:true,readbackVerified:true,attempt:a,snapshotReadback:saved,anchor:structuredClone(anchor)};
 }catch(e){return hold(['ATTEMPT_ANCHOR_INVALID','ATTEMPT_SIZE_MISMATCH','ATTEMPT_HASH_MISMATCH','ATTEMPT_IDENTITY_MISMATCH','ATTEMPT_STATE_INVALID','ATTEMPT_RECEIPT_INVALID','ATTEMPT_SNAPSHOT_READBACK_FAILED','ATTEMPT_SNAPSHOT_CONFLICT'].includes(e?.message)?e.message:'ATTEMPT_READBACK_FAILED');}
 finally{if(handle)await handle.close().catch(()=>{});}
}
async function publish({root,snapshotRoot,attempt}){
 let temp,published=false;
 try{
  const raw=canonical(attempt);guard(Buffer.byteLength(raw)<=MAX,'ATTEMPT_TOO_LARGE');
  const target=await location(root,attempt.identity),anchor={schemaVersion:VERSION,...attempt.identity,payloadHash:hash(raw),byteLength:Buffer.byteLength(raw)};
  temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,raw,{flag:'wx',mode:0o600});let existing=false;
  try{await link(temp,target);published=true;}catch(e){if(e.code!=='EEXIST')throw e;existing=true;}
  const checked=await readJraPdfCaptureAttempt({root,snapshotRoot,environment:'QUARANTINE',anchor});
  if(!checked.readbackVerified)return {...hold(existing?'ATTEMPT_IMMUTABLE_CONFLICT':'ATTEMPT_PUBLISHED_UNVERIFIED'),persisted:published?null:false,anchor,snapshotAnchor:attempt.snapshotAnchor};
  return {...checked,writeState:existing?'EXISTING_IDENTICAL':'CREATED'};
 }catch{return {...hold('ATTEMPT_SAVE_FAILED'),persisted:published?null:false,snapshotAnchor:attempt.snapshotAnchor};}
 finally{if(temp)await unlink(temp).catch(()=>{});}
}
export async function runJraPdfCapturePipeline({environment,root,snapshotRoot,attemptId,pdfInput,snapshotContext,sourceUrl,fetchImpl,clock,timeoutMs,maxBytes}={}){
 let identity,input,context;
 try{
  guard(environment==='QUARANTINE','QUARANTINE_REQUIRED');
  // Copy and bound inputs before the first asynchronous operation.
  const raw=canonical({pdfInput,snapshotContext});guard(Buffer.byteLength(raw)<=MAX,'ATTEMPT_INPUT_TOO_LARGE');
  ({pdfInput:input,snapshotContext:context}=JSON.parse(raw));
  identity={attemptId,runId:context.runId,raceId:input.canonicalRaceId,modelVersion:context.modelVersion};
  const target=await location(root,identity);await location(snapshotRoot,identity);
  try{await lstat(target);return hold('ATTEMPT_IMMUTABLE_CONFLICT');}catch(e){if(e.code!=='ENOENT')throw e;}
 }catch{return hold('ATTEMPT_INPUT_OR_LOCATION_INVALID');}
 const attempt={schemaVersion:VERSION,environment:'QUARANTINE',identity,attemptedAt:new Date().toISOString(),pdfInputHash:digest(input),...flags,outcome:'CAPTURE_HOLD',reason:null,receipt:null,source:null,snapshotAnchor:null,resolutionInputHash:null,snapshotContextHash:digest(context)};
 let capture;
 try{capture=await captureJraPdfOfficialCard({pdfInput:input,sourceUrl,fetchImpl,clock,timeoutMs,maxBytes});}
 catch(e){attempt.reason=reasons.has(e?.message)?e.message:'CAPTURE_FAILED';return publish({root,snapshotRoot,attempt});}
 attempt.receipt=capture.capture;attempt.source=capture.evidence.source;attempt.resolutionInputHash=digest(capture.evidence.resolutionInput);
 try{
  const args={environment:'QUARANTINE',resolutionInput:capture.evidence.resolutionInput,snapshotContext:context};
  const prepared=await prepareJraDriveSnapshotArtifact(args);
  if(prepared.snapshot)timing(capture,context);
  const saved=await persistJraDriveSnapshotQuarantine({...args,root:snapshotRoot});
  guard(saved.readbackVerified,'SNAPSHOT_SAVE_FAILED');
  attempt.snapshotAnchor=saved.anchor;attempt.outcome=saved.artifact.snapshot?'SNAPSHOT_SAVED':'RESOLUTION_HOLD';
 }catch(e){attempt.outcome='SNAPSHOT_HOLD';attempt.reason=reasons.has(e?.message)?e.message:'SNAPSHOT_PREPARE_FAILED';}
 return publish({root,snapshotRoot,attempt});
}
