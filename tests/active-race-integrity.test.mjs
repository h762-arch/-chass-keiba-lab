import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
  const memory=new Map(),elements=new Map();
  const document={getElementById:id=>elements.get(id)||null,querySelector:()=>null,querySelectorAll:()=>[]};
  const window={__CHASS_TEST__:true,location:{origin:'https://example.workers.dev'}};
  const context={window,document,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,URL,parseFloat,TextEncoder,localStorage:{getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
  return {c:window.CHASS_TEST,elements};
}

const narRace={raceDate:'2026-09-06',track:'川崎',raceNo:9,raceType:'NAR',category:'地方競馬'};
const jraRace={raceDate:'2026-09-07',track:'札幌',raceNo:1,raceType:'JRA',category:'中央競馬'};
const prediction=race=>({race,locked:true});

test('NAR to JRA transition removes the old NAR prediction context',async()=>{
  const {c}=await loadCore();c.setState({race:narRace,horses:[{horseNo:1}],predictionSnapshot:prediction(narRace)});
  c.beginActiveRaceTransition('JRA',jraRace);
  assert.deepEqual(JSON.parse(JSON.stringify(c.activeRaceContext())),{organization:'JRA',raceId:'2026-09-07|札幌|1',generation:1,hasPrediction:false,hasResult:false,hasValidation:false});
  assert.equal(c.getState().horses.length,0);
});

test('race transition clears Actual TIME and validation transient state',async()=>{
  const {c}=await loadCore();c.setState({race:narRace,horses:[{horseNo:5,actualTime:'1:59.6'}],predictionSnapshot:prediction(narRace),result:{finishOrder:[5,3,8]},actualTimes:{5:'1:59.6'},resultSnapshot:{raceId:'2026-09-06|川崎|9',organization:'NAR',finishOrder:[5,3,8]}});
  c.beginActiveRaceTransition('NAR',{...narRace,raceNo:10});
  assert.equal(Object.keys(c.getState().actualTimes).length,0);assert.equal(c.getState().resultSnapshot,null);assert.equal(c.getState().resultStatus,'waiting');
});

test('a mismatched result snapshot never belongs to the active race',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,predictionSnapshot:prediction(jraRace),resultSnapshot:{raceId:'2026-09-06|川崎|9',organization:'NAR',finishOrder:[5,3,8]}});
  assert.equal(c.activeRaceContext().hasPrediction,true);assert.equal(c.activeRaceContext().hasResult,false);
});

test('a JRA form-only race has no confirmed prediction context',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,horses:[],predictionSnapshot:null});
  assert.equal(c.activeRaceContext().organization,'JRA');assert.equal(c.activeRaceContext().hasPrediction,false);
});

test('a matching JRA prediction is the only active prediction',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,predictionSnapshot:{raceId:'2026-09-07|札幌|1',organization:'JRA',race:jraRace}});
  assert.equal(c.activeRaceContext().hasPrediction,true);assert.equal(c.activeRaceContext().raceId,'2026-09-07|札幌|1');
});

test('JRA to NAR transition drops JRA validation values',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,predictionSnapshot:prediction(jraRace),resultSnapshot:{race:jraRace,finishOrder:[1,2,3]},validationSnapshot:{race:jraRace,finishOrder:[1,2,3]},actualTimes:{1:'1:34.0'}});
  c.beginActiveRaceTransition('NAR',narRace);assert.equal(c.activeRaceContext().hasValidation,false);assert.equal(Object.keys(c.getState().actualTimes).length,0);
});

test('saved result restoration requires an exact organization and race id',async()=>{
  const {c}=await loadCore(),saved={race:narRace,predictionSnapshot:prediction(narRace),resultSnapshot:{race:narRace,finishOrder:[1,2,3]},validationSnapshot:{race:narRace,finishOrder:[1,2,3]}};
  const exact=c.restoreSavedRace(saved,{organization:'NAR',raceId:'2026-09-06|川崎|9'}),wrong=c.restoreSavedRace(saved,{organization:'JRA',raceId:'2026-09-06|川崎|9'});
  assert.deepEqual(exact.resultSnapshot.finishOrder,[1,2,3]);assert.equal(wrong.predictionSnapshot,null);
});

test('an async response is stale after the active race generation changes',async()=>{
  const {c}=await loadCore();c.setState({race:narRace,predictionSnapshot:prediction(narRace)});const request={...c.activeRaceIdentity(),generation:c.getActiveRaceGeneration()};
  assert.equal(c.activeRequestMatches(request),true);c.beginActiveRaceTransition('NAR',{...narRace,raceNo:10});assert.equal(c.activeRequestMatches(request),false);
});

test('Public API URL is generated from the confirmed active race',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,predictionSnapshot:prediction(jraRace)});const url=new URL(c.currentPublicApiUrl());
  assert.equal(url.searchParams.get('organization'),'JRA');assert.equal(url.searchParams.get('track'),'札幌');assert.equal(url.searchParams.get('race'),'1');
  c.setState({race:jraRace,predictionSnapshot:null});assert.equal(c.currentPublicApiUrl(),null);
});

test('day API URL is generated from the confirmed active date track and organization',async()=>{
  const {c}=await loadCore();c.setState({race:jraRace,predictionSnapshot:prediction(jraRace)});const url=new URL(c.currentPublicDayApiUrl());
  assert.equal(url.pathname,'/api/chass/v1/public/day-ai');assert.equal(url.searchParams.get('date'),'2026-09-07');assert.equal(url.searchParams.get('track'),'札幌');assert.equal(url.searchParams.get('organization'),'JRA');assert.equal(url.searchParams.get('format'),'compact');
});

test('active layer invariant checks both organization and race id',async()=>{
  const {c}=await loadCore(),record={race:jraRace};
  assert.equal(c.layerMatchesActive(record,{raceId:'2026-09-07|札幌|1',organization:'JRA'}),true);
  assert.equal(c.layerMatchesActive(record,{raceId:'2026-09-07|札幌|1',organization:'NAR'}),false);
  assert.equal(c.layerMatchesActive(record,{raceId:'2026-09-07|札幌|2',organization:'JRA'}),false);
});

test('empty validation fields do not display race-specific sample results',async()=>{
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/id="actualWeather"[^>]*placeholder="未入力"/);
  assert.match(html,/id="actualTimesInput"[^>]*placeholder="未入力"/);
  assert.doesNotMatch(html,/placeholder="雨"/);
  assert.doesNotMatch(html,/placeholder="5=1:59\.6/);
});
