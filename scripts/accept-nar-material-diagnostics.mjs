import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {acceptNarMaterialDiagnostics} from '../src/research/nar-material-diagnostic-acceptance.mjs';
function read(file){if(!statSync(file).isFile()||statSync(file).size>1000000)throw Error();const bytes=readFileSync(file);if(bytes.byteLength>1000000)throw Error();return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export function runNarDiagnosticAcceptanceCli(args,{now=Date.now()}={}){
 const hold=reason=>({status:'HOLD',reasonCodes:[reason],observations:[],probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
 if(![6,7].includes(args.length)||args[0]!=='--bundle'||args[2]!=='--diagnostics'||args[4]!=='--date'||!validMirrorDate(args[5])||(args.length===7&&args[6]!=='--historical'))return hold('CLI_ARGUMENTS_INVALID');
 try{return acceptNarMaterialDiagnostics(read(args[1]),read(args[3]),{expectedDate:args[5],now,mode:args.length===7?'HISTORICAL':'CURRENT'});}catch{return hold('LOCAL_JSON_UNAVAILABLE');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=runNarDiagnosticAcceptanceCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=['INSPECTION_READY','HISTORICAL_INSPECTION_READY','NO_DIAGNOSTIC_TASKS'].includes(r.status)?0:1;}
