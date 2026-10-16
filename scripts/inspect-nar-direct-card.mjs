import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {inspectNarDirectCard} from '../src/research/nar-direct-card-inspection.mjs';
export async function runNarDirectCardCli(args,options={}){
  if(args.length!==6||args[0]!=='--date'||args[2]!=='--code'||args[4]!=='--race'||!validMirrorDate(args[1])||!/^\d{2}$/.test(args[3])||!/^([1-9]|1\d|20)$/.test(args[5]))return {status:'HOLD',reasonCodes:['CLI_ARGUMENTS_INVALID'],requestCount:0,requests:[],meetingVerified:false,meetingToCardStatus:'NOT_PERFORMED',acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
  return inspectNarDirectCard({...options,date:args[1],code:args[3],race:Number(args[5])});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=await runNarDirectCardCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=r.status==='DIRECT_CARD_PARSE_OBSERVED'?0:1;}
