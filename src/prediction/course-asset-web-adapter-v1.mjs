// Public browser adapter, with no Node imports. Same-origin, PINNED-manifest + CSV WebCrypto checks.
import {parseCourseCsv,validateCourseDataset,summarizeCourseCoverage,resolveCourseContextCore,ASSET_VERSION} from './course-asset-core-v1.mjs';
import {projectCoursePreRace,shadowHold,mapCourseShadow} from './course-shadow-preflight-v1.mjs';
export const PINNED_MANIFEST_SHA256='69443a866990b6243fc51490b71c134acb1e72dfe9bd0b7febff133727f4a5e7';
const dir='/assets/chass/course/';
const hex=x=>Array.from(new Uint8Array(x),b=>b.toString(16).padStart(2,'0')).join('');
export const sha256Web=async(bytes,cryptoImpl=globalThis.crypto)=>{
 if(!cryptoImpl?.subtle?.digest)throw Error('COURSE_WEB_CRYPTO_UNAVAILABLE');
 return hex(await cryptoImpl.subtle.digest('SHA-256',bytes));
};
function immutable(x){if(x&&typeof x==='object'&&!Object.isFrozen(x)){Object.values(x).forEach(immutable);Object.freeze(x);}return x;}
const safeUrl=(file,origin)=>new URL(dir+file,origin);
// enforceUrl=false is reserved for env.ASSETS.fetch, where the returned Response.url may be empty.
export async function loadBrowserCourseAssets({origin=globalThis.location?.origin,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,enforceUrl=true}={}){
 if(typeof origin!=='string'||!/^https?:\/\//.test(origin)||typeof fetchImpl!=='function')throw Error('COURSE_ASSET_FETCH_UNAVAILABLE');
 const host=new URL(origin);if((host.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(host.hostname))||host.pathname!=='/'||host.search||host.hash||host.username||host.password)throw Error('COURSE_ASSET_ORIGIN_INVALID');
 const fetchFile=async(file,maxBytes)=>{
  const url=safeUrl(file,host.origin);if(url.origin!==host.origin||url.pathname!==dir+file||url.search||url.hash)throw Error('COURSE_ASSET_PATH_INVALID');
  const response=await fetchImpl(url.href,{method:'GET',redirect:'error',cache:'no-store',credentials:'same-origin',headers:{accept:file.endsWith('.json')?'application/json':'text/csv'}});
  if(!response?.ok||response.status!==200||response.redirected||response.type==='opaque'||response.type==='opaqueredirect')throw Error('COURSE_ASSET_HTTP_INVALID');
  if(enforceUrl&&response.url!==url.href)throw Error('COURSE_ASSET_RESPONSE_ORIGIN_MISMATCH');
  const type=response.headers?.get?.('content-type')||'';
  if(!/^(application\/json|text\/json|text\/plain|text\/csv|application\/csv|application\/octet-stream)(;|$)/i.test(type))throw Error('COURSE_ASSET_CONTENT_TYPE_INVALID');
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>maxBytes)throw Error('COURSE_ASSET_SIZE_INVALID');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>maxBytes||!bytes.byteLength)throw Error('COURSE_ASSET_SIZE_INVALID');
  return bytes;
 };
 const manifestBytes=await fetchFile('course-asset-manifest-v1.json',20000);
 if(await sha256Web(manifestBytes,cryptoImpl)!==PINNED_MANIFEST_SHA256)throw Error('COURSE_ASSET_MANIFEST_CHECKSUM_MISMATCH');
 const decoder=new TextDecoder('utf-8',{fatal:true});const manifest=JSON.parse(decoder.decode(manifestBytes));
 // Exact three-file allowlist. Manifest cannot nominate executable scripts or outcome tables.
 const expected={geometry:'course-geometry-v1.csv',distanceProfiles:'course-distance-profile-v1.csv',coverage:'course-sample-coverage-v1.csv'};
 const loaded={};
 for(const [key,file] of Object.entries(expected)){
  const spec=manifest.assets?.[key];if(spec?.file!==file||!spec.sha256||spec.runtimeUse!==(key==='coverage'?'SHADOW_GUARD_ONLY':'STATIC_CANONICAL'))throw Error('COURSE_ASSET_PRE_ROLE_FORBIDDEN');
  const bytes=await fetchFile(file,2_000_000);
  if(await sha256Web(bytes,cryptoImpl)!==spec.sha256)throw Error('COURSE_ASSET_CHECKSUM_MISMATCH');
  loaded[key]=parseCourseCsv(decoder.decode(bytes));
 }
 validateCourseDataset(manifest,loaded);
 return immutable({version:ASSET_VERSION,manifest,geometry:loaded.geometry,profiles:loaded.distanceProfiles,coverageSummary:summarizeCourseCoverage(loaded.coverage),integrity:'PASS'});
}
// A failed asset fetch must never turn a missing railVariant into the A-course profile.
export async function evaluateWebCourseShadowFromSnapshot(snapshot,options={}){
 const projected=projectCoursePreRace(snapshot);
 if(projected.hold)return shadowHold(projected.hold,{raceId:projected.raceId??null});
 try{
  const assets=await loadBrowserCourseAssets(options);
  const course=resolveCourseContextCore(assets,projected.input);
  return mapCourseShadow({...course,sourceOriginAuthenticated:true,integrityBasis:'PINNED_MANIFEST_AND_CSV_SHA256'},projected.input.raceId,{originVerified:true});
 }catch(error){return shadowHold(error?.message?.startsWith('COURSE_')?error.message:'COURSE_ASSET_FETCH_FAILED',{raceId:projected.input.raceId});}
}
// Optional pure test harness for ordering; NOT installed into the existing prediction path.
export async function shadowThenGenerate(snapshot,generate,options={}){
 if(typeof generate!=='function')throw Error('COURSE_SHADOW_GENERATOR_REQUIRED');
 const shadow=await evaluateWebCourseShadowFromSnapshot(snapshot,options);
 return {shadow,prediction:await generate(snapshot)};
}
