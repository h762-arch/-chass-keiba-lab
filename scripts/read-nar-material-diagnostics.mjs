import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {readNarMaterialDiagnostics} from '../src/research/nar-material-diagnostic-reader.mjs';

export async function runNarDiagnosticReaderCli(args,options={}){
 const hold=reason=>({status:'HOLD',reasonCodes:[reason],readAudit:{status:'NOT_ATTEMPTED',requestCount:0},acceptance:null,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
 if(![4,5].includes(args.length)||args[0]!=='--bundle'||args[2]!=='--date'||!validMirrorDate(args[3])||(args.length===5&&args[4]!=='--historical'))return hold('CLI_ARGUMENTS_INVALID');
 let b;try{if(!statSync(args[1]).isFile()||statSync(args[1]).size>1000000)return hold('BUNDLE_READ_UNAVAILABLE');const bytes=readFileSync(args[1]);if(bytes.byteLength>1000000)return hold('BUNDLE_READ_UNAVAILABLE');b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return hold('BUNDLE_READ_UNAVAILABLE');}
 return readNarMaterialDiagnostics(b,{...options,expectedDate:args[3],mode:args.length===5?'HISTORICAL':'CURRENT'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=await runNarDiagnosticReaderCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=['INSPECTION_READY','HISTORICAL_INSPECTION_READY','NO_DIAGNOSTIC_TASKS'].includes(r.status)?0:1;}
