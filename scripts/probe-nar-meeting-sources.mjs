import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {probeNarMeetingSources} from '../src/research/nar-meeting-source-probe.mjs';
export async function runNarMeetingProbeCli(args,options={}) {
  const hold=reason=>({status:'HOLD',reasonCodes:[reason],requestCount:0,observations:[],acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
  if(args.length!==6||args[0]!=='--bundle'||args[2]!=='--date'||args[4]!=='--code'||!validMirrorDate(args[3])||!/^\d{2}$/.test(args[5]))return hold('CLI_ARGUMENTS_INVALID');
  let b;try{const s=statSync(args[1]);if(!s.isFile()||s.size>1000000)throw Error();const bytes=readFileSync(args[1]);if(bytes.byteLength>1000000)throw Error();b=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return hold('BUNDLE_READ_UNAVAILABLE');}
  return probeNarMeetingSources(b,{...options,expectedDate:args[3],code:args[5]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const r=await runNarMeetingProbeCli(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=r.status==='MEETING_RESPONSE_OBSERVED'?0:1;}
