import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function core(){
 const window={__CHASS_TEST__:true},deny=()=>{throw Error('EXTERNAL_EFFECT_FORBIDDEN');};
 const context={window,console,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone,fetch:deny,
  localStorage:{getItem:()=>null,setItem:deny,removeItem:deny},setTimeout:deny,setInterval:deny,clearTimeout(){},clearInterval(){}};
 vm.createContext(context);
 // Test-only VM visibility; no new production/global export or runtime caller.
 vm.runInContext(source.replace('window.CHASS_TEST={','window.CHASS_TEST={originalLayerHorses,buildLiveAdjustedPrediction,'),context);
 return window.CHASS_TEST;
}
const plain=v=>JSON.parse(JSON.stringify(v));
function record(){
 const horses=Array.from({length:5},(_,i)=>({horseNo:i+1,horseName:'ORIGINAL-'+(i+1),win:[32,24,18,14,12][i],place:60-i*5,overall:90-i*5,
  predictedTime:'1:30.0',predictedTimeConfidence:80,runningStyle:i?'先行':'逃げ',dataConfidence:70,
  abilityMark:i===0?'◎':i===1?'○':'',features:{distanceFit:80,courseFit:80,evidence:{sameDistance:2}},
  raw:{highest:90,avg5:80,distance:75,course:75,recent:[80,81]},scores:{timeIndex:70,distanceFit:70,courseFit:70,weight:50},
  predictionAxes:{paceFitScore:60,placeStabilityScore:65,speedCeilingScore:65,distanceChangeFit:60,conditionProgressScore:60,evidenceCount:6}}));
 return {race:{raceDate:'2026-10-19',track:'高知',raceNo:7,raceType:'NAR',pace:'標準',oddsType:'実オッズ'},
  predictionSnapshot:{modelVersion:'synthetic',createdAt:'2026-10-19T00:00:00Z',horses},
  marketSnapshot:{horses:horses.map(h=>({horseNo:h.horseNo,popularity:h.horseNo,odds:3+h.horseNo,ev:100,valueMark:'',warningMark:''}))},
  finalSnapshot:{ranking:horses.map((h,i)=>({horseNo:h.horseNo,rank:i+1,mark:i===0?'◎':i===1?'○':''}))}};
}
const pollute=r=>{for(const rows of [r.marketSnapshot.horses,r.finalSnapshot.ranking])for(const h of rows)Object.assign(h,{horseName:'LATE',win:99,place:99,overall:99,abilityScore:99,predictedTime:'0:01.0',features:{source:'LATE'},predictionAxes:{source:'LATE'}});return r;};
test('legacy Live builder origin uses the same Prediction ownership as the frozen reader',()=>{
 const c=core(),r=pollute(record()),before=JSON.stringify(r),rows=c.originalLayerHorses(r),canonical=c.frozenHorses(r);
 for(let i=0;i<rows.length;i++)for(const key of ['horseNo','horseName','win','place','overall','predictedTime','features','predictionAxes'])assert.deepEqual(plain(rows[i][key]),r.predictionSnapshot.horses[i][key]);
 assert.equal(rows[0].abilityScore,undefined);assert.equal(rows[0].odds,4);assert.equal(rows[0].rank,1);assert.equal(rows[0].originalMark,'◎');
 assert.equal(rows[0].win,canonical[0].win);assert.equal(JSON.stringify(r),before);
});
test('missing Prediction probability is not filled from FINAL or Market at Live origin',()=>{const c=core(),r=pollute(record());delete r.predictionSnapshot.horses[0].win;assert.equal(c.originalLayerHorses(r)[0].win,undefined);});
test('explicit null market values stay null at Live origin',()=>{const c=core(),r=record();r.predictionSnapshot.horses[0].odds=99;r.marketSnapshot.horses[0].odds=null;assert.equal(c.originalLayerHorses(r)[0].odds,null);});
test('mutation of origin output cannot change nested original snapshots',()=>{const c=core(),r=record(),rows=c.originalLayerHorses(r);rows[0].features.distanceFit=0;rows[0].predictionAxes.paceFitScore=0;assert.equal(r.predictionSnapshot.horses[0].features.distanceFit,80);assert.equal(r.predictionSnapshot.horses[0].predictionAxes.paceFitScore,60);});
test('frozen warning clears FINAL mark alias in reader without changing source or seal',()=>{
 const c=core(),r=record();r.marketSnapshot.signalSnapshot={status:'frozen',horses:[{horseNo:1,warningMark:'⚠️',valueMark:'',longshotReasons:[]}]};
 c.sealSnapshotIntegrity(r,true);const before=JSON.stringify(r),row=c.frozenHorses(r)[0];
 for(const key of ['mark','finalMark','abilityMark','valueMark'])assert.equal(row[key],'');assert.equal(row.warningMark,'⚠️');
 assert.equal(r.finalSnapshot.ranking[0].mark,'◎');assert.equal(r.predictionSnapshot.horses[0].abilityMark,'◎');assert.equal(JSON.stringify(r),before);assert.equal(c.verifySnapshotIntegrity(r).status,'verified');
 assert.equal(c.originalLayerHorses(r)[0].originalMark,'');
});
test('frozen empty warning does not clear an existing valid FINAL mark',()=>{const c=core(),r=record();r.marketSnapshot.signalSnapshot={status:'frozen',horses:[{horseNo:1,warningMark:'',valueMark:'',longshotReasons:[]}]};const row=c.frozenHorses(r)[0];assert.equal(row.mark,'◎');assert.equal(row.abilityMark,'◎');});
test('warning-only frozen path enforces the same alias exclusion',()=>{const c=core(),r=record();r.marketSnapshot.signalSnapshot={warningFrozenAt:'2026-10-19T00:00:00Z',horses:[{horseNo:1,warningMark:'⚠️'}]};assert.equal(c.frozenHorses(r)[0].mark,'');assert.equal(c.originalLayerHorses(r)[0].originalMark,'');});
test('frozen signal protects empty original reasons and marks from later values at Live origin',()=>{const c=core(),r=record();Object.assign(r.marketSnapshot.horses[0],{valueMark:'💎💎💎',longshotReasons:[{label:'LATE'}]});r.marketSnapshot.signalSnapshot={status:'frozen',horses:[{horseNo:1,valueMark:'',warningMark:'',longshotReasons:[]}]};const before=JSON.stringify(r),row=c.originalLayerHorses(r)[0];assert.equal(row.valueMark,'');assert.deepEqual(plain(row.longshotReasons),[]);assert.equal(JSON.stringify(r),before);});
test('reference legacy fallback stays cloned and enforces warning exclusivity',()=>{const c=core(),r={horses:[{horseNo:1,win:12,mark:'◎',abilityMark:'◎',finalMark:'◎',valueMark:'💎',warningMark:'⚠️'}]},before=JSON.stringify(r),rows=c.frozenHorses(r);assert.equal(rows[0].mark,'');assert.equal(rows[0].abilityMark,'');assert.equal(rows[0].finalMark,'');assert.equal(rows[0].valueMark,'');rows[0].win=99;assert.equal(JSON.stringify(r),before);assert.equal(r.predictionSnapshot,undefined);});
test('legacy fallback never substitutes a probability from other layers',()=>{const c=core(),r={horses:[{horseNo:1}],marketSnapshot:{horses:[{horseNo:1,win:99}]},finalSnapshot:{top3:[{horseNo:1,win:88,mark:'◎'}]}};assert.equal(c.originalLayerHorses(r)[0].win,undefined);assert.equal(r.predictionSnapshot,undefined);});
test('helper baseline status remains active independently of later scratch audit',()=>{const c=core(),r=record();r.scratchAudit={statusByHorse:{1:'scratched'}};const row=c.originalLayerHorses(r)[0];assert.equal(row.horseStatus,'active');assert.equal(row.eligible,true);assert.equal(r.scratchAudit.statusByHorse[1],'scratched');});
test('direct legacy Live builder ignores forbidden overlay fields and leaves originals unchanged',()=>{
 const c=core(),clean=record(),dirty=pollute(record()),before=JSON.stringify(dirty),status=[{horseNo:5,horseStatus:'scratched'}],at='2026-10-19T01:00:00Z';
 const a=c.buildLiveAdjustedPrediction(clean,status,at),b=c.buildLiveAdjustedPrediction(dirty,status,at);
 assert.deepEqual(plain(a),plain(b));assert.equal(JSON.stringify(dirty),before);assert.equal(dirty.liveAdjustedPrediction,undefined);
});
test('normal scratch processing remains status-only and does not activate the legacy builder',()=>{const c=core(),r=record();r.horses=plain(r.predictionSnapshot.horses);const prediction=JSON.stringify(r.predictionSnapshot),final=JSON.stringify(r.finalSnapshot);c.applyScratchStatuses(r,[{horseNo:1,horseStatus:'scratched'}],'2026-10-19T01:00:00Z');assert.equal(r.liveAdjustedPrediction,undefined);assert.equal(JSON.stringify(r.predictionSnapshot),prediction);assert.equal(JSON.stringify(r.finalSnapshot),final);assert.equal(r.horses[0].eligible,false);});
test('test-only helper visibility is not added to production globals',()=>{const exported=source.slice(source.indexOf('window.CHASS_TEST={'),source.indexOf('\n return;',source.indexOf('window.CHASS_TEST={')));assert.doesNotMatch(exported,/originalLayerHorses|buildLiveAdjustedPrediction/);});
