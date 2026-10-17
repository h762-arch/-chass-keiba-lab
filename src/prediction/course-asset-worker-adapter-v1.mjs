// Worker-only adapter. No public HTTP route and no D1 writes. Requires deployed ASSETS binding.
import {evaluateWebCourseShadowFromSnapshot} from './course-asset-web-adapter-v1.mjs';
import {shadowHold} from './course-shadow-preflight-v1.mjs';
export async function evaluateWorkerCourseShadowFromSnapshot(snapshot,{env,requestUrl,cryptoImpl=globalThis.crypto}={}){
 if(typeof env?.ASSETS?.fetch!=='function')return shadowHold('COURSE_WORKER_ASSETS_BINDING_MISSING');
 let origin;
 try{origin=new URL(requestUrl).origin;}catch{return shadowHold('COURSE_WORKER_ORIGIN_MISSING');}
 // Worker calls binding instead of external/public fetch. The bind target is the same deployment's static-asset snapshot.
 return evaluateWebCourseShadowFromSnapshot(snapshot,{origin,cryptoImpl,enforceUrl:false,
  fetchImpl:(url,init)=>env.ASSETS.fetch(new Request(url,init))});
}
