// Node-only preregistered local snapshot reader. No network, DB or promotion.
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {createHash} from 'node:crypto';
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>typeof v==='string'&&v.trim().length>0;
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v)}return v};
const guard=(ok,reason)=>{if(!ok)throw Error(reason)};
const failure=reason=>freeze({status:'HOLD',reason,readers:null,persisted:false,formalKpiEligible:false,adopted:false,productionActivationReady:false});
const receipt=(sourceRef,result,reasonCode)=>({sourceRef,receipt:{result,reasonCode}});
const keys=['runId','raceId','eligibilityId','fieldId','scopeKey'];
export function createPredictionSnapshotFileReadersV2155({root,environment,bindings}={}){
 try{
  guard(environment==='QUARANTINE'&&text(root)&&isAbsolute(root),'ISOLATED_ABSOLUTE_ROOT_REQUIRED');
  guard(Array.isArray(bindings)&&bindings.length>=1&&bindings.length<=4,'BOUNDED_FILE_BINDINGS_REQUIRED');
  const ids=new Set(),readers=Object.create(null),base=resolve(root);
  for(const b of bindings){
   guard(b&&text(b.readerId)&&!ids.has(b.readerId)&&text(b.sourceRef)&&hex(b.planHash)&&hex(b.expectedSha256)&&Number.isInteger(b.expectedBytes)&&b.expectedBytes>0&&b.expectedBytes<=50000,'FILE_BINDING_REQUIRED');ids.add(b.readerId);
   guard(text(b.relativePath)&&!isAbsolute(b.relativePath)&&!b.relativePath.includes('\\')&&b.relativePath.split('/').every(v=>v!==''&&v!=='.'&&v!=='..'),'RELATIVE_SOURCE_PATH_REQUIRED');
   const config=freeze({...b}),target=resolve(base,config.relativePath);
   readers[config.readerId]=async({context,registration,signal}={})=>{
    if(context?.planHash!==config.planHash||registration?.sourceRef!==config.sourceRef||registration?.readerId!==config.readerId)return receipt(config.sourceRef,'CONFLICT','FILE_READER_BINDING_MISMATCH');
    if(signal?.aborted)return receipt(config.sourceRef,'CONFLICT','FILE_READ_ABORTED');
    let handle;
    try{
     const actualRoot=await realpath(base).catch(()=>{throw Error('SOURCE_ROOT_UNAVAILABLE')}),actual=await realpath(target),rel=relative(actualRoot,actual);
     guard(rel!==''&&!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel),'SOURCE_PATH_ESCAPE');
     guard(!(await lstat(target)).isSymbolicLink(),'SOURCE_SYMLINK_REJECTED');
     handle=await open(target,constants.O_RDONLY|constants.O_NOFOLLOW);
     const before=await handle.stat();guard(before.isFile()&&before.size===config.expectedBytes,'SOURCE_SIZE_MISMATCH');
     const bytes=Buffer.alloc(config.expectedBytes+1);let offset=0;
     while(offset<bytes.length){
      guard(!signal?.aborted,'FILE_READ_ABORTED');
      const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);if(bytesRead===0)break;offset+=bytesRead;
     }
     const after=await handle.stat();guard(offset===config.expectedBytes&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'SOURCE_CHANGED_DURING_READ');
     const raw=bytes.subarray(0,offset),observedHash=createHash('sha256').update(raw).digest('hex');guard(observedHash===config.expectedSha256,'SOURCE_BYTE_HASH_MISMATCH');
     const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
     guard(snapshot&&snapshot.sourceRef===config.sourceRef&&Object.hasOwn(snapshot,'payload')&&snapshot.payload!==null,'SOURCE_ENVELOPE_INVALID');
     for(const key of keys)guard(snapshot[key]===context[key],'SOURCE_IDENTITY_MISMATCH');
     guard(snapshot.sourceStage==='EARLY'&&snapshot.identityStatus==='PASS'&&snapshot.sourceLineage==='PASS'&&snapshot.leakageGuard==='PASS','SOURCE_PROVENANCE_INVALID');
     // Phase90 verifies timestamps/value and cutoff; never manufacture PASS,
     // a capture timestamp, or a source value from filesystem metadata.
     guard(!signal?.aborted,'FILE_READ_ABORTED');
     const found={result:'FOUND'};
     for(const key of [...keys,'sourceSnapshotId','sourceStage','identityStatus','sourceLineage','leakageGuard','capturedAt','dataAsOf','value'])found[key]=snapshot[key];
     guard(typeof snapshot.sourceSnapshotId==='string'&&snapshot.sourceSnapshotId.length>0,'SOURCE_ENVELOPE_INVALID');
     // Retain exact original bytes as base64 plus independently observed hash.
     // Phase93 independently enforces response/total evidence size limits.
     const retained={...snapshot,fileReadEvidence:{byteSha256:observedHash,byteCount:offset,rawGzip:false,rawBase64:raw.toString('base64')}};
     return {sourceRef:config.sourceRef,receipt:found,sourceSnapshot:retained};
    }catch(e){
     if(e?.code==='ENOENT')return receipt(config.sourceRef,'NOT_FOUND','REGISTERED_SOURCE_FILE_NOT_FOUND');
     const conflicts=['SOURCE_ROOT_UNAVAILABLE','SOURCE_PATH_ESCAPE','SOURCE_SYMLINK_REJECTED','SOURCE_SIZE_MISMATCH','SOURCE_CHANGED_DURING_READ','SOURCE_BYTE_HASH_MISMATCH','SOURCE_ENVELOPE_INVALID','SOURCE_IDENTITY_MISMATCH','SOURCE_PROVENANCE_INVALID','FILE_READ_ABORTED'];
     return receipt(config.sourceRef,'CONFLICT',conflicts.includes(e?.message)?e.message:'SOURCE_FILE_READ_INVALID');
    }finally{if(handle)await handle.close().catch(()=>{})}
   };
  }
  return freeze({status:'READERS_READY',readers,assessmentOnly:true,persisted:false,formalKpiEligible:false,adopted:false,productionActivationReady:false});
 }catch(e){return failure(['ISOLATED_ABSOLUTE_ROOT_REQUIRED','BOUNDED_FILE_BINDINGS_REQUIRED','FILE_BINDING_REQUIRED','RELATIVE_SOURCE_PATH_REQUIRED'].includes(e?.message)?e.message:'FILE_READER_SETUP_FAILED')}
}
