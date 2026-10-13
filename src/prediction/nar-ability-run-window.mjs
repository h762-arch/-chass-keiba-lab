const dayMs=86400000;
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const validTime=t=>/^([01]\d|2[0-3]):[0-5]\d$/.test(t||'');
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
