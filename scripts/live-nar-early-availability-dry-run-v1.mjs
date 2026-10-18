import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {evaluateEarlyAvailabilityDryRun} from './dry-run-early-availability-v1.mjs';

export const VERSION='CHASS_LIVE_NAR_EARLY_AVAILABILITY_DRY_RUN_V1';
export const MAX_WAIT_MS=120_000;
export const MAX_CAPTURE_MS=10_000;
export const MAX_RESPONSE_BYTES=1_000_000;
export const DIAGNOSTICS_VERSION='CHASS_LIVE_NAR_SAFE_DIAGNOSTICS_V1';

// Never emit exception messages, stacks, URLs, sourceRef, bodies or snapshots.
const safeErrorCodes=new Set([
  'ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED',
  'LIVE_CAPTURE_TIMEOUT','LIVE_CAPTURE_CLOCK_INVALID','CUTOFF_REACHED_BEFORE_ACQUISITION',
  'LIVE_CAPTURE_CONTRACT_INVALID','LIVE_CAPTURE_CANCELLED','LIVE_CAPTURE_URL_INVALID',
  'LIVE_CAPTURE_URL_FORBIDDEN','LIVE_CAPTURE_REQUEST_FORBIDDEN','LIVE_CAPTURE_REQUEST_LIMIT',
  'LIVE_CAPTURE_REDIRECT_FORBIDDEN','LIVE_CAPTURE_RESPONSE_LIMIT','LIVE_CAPTURE_ROSTER_LIMIT',
  'APP_SOURCE_INVALID','NAR_RESEARCH_ACQUIRE_UNAVAILABLE','LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN',
  'nar_early_disabled','nar_early_identity_invalid','nar_early_reference_rejected',
  'nar_early_time_invalid','nar_early_horses_missing','parser_error','network_error',
  'nar_timeout','nar_temporary','http_error','timeout','aborted'
]);
function safeErrorCode(error){
  try{
    for(const code of [error?.cause?.code,error?.code,error?.message]){
      if(typeof code==='string'&&safeErrorCodes.has(code))return code;
    }
    if(error?.name==='SyntaxError')return 'SYNTAX_ERROR';
    if(error?.name==='ReferenceError')return 'REFERENCE_ERROR';
    if(error?.name==='TypeError')return 'TYPE_ERROR';
    if(error?.name==='AbortError')return 'ABORT_ERROR';
  }catch{}
  return 'UNCLASSIFIED_ERROR';
}
const isoTime=value=>Number.isSafeInteger(value)&&Number.isFinite(new Date(value).getTime())
  ?new Date(value).toISOString():null;

const authority=()=>({
  liveCapture:true,
  acquisitionCompleted:false,
  dryRun:true,
  saved:false,
  freezeExecuted:false,
  assessmentBasis:'LIVE_NAR_APP_ACQUISITION_PLUS_CALLER_DECLARED_CUTOFF',
  inputOriginAuthenticated:false,
  clockAuthority:'LOCAL_PROCESS_CLOCK',
  formalKpiReadiness:'HOLD',
  formalKpiEligible:false,
  earlyFreezeVerified:false,
  freezeExecutionAuthorized:false,
  probabilityDecision:'MODEL_HOLD',
  productionActivationDecision:'NO-GO'
});
const failed=(reason,extra={})=>({
  version:VERSION,
  status:'HOLD',
  reasons:[reason],
  ...authority(),
  ...extra
});

function strictTimestamp(x){
  if(typeof x!=='string')return NaN;
  const m=x.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/);
  if(!m)return NaN;
  const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number);
  if(
    y<1000||mo<1||mo>12||
    d<1||d>new Date(Date.UTC(y,mo,0)).getUTCDate()||
    h>23||mi>59||s>59
  )return NaN;
  if(m[8]!=='Z'&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4,6))>59))return NaN;
  return Date.parse(x);
}

function normalizeBaseUrl(value){
  if(typeof value!=='string'||!value.trim())return null;
  try{
    const u=new URL(value.trim());
    const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
    if(u.username||u.password||u.search||u.hash||u.pathname!=='/')return null;
    if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))return null;
    return u.origin;
  }catch{return null}
}

function boundedRaceId(value){
  return typeof value==='string'
    && value.length>=5
    && value.length<=200
    && value===value.trim()
    && !/[\x00-\x1f\x7f]/.test(value)
    ? value
    : null;
}

function clockDate(clock){
  return class ClockDate extends Date{
    constructor(...args){super(...(args.length?args:[clock()]));}
    static now(){return clock();}
  };
}

async function boundedPayload(response){
  let payload;
  if(response?.body?.getReader){
    const reader=response.body.getReader(),chunks=[];let total=0;
    try{
      while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_RESPONSE_BYTES)throw Error('LIVE_CAPTURE_RESPONSE_LIMIT');chunks.push(Buffer.from(value));}
      payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));
    }catch(error){try{await reader.cancel();}catch{}throw error;}
    finally{reader.releaseLock();}
  }else{
    payload=await response.json();
    const raw=JSON.stringify(payload);
    if(typeof raw!=='string'||Buffer.byteLength(raw)>MAX_RESPONSE_BYTES)throw Error('LIVE_CAPTURE_RESPONSE_LIMIT');
  }
  // Bound app calculation work before its model/snapshot functions are called.
  if(!Array.isArray(payload?.horses)||payload.horses.length<2||payload.horses.length>30)throw Error('LIVE_CAPTURE_ROSTER_LIMIT');
  return payload;
}

async function loadAppCore({
  baseUrl,
  fetchImpl=globalThis.fetch,
  clock=Date.now,
  appSource,scope,signal,raceParts,diagnostics
}={}){
  const origin=normalizeBaseUrl(baseUrl);
  if(!origin||typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('LIVE_CAPTURE_CONTRACT_INVALID');
  diagnostics.phase='APP_SOURCE_READ';
  const source=typeof appSource==='string'
    ?appSource
    :await readFile(new URL('../app.js',import.meta.url),'utf8');
  if(!source||source.length>5_000_000)throw Error('APP_SOURCE_INVALID');
  diagnostics.appSourceSha256=createHash('sha256').update(source,'utf8').digest('hex');

  const window={__CHASS_TEST__:true};
  const writes=scope.writes;
  const document={
    getElementById(){return null;},
    querySelector(){return null;},
    querySelectorAll(){return [];}
  };
  const safeFetch=async(input,init)=>{
    diagnostics.phase='REQUEST_VALIDATE';
    if(!scope.active||signal.aborted)throw Error('LIVE_CAPTURE_CANCELLED');
    const raw=typeof input==='string'?input:input?.url;
    if(typeof raw!=='string')throw Error('LIVE_CAPTURE_URL_INVALID');
    const target=new URL(raw,origin);
    if(target.origin!==origin||target.pathname!=='/api/nar/race'||target.username||target.password||target.hash)throw Error('LIVE_CAPTURE_URL_FORBIDDEN');
    const entries=[...target.searchParams.entries()];
    if(entries.length!==3||new Set(entries.map(([k])=>k)).size!==3
      ||target.searchParams.get('date')!==raceParts[0]||target.searchParams.get('race')!==raceParts[2]
      ||!/^\d{1,2}$/.test(target.searchParams.get('code')||'')
      ||(init?.method??'GET')!=='GET'||init?.body!=null||init?.headers!=null)throw Error('LIVE_CAPTURE_REQUEST_FORBIDDEN');
    if(++scope.requests!==1)throw Error('LIVE_CAPTURE_REQUEST_LIMIT');
    diagnostics.requestCount=scope.requests;
    diagnostics.phase='FETCH_TRANSPORT';
    const response=await fetchImpl(target.toString(),{...init,method:'GET',credentials:'omit',redirect:'error',signal});
    diagnostics.responseReceived=true;
    diagnostics.httpStatus=Number.isInteger(response?.status)&&response.status>=100&&response.status<=599?response.status:null;
    diagnostics.phase='RESPONSE_VALIDATE';
    if(response?.redirected||(response?.url&&response.url!==target.toString()))throw Error('LIVE_CAPTURE_REDIRECT_FORBIDDEN');
    return {ok:response.ok,status:response.status,json:async()=>{
      diagnostics.phase='RESPONSE_BODY';
      const payload=await boundedPayload(response);
      diagnostics.responseParsed=true;
      diagnostics.phase='APP_ACQUISITION';
      return payload;
    }};
  };
  const DateImpl=clockDate(clock);
  const sandbox={
    window,document,
    localStorage:{
      getItem(){return null;},
      setItem(){writes.push('localStorage');throw Error('LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN');},
      removeItem(){writes.push('localStorage');throw Error('LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN');},
      clear(){writes.push('localStorage');throw Error('LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN');}
    },
    fetch:safeFetch,
    console:{log(){},info(){},warn(){},error(){},debug(){}},
    setTimeout:scope.setTimeout,clearTimeout:scope.clearTimeout,
    setInterval:scope.setInterval,clearInterval:scope.clearInterval,
    AbortController,
    Date:DateImpl,Math,JSON,Number,String,Array,Object,Map,Set,RegExp,URL,Blob,TextEncoder,
    structuredClone
  };
  diagnostics.phase='APP_VM_INIT';
  vm.createContext(sandbox);
  vm.runInContext(source,sandbox,{filename:'app.js',timeout:1000});
  const core=window.CHASS_TEST;
  if(typeof core?.acquireNarEarlyResearchRecord!=='function')throw Error('NAR_RESEARCH_ACQUIRE_UNAVAILABLE');
  if(writes.length)throw Error('LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN');
  return {core,writes,appSourceSha256:createHash('sha256').update(source,'utf8').digest('hex')};
}

function captureScope(){
  const timeouts=new Set(),intervals=new Set();
  const scope={active:true,writes:[],requests:0};
  scope.setTimeout=(fn,ms,...args)=>{
    if(!scope.active)return null;
    const h=setTimeout(()=>{timeouts.delete(h);if(scope.active)fn(...args);},ms);
    timeouts.add(h);return h;
  };
  scope.clearTimeout=h=>{clearTimeout(h);timeouts.delete(h);};
  scope.setInterval=(fn,ms,...args)=>{
    if(!scope.active)return null;
    const h=setInterval(()=>{if(scope.active)fn(...args);},ms);
    intervals.add(h);return h;
  };
  scope.clearInterval=h=>{clearInterval(h);intervals.delete(h);};
  scope.dispose=()=>{scope.active=false;for(const h of timeouts)clearTimeout(h);for(const h of intervals)clearInterval(h);timeouts.clear();intervals.clear();};
  return scope;
}

function mergeReasons(report,reasons){
  const extra=(reasons||[]).filter(Boolean);
  if(!extra.length)return report;
  return {
    ...report,
    status:'HOLD',
    reasons:[...new Set([...(report?.reasons||[]),...extra])]
  };
}

export async function evaluateLiveNarEarlyAvailabilityDryRun({
  baseUrl,
  raceId,
  freezeAt,
  expectedRunnerCount,
  fetchImpl=globalThis.fetch,
  clock=Date.now,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  appSource,captureTimeoutMs=MAX_CAPTURE_MS
}={}){
  const diagnostics={version:DIAGNOSTICS_VERSION,phase:'INPUT_VALIDATE',
    startedAt:null,cutoff:null,captureCompletedAt:null,evaluatedAt:null,finishedAt:null,
    requestCount:0,responseReceived:false,responseParsed:false,httpStatus:null,
    appSourceSha256:null,errorCode:null};
  const finish=(report,at)=>{
    if(at===undefined){try{at=clock();}catch{at=null;}}
    diagnostics.finishedAt=isoTime(at);
    return {...report,diagnostics:{...diagnostics}};
  };
  const fail=(reason,extra={})=>finish(failed(reason,extra));
  try{
    const safeRaceId=boundedRaceId(raceId);
    const expected=typeof expectedRunnerCount==='string'&&/^\d{1,2}$/.test(expectedRunnerCount)
      ?Number(expectedRunnerCount)
      :expectedRunnerCount;
    const cutoff=strictTimestamp(freezeAt);
    const started=clock();
    diagnostics.startedAt=isoTime(started);
    diagnostics.cutoff=Number.isFinite(cutoff)?new Date(cutoff).toISOString():null;

    if(
      !normalizeBaseUrl(baseUrl)||
      !safeRaceId||
      !Number.isSafeInteger(expected)||expected<2||expected>30||
      !Number.isFinite(cutoff)||
      !Number.isSafeInteger(started)||!Number.isFinite(new Date(started).getTime())||
      !Number.isSafeInteger(captureTimeoutMs)||captureTimeoutMs<1||captureTimeoutMs>MAX_CAPTURE_MS
    )return fail('LIVE_CAPTURE_INPUT_INVALID');

    if(cutoff<=started)return fail('CUTOFF_ALREADY_PASSED_BEFORE_CAPTURE',{
      cutoff:freezeAt,
      observedAt:new Date(started).toISOString()
    });
    if(cutoff-started>MAX_WAIT_MS)return fail('CUTOFF_TOO_FAR_FOR_LIVE_DRY_RUN',{
      cutoff:freezeAt,
      observedAt:new Date(started).toISOString()
    });

    const raceParts=safeRaceId.split('|');
    if(raceParts.length!==3||!Number.isFinite(strictTimestamp(raceParts[0]+'T00:00:00Z'))
      ||!/^([1-9]|1\d|20)$/.test(raceParts[2]))return fail('LIVE_CAPTURE_INPUT_INVALID');
    if(raceParts[0]!==new Date(started+9*3600000).toISOString().slice(0,10))return fail('NOT_CURRENT_JST_RACE_DATE');
    const scope=captureScope(),controller=new AbortController();
    let deadline,acquired,appSourceSha256;
    try{
      const capture=(async()=>{
        const loaded=await loadAppCore({baseUrl,fetchImpl,clock,appSource,scope,signal:controller.signal,raceParts,diagnostics});
        const {core}=loaded;appSourceSha256=loaded.appSourceSha256;
        if(!scope.active)throw Error('LIVE_CAPTURE_TIMEOUT');
        const before=clock();
        if(!Number.isSafeInteger(before)||before<started)throw Error('LIVE_CAPTURE_CLOCK_INVALID');
        if(before>=cutoff)throw Error('CUTOFF_REACHED_BEFORE_ACQUISITION');
        diagnostics.phase='APP_ACQUISITION';
        return core.acquireNarEarlyResearchRecord({raceId:safeRaceId,enabled:true});
      })();
      const timeout=new Promise((_,reject)=>{deadline=setTimeout(()=>{controller.abort();scope.dispose();reject(Error('LIVE_CAPTURE_TIMEOUT'));},Math.min(captureTimeoutMs,cutoff-started));});
      acquired=await Promise.race([capture,timeout]);
    }catch(error){
      const allowed=['LIVE_CAPTURE_TIMEOUT','LIVE_CAPTURE_CLOCK_INVALID','CUTOFF_REACHED_BEFORE_ACQUISITION'];
      diagnostics.errorCode=safeErrorCode(error);
      return fail(allowed.includes(error?.message)?error.message:'LIVE_CAPTURE_FAILED');
    }finally{
      clearTimeout(deadline);controller.abort();scope.dispose();
    }
    if(scope.writes.length)return fail('LIVE_DRY_RUN_STORAGE_WRITE_FORBIDDEN');

    diagnostics.phase='RECEIPT_VALIDATE';

    const snapshotJson=JSON.stringify(acquired?.record);
    const contextJson=JSON.stringify({
      freezeAt,
      expectedRunnerCount:expected,
      sourceReceipt:acquired?.sourceReceipt??null
    });

    const completed=clock();
    diagnostics.captureCompletedAt=isoTime(completed);
    const extraReasons=[];
    if(!Number.isSafeInteger(completed)||completed<started)return fail('LIVE_CAPTURE_CLOCK_INVALID');
    const acquiredAt=strictTimestamp(acquired?.acquiredAt);
    if(acquired?.acquisitionKind!=='fresh'||!Number.isFinite(acquiredAt)||acquiredAt<started||acquiredAt>completed)return fail('LIVE_CAPTURE_RECEIPT_INVALID');
    if(completed>cutoff)extraReasons.push('CAPTURE_COMPLETED_AFTER_CUTOFF');

    let waited=completed;
    diagnostics.phase='CUTOFF_WAIT';
    while(waited<cutoff){
      if(typeof sleep!=='function')return fail('LIVE_CAPTURE_SLEEP_INVALID');
      await sleep(Math.min(1000,cutoff-waited));
      const next=clock();
      if(!Number.isSafeInteger(next)||next<=waited)return fail('LIVE_CAPTURE_CLOCK_INVALID');
      waited=next;
    }

    const observed=clock();
    if(!Number.isSafeInteger(observed)||observed<waited)return fail('LIVE_CAPTURE_CLOCK_INVALID');
    if(observed<cutoff)extraReasons.push('CUTOFF_NOT_REACHED_AFTER_WAIT');

    diagnostics.phase='AVAILABILITY_EVALUATE';
    diagnostics.evaluatedAt=isoTime(observed);
    const report=evaluateEarlyAvailabilityDryRun(snapshotJson,contextJson,observed);
    return finish(mergeReasons({
      ...report,
      liveCaptureVersion:VERSION,
      liveCapture:true,
      acquisitionKind:acquired?.acquisitionKind==='fresh'?'fresh':'unknown',
      sourceReceiptScope:acquired?.sourceReceipt?.scope??null,
      sourceReceiptHorseCount:Array.isArray(acquired?.sourceReceipt?.horseNos)
        ?acquired.sourceReceipt.horseNos.length
        :0,
      ...authority(),
      acquisitionCompleted:true,
      appSourceSha256,
      testAppSourceOverride:appSource!==undefined
    },extraReasons),observed);
  }catch(error){
    diagnostics.errorCode=safeErrorCode(error);
    return fail('LIVE_CAPTURE_FAILED');
  }
}

function parseArgs(args){
  if(!Array.isArray(args)||args.length!==8)return null;
  const allowed=new Set(['--base-url','--race-id','--freeze-at','--expected-runner-count']);
  const flags=new Map();
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!allowed.has(key)||flags.has(key)||typeof value!=='string'||!value||value.startsWith('--'))return null;
    flags.set(key,value);
  }
  return flags.size===4?flags:null;
}

export async function runLiveNarEarlyAvailabilityDryRunCli(args){
  const flags=parseArgs(args);
  if(!flags)return failed('LIVE_CAPTURE_ARGUMENTS_INVALID');
  return evaluateLiveNarEarlyAvailabilityDryRun({
    baseUrl:flags.get('--base-url'),
    raceId:flags.get('--race-id'),
    freezeAt:flags.get('--freeze-at'),
    expectedRunnerCount:flags.get('--expected-runner-count')
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await runLiveNarEarlyAvailabilityDryRunCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  process.exitCode=report.status==='LOCAL_PRESTART_MAPPING_READY'?0:2;
}
