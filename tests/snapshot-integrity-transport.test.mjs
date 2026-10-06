import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {d1RecordRows,d1SyncDescriptor,d1Fingerprint,readD1Records,readD1ResearchDataset,saveD1Record} from '../worker.js';
function core(){
 const window={__CHASS_TEST__:true},document={getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}};
 const context={window,document,localStorage:{getItem(){return null},setItem(){throw Error('unexpected write');}},console,setTimeout,clearTimeout,setInterval,clearInterval,Date,Math,JSON,Map,Set,URL,Blob,TextEncoder,structuredClone};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);return window.CHASS_TEST;
}
const plain=x=>JSON.parse(JSON.stringify(x));
function record(){return {race:{raceDate:'2026-09-10',track:'川崎',raceNo:1},modelVersion:'10.0.1',predictionSnapshot:{modelVersion:'10.0.1',createdAt:'2026-09-10T01:00:00Z',horses:[{horseNo:1,win:30,place:60}]},marketSnapshot:{horses:[{horseNo:1,odds:3,popularity:1}]},finalSnapshot:{top3:[{horseNo:1,mark:'◎'}]},updatedAt:'2026-09-10T01:00:00Z'};}
function row(r){const x=d1RecordRows('2026-09-10|川崎|1',r).race;return {race_id:x.raceId,model_version:x.modelVersion,race_json:x.raceJson,prediction_json:x.predictionJson,market_json:x.marketJson,final_json:x.finalJson,result_json:x.resultJson,validation_json:x.validationJson,prediction_created_at:x.predictionCreatedAt,result_acquired_at:x.resultAcquiredAt,status:x.status,updated_at:x.updatedAt};}
function db(value){const batches=[];return {batches,async batch(items){batches.push(items);return []},prepare(sql){return {sql,args:[],bind(...args){this.args=args;return this},async first(){return value},async all(){return {results:/FROM races/.test(sql)?[value]:[]}},async run(){return {success:true}}}}};}
test('seal and all frozen snapshots survive both cloud read routes exactly',async()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);const before=structuredClone(r),mock=db(row(r));
 for(const output of [(await readD1Records(mock))[0].record,(await readD1ResearchDataset(mock)).records[0].record]){
  assert.deepEqual(output.snapshotIntegrity,r.snapshotIntegrity);assert.equal(output.race.snapshotIntegrity,undefined);
  for(const k of ['predictionSnapshot','marketSnapshot','finalSnapshot'])assert.deepEqual(output[k],r[k]);
  assert.equal(c.verifySnapshotIntegrity(output).status,'verified');
 }
 assert.deepEqual(r,before);
});
test('old records never acquire a seal during serialization or restore',async()=>{
 const c=core(),r=record(),mock=db(row(r));for(const output of [(await readD1Records(mock))[0].record,(await readD1ResearchDataset(mock)).records[0].record])assert.equal(c.verifySnapshotIntegrity(output).status,'legacy');
 assert.equal(r.snapshotIntegrity,undefined);
});
test('mismatched seal remains mismatched after cloud round trip',async()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);r.marketSnapshot.horses[0].odds=99;
 const output=(await readD1Records(db(row(r))))[0].record;assert.deepEqual(output.snapshotIntegrity,r.snapshotIntegrity);assert.ok(c.verifySnapshotIntegrity(output).mismatches.includes('marketSnapshot'));
});
test('app and worker manifest fingerprints include the seal consistently',()=>{
 const c=core(),r=record(),id='2026-09-10|川崎|1',old=c.cloudDescriptor(id,r);c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);
 const app=c.cloudDescriptor(id,r),worker=d1SyncDescriptor(id,r);assert.equal(app.raceFingerprint,worker.raceFingerprint);assert.notEqual(app.raceFingerprint,old.raceFingerprint);
});
test('cloud merge restores evidence only for the same frozen snapshot set',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);const local=record(),merged=c.mergeCloudResearchRecord(local,r);assert.deepEqual(plain(merged.snapshotIntegrity),r.snapshotIntegrity);
 local.marketSnapshot.horses[0].odds=8;assert.equal(c.mergeCloudResearchRecord(local,r).snapshotIntegrity,undefined);
 assert.equal(local.snapshotIntegrity,undefined);
});
test('legacy client updates cannot erase an existing stored seal',async()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);const existing=row(r),legacy=record();legacy.marketSnapshot.horses[0].odds=7;
 const mock=db(existing);await saveD1Record(mock,'2026-09-10|川崎|1',legacy);
 const update=mock.batches.flat().find(x=>x.sql.startsWith('UPDATE races SET race_json='));assert.ok(update);assert.deepEqual(JSON.parse(update.args[0]).snapshotIntegrity,r.snapshotIntegrity);assert.equal(legacy.snapshotIntegrity,undefined);
});
test('nested stored evidence is retained on scheduled-record serialization',()=>{
 const c=core(),r=record();c.sealSnapshotIntegrity(r,true);r.snapshotIntegrity=plain(r.snapshotIntegrity);const seal=r.snapshotIntegrity;delete r.snapshotIntegrity;r.race.snapshotIntegrity=seal;
 assert.deepEqual(JSON.parse(d1RecordRows('id',r).race.raceJson).snapshotIntegrity,seal);
 assert.equal(d1SyncDescriptor('id',r).raceFingerprint,d1Fingerprint(JSON.parse(d1RecordRows('id',r).race.raceJson)));
});
