import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {verifyJraAuditEvidence} from './jra-audit-evidence-verifier.mjs';

// Local offline verification. No remote credentials, D1 operation, network or output file writes.
export function runEvidenceVerifierCli(args){
 const keys=new Set(['--file','--sha256','--target-date','--commit-sha']),options={};
 for(let i=0;i<args.length;i+=2){
  if(!keys.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))
   return {status:'REJECTED',reason:'INVALID_CLI_ARGUMENTS',productionActivationReady:false};
  options[args[i]]=args[i+1];
 }
 if(Object.keys(options).length!==keys.size)return {status:'REJECTED',reason:'INVALID_CLI_ARGUMENTS',productionActivationReady:false};
 try{
  const stat=statSync(options['--file']);
  if(!stat.isFile()||stat.size>2*1024*1024)throw Error('invalid file');
  return verifyJraAuditEvidence({json:readFileSync(options['--file'],'utf8'),sha256:options['--sha256'],
   targetDate:options['--target-date'],commitSha:options['--commit-sha']});
 }catch{return {status:'REJECTED',reason:'EVIDENCE_FILE_READ_FAILED',productionActivationReady:false};}
}

if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=runEvidenceVerifierCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));
 if(result.status!=='VERIFIED')process.exitCode=1;
}
