import {readFileSync,statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createOfflineSignalOutcomeDb} from './compare-frozen-signals.mjs';
const limit=32*1024*1024;
const reject=reason=>({status:'REJECTED',reason,cache:null,formalKpiEligible:false,productionActivationReady:false});
function input(file){
 const stat=statSync(file);
 if(!stat.isFile()||stat.size>limit)throw Error('EXPORT_FILE_READ_FAILED');
 const bytes=readFileSync(file);
 if(bytes.length>limit)throw Error('EXPORT_FILE_READ_FAILED');
 return {data:JSON.parse(bytes.toString('utf8')),sha256:createHash('sha256').update(bytes).digest('hex')};
}
function rows(data,format){
 if(!Array.isArray(data))throw Error('EXPORT_FORMAT_INVALID');
 if(format==='rows')return data;
 // Explicit format: one successful statement, never silently select among several results.
 if(data.length!==1||data[0]?.success!==true||!Array.isArray(data[0]?.results)||
  Object.hasOwn(data[0],'error')||(Object.hasOwn(data[0],'errors')&&
   (!Array.isArray(data[0].errors)||data[0].errors.length)))throw Error('EXPORT_FORMAT_INVALID');
 return data[0].results;
}
// Offline packaging only. Preserve every row, including malformed earliest DATA and absent results.
export function runFrozenSignalCacheImportCli(args){
 const options={},keys=new Set(['--snapshots','--results','--format']);
 for(let i=0;i<args.length;i+=2){
  if(!keys.has(args[i])||Object.hasOwn(options,args[i])||!args[i+1]||args[i+1].startsWith('--'))return reject('INVALID_CLI_ARGUMENTS');
  options[args[i]]=args[i+1];
 }
 if(Object.keys(options).length!==3||!['rows','d1-json'].includes(options['--format']))return reject('INVALID_CLI_ARGUMENTS');
 let snapshots,results,snapshotRows,resultRows;
 try{snapshots=input(options['--snapshots']);results=input(options['--results']);}
 catch{return reject('EXPORT_FILE_READ_FAILED');}
 try{snapshotRows=rows(snapshots.data,options['--format']);resultRows=rows(results.data,options['--format']);}
 catch{return reject('EXPORT_FORMAT_INVALID');}
 const cache={schemaVersion:'CHASS-JRA-SIGNAL-CACHE-1',snapshotRows,resultRows,
  exportProvenance:{schemaVersion:'CHASS-SIGNAL-EXPORT-PROVENANCE-1',format:options['--format'],
   snapshotExportSha256:snapshots.sha256,resultExportSha256:results.sha256,
   inputProvenance:'LOCAL_FILES_NOT_AUTHENTICATED'}};
 try{createOfflineSignalOutcomeDb(cache);}catch{return reject('CACHE_INPUT_INVALID');}
 if(Buffer.byteLength(JSON.stringify(cache))+1>limit)return reject('CACHE_OUTPUT_TOO_LARGE');
 return {status:'READY',reason:null,cache,formalKpiEligible:false,productionActivationReady:false};
}
// Success: stdout compact cache JSON, exit 0. Rejection: stdout empty, diagnostics on stderr, exit 1.
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 const result=runFrozenSignalCacheImportCli(process.argv.slice(2));
 if(result.status==='READY'){process.stdout.write(JSON.stringify(result.cache)+'\n');process.exitCode=0;}
 else{console.error(JSON.stringify(result));process.exitCode=1;}
}
