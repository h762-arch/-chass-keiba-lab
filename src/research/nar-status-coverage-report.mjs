import {auditNarStatusMirror} from './nar-status-mirror-audit.mjs';

const flags={scope:'CAPTURED_STATUS_COVERAGE_ONLY',sourceReferenceBasis:'DECLARED_LOCAL_BUNDLE',researchOnly:true,formalKpiEligible:false,acquisitionCertified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
const tracks={'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const count=(v,max)=>Number.isInteger(v)&&v>=0&&v<=max;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const aggregate=values=>{const known=values.filter(v=>v!==null),unknownRaceCount=values.length-known.length,knownSubtotal=known.reduce((a,b)=>a+b,0);return {total:unknownRaceCount?null:knownSubtotal,knownSubtotal,unknownRaceCount};};

// This projection audits counts already present in a captured status response.
// It never infers full History, a missing TIME cause, odds or a horse decision.
export function reportNarStatusCoverage(bundle,{expectedDate,now=Date.now()}={}){
 const hold=(reasonCodes,mirrorAudit=null)=>({...flags,status:'HOLD',reasonCodes,mirrorAudit,rows:[],totals:null});
 try{
  const mirrorAudit=auditNarStatusMirror({expectedDate,now,commitSha:bundle?.commitSha,attempt:bundle?.attempt,manifest:bundle?.manifest,snapshot:bundle?.snapshot});
  // The SHA is declared by the local caller, never certified by this function.
  mirrorAudit.sourceReferenceBasis='DECLARED_LOCAL_BUNDLE';
  if(mirrorAudit.status!=='VERIFIED')return hold(['MIRROR_AUDIT_HOLD'],mirrorAudit);
  const seen=new Set(),rows=[];
  for(const r of bundle.snapshot.payload.races){
   const match=typeof r?.raceId==='string'?r.raceId.match(/^(\d{8})-NAR-(\d{2})-(\d{2})$/):null;
   if(!match||match[1]!==expectedDate.replaceAll('-','')||!tracks[match[2]]||r.track!==tracks[match[2]]||!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>20||Number(match[3])!==r.raceNo||seen.has(r.raceId)||!count(r.horseCount,30)||r.horseCount<2) return hold(['RACE_COVERAGE_INVALID'],mirrorAudit);
   seen.add(r.raceId);
   // Null means absent/unsupported, while a malformed supplied count holds.
   for(const k of ['abilityCount','timeCount'])if(r[k]!=null&&!count(r[k],r.horseCount))return hold(['RACE_COVERAGE_INVALID'],mirrorAudit);
   const q=r.quality;let activeHorseCount=null,activeAbilityMissing=null,activeTimeMissing=null;
   if(q?.schemaVersion===1){
    if(q.horseCount!==r.horseCount||!['activeHorseCount','activeAbilityCount','activeTimeCount'].every(k=>count(q[k],r.horseCount))||q.activeAbilityCount>q.activeHorseCount||q.activeTimeCount>q.activeHorseCount||(r.abilityCount!=null&&q.activeAbilityCount>r.abilityCount)||(r.timeCount!=null&&q.activeTimeCount>r.timeCount))return hold(['QUALITY_COUNTS_INVALID'],mirrorAudit);
    // Also ensure the all-runner count fits in active plus inactive coverage.
    if((r.abilityCount!=null&&r.abilityCount-q.activeAbilityCount>r.horseCount-q.activeHorseCount)||(r.timeCount!=null&&r.timeCount-q.activeTimeCount>r.horseCount-q.activeHorseCount))return hold(['QUALITY_COUNTS_INVALID'],mirrorAudit);
    activeHorseCount=q.activeHorseCount;activeAbilityMissing=q.activeHorseCount-q.activeAbilityCount;activeTimeMissing=q.activeHorseCount-q.activeTimeCount;
   }
   const counters={};
   for(const [key,audit,field] of [['linkHeldReferences',r.historyLinkAudit,'heldEpisodeCount'],['storeHeldEpisodes',r.historyStoreAudit,'heldEpisodeCount'],['storeUnresolvedObservations',r.historyStoreAudit,'unresolvedObservationCount']]){
    const value=audit?.[field];if(value!=null&&!count(value,1000000))return hold(['HISTORY_COUNTS_INVALID'],mirrorAudit);counters[key]=value??null;
   }
   const packStatus=r.preAnalysisStatus==='PARTIAL'&&hash(r.preAnalysisPackHash)?'PARTIAL':r.preAnalysisStatus==='NOT_MATERIALIZED'&&r.preAnalysisPackHash==null?'NOT_MATERIALIZED':'UNAVAILABLE';
   const review=[];
   if(activeAbilityMissing===null)review.push('ACTIVE_ABILITY_COVERAGE_UNKNOWN');else if(activeAbilityMissing>0)review.push('ACTIVE_ABILITY_MISSING');
   if(activeTimeMissing===null)review.push('ACTIVE_TIME_COVERAGE_UNKNOWN');else if(activeTimeMissing>0)review.push('ACTIVE_TIME_MISSING');
   if(Object.values(counters).some(v=>v===null))review.push('HISTORY_COUNTERS_UNKNOWN');
   if(Object.values(counters).some(v=>v!==null&&v>0))review.push('HISTORY_HELD_OR_UNRESOLVED');
   if(packStatus!=='PARTIAL')review.push('PRE_ANALYSIS_PACK_UNAVAILABLE');
   rows.push({raceId:r.raceId,track:r.track,raceNo:r.raceNo,horseCount:r.horseCount,activeHorseCount,activeAbilityMissing,activeTimeMissing,...counters,packStatus,review});
  }
  rows.sort((a,b)=>a.raceId.localeCompare(b.raceId));
  const metrics=['horseCount','activeHorseCount','activeAbilityMissing','activeTimeMissing','linkHeldReferences','storeHeldEpisodes','storeUnresolvedObservations'];
  return {...flags,status:'OBSERVED',reasonCodes:[],mirrorAudit,rows,totals:Object.fromEntries(metrics.map(k=>[k,aggregate(rows.map(r=>r[k]))])),raceCount:rows.length,reviewRaceCount:rows.filter(r=>r.review.length>0).length,historyCounterOverlap:'UNKNOWN_DO_NOT_ADD',formalReadiness:'NOT_EVALUATED',coverageBasis:'SAVED_RACES_ONLY_NOT_EXPECTED_MEETING_COVERAGE'};
 }catch{return hold(['COVERAGE_INPUT_UNREADABLE']);}
}
