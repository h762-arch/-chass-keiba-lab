const dayMs=86400000;
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const validTime=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');
// Narrow, date-scoped replacement; never extends the existing daily window.
export function narAbilityCollectionSelection(env,now){
 const keys=['NAR_PRECOMPUTE_DATED_TRIAL_DATE','NAR_PRECOMPUTE_DATED_TRIAL_CODE','NAR_PRECOMPUTE_DATED_TRIAL_MAX_JOBS'];
 const base={valid:true,trackCodes:env.NAR_PRECOMPUTE_TRACK_CODES,maxJobs:env.NAR_PRECOMPUTE_MAX_JOBS,datedTrial:null};
 if(!keys.some(k=>Object.hasOwn(env,k)))return base;
 const invalid=()=>({valid:false,trackCodes:'',maxJobs:null,datedTrial:{status:'INVALID'}});
 if(!Number.isFinite(now)||!keys.every(k=>Object.hasOwn(env,k)))return invalid();
 const target=env.NAR_PRECOMPUTE_DATED_TRIAL_DATE,code=env.NAR_PRECOMPUTE_DATED_TRIAL_CODE,limit=env.NAR_PRECOMPUTE_DATED_TRIAL_MAX_JOBS;
 if(env.NAR_PRECOMPUTE_RUN_MODE!=='daily'||typeof target!=='string'||!validDate(target)||code!=='22'||limit!=='1'||env.NAR_PRECOMPUTE_TRACK_CODES!=='21'||env.NAR_PRECOMPUTE_MAX_JOBS!=='3'||Number(env.NAR_PRECOMPUTE_BUDGET_MS||20000)!==20000||narAbilityRunWindow(env,now).status==='BLOCKED'||target<env.NAR_PRECOMPUTE_DAILY_FROM||target>env.NAR_PRECOMPUTE_DAILY_UNTIL)return invalid();
 const today=new Date(now+9*3600000).toISOString().slice(0,10),selected=today===target;
 return {...base,trackCodes:selected?code:base.trackCodes,maxJobs:selected?limit:base.maxJobs,datedTrial:{date:target,code,maxJobsPerInvocation:1,totalTrialSaveLimit:null,status:selected?'SELECTED_DATE':today<target?'SCHEDULED':'EXPIRED',appliesToCurrentDate:selected}};
}
// Date and clock are always JST. Default preserves the one-day canary contract.
export function narAbilityRunWindow(env,now){
 const mode=env.NAR_PRECOMPUTE_RUN_MODE||'canary',date=new Date(now+9*3600000).toISOString().slice(0,10);
 const blocked=reason=>({mode,date,active:false,status:'BLOCKED',reason});
 const closed=(reason,stop)=>({mode,date,stop,active:false,status:'SKIPPED',reason});
 if(mode==='canary'){
  const d=env.NAR_PRECOMPUTE_CANARY_DATE,value=env.NAR_PRECOMPUTE_STOP_AT||'',stop=Date.parse(value),start=Date.parse(`${d}T00:00:00+09:00`);
  if(!validDate(d)||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(stop)||stop<=start||stop>start+dayMs)return blocked('CANARY_CONFIGURATION_INVALID');
  if(date!==d||now>=stop)return closed('CANARY_WINDOW_CLOSED',stop);
  return {mode,date,stop,active:true,status:'ACTIVE'};
 }
 if(mode!=='daily')return blocked('RUN_MODE_INVALID');
 const from=env.NAR_PRECOMPUTE_DAILY_FROM,until=env.NAR_PRECOMPUTE_DAILY_UNTIL,startTime=env.NAR_PRECOMPUTE_DAILY_START_JST,stopTime=env.NAR_PRECOMPUTE_DAILY_STOP_JST;
 // Require an explicit, at most seven-day trial; no perpetual daily activation.
 if(!validDate(from)||!validDate(until)||until<from||Date.parse(until)-Date.parse(from)>6*dayMs||!validTime(startTime)||!validTime(stopTime)||startTime>=stopTime)return blocked('DAILY_CONFIGURATION_INVALID');
 const start=Date.parse(`${date}T${startTime}:00+09:00`),stop=Date.parse(`${date}T${stopTime}:00+09:00`);
 if(date<from||date>until)return closed('DAILY_DATE_CLOSED',stop);
 if(now<start||now>=stop)return closed('DAILY_WINDOW_CLOSED',stop);
 return {mode,date,start,stop,active:true,status:'ACTIVE'};
}
