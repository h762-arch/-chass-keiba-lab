// Node-only isolated research persistence. No network, D1, app or Freeze writes.
import {createHash,randomUUID} from 'node:crypto';
import {open,realpath,stat,writeFile,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {resolveJraPdfEvidence} from './jra-pdf-identity-resolution-v1.mjs';
import {createPredictionEvidenceSnapshot} from './prediction-evidence-bridge-v1.mjs';
const VERSION='JRA_DRIVE_SNAPSHOT_QUARANTINE_V1',MAX=300000;
const guard=(ok,r)=>{if(!ok)throw new TypeError(r);};
function canonical(v,depth=0) {
 guard(depth<=40,'QUARANTINE_JSON_DEPTH');
 if(v===null||['string','boolean'].includes(typeof v))return JSON.stringify(v);
 if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 if(v&&typeof v==='object'&&Object.getPrototypeOf(v)===Object.prototype)return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
 throw new TypeError('QUARANTINE_JSON_REQUIRED');
}
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const flags={assessmentOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(v);
const frozen=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(frozen);Object.freeze(v);}return v;};
const failure=reason=>({...flags,status:'HOLD',reason,persisted:false,readbackVerified:false});
export async function prepareJraDriveSnapshotArtifact({environment,resolutionInput,snapshotContext}={}) {
 guard(environment==='QUARANTINE','QUARANTINE_REQUIRED');
 guard(safeId(snapshotContext?.runId)&&safeId(snapshotContext?.modelVersion),'SNAPSHOT_RUN_VERSION_REQUIRED');
 const raw=canonical({resolutionInput,snapshotContext});guard(Buffer.byteLength(raw)<=MAX,'QUARANTINE_TOO_LARGE');
 const inputs=JSON.parse(raw),resolution=resolveJraPdfEvidence(inputs.resolutionInput);
 let snapshot=null;
 if(resolution.status==='READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT') {
  guard(inputs.snapshotContext.source?.spreadsheetId===resolution.sourceSpreadsheetId,'SNAPSHOT_SOURCE_MISMATCH');
  const {runId,modelVersion,cutoffAt,offAt,source}=inputs.snapshotContext;
  snapshot=await createPredictionEvidenceSnapshot({...resolution,runId,modelVersion,cutoffAt,offAt,source,
   // Caller metadata cannot override the resolved field, race, or identity tables.
   races:resolution.races,runners:resolution.runners,history:resolution.history,identityMap:resolution.identityMap,raceId:resolution.canonicalRaceId});
 }
 const artifact={schemaVersion:VERSION,environment:'QUARANTINE',runId:inputs.snapshotContext.runId,modelVersion:inputs.snapshotContext.modelVersion,
  raceId:resolution.canonicalRaceId,inputs,resolution,snapshot,status:snapshot?'SNAPSHOT_PREPARED':'RESOLUTION_HOLD',...flags};
 guard(Buffer.byteLength(canonical(artifact))<=MAX,'QUARANTINE_TOO_LARGE');return frozen(artifact);
}
async function location(root,runId,raceId,modelVersion) {
 guard(typeof root==='string'&&isAbsolute(root)&&safeId(runId)&&typeof raceId==='string'&&raceId.length>0&&raceId.length<=200&&safeId(modelVersion),'QUARANTINE_LOCATION_INVALID');
 const actual=await realpath(root);guard((await stat(actual)).isDirectory(),'QUARANTINE_LOCATION_INVALID');
 return join(actual,hash(canonical({runId,raceId,modelVersion}))+'.json');
}
export async function readJraDriveSnapshotQuarantine({root,environment,anchor}={}) {
 let handle;
 try {
  guard(environment==='QUARANTINE'&&anchor?.schemaVersion===VERSION&&anchor.environment==='QUARANTINE','QUARANTINE_ANCHOR_INVALID');
  guard(/^[a-f0-9]{64}$/.test(anchor.payloadHash)&&Number.isInteger(anchor.byteLength)&&anchor.byteLength>0&&anchor.byteLength<=MAX,'QUARANTINE_ANCHOR_INVALID');
  const target=await location(root,anchor.runId,anchor.raceId,anchor.modelVersion);
  handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await handle.stat();guard(before.isFile()&&before.size===anchor.byteLength,'QUARANTINE_SIZE_MISMATCH');
  const bytes=Buffer.alloc(anchor.byteLength+1);let count=0;
  while(count<bytes.length){const r=await handle.read(bytes,count,bytes.length-count,count);if(!r.bytesRead)break;count+=r.bytesRead;}
  const after=await handle.stat();guard(count===anchor.byteLength&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'QUARANTINE_SIZE_MISMATCH');
  const raw=bytes.subarray(0,count);guard(hash(raw)===anchor.payloadHash,'QUARANTINE_HASH_MISMATCH');
  const artifact=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  guard(artifact.schemaVersion===VERSION&&artifact.runId===anchor.runId&&artifact.raceId===anchor.raceId&&artifact.modelVersion===anchor.modelVersion,'QUARANTINE_IDENTITY_MISMATCH');
  const replay=await prepareJraDriveSnapshotArtifact({environment:'QUARANTINE',...artifact.inputs});
  guard(canonical(replay)===raw.toString('utf8'),'QUARANTINE_REPLAY_MISMATCH');
  return frozen({...flags,status:'READBACK_VERIFIED',persisted:true,readbackVerified:true,artifact:replay,anchor:structuredClone(anchor)});
 } catch(e) {return failure(['QUARANTINE_ANCHOR_INVALID','QUARANTINE_LOCATION_INVALID','QUARANTINE_SIZE_MISMATCH','QUARANTINE_HASH_MISMATCH','QUARANTINE_IDENTITY_MISMATCH','QUARANTINE_REPLAY_MISMATCH'].includes(e?.message)?e.message:'QUARANTINE_READBACK_FAILED');}
 finally{if(handle)await handle.close().catch(()=>{});}
}
export async function persistJraDriveSnapshotQuarantine({root,environment,resolutionInput,snapshotContext}={}) {
 let temp,published=false,anchor;
 try {
  const artifact=await prepareJraDriveSnapshotArtifact({environment,resolutionInput,snapshotContext}),raw=canonical(artifact);
  const target=await location(root,artifact.runId,artifact.raceId,artifact.modelVersion);
  anchor={schemaVersion:VERSION,environment:'QUARANTINE',runId:artifact.runId,raceId:artifact.raceId,modelVersion:artifact.modelVersion,payloadHash:hash(raw),byteLength:Buffer.byteLength(raw)};
  temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,raw,{flag:'wx',mode:0o600});
  let existing=false;
  try{await link(temp,target);published=true;}catch(e){if(e.code!=='EEXIST')throw e;existing=true;}
  const checked=await readJraDriveSnapshotQuarantine({root,environment,anchor});
  if(!checked.readbackVerified)return {...failure(existing?'QUARANTINE_IMMUTABLE_CONFLICT':'QUARANTINE_PUBLISHED_UNVERIFIED'),persisted:published?null:false,anchor};
  return {...checked,writeState:existing?'EXISTING_IDENTICAL':'CREATED'};
 } catch {return {...failure('QUARANTINE_PREPARE_OR_SAVE_FAILED'),persisted:published?null:false,...(anchor?{anchor}:{})};}
 finally{if(temp)await unlink(temp).catch(()=>{});}
}
