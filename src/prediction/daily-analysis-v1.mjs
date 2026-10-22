/** Immutable research results; never a replacement for Original EARLY or probabilities. */
import {projectAndCalculateCpsiShadow} from './chass-cpsi-wave-core-v1.mjs';
import {analyzeWave} from './wave-analysis-v1.mjs';
import {evaluateFavoriteV21Shadow} from './chass-favorite-trust-v21-shadow.mjs';
import {sourceSha256,stableSourceJson,verifySourceArtifact,sourceInputFromRoot} from './cpsi-source-recovery-v1.mjs';
export const DAILY_VERSION='CHASS_DAILY_ANALYSIS_V1_RESEARCH';
const flags={researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false,originalEarlyMutation:false};
const hold=reason=>({status:'HOLD',reason});
const text=x=>typeof x==='string'&&x.trim().length>0&&x.length<=1000;
const active=h=>h.eligible!==false&&!['scratched','withdrawn','excluded','取消','除外','出走取消','競走除外'].includes(h.runnerStatus??h.horseStatus);
export const jstDate=now=>new Date(now+9*3600000).toISOString().slice(0,10);
function frozenMarket(root,now){
 const r=root.race,f=r.metricInputFreeze,m=r.originalEarlyMarket,hs=root.horses.filter(active);
 if(!m||m.organizer!==r.raceType||m.raceId!==`${r.raceDate}|${r.track}|${r.raceNo}`||m.runId!==f.runId||m.inputSnapshotId!==f.inputSnapshotId||m.snapshotId!==f.marketSnapshotId||m.kind!=='EARLY'||m.isPreResult!==true||!text(m.authorityRef)||!text(m.sourceRef)||!['REAL_PRE_ODDS','PREDICTED_ODDS'].includes(m.sourceClass))return null;
 const forbidden=v=>v&&typeof v==='object'&&(Object.keys(v).some(k=>/^(result|finish|payout|actual|final|live)/i.test(k))||Object.values(v).some(forbidden));
 if(forbidden(m))return null;
 const at=Date.parse(m.capturedAt),cut=Date.parse(f.freezeAt),post=Date.parse(f.postAt);
 if(!Number.isFinite(at)||at>cut||cut>now||now>=post||jstDate(at)!==r.raceDate)return null;
 const rows=m.horses;
 if(!Array.isArray(rows)||rows.length!==hs.length||new Set(rows.map(h=>h.horseNo)).size!==hs.length||hs.some(h=>!rows.some(x=>x.horseNo===h.horseNo)))return null;
 const sorted=[...rows].sort((a,b)=>a.popularity-b.popularity);
 if(sorted.some((h,i)=>h.popularity!==i+1||typeof h.odds!=='number'||!Number.isFinite(h.odds)||h.odds<1||(i&&h.odds<sorted[i-1].odds)))return null;
 return {sourceClass:m.sourceClass,snapshotId:m.snapshotId,rows:sorted};
}
function evidenceMatches(root){
 const e=root.dailyEvidence,c=e?.context,r=root.race,f=r.metricInputFreeze;
 return c&&c.raceId===`${r.raceDate}|${r.track}|${r.raceNo}`&&c.runId===f.runId&&c.inputSnapshotId===f.inputSnapshotId&&c.marketSnapshotId===f.marketSnapshotId&&text(c.sourceRef)&&Number.isFinite(Date.parse(c.capturedAt))&&Date.parse(c.capturedAt)<=Date.parse(f.freezeAt)?e:null;
}
function favoriteReview(root,market,cpsi,evidence){
 if(!market)return hold('FROZEN_MARKET_MISSING_OR_INVALID');
 const no=market.rows[0].horseNo,base={horseNo:no,sourceClass:market.sourceClass,trustProbability:null,probabilityReason:'CALIBRATED_FAVORITE_PROBABILITY_NOT_IMPLEMENTED'};
 const input=evidence?.favorite;
 if(!input)return {...base,...hold('FAVORITE_SCENARIO_EVIDENCE_MISSING')};
 const f=root.race.metricInputFreeze,c=input.evidenceContext;
 if(input.raceId!==cpsi.raceId||input.circuit!==root.race.raceType||input.favoriteHorseNo!==no||input.earlyPopularity!==1||input.earlySnapshotId!==market.snapshotId||c?.runId!==f.runId||c?.inputFreezeId!==f.inputSnapshotId||Date.parse(c.freezeAt)!==Date.parse(f.freezeAt)||Date.parse(c.scheduledStartAt)!==Date.parse(f.postAt))return {...base,...hold('FAVORITE_EVIDENCE_CONTEXT_MISMATCH')};
 // Bind every supplied CPSI/horse key to the computation from this exact input.
 const bind=(n,v)=>{const row=cpsi.cpsi.rows.find(h=>h.horseNo===n);return row&&v&&v.value===row.cpsiMainCompat&&v.rank===row.rank&&v.eligibleHorses===cpsi.cpsi.activeRunnerCount&&v.coreUsable===row.coreUsableCount&&v.neutralizedWeightPct===row.neutralizedWeightPct;};
 const roster=root.horses.filter(active);
 if(!bind(no,input.cpsi)||c.runners?.length!==roster.length||roster.some(h=>!c.runners.some(x=>x.horseNo===h.horseNo&&x.horseKey===h.canonicalHorseKey))||(input.challengers||[]).some(h=>!bind(h.horseNo,h.cpsi)||!roster.some(x=>x.horseNo===h.horseNo&&x.canonicalHorseKey===h.horseKey)))return {...base,...hold('FAVORITE_CPSI_OR_ROSTER_MISMATCH')};
 try{return {...base,status:'SHADOW_REVIEW',review:evaluateFavoriteV21Shadow(input)};}catch{return {...base,...hold('FAVORITE_SCENARIO_EVIDENCE_INVALID')};}
}
function longshotReview(root,market,cpsi,evidence){
 const horses=root.horses.filter(active);
 if(!market)return {status:'HOLD',reason:'POPULARITY_SCOPE_UNCONFIRMED',rows:horses.map(h=>({horseNo:h.horseNo,horseKey:h.canonicalHorseKey,popularity:null,...hold('POPULARITY_SCOPE_UNCONFIRMED'),diamondCandidate:null}))};
 const rows=market.rows.filter(m=>m.popularity>=6).map(m=>{
  const h=horses.find(h=>h.horseNo===m.horseNo),row=cpsi.cpsi.rows.find(x=>x.horseNo===m.horseNo);
  const base={horseNo:h.horseNo,horseKey:h.canonicalHorseKey,popularity:m.popularity,odds:m.odds,cpsi:row?.cpsiMainCompat??null,diamondCandidate:null};
  const matches=(evidence?.longshots||[]).filter(e=>e.horseNo===h.horseNo&&e.horseKey===h.canonicalHorseKey);
  if(matches.length!==1)return {...base,...hold('LONGSHOT_SCENARIO_EVIDENCE_MISSING_OR_DUPLICATE')};
  const e=matches[0];
  if(!Array.isArray(e.supportRefs)||e.supportRefs.some(x=>!text(x))||new Set(e.supportRefs).size!==e.supportRefs.length||e.supportRefs.length>16)return {...base,...hold('LONGSHOT_SUPPORT_INVALID')};
  const ability=e.abilitySupport;
  if(row?.cpsiMainCompat==null||!e.supportRefs.length||ability?.horseKey!==h.canonicalHorseKey||ability?.indexSnapshotId!==root.race.metricInputFreeze.indexSnapshotId||!text(ability?.explanation))return {...base,...hold('CPSI_OR_ABILITY_SUPPORT_MISSING')};
  const strong=Array.isArray(e.strongSupportRefs)&&new Set(e.strongSupportRefs).size===e.strongSupportRefs.length&&e.strongSupportRefs.every(ref=>text(ref)&&e.supportRefs.includes(ref))?e.strongSupportRefs.length:0;
  let candidate=null;
  if(text(e.winScenario))candidate=m.popularity>=9&&strong>=2?'💎💎💎':'💎💎';
  else if(text(e.placeScenario)&&e.evSupported===true&&text(e.evSourceRef))candidate='💎';
  if(!candidate)return {...base,...hold('CONCRETE_SCENARIO_OR_EV_MISSING')};
  return {...base,status:'SHADOW_CANDIDATE',diamondCandidate:candidate,winScenario:e.winScenario??null,placeScenario:e.placeScenario??null,supportRefs:e.supportRefs,abilitySupport:ability,strongSupportCount:strong,evidenceBasis:'CALLER_ASSERTED_NOT_AUTHENTICATED'};
 });
 return {status:rows.some(r=>r.status==='HOLD')?'PARTIAL':'REVIEWED',sourceClass:market.sourceClass,rows};
}
export function analyzeDailyRace(unsafe,{now=Date.now(),date=jstDate(now)}={}){
 // JSON is the transport boundary. No accessors are evaluated by this API.
 const root=JSON.parse(unsafe),r=root.race,id=`${r?.raceDate}|${r?.track}|${r?.raceNo}`;
 if(r?.raceDate!==date)throw Error('DAILY_RACE_DATE_MISMATCH');
 if(root.dailyEvidence?.longshots!=null&&(!Array.isArray(root.dailyEvidence.longshots)||root.dailyEvidence.longshots.length>32))throw Error('DAILY_EVIDENCE_BOUND');
 const hasResult=['result','resultSnapshot','validationSnapshot','finishOrder','payout','validated','validationCompleted','hasResult','hasLateMarket'].some(k=>root[k]!=null&&root[k]!==false);
 const cpsi=projectAndCalculateCpsiShadow({race:r,horses:root.horses,organization:r.raceType,raceId:id,hasResult},{now});
 if(!cpsi.cpsi)return {raceId:id,status:'HOLD',cpsi,favorite:hold('PRE_INPUT_REJECTED'),longshots:hold('PRE_INPUT_REJECTED'),wave:hold('PRE_INPUT_REJECTED'),...flags};
 const market=frozenMarket(root,now),evidence=evidenceMatches(root);
 const favorite=favoriteReview(root,market,cpsi,evidence),longshots=longshotReview(root,market,cpsi,evidence),wave=analyzeWave(root,{now,priors:root.dailyPriors??null});
 const complete=favorite.status==='SHADOW_REVIEW'&&longshots.status==='REVIEWED'&&wave.status==='ANALYSIS_TERMINAL'&&cpsi.cpsi.numericMaterializedCount===cpsi.cpsi.activeRunnerCount;
 return {raceId:id,runId:r.metricInputFreeze.runId,status:complete?'REVIEW_COMPLETE':'PARTIAL',cpsi,favorite,longshots,wave,...flags};
}
export async function createDailyRaceArtifact(row,{now=Date.now(),date=jstDate(now)}={}){
 if(row.artifact){await verifySourceArtifact(row.artifact,{now});if(stableSourceJson(sourceInputFromRoot(row.root,{now}))!==stableSourceJson(row.artifact.input))throw Error('SOURCE_DAILY_ROOT_MISMATCH');}
 const inputJson=JSON.stringify(row.root);
 if(new TextEncoder().encode(inputJson).length>2097152)throw Error('DAILY_INPUT_TOO_LARGE');
 const body={version:DAILY_VERSION,date,analyzedAt:new Date(now).toISOString(),sourceRef:row.sourceRef,inputJson,inputHash:await sourceSha256(JSON.parse(inputJson)),result:analyzeDailyRace(inputJson,{now,date}),...flags};
 return {format:DAILY_VERSION,contentHash:await sourceSha256(body),body};
}
export async function verifyDailyRaceArtifact(a){
 if(a?.format!==DAILY_VERSION||a.body?.version!==DAILY_VERSION||a.contentHash!==await sourceSha256(a.body)||a.body.inputHash!==await sourceSha256(JSON.parse(a.body.inputJson)))throw Error('DAILY_HASH_MISMATCH');
 if(stableSourceJson(a.body.result)!==stableSourceJson(analyzeDailyRace(a.body.inputJson,{now:Date.parse(a.body.analyzedAt),date:a.body.date})))throw Error('DAILY_RECOMPUTE_MISMATCH');
 if(Object.entries(flags).some(([k,v])=>a.body[k]!==v))throw Error('DAILY_GOVERNANCE_MISMATCH');
 return a;
}
