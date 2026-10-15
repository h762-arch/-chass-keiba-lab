import {NAR_VENUE_ROUTING_VERSION} from '../nar/nar-venue-routing.mjs';
import {CURRENT_NAR_HISTORY_VENUE_VERSION} from './nar-history-venue-mapping.mjs';
// Pure projection of recorded fields, never an identity/hash verification or repair.
const unavailable=reasonCode=>({status:'UNAVAILABLE',reasonCode});
function recordedVersion(container,key,supported){
 try{
  if(!container||typeof container!=='object'||Array.isArray(container))return unavailable('VERSION_CONTAINER_UNAVAILABLE');
  if(!Object.hasOwn(container,key))return {status:'LEGACY_UNVERSIONED',recordedVersion:null};
  return container[key]===supported?{status:'VERSIONED',recordedVersion:supported}:unavailable('VERSION_UNSUPPORTED');
 }catch{return unavailable('VERSION_FIELD_UNAVAILABLE');}
}
function historyVersion(horse){
 try{
  const history=horse?.history;
  if(history===undefined||history===null)return {status:'NOT_RETAINED'};
  const body=history.body;
  if(body?.schemaVersion===1)return {status:'NOT_RETAINED'};
  if(body?.schemaVersion!==2)return unavailable('HISTORY_SCHEMA_UNSUPPORTED');
  return recordedVersion(body.identity,'venueMappingVersion',CURRENT_NAR_HISTORY_VENUE_VERSION);
 }catch{return unavailable('VERSION_FIELD_UNAVAILABLE');}
}
export function auditNarStoredVersions(data){
 try{
  if(!data||typeof data!=='object'||Array.isArray(data))return unavailable('VERSION_INPUT_UNAVAILABLE');
  const horses=data.horses;
  if(!Array.isArray(horses)||horses.length<1||horses.length>30)return unavailable('HORSES_UNAVAILABLE_OR_LIMIT');
  const routing=recordedVersion(data,'venueRoutingVersion',NAR_VENUE_ROUTING_VERSION);
  const history={status:'OBSERVED',horseCount:horses.length,legacyUnversionedHorseCount:0,versionedHorseCount:0,notRetainedHorseCount:0,unavailableHorseCount:0,recordedVersions:[]};
  for(const horse of horses){
   const item=horse&&typeof horse==='object'?historyVersion(horse):unavailable('HORSE_UNAVAILABLE');
   const key={LEGACY_UNVERSIONED:'legacyUnversionedHorseCount',VERSIONED:'versionedHorseCount',NOT_RETAINED:'notRetainedHorseCount'}[item.status]||'unavailableHorseCount';
   history[key]++;
  }
  if(history.versionedHorseCount)history.recordedVersions.push(CURRENT_NAR_HISTORY_VENUE_VERSION);
  if(history.unavailableHorseCount)history.status='PARTIAL';
  return {schemaVersion:1,status:routing.status==='UNAVAILABLE'||history.status==='PARTIAL'?'PARTIAL':'OBSERVED',scope:'STORED_VERSION_FIELDS_ONLY',routing,history};
 }catch{return unavailable('VERSION_AUDIT_ERROR');}
}
