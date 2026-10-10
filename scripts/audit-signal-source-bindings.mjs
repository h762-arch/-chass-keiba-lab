import { readFileSync,statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readSignalSourceBindingCohort,SIGNAL_BINDING_READ_SQL } from '../src/research/signal-source-binding-reader.mjs';

// Offline captured DB export + previously frozen receipt selection. No remote
// credentials, discovery, source fetching, writes or output files are used.
export async function runSignalSourceBindingCli(args){
 const fail=reason=>({status:'REJECTED',reason,mode:'research',productionActivationReady:false});
 if(args.length!==4||args[0]!=='--rows'||args[2]!=='--selections'||
  !args[1]||!args[3]||args[1].startsWith('--')||args[3].startsWith('--'))return fail('INVALID_CLI_ARGUMENTS');
 let rows,selections;
 try{
  const read=path=>{const stat=statSync(path);if(!stat.isFile()||stat.size>16*1024*1024)throw Error('file_limit');
   return JSON.parse(readFileSync(path,'utf8'));};
  rows=read(args[1]);selections=read(args[3]);
  if(!Array.isArray(rows)||rows.length>100||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('rows');
  const ids=rows.map(r=>JSON.stringify([r.race_id,r.model_version]));
  if(new Set(ids).size!==ids.length)throw Error('duplicate_rows');
 }catch{return fail('CAPTURE_FILE_READ_FAILED');}
 const DB={prepare(sql){if(sql!==SIGNAL_BINDING_READ_SQL)throw Error('unsupported_query');
  return {bind(raceId,modelVersion){return {async first(){
   return rows.find(r=>r.race_id===raceId&&r.model_version===modelVersion)||null;
  }}}};
 }};
 return readSignalSourceBindingCohort({DB,selections});
}
export function signalSourceBindingExitCode(result){
 if(result.status!=='OBSERVED')return 1;
 if(result.rows.some(r=>r.status==='REJECTED'||r.status==='VIOLATION'))return 2;
 if(result.rows.some(r=>r.status==='UNVERIFIED'))return 3;
 return 0;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=await runSignalSourceBindingCli(process.argv.slice(2));
 console.log(JSON.stringify(result,null,2));process.exitCode=signalSourceBindingExitCode(result);
}
