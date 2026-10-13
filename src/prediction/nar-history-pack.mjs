import {stableHash} from './precomputed-snapshot.mjs';
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const short=v=>typeof v==='string'?v.slice(0,80):'';
// Card observations only. MM.DD and race-local horse numbers are not global identities.
export async function retainNarCardHistory({raceId,horseNo,sourceAcquiredAt,runs}){
 const provided=Array.isArray(runs),selected=provided?runs.slice(0,5):[],episodes=[];
 for(const r of selected){
  const facts={dateText:short(r.date),dateStatus:'YEAR_UNRESOLVED',canonicalDate:null,venue:short(r.venue),originCircuit:short(r.runOrganization),
   distance:finite(r.distance),condition:short(r.condition),direction:short(r.direction),finish:finite(r.finish),fieldSize:finite(r.fieldSize),timeSec:finite(r.timeSec),last3f:finite(r.last3f),
   cornerPositions:/^\d{1,2}(?:-\d{1,2}){1,4}$/.test(r.corners||'')?r.corners.split('-').map(Number):[]};
  const contentHash=await stableHash(facts);
  // Equal observable facts cannot prove an identical race: preserve both observations.
  episodes.push({observationKey:`${raceId}:${horseNo}:card:${episodes.length+1}`,contentHash,facts});
 }
 const body={schemaVersion:1,scope:'RACE_LOCAL_CARD_HISTORY',runnerKey:`${raceId}:${horseNo}`,sourceReference:raceId,source:'NAR_OFFICIAL_CARD',sourceAcquiredAt,
  status:provided?'RETAINED':'SOURCE_NOT_RETAINED',parsedCount:provided?runs.length:null,retainedCount:episodes.length,capacity:5,
  tenRunCoverage:'NOT_CONFIRMED',globalHorseIdentity:null,
  reuseStatus:'HOLD',reasonCode:'CANONICAL_HORSE_AND_EPISODE_ID_UNRESOLVED',recoveryAction:'Resolve official horse identity and full episode date before cross-race merge or Rolling10 reuse.',episodes};
 return {body,historyHash:await stableHash(body)};
}
export async function verifyNarCardHistory(history,{raceId,horseNo,sourceAcquiredAt}){
 try{const b=history.body;return b.schemaVersion===1&&b.scope==='RACE_LOCAL_CARD_HISTORY'&&b.runnerKey===`${raceId}:${horseNo}`&&b.sourceReference===raceId&&b.sourceAcquiredAt===sourceAcquiredAt&&
  b.episodes.length<=5&&b.retainedCount===b.episodes.length&&b.reuseStatus==='HOLD'&&b.globalHorseIdentity===null&&history.historyHash===await stableHash(b)&&
  (await Promise.all(b.episodes.map(async(e,i)=>e.observationKey===`${raceId}:${horseNo}:card:${i+1}`&&e.contentHash===await stableHash(e.facts)&&e.facts.canonicalDate===null&&e.facts.dateStatus==='YEAR_UNRESOLVED'))).every(Boolean);
 }catch{return false;}
}
