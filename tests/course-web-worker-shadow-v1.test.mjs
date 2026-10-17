import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {loadBrowserCourseAssets,evaluateWebCourseShadowFromSnapshot,shadowThenGenerate,PINNED_MANIFEST_SHA256,sha256Web} from '../src/prediction/course-asset-web-adapter-v1.mjs';
import {evaluateWorkerCourseShadowFromSnapshot} from '../src/prediction/course-asset-worker-adapter-v1.mjs';
import {resolveCourseContextCore,summarizeCourseCoverage} from '../src/prediction/course-asset-core-v1.mjs';
import {resolveCourseContextFromAssets,loadCourseAssets} from '../src/research/course-asset-runtime-v1.mjs';
const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const ORIGIN='https://chass.test';
const good=(race={},organization='JRA')=>({organization,raceId:'20261017_東京_11',race:{track:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A',...race}});
let reads=0;
async function fakeFetch(url,init={}){
 reads++;
 assert.equal(new URL(url).origin,ORIGIN);
 assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');
 const name=new URL(url).pathname.split('/').pop();
 const body=await readFile(join(root,'assets/chass/course',name));
 const response=new Response(body,{status:200,headers:{'content-type':name.endsWith('json')?'application/json':'text/csv'}});Object.defineProperty(response,'url',{value:String(url)});return response;
}
const opts={origin:ORIGIN,cryptoImpl:webcrypto,fetchImpl:fakeFetch};

test('PRE coverage excludes validation, Forward, production status and free text',()=>{
 const before=[
  {Metric:'NAR_COURSE_GEOMETRY_ROWS_FINAL',Value:'20',Notes:'RESULT_SECRET',Status:'VALIDATION_SECRET',Gate:'FORWARD_SECRET',AsOf:'LATER_SECRET'},
  ...['PROFILE_JOIN_RESOLVED','PROFILE_UNRESOLVED','BIAS_ERROR_CELLS','PRODUCTION_STATUS_ROWS',
   'MARKET_ADJUSTMENT_HOLD_ROWS','NAR_FRAME_BIAS_PRODUCTION_READY_FINAL',
   'RETROFIT_FORWARD_CONTAMINATION','PHASE5_PRODUCTION_CHANGES','PHASE6_PRODUCTION_CHANGES',
   'PHASE7_PRODUCTION_CHANGES','UNKNOWN_METRIC'].map(Metric=>({Metric,Value:'999',Notes:'RESULT_SECRET'}))
 ];
 const original=structuredClone(before);
 assert.deepEqual(summarizeCourseCoverage(before),{NAR_COURSE_GEOMETRY_ROWS_FINAL:{value:20}});
 assert.deepEqual(before,original);
});
test('PRE coverage rejects invalid counts instead of forwarding raw strings',()=>{
 for(const Value of ['#REF!','UNKNOWN','',null,undefined,'-1','1.5','Infinity','9007199254740992']){
  assert.deepEqual(summarizeCourseCoverage([{Metric:'NAR_COURSE_GEOMETRY_ROWS_FINAL',Value}]),{},String(Value));
 }
 assert.deepEqual(summarizeCourseCoverage([{Metric:'NAR_GEOMETRY_ORPHANS_FINAL',Value:'0'}]),{NAR_GEOMETRY_ORPHANS_FINAL:{value:0}});
});
test('Web and Worker PRE coverage expose exactly the seven static numeric counts',async()=>{
 const expected=(await loadCourseAssets()).coverageSummary;
 assert.equal(Object.keys(expected).length,7);
 const workerOptions={env:{ASSETS:{fetch:request=>fakeFetch(request.url,{redirect:'error',cache:'no-store'})}},requestUrl:ORIGIN+'/api/prediction',cryptoImpl:webcrypto};
 const outputs=[await evaluateWebCourseShadowFromSnapshot(good(),opts),await evaluateWorkerCourseShadowFromSnapshot(good(),workerOptions)];
 for(const output of outputs){
  assert.equal(output.branchStatus,'PASS');
  const summary=output.courseContext.historicalSupport.summary;
  assert.deepEqual(summary,expected);
  for(const count of Object.values(summary)){
   assert.deepEqual(Object.keys(count),['value']);
   assert.ok(Number.isSafeInteger(count.value)&&count.value>=0);
  }
 }
});

test('pinned manifest checksum is independent from downloaded manifest',async()=>{
 const b=await readFile(join(root,'assets/chass/course/course-asset-manifest-v1.json'));
 assert.equal(await sha256Web(b,webcrypto),PINNED_MANIFEST_SHA256);
});
test('WebCrypto verifies full static dataset, unique identity and exact Tokyo course',async()=>{
 const assets=await loadBrowserCourseAssets(opts);
 assert.ok(assets.geometry.length>=40);assert.ok(assets.profiles.length>=240);assert.ok(Object.isFrozen(assets));
 const result=resolveCourseContextCore(assets,{organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
 assert.equal(result.status,'READY');assert.equal(result.distanceProfile.firstTurnDistanceM,540);
 assert.equal(result.paceHandoff.frontPressureGeometryCue,'DOES_NOT_IMPLY_SLOW');
});
test('Web shadow has correct EARLY-only authority and does not invent probability',async()=>{
 const r=await evaluateWebCourseShadowFromSnapshot(good(),opts);
 assert.equal(r.branchStatus,'PASS');assert.equal(r.courseProfileId,'JRA_TOK_T_STD_A_1600_PROFILE_V1');
 assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
 assert.equal(r.sourceOriginAuthenticated,true);assert.equal(r.paceHandoff.frontPressureGeometryCue,'DOES_NOT_IMPLY_SLOW');
 assert.equal(r.originalEarlyMutation,false);
});
test('missing rail variant is HOLD without loading assets or guessing A',async()=>{
 reads=0;const r=await evaluateWebCourseShadowFromSnapshot(good({railVariant:undefined}),opts);
 assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes('COURSE_RAIL_VARIANT_REQUIRED'));assert.equal(reads,0);
});
test('another explicit rail without Authority profile remains HOLD',async()=>{
 const r=await evaluateWebCourseShadowFromSnapshot(good({railVariant:'B'}),opts);
 assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes('COURSE_RAIL_VARIANT_UNRESOLVED'));
});
test('newport layout ambiguous is HOLD, explicit Niigata route stays distinct',async()=>{
 const assets=await loadBrowserCourseAssets(opts);
 assert.equal(resolveCourseContextCore(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400,railVariant:'A'}).status,'HOLD');
 assert.equal(resolveCourseContextCore(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400,layout:'内回り',railVariant:'A'}).identity.layout,'内回り');
});
test('NAR start unresolved terminal, banei specialist separated',async()=>{
 const a=await loadBrowserCourseAssets(opts);
 const son=resolveCourseContextCore(a,{organizer:'NAR',venue:'園田',surface:'ダ',distance:1400,layout:'標準',railVariant:'NA'});
 assert.equal(son.status,'DEGRADED_TERMINAL');
 const ban=resolveCourseContextCore(a,{organizer:'NAR',venue:'帯広',surface:'ばんえい',distance:200,layout:'直線',railVariant:'NA'});
 assert.equal(ban.status,'SPECIALIST_CONTEXT');assert.equal(ban.genericFlatPaceEligible,false);
});
test('CSV alteration is fail-closed',async()=>{
 const fetchImpl=async(url,init)=>{
  const r=await fakeFetch(url,init);
  if(new URL(url).pathname.endsWith('course-geometry-v1.csv')){const z=new Response((await r.text())+'\nINJECTED',{status:200,headers:{'content-type':'text/csv'}});Object.defineProperty(z,'url',{value:String(url)});return z;}
  return r;
 };
 const r=await evaluateWebCourseShadowFromSnapshot(good(),{...opts,fetchImpl});
 assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes('COURSE_ASSET_CHECKSUM_MISMATCH'));
});
test('manifest alteration is fail-closed even if rows would be internally consistent',async()=>{
 const fetchImpl=async(url,init)=>{
  const r=await fakeFetch(url,init);
  if(new URL(url).pathname.endsWith('.json')){const z=new Response((await r.text()).replace('STATIC_SNAPSHOT_SHADOW','STATIC_SNAPSHOT_SHADOW_CHANGED'),{status:200,headers:{'content-type':'application/json'}});Object.defineProperty(z,'url',{value:String(url)});return z;}
  return r;
 };
 const r=await evaluateWebCourseShadowFromSnapshot(good(),{...opts,fetchImpl});
 assert.ok(r.reasons.includes('COURSE_ASSET_MANIFEST_CHECKSUM_MISMATCH'));
});
test('cross-origin response url is rejected',async()=>{
 const fetchImpl=async(url,init)=>{const response=await fakeFetch(url,init);return {ok:true,status:200,redirected:false,type:'basic',url:'https://evil.invalid/diff',headers:response.headers,arrayBuffer:()=>response.arrayBuffer()};};
 const r=await evaluateWebCourseShadowFromSnapshot(good(),{...opts,fetchImpl});
 assert.ok(r.reasons.includes('COURSE_ASSET_RESPONSE_ORIGIN_MISMATCH'));
});
test('HTML response with HTTP 200 cannot impersonate a course CSV',async()=>{
 const fetchImpl=async(url)=>{const z=new Response('<!doctype html>',{status:200,headers:{'content-type':'text/html'}});Object.defineProperty(z,'url',{value:String(url)});return z;};
 const r=await evaluateWebCourseShadowFromSnapshot(good(),{...opts,fetchImpl});
 assert.ok(r.reasons.includes('COURSE_ASSET_CONTENT_TYPE_INVALID'));
});
test('RESULT cannot be projected into a pre-race shadow input',async()=>{
 reads=0;const r=await evaluateWebCourseShadowFromSnapshot({...good(),resultSnapshot:{finishOrder:[13,10,14]}},opts);
 assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes('RESULT_OR_HISTORICAL_INPUT_FORBIDDEN_PRE'));assert.equal(reads,0);
});
test('Worker has no implicit external fetch: missing ASSETS binding is HOLD',async()=>{
 const r=await evaluateWorkerCourseShadowFromSnapshot(good(),{env:{},requestUrl:ORIGIN+'/api/prediction',cryptoImpl:webcrypto});
 assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes('COURSE_WORKER_ASSETS_BINDING_MISSING'));
});
test('Worker with ASSETS binding reads only own deployment assets and stays Shadow',async()=>{
 const env={ASSETS:{fetch:request=>fakeFetch(request.url,{redirect:'error',cache:'no-store'})}};
 const r=await evaluateWorkerCourseShadowFromSnapshot(good(),{env,requestUrl:ORIGIN+'/api/prediction',cryptoImpl:webcrypto});
 assert.equal(r.branchStatus,'PASS');assert.equal(r.productionExecutionAuthorized,false);assert.equal(r.formalKpiEligible,false);
});
test('before-prediction test harness waits for course shadow but does not change its forecast',async()=>{
 const calls=[];const fetchImpl=async(url,init)=>{calls.push('asset');return fakeFetch(url,init);};
 const snapshot=good();const result=await shadowThenGenerate(snapshot,async input=>{calls.push('forecast');return Object.freeze({marks:['◎5','○7'],input});},{...opts,fetchImpl});
 assert.equal(result.shadow.branchStatus,'PASS');assert.equal(result.prediction.input,snapshot);assert.equal(calls.at(-1),'forecast');
 assert.equal(calls.filter(x=>x==='forecast').length,1);assert.equal(result.shadow.productionMutation,false);
});
test('Node adapter and Web adapter share EXACT Core result for sampled venues',async()=>{
 const node=await loadCourseAssets();const web=await loadBrowserCourseAssets(opts);
 for(const inp of [{organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'},
  {organizer:'NAR',venue:'園田',surface:'ダ',distance:1400,layout:'標準',railVariant:'NA'},
  {organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'B'},
  {organizer:'JRA',venue:'新潟',surface:'芝',distance:1400,layout:'内回り',railVariant:'A'}]){
   const lhs=resolveCourseContextFromAssets(node,inp),rhs=resolveCourseContextCore(web,inp);
   for(const key of ['status','usableForPre','courseProfileId','courseGeometryId','reasons','identity','geometry','distanceProfile','paceHandoff','historicalSupport','lineage'])assert.deepEqual(lhs[key],rhs[key],key);
  }
});
