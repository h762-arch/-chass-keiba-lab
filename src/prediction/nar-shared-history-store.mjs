import {stableHash,assertMarketIndependentData} from './precomputed-snapshot.mjs';
import {verifyNarHistoryIdentity} from './nar-history-identity-bridge.mjs';
const dateOK=d=>/^\d{4}-\d{2}-\d{2}$/.test(d||'')&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const isoOK=d=>typeof d==='string'&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString()===d;
const jstDate=d=>new Date(Date.parse(d)+9*3600000).toISOString().slice(0,10);
const horseOK=k=>/^NAR_LINEAGE:\d{11}$/.test(k||'');
const raceOK=(id,date)=>dateOK(date)&&new RegExp(`^${date.replaceAll('-','')}-NAR-\\d{1,2}-\\d{2}$`).test(id||'');
const guard=canContinue=>{if(!canContinue())throw Error('HISTORY_DEADLINE');};
const selectColumns='observation_hash,horse_key,episode_race_id,canonical_date,observed_at,fact_hash,source_race_id,record_json';
export async function narSharedHistorySchemaReady(DB){
 try{await DB.prepare(`SELECT ${selectColumns} FROM nar_shared_history_observations LIMIT 0`).all();return true;}catch{return false;}
}
async function validateRecord(record){
 const {horseKey,episodeRaceId,canonicalDate,observedAt,sourceRaceId,sourceDate,sourceAcquiredAt,sourcePostAt,facts,factHash,sourceHistoryHash,linksHash}=record;
 return record.schemaVersion===1&&record.researchOnly===true&&record.formalKpiEligible===false&&record.basis==='OFFICIAL_CARD_OBSERVATION_LINK_MATCH'
  &&horseOK(horseKey)&&raceOK(episodeRaceId,canonicalDate)&&raceOK(sourceRaceId,sourceDate)&&canonicalDate<sourceDate
  &&isoOK(observedAt)&&isoOK(sourceAcquiredAt)&&isoOK(sourcePostAt)&&jstDate(sourceAcquiredAt)===sourceDate&&jstDate(observedAt)===sourceDate&&jstDate(sourcePostAt)===sourceDate&&sourceAcquiredAt<=observedAt&&observedAt<sourcePostAt
  &&facts?.originCircuit==='NAR'&&facts?.dateText===canonicalDate.slice(5).replace('-','.')
  &&/^[a-f0-9]{64}$/.test(sourceHistoryHash||'')&&/^[a-f0-9]{64}$/.test(linksHash||'')&&factHash===await stableHash(facts);
}
// Read only information observed before this run's cutoff. Conflicting observations
// retain their episode slot as HOLD; they are never replaced by a chosen revision.
export async function readNarRollingHistory(DB,{horseKey,targetDate,cutoffAt,canContinue=()=>true}){
 if(!horseOK(horseKey)||!dateOK(targetDate)||!isoOK(cutoffAt)||new Date(Date.parse(cutoffAt)+9*3600000).toISOString().slice(0,10)!==targetDate)throw Error('HISTORY_READ_CONTEXT');
 guard(canContinue);
 const rows=await DB.prepare(`SELECT ${selectColumns} FROM nar_shared_history_observations WHERE horse_key=? AND observed_at<=? AND canonical_date<? AND episode_race_id IN (SELECT episode_race_id FROM nar_shared_history_observations WHERE horse_key=? AND observed_at<=? AND canonical_date<? GROUP BY episode_race_id ORDER BY MAX(canonical_date) DESC,episode_race_id DESC LIMIT 10) ORDER BY canonical_date DESC,episode_race_id DESC,observed_at,observation_hash LIMIT 257`).bind(horseKey,cutoffAt,targetDate,horseKey,cutoffAt,targetDate).all();
 guard(canContinue);const grouped=new Map();
 if((rows.results||[]).length>256)throw Error('HISTORY_OBSERVATION_LIMIT');
 for(const row of rows.results||[]){
  const r=JSON.parse(row.record_json);assertMarketIndependentData(r);
  if(!await validateRecord(r)||await stableHash(r)!==row.observation_hash||r.horseKey!==row.horse_key||r.horseKey!==horseKey||r.episodeRaceId!==row.episode_race_id||r.canonicalDate!==row.canonical_date||r.observedAt!==row.observed_at||r.factHash!==row.fact_hash||r.sourceRaceId!==row.source_race_id||r.observedAt>cutoffAt||r.canonicalDate>=targetDate)throw Error('HISTORY_READ_UNVERIFIED');
  if(!grouped.has(r.episodeRaceId))grouped.set(r.episodeRaceId,[]);grouped.get(r.episodeRaceId).push({record:r,observationHash:row.observation_hash});
 }
 const episodes=[...grouped.entries()].map(([episodeRaceId,obs])=>{
  const hashes=new Set(obs.map(o=>o.record.factHash)),resolved=hashes.size===1;
  return {episodeRaceId,canonicalDate:obs[0].record.canonicalDate,status:resolved?'AVAILABLE':'HOLD',reasonCode:resolved?null:'FACT_REVISION_CONFLICT',facts:resolved?obs[0].record.facts:null,factHash:resolved?obs[0].record.factHash:null,provenance:obs.map(o=>({observationHash:o.observationHash,sourceRaceId:o.record.sourceRaceId,observedAt:o.record.observedAt,factHash:o.record.factHash}))};
 });
 const body={schemaVersion:1,horseKey,targetDate,cutoffAt,capacity:10,episodeCount:episodes.length,availableCount:episodes.filter(e=>e.status==='AVAILABLE').length,heldCount:episodes.filter(e=>e.status==='HOLD').length,
  status:episodes.some(e=>e.status==='HOLD')?'HOLD':episodes.length?'PARTIAL':'EMPTY',tenRunCoverage:'NOT_CONFIRMED',basis:'OFFICIAL_CARD_OBSERVATION_LINK_MATCH',modelInputStatus:'NOT_CONNECTED',researchOnly:true,formalKpiEligible:false,episodes};
 return {body,historyHash:await stableHash(body)};
}
export async function verifyNarRollingHistory(pack,{horseKey,targetDate,sourceAcquiredAt,postTime,calculatedAt}){
 try{
  const b=pack.body;assertMarketIndependentData(b);
  if(pack.historyHash!==await stableHash(b)||b.schemaVersion!==1||b.horseKey!==horseKey||!horseOK(horseKey)||b.targetDate!==targetDate||!dateOK(targetDate)||!isoOK(sourceAcquiredAt)||!isoOK(calculatedAt)||!isoOK(b.cutoffAt)||jstDate(b.cutoffAt)!==targetDate||b.cutoffAt<sourceAcquiredAt||b.cutoffAt>calculatedAt||!/^([01]\d|2[0-3]):[0-5]\d$/.test(postTime||'')||Date.parse(b.cutoffAt)>=Date.parse(`${targetDate}T${postTime}:00+09:00`)||b.capacity!==10||b.researchOnly!==true||b.formalKpiEligible!==false||b.tenRunCoverage!=='NOT_CONFIRMED'||b.modelInputStatus!=='NOT_CONNECTED'||b.basis!=='OFFICIAL_CARD_OBSERVATION_LINK_MATCH'||!Array.isArray(b.episodes)||b.episodes.length>10||new Set(b.episodes.map(e=>e.episodeRaceId)).size!==b.episodes.length)return false;
  for(const e of b.episodes){
   if(!raceOK(e.episodeRaceId,e.canonicalDate)||e.canonicalDate>=targetDate||!e.provenance?.length)return false;
   for(const p of e.provenance){const sourceDate=String(p.sourceRaceId).slice(0,8).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');if(!raceOK(p.sourceRaceId,sourceDate)||sourceDate<=e.canonicalDate||!isoOK(p.observedAt)||p.observedAt>b.cutoffAt||!new RegExp('^[a-f0-9]{64}$').test(p.observationHash)||!new RegExp('^[a-f0-9]{64}$').test(p.factHash))return false;}
   const resolved=new Set(e.provenance.map(p=>p.factHash)).size===1;
   if(resolved?(e.status!=='AVAILABLE'||e.reasonCode!==null||e.factHash!==e.provenance[0].factHash||e.factHash!==await stableHash(e.facts)||e.facts?.originCircuit!=='NAR'||e.facts?.dateText!==e.canonicalDate.slice(5).replace('-','.')):(e.status!=='HOLD'||e.reasonCode!=='FACT_REVISION_CONFLICT'||e.facts!==null||e.factHash!==null))return false;
  }
  const available=b.episodes.filter(e=>e.status==='AVAILABLE').length,held=b.episodes.length-available;
  return b.episodeCount===b.episodes.length&&b.availableCount===available&&b.heldCount===held&&b.status===(held?'HOLD':b.episodes.length?'PARTIAL':'EMPTY');
 }catch{return false;}
}
export async function materializeNarSharedHistory(DB,{raceId,sourceAcquiredAt,cutoffAt,horses,links,canContinue=()=>true}){
 const startedAt=performance.now();
 guard(canContinue);if(!await narSharedHistorySchemaReady(DB))throw Error('HISTORY_SCHEMA_UNAVAILABLE');
 if(!isoOK(cutoffAt)||!links?.body||Date.parse(cutoffAt)<Date.parse(links.body.observedAt)||Date.parse(cutoffAt)>=Date.parse(`${links.body.date}T${links.body.postTime}:00+09:00`))throw Error('HISTORY_WRITE_CONTEXT');
 if(!Array.isArray(horses)||horses.length<1||horses.length>30||new Set(horses.map(h=>h.horseNo)).size!==horses.length||new Set(horses.map(h=>h.history?.body.globalHorseIdentity)).size!==horses.length)throw Error('HISTORY_IDENTITY_UNVERIFIED');
 const records=[],keys=new Map();let unresolved=0;
 for(const h of horses){
  const context={raceId,horseNo:h.horseNo,horseName:h.horseName,sourceAcquiredAt};
  if(h.history?.body?.schemaVersion!==2||!await verifyNarHistoryIdentity(h.history,links,context))throw Error('HISTORY_IDENTITY_UNVERIFIED');
  const b=h.history.body;keys.set(h.horseNo,b.globalHorseIdentity);
  for(const ref of b.identity.references){
   if(ref.status!=='RESOLVED'){unresolved++;continue;}
   const e=b.episodes.find(x=>x.observationKey===ref.observationKey),r=ref.raceReference;
   const record={schemaVersion:1,horseKey:b.globalHorseIdentity,episodeRaceId:r.raceId,canonicalDate:r.date,observedAt:new Date(b.identity.observedAt).toISOString(),sourceRaceId:raceId,sourceDate:links.body.date,sourceAcquiredAt,sourcePostAt:new Date(`${links.body.date}T${links.body.postTime}:00+09:00`).toISOString(),facts:structuredClone(e.facts),factHash:e.contentHash,sourceHistoryHash:h.history.historyHash,linksHash:links.linksHash,basis:'OFFICIAL_CARD_OBSERVATION_LINK_MATCH',researchOnly:true,formalKpiEligible:false};
   assertMarketIndependentData(record);if(!await validateRecord(record))throw Error('HISTORY_IDENTITY_UNVERIFIED');records.push(record);
  }
 }
 let inserted=0,existing=0;
 for(const r of records){
  guard(canContinue);const hash=await stableHash(r);
  const result=await DB.prepare('INSERT OR IGNORE INTO nar_shared_history_observations (observation_hash,horse_key,episode_race_id,canonical_date,observed_at,fact_hash,source_race_id,record_json) VALUES (?,?,?,?,?,?,?,?)').bind(hash,r.horseKey,r.episodeRaceId,r.canonicalDate,r.observedAt,r.factHash,r.sourceRaceId,JSON.stringify(r)).run();
  guard(canContinue);const readback=await DB.prepare('SELECT record_json FROM nar_shared_history_observations WHERE observation_hash=?').bind(hash).first();
  if(!readback||await stableHash(JSON.parse(readback.record_json))!==hash)throw Error('HISTORY_SAVE_UNVERIFIED');
  if(Number(result?.meta?.changes)>0)inserted++;else existing++;
 }
 const projected=[];
 for(const h of horses){guard(canContinue);projected.push({...h,rollingHistory:await readNarRollingHistory(DB,{horseKey:keys.get(h.horseNo),targetDate:links.body.date,cutoffAt,canContinue})});}
 guard(canContinue);
 return {horses:projected,audit:{status:'PARTIAL',reasonCode:'ROLLING_HISTORY_RESEARCH_ONLY',insertedObservationCount:inserted,existingObservationCount:existing,unresolvedObservationCount:unresolved,availableEpisodeCount:projected.reduce((n,h)=>n+h.rollingHistory.body.availableCount,0),heldEpisodeCount:projected.reduce((n,h)=>n+h.rollingHistory.body.heldCount,0),elapsedMs:Math.max(0,Math.round(performance.now()-startedAt)),cutoffAt,recoveryAction:'Accumulate identified observations in new eligible runs; resolve conflicts before model use.'}};
}
