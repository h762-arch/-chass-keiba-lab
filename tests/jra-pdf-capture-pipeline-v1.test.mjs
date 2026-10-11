import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,readdir,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {runJraPdfCapturePipeline as run,readJraPdfCaptureAttempt as read} from '../src/research/jra-pdf-capture-pipeline-v1.mjs';
const html=await readFile(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8');
const table=objects=>{const h=Object.keys(objects[0]);return [h,...objects.map(o=>h.map(k=>o[k]))];};
function fixture(){const card=parseJraRaceCard(html),r=card.race;return {environment:'QUARANTINE',attemptId:'attempt-1',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html?CNAME=fixture',clock:()=>`${r.date}T00:00:00Z`,
 snapshotContext:{runId:'synthetic-run',modelVersion:'synthetic-v1',cutoffAt:`${r.date}T00:01:00Z`,offAt:`${r.date}T${r.postTime}:00+09:00`,source:{spreadsheetId:'pdf',revision:'r1',availableAt:`${r.date}T00:00:00Z`,exportedAt:`${r.date}T00:00:00Z`}},
 pdfInput:{sourceRaceId:'r',canonicalRaceId:'c',sourceSpreadsheetId:'pdf',
 manifestTable:table([{Race_ID:'r','開催日':r.date,'競馬場':r.racecourse,'レース番号':r.raceNo,'芝ダ障':r.surface,'距離':r.distance,'出走頭数':3}]),
 runnerTable:table(card.horses.map(h=>({Race_ID:'r','開催日':r.date,'競馬場':r.racecourse,R:r.raceNo,'馬番':h.horseNo,'馬名':h.horseName,Horse_Key:`TEMP|${h.horseName}`,'取消状態':'UNKNOWN',KnownHistoryRuns:0,UnknownHistorySlots:5,'斤量':55}))),
 historyTable:table(card.horses.flatMap(h=>[1,2,3,4,5].map(n=>({Race_ID:'r',Horse_Key:`TEMP|${h.horseName}`,'馬番':h.horseNo,'馬名':h.horseName,Run_No:n,'過去走日付':'UNKNOWN','競馬場':'UNKNOWN','芝ダ':'UNKNOWN','距離':'UNKNOWN','着順':'UNKNOWN','走破TIME':'UNKNOWN',Raw_PDF:'UNKNOWN'}))))},
 fetchImpl:async()=>new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}})};}
async function roots(fn){const parent=await mkdtemp(join(tmpdir(),'chass-capture-pipeline-')),root=join(parent,'attempts'),snapshotRoot=join(parent,'snapshots');await mkdir(root);await mkdir(snapshotRoot);try{await fn({root,snapshotRoot});}finally{await rm(parent,{recursive:true,force:true});}}
test('one run captures, resolves, persists and replays an unverified research Snapshot',async()=>roots(async loc=>{
 const f=fixture(),before=structuredClone(f.pdfInput),out=await run({...f,...loc});assert.equal(out.readbackVerified,true);assert.equal(out.attempt.outcome,'SNAPSHOT_SAVED');assert.equal(out.snapshotReadback.artifact.snapshot.data.horses.length,3);assert.equal(out.formalKpiEligible,false);assert.equal(out.freezeMutation,'NONE');assert.deepEqual(f.pdfInput,before);assert.equal(out.attempt.receipt.byteLength,Buffer.byteLength(html));assert.equal((await readdir(loc.root)).length,1);
}));
test('post-off capture persists resolution HOLD, missing slots and no Snapshot',async()=>roots(async loc=>{
 const f=fixture();f.clock=()=> '2026-09-05T12:00:00Z';const out=await run({...f,...loc});assert.equal(out.attempt.outcome,'RESOLUTION_HOLD');assert.equal(out.snapshotReadback.artifact.snapshot,null);assert.equal(out.snapshotReadback.artifact.resolution.declaredMissingHistory.length,15);assert.equal(out.snapshotReadback.artifact.resolution.failures.length,3);
}));
test('HTTP failure is persisted as a reason without a fabricated Snapshot',async()=>roots(async loc=>{
 const out=await run({...fixture(),...loc,fetchImpl:async()=>new Response('private token',{status:503})});assert.equal(out.readbackVerified,true);assert.equal(out.attempt.outcome,'CAPTURE_HOLD');assert.equal(out.attempt.reason,'OFFICIAL_CAPTURE_HTTP_REJECTED');assert.equal(out.attempt.receipt,null);assert.equal((await readdir(loc.snapshotRoot)).length,0);assert.equal(JSON.stringify(out).includes('private token'),false);
}));
test('network exceptions are sanitized and deadlines have durable failure receipts',async()=>roots(async loc=>{
 const f=fixture(),out=await run({...f,...loc,fetchImpl:async()=>{throw new Error('secret token https://private.example');}});assert.equal(out.attempt.reason,'CAPTURE_FAILED');assert.equal(JSON.stringify(out).includes('secret'),false);
 const expired=await run({...f,...loc,attemptId:'attempt-2',timeoutMs:10,fetchImpl:()=>new Promise(()=>{})});assert.equal(expired.attempt.reason,'OFFICIAL_CAPTURE_DEADLINE');assert.equal(expired.readbackVerified,true);
}));
test('capture after the Snapshot cutoff or a different off time cannot be saved as Snapshot',async()=>roots(async loc=>{
 for(const [i,change] of [{cutoffAt:'2026-09-04T23:59:59Z'},{offAt:'2026-09-05T04:00:00Z'}].entries()){
  const f=fixture();Object.assign(f.snapshotContext,change);const out=await run({...f,...loc,attemptId:`bad-${i}`});assert.equal(out.attempt.outcome,'SNAPSHOT_HOLD');assert.ok(['SNAPSHOT_TIMING_CONFLICT','SNAPSHOT_PREPARE_FAILED'].includes(out.attempt.reason));
 }assert.equal((await readdir(loc.snapshotRoot)).length,0);
}));
test('late official receipt cannot inherit an earlier source-availability timestamp',async()=>roots(async loc=>{
 const f=fixture();f.clock=()=> '2026-09-05T00:00:01Z';const out=await run({...f,...loc});assert.equal(out.attempt.reason,'SNAPSHOT_TIMING_CONFLICT');assert.equal((await readdir(loc.snapshotRoot)).length,0);
}));
test('persisted attempt reconnects from its anchor in a separate Node process without fetching',async()=>roots(async loc=>{
 const saved=await run({...fixture(),...loc});const url=new URL('../src/research/jra-pdf-capture-pipeline-v1.mjs',import.meta.url).href;
 const code=`import {readJraPdfCaptureAttempt as read} from ${JSON.stringify(url)};let s='';for await(const c of process.stdin)s+=c;const out=await read(JSON.parse(s));console.log(JSON.stringify({verified:out.readbackVerified,outcome:out.attempt?.outcome,formal:out.formalKpiEligible}));`;
 const out=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{input:JSON.stringify({...loc,environment:'QUARANTINE',anchor:saved.anchor}),encoding:'utf8'}));assert.deepEqual(out,{verified:true,outcome:'SNAPSHOT_SAVED',formal:false});
}));
test('same attempt identity cannot overwrite an earlier reason receipt',async()=>roots(async loc=>{
 const f=fixture(),first=await run({...f,...loc,fetchImpl:async()=>new Response('',{status:503})});let calls=0;const again=await run({...f,...loc,fetchImpl:async()=>{calls++;return new Response(html);}});assert.equal(calls,0);assert.equal((await readdir(loc.snapshotRoot)).length,0);assert.equal(again.reason,'ATTEMPT_IMMUTABLE_CONFLICT');assert.equal((await read({...loc,environment:'QUARANTINE',anchor:first.anchor})).attempt.reason,'OFFICIAL_CAPTURE_HTTP_REJECTED');
}));
test('Snapshot save conflict is recorded separately from capture failure',async()=>roots(async loc=>{
 const f=fixture();await run({...f,...loc});f.snapshotContext.source.revision='changed';const out=await run({...f,...loc,attemptId:'attempt-2'});assert.equal(out.attempt.outcome,'SNAPSHOT_HOLD');assert.equal(out.attempt.reason,'SNAPSHOT_SAVE_FAILED');assert.ok(out.attempt.receipt);
}));
test('mutating caller input while the fetch awaits cannot change the copied field',async()=>roots(async loc=>{
 const f=fixture();f.fetchImpl=async()=>{f.pdfInput.runnerTable[1][f.pdfInput.runnerTable[0].indexOf('馬名')]='changed';return new Response(html,{headers:{'content-type':'text/html; charset=utf-8'}});};const out=await run({...f,...loc});assert.equal(out.attempt.outcome,'SNAPSHOT_SAVED');assert.notEqual(out.snapshotReadback.artifact.snapshot.data.horses[0].horseName,'changed');
}));
test('attempt and child Snapshot tampering are both rejected',async()=>roots(async loc=>{
 const out=await run({...fixture(),...loc}),file=join(loc.root,(await readdir(loc.root))[0]),raw=await readFile(file,'utf8');await writeFile(file,raw.replace('SNAPSHOT_SAVED','SNAPSHOT_FAKED'));assert.equal((await read({...loc,environment:'QUARANTINE',anchor:out.anchor})).reason,'ATTEMPT_HASH_MISMATCH');await writeFile(file,raw);
 const child=join(loc.snapshotRoot,(await readdir(loc.snapshotRoot))[0]);await writeFile(child,'{}');assert.equal((await read({...loc,environment:'QUARANTINE',anchor:out.anchor})).reason,'ATTEMPT_SNAPSHOT_READBACK_FAILED');
}));
test('even a substituted anchor cannot bless modified eligibility flags',async()=>roots(async loc=>{
 const out=await run({...fixture(),...loc}),file=join(loc.root,(await readdir(loc.root))[0]),raw=(await readFile(file,'utf8')).replace('"formalKpiEligible":false','"formalKpiEligible":true');await writeFile(file,raw);const anchor={...out.anchor,payloadHash:createHash('sha256').update(raw).digest('hex'),byteLength:Buffer.byteLength(raw)};assert.equal((await read({...loc,environment:'QUARANTINE',anchor})).reason,'ATTEMPT_IDENTITY_MISMATCH');
}));
test('symlink attempt files and foreign anchors are rejected',async()=>roots(async loc=>{
 const out=await run({...fixture(),...loc}),file=join(loc.root,(await readdir(loc.root))[0]),copy=file+'.copy';await writeFile(copy,await readFile(file));await rm(file);await symlink(copy,file);assert.equal((await read({...loc,environment:'QUARANTINE',anchor:out.anchor})).readbackVerified,false);assert.equal((await read({...loc,environment:'QUARANTINE',anchor:{...out.anchor,attemptId:'other'}})).readbackVerified,false);
}));
test('invalid environment, traversal, oversized input and missing roots never fetch',async()=>roots(async loc=>{
 for(const extra of [{environment:'PRODUCTION'},{attemptId:'../escape'},{root:join(loc.root,'missing')},{pdfInput:{...fixture().pdfInput,extra:'x'.repeat(300001)}}]){let calls=0;const out=await run({...fixture(),...loc,...extra,fetchImpl:async()=>{calls++;}});assert.equal(out.reason,'ATTEMPT_INPUT_OR_LOCATION_INVALID');assert.equal(calls,0);}assert.equal((await readdir(loc.root)).length,0);
}));
test('concurrent publication preserves exactly one attempt file and its retained anchor',async()=>roots(async loc=>{
 const args={...fixture(),...loc,fetchImpl:async()=>new Response('',{status:503})};const results=await Promise.all([run(args),run(args)]);const created=results.filter(v=>v.writeState==='CREATED');assert.equal(created.length,1);assert.equal((await readdir(loc.root)).length,1);assert.equal((await read({...loc,environment:'QUARANTINE',anchor:created[0].anchor})).readbackVerified,true);assert.equal((await readdir(loc.snapshotRoot)).length,0);
}));
