#!/usr/bin/env node
// Explicit offline-export research command. No production, Drive or app writes.
import {open,realpath,stat,lstat,writeFile,link,unlink} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,basename,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runJraPdfCapturePipeline,readJraPdfCaptureAttempt} from '../src/research/jra-pdf-capture-pipeline-v1.mjs';
const VERSION='JRA_PDF_CAPTURE_CLI_RECEIPT_V1',MAX_INPUT=300000,MAX_RECEIPT=64000;
const flags={researchOnly:true,formalKpiEligible:false,adopted:false,productionActivationReady:false,freezeMutation:'NONE'};
const guard=(ok,r)=>{if(!ok)throw new TypeError(r);};
const canonical=(v,depth=0)=>{guard(depth<=40,'CLI_RECEIPT_INVALID');if(v===null||['string','number','boolean'].includes(typeof v))return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';};
async function jsonFile(path,max){
 let file;
 try{
  guard(typeof path==='string'&&isAbsolute(path),'CLI_INPUT_INVALID');
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const before=await file.stat();guard(before.isFile()&&before.size>0&&before.size<=max,'CLI_INPUT_INVALID');
  const bytes=Buffer.alloc(before.size+1);let size=0;
  while(size<bytes.length){const r=await file.read(bytes,size,bytes.length-size,size);if(!r.bytesRead)break;size+=r.bytesRead;}
  const after=await file.stat();guard(size===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs,'CLI_INPUT_INVALID');
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size)));
  guard(data&&typeof data==='object'&&!Array.isArray(data),'CLI_INPUT_INVALID');return data;
 }finally{if(file)await file.close().catch(()=>{});}
}
function options(argv){
 const [mode,...rest]=argv;guard(['capture','replay'].includes(mode)&&rest.length%2===0,'CLI_ARGUMENTS_INVALID');
 const allowed=mode==='capture'?['input','attempt-root','snapshot-root','receipt']:['attempt-root','snapshot-root','receipt'];const out={mode};
 for(let i=0;i<rest.length;i+=2){guard(/^--/.test(rest[i]),'CLI_ARGUMENTS_INVALID');const key=rest[i].slice(2);guard(allowed.includes(key)&&!(key in out)&&typeof rest[i+1]==='string'&&isAbsolute(rest[i+1]),'CLI_ARGUMENTS_INVALID');out[key]=rest[i+1];}
 guard(allowed.every(k=>out[k]),'CLI_ARGUMENTS_INVALID');return out;
}
function summary(result){
 const a=result.attempt,r=result.snapshotReadback?.artifact?.resolution;
 return {attemptId:a.identity.attemptId,runId:a.identity.runId,raceId:a.identity.raceId,modelVersion:a.identity.modelVersion,attemptedAt:a.attemptedAt,outcome:a.outcome,reason:a.reason,
  capture:a.receipt,runnerCount:r?.runnerCount??null,joinedCount:r?.joinedCount??null,datedHistoryCount:r?r.history.length-1:null,sourceMissingSlots:r?.declaredMissingHistory?.length??(r?0:null),
  resolutionReasons:r?r.failures.reduce((v,f)=>(v[f.reason]=(v[f.reason]||0)+1,v),{}):null,snapshotSaved:!!result.snapshotReadback?.artifact?.snapshot,...flags};
}
async function replay(opts){
 const doc=await jsonFile(opts.receipt,MAX_RECEIPT);
 guard(doc.schemaVersion===VERSION&&doc.environment==='QUARANTINE'&&doc.anchor,'CLI_RECEIPT_INVALID');
 const result=await readJraPdfCaptureAttempt({environment:'QUARANTINE',root:opts['attempt-root'],snapshotRoot:opts['snapshot-root'],anchor:doc.anchor});
 guard(result.readbackVerified,'CLI_REPLAY_FAILED');
 guard(canonical(doc.summary)===canonical(summary(result)),'CLI_RECEIPT_SUMMARY_MISMATCH');
 return result;
}
export async function runJraPdfCaptureCli(argv,{fetchImpl,clock,stdout=s=>process.stdout.write(s),stderr=s=>process.stderr.write(s)}={}){
 let opts,result,temp,target;
 const emit=value=>stdout(JSON.stringify(value)+'\n');
 try{
  opts=options(argv);
  if(opts.mode==='replay'){
   result=await replay(opts);emit({status:'REPLAY_VERIFIED',summary:summary(result),anchor:result.anchor});return result.attempt.outcome==='SNAPSHOT_SAVED'?0:3;
  }
  const parent=await realpath(dirname(opts.receipt));guard((await stat(parent)).isDirectory(),'CLI_RECEIPT_LOCATION_INVALID');target=join(parent,basename(opts.receipt));
  try{await lstat(target);throw new TypeError('CLI_RECEIPT_EXISTS');}catch(e){if(e.code!=='ENOENT')throw e;}
  const input=await jsonFile(opts.input,MAX_INPUT);
  const allowed=['environment','attemptId','pdfInput','snapshotContext','sourceUrl','timeoutMs','maxBytes'];
  guard(input.environment==='QUARANTINE'&&Object.keys(input).every(k=>allowed.includes(k)),'CLI_INPUT_INVALID');
  result=await runJraPdfCapturePipeline({...input,root:opts['attempt-root'],snapshotRoot:opts['snapshot-root'],fetchImpl,clock});
  if(!result.readbackVerified){emit({status:'HOLD',reason:result.reason,...flags,...(result.anchor?{anchor:result.anchor}:{}),...(result.snapshotAnchor?{snapshotAnchor:result.snapshotAnchor}:{})});return 4;}
  const doc={schemaVersion:VERSION,environment:'QUARANTINE',anchor:result.anchor,summary:summary(result)},raw=canonical(doc);
  guard(Buffer.byteLength(raw)<=MAX_RECEIPT,'CLI_RECEIPT_TOO_LARGE');
  temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,raw,{flag:'wx',mode:0o600});await link(temp,target);
  const checked=await replay({...opts,receipt:target});emit({status:'RECEIPT_SAVED_AND_VERIFIED',summary:summary(checked),anchor:checked.anchor});
  return checked.attempt.outcome==='SNAPSHOT_SAVED'?0:3;
 }catch(e){
  const reasons=['CLI_ARGUMENTS_INVALID','CLI_INPUT_INVALID','CLI_RECEIPT_EXISTS','CLI_RECEIPT_LOCATION_INVALID','CLI_RECEIPT_INVALID','CLI_REPLAY_FAILED','CLI_RECEIPT_SUMMARY_MISMATCH','CLI_RECEIPT_TOO_LARGE'];
  const reason=reasons.includes(e?.message)?e.message:result?'CLI_RECEIPT_SAVE_OR_READ_FAILED':'CLI_INPUT_OR_LOCATION_FAILED';
  // A failed receipt publication must still expose retained anchors for recovery.
  emit({status:'HOLD',reason,...flags,...(result?.anchor?{anchor:result.anchor}:{})});stderr(reason+'\n');return result?4:2;
 }finally{if(temp)await unlink(temp).catch(()=>{});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await runJraPdfCaptureCli(process.argv.slice(2));
