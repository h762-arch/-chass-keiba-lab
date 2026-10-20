#!/usr/bin/env node
/** Explicit local research command. Never writes Drive, application EARLY or D1. */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureCpsiPreRun} from '../src/prediction/cpsi-pre-producer-v1.mjs';
const fail=reason=>{throw Error(reason);};
export async function runCpsiProducerCli(argv,{fetchImpl=fetch,clock=Date.now}={}){
 if(!argv.includes('--enabled'))return {status:'DISABLED',productionWritePerformed:false};
 const flags=new Set(['--enabled','--index-file','--output-dir']);
 const options={};
 for(let i=0;i<argv.length;i++){
  const k=argv[i];if(!flags.has(k)||Object.hasOwn(options,k))fail('CLI_ARGUMENT_INVALID');
  options[k]=k==='--enabled'?true:argv[++i];if(options[k]==null||typeof options[k]==='string'&&options[k].startsWith('--'))fail('CLI_ARGUMENT_INVALID');
 }
 if(!options['--index-file']||!options['--output-dir'])fail('CLI_PATH_REQUIRED');
 const indexFile=path.resolve(options['--index-file']),output=path.resolve(options['--output-dir']);
 let runDirectory;
 const store={async insertIfAbsent(runId,receipt){
  if(!/^CPSI-RUN-[a-f0-9-]{36}$/.test(runId))fail('CLI_RUN_ID_INVALID');
  await mkdir(output,{recursive:true,mode:0o700});runDirectory=path.join(output,runId);
  try{await mkdir(runDirectory,{mode:0o700});}catch(e){if(e.code==='EEXIST')return false;throw e;}
  await writeFile(path.join(runDirectory,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});return true;
 },async get(){return JSON.parse(await readFile(path.join(runDirectory,'receipt.json'),'utf8'));}};
 const result=await captureCpsiPreRun({enabled:true,store,clock,async acquireIndex(){
  const before=await stat(indexFile);if(!before.isFile()||before.size>262144)fail('CLI_INDEX_FILE_INVALID');
  const raw=await readFile(indexFile,'utf8'),after=await stat(indexFile);
  if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)fail('CLI_INDEX_CHANGED_DURING_READ');return raw;
 },async acquireCard({url}){
  const response=await fetchImpl(url,{method:'GET',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{accept:'text/html'}});
  if(!response.ok||response.status!==200||response.url&&new URL(response.url).href!==url)fail('CLI_OFFICIAL_CARD_HTTP_REJECTED');
  if(!/text\/html/i.test(response.headers.get('content-type')||'')||Number(response.headers.get('content-length'))>1000000||!response.body)fail('CLI_OFFICIAL_CARD_TYPE_OR_SIZE');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1000000)fail('CLI_OFFICIAL_CARD_TYPE_OR_SIZE');chunks.push(value);}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 }});
 if(result.status!=='LOCAL_PRE_SOURCE_READY')return {...result,productionWritePerformed:false};
 await writeFile(path.join(runDirectory,'source-bundle.json'),JSON.stringify(result.bundle,null,2)+'\n',{flag:'wx',mode:0o600});
 await writeFile(path.join(runDirectory,'drive-feed-row.json'),JSON.stringify(result.feedRow)+'\n',{flag:'wx',mode:0o600});
 return {status:result.status,runId:result.runId,outputDirectory:runDirectory,runnerCount:result.receipt.body.artifact.input.horses.length,readbackVerified:true,readbackScope:'LOCAL_FILESYSTEM',sourceOriginAuthenticated:false,formalKpiEligible:false,productionWritePerformed:false,driveFeedWritten:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runCpsiProducerCli(process.argv.slice(2));console.log(JSON.stringify(r,null,2));if(r.status==='REJECTED')process.exitCode=1;}
 catch(e){console.error(JSON.stringify({status:'REJECTED',reason:e.message,productionWritePerformed:false}));process.exitCode=1;}
}
