import {buildJraStarShadow} from './jra-star-shadow.mjs';

const fail=(status,reason)=>Object.freeze({status,reason,observation:null});
const MAX_RACES=100;

// Inputs come from the frozen EARLY reader and the separately validated official-result comparator.
// This is a shadow observation, never a formal KPI or an Original Signal.
export function evaluateJraStarShadow({early,officialComparison}={}){
 const star=buildJraStarShadow(early);
 if(star.status!=='CANDIDATE')return fail('EXCLUDED',star.reason);
 if(officialComparison?.status==='PENDING')return fail('PENDING','OFFICIAL_RESULT_NOT_FOUND');
 if(officialComparison?.status!=='READY'||!officialComparison.comparison)
  return fail('EXCLUDED','OFFICIAL_COMPARISON_UNAVAILABLE');
 const c=officialComparison.comparison,s=early.snapshot;
 if(c.raceId!==s.raceId||c.earlyRevision!==s.revision||
    c.calculationVersion!==s.calculationVersion||c.modelVersion!==s.modelVersion)
  return fail('EXCLUDED','EARLY_IDENTITY_MISMATCH');
 if(c.formalKpiEligible!==true||c.postTimeStatus!=='PRE_POST'||c.resultSource!=='JRA_OFFICIAL')
  return fail('EXCLUDED','TEMPORAL_OR_SOURCE_UNVERIFIED');
 if(!Array.isArray(c.runners))return fail('EXCLUDED','RESULT_RUNNER_INVALID');
 const matches=c.runners.filter(h=>h?.horseNo===star.candidate.horseNo);
 if(matches.length!==1||matches[0].matched!==true||
    typeof matches[0].win!=='boolean'||typeof matches[0].top3!=='boolean'||
    (matches[0].win&&!matches[0].top3))return fail('EXCLUDED','RESULT_RUNNER_INVALID');
 return Object.freeze({status:'READY',reason:null,observation:Object.freeze({
  raceId:star.raceId,earlyRevision:star.revision,horseNo:star.candidate.horseNo,
  winHit:matches[0].win,top3Hit:matches[0].top3
 })});
}

// Each race contributes at most one observation; pending and invalid races never count as losses.
export function summarizeJraStarShadow(pairs){
 if(!Array.isArray(pairs)||pairs.length<1||pairs.length>MAX_RACES)return fail('REJECTED','INVALID_COHORT');
 const ids=pairs.map(pair=>pair?.early?.snapshot?.raceId);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
  return fail('REJECTED','INVALID_COHORT');
 const observations=[],excluded=[],reasons={};
 for(const pair of [...pairs].sort((a,b)=>a.early.snapshot.raceId.localeCompare(b.early.snapshot.raceId))){
  const evaluated=evaluateJraStarShadow(pair);
  if(evaluated.status==='READY')observations.push(evaluated.observation);
  else{
   excluded.push(Object.freeze({raceId:pair.early.snapshot.raceId,status:evaluated.status,reason:evaluated.reason}));
   reasons[evaluated.reason]=(reasons[evaluated.reason]??0)+1;
  }
 }
 const count=observations.length,winHits=observations.filter(o=>o.winHit).length,
  top3Hits=observations.filter(o=>o.top3Hit).length;
 return Object.freeze({status:'READY',reason:null,summary:Object.freeze({
  requestedRaceCount:pairs.length,observedRaceCount:count,excludedRaceCount:excluded.length,
  winHits,top3Hits,winHitRate:count?winHits/count:null,top3HitRate:count?top3Hits/count:null,
  reasonCounts:Object.freeze(reasons),observations:Object.freeze(observations),excluded:Object.freeze(excluded)
 })});
}
