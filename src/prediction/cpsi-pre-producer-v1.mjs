/** Explicit, isolated NAR research Producer. No automatic app/Worker/Drive/D1 wiring. */
import {extractNarOfficialHistoryLinks} from './nar-official-history-links.mjs';
import {createSourceArtifact,verifySourceArtifact,stableSourceJson,sourceSha256,BUNDLE_FORMAT} from './cpsi-source-recovery-v1.mjs';
export const INDEX_OBSERVATION_FORMAT='CHASS_CPSI_INDEX_OBSERVATION_V1';
export const PRODUCER_FORMAT='CHASS_CPSI_PRE_PRODUCER_RECEIPT_V1';
const MAX_INDEX=262144,MAX_CARD=1000000,MAX_AGE=60000;
const venues={10:'盛岡',11:'水沢',18:'浦和',19:'船橋',20:'大井',21:'川崎',22:'金沢',23:'笠松',24:'名古屋',27:'園田',28:'姫路',31:'高知',32:'佐賀',36:'門別'};
const primitives=['peak','baseline5','current','prev','distance','course'];
const governance={researchOnly:true,formalKpiEligible:false,sourceOriginAuthenticated:false,productionActivationDecision:'NO-GO',originalEarlyMutation:false};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const text=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=160&&!/[\x00-\x1f\x7f]/.test(v);
function bounded(raw,max){if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength>max)fail('PRODUCER_SOURCE_SIZE_OR_TYPE');return raw;}
export function parseCpsiIndexObservation(raw){
 let data;try{data=JSON.parse(bounded(raw,MAX_INDEX));}catch(e){if(e.code)throw e;fail('PRODUCER_INDEX_JSON_INVALID');}
 if(!exact(data,['format','race','horses'])||data.format!==INDEX_OBSERVATION_FORMAT||!exact(data.race,['organization','raceDate','track','code','raceNo','surface'])||!Array.isArray(data.horses)||data.horses.length<2||data.horses.length>30)fail('PRODUCER_INDEX_SCHEMA');
 const r=data.race,date=new Date(`${r.raceDate}T00:00:00Z`);
 if(r.organization!=='NAR'||!/^\d{4}-\d{2}-\d{2}$/.test(r.raceDate||'')||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==r.raceDate||venues[String(r.code)]!==r.track||!Number.isInteger(r.raceNo)||r.raceNo<1||r.raceNo>12||r.surface!=='ダート')fail('PRODUCER_RACE_IDENTITY');
 const nos=new Set();
 for(const h of data.horses){
  if(!exact(h,['horseNo','horseName',...primitives])||!Number.isInteger(h.horseNo)||h.horseNo<1||h.horseNo>30||nos.has(h.horseNo)||!text(h.horseName))fail('PRODUCER_RUNNER_IDENTITY');
  nos.add(h.horseNo);
  for(const key of primitives)if(h[key]!==undefined&&h[key]!==null&&(typeof h[key]!=='number'||!Number.isFinite(h[key])))fail('PRODUCER_PRIMITIVE_NOT_NUMERIC');
 }
 return data;
}
export function cpsiProducerCardUrl(race){
 const url=new URL('https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTable');
 url.searchParams.set('k_raceDate',race.raceDate.replaceAll('-','/'));url.searchParams.set('k_babaCode',String(race.code));url.searchParams.set('k_raceNo',String(race.raceNo));return url.href;
}
export async function verifyCpsiProducerReceipt(receipt,{now=Date.now()}={}){
 if(!exact(receipt,['format','contentHash','body'])||receipt.format!==PRODUCER_FORMAT||await sourceSha256(receipt.body)!==receipt.contentHash)fail('PRODUCER_RECEIPT_HASH');
 const b=receipt.body;
 if(b.sourceOriginAuthenticated!==false||b.formalKpiEligible!==false||b.researchOnly!==true)fail('PRODUCER_RECEIPT_GOVERNANCE');
 await verifySourceArtifact(b.artifact,{now});
 const index=parseCpsiIndexObservation(b.indexObservation.raw);
 const card=await extractNarOfficialHistoryLinks(bounded(b.officialCard.raw,MAX_CARD),{sourceUrl:cpsiProducerCardUrl(index.race),date:index.race.raceDate,track:index.race.track,code:String(index.race.code),raceNo:index.race.raceNo,observedAt:b.officialCard.observedAt,expectedHorses:index.horses});
 if(stableSourceJson(card)!==stableSourceJson(b.officialIdentities))fail('PRODUCER_OFFICIAL_IDENTITY_READBACK');
 const input=b.artifact.input,r=index.race;
 if(input.raceId!==`${r.raceDate}|${r.track}|${r.raceNo}`||input.organization!=='NAR'||input.race.surface!==r.surface||input.postAt!==`${r.raceDate}T${card.body.postTime}:00+09:00`||input.horses.length!==index.horses.length)fail('PRODUCER_RECEIPT_BINDING');
 const started=Date.parse(b.startedAt),indexAt=Date.parse(b.indexObservation.observedAt),cardAt=Date.parse(b.officialCard.observedAt),frozen=Date.parse(input.freezeAt);
 if(![started,indexAt,cardAt,frozen,now].every(Number.isFinite)||started>indexAt||indexAt>cardAt||cardAt>frozen||frozen>now||frozen-indexAt>MAX_AGE||frozen-started>MAX_AGE)fail('PRODUCER_OBSERVATION_TIME');
 const authority=`observed-index:${await sourceSha256(b.indexObservation.raw)}`;
 for(const h of input.horses){
  const row=index.horses.find(v=>v.horseNo===h.horseNo),identity=card.body.rows.find(v=>v.horseNo===h.horseNo);
  if(!row||!identity||h.canonicalHorseKey!==identity.providerHorseKey||h.canonicalIndex?.capturedAt!==b.indexObservation.observedAt||h.canonicalIndex?.authorityRef!==authority)fail('PRODUCER_RUNNER_BINDING');
  for(const k of primitives)if((h.canonicalIndex[k]??null)!==(row[k]??null))fail('PRODUCER_INDEX_BINDING');
 }
 return receipt;
}
/** Dependencies observe fresh bytes; labels and local hashes never authenticate a provider. */
export async function captureCpsiPreRun({enabled=false,acquireIndex,acquireCard,store,clock=Date.now,randomUUID=()=>crypto.randomUUID()}={}){
 if(enabled!==true)return {status:'DISABLED',...governance};
 let stored=false;
 try{
  if(typeof acquireIndex!=='function'||typeof acquireCard!=='function'||typeof store?.insertIfAbsent!=='function'||typeof store?.get!=='function'||typeof clock!=='function')fail('PRODUCER_DEPENDENCY_REQUIRED');
  const started=clock();if(!Number.isFinite(started))fail('PRODUCER_CLOCK_INVALID');
  const rawIndex=bounded(await acquireIndex(),MAX_INDEX),indexAt=clock(),index=parseCpsiIndexObservation(rawIndex),r=index.race;
  if(!Number.isFinite(indexAt)||indexAt<started)fail('PRODUCER_CLOCK_INVALID');
  const cardUrl=cpsiProducerCardUrl(r),rawCard=bounded(await acquireCard(Object.freeze({url:cardUrl})),MAX_CARD),cardAt=clock();
  if(!Number.isFinite(cardAt)||cardAt<indexAt)fail('PRODUCER_CLOCK_INVALID');
  const identities=await extractNarOfficialHistoryLinks(rawCard,{sourceUrl:cardUrl,date:r.raceDate,track:r.track,code:String(r.code),raceNo:r.raceNo,observedAt:new Date(cardAt).toISOString(),expectedHorses:index.horses});
  const freezeAt=clock(),postAt=`${r.raceDate}T${identities.body.postTime}:00+09:00`;
  if(!Number.isFinite(freezeAt)||freezeAt<cardAt||freezeAt-indexAt>MAX_AGE||freezeAt-started>MAX_AGE||freezeAt>=Date.parse(postAt))fail('PRODUCER_NOT_FRESH_PRE');
  const uuid=()=>{const id=randomUUID();if(typeof id!=='string'||!/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}$/.test(id))fail('PRODUCER_UUID_INVALID');return id;};
  const freeze={runId:'CPSI-RUN-'+uuid(),inputSnapshotId:'CPSI-INPUT-'+uuid(),indexSnapshotId:'CPSI-INDEX-'+uuid(),freezeAt:new Date(freezeAt).toISOString(),postAt};
  if(new Set([freeze.runId.slice(9),freeze.inputSnapshotId.slice(11),freeze.indexSnapshotId.slice(11)]).size!==3)fail('PRODUCER_UUID_COLLISION');
  const raceId=`${r.raceDate}|${r.track}|${r.raceNo}`,authorityRef=`observed-index:${await sourceSha256(rawIndex)}`;
  const root={format:'CHASS_CPSI_PRE_INPUT_V1',race:{raceDate:r.raceDate,track:r.track,raceNo:r.raceNo,raceType:'NAR',surface:r.surface,metricInputFreeze:freeze},horses:index.horses.map(h=>({horseNo:h.horseNo,canonicalHorseKey:identities.body.rows.find(i=>i.horseNo===h.horseNo).providerHorseKey,canonicalIndex:{organizer:'NAR',raceId,runId:freeze.runId,inputSnapshotId:freeze.inputSnapshotId,kind:'EARLY',isPreResult:true,capturedAt:new Date(indexAt).toISOString(),authorityRef,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:freeze.indexSnapshotId,...Object.fromEntries(primitives.map(k=>[k,h[k]??null]))}}))};
  const artifact=await createSourceArtifact(root,{sourceRef:'producer:observed-index-bytes',now:freezeAt});
  const body={...governance,startedAt:new Date(started).toISOString(),indexObservation:{raw:rawIndex,observedAt:new Date(indexAt).toISOString(),timeMeaning:'BYTES_READ_COMPLETED_NOT_ORIGINAL_SCREENSHOT_TIME'},officialCard:{raw:rawCard,observedAt:new Date(cardAt).toISOString(),url:cardUrl},officialIdentities:identities,artifact};
  const receipt={format:PRODUCER_FORMAT,body,contentHash:await sourceSha256(body)};
  const beforeCommit=clock();await verifyCpsiProducerReceipt(receipt,{now:beforeCommit});
  if(beforeCommit<freezeAt)fail('PRODUCER_CLOCK_INVALID');
  if(await store.insertIfAbsent(freeze.runId,receipt)!==true)fail('PRODUCER_RUN_ALREADY_EXISTS');stored=true;
  const readback=await store.get(freeze.runId),readAt=clock();
  await verifyCpsiProducerReceipt(readback,{now:readAt});
  if(readAt<beforeCommit||stableSourceJson(readback)!==stableSourceJson(receipt))fail('PRODUCER_READBACK_MISMATCH');
  const sourceJson=JSON.stringify(readback.body.artifact);
  if(sourceJson.length>50000)fail('PRODUCER_FEED_CELL_TOO_LARGE');
  return {status:'LOCAL_PRE_SOURCE_READY',...governance,stored:true,readbackVerified:true,readbackScope:'CALLER_STORE_ADAPTER',runId:freeze.runId,receipt:readback,bundle:{format:BUNDLE_FORMAT,sources:[readback.body.artifact]},feedRow:['NAR',raceId,sourceJson]};
 }catch(error){return {status:'REJECTED',reason:error.code||error.message||'PRODUCER_FAILED',...governance,stored,readbackVerified:false};}
}
