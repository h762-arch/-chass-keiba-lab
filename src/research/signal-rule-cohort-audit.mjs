import {auditFrozenSignalRules} from './signal-rule-audit.mjs';
const rejected=reason=>Object.freeze({status:'REJECTED',reason,summary:null,productionActivationReady:false});
export function isFrozenSignalRaceId(id){
 if(typeof id!=='string'||id.length>160)return false;
 const m=/^(\d{4})(\d{2})(\d{2})-(JRA|NAR)-([^\r\n]+)-(\d{2})$/.exec(id);
 if(!m||Number(m[6])<1||Number(m[6])>99)return false;
 const date=`${m[1]}-${m[2]}-${m[3]}`,stamp=Date.parse(`${date}T00:00:00Z`);
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date;
}

// Explicit local cohort only. No discovery, market/result substitution, persistence or KPI adoption.
export function auditFrozenSignalCohort(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>100||entries.some(e=>!isFrozenSignalRaceId(e?.raceId)))
  return rejected('INVALID_COHORT');
 if(new Set(entries.map(e=>e.raceId)).size!==entries.length)return rejected('DUPLICATE_RACE_ID');
 const observations=[],excluded=[];
 for(const {raceId,record} of [...entries].sort((a,b)=>a.raceId.localeCompare(b.raceId))){
  const market=record?.marketSnapshot,snapshot=market?.signalSnapshot;
  let reason=null;
  if((record?.raceId!=null&&record.raceId!==raceId)||(market?.raceId!=null&&market.raceId!==raceId))
   reason='RACE_IDENTITY_MISMATCH';
  else if(!snapshot)reason='SIGNAL_SNAPSHOT_MISSING';
  else if(snapshot.status==='provisional')reason='SIGNAL_PROVISIONAL';
  const result=reason?null:auditFrozenSignalRules(snapshot);
  if(reason||result.status!=='READY'){
   excluded.push(Object.freeze({raceId,reason:reason||result.reason}));continue;
  }
  observations.push(Object.freeze({raceId,audit:result.audit}));
 }
 const rows=observations.flatMap(o=>o.audit.rows),reasonCounts={};
 for(const e of excluded)reasonCounts[e.reason]=(reasonCounts[e.reason]??0)+1;
 for(const r of rows)for(const reason of r.reasons)reasonCounts[reason]=(reasonCounts[reason]??0)+1;
 return Object.freeze({status:'READY',reason:null,productionActivationReady:false,summary:Object.freeze({
  mode:'research',predictionStage:'NOT_VERIFIED',preRaceTiming:'NOT_VERIFIED',scenarioQuality:'NOT_EVALUATED',
  requestedRaceCount:entries.length,auditedRaceCount:observations.length,excludedRaceCount:excluded.length,
  checkedHorseCount:rows.length,applicableHorseCount:rows.filter(r=>r.status!=='NOT_APPLICABLE').length,
  passHorseCount:rows.filter(r=>r.status==='PASS').length,
  violationHorseCount:rows.filter(r=>r.status==='VIOLATION').length,
  unverifiedHorseCount:rows.filter(r=>r.status==='UNVERIFIED').length,
  reasonCounts:Object.freeze(reasonCounts),observations:Object.freeze(observations),excluded:Object.freeze(excluded)
 })});
}
