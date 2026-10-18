import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function core(){
 const window={__CHASS_TEST__:true};
 const forbidden=()=>{throw Error('EXTERNAL_EFFECT_FORBIDDEN');};
 const context={window,console,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone,
  fetch:forbidden,localStorage:{getItem:()=>null,setItem:forbidden,removeItem:forbidden},
  setTimeout:forbidden,setInterval:forbidden,clearTimeout(){},clearInterval(){}};
 vm.createContext(context);vm.runInContext(source,context,{filename:'app.js'});
 return window.CHASS_TEST;
}
const plain=x=>JSON.parse(JSON.stringify(x));
function record(){return {
 race:{category:'中央競馬',raceDate:'2026-10-19',track:'東京',raceNo:1},
 predictionSnapshot:{createdAt:'2026-10-19T00:00:00.000Z',horses:[{
  horseNo:1,horseName:'EARLY HORSE',win:25,place:50,overall:75,abilityScore:70,
  predictedTime:'1:40.0',features:{source:'EARLY'},abilityMark:'◎',longshotReasons:[]}]},
 marketSnapshot:{horses:[{horseNo:1,odds:4,popularity:1,ev:100}]},
 finalSnapshot:{top3:[{horseNo:1,mark:'◎',win:25,place:50,overall:75,predictedTime:'1:40.0'}]},
 resultSnapshot:{fetchedAt:'2026-10-19T04:00:00.000Z',finishOrder:[1,2,3],actualTimes:{1:'1:41.0'}}};}

test('genuine unchanged seal remains verified without effects or input mutation',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);const before=JSON.stringify(r);
 assert.equal(c.verifySnapshotIntegrity(r).status,'verified');assert.equal(JSON.stringify(r),before);
});
for(const key of ['predictionSnapshot','marketSnapshot','finalSnapshot']){
 test('deleting sealed '+key+' is detected',()=>{
  const c=core(),r=record();c.sealSnapshotIntegrity(r,true);delete r[key];
  const output=c.verifySnapshotIntegrity(r);assert.equal(output.status,'invalid');
  assert.ok(output.mismatches.includes(key));assert.equal(output.verified,2);
 });
 test('dropping '+key+' hash does not leave unsealed data verified',()=>{
  const c=core(),r=record();c.sealSnapshotIntegrity(r,true);delete r.snapshotIntegrity.hashes[key];
  assert.equal(c.verifySnapshotIntegrity(r).status,'invalid');
 });
}
for(const [name,mutate] of [
 ['empty hashes',r=>{r.snapshotIntegrity.hashes={};}],
 ['hash array',r=>{r.snapshotIntegrity.hashes=[];}],
 ['unknown algorithm',r=>{r.snapshotIntegrity.algorithm='OTHER';}],
 ['unknown layer',r=>{r.snapshotIntegrity.hashes.unrecognized='fnv1a32:12345678';}],
 ['malformed digest',r=>{r.snapshotIntegrity.hashes.predictionSnapshot='not-a-digest';}],
])test('rejects seal: '+name,()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);mutate(r);
 const output=c.verifySnapshotIntegrity(r);assert.equal(output.status,'invalid');assert.ok(output.verified>=0);
});
test('unsealed legacy remains unverified and does not gain evidence',()=>{
 const c=core(),r=record();const before=JSON.stringify(r);
 assert.equal(c.verifySnapshotIntegrity(r).status,'legacy');assert.equal(JSON.stringify(r),before);
});
test('chronology failure remains invalid even with matching hashes',()=>{
 const c=core(),r=record();r.resultSnapshot.fetchedAt='2026-10-18T00:00:00.000Z';c.sealSnapshotIntegrity(r,true);
 assert.equal(c.verifySnapshotIntegrity(r).status,'invalid');
});
test('empty or missing frozen reasons clear later reasons',()=>{
 const c=core();for(const reasons of [[],undefined]){
  const horses=[{horseNo:1,longshotReasons:[{label:'LATE_ONLY'}]}];
  const saved={horseNo:1,valueMark:'💎'};if(reasons)saved.longshotReasons=reasons;
  c.applyFrozenSignalSnapshot(horses,{status:'frozen',horses:[saved]});
  assert.deepEqual(plain(horses[0].longshotReasons),[]);
 }
});
test('frozen evidence is copied exactly, without sharing mutable objects',()=>{
 const c=core(),snapshot={status:'frozen',horses:[{horseNo:1,valueMark:'💎',longshotReasons:[{label:'EARLY'}]}]};
 const horses=[{horseNo:1,longshotReasons:[{label:'LATE'}]}];c.applyFrozenSignalSnapshot(horses,snapshot);
 horses[0].longshotReasons[0].label='CHANGED';assert.equal(snapshot.horses[0].longshotReasons[0].label,'EARLY');
});
test('FINAL and Market cannot replace Prediction-owned values or identity',()=>{
 const c=core(),r=record();
 for(const x of [r.marketSnapshot.horses[0],r.finalSnapshot.top3[0]])Object.assign(x,{
  horseName:'LATE HORSE',win:99,place:99,overall:99,abilityScore:99,predictedTime:'1:01.0',
  features:{source:'LATE'},jraIndices:{invented:99}});
 const before=JSON.stringify(r),h=c.frozenHorses(r)[0];
 for(const key of ['horseName','win','place','overall','abilityScore','predictedTime','features'])
  assert.deepEqual(plain(h[key]),r.predictionSnapshot.horses[0][key]);
 assert.equal(h.jraIndices,undefined);assert.equal(h.odds,4);assert.equal(h.ev,100);assert.equal(h.mark,'◎');
 assert.equal(JSON.stringify(r),before);
});
test('missing EARLY probability remains missing despite FINAL probability',()=>{
 const c=core(),r=record();delete r.predictionSnapshot.horses[0].win;
 assert.equal(c.frozenHorses(r)[0].win,undefined);
});
test('market nulls remain null and do not fall back to prediction odds',()=>{
 const c=core(),r=record();r.predictionSnapshot.horses[0].odds=99;r.marketSnapshot.horses[0].odds=null;
 assert.equal(c.frozenHorses(r)[0].odds,null);
});
test('frozen signal overrides later display marks and evidence in the read view only',()=>{
 const c=core(),r=record();Object.assign(r.marketSnapshot.horses[0],{valueMark:'💎💎💎',longshotReasons:[{label:'LATE'}]});
 r.marketSnapshot.signalSnapshot={status:'frozen',horses:[{horseNo:1,valueMark:'',longshotReasons:[]}]};
 const before=JSON.stringify(r),h=c.frozenHorses(r)[0];
 assert.equal(h.valueMark,'');assert.deepEqual(plain(h.longshotReasons),[]);assert.equal(JSON.stringify(r),before);
});
test('cloud restore and dashboard reader use the same value ownership',()=>{
 const c=core(),r=record();r.finalSnapshot.top3[0].win=99;r.marketSnapshot.horses[0].win=88;
 const before=JSON.stringify(r),restored=c.mergeCloudResearchRecord(null,r);
 assert.equal(restored.horses[0].win,25);
 assert.deepEqual(plain(restored.horses),plain(c.frozenHorses(r)));assert.equal(JSON.stringify(r),before);
});
test('read-view mutations cannot change frozen nested Prediction data',()=>{
 const c=core(),r=record();c.frozenHorses(r)[0].features.source='CHANGED';
 assert.equal(r.predictionSnapshot.horses[0].features.source,'EARLY');
});
test('reference view does not create a Prediction snapshot for legacy horses',()=>{
 const c=core(),r={horses:[{horseNo:1,win:10}]};
 const h=c.frozenHorses(r);h[0].win=99;assert.equal(r.horses[0].win,10);assert.equal(r.predictionSnapshot,undefined);
});
