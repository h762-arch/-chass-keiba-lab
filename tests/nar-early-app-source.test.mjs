import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {captureNarEarlyResearch} from '../src/research/nar-early-capture.mjs';
import {verifyNarEarlySnapshot} from '../src/research/nar-early-freeze.mjs';
const now='2026-10-07T01:00:00.000Z',raceId='2026-10-07|川崎|1',selection={date:'2026-10-07',track:'川崎',raceNo:1};
function payload(){return {ok:true,raceSuccess:true,organization:'NAR',source:'NAR公式',code:'21',date:selection.date,track:selection.track,race:1,postTime:'15:00',distance:1200,surface:'ダート',trackCondition:'良',acquiredAt:now,horses:[1,2,3].map(horseNo=>({horseNo,horseName:`テスト馬${horseNo}`,abilityWinRate:20+horseNo*5,abilityScore:60+horseNo,dataConfidence:80,predictedTime:'1:16.0',predictedTimeType:'実績',features:{evidence:{runs:3}}})),odds:[]}}
function runtime(fetcher){
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:[now]))}static now(){return Date.parse(now)}}
 const window={__CHASS_TEST__:true},document={getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}},writes=[];
 const context={window,document,localStorage:{getItem(){return null},setItem(){writes.push('local');assert.fail('no local writes')}},fetch:fetcher,console,setTimeout,clearTimeout,setInterval,clearInterval,Date:FixedDate,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);
 return {core:window.CHASS_TEST,writes,window};
}
function memory(){const data=new Map();return {data,async get(k){return data.has(k)?data.get(k):null},async insertIfAbsent(k,v){if(data.has(k))return false;data.set(k,v);return true}}}
const response=d=>({ok:true,status:200,async json(){return d}});
test('research NAR acquisition is OFF by default with no request',async()=>{let calls=0;const {core}=runtime(()=>{calls++;assert.fail()});await assert.rejects(core.acquireNarEarlyResearchRecord({raceId}));assert.equal(calls,0)});
test('actual app fetch/build/snapshot chain feeds isolated EARLY capture without UI or storage writes',async()=>{
 const input=payload(),before=structuredClone(input),requests=[];
 const {core,writes}=runtime((url,options)=>{requests.push({url,options});return response(input)}),sentinel={race:{track:'表示中'},horses:[]};core.setState(sentinel);const store=memory();
 const x=await captureNarEarlyResearch({enabled:true,store,raceId,clock:()=>Date.parse(now),acquire:arg=>core.acquireNarEarlyResearchRecord({...arg,enabled:true})});
 assert.equal(x.status,'CREATED');assert.equal(requests.length,1);assert.equal(requests[0].url,'/api/nar/race?code=21&date=2026-10-07&race=1');assert.equal(requests[0].options.cache,'no-store');
 assert.equal(core.getState(),sentinel);assert.deepEqual(writes,[]);assert.deepEqual(input,before);assert.equal(x.snapshot.data.race.narSourceAcquiredAt,now);assert.equal(x.snapshot.data.predictionSnapshot.createdAt,now);assert.equal(x.snapshot.data.predictionSnapshot.horses.length,3);assert.equal((await verifyNarEarlySnapshot(x.snapshot,{raceId})).status,'PRESERVED');assert.equal(x.snapshot.formalKpiEligible,false);
});
test('stored EARLY bypasses existing app acquisition completely',async()=>{let requests=0;const {core}=runtime(()=>{requests++;return response(payload())}),store=memory(),args={enabled:true,store,raceId,clock:()=>Date.parse(now),acquire:arg=>core.acquireNarEarlyResearchRecord({...arg,enabled:true})};const first=await captureNarEarlyResearch(args);const second=await captureNarEarlyResearch({...args,clock:()=>Date.parse(now)+12*3600_000});assert.equal(first.status,'CREATED');assert.equal(second.status,'PRESERVED');assert.equal(requests,1);assert.deepEqual(second.snapshot,first.snapshot)});
test('HTTP failure performs one attempt and never diagnostic/result fallback',async()=>{let requests=0;const {core}=runtime(()=>{requests++;return {ok:false,status:503,json:async()=>({errorCode:'nar_temporary',error:'fixture failure'})}}),store=memory();const x=await captureNarEarlyResearch({enabled:true,store,raceId,clock:()=>Date.parse(now),acquire:arg=>core.acquireNarEarlyResearchRecord({...arg,enabled:true})});assert.equal(x.reason,'CAPTURE_ACQUISITION_FAILED');assert.equal(requests,1);assert.equal(store.data.size,0)});
test('worker payload identities must match requested NAR race',()=>{const {core}=runtime(()=>assert.fail());for(const patch of [{organization:'JRA'},{track:'大井'},{code:'20'},{date:'2026-10-06'},{race:2},{source:'unknown'}])assert.throws(()=>core.buildNarEarlyResearchRecord({...payload(),...patch},selection));});
test('historical results or archived snapshots never become fresh app predictions',()=>{const {core}=runtime(()=>assert.fail()),sentinel={race:{track:'表示中'}};core.setState(sentinel);for(const patch of [{historicalResearch:true},{resultSnapshot:{}},{finishOrder:[1,2,3]},{predictionSnapshot:{}},{marketSnapshot:{}},{finalSnapshot:{}}]){assert.throws(()=>core.buildNarEarlyResearchRecord({...payload(),...patch},selection));assert.equal(core.getState(),sentinel)}});
test('unknown post time or old/future source acquisition times fail before new sealing',()=>{const {core}=runtime(()=>assert.fail());for(const patch of [{postTime:''},{postTime:'09:00'},{acquiredAt:'bad'},{acquiredAt:'2026-10-07T00:58:59Z'},{acquiredAt:'2026-10-07T01:00:01Z'}])assert.throws(()=>core.buildNarEarlyResearchRecord({...payload(),...patch},selection));});
test('snapshot construction failure always restores active state',()=>{const {core,window,writes}=runtime(()=>assert.fail()),sentinel={race:{track:'表示中'}};core.setState(sentinel);window.CHASS_LONGSHOT_SCENARIO={buildLongshotScenario(){throw Error('fixture failure')}};assert.throws(()=>core.buildNarEarlyResearchRecord(payload(),selection));assert.equal(core.getState(),sentinel);assert.deepEqual(writes,[])});
test('invalid selection is rejected without fetching',async()=>{let requests=0;const {core}=runtime(()=>{requests++;assert.fail()});for(const id of ['wrong','2026-10-07|unknown|1','2026-10-07|川崎|0'])await assert.rejects(core.acquireNarEarlyResearchRecord({raceId:id,enabled:true}));assert.equal(requests,0)});
