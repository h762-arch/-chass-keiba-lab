import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {narAbilityRunWindow} from '../src/prediction/nar-ability-run-window.mjs';
import {NAR_VENUE_ROUTING_VERSION,snapshotNarTrackCode} from '../src/nar/nar-venue-routing.mjs';

const baseline={NAR_PRECOMPUTE_TRACK_CODES:'21',NAR_PRECOMPUTE_RUN_MODE:'daily',NAR_PRECOMPUTE_DAILY_FROM:'2026-10-14',NAR_PRECOMPUTE_DAILY_UNTIL:'2026-10-20',NAR_PRECOMPUTE_DAILY_START_JST:'07:00',NAR_PRECOMPUTE_DAILY_STOP_JST:'14:55',NAR_PRECOMPUTE_MAX_JOBS:'3',NAR_PRECOMPUTE_BUDGET_MS:'20000'};
const governance={researchOnly:true,formalKpiEligible:false,productionActivationReady:false,probabilityStatus:'MODEL_HOLD',productionEvidence:false};
const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
// Planning only: no fetch, DB, runner, credential, writer, or deployment port.
export function inspectNarVenueTrialPlan(plan,currentVars){
 const reasons=[];
 if(plan?.schemaVersion!==1||plan?.scope!=='REVIEW_ONLY_NOT_RUNTIME_CONFIG')reasons.push('PLAN_CONTRACT_INVALID');
 if(!validDate(plan?.calendarCheckedOnJst))reasons.push('CALENDAR_CHECK_DATE_INVALID');
 if(!plan?.expectedCurrent||Object.keys(plan.expectedCurrent).length!==Object.keys(baseline).length||Object.entries(baseline).some(([k,v])=>plan.expectedCurrent[k]!==v||currentVars?.[k]!==v))reasons.push('BASELINE_CONFIGURATION_CHANGED');
 const candidates=plan?.candidates;
 if(!Array.isArray(candidates)||candidates.length!==2||new Set(candidates.map(c=>c?.code)).size!==2)reasons.push('CANDIDATES_INVALID');
 const proposals=[];
 for(const candidate of Array.isArray(candidates)?candidates.slice(0,2):[]){
  const {code,track,date}=candidate||{};
  if(!['22','23'].includes(code)||snapshotNarTrackCode({venueRoutingVersion:NAR_VENUE_ROUTING_VERSION,race:{track}})!==code){reasons.push('VENUE_PAIR_INVALID');continue;}
  if(!validDate(date)||!validDate(plan.calendarCheckedOnJst)||date<=plan.calendarCheckedOnJst){reasons.push('CANDIDATE_DATE_INVALID');continue;}
  const evidence=Array.isArray(plan.calendarEvidence)?plan.calendarEvidence.find(e=>e?.code===code&&e.track===track&&e.date===date):null;
  // These references are recorded human checks, never a live availability check.
  const expectedUrl=code==='22'?'https://www.keiba.go.jp/KeibaWeb/MonthlyConveneInfo/MonthlyConveneInfoTop?k_month=10&k_year=2026':'https://www.kasamatsu-keiba.com/schedule';
  if(evidence?.url!==expectedUrl){reasons.push('CALENDAR_REFERENCE_MISSING');continue;}
  if(!date.startsWith('2026-10-')){reasons.push('CALENDAR_MONTH_MISMATCH');continue;}
  const vars={NAR_PRECOMPUTE_TRACK_CODES:code,NAR_PRECOMPUTE_RUN_MODE:'daily',NAR_PRECOMPUTE_DAILY_FROM:date,NAR_PRECOMPUTE_DAILY_UNTIL:date,NAR_PRECOMPUTE_DAILY_START_JST:'07:00',NAR_PRECOMPUTE_DAILY_STOP_JST:'14:55',NAR_PRECOMPUTE_MAX_JOBS:'1',NAR_PRECOMPUTE_BUDGET_MS:'20000'};
  const start=Date.parse(date+'T07:00:00+09:00'),stop=Date.parse(date+'T14:55:00+09:00');
  const checks={beforeStartClosed:!narAbilityRunWindow(vars,start-1).active,startActive:narAbilityRunWindow(vars,start).active,beforeStopActive:narAbilityRunWindow(vars,stop-1).active,stopClosed:!narAbilityRunWindow(vars,stop).active,nextDayClosed:!narAbilityRunWindow(vars,start+86400000).active};
  if(!Object.values(checks).every(Boolean))reasons.push('WINDOW_CONTRACT_FAILED');
  proposals.push({code,track,date,vars,windowChecks:checks,afterCurrentTrial:date>baseline.NAR_PRECOMPUTE_DAILY_UNTIL,perInvocationJobLimit:1,totalTrialSaveLimit:null,acquisitionAvailability:'NOT_CHECKED',calendarEvidenceKind:'RECORDED_HUMAN_CHECK_NOT_REVERIFIED'});
 }
 const ok=reasons.length===0;
 return {schemaVersion:1,scope:'CONFIGURATION_PLAN_ONLY',...governance,status:ok?'PLAN_CHECK_PASS':'HOLD',executionStatus:'HOLD',deploymentReady:false,reasons:[...new Set(reasons)],requiredBeforeExecution:['RECHECK_OFFICIAL_SCHEDULE_AND_CARD','VERIFY_LIVE_SCHEMA_AND_BASELINE_READBACK','REVIEW_SEPARATE_RUNTIME_CONFIG_DIFF','SET_RESTORE_OR_EXPIRE_PLAN'],proposals:ok?proposals:[]};
}
export function runNarVenueTrialPreflightCli(args){
 if(args.length)return {...governance,status:'HOLD',executionStatus:'HOLD',deploymentReady:false,reasons:['CLI_ARGUMENTS_UNSUPPORTED'],proposals:[]};
 try{return inspectNarVenueTrialPlan(JSON.parse(readFileSync(new URL('../config/nar-venue-trial-plan.json',import.meta.url),'utf8')),JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8')).vars);}
 catch{return {...governance,status:'HOLD',executionStatus:'HOLD',deploymentReady:false,reasons:['PLAN_READ_FAILED'],proposals:[]};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=runNarVenueTrialPreflightCli(process.argv.slice(2));process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='PLAN_CHECK_PASS'?0:1;}
