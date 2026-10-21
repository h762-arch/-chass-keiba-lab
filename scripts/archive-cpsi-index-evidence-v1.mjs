#!/usr/bin/env node
/** Explicit opt-in local archive. Never modifies an existing Run or calls a network. */
import {open,mkdir,writeFile,readFile}from'node:fs/promises';
import path from'node:path';import{pathToFileURL}from'node:url';import{randomUUID}from'node:crypto';
import{createIndexEvidence,saveIndexEvidenceAndReadback}from'../src/prediction/cpsi-index-evidence-v1.mjs';
async function boundedRead(file,max){
 const handle=await open(file,'r');try{
  const before=await handle.stat();if(!before.isFile()||before.size>max)throw Error('EVIDENCE_FILE_SIZE_OR_TYPE');
  const buffer=Buffer.alloc(max+1);let length=0;
  for(;;){const {bytesRead}=await handle.read(buffer,length,buffer.length-length,null);if(!bytesRead)break;length+=bytesRead;if(length>max)throw Error('EVIDENCE_FILE_SIZE_OR_TYPE');}
  const after=await handle.stat();if(['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))throw Error('EVIDENCE_FILE_CHANGED_DURING_READ');return buffer.subarray(0,length);
 }finally{await handle.close();}
}
export async function runIndexEvidenceCli(argv,{clock=Date.now}={}){
 if(!argv.includes('--enabled'))return{status:'DISABLED',productionWritePerformed:false};
 const opts={},flags=['--enabled','--receipt-file','--image-file','--transcription-file','--output-dir'];
 for(let i=0;i<argv.length;i++){const k=argv[i];if(!flags.includes(k)||Object.hasOwn(opts,k))throw Error('EVIDENCE_CLI_ARGUMENT');opts[k]=k==='--enabled'?true:argv[++i];if(opts[k]==null||typeof opts[k]==='string'&&opts[k].startsWith('--'))throw Error('EVIDENCE_CLI_ARGUMENT');}
 if(flags.slice(1).some(k=>!opts[k]))throw Error('EVIDENCE_CLI_PATH_REQUIRED');
 const [r,t,imageBytes]=await Promise.all([boundedRead(opts['--receipt-file'],1500000),boundedRead(opts['--transcription-file'],131072),boundedRead(opts['--image-file'],786432)]);
 const utf8=new TextDecoder('utf-8',{fatal:true});const archive=await createIndexEvidence({receiptRaw:utf8.decode(r),transcriptionRaw:utf8.decode(t),imageBytes,recordedAt:clock()});
 const output=path.resolve(opts['--output-dir']);let directory;
 const result=await saveIndexEvidenceAndReadback({async insertIfAbsent(hash,value){
  await mkdir(output,{recursive:true,mode:0o700});directory=path.join(output,'CPSI-EVIDENCE-'+randomUUID());await mkdir(directory,{mode:0o700});
  await writeFile(path.join(directory,'evidence.json'),JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});return true;
 },async get(){return JSON.parse(await readFile(path.join(directory,'evidence.json'),'utf8'));}},archive);
 return {...result,readbackScope:'LOCAL_FILESYSTEM',outputDirectory:directory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{console.log(JSON.stringify(await runIndexEvidenceCli(process.argv.slice(2)),null,2));}
 catch(e){console.error(JSON.stringify({status:'REJECTED',reason:e.code||e.message,readbackVerified:false,sourceOriginAuthenticated:false,formalKpiEligible:false,productionWritePerformed:false}));process.exitCode=1;}
}
