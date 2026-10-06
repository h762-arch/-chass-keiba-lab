import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function core(){
 const window={__CHASS_TEST__:true},document={getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}};
 const context={window,document,localStorage:{getItem(){return null},setItem(){throw Error('unexpected write');}},console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);return window.CHASS_TEST;
}
function record(kind='backtest_prediction') {return {race:{predictionKind:kind},predictionCreatedAt:'2026-10-06T10:00:00Z',resultAcquiredAt:'2026-10-06T09:00:00Z',predictionSnapshot:{predictionKind:kind,horses:[]}};}
test('backtest chronology is classified separately without relaxing integrity gate',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);const before=JSON.stringify(r),i=c.verifySnapshotIntegrity(r);
 assert.equal(i.chronology,'historical_post_result');assert.equal(i.referenceOnly,true);assert.equal(i.status,'invalid');assert.equal(i.temporalInvalid,true);assert.equal(i.mismatches.length,0);assert.equal(JSON.stringify(r),before);
});
test('quality distinguishes historical post-result generation from ordinary chronology error',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);const q=c.validationQuality(r);
 assert.ok(q.issues.some(x=>x.code==='HISTORICAL_POST_RESULT'));assert.ok(q.issues.some(x=>x.code==='BACKTEST_REFERENCE_ONLY'));assert.ok(!q.issues.some(x=>x.code==='TEMPORAL_INVALID'));assert.equal(q.grade,'C');
});
test('ordinary result-before-prediction remains an invalid chronology error',()=>{
 const c=core(),r=record('early_prediction');c.sealSnapshotIntegrity(r,true);const i=c.verifySnapshotIntegrity(r);
 assert.equal(i.referenceOnly,false);assert.equal(i.chronology,'result_before_prediction');assert.equal(i.status,'invalid');assert.ok(c.validationQuality(r).issues.some(x=>x.code==='TEMPORAL_INVALID'));
});
test('historical tag alone never reclassifies an ordinary prediction',()=>{
 const c=core(),r=record('early_prediction');r.historicalResearch=true;c.sealSnapshotIntegrity(r,true);
 assert.equal(c.verifySnapshotIntegrity(r).chronology,'result_before_prediction');
});
test('historical reference label does not conceal a hash mismatch',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.predictionSnapshot.horses.push({horseNo:1});
 const i=c.verifySnapshotIntegrity(r);assert.equal(i.status,'invalid');assert.ok(i.mismatches.includes('predictionSnapshot'));assert.match(i.label,/改変/);assert.ok(c.validationQuality(r).issues.some(x=>x.code==='SNAPSHOT_CHANGED'));
});
test('backtest stays reference-only even when acquisition timestamps are ordered',()=>{
 const c=core(),r=record();r.resultAcquiredAt='2026-10-06T11:00:00Z';c.sealSnapshotIntegrity(r,true);
 assert.equal(c.verifySnapshotIntegrity(r).chronology,'ordered');assert.equal(c.verifySnapshotIntegrity(r).referenceOnly,true);assert.equal(c.validationQuality(r).grade,'C');
});
test('missing hashes and dates never become verified through historical classification',()=>{
 const c=core(),r=record();delete r.predictionCreatedAt;delete r.resultAcquiredAt;
 const i=c.verifySnapshotIntegrity(r);assert.equal(i.chronology,'unknown');assert.equal(i.status,'legacy');assert.equal(i.referenceOnly,true);
});
