import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {captureCpsiPreRun,verifyCpsiProducerReceipt,parseCpsiIndexObservation,INDEX_OBSERVATION_FORMAT} from '../src/prediction/cpsi-pre-producer-v1.mjs';
import {sourceSha256,artifactsFromSourceFile,verifySourceArtifact} from '../src/prediction/cpsi-source-recovery-v1.mjs';
import {unpackSheetFeed} from '../src/prediction/cpsi-drive-reader-v1.mjs';
import {runCpsiProducerCli} from '../scripts/produce-cpsi-pre-run-v1.mjs';
const now=Date.parse('2026-10-21T08:00:00+09:00'),copy=x=>JSON.parse(JSON.stringify(x));
const index=()=>({format:INDEX_OBSERVATION_FORMAT,race:{organization:'NAR',raceDate:'2026-10-21',track:'浦和',code:'18',raceNo:1,surface:'ダート'},horses:[1,2].map(horseNo=>({horseNo,horseName:`試験${horseNo}`,peak:50-horseNo,baseline5:null,current:null,prev:40-horseNo,distance:35-horseNo,course:38-horseNo}))});
const row=(n,id)=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=${id}">試験${n}</a></td></tr>`;
const card=()=>'<h4>2026年10月21日（水） 浦　和　第1競走 12:20発走</h4>'+row(1,'30094404917')+row(2,'30094402717');
function setup(overrides={}){
 const saved=new Map(),events=[],data=index(),html=card();
 const store={async insertIfAbsent(id,v){events.push('commit');if(saved.has(id))return false;saved.set(id,copy(v));return true;},async get(id){events.push('read');return copy(saved.get(id));}};
 const args={enabled:true,clock:()=>now,store,async acquireIndex(){events.push('index');return JSON.stringify(data);},async acquireCard({url}){events.push('card');assert.equal(new URL(url).hostname,'www.keiba.go.jp');return html;},...overrides};
 return {args,saved,events,data,store};
}
test('explicit OFF performs no acquisition or persistence',async()=>{const s=setup();assert.equal((await captureCpsiPreRun({...s.args,enabled:false})).status,'DISABLED');assert.deepEqual(s.events,[]);});
test('new PRE binds observed index bytes, official roster and three new IDs, commits before read',async()=>{
 const s=setup(),before=JSON.stringify(s.data),r=await captureCpsiPreRun(s.args);
 assert.equal(r.status,'LOCAL_PRE_SOURCE_READY');assert.deepEqual(s.events,['index','card','commit','read']);assert.equal(JSON.stringify(s.data),before);
 assert.equal(r.receipt.body.artifact.input.horses[0].canonicalHorseKey,'NAR_LINEAGE:30094404917');
 assert.equal(r.receipt.body.artifact.input.freezeAt,new Date(now).toISOString());assert.equal(r.receipt.body.artifact.input.horses[0].canonicalIndex.baseline5,null);
 assert.equal(r.sourceOriginAuthenticated,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.originalEarlyMutation,false);
 await verifyCpsiProducerReceipt(r.receipt,{now});await verifySourceArtifact(r.bundle.sources[0],{now});
});
test('ready export matches existing source bundle and bounded Sheets feed readers',async()=>{
 const r=await captureCpsiPreRun(setup().args),a=await artifactsFromSourceFile(JSON.stringify(r.bundle),{now}),rows=unpackSheetFeed({majorDimension:'ROWS',values:[['organization','raceId','sourceJson'],r.feedRow]});
 assert.deepEqual(a,r.bundle.sources);assert.deepEqual(rows,r.bundle.sources);
});
test('separate captures get different Run and Snapshot identities without altering the earlier receipt',async()=>{
 const s=setup(),a=await captureCpsiPreRun(s.args),prior=JSON.stringify(a.receipt),b=await captureCpsiPreRun(s.args);
 assert.notEqual(a.runId,b.runId);assert.notEqual(a.receipt.body.artifact.input.indexSnapshotId,b.receipt.body.artifact.input.indexSnapshotId);assert.equal(JSON.stringify(a.receipt),prior);assert.equal(s.saved.size,2);
});
for(const [label,change]of [['market',d=>d.horses[0].odds=2],['result',d=>d.result={finishOrder:[1,2]}],['existing Freeze',d=>d.race.metricInputFreeze={runId:'OLD'}],['asterisk',d=>d.horses[0].baseline5='45*'],['dash',d=>d.horses[0].prev='-'],['untried',d=>d.horses[0].distance='未'],['numeric string',d=>d.horses[0].peak='50'],['infinity',d=>d.horses[0].peak={value:50}],['duplicate no',d=>d.horses[1].horseNo=1]])test(`strict index contract refuses ${label} before official acquisition`,async()=>{
 const s=setup();change(s.data);const r=await captureCpsiPreRun(s.args);assert.equal(r.status,'REJECTED');assert.deepEqual(s.events,['index']);assert.equal(s.saved.size,0);
});
test('zero, negative values and null remain distinct observations',async()=>{
 const s=setup();s.data.horses[0].prev=0;s.data.horses[1].peak=-12;const r=await captureCpsiPreRun(s.args);assert.equal(r.status,'LOCAL_PRE_SOURCE_READY');assert.equal(r.receipt.body.artifact.input.horses[0].canonicalIndex.prev,0);assert.equal(r.receipt.body.artifact.input.horses[1].canonicalIndex.peak,-12);
});
test('official wrong race, wrong names, missing runners and duplicate IDs reject before storage',async()=>{
 for(const html of [card().replace('第1競走','第2競走'),card().replace('試験1','別馬'),card().replace(row(2,'30094402717'),''),card().replace('30094402717','30094404917')]){
  const s=setup({acquireCard:async()=>html});assert.equal((await captureCpsiPreRun(s.args)).status,'REJECTED');assert.equal(s.saved.size,0);
 }
});
test('track/code confusion, impossible date and unsupported racing population reject',()=>{
 for(const patch of [{code:'19'},{raceDate:'2026-02-30'},{organization:'JRA'},{track:'帯広',code:'03'},{surface:'芝'}]){const d=index();Object.assign(d.race,patch);assert.throws(()=>parseCpsiIndexObservation(JSON.stringify(d)));}
});
test('clock reversal, stale acquisition, invalid clock and post-start freeze cannot write',async()=>{
 const cases=[[now,now-1],[now,now,now+60001],[now,now,now,now-1],[NaN],[Date.parse('2026-10-21T12:20:00+09:00')]];
 for(const ticks of cases){let i=0;const s=setup({clock:()=>ticks[Math.min(i++,ticks.length-1)]});const r=await captureCpsiPreRun(s.args);assert.equal(r.status,'REJECTED');assert.equal(s.saved.size,0);}
});
test('acquisition failures and oversized inputs never produce a ready source',async()=>{
 for(const overrides of [{acquireIndex:async()=>{throw Error('INDEX_OFFLINE');}},{acquireIndex:async()=>'x'.repeat(262145)},{acquireCard:async()=>'x'.repeat(1000001)},{acquireCard:async()=>{throw Error('CARD_OFFLINE');}}]){const s=setup(overrides),r=await captureCpsiPreRun(s.args);assert.equal(r.status,'REJECTED');assert.equal(s.saved.size,0);}
});
test('UUID collision and existing Run never overwrite',async()=>{
 const id='11111111-1111-4111-8111-111111111111',s=setup({randomUUID:()=>id});assert.equal((await captureCpsiPreRun(s.args)).reason,'PRODUCER_UUID_COLLISION');
 const t=setup({store:{insertIfAbsent:async()=>false,get:async()=>{throw Error('not read');}}});assert.equal((await captureCpsiPreRun(t.args)).reason,'PRODUCER_RUN_ALREADY_EXISTS');
});
test('commit failure, independent read failure and corrupt readback are not verified success',async()=>{
 for(const kind of ['write','read','corrupt']){
  const s=setup();if(kind==='write')s.args.store.insertIfAbsent=async()=>{throw Error('DISK_FULL');};
  else if(kind==='read')s.args.store.get=async()=>{throw Error('DISK_READ_FAILED');};
  else{const get=s.store.get.bind(s.store);s.store.get=async id=>{const v=await get(id);v.body.artifact.input.horses[0].canonicalIndex.peak++;return v;};}
  const r=await captureCpsiPreRun(s.args);assert.equal(r.status,'REJECTED');assert.equal(r.readbackVerified,false);assert.equal(r.bundle,undefined);assert.equal(r.feedRow,undefined);
 }
});
test('readback at post time keeps committed receipt quarantined and exports nothing',async()=>{
 let n=0;const s=setup({clock:()=>++n<6?now:Date.parse('2026-10-21T12:20:00+09:00')});const r=await captureCpsiPreRun(s.args);assert.equal(r.status,'REJECTED');assert.equal(r.stored,true);assert.equal(r.feedRow,undefined);
});
test('rewritten receipt hashes cannot hide changed official ID or index binding',async()=>{
 const r=await captureCpsiPreRun(setup().args),b=copy(r.receipt);b.body.indexObservation.raw=b.body.indexObservation.raw.replace('"peak":49','"peak":999');b.contentHash=await sourceSha256(b.body);await assert.rejects(verifyCpsiProducerReceipt(b,{now}),/PRODUCER_RUNNER_BINDING|PRODUCER_INDEX_BINDING/);
});
test('CLI is OFF by default and filesystem capture exports only after independent readback',async()=>{
 const off=await runCpsiProducerCli([],{fetchImpl:()=>{throw Error('unexpected network')}});assert.equal(off.status,'DISABLED');
 const dir=await mkdtemp(path.join(os.tmpdir(),'chass-cpsi-producer-test-')),file=path.join(dir,'index.json');await writeFile(file,JSON.stringify(index()));let requests=0;
 const r=await runCpsiProducerCli(['--enabled','--index-file',file,'--output-dir',path.join(dir,'runs')],{clock:()=>now,fetchImpl:async(url,init)=>{requests++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');assert.equal(new URL(url).pathname,'/KeibaWeb/TodayRaceInfo/DebaTable');return new Response(card(),{headers:{'content-type':'text/html; charset=utf-8'}});}});
 assert.equal(r.status,'LOCAL_PRE_SOURCE_READY');assert.equal(r.readbackScope,'LOCAL_FILESYSTEM');assert.equal(r.productionWritePerformed,false);assert.equal(requests,1);assert.deepEqual((await readdir(r.outputDirectory)).sort(),['drive-feed-row.json','receipt.json','source-bundle.json']);
 const bundle=JSON.parse(await readFile(path.join(r.outputDirectory,'source-bundle.json'),'utf8'));assert.equal((await artifactsFromSourceFile(JSON.stringify(bundle),{now})).length,1);
});
test('CLI refuses redirects, upstream errors and non-HTML without storage exports',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chass-cpsi-producer-http-')),file=path.join(dir,'index.json');await writeFile(file,JSON.stringify(index()));
 for(const response of [new Response('',{status:302}),new Response('',{status:503}),new Response('{}',{headers:{'content-type':'application/json'}})]){
  const r=await runCpsiProducerCli(['--enabled','--index-file',file,'--output-dir',path.join(dir,'runs')],{clock:()=>now,fetchImpl:async()=>response});assert.equal(r.status,'REJECTED');assert.equal(r.feedRow,undefined);
 }
});
