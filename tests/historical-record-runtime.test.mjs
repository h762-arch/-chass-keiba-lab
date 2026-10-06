import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const now='2026-10-06T10:00:00.000Z';
function core(){
 class FixedDate extends Date { constructor(...args){super(...(args.length?args:[now]));} static now(){return Date.parse(now);} }
 const window={__CHASS_TEST__:true};
 const document={getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}};
 const context={window,document,localStorage:{getItem(){return null},setItem(){throw new Error('unexpected write');}},console,setTimeout,clearTimeout,setInterval,clearInterval,Date:FixedDate,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);
 return window.CHASS_TEST;
}
function input(){return {race:{category:'地方競馬',raceDate:'2026-01-12',track:'大井',raceNo:1,distance:1200,surface:'ダート',oddsType:'オッズなし'},horses:[1,2,3].map(horseNo=>({horseNo,horseName:`テスト${horseNo}`,win:20,place:50,overall:60}))};}
function result(){return {finishOrder:[1,2,3],acquiredAt:'2026-10-06T09:59:00.000Z',results:[1,2,3].map(horseNo=>({horseNo,position:horseNo}))};}
const plain=x=>JSON.parse(JSON.stringify(x));

test('saved historical diagnostics match independent verification of final snapshots',()=>{
 const c=core(),r=c.historicalRecord(input(),result());
 assert.deepEqual(plain(r.validationSnapshot.dataQuality.integrity),plain(c.verifySnapshotIntegrity(r)));
 assert.deepEqual(plain(c.verifySnapshotIntegrity(r).mismatches),[]);
 assert.ok(!r.validationSnapshot.dataQuality.issues.some(x=>x.code==='SNAPSHOT_CHANGED'));
});
test('post-result backtest retains true acquisition time and is not accepted as pre-result prediction',()=>{
 const c=core(),r=c.historicalRecord(input(),result());
 assert.equal(r.predictionSnapshot.predictionKind,'backtest_prediction');
 assert.equal(r.predictionSnapshot.createdAt,now);
 assert.equal(r.resultAcquiredAt,result().acquiredAt);
 assert.equal(c.verifySnapshotIntegrity(r).temporalInvalid,true);
 assert.equal(c.verifySnapshotIntegrity(r).status,'invalid');
});
test('backtest does not impersonate an input original snapshot or mutate input',()=>{
 const c=core(),root=input();root.predictionSnapshot={createdAt:'2026-01-11T00:00:00Z'};root.marketSnapshot={createdAt:'2026-01-11T00:00:00Z'};
 const before=structuredClone(root),r=c.historicalRecord(root,result());
 assert.equal(r.predictionSnapshot.createdAt,now);
 assert.deepEqual(root,before);
});
test('tampering after historical construction remains detectable without resealing',()=>{
 const c=core(),r=c.historicalRecord(input(),result());
 r.predictionSnapshot.horses[0].win=99;
 assert.ok(c.verifySnapshotIntegrity(r).mismatches.includes('predictionSnapshot'));
});
test('active state is restored after historical success and failure',()=>{
 const c=core(),sentinel={race:{track:'current'}};c.setState(sentinel);
 c.historicalRecord(input(),result());assert.equal(c.getState(),sentinel);
 assert.throws(()=>c.historicalRecord({horses:[]},result()));assert.equal(c.getState(),sentinel);
});
test('ordinary pre-race chronology guard remains fail-closed',()=>{
 const c=core(),r={predictionCreatedAt:now,resultAcquiredAt:result().acquiredAt,predictionSnapshot:{createdAt:now,horses:[]}};
 c.sealSnapshotIntegrity(r,true);assert.equal(c.verifySnapshotIntegrity(r).status,'invalid');
 assert.equal(c.verifySnapshotIntegrity(r).temporalInvalid,true);
});
