import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function loadCore(){
  const source=await readFile(new URL('../app.js',import.meta.url),'utf8'),memory=new Map(),window={__CHASS_TEST__:true};
  const context={window,console,Date,JSON,Math,Number,String,Array,Object,Map,Set,RegExp,parseFloat,localStorage:{getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v)}};
  vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});return window.CHASS_TEST;
}
function field(){
  return Array.from({length:10},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,win:20-i*1.2,place:50-i*2,overall:90-i*3,abilityScore:90-i*3,predictedTime:`1:4${i}.0`,popularity:i+1,odds:2+i,ev:95,dataConfidence:75,runningStyle:['逃げ','先行','先行','差し','差し','追込'][i%6],raw:{highest:92-i,avg5:85-i,recent:[82-i,86-i]},features:{consistencyScore:82-i,distanceFit:80-i,courseFit:76-i,recentFormScore:81-i,last3fAbility:75-i},runs:[{distance:1600,corners:'3-3-3-2'}],abilityMark:['◎','○','▲','△'][i]||'',valueMark:'',warningMark:''}));
}
function record(horses,finish=[1,2,3]){const race={raceDate:'2026-08-30',track:'大井',raceNo:8,distance:1400,pace:'平均'};return {race,predictionSnapshot:{createdAt:'2026-08-30T01:00:00Z',race,horses},finalSnapshot:{top3:horses.slice(0,3).map((h,i)=>({horseNo:h.horseNo,mark:['◎','○','▲'][i]}))},resultSnapshot:{finishOrder:finish,horses:finish.map((horseNo,i)=>({horseNo,position:i+1}))},validated:true}}

test('official probabilities and marks remain immutable in shadow mode',async()=>{
  const core=await loadCore(),hs=field(),before=hs.map(h=>({win:h.win,place:h.place,abilityMark:h.abilityMark,valueMark:h.valueMark,warningMark:h.warningMark}));
  const model=core.applyPredictionAxisReinforcement(hs,{distance:1400,pace:'平均'});
  assert.equal(model.mode,'shadow');assert.equal(model.adopted,false);assert.deepEqual(hs.map(h=>({win:h.win,place:h.place,abilityMark:h.abilityMark,valueMark:h.valueMark,warningMark:h.warningMark})),before);
});

test('ability and place stability are independent axes',async()=>{
  const core=await loadCore(),hs=field();hs[0].overall=98;hs[0].features.consistencyScore=25;hs[0].features.recentFormScore=28;hs[1].overall=78;hs[1].features.consistencyScore=92;hs[1].features.recentFormScore=90;
  core.applyPredictionAxisReinforcement(hs,{distance:1400,pace:'平均'});assert.ok(hs[0].predictionAxes.winningAbilityScore>hs[1].predictionAxes.winningAbilityScore);assert.ok(hs[0].predictionAxes.placeStabilityScore<hs[1].predictionAxes.placeStabilityScore);
});

test('distance shortening uses tracking and speed evidence, not a fixed bonus',async()=>{
  const core=await loadCore(),good={runs:[{distance:1600,corners:'1-1-1-1'}],features:{distanceFit:90}},bad={runs:[{distance:1600,corners:'10-10-9-8'}],features:{distanceFit:35}};
  assert.ok(core.distanceChangeAxis(good,{distance:1400},90,70).score>core.distanceChangeAxis(bad,{distance:1400},35,70).score);
});

test('transfer origin alone gets no automatic bonus',async()=>{
  const core=await loadCore(),originOnly=core.transferLevelAxis({transferOrigin:'JRA',overall:95}),supported=core.transferLevelAxis({transferOrigin:'JRA',overall:80,features:{classStrength:88,distanceFit:82}});
  assert.equal(originOnly.score,null);assert.ok(supported.score>70);assert.ok(supported.evidence>=1);
});

test('second start after break is not an automatic positive',async()=>{
  const core=await loadCore(),a=core.conditionProgressAxis({startAfterBreak:2,restDays:20,raw:{recent:[]},features:{}}),b=core.conditionProgressAxis({startAfterBreak:3,restDays:20,raw:{recent:[]},features:{}}),improving=core.conditionProgressAxis({startAfterBreak:2,restDays:20,raw:{recent:[70,82]},features:{conditionProgress:85}});
  assert.equal(a.score,b.score);assert.ok(improving.score>a.score);
});

test('pace fit favors the suitable style without changing base ability',async()=>{
  const core=await loadCore(),hs=field();hs[0].runningStyle='逃げ';hs[1].runningStyle='差し';hs.slice(2).forEach(h=>h.runningStyle='先行');hs[2].runningStyle='逃げ';const before=hs.map(h=>h.overall);
  core.applyPredictionAxisReinforcement(hs,{distance:1400,pace:'ハイ'});assert.ok(hs[1].predictionAxes.paceFitScore>hs[0].predictionAxes.paceFitScore);assert.deepEqual(hs.map(h=>h.overall),before);
});

test('low-win high-place unpopular horse can become a place longshot candidate',async()=>{
  const core=await loadCore(),hs=field(),h=hs[7];h.win=3;h.place=46;h.overall=78;h.predictedTime='1:40.4';h.features={consistencyScore:96,recentFormScore:92,distanceFit:90,courseFit:88,last3fAbility:82};h.raw={highest:88,avg5:90,recent:[86,90]};h.runningStyle='差し';
  core.applyPredictionAxisReinforcement(hs,{distance:1400,pace:'ハイ'});assert.equal(h.popularity,8);assert.ok(h.predictionAxes.candidatePlaceRate>h.predictionAxes.candidateWinRate);assert.equal(h.predictionAxes.placeLongshotCandidate,true);
});

test('debut model lowers confidence and does not fabricate runs',async()=>{
  const core=await loadCore(),hs=field();hs[0].runs=[];hs[0].debut=true;core.applyPredictionAxisReinforcement(hs,{distance:1400,pace:'平均'});assert.equal(hs[0].predictionAxes.debutModel,true);assert.ok(hs[0].predictionAxes.axisConfidence<=45);assert.equal(hs[0].runs.length,0);
});

test('candidate comparison is read-only and remains unadopted',async()=>{
  const core=await loadCore(),hs=field(),r=record(hs,[8,2,3]),before=JSON.stringify(r.predictionSnapshot);const comparison=core.comparePredictionAxisModels([r]);assert.equal(comparison.adopted,false);assert.equal(comparison.current.races,1);assert.equal(comparison.candidate.races,1);assert.equal(JSON.stringify(r.predictionSnapshot),before);
});

test('snapshot stores candidate axes separately from official values',async()=>{
  const core=await loadCore(),hs=field();const race={raceDate:'2026-08-30',track:'大井',raceNo:8,distance:1400,pace:'平均',oddsType:'実オッズ'};core.applyPredictionAxisReinforcement(hs,race);core.setState({race,horses:hs,result:null,actualTimes:{},finalSnapshot:null,predictionSnapshot:null,marketSnapshot:null});core.makeSnapshot();const state=core.getState();assert.equal(state.predictionSnapshot.axisModel.mode,'shadow');assert.equal(state.predictionSnapshot.axisModel.adopted,false);assert.equal(state.predictionSnapshot.featureSchemaVersion,2);assert.ok(state.predictionSnapshot.horses.every(h=>h.predictionAxes));
});

test('prediction-axis implementation does not rewrite NAR transport or volatility formula',async()=>{
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');assert.match(app,/\/api\/nar\/race/);assert.match(app,/\/api\/nar\/sync/);assert.match(app,/\/api\/nar\/odds/);assert.match(worker,/\/api\/nar\/race/);assert.match(worker,/\/api\/nar\/sync/);assert.match(worker,/\/api\/nar\/odds/);assert.match(app,/const VOLATILITY_WEIGHTS=/);assert.doesNotMatch(worker,/Prediction Axis Reinforcement/);
});
