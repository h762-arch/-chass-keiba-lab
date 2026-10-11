import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,rm,readdir,writeFile,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {runJraPdfCaptureCli as cli} from '../scripts/jra-pdf-capture-cli.mjs';
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

async function setup(loc,change={}){
 const f=fixture();Object.assign(f,change);const {fetchImpl,clock,...input}=f;
 const inputPath=join(loc.root,'input.json'),receipt=join(loc.root,'receipt.json');await writeFile(inputPath,JSON.stringify(input));
 const argv=['capture','--input',inputPath,'--attempt-root',loc.root,'--snapshot-root',loc.snapshotRoot,'--receipt',receipt];
 return {inputPath,receipt,argv,fetchImpl,clock};
}
async function invoke(argv,deps={}){let out='',err='';const code=await cli(argv,{...deps,stdout:s=>{out+=s;},stderr:s=>{err+=s;}});return {code,value:JSON.parse(out),err};}
const replayArgs=(loc,f)=>['replay','--receipt',f.receipt,'--attempt-root',loc.root,'--snapshot-root',loc.snapshotRoot];
test('command saves a private receipt and returns code zero only for a research Snapshot',async()=>roots(async loc=>{
 const f=await setup(loc),out=await invoke(f.argv,f);assert.equal(out.code,0);assert.equal(out.value.status,'RECEIPT_SAVED_AND_VERIFIED');assert.equal(out.value.summary.snapshotSaved,true);assert.equal(out.value.summary.formalKpiEligible,false);assert.equal((await stat(f.receipt)).mode&0o777,0o600);const doc=JSON.parse(await readFile(f.receipt));assert.equal(doc.anchor.payloadHash,out.value.anchor.payloadHash);
}));
test('HOLD is durable but has a distinct nonzero exit code and no fabricated prediction',async()=>roots(async loc=>{
 const f=await setup(loc),out=await invoke(f.argv,{clock:()=> '2026-09-05T12:00:00Z',fetchImpl:f.fetchImpl});assert.equal(out.code,3);assert.equal(out.value.summary.outcome,'RESOLUTION_HOLD');assert.equal(out.value.summary.snapshotSaved,false);assert.equal(out.value.summary.resolutionReasons.PDF_RUNNER_STATUS_UNCONFIRMED,3);assert.equal(out.value.summary.sourceMissingSlots,15);
}));
test('failed fetch receipt contains a fixed reason and no private error text',async()=>roots(async loc=>{
 const f=await setup(loc),out=await invoke(f.argv,{clock:f.clock,fetchImpl:async()=>{throw new Error('private credential');}});assert.equal(out.code,3);assert.equal(out.value.summary.reason,'CAPTURE_FAILED');assert.equal(JSON.stringify(out).includes('credential'),false);assert.equal(out.value.summary.runnerCount,null);assert.equal((await invoke(replayArgs(loc,f))).code,3);
}));
test('a separate Node process verifies the saved receipt without another request',async()=>roots(async loc=>{
 const f=await setup(loc);await invoke(f.argv,f);const child=spawnSync(process.execPath,[new URL('../scripts/jra-pdf-capture-cli.mjs',import.meta.url).pathname,...replayArgs(loc,f)],{encoding:'utf8'});assert.equal(child.status,0);assert.equal(JSON.parse(child.stdout).status,'REPLAY_VERIFIED');assert.equal(JSON.parse(child.stdout).summary.snapshotSaved,true);
}));
test('replay never fetches and does not modify any stored files',async()=>roots(async loc=>{
 const f=await setup(loc);await invoke(f.argv,f);const before=await readFile(f.receipt);let calls=0;const out=await invoke(replayArgs(loc,f),{fetchImpl:async()=>{calls++;throw new Error('network forbidden');}});assert.equal(out.code,0);assert.equal(calls,0);assert.deepEqual(await readFile(f.receipt),before);
}));
test('an existing receipt is never overwritten and blocks another capture',async()=>roots(async loc=>{
 const f=await setup(loc);await invoke(f.argv,f);const before=await readFile(f.receipt);let calls=0;const out=await invoke(f.argv,{fetchImpl:async()=>{calls++;}});assert.equal(out.code,2);assert.equal(out.value.reason,'CLI_RECEIPT_EXISTS');assert.equal(calls,0);assert.deepEqual(await readFile(f.receipt),before);
}));
test('edited outcome or counts cannot pass receipt replay',async()=>roots(async loc=>{
 const f=await setup(loc);await invoke(f.argv,f);const doc=JSON.parse(await readFile(f.receipt));doc.summary.joinedCount=99;await writeFile(f.receipt,JSON.stringify(doc));const out=await invoke(replayArgs(loc,f));assert.equal(out.code,2);assert.equal(out.value.reason,'CLI_RECEIPT_SUMMARY_MISMATCH');
}));
test('forged anchors and changed child evidence cannot pass replay',async()=>roots(async loc=>{
 const f=await setup(loc);await invoke(f.argv,f);const doc=JSON.parse(await readFile(f.receipt));doc.anchor.payloadHash='0'.repeat(64);await writeFile(f.receipt,JSON.stringify(doc));const out=await invoke(replayArgs(loc,f));assert.equal(out.value.reason,'CLI_REPLAY_FAILED');assert.equal(out.code,2);
}));
test('duplicate, missing, unknown and relative arguments fail before any fetch',async()=>roots(async loc=>{
 const f=await setup(loc);for(const argv of [[],['capture'],[...f.argv,'--input',f.inputPath],[...f.argv,'--unknown',f.inputPath],f.argv.map(v=>v===f.inputPath?'relative.json':v)]){let calls=0;const out=await invoke(argv,{fetchImpl:async()=>{calls++;}});assert.equal(out.code,2);assert.equal(calls,0);}
}));
test('oversized, malformed and symlink input files reject before capture',async()=>roots(async loc=>{
 const f=await setup(loc);let calls=0;const deps={fetchImpl:async()=>{calls++;}};await writeFile(f.inputPath,'x'.repeat(300001));assert.equal((await invoke(f.argv,deps)).code,2);await writeFile(f.inputPath,'{bad json');assert.equal((await invoke(f.argv,deps)).code,2);const other=join(loc.root,'other');await writeFile(other,'{}');await rm(f.inputPath);await symlink(other,f.inputPath);assert.equal((await invoke(f.argv,deps)).code,2);assert.equal(calls,0);
}));
test('production environment and injected input controls are rejected',async()=>roots(async loc=>{
 for(const change of [{environment:'PRODUCTION'},{root:'/outside'},{fetchImpl:'ignored'}]){const f=await setup(loc),data=JSON.parse(await readFile(f.inputPath));Object.assign(data,change);await writeFile(f.inputPath,JSON.stringify(data));let calls=0;const out=await invoke(f.argv,{fetchImpl:async()=>{calls++;}});assert.equal(out.code,2);assert.equal(calls,0);}
}));
test('missing attempt root returns a failure code with no receipt',async()=>roots(async loc=>{
 const f=await setup(loc),argv=f.argv.map(v=>v===loc.root?join(loc.root,'absent'):v);const out=await invoke(argv,f);assert.equal(out.code,4);assert.equal(out.value.reason,'ATTEMPT_INPUT_OR_LOCATION_INVALID');assert.equal((await readdir(loc.root)).includes('receipt.json'),false);
}));
test('a receipt publication race preserves the existing file and emits a recovery anchor',async()=>roots(async loc=>{
 const f=await setup(loc);const out=await invoke(f.argv,{clock:f.clock,fetchImpl:async()=>{await writeFile(f.receipt,'reserved');return f.fetchImpl();}});assert.equal(out.code,4);assert.equal(out.value.reason,'CLI_RECEIPT_SAVE_OR_READ_FAILED');assert.ok(out.value.anchor?.payloadHash);assert.equal(await readFile(f.receipt,'utf8'),'reserved');assert.equal((await readdir(loc.root)).some(n=>n.endsWith('.tmp')),false);
}));
test('oversized and symlink receipt files cannot be replayed',async()=>roots(async loc=>{
 const f=await setup(loc);await writeFile(f.receipt,'x'.repeat(64001));assert.equal((await invoke(replayArgs(loc,f))).code,2);await rm(f.receipt);await symlink(f.inputPath,f.receipt);assert.equal((await invoke(replayArgs(loc,f))).code,2);
}));
