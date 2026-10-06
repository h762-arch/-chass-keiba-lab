import {isFrozenSignalRaceId} from './signal-rule-cohort-audit.mjs';
const rejected=reason=>Object.freeze({status:'REJECTED',reason,summary:null,productionActivationReady:false});

// Read only explicitly selected race IDs from the app's existing backup format.
// Never migrate, regenerate or fill a saved signal from current markets, results or odds history.
export function extractFrozenSignalsFromBackup(backup,raceIds){
 if(backup?.format!=='CHASS_KEIBA_RESEARCH_BACKUP'||backup.schemaVersion!==1||
  !backup.races||typeof backup.races!=='object'||Array.isArray(backup.races))
  return rejected('INVALID_RESEARCH_BACKUP');
 if(!Array.isArray(raceIds)||raceIds.length<1||raceIds.length>100||raceIds.some(id=>!isFrozenSignalRaceId(id)))
  return rejected('INVALID_RACE_IDS');
 if(new Set(raceIds).size!==raceIds.length)return rejected('DUPLICATE_RACE_ID');
 const entries=[];
 for(const raceId of [...raceIds].sort()){
  if(!Object.hasOwn(backup.races,raceId))return rejected('BACKUP_RACE_MISSING');
  const source=backup.races[raceId];
  if(!source||typeof source!=='object'||Array.isArray(source))return rejected('INVALID_BACKUP_RECORD');
  const market=source.marketSnapshot;
  try{
   const record={};
   if(Object.hasOwn(source,'raceId'))record.raceId=source.raceId;
   if(market&&typeof market==='object'&&!Array.isArray(market)){
    record.marketSnapshot={};
    if(Object.hasOwn(market,'raceId'))record.marketSnapshot.raceId=market.raceId;
    if(Object.hasOwn(market,'signalSnapshot'))record.marketSnapshot.signalSnapshot=structuredClone(market.signalSnapshot);
   }
   entries.push(Object.freeze({raceId,record}));
  }catch{return rejected('SIGNAL_COPY_FAILED');}
 }
 return Object.freeze({status:'READY',reason:null,productionActivationReady:false,entries:Object.freeze(entries)});
}
