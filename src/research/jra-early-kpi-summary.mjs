import {compareJraEarlyToOfficialResult} from './jra-early-result-kpi.mjs';

const MAX_RACES=100;
const validRaceId=value=>typeof value==='string'&&/^\d{8}-JRA-.+-\d{2}$/.test(value);
const mean=values=>values.length?Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(6)):null;
const failure=reason=>Object.freeze({status:'REJECTED',reason,summary:null});

// Explicit, bounded race cohort. The comparison reader owns all D1 SELECTs and validation.
// No race discovery, persistence, network access or public route is introduced here.
export async function summarizeJraEarlyResultKpi({DB,raceIds,now=Date.now()}={}){
 if(!DB?.prepare)return failure('D1_UNAVAILABLE');
 if(!Number.isFinite(now))return failure('INVALID_READER_CLOCK');
 if(!Array.isArray(raceIds)||raceIds.length<1||raceIds.length>MAX_RACES||
  raceIds.some(id=>!validRaceId(id)))return failure('INVALID_RACE_IDS');
 if(new Set(raceIds).size!==raceIds.length)return failure('DUPLICATE_RACE_ID');

 const included=[],excluded=[],win=[],top3=[],time=[];
 for(const raceId of [...raceIds].sort()){
  const read=await compareJraEarlyToOfficialResult({DB,raceId,now});
  if(read.status==='READY'&&read.comparison?.formalKpiEligible===true){
   const c=read.comparison;
   included.push(Object.freeze({raceId,earlyRevision:c.earlyRevision,
    matchedRunnerCount:c.matchedRunnerCount,timeSampleCount:c.timeSampleCount}));
   win.push(c.winBrier);top3.push(c.top3Brier);
   if(c.timeSampleCount>0)time.push(c.timeMaeSeconds);
  }else{
   const reason=read.status==='READY'?'UNVERIFIED_POST_TIME':read.reason;
   excluded.push(Object.freeze({raceId,status:read.status,reason}));
  }
 }
 const reasonCounts={};
 for(const item of excluded)reasonCounts[item.reason]=(reasonCounts[item.reason]??0)+1;
 return Object.freeze({status:'READY',reason:null,summary:Object.freeze({
  requestedRaceCount:raceIds.length,formalRaceCount:included.length,excludedRaceCount:excluded.length,
  matchedRunnerCount:included.reduce((sum,item)=>sum+item.matchedRunnerCount,0),
  timeSampleCount:included.reduce((sum,item)=>sum+item.timeSampleCount,0),
  // A race is the unit of each mean. Time uses only races with an actual time sample.
  meanRaceWinBrier:mean(win),meanRaceTop3Brier:mean(top3),meanRaceTimeMaeSeconds:mean(time),
  timeRaceCount:time.length,reasonCounts:Object.freeze(reasonCounts),
  included:Object.freeze(included),excluded:Object.freeze(excluded)
 })});
}
