import {readFileSync,statSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {buildNarMaterialInvestigationPlan} from '../src/research/nar-material-investigation-plan.mjs';

export function runNarMaterialInvestigationCli(args,{now=Date.now()}={}){
 const hold=reason=>({status:'HOLD',reasonCodes:[reason],executionStatus:'NOT_EXECUTED',requests:[],races:[],probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
 if(![4,5].includes(args.length)||args[0]!=='--bundle'||args[2]!=='--date'||!validMirrorDate(args[3])||(args.length===5&&args[4]!=='--historical'))return hold('CLI_ARGUMENTS_INVALID');
 try{
  if(!statSync(args[1]).isFile()||statSync(args[1]).size>1000000)return hold('BUNDLE_READ_UNAVAILABLE');
  const bytes=readFileSync(args[1]);if(bytes.byteLength>1000000)return hold('BUNDLE_READ_UNAVAILABLE');
  const b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return buildNarMaterialInvestigationPlan(b,{expectedDate:args[3],now,mode:args.length===5?'HISTORICAL':'CURRENT'});
 }catch{return hold('BUNDLE_READ_UNAVAILABLE');}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=runNarMaterialInvestigationCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=['PLAN_READY','HISTORICAL_PLAN_READY'].includes(r.status)?0:1;}
