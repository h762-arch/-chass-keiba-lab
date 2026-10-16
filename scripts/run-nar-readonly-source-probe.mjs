import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {preflightNarCandidateCard} from '../src/research/nar-candidate-card-preflight.mjs';
import {inspectNarDirectCard} from '../src/research/nar-direct-card-inspection.mjs';

const repo='h762-arch/-chass-keiba-lab';
const tracks=['10','11','18','19','20','21','22','23','24','27','28','31','32','36'];
const flags={schemaVersion:'chass-nar-readonly-source-probe-v1',scope:'STANDALONE_SOURCE_DIAGNOSTIC',researchOnly:true,
  acquisitionCertified:false,currentStatusEligible:false,formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',
  productionSourceChanged:false,snapshotCreated:false,savedDataVerification:'NOT_PERFORMED',collectionStatus:'NOT_EVALUATED',mirrorFreshness:'NOT_EVALUATED',
  production404Cause:'NOT_ESTABLISHED',workerReplay:'NOT_PERFORMED'};
export function narProbeExecutionContext(env={}){
  if(!env||typeof env!=='object'||Array.isArray(env))return null;
  if(env.GITHUB_ACTIONS===undefined)return {executionEnvironment:'LOCAL_DECLARED',sourceSha:null,runUrl:null};
  if(['GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_REF','GITHUB_EVENT_NAME','GITHUB_SHA','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'].some(k=>typeof env[k]!=='string'))return null;
  if(env.GITHUB_ACTIONS!=='true'||env.GITHUB_REPOSITORY!==repo||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')||!/^\d{1,20}$/.test(env.GITHUB_RUN_ID||'')||!/^\d{1,6}$/.test(env.GITHUB_RUN_ATTEMPT||'')||BigInt(env.GITHUB_RUN_ID)===0n||BigInt(env.GITHUB_RUN_ATTEMPT)===0n)return null;
  return {executionEnvironment:'GITHUB_ACTIONS_DECLARED',sourceSha:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,
    runUrl:`https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}`};
}
// Uses actual existing readers; no port can inject a fabricated meeting result.
export async function runNarReadOnlySourceProbe(args,{fetchImpl=globalThis.fetch,wallNow=Date.now,env={}}={}){
  const execution=narProbeExecutionContext(env);let preflight=null,directCard=null,started,previous,clockFault=false;
  const finish=(status,reasonCodes,extra={})=>({...flags,status,reasonCodes,execution,preflight,directCard,
    requestCount:(preflight?.requestCount||0)+(directCard?.requestCount||0),...extra});
  const clock=()=>{const n=wallNow();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime())||(previous!==undefined&&n<previous)){clockFault=true;throw Error('CLOCK_INVALID');}previous=n;return n;};
  if(!execution)return finish('HOLD',['EXECUTION_CONTEXT_INVALID']);
  if(!Array.isArray(args)||args.length!==6||args[0]!=='--date'||args[2]!=='--code'||args[4]!=='--race'||!validMirrorDate(args[1])||!tracks.includes(args[3])||typeof args[5]!=='string'||!/^([1-9]|1\d|20)$/.test(args[5])||typeof wallNow!=='function'||typeof fetchImpl!=='function')return finish('HOLD',['CLI_ARGUMENTS_INVALID']);
  try{
    started=clock();const date=args[1],code=args[3],race=Number(args[5]);
    if(new Date(started+9*3600000).toISOString().slice(0,10)!==date)return finish('HOLD',['CURRENT_JST_DATE_REQUIRED']);
    const input={date,code,race,fetchImpl,wallNow:clock};
    preflight=await preflightNarCandidateCard(input);
    if(clockFault)return finish('HOLD',['CLOCK_INVALID']);
    // Stop at meeting-to-card success. Otherwise one separate direct inspection.
    if(preflight.status!=='CANDIDATE_CARD_OBSERVED')directCard=await inspectNarDirectCard(input);
    const finished=clock();if(clockFault)return finish('HOLD',['CLOCK_INVALID']);
    if(new Date(finished+9*3600000).toISOString().slice(0,10)!==date)return finish('HOLD',['REQUEST_DATE_CHANGED']);
    const timing={date,code,race,startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString(),
      meetingToCardStatus:preflight.status==='CANDIDATE_CARD_OBSERVED'?'OBSERVED':'NOT_OBSERVED',
      directCardStatus:directCard?.status??'NOT_PERFORMED_STOPPED_AFTER_PREFLIGHT_SUCCESS'};
    if(preflight.status==='CANDIDATE_CARD_OBSERVED')return finish('MEETING_TO_CARD_OBSERVED',[],timing);
    if(directCard?.status==='DIRECT_CARD_PARSE_OBSERVED')return finish('DIRECT_CARD_ONLY_OBSERVED',['MEETING_TO_CARD_NOT_OBSERVED'],timing);
    return finish('HOLD',['NO_CARD_PARSE_OBSERVED'],timing);
  }catch{return finish('HOLD',[clockFault?'CLOCK_INVALID':'PROBE_EXECUTION_UNAVAILABLE']);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const report=await runNarReadOnlySourceProbe(process.argv.slice(2),{env:process.env});
  const json=JSON.stringify(report,null,2)+'\n',digest=createHash('sha256').update(json).digest('hex');
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/nar-readonly-source-probe.json',json);
  await writeFile('artifacts/nar-readonly-source-probe.sha256',`${digest}  nar-readonly-source-probe.json\n`);
  process.stdout.write(json);process.exitCode=report.status==='MEETING_TO_CARD_OBSERVED'?0:1;
}
