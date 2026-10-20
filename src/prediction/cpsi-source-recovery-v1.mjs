/** Private, device-local CPSI source library. No market, production record or network access. */
import {calculateCpsiShadow,projectAndCalculateCpsiShadow} from './chass-cpsi-wave-core-v1.mjs';
export const SOURCE_FORMAT='CHASS_CPSI_SOURCE_V1';
export const BUNDLE_FORMAT='CHASS_CPSI_SOURCE_BUNDLE_V1';
const primitives=['peak','baseline5','current','prev','distance','course'];
const freezeKeys=['runId','inputSnapshotId','indexSnapshotId','freezeAt','postAt'];
const clone=x=>JSON.parse(JSON.stringify(x));
const fail=code=>{throw Object.assign(new Error(code),{code});};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
export function stableSourceJson(x){
 if(x===null||typeof x!=='object')return JSON.stringify(x);
 if(Array.isArray(x))return '['+x.map(stableSourceJson).join(',')+']';
 return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+stableSourceJson(x[k])).join(',')+'}';
}
export async function sourceSha256(value){
 const bytes=new TextEncoder().encode(stableSourceJson(value));
 if(bytes.length>2097152)fail('SOURCE_TOO_LARGE');
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return 'sha256:'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
function checkKeys(horses){
 const keys=new Set();
 for(const h of horses){
  if(typeof h.canonicalHorseKey!=='string'||!h.canonicalHorseKey.trim()||h.canonicalHorseKey.length>256||keys.has(h.canonicalHorseKey))fail('CANONICAL_HORSE_KEY_REQUIRED_OR_DUPLICATE');
  keys.add(h.canonicalHorseKey);
  for(const k of primitives)if(h.canonicalIndex?.[k]!=null&&!finite(h.canonicalIndex[k]))fail('SOURCE_PRIMITIVE_NOT_NUMERIC');
 }
}
function validatedInput(input,options){
 if(typeof input?.indexSnapshotId!=='string'||!input.indexSnapshotId.trim())fail('INDEX_SNAPSHOT_REQUIRED');
 const result=calculateCpsiShadow(input,options);
 if(!result.cpsi)fail(result.reasons?.[0]||'SOURCE_INVALID');
 checkKeys(input.horses);
 // Never accept two upstream authorities as an independently verified source.
 const authorities=new Set(input.horses.map(h=>h.canonicalIndex?.authorityRef).filter(Boolean));
 if(authorities.size>1)fail('SOURCE_AUTHORITY_CONFLICT');
 return result;
}
export function sourceInputFromRoot(root,options={}){
 const race=root?.race,organization=race?.raceType||(race?.category==='中央競馬'?'JRA':race?.category==='地方競馬'?'NAR':null);
 const result=projectAndCalculateCpsiShadow({race,horses:root?.horses,organization,raceId:`${race?.raceDate}|${race?.track}|${race?.raceNo}`,hasResult:!!(root?.result||root?.resultSnapshot||root?.validationSnapshot||root?.validated||root?.validationCompleted)},options);
 if(!result.cpsi)fail(result.reasons?.[0]||'SOURCE_INVALID');
 const input={organization:result.organization,raceId:result.raceId,...Object.fromEntries(freezeKeys.map(k=>[k,result[k]??race.metricInputFreeze[k]])),...result.inputComparisonData};
 checkKeys(input.horses);
 validatedInput(input,options);
 return clone(input);
}
export function sourceContextKey(input){
 return stableSourceJson([input.organization,input.raceId,input.race,...freezeKeys.map(k=>input[k]),
  input.horses.map(h=>[h.horseNo,h.canonicalHorseKey,h.runnerStatus||'active',h.eligible!==false]).sort((a,b)=>a[0]-b[0])]);
}
export function sourceRootFromInput(input){
 return {format:'CHASS_CPSI_PRE_INPUT_V1',race:{...clone(input.race),category:input.organization==='JRA'?'中央競馬':'地方競馬',metricInputFreeze:Object.fromEntries(freezeKeys.map(k=>[k,input[k]]))},horses:clone(input.horses)};
}
export async function createSourceArtifact(root,{sourceRef='device-input',now=Date.now()}={}){
 if(typeof sourceRef!=='string'||!sourceRef.trim()||sourceRef.length>512)fail('SOURCE_REFERENCE_REQUIRED');
 const input=sourceInputFromRoot(root,{now});
 if(!input.horses.some(h=>primitives.some(k=>finite(h.canonicalIndex?.[k]))||Object.values(h.cpsiDomains||{}).some(s=>s?.status==='RESOLVED')))fail('SOURCE_HAS_NO_PRIMITIVES');
 const contentHash=await sourceSha256(input);
 return {format:SOURCE_FORMAT,id:contentHash,contextKey:sourceContextKey(input),sourceRef,contentHash,input,
  registeredAt:new Date(now).toISOString(),sourceOriginAuthenticated:false};
}
export async function verifySourceArtifact(artifact,options={}){
 if(!artifact||artifact.format!==SOURCE_FORMAT||artifact.sourceOriginAuthenticated!==false||typeof artifact.sourceRef!=='string'||!artifact.sourceRef.trim()||artifact.sourceRef.length>512)fail('SOURCE_ARTIFACT_INVALID');
 validatedInput(artifact.input,options);
 const hash=await sourceSha256(artifact.input);
 if(hash!==artifact.contentHash||hash!==artifact.id||sourceContextKey(artifact.input)!==artifact.contextKey)fail('SOURCE_HASH_OR_CONTEXT_MISMATCH');
 return artifact;
}
/** Storage adapter must resolve put only AFTER its transaction commits, then read independently. */
export async function saveSourceAndReadback(store,artifact,options={}){
 await verifySourceArtifact(artifact,options);
 await store.put(artifact);
 const readback=await store.get(artifact.id);
 await verifySourceArtifact(readback,options);
 if(stableSourceJson(readback)!==stableSourceJson(artifact))fail('SOURCE_READBACK_MISMATCH');
 const expected=artifact.input.horses.map(h=>[h.horseNo,h.canonicalHorseKey]).sort((a,b)=>a[0]-b[0]);
 const actual=readback.input.horses.map(h=>[h.horseNo,h.canonicalHorseKey]).sort((a,b)=>a[0]-b[0]);
 if(actual.length!==expected.length||stableSourceJson(actual)!==stableSourceJson(expected))fail('SOURCE_READBACK_ROSTER_MISMATCH');
 return {status:'DEVICE_READBACK_VERIFIED',physicalReadbackVerified:true,readbackScope:'DEVICE_INDEXED_DB',
  sourceOriginAuthenticated:false,contentHash:artifact.contentHash,horseCount:actual.length};
}
/** Recover only absent primitives in an EXACT context. Conflicts never overwrite any target. */
export async function recoverCpsiSources(root,artifacts,{now=Date.now()}={}){
 const original=sourceInputFromRoot(root,{now}),input=clone(original),contextKey=sourceContextKey(input),events=[];
 if(!Array.isArray(artifacts)||artifacts.length>64)fail('SOURCE_COUNT_INVALID');
 const candidates=[];
 for(const a of artifacts){await verifySourceArtifact(a,{now});if(a.contextKey===contextKey)candidates.push(a);else events.push({code:'SOURCE_CONTEXT_DIFFERENT',sourceHash:a.contentHash});}
 candidates.sort((a,b)=>a.contentHash.localeCompare(b.contentHash));
 const authorities=new Set([input,...candidates.map(a=>a.input)].flatMap(i=>i.horses.map(h=>h.canonicalIndex?.authorityRef).filter(Boolean)));
 if(authorities.size>1)return {status:'SOURCE_CONFLICT',recoveredFields:0,candidateCount:candidates.length,events:[...events,{code:'SOURCE_AUTHORITY_CONFLICT'}],root:sourceRootFromInput(original),result:validatedInput(original,{now}),sourceOriginAuthenticated:false,formalKpiEligible:false,originalEarlyMutation:false};
 const byNo=new Map(input.horses.map(h=>[h.horseNo,h]));
 let recoveredFields=0,conflict=false;
 const metadata=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!primitives.includes(k)));
 for(const a of candidates)for(const source of a.input.horses){
  const target=byNo.get(source.horseNo);
  if(!source.canonicalIndex)continue;
  if(!target.canonicalIndex)target.canonicalIndex={...metadata(source.canonicalIndex)};
  if(stableSourceJson(metadata(target.canonicalIndex))!==stableSourceJson(metadata(source.canonicalIndex))){conflict=true;events.push({code:'SOURCE_METADATA_CONFLICT',horseNo:source.horseNo,sourceHash:a.contentHash});continue;}
  for(const field of primitives){
   const incoming=source.canonicalIndex[field],current=target.canonicalIndex[field];
   if(!finite(incoming))continue;
   if(current!=null&&current!==incoming){conflict=true;events.push({code:'SOURCE_PRIMITIVE_CONFLICT',horseNo:source.horseNo,field,sourceHash:a.contentHash});}
   else if(current==null){target.canonicalIndex[field]=incoming;recoveredFields++;events.push({code:'MISSING_PRIMITIVE_RECOVERED',horseNo:source.horseNo,field,sourceHash:a.contentHash});}
  }
 }
 // D–G are never synthesized; only complete existing authorized scorer payloads may fill a gap.
 for(const a of candidates)for(const source of a.input.horses){
  const target=byNo.get(source.horseNo);
  for(const k of ['D','E','F','G']){
   const incoming=source.cpsiDomains?.[k];if(!incoming||incoming.status!=='RESOLVED')continue;
   const current=target.cpsiDomains?.[k];
   if(current!=null&&stableSourceJson(current)!==stableSourceJson(incoming)){conflict=true;events.push({code:'SOURCE_COMPONENT_CONFLICT',horseNo:source.horseNo,field:k,sourceHash:a.contentHash});}
   else if(current==null){target.cpsiDomains??={};target.cpsiDomains[k]=clone(incoming);recoveredFields++;events.push({code:'MISSING_COMPONENT_RECOVERED',horseNo:source.horseNo,field:k,sourceHash:a.contentHash});}
  }
 }
 const selected=conflict?original:input,result=validatedInput(selected,{now});
 return {status:conflict?'SOURCE_CONFLICT':recoveredFields?'RECOVERED':candidates.length?'UNCHANGED':'SOURCE_NOT_FOUND',
  recoveredFields:conflict?0:recoveredFields,candidateCount:candidates.length,events,root:sourceRootFromInput(selected),result,
  sourceOriginAuthenticated:false,formalKpiEligible:false,originalEarlyMutation:false};
}
export async function artifactsFromSourceFile(text,{sourceRef,now=Date.now()}={}){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>2097152)fail('SOURCE_TOO_LARGE');
 let root;try{root=JSON.parse(text.replace(/^\uFEFF/,''));}catch{fail('SOURCE_JSON_INVALID');}
 const roots=root?.format===BUNDLE_FORMAT?root.sources:[root];
 if(!Array.isArray(roots)||roots.length<1||roots.length>24)fail('SOURCE_COUNT_INVALID');
 const artifacts=[];
 for(const item of roots){
  if(item?.format===SOURCE_FORMAT){await verifySourceArtifact(item,{now});artifacts.push(clone(item));}
  else artifacts.push(await createSourceArtifact(item,{sourceRef,now}));
 }
 // Validate the whole file before any storage mutation; repeated exact sources are idempotent.
 return [...new Map(artifacts.map(a=>[a.id,a])).values()];
}
export function openDeviceSourceStore(indexedDB=globalThis.indexedDB){
 if(!indexedDB)return Promise.reject(new Error('DEVICE_STORAGE_UNAVAILABLE'));
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('chass-cpsi-sources-v1',1);
  request.onupgradeneeded=()=>{const s=request.result.createObjectStore('sources',{keyPath:'id'});s.createIndex('contextKey','contextKey');};
  request.onerror=()=>reject(new Error('DEVICE_STORAGE_OPEN_FAILED'));
  request.onblocked=()=>reject(new Error('DEVICE_STORAGE_BLOCKED'));
  request.onsuccess=()=>{
   const db=request.result;
   const read=(make)=>new Promise((ok,no)=>{const tx=db.transaction('sources','readonly'),req=make(tx.objectStore('sources'));let value;req.onsuccess=()=>{value=req.result};tx.oncomplete=()=>ok(value);tx.onabort=tx.onerror=()=>no(new Error('DEVICE_STORAGE_READ_FAILED'));});
   resolve({close:()=>db.close(),get:id=>read(s=>s.get(id)),list:contextKey=>read(s=>s.index('contextKey').getAll(contextKey,65)),
    put:artifact=>new Promise((ok,no)=>{
     const tx=db.transaction('sources','readwrite'),s=tx.objectStore('sources'),old=s.get(artifact.id);let code='DEVICE_STORAGE_WRITE_FAILED';
     old.onsuccess=()=>{
      if(old.result){if(stableSourceJson(old.result)!==stableSourceJson(artifact)){
       // Only registration metadata may change for an identical immutable input/hash.
       if(old.result.contentHash!==artifact.contentHash||stableSourceJson(old.result.input)!==stableSourceJson(artifact.input)){code='SOURCE_IMMUTABLE_CONFLICT';tx.abort();}
       else s.put(artifact);
      }return;}
      const count=s.count();count.onsuccess=()=>{if(count.result>=128){code='DEVICE_SOURCE_CAPACITY';tx.abort();}else s.add(artifact);};
     };
     tx.oncomplete=()=>ok();tx.onabort=tx.onerror=()=>no(new Error(code));
    })});
  };
 });
}
