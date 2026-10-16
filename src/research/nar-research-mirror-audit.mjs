import {isDeepStrictEqual} from 'node:util';
import {auditNarStatusMirror,NAR_STATUS_MIRROR_MAX_AGE_MS} from './nar-status-mirror-audit.mjs';
import {NAR_RESEARCH_MIRROR_SCHEMA,narResearchViewerUrl} from './nar-research-chat-mirror.mjs';

const codes={morioka:'10',mizusawa:'11',urawa:'18',funabashi:'19',ooi:'20',kawasaki:'21',kanazawa:'22',kasamatsu:'23',nagoya:'24',sonoda:'27',himeji:'28',kochi:'31',saga:'32',monbetsu:'36'};
const flags={scope:'RESEARCH_MIRROR_CONSISTENCY_AND_FRESHNESS_ONLY',sourceReferenceBasis:'DECLARED_LOCAL_COMMIT_BUNDLE',originAuthenticated:false,acquisitionCertified:false,researchOnly:true,formalKpiEligible:false,readiness:'HOLD',probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',earlyFreezeVerification:'NOT_VERIFIED',viewerPayloadHashVerification:'NOT_RECOMPUTABLE_FROM_PROJECTED_FILES',coverageBasis:'SAVED_ROWS_ONLY_NOT_FULL_MEETING'};
const dayKeys='ok schemaVersion researchOnly formalKpiEligible productionActivationReady probabilityDecision productionActivationDecision date track trackSlug organization scope sourceUrl capturedAt sourceTimingVerification sourcePayloadSha256 hashBasis freshness diagnostics raceCount totalHorseCount races'.split(' ');
const raceKeys='raceId raceNumber raceName startTime distance surface horseCount abilityCount timeCount sourceAcquiredAt predictionAt horses'.split(' ');
const horseKeys='horseNumber horseName abilityRank score predictedTime runnerStatus winProb top3Prob mark odds popularity expectedValue diamond warning'.split(' ');
const nullSignals='winProb top3Prob mark odds popularity expectedValue diamond warning'.split(' ');
const failures=['BUNDLE_INVALID','STATUS_MIRROR_HOLD','DAY_CONTRACT_INVALID','DAY_TIME_INVALID','RACE_INVALID','HORSE_INVALID','SIGNAL_NOT_NULL','COUNTS_INVALID','RACE_FILES_MISMATCH','MANIFEST_RESEARCH_MISMATCH','STATUS_RESEARCH_MISMATCH'];
const ensure=(ok,reason)=>{if(!ok)throw Error(reason);};
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&isDeepStrictEqual(Object.keys(v).sort(),[...expected].sort());
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

// Offline consistency audit only. A caller-supplied commit is not authentication.
// Matching projected files do not prove the declared full-viewer payload hash.
export function auditNarResearchMirror(bundle,{expectedDate,slug,now=Date.now()}={}){
 let statusMirror=null;
 const hold=reason=>({...flags,status:'HOLD',consistencyStatus:'UNVERIFIED',currentStatusEligible:false,reasonCodes:[reason],statusMirror,totals:null,rows:[]});
 try{
  const sourceUrl=narResearchViewerUrl(expectedDate,slug),track=new URL(sourceUrl).searchParams.get('track'),code=codes[slug];
  ensure(bundle&&typeof bundle.commitSha==='string'&&/^[a-f0-9]{40}$/.test(bundle.commitSha)&&Number.isFinite(now)&&Number.isFinite(new Date(now).getTime()),'BUNDLE_INVALID');
  const m=auditNarStatusMirror({expectedDate,now,commitSha:bundle.commitSha,attempt:bundle.attempt,snapshot:bundle.snapshot,manifest:bundle.manifest});
  statusMirror={status:m.status,reasonCodes:m.reasonCodes,capturedAt:m.observed?.capturedAt??null,ageMs:m.observed?.ageMs??null};
  const staleStatus=m.status==='HOLD'&&isDeepStrictEqual(m.reasonCodes,['SNAPSHOT_STALE']);
  ensure(m.status==='VERIFIED'||staleStatus,'STATUS_MIRROR_HOLD');
  const d=bundle.day;
  ensure(keys(d,dayKeys)&&d.ok===true&&d.schemaVersion===NAR_RESEARCH_MIRROR_SCHEMA&&d.researchOnly===true&&d.formalKpiEligible===false&&d.productionActivationReady===false&&d.probabilityDecision==='MODEL_HOLD'&&d.productionActivationDecision==='NO-GO'&&d.date===expectedDate&&d.trackSlug===slug&&d.track===track&&d.organization==='NAR'&&d.scope==='RESEARCH_ABILITY_TIME_ONLY_NOT_EARLY_PREDICTION'&&d.sourceUrl===sourceUrl&&d.sourceTimingVerification==='NOT_EXPOSED_BY_VIEWER'&&typeof d.sourcePayloadSha256==='string'&&/^[a-f0-9]{64}$/.test(d.sourcePayloadSha256)&&d.hashBasis==='UTF8_JSON_STRINGIFY_VIEWER_PAYLOAD'&&isDeepStrictEqual(d.freshness,{latestPredictionAt:null,latestOddsAt:null,latestResultAt:null})&&isDeepStrictEqual(d.diagnostics,{researchViewerProjection:true,marketTextAvailable:false,identityMismatchCount:0,abilityOnlyFallback:true}),'DAY_CONTRACT_INVALID');
  ensure(iso(d.capturedAt)&&Date.parse(d.capturedAt)<=now,'DAY_TIME_INVALID');
  ensure(Array.isArray(d.races)&&integer(d.raceCount,1,20)&&d.raceCount===d.races.length&&integer(d.totalHorseCount,2,600),'COUNTS_INVALID');
  const rows=[];let previous=0;
  for(const r of d.races){
   ensure(keys(r,raceKeys)&&integer(r.raceNumber,1,20)&&r.raceNumber>previous&&r.raceId===`${expectedDate.replaceAll('-','')}-NAR-${code}-${String(r.raceNumber).padStart(2,'0')}`&&text(r.raceName,256)&&typeof r.startTime==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.startTime)&&integer(r.distance,100,5000)&&['ダート','芝','障害'].includes(r.surface)&&r.sourceAcquiredAt===null&&r.predictionAt===null&&Array.isArray(r.horses)&&integer(r.horses.length,2,30),'RACE_INVALID');previous=r.raceNumber;
   const seen=new Set();
   for(const h of r.horses){
    ensure(keys(h,horseKeys)&&integer(h.horseNumber,1,30)&&!seen.has(h.horseNumber)&&text(h.horseName,100)&&['active','scratched','excluded','withdrawn','unknown'].includes(h.runnerStatus)&&(h.abilityRank===null||integer(h.abilityRank,1,r.horses.length))&&(h.score===null||(typeof h.score==='number'&&Number.isFinite(h.score)))&&(h.predictedTime===null||(typeof h.predictedTime==='string'&&/^\d{1,2}:[0-5]\d\.\d$/.test(h.predictedTime))),'HORSE_INVALID');seen.add(h.horseNumber);
    ensure(nullSignals.every(k=>h[k]===null),'SIGNAL_NOT_NULL');
   }
   ensure(r.horseCount===r.horses.length&&r.abilityCount===r.horses.filter(h=>h.score!==null).length&&r.timeCount===r.horses.filter(h=>h.predictedTime!==null).length,'COUNTS_INVALID');
   rows.push({raceId:r.raceId,raceNumber:r.raceNumber,horseCount:r.horseCount,abilityCount:r.abilityCount,timeCount:r.timeCount,missingTimeCount:r.horseCount-r.timeCount});
  }
  ensure(d.totalHorseCount===rows.reduce((sum,r)=>sum+r.horseCount,0),'COUNTS_INVALID');
  const base=`chat-snapshot/research-nar/${expectedDate}/${slug}`;
  ensure(Array.isArray(bundle.raceFiles)&&bundle.raceFiles.length===d.raceCount,'RACE_FILES_MISMATCH');
  const files=new Map();
  for(const f of bundle.raceFiles){ensure(keys(f,['path','payload'])&&typeof f.path==='string'&&!files.has(f.path),'RACE_FILES_MISMATCH');files.set(f.path,f.payload);}
  const {races,...metadata}=d;
  for(const r of races)ensure(isDeepStrictEqual(files.get(`${base}/race-${String(r.raceNumber).padStart(2,'0')}.json`),{...metadata,raceCount:1,totalHorseCount:r.horseCount,race:r}),'RACE_FILES_MISMATCH');
  ensure(Array.isArray(bundle.manifest.snapshots),'MANIFEST_RESEARCH_MISMATCH');
  const entries=bundle.manifest.snapshots.filter(e=>e?.path===`${base}/day.json`||(typeof e?.path==='string'&&e.path.startsWith('chat-snapshot/research-nar/')&&e.date===expectedDate&&e.trackSlug===slug));
  ensure(entries.length===1,'MANIFEST_RESEARCH_MISMATCH');const e=entries[0];
  ensure(e.path===`${base}/day.json`&&e.date===expectedDate&&e.track===track&&e.trackSlug===slug&&e.organization==='NAR'&&e.raceCount===d.raceCount&&e.totalHorseCount===d.totalHorseCount&&e.latestPredictionAt===null&&e.latestOddsAt===null&&e.abilityOnlyFallback===true&&e.identityMismatchCount===0,'MANIFEST_RESEARCH_MISMATCH');
  const prefix=`${expectedDate.replaceAll('-','')}-NAR-${code}-`,statusRows=bundle.snapshot.payload.races.filter(r=>r?.track===track||(typeof r?.raceId==='string'&&r.raceId.startsWith(prefix)));
  ensure(statusRows.length===rows.length&&new Set(statusRows.map(r=>r.raceId)).size===rows.length,'STATUS_RESEARCH_MISMATCH');
  for(const row of rows){const s=statusRows.find(r=>r.raceId===row.raceId);ensure(s&&s.track===track&&s.raceNo===row.raceNumber&&s.horseCount===row.horseCount&&s.abilityCount===row.abilityCount&&s.timeCount===row.timeCount,'STATUS_RESEARCH_MISMATCH');}
  const ageMs=now-Date.parse(d.capturedAt),reasonCodes=[];
  if(staleStatus)reasonCodes.push('STATUS_SNAPSHOT_STALE');
  if(ageMs>NAR_STATUS_MIRROR_MAX_AGE_MS)reasonCodes.push('RESEARCH_CAPTURE_STALE');
  return {...flags,status:reasonCodes.length?'HOLD':'VERIFIED',consistencyStatus:'CROSS_FILE_CONSISTENT',currentStatusEligible:reasonCodes.length===0,reasonCodes,statusMirror,auditedAt:new Date(now).toISOString(),sourceReference:{commitSha:bundle.commitSha,date:expectedDate,slug,capturedAt:d.capturedAt,ageMs,declaredViewerPayloadSha256:d.sourcePayloadSha256},raceCount:rows.length,fileCount:bundle.raceFiles.length+1,rows,totals:Object.fromEntries(['horseCount','abilityCount','timeCount','missingTimeCount'].map(k=>[k,rows.reduce((sum,r)=>sum+r[k],0)])),missingTimeScope:'ALL_SAVED_RUNNERS_NOT_ACTIVE_ONLY'};
 }catch(e){return hold(failures.includes(e?.message)?e.message:'BUNDLE_INVALID');}
}
