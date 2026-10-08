import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {runNarInitialShadowSession} from './nar-initial-shadow-session.mjs';

export const NAR_SHADOW_WORKER_ORIGIN='https://chass-keiba-lab7.h7625421.workers.dev';

// Node-only local research harness. Never imported by app/Worker entry points.
// A fresh VM stops app bootstrap through the existing test/research API branch.
export async function createNarShadowAppAcquire({fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(typeof fetchImpl!=='function'||typeof clock!=='function')throw Error('APP_SHADOW_SOURCE_CONTRACT_INVALID');
 class ResearchDate extends Date{constructor(...args){super(...(args.length?args:[clock()]))}static now(){return clock()}}
 const window={__CHASS_TEST__:true};
 const context={window,document:{getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}},localStorage:{getItem(){return null},setItem(){throw Error('APP_SHADOW_LOCAL_WRITE_FORBIDDEN')},removeItem(){throw Error('APP_SHADOW_LOCAL_WRITE_FORBIDDEN')}},fetch(url,options){
  const request=new URL(url,NAR_SHADOW_WORKER_ORIGIN);
  if(request.origin!==NAR_SHADOW_WORKER_ORIGIN||request.pathname!=='/api/nar/race'||options?.method&&options.method!=='GET')throw Error('APP_SHADOW_FETCH_PATH_FORBIDDEN');
  return fetchImpl(request.href,options);
 },console,setTimeout,clearTimeout,setInterval,clearInterval,Date:ResearchDate,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
 vm.createContext(context);
 vm.runInContext(await readFile(new URL('../../app.js',import.meta.url),'utf8'),context,{filename:'app.js'});
 if(typeof window.CHASS_TEST?.acquireNarEarlyResearchRecord!=='function')throw Error('APP_SHADOW_ACQUIRE_UNAVAILABLE');
 // Return a callable only; active app state, DOM and local persistence are not shared.
 return ({raceId}={})=>window.CHASS_TEST.acquireNarEarlyResearchRecord({raceId,enabled:true});
}

export async function runNarAppInitialShadowResearch({enabled=false,db,receiptStore,raceId,clock=Date.now,fetchImpl=globalThis.fetch}={}){
 // Lazily load/evaluate the app only when the existing session requests new data.
 // OFF, preserved content and failed store reads perform no app fetch/evaluation.
 const acquire=async({raceId})=>{
  const source=await createNarShadowAppAcquire({fetchImpl,clock});
  return source({raceId});
 };
 return runNarInitialShadowSession({enabled,db,receiptStore,raceId,clock,acquire});
}
