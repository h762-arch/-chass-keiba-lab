import {createHash} from 'node:crypto';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessEarlySnapshotBeforeSave} from '../src/prediction/early-prefreeze-snapshot-mapping-v1.mjs';

export const VERSION='CHASS_EARLY_AVAILABILITY_DRY_RUN_V1';
const MAX_BYTES=1_000_000;
const hash=x=>createHash('sha256').update(x,'utf8').digest('hex');
const authority=()=>({dryRun:true,saved:false,freezeExecuted:false,
  assessmentBasis:'LOCAL_JSON_BYTES_AND_CALLER_DECLARATIONS',
  inputOriginAuthenticated:false,clockAuthority:'LOCAL_PROCESS_CLOCK',
  formalKpiReadiness:'HOLD',formalKpiEligible:false,earlyFreezeVerified:false,
  freezeExecutionAuthorized:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'});
function failed(reason){return {version:VERSION,status:'HOLD',reasons:[reason],...authority()};}

// observedAt is injectable only for deterministic tests of this pure evaluator.
// The CLI always samples its own clock after reading both files; it has no replay
// date, --now, network, storage, freeze or save option.
export function evaluateEarlyAvailabilityDryRun(snapshotJson,contextJson,observedAt){
  try{
    if(typeof snapshotJson!=='string'||typeof contextJson!=='string'
      ||Buffer.byteLength(snapshotJson)>MAX_BYTES||Buffer.byteLength(contextJson)>MAX_BYTES)return failed('INVALID_OR_OVERSIZE_JSON_TEXT');
    if(!Number.isSafeInteger(observedAt)||!Number.isFinite(new Date(observedAt).getTime()))return failed('INVALID_OBSERVATION_CLOCK');
    const mapped=assessEarlySnapshotBeforeSave(snapshotJson,contextJson,observedAt);
    const input=mapped.input,assessment=mapped.availability;
    const reasons=[...mapped.mappingReasons,...assessment.holdReasons];
    const jstDate=new Date(observedAt+9*3600_000).toISOString().slice(0,10);
    if(input?.raceDate!==jstDate)reasons.push('NOT_CURRENT_JST_RACE_DATE');
    const startAt=Date.parse(input?.startAt);
    if(!Number.isFinite(startAt)||observedAt>=startAt)reasons.push('NOT_PRESTART_AT_OBSERVATION');
    if(!assessment.predictionCanFreeze&&!reasons.length)reasons.push('AVAILABILITY_HOLD');
    const uniqueReasons=[...new Set(reasons)];
    return {version:VERSION,status:uniqueReasons.length?'HOLD':'LOCAL_PRESTART_MAPPING_READY',
      observedAt:new Date(observedAt).toISOString(),observedJstDate:jstDate,
      snapshotSha256:hash(snapshotJson),contextSha256:hash(contextJson),
      snapshotBytes:Buffer.byteLength(snapshotJson),contextBytes:Buffer.byteLength(contextJson),
      format:mapped.format,raceId:typeof input?.raceId==='string'?input.raceId:null,
      cutoff:typeof input?.freezeAt==='string'?input.freezeAt:null,
      runnerCount:Array.isArray(input?.runners)?input.runners.length:0,
      final5Count:Array.isArray(input?.final5)?input.final5.length:0,
      mappedPredictionReadiness:assessment.predictionReadiness,
      reasons:uniqueReasons,degradedReasons:assessment.degradedReasons,
      ...authority()};
  }catch{return failed('DRY_RUN_INPUT_INVALID');}
}

async function readBoundedJson(path){
  let handle;
  try{
    handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=await handle.stat();
    if(!stat.isFile()||stat.size>MAX_BYTES)throw Error();
    const bytes=Buffer.alloc(MAX_BYTES+1);
    let length=0;
    while(length<bytes.length){
      const r=await handle.read(bytes,length,bytes.length-length,null);
      if(!r.bytesRead)break;
      length+=r.bytesRead;
    }
    if(length>MAX_BYTES)throw Error();
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes.subarray(0,length));
  }finally{await handle?.close();}
}

export async function runEarlyAvailabilityDryRunCli(args){
  try{
    if(!Array.isArray(args)||args.length!==4)throw Error();
    const flags=new Map();
    for(let i=0;i<args.length;i+=2){
      if(!['--snapshot','--context'].includes(args[i])||flags.has(args[i])||typeof args[i+1]!=='string'||!args[i+1]||args[i+1].startsWith('--'))throw Error();
      flags.set(args[i],args[i+1]);
    }
    if(flags.size!==2)throw Error();
    const snapshotJson=await readBoundedJson(flags.get('--snapshot'));
    const contextJson=await readBoundedJson(flags.get('--context'));
    return evaluateEarlyAvailabilityDryRun(snapshotJson,contextJson,Date.now());
  }catch{return failed('LOCAL_INPUT_OR_ARGUMENTS_INVALID');}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runEarlyAvailabilityDryRunCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=report.status==='LOCAL_PRESTART_MAPPING_READY'?0:2;
}
