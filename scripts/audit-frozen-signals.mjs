import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {auditFrozenSignalCohort} from '../src/research/signal-rule-cohort-audit.mjs';

// Usage: node scripts/audit-frozen-signals.mjs --file cohort.json
// Input: [{raceId,record}], where record.marketSnapshot.signalSnapshot is the saved Original Signal.
// Offline stdout only. Exit 1: invalid input; 2: rule violations; 3: exclusions/unverified horses; 0: structural audit complete.
export function runFrozenSignalAuditCli(args){
 if(args.length!==2||args[0]!=='--file'||!args[1]||args[1].startsWith('--'))
  return {status:'REJECTED',reason:'INVALID_CLI_ARGUMENTS',summary:null,productionActivationReady:false};
 try{
  const stat=statSync(args[1]);
  if(!stat.isFile()||stat.size>2*1024*1024)throw Error('invalid file');
  return auditFrozenSignalCohort(JSON.parse(readFileSync(args[1],'utf8')));
 }catch{return {status:'REJECTED',reason:'COHORT_FILE_READ_FAILED',summary:null,productionActivationReady:false};}
}
export function frozenSignalAuditExitCode(result){
 if(result.status!=='READY')return 1;
 if(result.summary.violationHorseCount)return 2;
 if(result.summary.excludedRaceCount||result.summary.unverifiedHorseCount)return 3;
 return 0;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=runFrozenSignalAuditCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));
 process.exitCode=frozenSignalAuditExitCode(result);
}
