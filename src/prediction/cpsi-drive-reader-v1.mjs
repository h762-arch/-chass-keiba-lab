/** Explicit opt-in, authenticated, read-only CPSI source transport. Server only. */
import {BUNDLE_FORMAT,SOURCE_FORMAT,createSourceArtifact,verifySourceArtifact,sourceRootFromInput,sourceContextKey,recoverCpsiSources} from './cpsi-source-recovery-v1.mjs';
export const CPSI_DRIVE_PATH='/api/cpsi/sources/drive';
const OAUTH='https://oauth2.googleapis.com/token',DRIVE='https://www.googleapis.com/drive/v3/files/';
const SCOPE='https://www.googleapis.com/auth/drive.readonly';
const MAX_BYTES=2097152;
const INTERNAL=Symbol('cpsi-drive-error');
const error=(code,status=422)=>Object.assign(new Error(code),{code,status,[INTERNAL]:true});
const reject=(code,status)=>{throw error(code,status);};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
 'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0',
 'pragma':'no-cache','vary':'Authorization, Origin','x-content-type-options':'nosniff','referrer-policy':'no-referrer'
}});
const text=x=>typeof x==='string'&&x.trim()&&x.length<=256;
const fileId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,160}$/.test(x);
const JRA=new Set(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
const NAR=new Set(['帯広','盛岡','水沢','浦和','船橋','大井','川崎','笠松','金沢','名古屋','園田','姫路','高知','佐賀','門別']);
export function parseDriveSelection(url){
 const allowed=['organization','raceId','runId','inputSnapshotId','indexSnapshotId'];
 if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1))reject('DRIVE_SELECTION_INVALID',400);
 const organization=url.searchParams.get('organization'),raceId=url.searchParams.get('raceId');
 const m=typeof raceId==='string'&&raceId.match(/^(\d{4}-\d{2}-\d{2})\|([^|]+)\|([1-9]|1[0-2])$/);
 if(!['JRA','NAR'].includes(organization)||!m||!(organization==='JRA'?JRA:NAR).has(m[2]))reject('DRIVE_SELECTION_INVALID',400);
 const date=new Date(m[1]+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==m[1])reject('DRIVE_SELECTION_INVALID',400);
 const selection={organization,raceId};
 const ids=allowed.slice(2).map(k=>url.searchParams.get(k));
 if(allowed.slice(2).some(k=>url.searchParams.has(k))&&!ids.every(text))reject('DRIVE_SELECTION_INVALID',400);
 for(const k of allowed.slice(2))if(url.searchParams.has(k))selection[k]=url.searchParams.get(k);
 return selection;
}
export function parseDriveSources(raw){
 let config;try{if(typeof raw!=='string'||raw.length>16384)throw Error();config=JSON.parse(raw);}catch{reject('DRIVE_CONFIG_INVALID',503);}
 if(config?.version!==1||!Array.isArray(config.sources)||config.sources.length<1||config.sources.length>8||Object.keys(config).some(k=>!['version','sources'].includes(k)))reject('DRIVE_CONFIG_INVALID',503);
 const ids=new Set();
 for(const s of config.sources){
  if(!s||Object.keys(s).some(k=>!['sourceId','organization','fileId','kind','range'].includes(k))||!text(s.sourceId)||ids.has(s.sourceId)||!['JRA','NAR'].includes(s.organization)||!fileId(s.fileId)||!['drive_json','sheets_feed'].includes(s.kind))reject('DRIVE_CONFIG_INVALID',503);
  ids.add(s.sourceId);
  if(s.kind==='drive_json'&&s.range!=null)reject('DRIVE_CONFIG_INVALID',503);
  if(s.kind==='sheets_feed'){
   // Exact tab and a small rectangular feed only; no entire-sheet or arbitrary URL reads.
   if(typeof s.range!=='string'||s.range.length>150||!/^'(?:[^'!\r\n]|''){1,100}'!A1:C(?:[2-9]|1\d|2[0-5])$/.test(s.range))reject('DRIVE_CONFIG_INVALID',503);
  }
 }
 return config.sources;
}
async function readBounded(r,limit=MAX_BYTES){
 if(Number(r.headers.get('content-length'))>limit)reject('DRIVE_PAYLOAD_TOO_LARGE',502);
 if(!r.body)reject('DRIVE_RESPONSE_INVALID',502);
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)reject('DRIVE_PAYLOAD_TOO_LARGE',502);chunks.push(value);}}
 catch(e){await reader.cancel().catch(()=>{});throw e;}
 const bytes=new Uint8Array(size);let offset=0;for(const b of chunks){bytes.set(b,offset);offset+=b.length;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject('DRIVE_RESPONSE_INVALID',502);}
}
async function jsonRead(r,limit){let s=await readBounded(r,limit);try{return JSON.parse(s);}catch{reject('DRIVE_RESPONSE_INVALID',502);}}
function b64url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
const encoded=x=>b64url(new TextEncoder().encode(JSON.stringify(x)));
async function bearerValid(actual,expected){
 if(typeof expected!=='string'||!/^[-A-Za-z0-9_]{32,256}$/.test(expected))reject('DRIVE_CONFIG_INVALID',503);
 if(typeof actual!=='string'||actual.length>264||!actual.startsWith('Bearer '))return false;
 const [a,b]=await Promise.all([actual.slice(7),expected].map(s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));
 let diff=0;const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0;
}
async function serviceAccessToken(raw,{fetchImpl,signal,now}){
 let sa;try{if(typeof raw!=='string'||raw.length>16384)throw Error();sa=JSON.parse(raw);}catch{reject('DRIVE_CREDENTIALS_INVALID',503);}
 if(sa?.type!=='service_account'||typeof sa.client_email!=='string'||!/^[-A-Za-z0-9_.]+@[-A-Za-z0-9.]+\.iam\.gserviceaccount\.com$/.test(sa.client_email)||typeof sa.private_key!=='string'||sa.private_key.length>8192||!sa.private_key.startsWith('-----BEGIN PRIVATE KEY-----')||(sa.token_uri&&sa.token_uri!==OAUTH)||sa.subject!=null)reject('DRIVE_CREDENTIALS_INVALID',503);
 const header={alg:'RS256',typ:'JWT'};
 if(sa.private_key_id!=null){if(typeof sa.private_key_id!=='string'||!/^[-A-Za-z0-9_]{1,128}$/.test(sa.private_key_id))reject('DRIVE_CREDENTIALS_INVALID',503);header.kid=sa.private_key_id;}
 const iat=Math.floor(now/1000),body={iss:sa.client_email,scope:SCOPE,aud:OAUTH,iat,exp:iat+3600};
 const unsigned=encoded(header)+'.'+encoded(body);let signature;
 try{
  const pem=sa.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
  const der=Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
  const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(unsigned));
 }catch{reject('DRIVE_CREDENTIALS_INVALID',503);}
 const bodyText=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:unsigned+'.'+b64url(new Uint8Array(signature))});
 // workerd rejects redirect:error before I/O; manual plus !ok below rejects every 3xx.
 const r=await fetchImpl(OAUTH,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','accept':'application/json'},body:bodyText.toString(),redirect:'manual',signal});
 if(!r.ok)reject(r.status===401||r.status===403?'DRIVE_GOOGLE_AUTH_REJECTED':'DRIVE_GOOGLE_TOKEN_FAILED',502);
 const data=await jsonRead(r,16384);
 if(typeof data.access_token!=='string'||!/^[\x21-\x7e]{1,4096}$/.test(data.access_token)||data.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(data.expires_in)||data.expires_in<=0)reject('DRIVE_GOOGLE_TOKEN_INVALID',502);
 return data.access_token;
}
async function googleGet(url,{fetchImpl,signal,token}){
 const r=await fetchImpl(url,{method:'GET',headers:{authorization:'Bearer '+token,accept:'application/json','cache-control':'no-cache'},redirect:'manual',signal});
 if(!r.ok)reject(r.status===403||r.status===404?'DRIVE_FILE_NOT_READABLE':r.status===429?'DRIVE_GOOGLE_RATE_LIMITED':'DRIVE_GOOGLE_READ_FAILED',r.status===429?429:502);
 return r;
}
async function metadata(source,ctx){
 const url=DRIVE+encodeURIComponent(source.fileId)+'?fields=id,mimeType,version,modifiedTime,size,trashed&supportsAllDrives=true';
 const m=await jsonRead(await googleGet(url,ctx),16384);
 if(m.id!==source.fileId||m.trashed===true||typeof m.version!=='string'||!/^\d{1,30}$/.test(m.version)||typeof m.modifiedTime!=='string'||!Number.isFinite(Date.parse(m.modifiedTime)))reject('DRIVE_FILE_METADATA_INVALID',502);
 if(source.kind==='sheets_feed'?m.mimeType!=='application/vnd.google-apps.spreadsheet':!['application/json','text/plain'].includes(m.mimeType))reject('DRIVE_SOURCE_TYPE_MISMATCH',422);
 if(source.kind==='drive_json'&&Number(m.size)>MAX_BYTES)reject('DRIVE_PAYLOAD_TOO_LARGE',502);
 return m;
}
function itemIdentity(item){
 const i=item?.format===SOURCE_FORMAT?item.input:null,r=item?.race;
 return i?{organization:i.organization,raceId:i.raceId}:r?{organization:r.raceType||(r.category==='中央競馬'?'JRA':r.category==='地方競馬'?'NAR':null),raceId:`${r.raceDate}|${r.track}|${r.raceNo}`}:{organization:null,raceId:null};
}
function unpackJson(data){
 const rows=data?.format===BUNDLE_FORMAT?data.sources:[data];
 if(!Array.isArray(rows)||rows.length<1||rows.length>24||rows.some(x=>![SOURCE_FORMAT,'CHASS_CPSI_PRE_INPUT_V1'].includes(x?.format)))reject('DRIVE_SOURCE_FORMAT_REQUIRED',422);
 return rows;
}
export function unpackSheetFeed(data){
 if(data?.majorDimension!=='ROWS'||!Array.isArray(data.values)||data.values.length<1||data.values.length>25||JSON.stringify(data.values[0])!==JSON.stringify(['organization','raceId','sourceJson']))reject('DRIVE_SOURCE_FEED_REQUIRED',422);
 const out=[];
 for(const row of data.values.slice(1)){
  if(row.every(x=>x==null||x===''))continue;
  if(row.length!==3||!['JRA','NAR'].includes(row[0])||typeof row[1]!=='string'||typeof row[2]!=='string'||row[2].length>50000)reject('DRIVE_SOURCE_FEED_INVALID',422);
  let item;try{item=JSON.parse(row[2]);}catch{reject('DRIVE_SOURCE_FEED_INVALID',422);}
  if(![SOURCE_FORMAT,'CHASS_CPSI_PRE_INPUT_V1'].includes(item?.format))reject('DRIVE_SOURCE_FORMAT_REQUIRED',422);
  const id=itemIdentity(item);if(id.organization!==row[0]||id.raceId!==row[1])reject('DRIVE_SOURCE_FEED_IDENTITY_MISMATCH',422);
  out.push(item);
 }
 return out;
}
async function readSource(source,selection,ctx){
 const before=await metadata(source,ctx);let items;
 if(source.kind==='drive_json')items=unpackJson(await jsonRead(await googleGet(DRIVE+encodeURIComponent(source.fileId)+'?alt=media&supportsAllDrives=true',ctx),MAX_BYTES));
 else{
  const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(source.fileId)+'/values/'+encodeURIComponent(source.range)+'?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE';
  items=unpackSheetFeed(await jsonRead(await googleGet(url,ctx),MAX_BYTES));
 }
 const after=await metadata(source,ctx);
 if(before.version!==after.version||before.modifiedTime!==after.modifiedTime)reject('DRIVE_SOURCE_CHANGED_DURING_READ',409);
 const artifacts=[];
 for(const item of items){
  const id=itemIdentity(item);if(id.organization!==selection.organization||id.raceId!==selection.raceId)continue;
  const ref=`drive:${source.fileId}@${before.version}`;
  let a;
  try{
   if(item.format===SOURCE_FORMAT){await verifySourceArtifact(item,{now:ctx.clock()});a=await createSourceArtifact(sourceRootFromInput(item.input),{sourceRef:ref,now:ctx.clock()});}
   else a=await createSourceArtifact(item,{sourceRef:ref,now:ctx.clock()});
  }catch{reject('DRIVE_SOURCE_PRE_EVIDENCE_INVALID',422);}
  if(['runId','inputSnapshotId','indexSnapshotId'].some(k=>selection[k]!=null&&a.input[k]!==selection[k]))continue;
  artifacts.push(a);
 }
 return artifacts;
}
export async function handleCpsiDriveRequest(request,env={},options={}){
 const url=new URL(request.url);if(url.pathname!==CPSI_DRIVE_PATH)return null;
 if(request.method!=='GET')return response({ok:false,code:'DRIVE_METHOD_NOT_ALLOWED'},405);
 if(env.ENABLE_CPSI_DRIVE_READ!=='true')return response({ok:false,code:'DRIVE_NOT_CONFIGURED'},503);
 const controller=new AbortController(),abort=()=>controller.abort();
 request.signal.addEventListener('abort',abort,{once:true});if(request.signal.aborted)abort();
 const timer=setTimeout(abort,Math.min(15000,options.timeoutMs??15000));
 try{
  const origin=request.headers.get('origin');if(origin&&origin!==url.origin||request.headers.get('sec-fetch-site')==='cross-site')reject('DRIVE_ORIGIN_FORBIDDEN',403);
  if(!await bearerValid(request.headers.get('authorization'),env.CHASS_CPSI_DRIVE_READER_TOKEN))reject('DRIVE_READER_UNAUTHORIZED',401);
  const selection=parseDriveSelection(url),sources=parseDriveSources(env.CHASS_CPSI_DRIVE_SOURCES_JSON).filter(s=>s.organization===selection.organization);
  if(!sources.length)reject('DRIVE_SOURCE_NOT_FOUND',404);
  const clock=typeof options.now==='function'?options.now:()=>options.now??Date.now();
  const ctx={fetchImpl:options.fetchImpl||fetch,signal:controller.signal,now:clock(),clock};
  ctx.token=await serviceAccessToken(env.CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON,ctx);
  const all=[];
  // Bounded registry only; never accept a client-supplied file id, URL, tab or range.
  for(const source of sources)all.push(...await readSource(source,selection,ctx));
  const artifacts=[...new Map(all.map(a=>[a.contentHash,a])).values()];
  if(!artifacts.length)reject('DRIVE_SOURCE_NOT_FOUND',404);
  if(artifacts.length>24)reject('DRIVE_SOURCE_COUNT_EXCEEDED',422);
  if(new Set(artifacts.map(a=>sourceContextKey(a.input))).size!==1)reject('DRIVE_SOURCE_RUN_AMBIGUOUS',409);
  artifacts.sort((a,b)=>a.contentHash.localeCompare(b.contentHash));
  let merged;try{merged=await recoverCpsiSources(sourceRootFromInput(artifacts[0].input),artifacts,{now:clock()});}catch{reject('DRIVE_SOURCE_PRE_EVIDENCE_INVALID',422);}
  if(merged.status==='SOURCE_CONFLICT')reject('DRIVE_SOURCE_CONFLICT',409);
  if(controller.signal.aborted)reject('DRIVE_REQUEST_ABORTED',504);
  const payload={ok:true,status:'DRIVE_SOURCE_READY',organization:selection.organization,raceId:selection.raceId,
   format:BUNDLE_FORMAT,sources:artifacts,transportAuthenticated:true,sourceOriginAuthenticated:false,
   formalKpiEligible:false,originalEarlyMutation:false};
  if(new TextEncoder().encode(JSON.stringify(payload)).length>MAX_BYTES)reject('DRIVE_PAYLOAD_TOO_LARGE',502);
  return response(payload);
 }catch(e){
  const code=controller.signal.aborted?'DRIVE_REQUEST_ABORTED':e?.[INTERNAL]?e.code:'DRIVE_TRANSPORT_FAILED';
  return response({ok:false,code,sourceOriginAuthenticated:false},controller.signal.aborted?504:e?.[INTERNAL]?e.status:502);
 }finally{clearTimeout(timer);request.signal.removeEventListener('abort',abort);}
}
