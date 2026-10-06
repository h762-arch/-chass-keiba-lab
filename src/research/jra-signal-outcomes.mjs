import {auditFrozenSignalRules} from './signal-rule-audit.mjs';
import {isFrozenSignalRaceId} from './signal-rule-cohort-audit.mjs';
const fail=(status,reason)=>Object.freeze({status,reason,observation:null});
const warningMarks=new Set(['⚠️','⚠️⚠️','⚠️⚠️⚠️']);

// Research observations from an Original Signal and the existing validated official-result comparator.
// A Signal Freeze is not proof of EARLY identity. Never promote this output to a formal KPI.
export function evaluateJraFrozenSignalOutcomes({raceId,signalSnapshot,early,officialComparison}={}){
 if(!isFrozenSignalRaceId(raceId)||!raceId.includes('-JRA-'))return fail('EXCLUDED','INVALID_RACE_ID');
 const audited=auditFrozenSignalRules(signalSnapshot);
 if(audited.status!=='READY')return fail('EXCLUDED',audited.reason);
 const s=early?.snapshot,c=officialComparison?.comparison;
 if(early?.status!=='READY'||s?.raceId!==raceId||!Number.isInteger(s.revision)||s.revision<1||
  typeof s.calculationVersion!=='string'||!s.calculationVersion||typeof s.modelVersion!=='string'||!s.modelVersion)
  return fail('EXCLUDED','EARLY_UNAVAILABLE');
 if(officialComparison?.status==='PENDING')return fail('PENDING','OFFICIAL_RESULT_NOT_FOUND');
 if(officialComparison?.status!=='READY'||!c)return fail('EXCLUDED','OFFICIAL_COMPARISON_UNAVAILABLE');
 if(c.raceId!==raceId||c.earlyRevision!==s.revision||c.calculationVersion!==s.calculationVersion||
  c.modelVersion!==s.modelVersion||c.earlyCalculatedAt!==s.dataCalculatedAt)
  return fail('EXCLUDED','EARLY_IDENTITY_MISMATCH');
 const postTime=s.data?.race?.postTime;
 if(c.resultSource!=='JRA_OFFICIAL'||c.formalKpiEligible!==true||c.postTimeStatus!=='PRE_POST'||
  typeof postTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(postTime))
  return fail('EXCLUDED','TEMPORAL_OR_SOURCE_UNVERIFIED');
 const d=raceId.slice(0,8),postAt=Date.parse(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6)}T${postTime}:00+09:00`),
  earlyAt=Date.parse(s.dataCalculatedAt),frozenAt=Date.parse(signalSnapshot.frozenAt),resultAt=Date.parse(c.resultFetchedAt);
 if(![earlyAt,frozenAt,resultAt,postAt].every(Number.isFinite)||earlyAt>=postAt||
  frozenAt<earlyAt||frozenAt>=postAt||resultAt<postAt)
  return fail('EXCLUDED','SIGNAL_TIMING_UNVERIFIED');
 const runners=c.runners;
 if(!Array.isArray(runners)||runners.some(h=>!Number.isInteger(h?.horseNo)||h.horseNo<1||h.horseNo>99||
  typeof h.matched!=='boolean'||(h.matched&&(typeof h.win!=='boolean'||typeof h.top3!=='boolean'||(h.win&&!h.top3))))||
  new Set(runners.map(h=>h.horseNo)).size!==runners.length)
  return fail('EXCLUDED','RESULT_RUNNER_INVALID');
 const observed=new Map(runners.map(h=>[h.horseNo,h])),signals=new Map(signalSnapshot.horses.map(h=>[h.horseNo,h])),
  observations=[],excluded=[];
 for(const row of audited.audit.rows){
  if(row.status==='NOT_APPLICABLE')continue;
  if(row.status!=='PASS'){
   excluded.push(Object.freeze({horseNo:row.horseNo,reason:`SIGNAL_${row.status}`,reasons:row.reasons}));continue;
  }
  const actual=observed.get(row.horseNo),signal=signals.get(row.horseNo);
  if(!actual?.matched){excluded.push(Object.freeze({horseNo:row.horseNo,reason:'RESULT_RUNNER_UNMATCHED'}));continue;}
  const mark=signal.warningMark||signal.valueMark,
   target=warningMarks.has(mark)?'FOURTH_OR_WORSE':mark==='💎'?'SECOND_OR_THIRD':'WIN',
   hit=target==='FOURTH_OR_WORSE'?!actual.top3:target==='SECOND_OR_THIRD'?actual.top3&&!actual.win:actual.win;
  observations.push(Object.freeze({horseNo:row.horseNo,mark,target,hit,win:actual.win,top3:actual.top3}));
 }
 return Object.freeze({status:'READY',reason:null,observation:Object.freeze({raceId,mode:'research',
  predictionStage:'SIGNAL_FREEZE',formalKpiEligible:false,productionActivationReady:false,
  scenarioQuality:'NOT_EVALUATED',frozenAt:signalSnapshot.frozenAt,resultSource:c.resultSource,
  observedHorseCount:observations.length,excludedHorseCount:excluded.length,
  observations:Object.freeze(observations),excluded:Object.freeze(excluded)})});
}
