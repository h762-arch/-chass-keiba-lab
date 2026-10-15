import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {reportNarStatusCoverage} from '../src/research/nar-status-coverage-report.mjs';

// Bundle-only CLI. No HTTP, DB, write API, max-age or clock override flags.
export function runNarStatusCoverageCli(args,{now=Date.now()}={}){
 const fail=reasonCode=>({status:'HOLD',reasonCodes:[reasonCode],rows:[],totals:null,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
 if(args.length!==4||args[0]!=='--bundle'||args[2]!=='--date'||!validMirrorDate(args[3]))return fail('CLI_ARGUMENTS_INVALID');
 try{
  if(!statSync(args[1]).isFile()||statSync(args[1]).size>1000000)return fail('BUNDLE_READ_UNAVAILABLE');
  const bytes=readFileSync(args[1]);if(bytes.byteLength>1000000)return fail('BUNDLE_READ_UNAVAILABLE');
  const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return reportNarStatusCoverage(bundle,{expectedDate:args[3],now});
 }catch{return fail('BUNDLE_READ_UNAVAILABLE');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=runNarStatusCoverageCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=r.status==='OBSERVED'?0:1;}
