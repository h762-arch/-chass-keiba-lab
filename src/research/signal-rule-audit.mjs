const POLICY='CHASS-SIGNAL-v1.0';
const diamonds=new Map([['💎',1],['💎💎',2],['💎💎💎',3]]);
const warnings=new Set(['⚠️','⚠️⚠️','⚠️⚠️⚠️']);
const marks=new Set(['◎','○','▲','△','☆']);
const warningFactors=new Set(['PACE_COLLAPSE','DISTANCE_RISK','COURSE_RISK','STABILITY_RISK',
 'CONDITION_RISK','WEIGHT_RISK','JOCKEY_COURSE_RISK','TIME_RISK']);
const abilityEvidence=new Set(['TIME_TOP','DISTANCE_FIT','COURSE_FIT','RECENT_CONTENT','PACE_FIT','LAST3F','REBOUND']);
const text=value=>typeof value==='string'&&value.trim().length>0;
const finite=value=>typeof value==='number'&&Number.isFinite(value);

// Structural research audit only. Never assign marks, evaluate scenario quality, or repair Original Signals.
// Old snapshots without captured market facts remain unverified; current/result odds are never substituted.
export function auditFrozenSignalRules(snapshot){
 if(snapshot?.policyVersion!==POLICY||snapshot.schemaVersion!==1||snapshot.status!=='frozen'||
  !Number.isFinite(Date.parse(snapshot.frozenAt))||!Array.isArray(snapshot.horses)||
  snapshot.horses.length<1||snapshot.horses.length>99)
  return Object.freeze({status:'REJECTED',reason:'INVALID_FROZEN_SNAPSHOT',audit:null});
 const ids=snapshot.horses.map(h=>h?.horseNo);
 if(ids.some(n=>!Number.isInteger(n)||n<1||n>99)||new Set(ids).size!==ids.length)
  return Object.freeze({status:'REJECTED',reason:'INVALID_HORSE_IDENTITY',audit:null});
 const rows=[];
 for(const h of [...snapshot.horses].sort((a,b)=>a.horseNo-b.horseNo)){
  const errors=[],unknown=[],diamond=h.valueMark||'',warning=h.warningMark||'';
  if(!diamond&&!warning){rows.push(Object.freeze({horseNo:h.horseNo,status:'NOT_APPLICABLE',reasons:Object.freeze([])}));continue;}
  if(diamond&&!diamonds.has(diamond))errors.push('INVALID_DIAMOND_MARK');
  if(warning&&!warnings.has(warning))errors.push('INVALID_WARNING_MARK');
  if(warning&&(diamond||h.winValueMark||h.placeValueMark||marks.has(h.abilityMarkAtFreeze)||
   marks.has(h.finalMarkAtFreeze)))errors.push('WARNING_MARK_CONFLICT');
  if(warning&&(typeof h.abilityMarkAtFreeze!=='string'||typeof h.finalMarkAtFreeze!=='string'))
   unknown.push('FROZEN_MARK_EXCLUSIVITY_UNAVAILABLE');
  const popularity=h.popularityAtFreeze;
  const marketVerified=Number.isInteger(popularity)&&popularity>=1&&popularity<=99&&
   finite(h.oddsAtFreeze)&&h.oddsAtFreeze>0&&finite(h.evAtFreeze)&&h.evAtFreeze>=0;
  if(!marketVerified)unknown.push('FROZEN_MARKET_BASIS_UNAVAILABLE');
  if(warnings.has(warning)){
   const s=h.warningScenario;
   // A no-odds warning may have been frozen before this market snapshot. Do not reinterpret it.
   if(s?.targetBasis!=='market_top3')unknown.push('ORIGINAL_WARNING_BASIS_UNVERIFIED');
   else if(marketVerified&&popularity>3)errors.push('WARNING_POPULARITY_OUT_OF_RANGE');
   if(s?.policyVersion!==POLICY||!text(s.scenario)||!/4着以下/.test(s.scenario)||
    !Array.isArray(s.factors)||!s.factors.some(f=>warningFactors.has(f?.code)&&text(f.label)))
    errors.push('WARNING_SCENARIO_OR_ABILITY_MISSING');
  }
  if(diamonds.has(diamond)){
   const level=diamonds.get(diamond),s=h.longshotScenario;
   if(marketVerified&&popularity<(level===3?9:6))errors.push('DIAMOND_POPULARITY_OUT_OF_RANGE');
   if(s?.policyVersion!==POLICY||!text(s.scenario)||
    (level===1?s.level!=='place':!['win','big_win'].includes(s.level)))errors.push('DIAMOND_SCENARIO_MISSING');
   const evidence=Array.isArray(s?.evidence)?s.evidence:[];
   const concrete=evidence.filter(e=>abilityEvidence.has(e?.code)&&text(e.label));
   if(concrete.length===0)errors.push('DIAMOND_ABILITY_EVIDENCE_MISSING');
   if(s?.marketValue!==true)errors.push('DIAMOND_MARKET_VALUE_UNVERIFIED');
   const uniqueEvidence=[...new Map(concrete.map(e=>[e.code,e])).values()];
   if(level===3&&(uniqueEvidence.length<2||
    uniqueEvidence.reduce((sum,e)=>sum+(finite(e.strength)?e.strength:0),0)<4))
    errors.push('BIG_DIAMOND_STRONG_EVIDENCE_MISSING');
  }
  rows.push(Object.freeze({horseNo:h.horseNo,status:errors.length?'VIOLATION':unknown.length?'UNVERIFIED':'PASS',
   reasons:Object.freeze([...new Set([...errors,...unknown])])}));
 }
 return Object.freeze({status:'READY',reason:null,audit:Object.freeze({policyVersion:POLICY,
  frozenAt:snapshot.frozenAt,mode:'research',scenarioQuality:'NOT_EVALUATED',
  checkedHorseCount:rows.length,violationCount:rows.filter(r=>r.status==='VIOLATION').length,
  unverifiedCount:rows.filter(r=>r.status==='UNVERIFIED').length,rows:Object.freeze(rows)})});
}
