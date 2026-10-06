import {readFileSync,statSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
import {runFrozenSignalComparisonCli,frozenSignalComparisonExitCode} from './compare-frozen-signals.mjs';
const rejected=reason=>({status:'REJECTED',reason,productionActivationReady:false});

// Reproduce a READY research output, including pending/excluded observations, from local inputs.
// VERIFIED means reproducible only; neither file provenance nor Production readiness is authenticated.
export async function verifyFrozenSignalComparisonCli(args){
 const keys=new Set(['--backup','--cache','--comparison']),options={};
 for(let i=0;i<args.length;i+=2){
  if(!keys.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))
   return rejected('INVALID_CLI_ARGUMENTS');
  options[args[i]]=args[i+1];
 }
 if(Object.keys(options).length!==3)return rejected('INVALID_CLI_ARGUMENTS');
 let saved;
 try{
  const file=options['--comparison'],stat=statSync(file);
  if(!stat.isFile()||stat.size>32*1024*1024)throw Error('invalid file');
  saved=JSON.parse(readFileSync(file,'utf8'));
 }catch{return rejected('COMPARISON_FILE_READ_FAILED');}
 if(saved?.status!=='READY'||saved.evidenceSchemaVersion!=='CHASS-SIGNAL-COMPARISON-1'||
  typeof saved.evaluationNow!=='string'||!Array.isArray(saved.requestedRaceIds)||
  saved.requestedRaceIds.length<1||saved.requestedRaceIds.length>100||
  saved.requestedRaceIds.some(id=>typeof id!=='string'||id.includes(',')))
  return rejected('COMPARISON_METADATA_INVALID');
 const replay=await runFrozenSignalComparisonCli(['--backup',options['--backup'],'--cache',options['--cache'],
  '--race-ids',saved.requestedRaceIds.join(','),'--now',saved.evaluationNow]);
 if(replay.status!=='READY')return rejected('COMPARISON_REPLAY_FAILED');
 if(!isDeepStrictEqual(saved,replay))return rejected('COMPARISON_REPLAY_MISMATCH');
 return {status:'VERIFIED',reason:null,verificationScope:'LOCAL_INPUT_REPRODUCIBILITY',
  inputProvenance:'LOCAL_FILES_NOT_AUTHENTICATED',formalKpiEligible:false,productionActivationReady:false,
  comparisonExitCode:frozenSignalComparisonExitCode(replay),backupSha256:replay.backupSha256,
  cacheSha256:replay.cacheSha256,evaluationNow:replay.evaluationNow,requestedRaceIds:replay.requestedRaceIds};
}
// node scripts/verify-frozen-signal-comparison.mjs --backup backup.json --cache cache.json --comparison comparison.json
// stdout JSON only; exit 0 reproducible research output, 1 rejected. No network or input writes.
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=await verifyFrozenSignalComparisonCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='VERIFIED'?0:1;
}
