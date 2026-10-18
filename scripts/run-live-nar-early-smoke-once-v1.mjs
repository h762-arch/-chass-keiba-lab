import {readFile} from 'node:fs/promises';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const VERSION='CHASS_NAR_EARLY_SMOKE_ONCE_V1';
export const BASE_URL='https://chass-keiba-lab7.h7625421.workers.dev';
export const CHILD_TIMEOUT_MS=125_000;
const root=fileURLToPath(new URL('../',import.meta.url));
const sha=x=>createHash('sha256').update(x).digest('hex');
const flags=new Set(['--race-id','--post-at','--expected-runner-count','--expected-commit']);
const authority={formalKpiReadiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',saved:false,freezeExecuted:false};
const hold=(reason,extra={})=>({version:VERSION,status:'HOLD',reasons:[reason],...authority,...extra});

function parseArgs(args){
  if(!Array.isArray(args)||args.length!==8)return null;
  const map=new Map();
  for(let i=0;i<args.length;i+=2){
    if(!flags.has(args[i])||map.has(args[i])||typeof args[i+1]!=='string'||!args[i+1]||args[i+1].startsWith('--'))return null;
    map.set(args[i],args[i+1]);
  }
  return Object.fromEntries(map);
}

// Pure scheduling validation only. This does not fetch, calculate or save a prediction.
export function planNarSmokeOnce(input,now,actualCommit){
  if(!Number.isSafeInteger(now)||!Number.isFinite(new Date(now).getTime()))return hold('PROCESS_CLOCK_INVALID');
  if(!input||!/^\d{4}-\d{2}-\d{2}\|[^|\x00-\x1f\x7f]{1,40}\|(?:[1-9]|1\d|20)$/.test(input['--race-id']||'')
    ||!/^\d{1,2}$/.test(input['--expected-runner-count']||'')
    ||Number(input['--expected-runner-count'])<2||Number(input['--expected-runner-count'])>30
    ||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(input['--post-at']||'')
    ||!Number.isFinite(Date.parse(input['--post-at']))
    ||!/^[0-9a-f]{40}$/.test(input['--expected-commit']||'')||!/^[0-9a-f]{40}$/.test(actualCommit||''))return hold('ONE_SHOT_INPUT_INVALID');
  if(input['--expected-commit']!==actualCommit)return hold('COMMIT_MISMATCH');
  const date=input['--race-id'].split('|')[0];
  const jstDate=new Date(now+9*3600000).toISOString().slice(0,10);
  if(date!==jstDate)return hold('NOT_CURRENT_JST_RACE_DATE');
  const post=Date.parse(input['--post-at']);
  if(new Date(post+9*3600000).toISOString().slice(0,10)!==date)return hold('POST_DATE_CONFLICT');
  if(now>=post)return hold('NOT_PRESTART_AT_LAUNCH');
  if(now+30_000>=post)return hold('INSUFFICIENT_PRESTART_WINDOW');
  return {version:VERSION,status:'LAUNCH_READY',commit:actualCommit,
    raceId:input['--race-id'],expectedRunnerCount:Number(input['--expected-runner-count']),
    callerDeclaredPostAt:new Date(post).toISOString(),launchAt:new Date(now).toISOString(),
    freezeAt:new Date(now+30_000).toISOString(),...authority};
}

export async function runNarSmokeOnce(args,{
  clock=Date.now,readFileImpl=readFile,execImpl=execFileSync,spawnImpl=spawnSync,onLaunch=()=>{}
}={}){
  const input=parseArgs(args);
  if(!input)return hold('ONE_SHOT_ARGUMENTS_INVALID');
  let plan;
  try{
    // No shell interpolation, credentials, npm install, network preflight or retries.
    const commit=execImpl('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    const dirty=execImpl('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    if(dirty)return hold('WORKTREE_NOT_CLEAN');
    const config=await readFileImpl(new URL('../wrangler.jsonc',import.meta.url),'utf8');
    const origins=[...config.matchAll(/"CHASS_PUBLIC_ORIGIN"\s*:\s*"([^"\r\n]+)"/g)];
    if(origins.length!==1||origins[0][1]!==BASE_URL)return hold('BASE_ORIGIN_NOT_CONFIRMED');
    const app=await readFileImpl(new URL('../app.js',import.meta.url),'utf8');
    const appSourceSha256=sha(app);
    // One real-process clock sample immediately before launch fixes the only Cutoff.
    plan=planNarSmokeOnce(input,clock(),commit);
    if(plan.status!=='LAUNCH_READY')return plan;
    const cliArgs=['scripts/live-nar-early-availability-dry-run-v1.mjs',
      '--base-url',BASE_URL,'--race-id',plan.raceId,'--freeze-at',plan.freezeAt,
      '--expected-runner-count',String(plan.expectedRunnerCount)];
    const metadata={...plan,appSourceSha256,invocationSha256:sha(JSON.stringify(cliArgs)),
      acquisitionInputSha256:null,runnerExitCode:null,completedAt:null,runnerInvocations:1};
    onLaunch({...metadata});
    const child=spawnImpl(process.execPath,cliArgs,{cwd:root,encoding:'utf8',
      timeout:CHILD_TIMEOUT_MS,maxBuffer:1_000_000,stdio:['ignore','pipe','pipe'],killSignal:'SIGTERM'});
    metadata.completedAt=new Date(clock()).toISOString();
    metadata.runnerExitCode=Number.isInteger(child.status)?child.status:null;
    if(child.error||child.signal)return hold(child.error?.code==='ETIMEDOUT'?'CHILD_PROCESS_TIMEOUT':'CHILD_PROCESS_FAILED',{execution:metadata});
    let report;
    try{report=JSON.parse(child.stdout);}catch{return hold('RUNNER_JSON_INVALID',{execution:metadata});}
    if(!report||!['HOLD','LOCAL_PRESTART_MAPPING_READY'].includes(report.status)
      ||report.saved!==false||report.freezeExecuted!==false
      ||report.formalKpiReadiness!=='HOLD'||report.probabilityDecision!=='MODEL_HOLD'
      ||report.productionActivationDecision!=='NO-GO')return hold('RUNNER_REPORT_CONTRACT_INVALID',{execution:metadata});
    const expectedExit=report.status==='LOCAL_PRESTART_MAPPING_READY'?0:2;
    if(child.status!==expectedExit)return hold('RUNNER_EXIT_CONFLICT',{execution:metadata});
    metadata.acquisitionInputSha256=/^[0-9a-f]{64}$/.test(report.snapshotSha256||'')?report.snapshotSha256:null;
    return {version:VERSION,status:report.status,reasons:report.reasons,...authority,execution:metadata,runnerReport:report};
  }catch{
    // Do not echo git, child stderr, exception text, API response or local paths.
    return hold('ONE_SHOT_ENVIRONMENT_FAILED',plan?{execution:plan}:{});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runNarSmokeOnce(process.argv.slice(2),{
    onLaunch:execution=>process.stderr.write(JSON.stringify({launch:execution})+'\n')
  });
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=report.status==='LOCAL_PRESTART_MAPPING_READY'?0:2;
}
