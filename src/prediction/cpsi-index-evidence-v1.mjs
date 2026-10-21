/** Local historical evidence only. No PRE admission, provider authentication or network. */
import {verifyCpsiProducerReceipt} from './cpsi-pre-producer-v1.mjs';
import {sourceSha256,stableSourceJson} from './cpsi-source-recovery-v1.mjs';
export const EVIDENCE_FORMAT='CHASS_CPSI_INDEX_EVIDENCE_ARCHIVE_V1';
export const TRANSCRIPTION_FORMAT='CHASS_CPSI_RAW_TRANSCRIPTION_V1';
export const RULE_VERSION='RAW_SEVEN_STAR_HELD_V1';
const cols=['highest','average_5','distance','course','three_runs_ago','two_runs_ago','previous_run'];
const map={highest:'peak',average_5:'baseline5',distance:'distance',course:'course',previous_run:'prev'};
const flags={researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false,importable:false,originalEarlyMutation:false,productionWritePerformed:false};
const fail=code=>{throw Object.assign(new Error(code),{code});};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const equal=(a,b,code)=>{if(stableSourceJson(a)!==stableSourceJson(b))fail(code);};
const bounded=(s,max)=>{if(typeof s!=='string'||new TextEncoder().encode(s).length>max)fail('EVIDENCE_INPUT_SIZE');return s;};
const json=(s,max)=>{try{return JSON.parse(bounded(s,max));}catch(e){if(e.code)throw e;fail('EVIDENCE_JSON_INVALID');}};
const pngMagic=[137,80,78,71,13,10,26,10];
async function imageHash(bytes){
 if(!(bytes instanceof Uint8Array)||bytes.length<8||bytes.length>786432||pngMagic.some((x,i)=>bytes[i]!==x))fail('EVIDENCE_PNG_INVALID');
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');
}
function encode(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function decode(s){
 if(typeof s!=='string'||s.length>1048576||!s.length||s.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(s))fail('EVIDENCE_IMAGE_ENCODING');
 let raw;try{raw=atob(s);}catch{fail('EVIDENCE_IMAGE_ENCODING');}
 const bytes=Uint8Array.from(raw,x=>x.charCodeAt(0));if(encode(bytes)!==s)fail('EVIDENCE_IMAGE_ENCODING');return bytes;
}
export function parseRawIndexCell(raw,column){
 if(raw==='-'||raw==='未')return {raw,numericCandidate:null,adoptedValue:null,reason:raw==='-'?'MISSING_NOT_ZERO':'UNTRIED_LABEL_NOT_ZERO'};
 if(typeof raw!=='string'||raw.length>32||!/^[-+]?\d+\*?$/.test(raw))fail('EVIDENCE_RAW_CELL_INVALID');
 const star=raw.endsWith('*'),value=Number(star?raw.slice(0,-1):raw);
 if(!Number.isSafeInteger(value)||star&&column!=='average_5')fail('EVIDENCE_RAW_CELL_INVALID');
 return {raw,numericCandidate:value,adoptedValue:star?null:value,reason:star?'STAR_UNRESOLVED_HELD':null};
}
async function derive(receiptRaw,transcriptionRaw,imageBytes){
 const receipt=json(receiptRaw,1500000),t=json(transcriptionRaw,131072);
 const freeze=Date.parse(receipt?.body?.artifact?.input?.freezeAt);
 if(!Number.isFinite(freeze))fail('EVIDENCE_RECEIPT_FREEZE');
 await verifyCpsiProducerReceipt(receipt,{now:freeze});
 if(!exact(t,['format','ruleVersion','imageSha256','raceId','method','rows'])||t.format!==TRANSCRIPTION_FORMAT||t.ruleVersion!==RULE_VERSION||t.method!=='MANUAL_TRANSCRIPTION'||!Array.isArray(t.rows))fail('EVIDENCE_TRANSCRIPTION_SCHEMA');
 const hash=await imageHash(imageBytes),input=receipt.body.artifact.input,obs=JSON.parse(receipt.body.indexObservation.raw);
 if(t.imageSha256!==hash||t.raceId!==input.raceId||t.rows.length!==input.horses.length)fail('EVIDENCE_SOURCE_BINDING');
 const seen=new Set(),decisions=[];
 for(const row of t.rows){
  if(!exact(row,['horseNo','horseName','canonicalHorseKey','raw'])||!exact(row.raw,cols)||!Number.isInteger(row.horseNo)||seen.has(row.horseNo))fail('EVIDENCE_TRANSCRIPTION_ROW');
  seen.add(row.horseNo);
  const horse=input.horses.find(h=>h.horseNo===row.horseNo),observed=obs.horses.find(h=>h.horseNo===row.horseNo);
  if(!horse||!observed||horse.canonicalHorseKey!==row.canonicalHorseKey||observed.horseName!==row.horseName)fail('EVIDENCE_IDENTITY_MISMATCH');
  const cells=Object.fromEntries(cols.map(k=>[k,parseRawIndexCell(row.raw[k],k)]));
  for(const [old,key]of Object.entries(map))if(cells[old].adoptedValue!==(horse.canonicalIndex[key]??null))fail('EVIDENCE_PRIMITIVE_MISMATCH');
  if(horse.canonicalIndex.current!=null)fail('EVIDENCE_CURRENT_NOT_IN_IMAGE');
  decisions.push({horseNo:row.horseNo,cells,current:{adoptedValue:null,reason:'NOT_PRESENT_IN_SEVEN_COLUMN_IMAGE'}});
 }
 return {raceId:input.raceId,runId:input.runId,receiptContentHash:receipt.contentHash,sourceHash:receipt.body.artifact.contentHash,
  image:{mimeType:'image/png',byteLength:imageBytes.length,sha256:hash,base64:encode(imageBytes)},decisions};
}
export async function createIndexEvidence({receiptRaw,transcriptionRaw,imageBytes,recordedAt=Date.now()}){
 if(!Number.isFinite(recordedAt))fail('EVIDENCE_CLOCK_INVALID');
 const data=await derive(receiptRaw,transcriptionRaw,imageBytes);
 const body={...flags,recordedAt:new Date(recordedAt).toISOString(),timeMeaning:'LOCAL_ARCHIVE_CREATION_NOT_SOURCE_CAPTURE',verificationScope:'HISTORICAL_RECEIPT_AT_ITS_STORED_FREEZE_NOT_CURRENT_PRE_ADMISSION',
  ruleVersion:RULE_VERSION,receiptRaw,transcriptionRaw,...data};
 if(recordedAt<Date.parse(JSON.parse(receiptRaw).body.artifact.input.freezeAt))fail('EVIDENCE_CLOCK_BEFORE_FREEZE');
 return {format:EVIDENCE_FORMAT,contentHash:await sourceSha256(body),body};
}
export async function verifyIndexEvidence(archive){
 if(!exact(archive,['format','contentHash','body'])||archive.format!==EVIDENCE_FORMAT||await sourceSha256(archive.body)!==archive.contentHash)fail('EVIDENCE_ARCHIVE_HASH');
 const b=archive.body;
 const expected=await createIndexEvidence({receiptRaw:b.receiptRaw,transcriptionRaw:b.transcriptionRaw,imageBytes:decode(b.image?.base64),recordedAt:Date.parse(b.recordedAt)});
 equal(archive,expected,'EVIDENCE_ARCHIVE_BINDING');return archive;
}
/** Insert once, independently reread; partial commits are quarantined without READY. */
export async function saveIndexEvidenceAndReadback(store,archive){
 await verifyIndexEvidence(archive);
 if(typeof store?.insertIfAbsent!=='function'||typeof store?.get!=='function')fail('EVIDENCE_STORE_REQUIRED');
 if(await store.insertIfAbsent(archive.contentHash,archive)!==true)fail('EVIDENCE_ALREADY_EXISTS');
 const readback=await store.get(archive.contentHash);await verifyIndexEvidence(readback);equal(readback,archive,'EVIDENCE_READBACK_MISMATCH');
 return {status:'LOCAL_INDEX_EVIDENCE_READBACK_VERIFIED',...flags,contentHash:archive.contentHash,runId:archive.body.runId,readbackVerified:true,readbackScope:'CALLER_STORE_ADAPTER'};
}
