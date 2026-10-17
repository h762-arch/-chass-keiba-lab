import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {buildEarlyPrefreezeAvailabilityInput as build,assessEarlySnapshotBeforeSave as beforeSave} from '../src/prediction/early-prefreeze-snapshot-mapping-v1.mjs';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {captureNarEarlyResearch} from '../src/research/nar-early-capture.mjs';

const acquired='2026-10-17T00:00:00Z',generated='2026-10-17T00:10:00Z',freezeAt='2026-10-17T00:20:00Z';
function fixture(){
 const raceId='20261017-NAR-21-01',race={raceDate:'2026-10-17',track:'川崎',raceNo:1,postTime:'15:00'};
 const horses=[1,2,3,4,5,6].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`,canonicalId:`id-${horseNo}`,identitySource:'registry-declaration',identityVerified:true,capturedAt:acquired,sourceRef:'source-declaration',evidenceId:`e-${horseNo}`,evidenceSource:'store-declaration',evidenceSavedAt:generated,evidenceReadback:true}));
 return {raceId,organization:'NAR',dataCalculatedAt:generated,layers:{
  SOURCE:{raceId,race,horses,acquiredAt:acquired},
  DATA:{raceId,race:structuredClone(race),horses:structuredClone(horses),cpsi:{status:'NOT_APPLICABLE'}},
  MARKET:{acquiredAt:generated},
  FINAL:{createdAt:generated,ranking:horses.map((h,i)=>({horseNo:h.horseNo,rank:i+1}))},RESULT:null}};
}
function context(){return {freezeAt,expectedRunnerCount:6,persistenceDeclarations:{snapshot:{id:'snapshot',hash:'a'.repeat(64),savedAt:generated,readback:true},early:{freezeId:'early',signalHash:'b'.repeat(64),freezeAt,immutable:true,readback:true},readback:{snapshot:true,evidence:true,early:true}}};}
const map=(s=fixture(),c=context())=>build(JSON.stringify(s),JSON.stringify(c));
const isHold=r=>{assert.equal(r.availability.predictionReadiness,'PREDICTION_HOLD');assert.equal(r.availability.predictionCanFreeze,false);};
function receipt(s){return {scope:'ALL_RUNNERS',raceId:s.raceId,horseNos:s.layers.SOURCE.horses.map(h=>h.horseNo),capturedAt:acquired,sourceRef:'bulk-source-declaration'};}

test('FULL is possible only for complete caller declarations and carries no formal authority',()=>{
 const r=map();assert.equal(r.status,'MAPPED');assert.equal(r.availability.predictionReadiness,'FINAL5_READY_FULL');
 assert.equal(r.availability.freezeExecutionAuthorized,false);assert.equal(r.availability.earlyFreezeVerified,false);
 assert.equal(r.availability.formalKpiEligible,false);assert.equal(r.availability.probabilityDecision,'MODEL_HOLD');assert.equal(r.availability.productionActivationDecision,'NO-GO');
});
test('missing persistence and cross-race IDs degrades without replacing the original prediction',()=>{
 const s=fixture(),c=context();delete c.persistenceDeclarations;
 for(const h of s.layers.SOURCE.horses)delete h.canonicalId;
 const original=structuredClone(s),r=map(s,c);assert.equal(r.availability.predictionReadiness,'FINAL5_READY_DEGRADED');assert.equal(r.availability.predictionCanFreeze,true);assert.deepEqual(s,original);
});
test('actual precomputed snapshot constructor output maps without rewriting any layer',async()=>{
 const f=fixture(),s=await createPrecomputedSnapshot({raceId:f.raceId,organization:'NAR',source:f.layers.SOURCE,data:f.layers.DATA,market:f.layers.MARKET,final:f.layers.FINAL,now:generated});
 const original=JSON.stringify(s),r=map(s);assert.equal(r.status,'MAPPED');assert.equal(r.availability.predictionReadiness,'FINAL5_READY_FULL');assert.equal(JSON.stringify(s),original);
});
for(const [name,change] of [
 ['missing cutoff',(s,c)=>delete c.freezeAt],
 ['impossible cutoff',(s,c)=>c.freezeAt='2026-02-30T00:20:00Z'],
 ['missing expected coverage',(s,c)=>delete c.expectedRunnerCount],
 ['coverage mismatch',(s,c)=>c.expectedRunnerCount=7],
 ['post-cutoff source',s=>s.layers.SOURCE.horses[0].capturedAt='2026-10-17T00:21:00Z'],
 ['missing source time',s=>delete s.layers.SOURCE.horses[0].capturedAt],
 ['missing source reference',s=>delete s.layers.SOURCE.horses[0].sourceRef],
 ['post-cutoff prediction',s=>s.dataCalculatedAt='2026-10-17T00:21:00Z'],
 ['source after prediction',s=>s.dataCalculatedAt='2026-10-16T23:59:00Z'],
 ['post-cutoff market',s=>s.layers.MARKET.acquiredAt='2026-10-17T00:21:00Z'],
 ['post-cutoff Final5',s=>s.layers.FINAL.createdAt='2026-10-17T00:21:00Z'],
 ['missing final timestamp',s=>delete s.layers.FINAL.createdAt],
 ['top3 is insufficient',s=>{s.layers.FINAL.top3=s.layers.FINAL.ranking.slice(0,3);delete s.layers.FINAL.ranking;}],
 ['reordered ranking',s=>s.layers.FINAL.ranking.reverse()],
 ['duplicate Final5',s=>s.layers.FINAL.final5=[1,2,3,4,4]],
 ['contradictory explicit Final5',s=>s.layers.FINAL.final5=[6,5,4,3,2]],
 ['wrong layer race',s=>s.layers.FINAL.raceId='other'],
 ['wrong layer race metadata',s=>s.layers.DATA.race.track='大井'],
 ['wrong layer post time',s=>s.layers.DATA.race.postTime='16:00'],
 ['known result acquisition time',s=>s.resultAcquiredAt='2026-10-17T06:05:00Z'],
 ['SOURCE DATA roster loss',s=>s.layers.DATA.horses.pop()],
 ['SOURCE DATA names conflict',s=>s.layers.DATA.horses[0].horseName='別馬'],
 ['historical',s=>s.layers.DATA.historicalResearch=true]
])test(`${name} holds without a clock or coverage fallback`,()=>{const s=fixture(),c=context();change(s,c);isHold(map(s,c));});

test('explicit common receipt applies only to its exact all-runner source acquisition',()=>{
 const s=fixture(),c=context();for(const h of s.layers.SOURCE.horses){delete h.capturedAt;delete h.sourceRef;}
 c.sourceReceipt=receipt(s);const r=map(s,c);assert.equal(r.availability.predictionReadiness,'FINAL5_READY_FULL');
 assert.ok(r.input.runners.every(h=>h.capturedAt===acquired&&h.sourceRef==='bulk-source-declaration'));
});
for(const [name,change] of [
 ['wrong race',r=>r.raceId='other'],['incomplete roster',r=>r.horseNos.pop()],
 ['duplicate roster',r=>r.horseNos[0]=2],['unverified scope',r=>r.scope='UNKNOWN'],
 ['wrong source time',r=>r.capturedAt=generated],['no reference',r=>delete r.sourceRef]
])test(`common receipt ${name} cannot populate source evidence`,()=>{
 const s=fixture(),c=context();c.sourceReceipt=receipt(s);change(c.sourceReceipt);isHold(map(s,c));
});
test('invalid per-horse timestamps never fall back to the common receipt',()=>{const s=fixture(),c=context();c.sourceReceipt=receipt(s);s.layers.SOURCE.horses[0].capturedAt='invalid';isHold(map(s,c));});
for(const place of ['ROOT','SOURCE','DATA','MARKET','FINAL','RESULT'])test(`RESULT payload at ${place} is excluded and its presence holds`,()=>{
 const s=fixture(),secret={finishOrder:[6,5,4],actualTime:'RESULT_ONLY_SENTINEL'};
 if(place==='ROOT')s.resultSnapshot=secret;else if(place==='RESULT')s.layers.RESULT=secret;else s.layers[place].resultSnapshot=secret;
 const r=map(s);isHold(r);assert.equal(r.input.resultPresent,true);assert.ok(!JSON.stringify(r.input).includes('RESULT_ONLY_SENTINEL'));assert.equal(r.input.RESULT,undefined);assert.equal(r.input.resultSnapshot,undefined);
});
test('future cutoff cannot be used at the runtime boundary',()=>{const s=fixture(),c=context();isHold(beforeSave(JSON.stringify(s),JSON.stringify(c),Date.parse(generated)));});
test('raw JSON API never invokes getters or toJSON',()=>{let calls=0;const x={get layers(){calls++;throw Error();},toJSON(){calls++;throw Error();}};isHold(build(x,JSON.stringify(context())));assert.equal(calls,0);});
test('invalid JSON, arrays and oversize context fail closed',()=>{for(const raw of ['{','[]','null',' '.repeat(1_000_001)])isHold(build(JSON.stringify(fixture()),raw));});

// Existing app acquisition + makeSnapshot + capture/save, with a synthetic API
// payload and isolated memory store. This is not a live official race test.
const now='2026-10-17T01:00:00.000Z',appRaceId='2026-10-17|川崎|1';
function runtime(){
 class FixedDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return Date.parse(now);}}
 const window={__CHASS_TEST__:true},writes=[],requests=[];
 const document={getElementById(){return null;},querySelector(){return null;},querySelectorAll(){return [];}};
 const payload={ok:true,raceSuccess:true,organization:'NAR',source:'NAR公式',code:'21',date:'2026-10-17',track:'川崎',race:1,postTime:'15:00',distance:1200,surface:'ダート',trackCondition:'良',acquiredAt:now,horses:[1,2,3,4,5,6].map(horseNo=>({horseNo,horseName:`合成馬${horseNo}`,abilityWinRate:20+horseNo*5,abilityScore:60+horseNo,dataConfidence:80,predictedTime:'1:16.0',predictedTimeType:'実績',features:{evidence:{runs:3}}})),odds:[]};
 const sandbox={window,document,localStorage:{getItem(){return null;},setItem(){writes.push('local');assert.fail('no UI storage writes');}},fetch:async(url)=>{requests.push(url);return {ok:true,status:200,json:async()=>structuredClone(payload)};},console,setTimeout,clearTimeout,setInterval,clearInterval,Date:FixedDate,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
 vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),sandbox);
 const data=new Map(),store={async get(k){return data.get(k)??null;},async insertIfAbsent(k,v){if(data.has(k))return false;data.set(k,v);return true;}};
 const core=window.CHASS_TEST,sentinel={race:{track:'表示中'},horses:[]};core.setState(sentinel);
 const args={enabled:true,store,raceId:appRaceId,clock:()=>Date.parse(now),acquire:a=>core.acquireNarEarlyResearchRecord({...a,enabled:true}),availabilityJson:JSON.stringify({freezeAt:now,expectedRunnerCount:6})};
 return {args,core,sentinel,data,writes,requests};
}
test('real app record -> opt-in gate -> existing research freeze/save succeeds as DEGRADED',async()=>{
 const f=runtime(),r=await captureNarEarlyResearch(f.args);assert.equal(r.status,'CREATED');assert.equal(r.availability.format,'APP_RECORD');assert.equal(r.availability.availability.predictionReadiness,'FINAL5_READY_DEGRADED');assert.equal(r.snapshot.formalKpiEligible,false);assert.equal(f.data.size,1);assert.equal(f.requests.length,1);assert.deepEqual(f.writes,[]);assert.equal(f.core.getState(),f.sentinel);
 assert.equal(r.availability.input.runners[0].capturedAt,now);assert.equal(r.availability.input.runners[0].sourceRef,'/api/nar/race?code=21&date=2026-10-17&race=1');assert.equal(r.availability.input.final5.length,5);
 const original=r.snapshot.contentSha256,preserved=await captureNarEarlyResearch({...f.args,availabilityJson:'invalid'});assert.equal(preserved.status,'PRESERVED');assert.equal(preserved.snapshot.contentSha256,original);assert.equal(f.requests.length,1);
});
test('runtime HOLD occurs before insertion and preserves UI state',async()=>{const f=runtime();f.args.availabilityJson=JSON.stringify({freezeAt:'2026-10-17T01:01:00Z',expectedRunnerCount:6});const r=await captureNarEarlyResearch(f.args);assert.equal(r.reason,'AVAILABILITY_HOLD');isHold(r.availability);assert.equal(f.data.size,0);assert.equal(f.core.getState(),f.sentinel);});
test('caller cannot replace the runtime acquisition receipt',async()=>{const f=runtime();f.args.availabilityJson=JSON.stringify({freezeAt:now,expectedRunnerCount:6,sourceReceipt:{}});assert.equal((await captureNarEarlyResearch(f.args)).reason,'AVAILABILITY_RECEIPT_OVERRIDE_FORBIDDEN');assert.equal(f.data.size,0);});
test('malformed opt-in context prevents any insert',async()=>{const f=runtime();f.args.availabilityJson='[]';assert.equal((await captureNarEarlyResearch(f.args)).reason,'AVAILABILITY_CONTEXT_INVALID');assert.equal(f.data.size,0);});
test('runtime does not launder a result-bearing acquired record by dropping RESULT',async()=>{const f=runtime(),acquire=f.args.acquire;f.args.acquire=async a=>{const receipt=await acquire(a);receipt.record.resultSnapshot={finishOrder:[6,5,4],privateResult:'DO_NOT_FORWARD'};return receipt;};const r=await captureNarEarlyResearch(f.args);assert.equal(r.reason,'AVAILABILITY_HOLD');assert.equal(f.data.size,0);assert.ok(!JSON.stringify(r.availability.input).includes('DO_NOT_FORWARD'));});
test('runtime DEGRADED never bypasses existing seal checks at the save boundary',async()=>{const f=runtime(),acquire=f.args.acquire;f.args.acquire=async a=>{const receipt=await acquire(a);receipt.record.predictionSnapshot.horses[0].overall=999;return receipt;};const r=await captureNarEarlyResearch(f.args);assert.equal(r.availability.availability.predictionReadiness,'FINAL5_READY_DEGRADED');assert.equal(r.reason,'SOURCE_SNAPSHOT_MISMATCH');assert.equal(f.data.size,0);});
