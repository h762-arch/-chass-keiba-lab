import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, cp, readFile, writeFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  DEFAULT_ASSET_DIR, loadCourseAssets, resolveCourseContext,
  resolveCourseContextFromAssets, VERSION
} from '../src/research/course-asset-runtime-v1.mjs';

let assets;
test.before(async()=>{assets=await loadCourseAssets();});

test('asset snapshot loads with exact integrity and broad saved course coverage',()=>{
  assert.equal(VERSION,'CHASS_V2220_COURSE_ASSET_RUNTIME_V1');
  assert.equal(assets.integrity,'PASS');
  assert.ok(assets.geometry.length>=40);
  assert.ok(assets.profiles.length>=240);
});

test('Tokyo turf 1600 resolves saved official course profile and does not equate LONG with slow',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
  assert.equal(r.status,'READY');
  assert.equal(r.courseProfileId,'JRA_TOK_T_STD_A_1600_PROFILE_V1');
  assert.equal(r.distanceProfile.startLocation,'2コーナー付近');
  assert.equal(r.distanceProfile.firstTurnDistanceM,540);
  assert.equal(r.distanceProfile.turnCount,2);
  assert.equal(r.geometry.finishStraightM,525.9);
  assert.equal(r.paceHandoff.frontPressureGeometryCue,'DOES_NOT_IMPLY_SLOW');
  assert.equal(r.paceHandoff.leadSettlementEaseState,'DO_NOT_ASSUME_SETTLEMENT');
});

test('Sonoda dirt 1400 keeps saved identity/geometry but reason-terminals unresolved start detail',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'NAR',venue:'園田',surface:'ダ',distance:1400,layout:'標準',railVariant:'NA'});
  assert.equal(r.status,'DEGRADED_TERMINAL');
  assert.equal(r.courseProfileId,'NAR_SON_D_STD_NA_1400_PROFILE_V1');
  assert.ok(r.reasons.includes('COURSE_START_DETAIL_PENDING'));
  assert.equal(r.geometry.finishStraightM,213);
  assert.equal(r.distanceProfile.firstTurnDistanceM,null);
  assert.equal(r.usableForPre,true);
});

test('Niigata turf 1400 without route is HOLD rather than guessing inner/outer',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400});
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('COURSE_PROFILE_IDENTITY_AMBIGUOUS'));
  assert.ok(r.candidateLayouts.includes('内回り'));
  assert.ok(r.candidateLayouts.includes('外回り'));
});

test('Niigata turf 1400 resolves when route is explicit',()=>{
  const inner=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400,layout:'内回り',railVariant:'A'});
  const outer=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400,layout:'外回り',railVariant:'A'});
  assert.equal(inner.courseProfileId,'JRA_NII_T_IN_A_1400_PROFILE_V1');
  assert.equal(outer.courseProfileId,'JRA_NII_T_OUT_A_1400_PROFILE_V1');
});

test('wrong circuit is fail-closed and never reuses JRA authority in NAR',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'NAR',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('CIRCUIT_ISOLATION_MISMATCH'));
});

test('unknown course-distance is HOLD',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'東京',surface:'芝',distance:9999,layout:'標準',railVariant:'A'});
  assert.equal(r.status,'HOLD');
  assert.ok(r.reasons.includes('COURSE_PROFILE_NOT_FOUND'));
});

test('rail/layout mismatch does not silently coerce to A or another route',()=>{
  const rail=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'B'});
  assert.equal(rail.status,'HOLD');
  assert.ok(rail.reasons.includes('COURSE_RAIL_VARIANT_UNRESOLVED'));
});

test('Obihiro banei remains specialist-only and never enters generic flat pace',()=>{
  const r=resolveCourseContextFromAssets(assets,{organizer:'NAR',venue:'帯広',surface:'ばんえい',distance:200,layout:'直線',railVariant:'NA'});
  assert.equal(r.status,'SPECIALIST_CONTEXT');
  assert.equal(r.genericFlatPaceEligible,false);
  assert.equal(r.paceHandoff.frontPressureGeometryCue,'NOT_APPLICABLE_SPECIALIST');
});

test('historical/forward result-bearing assets are not bundled as PRE runtime inputs',()=>{
  assert.equal(assets.manifest.assets.historicalRaw.runtimeUse,'FORBIDDEN');
  assert.equal(assets.manifest.assets.frameAggregate.runtimeUse,'FORBIDDEN');
  assert.equal(assets.manifest.assets.biasShadow.runtimeUse,'FORBIDDEN');
  assert.equal(assets.manifest.assets.forwardJoin.runtimeUse,'FORBIDDEN');
  assert.equal(assets.manifest.assets.forwardReadiness.runtimeUse,'FORBIDDEN');
});

test('checksum tampering is detected before course resolution',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'chass-course-assets-'));
  await cp(DEFAULT_ASSET_DIR,dir,{recursive:true});
  const file=join(dir,'course-geometry-v1.csv');
  await writeFile(file,(await readFile(file,'utf8'))+'\nTAMPER','utf8');
  const r=await resolveCourseContext({organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'},{assetDir:dir});
  assert.equal(r.status,'HOLD');
  assert.equal(r.integrity,'FAIL');
  assert.ok(r.reasons.includes('COURSE_ASSET_CHECKSUM_MISMATCH'));
});

import {evaluateCourseDistanceBranch} from '../src/research/v2220-course-distance-branch-v1.mjs';

test('v2.22 Course Branch adapter emits executable Branch/Asset/Pace handoff without writes',async()=>{
  const r=await evaluateCourseDistanceBranch({raceId:'20261017_東京_11',organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
  assert.equal(r.branchKey,'COURSE_DISTANCE_BRANCH');
  assert.equal(r.branchStatus,'PASS');
  assert.equal(r.paceHandoff.courseProfileId,'JRA_TOK_T_STD_A_1600_PROFILE_V1');
  assert.equal(r.paceHandoff.frontPressureGeometryCue,'DOES_NOT_IMPLY_SLOW');
  assert.equal(r.assetResolution.find(x=>x.sourceAsset==='CHASS_COURSE_FORWARD_JOIN_V1').runtimeUse,'VALIDATION_ONLY_FORBIDDEN_PRE');
  assert.deepEqual(r.governance,{productionMutation:false,originalEarlyMutation:false,resultLeakage:false,validationOnlyLeakage:false,writeSideEffects:false});
});

const tokyo=()=>({organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
async function changedManifest(change,check){
 const dir=await mkdtemp(join(tmpdir(),'chass-course-review-'));
 try{await cp(DEFAULT_ASSET_DIR,dir,{recursive:true});const file=join(dir,'course-asset-manifest-v1.json'),m=JSON.parse(await readFile(file,'utf8'));await change(m,dir);await writeFile(file,JSON.stringify(m));await check(dir);}
 finally{await rm(dir,{recursive:true,force:true});}
}
test('review: venue name and code must agree',()=>{const r=resolveCourseContextFromAssets(assets,{...tokyo(),venue:'京都',venueCode:'TOK'});assert.equal(r.status,'HOLD');});
test('review: a venue or venue code is required',()=>{const r=resolveCourseContextFromAssets(assets,{...tokyo(),venue:''});assert.equal(r.status,'HOLD');});
test('review: turf rail is not inferred from one bundled A profile',()=>{const x=tokyo();delete x.railVariant;assert.equal(resolveCourseContextFromAssets(assets,x).status,'HOLD');});
test('review: loaded assets and every row are immutable',()=>{assert.equal(Object.isFrozen(assets),true);assert.equal(Object.isFrozen(assets.manifest.assets),true);assert.equal(Object.isFrozen(assets.profiles[0]),true);assert.throws(()=>assets.profiles[0].Distance_m='999999',TypeError);assert.equal(resolveCourseContextFromAssets(assets,tokyo()).distanceProfile.firstTurnDistanceM,540);});
test('review: cloned or forged integrity PASS cannot bypass loader',()=>{for(const a of [{integrity:'PASS'},structuredClone(assets)])assert.equal(resolveCourseContextFromAssets(a,tokyo()).status,'HOLD');});
test('review: input getters and coercion callbacks are never invoked',async()=>{let calls=0;const x={get organizer(){calls++;throw Error();}},y={...tokyo(),venue:{toString(){calls++;throw Error();}}};assert.equal(resolveCourseContextFromAssets(assets,x).status,'HOLD');assert.equal((await resolveCourseContext(y)).status,'HOLD');assert.equal(calls,0);});
test('review: malformed inputs hold rather than throwing',()=>{for(const x of [null,[],false,'東京',{...tokyo(),distance:Infinity},{...tokyo(),distance:1600.5}])assert.equal(resolveCourseContextFromAssets(assets,x).status,'HOLD');});
for(const key of ['historicalRaw','frameAggregate','biasShadow','forwardJoin','forwardReadiness'])test(`review: manifest cannot bundle ${key} into PRE`,async()=>changedManifest(m=>{m.assets[key].bundled=true;m.assets[key].runtimeUse='STATIC_CANONICAL';m.assets[key].file='course-geometry-v1.csv';},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('COURSE_ASSET_PRE_ROLE_FORBIDDEN'));}));
for(const change of [
 m=>m.policy.resultLeakageAllowed=true,
 m=>m.policy.validationOnlyLeakageAllowed=true,
 m=>m.policy.longFirstTurnImpliesSlow=true,
 m=>m.assets.geometry.file='../course-geometry-v1.csv',
 m=>m.assets.geometry.runtimeUse='VALIDATION_ONLY',
 m=>m.assets.extra={bundled:true,file:'course-geometry-v1.csv',runtimeUse:'STATIC_CANONICAL'},
 m=>m.source.tabs[0]='CHASS_COURSE_FORWARD_JOIN_V1'
])test('review: invalid manifest role/path/policy is rejected before resolution',async()=>changedManifest(change,async dir=>assert.equal((await resolveCourseContext(tokyo(),{assetDir:dir})).status,'HOLD')));
test('review: CSV duplicate headers are rejected even with matching manifest hash',async()=>changedManifest(async(m,dir)=>{const f=join(dir,m.assets.geometry.file),t=await readFile(f,'utf8'),changed=t.replace('Organizer,Venue,','Organizer,Organizer,');await writeFile(f,changed);m.assets.geometry.sha256=createHash('sha256').update(changed).digest('hex');},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('COURSE_ASSET_CSV_INVALID'));}));
test('review: Result column is forbidden even with matching manifest hash',async()=>changedManifest(async(m,dir)=>{const f=join(dir,m.assets.geometry.file),t=await readFile(f,'utf8'),changed=t.replace('GeometryTags,','ResultPayload,');await writeFile(f,changed);m.assets.geometry.sha256=createHash('sha256').update(changed).digest('hex');},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('COURSE_ASSET_PRE_COLUMN_FORBIDDEN'));}));
test('review: coverage output excludes forward metrics and all free-text notes',()=>{const r=resolveCourseContextFromAssets(assets,tokyo());assert.equal(r.historicalSupport.summary.RETROFIT_FORWARD_CONTAMINATION,undefined);assert.ok(Object.values(r.historicalSupport.summary).every(x=>Object.keys(x).join(',')==='value'));});
test('review: every resolver path has explicit shadow and formal HOLD authority',async()=>{for(const r of [resolveCourseContextFromAssets(assets,tokyo()),resolveCourseContextFromAssets(null,tokyo()),await resolveCourseContext(tokyo(),{assetDir:'/not/a/course/asset/directory'})]){assert.equal(r.sourceOriginAuthenticated,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');assert.equal(r.productionExecutionAuthorized,false);}});
for(const [id,reason] of [['20261017_京都_11','RACE_COURSE_IDENTITY_CONFLICT'],['20260230_東京_11','RACE_COURSE_IDENTITY_CONFLICT'],['opaque-race-id','RACE_COURSE_IDENTITY_CONFLICT']])test(`review: branch binds race ID ${id} to course`,async()=>{const r=await evaluateCourseDistanceBranch({raceId:id,...tokyo()});assert.equal(r.branchStatus,'HOLD');assert.ok(r.reasons.includes(reason));});
test('review: branch rejects result/historical input without emitting its contents',async()=>{for(const patch of [{resultSnapshot:{finishOrder:[1,2,3],secret:'PRIVATE_RESULT'}},{historicalResearch:true}]){const r=await evaluateCourseDistanceBranch({raceId:'20261017_東京_11',...tokyo(),...patch});assert.equal(r.branchStatus,'HOLD');assert.ok(!JSON.stringify(r).includes('PRIVATE_RESULT'));assert.equal(r.productionExecutionAuthorized,false);}});
test('review: branch getter is not invoked and missing race has full governance',async()=>{let calls=0;const r=await evaluateCourseDistanceBranch({get raceId(){calls++;throw Error();}});assert.equal(calls,0);assert.equal(r.branchStatus,'HOLD');assert.equal(r.governance.writeSideEffects,false);assert.equal(r.formalKpiReadiness,'HOLD');assert.equal(r.routerWired,false);});
test('review: specialist handoff explicitly excludes generic flat Pace',async()=>{const r=await evaluateCourseDistanceBranch({raceId:'2026-10-18|帯広|1',organizer:'NAR',venue:'帯広',surface:'ばんえい',distance:200,layout:'直線',railVariant:'NA'});assert.equal(r.branchStatus,'SPECIALIST_TERMINAL');assert.equal(r.paceHandoff.genericFlatPaceEligible,false);assert.equal(r.paceHandoff.requiresSpecialistBranch,true);});
test('review: matching checksums cannot override profile/geometry identity conflict',async()=>changedManifest(async(m,dir)=>{const f=join(dir,m.assets.distanceProfiles.file),t=await readFile(f,'utf8'),changed=t.replaceAll(',JRA,東京,TOK,',',JRA,京都,TOK,');assert.notEqual(changed,t);await writeFile(f,changed);m.assets.distanceProfiles.sha256=createHash('sha256').update(changed).digest('hex');},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('COURSE_PROFILE_GEOMETRY_IDENTITY_CONFLICT'));}));
test('review: unverified start mapping degrades instead of READY',async()=>changedManifest(async(m,dir)=>{const f=join(dir,m.assets.distanceProfiles.file),t=await readFile(f,'utf8'),changed=t.replaceAll('OFFICIAL_CONFIRMED,','UNVERIFIED_START,');assert.notEqual(changed,t);await writeFile(f,changed);m.assets.distanceProfiles.sha256=createHash('sha256').update(changed).digest('hex');},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'DEGRADED_TERMINAL');assert.ok(r.reasons.includes('COURSE_START_DETAIL_UNVERIFIED'));}));
test('review: Forward/Validation profile status is blocked despite matching checksums',async()=>changedManifest(async(m,dir)=>{const f=join(dir,m.assets.distanceProfiles.file),t=await readFile(f,'utf8'),changed=t.replaceAll('OFFICIAL_DISTANCE_GEOMETRY_CONFIRMED,','FORWARD_VALIDATION_ONLY,');assert.notEqual(changed,t);await writeFile(f,changed);m.assets.distanceProfiles.sha256=createHash('sha256').update(changed).digest('hex');},async dir=>{const r=await resolveCourseContext(tokyo(),{assetDir:dir});assert.equal(r.status,'HOLD');assert.ok(r.reasons.includes('COURSE_ASSET_PRE_ROLE_FORBIDDEN'));}));
test('review: empty coverage cannot be reported as a resolved asset',async()=>changedManifest(async(m,dir)=>{const t='Metric,Value,Status,Definition,Source,AsOf,Gate,Notes\n';await writeFile(join(dir,m.assets.coverage.file),t);m.assets.coverage.sha256=createHash('sha256').update(t).digest('hex');},async dir=>assert.equal((await resolveCourseContext(tokyo(),{assetDir:dir})).status,'HOLD')));
test('review: oversized Branch identity is bounded',async()=>{const r=await evaluateCourseDistanceBranch({...tokyo(),raceId:'x'.repeat(1000)});assert.equal(r.branchStatus,'HOLD');assert.equal(r.raceId,null);});
