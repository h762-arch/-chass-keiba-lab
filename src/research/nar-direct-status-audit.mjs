import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {STATUS_ORIGIN,validateNarStatusPayload} from '../../scripts/publish-nar-status-snapshot.mjs';

const flags={scope:'DECLARED_DIRECT_CAPTURE_NOT_GITHUB_MIRROR',originAuthenticated:false,researchOnly:true,acquisitionCertified:false,formalKpiEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',readiness:'HOLD',savedDataVerification:'STATUS_REPORTED_ONLY',coverageBasis:'SAVED_ROWS_ONLY_NOT_FULL_MEETING',historyCounterOverlap:'UNKNOWN_DO_NOT_ADD'};
const tracks={'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const count=(v,max=1000000)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const ensure=(ok,reason)=>{if(!ok)throw Error(reason);};
const reasons=['CAPTURE_INVALID','PAYLOAD_INVALID','PAYLOAD_HASH_MISMATCH','CAPTURE_TIME_INVALID','RACE_INVALID','QUALITY_INVALID','HISTORY_COUNTS_INVALID','RUN_INVALID','RUN_ALIAS_MISMATCH','WINDOW_SKIP_INCONSISTENT'];
const aggregate=values=>({total:values.some(v=>v===null)?null:values.reduce((a,b)=>a+b,0),knownSubtotal:values.reduce((a,b)=>a+(b??0),0),unknownRaceCount:values.filter(v=>v===null).length});
const clock=v=>typeof v==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
const raceIdentity=(id,expectedDate)=>{const m=typeof id==='string'&&id.match(/^(\d{8})-NAR-(\d{2})-(\d{2})$/);return m&&m[1]===expectedDate.replaceAll('-','')&&tracks[m[2]]&&Number(m[3])>=1&&Number(m[3])<=20?{track:tracks[m[2]],raceNo:Number(m[3])}:null;};

// Offline validation: the caller's URL/hash declarations are not origin authentication.
// Freshness uses the actual clock by default; no mirror commit or manifest is invented.
export function auditNarDirectStatus(capture,{expectedDate,now=Date.now()}={}){
 let captureIntegrityStatus='UNVERIFIED',freshnessStatus='UNKNOWN';
 const hold=reason=>({...flags,status:'HOLD',captureIntegrityStatus,freshnessStatus,currentStatusEligible:false,reasonCodes:[reason],rows:[],totals:null,run:null});
 try{
  ensure(date(expectedDate)&&Number.isFinite(now)&&capture?.schemaVersion==='chass-nar-status-snapshot-v1'&&capture.status==='CAPTURED'&&capture.date===expectedDate&&capture.readOnlyCapture===true&&capture.hashBasis==='UTF8_JSON_STRINGIFY_PAYLOAD'&&capture.sourceUrl===`${STATUS_ORIGIN}/api/chass/v1/public/nar-precompute-status?date=${expectedDate}&format=compact`,'CAPTURE_INVALID');
  ensure(iso(capture.attemptedAt)&&iso(capture.capturedAt)&&Date.parse(capture.attemptedAt)<=Date.parse(capture.capturedAt)&&Date.parse(capture.capturedAt)<=now,'CAPTURE_TIME_INVALID');
  const p=validateNarStatusPayload(capture.payload,expectedDate);
  ensure(typeof capture.payloadSha256==='string'&&/^[a-f0-9]{64}$/.test(capture.payloadSha256)&&createHash('sha256').update(JSON.stringify(p)).digest('hex')===capture.payloadSha256,'PAYLOAD_HASH_MISMATCH');
  ensure(p.schemaReady===true&&p.researchOnly===true&&p.formalKpiEligible===false&&p.productionActivationReady===false,'PAYLOAD_INVALID');
  const rows=[],seen=new Set();
  for(const r of p.races){
   const identity=raceIdentity(r?.raceId,expectedDate);
   ensure(identity&&identity.track===r.track&&identity.raceNo===r.raceNo&&!seen.has(r.raceId)&&count(r.horseCount,30)&&r.horseCount>=2,'RACE_INVALID');seen.add(r.raceId);
   for(const key of ['abilityCount','timeCount'])ensure(r[key]==null||count(r[key],r.horseCount),'RACE_INVALID');
   const q=r.quality;let activeHorseCount=null,activeAbilityMissing=null,activeTimeMissing=null;
   if(q?.schemaVersion===1){
    ensure(q.horseCount===r.horseCount&&['activeHorseCount','activeAbilityCount','activeTimeCount'].every(k=>count(q[k],r.horseCount))&&q.activeAbilityCount<=q.activeHorseCount&&q.activeTimeCount<=q.activeHorseCount,'QUALITY_INVALID');
    for(const [all,active] of [['abilityCount','activeAbilityCount'],['timeCount','activeTimeCount']])ensure(r[all]==null||(q[active]<=r[all]&&r[all]-q[active]<=r.horseCount-q.activeHorseCount),'QUALITY_INVALID');
    activeHorseCount=q.activeHorseCount;activeAbilityMissing=q.activeHorseCount-q.activeAbilityCount;activeTimeMissing=q.activeHorseCount-q.activeTimeCount;
   }
   const counters={};
   for(const [key,audit,field] of [['linkHeldReferences',r.historyLinkAudit,'heldEpisodeCount'],['storeHeldEpisodes',r.historyStoreAudit,'heldEpisodeCount'],['storeUnresolvedObservations',r.historyStoreAudit,'unresolvedObservationCount']]){const v=audit?.[field];ensure(v==null||count(v),'HISTORY_COUNTS_INVALID');counters[key]=v??null;}
   rows.push({raceId:r.raceId,...identity,horseCount:r.horseCount,abilityCount:r.abilityCount??null,timeCount:r.timeCount??null,activeHorseCount,activeAbilityMissing,activeTimeMissing,...counters});
  }
  rows.sort((a,b)=>a.raceId.localeCompare(b.raceId));
  const r=p.narRunAudit;
  ensure(r?.status==='RECORDED'&&iso(r.scheduledAt)&&r.runDate===expectedDate&&new Date(Date.parse(r.scheduledAt)+9*3600000).toISOString().slice(0,10)===expectedDate&&Date.parse(r.scheduledAt)<=Date.parse(capture.capturedAt)&&['COMPLETED','SKIPPED','BLOCKED','STOPPED','NOT_STARTED','DISABLED','SCHEDULED','INVALID','UNKNOWN'].includes(r.runStatus)&&(r.reason===null||(typeof r.reason==='string'&&r.reason.length>0&&r.reason.length<=100))&&['attempted','saved','autoResultProcessed'].every(k=>count(r[k]))&&r.saved<=r.attempted&&r.saved<=p.savedRaceCount&&Array.isArray(r.events)&&r.events.length<=64,'RUN_INVALID');
  for(const [alias,key] of [['lastNarRunAt','scheduledAt'],['lastNarStatus','runStatus'],['lastNarReason','reason'],['lastNarAttempted','attempted'],['lastNarSaved','saved'],['lastNarEvents','events']])ensure(isDeepStrictEqual(p[alias],r[key]),'RUN_ALIAS_MISMATCH');
  // Only aggregate bounded event counts; arbitrary reason text is never emitted.
  for(const e of r.events){ensure(e&&typeof e.reason==='string'&&e.reason.length>0&&e.reason.length<=100,'RUN_INVALID');if(e.raceId!==undefined){const id=raceIdentity(e.raceId,expectedDate);ensure(id&&(!e.track||e.track===id.track),'RUN_INVALID');}if(e.track!==undefined)ensure(Object.values(tracks).includes(e.track),'RUN_INVALID');}
  let interpretation=r.saved>0?'SAVE_RECORDED':r.attempted>0?'ATTEMPT_WITHOUT_SAVE':'NO_ATTEMPT_RECORDED';
  if(r.reason==='DAILY_WINDOW_CLOSED'||p.scheduleReason==='DAILY_WINDOW_CLOSED'){
   const jst=new Date(Date.parse(r.scheduledAt)+9*3600000).toISOString().slice(11,16);
   ensure(r.runStatus==='SKIPPED'&&r.reason==='DAILY_WINDOW_CLOSED'&&r.attempted===0&&r.saved===0&&r.autoResultProcessed===0&&r.events.length===0&&p.enabled===true&&p.scheduleMode==='daily'&&p.scheduleStatus==='SKIPPED'&&p.scheduleReason==='DAILY_WINDOW_CLOSED'&&p.active===false&&date(p.dailyFrom)&&date(p.dailyUntil)&&p.dailyFrom<=expectedDate&&expectedDate<=p.dailyUntil&&clock(p.dailyStartJst)&&clock(p.dailyStopJst)&&p.dailyStartJst<p.dailyStopJst&&(jst<p.dailyStartJst||jst>=p.dailyStopJst),'WINDOW_SKIP_INCONSISTENT');
   interpretation='EXPECTED_WINDOW_CLOSED_SKIP';
  }
  captureIntegrityStatus='VERIFIED';const ageMs=now-Date.parse(capture.capturedAt);freshnessStatus=ageMs>1800000?'STALE':'WITHIN_30_MINUTES';
  const metrics=['horseCount','abilityCount','timeCount','activeHorseCount','activeAbilityMissing','activeTimeMissing','linkHeldReferences','storeHeldEpisodes','storeUnresolvedObservations'];
  return {...flags,status:ageMs>1800000?'HOLD':'OBSERVED',captureIntegrityStatus,freshnessStatus,currentStatusEligible:ageMs<=1800000,reasonCodes:ageMs>1800000?['CAPTURE_STALE']:[],sourceReference:{date:expectedDate,capturedAt:capture.capturedAt,payloadSha256:capture.payloadSha256,ageMs},savedRaceCount:p.savedRaceCount,rejectedRowCount:p.rejectedRowCount,rows,totals:Object.fromEntries(metrics.map(k=>[k,aggregate(rows.map(r=>r[k]))])),run:{scheduledAt:r.scheduledAt,ageMs:now-Date.parse(r.scheduledAt),freshnessStatus:now-Date.parse(r.scheduledAt)>1800000?'STALE':'WITHIN_30_MINUTES',runStatus:r.runStatus,reason:r.reason===null?null:r.reason==='DAILY_WINDOW_CLOSED'?'DAILY_WINDOW_CLOSED':'OTHER_RECORDED_REASON',attempted:r.attempted,saved:r.saved,autoResultProcessed:r.autoResultProcessed,eventCount:r.events.length,interpretation},eventCoverage:'LATEST_RETAINED_RUN_ONLY_NOT_FULL_HISTORY'};
 }catch(e){return hold(reasons.includes(e?.message)?e.message:'DIRECT_CAPTURE_UNREADABLE');}
}
