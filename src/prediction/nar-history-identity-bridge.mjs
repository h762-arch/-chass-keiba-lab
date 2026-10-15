import {stableHash} from './precomputed-snapshot.mjs';
import {verifyNarCardHistory} from './nar-history-pack.mjs';
import {CURRENT_NAR_HISTORY_VENUE_VERSION,narHistoryVenues} from './nar-history-venue-mapping.mjs';
export async function attachNarHistoryIdentity(history,links,context){
 return attachWithVenueVersion(history,links,context,CURRENT_NAR_HISTORY_VENUE_VERSION);
}
async function attachWithVenueVersion(history,links,{raceId,horseNo,horseName,sourceAcquiredAt},version){
 const venues=narHistoryVenues(version);
 if(!venues)throw Error('IDENTITY_VENUE_VERSION');
 const matches=(fact,ref)=>fact.originCircuit==='NAR'&&fact.dateText===ref.date.slice(5).replace('-','.')&&fact.venue===venues[Number(ref.code)];
 if(!await verifyNarCardHistory(history,{raceId,horseNo,sourceAcquiredAt})||links?.linksHash!==await stableHash(links?.body))throw Error('IDENTITY_BRIDGE_INPUT');
 const observed=Date.parse(links.body.observedAt),post=Date.parse(`${links.body.date}T${links.body.postTime}:00+09:00`);
 if(links.body.status!=='IDENTITY_LINKS_RESOLVED'||!Number.isFinite(observed)||observed<Date.parse(sourceAcquiredAt)||!Number.isFinite(post)||observed>=post)throw Error('IDENTITY_BRIDGE_INPUT');
 const row=links.body.rows.filter(h=>Number(h.horseNo)===horseNo&&h.horseName===horseName);
 if(row.length!==1||!/^NAR_LINEAGE:\d{11}$/.test(row[0].providerHorseKey)||`${links.body.date.replaceAll('-','')}-NAR-${links.body.code}-${String(links.body.raceNo).padStart(2,'0')}`!==raceId)throw Error('IDENTITY_BRIDGE_INPUT');
 const originalHash=history.historyHash,body=structuredClone(history.body);
 const references=body.episodes.map(e=>{
  const candidates=row[0].pastRaceReferences.filter(ref=>matches(e.facts,ref)),sameFacts=body.episodes.filter(other=>other.facts.dateText===e.facts.dateText&&other.facts.venue===e.facts.venue);
  const ref=candidates.length===1&&sameFacts.length===1?candidates[0]:null;
  return {observationKey:e.observationKey,contentHash:e.contentHash,status:ref?'RESOLVED':'HOLD',reasonCode:ref?null:candidates.length>1||sameFacts.length>1?'EPISODE_AMBIGUOUS':'EPISODE_LINK_UNMATCHED',raceReference:ref?structuredClone(ref):null};
 });
 body.schemaVersion=2;body.globalHorseIdentity=row[0].providerHorseKey;
 body.reasonCode='SHARED_HISTORY_CACHE_NOT_CONNECTED';body.recoveryAction='Connect verified episode identities to a versioned shared history store; preserve original observations.';
 body.identity={originalHistoryHash:originalHash,linksHash:links.linksHash,observedAt:links.body.observedAt,resolvedEpisodeCount:references.filter(e=>e.status==='RESOLVED').length,references};
 if(version!==undefined)body.identity.venueMappingVersion=version;
 return {body,historyHash:await stableHash(body)};
}
export async function verifyNarHistoryIdentity(history,links,context){
 try{
  if(history.body.schemaVersion===1)return verifyNarCardHistory(history,context);
  if(history.body.schemaVersion!==2||history.historyHash!==await stableHash(history.body))return false;
  const original=structuredClone(history.body),identity=original.identity;delete original.identity;
  original.schemaVersion=1;original.globalHorseIdentity=null;original.reasonCode='CANONICAL_HORSE_AND_EPISODE_ID_UNRESOLVED';original.recoveryAction='Resolve official horse identity and full episode date before cross-race merge or Rolling10 reuse.';
  const version=Object.hasOwn(identity,'venueMappingVersion')?identity.venueMappingVersion:undefined;
  if(Object.hasOwn(identity,'venueMappingVersion')&&version===undefined)return false;
  const rebuilt=await attachWithVenueVersion({body:original,historyHash:identity.originalHistoryHash},links,context,version);
  return rebuilt.historyHash===history.historyHash;
 }catch{return false;}
}
