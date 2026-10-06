import {readJraEarlyResearchSnapshot} from '../prediction/jra-early-research-reader.mjs';
import {compareJraEarlyToOfficialResult} from './jra-early-result-kpi.mjs';
import {buildJraStarShadow} from './jra-star-shadow.mjs';
import {summarizeJraStarShadow} from './jra-star-shadow-kpi.mjs';

const rejected=reason=>Object.freeze({status:'REJECTED',reason,summary:null});
function validRaceId(value){
 if(typeof value!=='string')return false;
 const match=/^(\d{4})(\d{2})(\d{2})-JRA-([^\r\n]+)-(\d{2})$/.exec(value);
 if(!match||Number(match[5])<1||Number(match[5])>12)return false;
 const date=`${match[1]}-${match[2]}-${match[3]}`,stamp=Date.parse(`${date}T00:00:00Z`);
 return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===date;
}

// Bounded, explicit research cohort. No discovery, network, persistence, routes or flag changes.
// The comparison reader revalidates EARLY; revision mismatch is excluded by the shadow evaluator.
export async function readJraStarShadowCohort({DB,raceIds,now=Date.now()}={}){
 if(typeof DB?.prepare!=='function')return rejected('D1_UNAVAILABLE');
 if(!Number.isFinite(now))return rejected('INVALID_READER_CLOCK');
 if(!Array.isArray(raceIds)||raceIds.length<1||raceIds.length>100||
  raceIds.some(id=>!validRaceId(id)))return rejected('INVALID_RACE_IDS');
 if(new Set(raceIds).size!==raceIds.length)return rejected('DUPLICATE_RACE_ID');
 const pairs=[],excluded=[];
 for(const raceId of [...raceIds].sort()){
  const early=await readJraEarlyResearchSnapshot({DB,raceId,now});
  if(early.status!=='READY'){
   excluded.push(Object.freeze({raceId,status:'EXCLUDED',reason:`EARLY_${early.reason}`}));
   continue;
  }
  const star=buildJraStarShadow(early);
  if(star.status!=='CANDIDATE'){
   excluded.push(Object.freeze({raceId,status:'EXCLUDED',reason:star.reason}));
   continue;
  }
  pairs.push({early,officialComparison:await compareJraEarlyToOfficialResult({DB,raceId,now})});
 }
 const base=pairs.length?summarizeJraStarShadow(pairs).summary:{
  observedRaceCount:0,winHits:0,top3Hits:0,winHitRate:null,top3HitRate:null,observations:[],excluded:[]
 };
 excluded.push(...base.excluded);
 excluded.sort((a,b)=>a.raceId.localeCompare(b.raceId));
 const reasons={};
 for(const row of excluded)reasons[row.reason]=(reasons[row.reason]??0)+1;
 return Object.freeze({status:'READY',reason:null,summary:Object.freeze({
  requestedRaceCount:raceIds.length,observedRaceCount:base.observedRaceCount,
  excludedRaceCount:excluded.length,winHits:base.winHits,top3Hits:base.top3Hits,
  winHitRate:base.winHitRate,top3HitRate:base.top3HitRate,
  reasonCounts:Object.freeze(reasons),observations:Object.freeze([...base.observations]),
  excluded:Object.freeze(excluded)
 })});
}
