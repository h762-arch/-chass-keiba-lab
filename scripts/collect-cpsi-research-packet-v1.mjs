#!/usr/bin/env node
/** Opt-in local operator command. Adapter is explicitly authorized executable code, not data from a ZIP. */
import {mkdir,open,writeFile} from 'node:fs/promises';
import path from 'node:path';import {pathToFileURL} from 'node:url';
import {collectCpsiResearchPacket} from '../src/prediction/cpsi-collector-packet-v1.mjs';
export function localCollectorPacketStore(outputDirectory){
 const base=path.resolve(outputDirectory),file=id=>{if(!/^CPSI-RUN-[a-f0-9-]{36}$/i.test(id))throw Error('PACKET_RUN_PATH');return path.join(base,id,'packet.json');};
 return {async insertIfAbsent(id,packet){
  const target=file(id);await mkdir(base,{recursive:true,mode:0o700});try{await mkdir(path.dirname(target),{mode:0o700});}catch(e){if(e.code==='EEXIST')return false;throw e;}
  await writeFile(target,JSON.stringify(packet)+'\n',{flag:'wx',mode:0o600});return true;
 },async get(id){
  const h=await open(file(id),'r');try{
   const before=await h.stat();if(!before.isFile()||before.size>4194304)throw Error('PACKET_FILE_SIZE');
   const b=Buffer.alloc(4194305);let n=0;for(;;){const {bytesRead}=await h.read(b,n,b.length-n,null);if(!bytesRead)break;n+=bytesRead;if(n>4194304)throw Error('PACKET_FILE_SIZE');}
   const after=await h.stat();if(['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]))throw Error('PACKET_FILE_CHANGED');
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(0,n)));
  }finally{await h.close();}
 }};
}
export async function runCollectorPacketCli(argv,{loadAdapter=async file=>import(pathToFileURL(path.resolve(file)).href),clock=Date.now}={}){
 if(!argv.includes('--enabled'))return {status:'DISABLED',productionWritePerformed:false};
 const opts={},allowed=['--enabled','--adapter-file','--output-dir'];
 for(let i=0;i<argv.length;i++){const k=argv[i];if(!allowed.includes(k)||Object.hasOwn(opts,k))throw Error('PACKET_CLI_ARGUMENT');opts[k]=k==='--enabled'?true:argv[++i];if(opts[k]==null||typeof opts[k]==='string'&&opts[k].startsWith('--'))throw Error('PACKET_CLI_ARGUMENT');}
 if(!opts['--adapter-file']||!opts['--output-dir'])throw Error('PACKET_CLI_PATH_REQUIRED');
 const adapter=await loadAdapter(opts['--adapter-file']);
 const result=await collectCpsiResearchPacket({sourceUrl:adapter.sourceUrl,keyId:adapter.keyId,fetchResponse:adapter.fetchResponse,acquireCard:adapter.acquireCard,prepareEvidence:adapter.prepareEvidence,sign:adapter.sign,loadTrustPolicy:adapter.loadTrustPolicy,store:localCollectorPacketStore(opts['--output-dir']),clock,enabled:true});
 return {...result,readbackScope:'LOCAL_FILESYSTEM',...(result.readbackVerified?{outputFile:path.join(path.resolve(opts['--output-dir']),result.runId,'packet.json')}:{})};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runCollectorPacketCli(process.argv.slice(2));console.log(JSON.stringify(r,null,2));if(r.status==='HOLD')process.exitCode=1;}
 catch{console.error(JSON.stringify({status:'HOLD',reason:'PACKET_CLI_FAILED',readbackVerified:false,sourceOriginAuthenticated:false,formalKpiEligible:false,productionWritePerformed:false}));process.exitCode=1;}
}
