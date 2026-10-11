import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,symlink,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {prepareJraDriveSnapshotArtifact as prepare,persistJraDriveSnapshotQuarantine as persist,readJraDriveSnapshotQuarantine as read} from '../src/research/jra-drive-snapshot-quarantine-v1.mjs';
const table=objects=>{const headers=[...new Set(objects.flatMap(Object.keys))];return [headers,...objects.map(o=>headers.map(k=>o[k]??null))];};
function fixture(){
 const sourceRaceId='20261011_東京_1',canonicalRaceId='20261011-JRA-TOK-01';return {environment:'QUARANTINE',
 snapshotContext:{runId:'synthetic-run',modelVersion:'synthetic-v1',cutoffAt:'2026-10-11T00:00:00Z',offAt:'2026-10-11T01:00:00Z',source:{spreadsheetId:'synthetic-pdf',revision:'synthetic-r1',availableAt:'2026-10-10T21:00:00Z',exportedAt:'2026-10-10T22:00:00Z'}},
 resolutionInput:{mapSpreadsheetId:'synthetic-master',pdfInput:{sourceRaceId,canonicalRaceId,sourceSpreadsheetId:'synthetic-pdf',
 manifestTable:table([{Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京','レース番号':1,'芝ダ障':'ダート','距離':1600,'出走頭数':2}]),
 runnerTable:table([1,2].map(n=>({Race_ID:sourceRaceId,'開催日':'2026-10-11','競馬場':'東京',R:1,'馬番':n,'馬名':`馬${n}`,Horse_Key:`TEMP|馬${n}`,'取消状態':'UNKNOWN','斤量':55}))),
 historyTable:table([1,2].flatMap(n=>[1,2,3,4,5].map(run=>({Race_ID:sourceRaceId,Horse_Key:`TEMP|馬${n}`,'馬番':n,'馬名':`馬${n}`,Run_No:run,'過去走日付':`2026-09-0${run}`,'競馬場':'新潟','芝ダ':'ダート','距離':1600,'着順':4,'走破TIME':'1:42.0'})))),
 statuses:[1,2].map(n=>({sourceRaceId,horseNo:n,horseName:`馬${n}`,status:'ACTIVE',evidenceRef:'synthetic/status'}))},
 raceMapTable:table([{SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceRace_ID:sourceRaceId,CanonicalRace_ID:canonicalRaceId,Org:'JRA',RaceDate:'2026-10-11',CourseRaw:'東京',R:1,MatchStatus:'CONFIRMED'}]),
 horseMapTable:table([1,2].map(n=>({SourceSystem:'SHEET',SourceSheet:'JRA_RACE_RUNNER',SourceHorse_Key:`TEMP|馬${n}`,CanonicalHorse_Key:`JRA|${n}`,HorseName:`馬${n}`,OfficialHorse_ID:`synthetic-${n}`,IdentityStatus:'CONFIRMED'})))}};
}
async function withRoot(fn){const root=await mkdtemp(join(tmpdir(),'chass-drive-test-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}
test('pipeline generates a market-free unverified research Snapshot from confirmed synthetic evidence',async()=>{
 const f=fixture(),before=structuredClone(f),out=await prepare(f);assert.deepEqual(f,before);assert.equal(out.status,'SNAPSHOT_PREPARED');assert.equal(out.snapshot.data.horses.length,2);assert.equal(out.formalKpiEligible,false);assert.equal(out.snapshot.sourceAuthentication,'UNVERIFIED');assert.equal(Object.isFrozen(out.inputs),true);
});
test('HOLD diagnostics persist without manufacturing a Snapshot',async()=>withRoot(async root=>{
 const f=fixture();f.resolutionInput.horseMapTable=f.resolutionInput.horseMapTable.slice(0,1);const saved=await persist({...f,root});assert.equal(saved.readbackVerified,true);assert.equal(saved.artifact.status,'RESOLUTION_HOLD');assert.equal(saved.artifact.snapshot,null);assert.equal(saved.artifact.resolution.joinedCount,0);assert.equal(saved.formalKpiEligible,false);
}));
test('stored bytes are replayed from retained inputs and read in a separate Node process',async()=>withRoot(async root=>{
 const saved=await persist({...fixture(),root});assert.equal(saved.writeState,'CREATED');
 const module=new URL('../src/research/jra-drive-snapshot-quarantine-v1.mjs',import.meta.url).href;
 const code=`import {readJraDriveSnapshotQuarantine as read} from ${JSON.stringify(module)};let s='';for await(const c of process.stdin)s+=c;const out=await read(JSON.parse(s));console.log(JSON.stringify({verified:out.readbackVerified,status:out.artifact?.status,eligible:out.formalKpiEligible}));`;
 const out=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{input:JSON.stringify({root,environment:'QUARANTINE',anchor:saved.anchor}),encoding:'utf8'}));assert.deepEqual(out,{verified:true,status:'SNAPSHOT_PREPARED',eligible:false});
}));
test('identical rerun is idempotent, conflicting evidence does not overwrite',async()=>withRoot(async root=>{
 const f=fixture(),first=await persist({...f,root}),again=await persist({...f,root});assert.equal(again.writeState,'EXISTING_IDENTICAL');
 f.snapshotContext.source.revision='changed';const conflict=await persist({...f,root});assert.equal(conflict.reason,'QUARANTINE_IMMUTABLE_CONFLICT');assert.equal((await read({root,environment:'QUARANTINE',anchor:first.anchor})).readbackVerified,true);
}));
test('independently retained anchor rejects byte tampering',async()=>withRoot(async root=>{
 const saved=await persist({...fixture(),root}),file=join(root,(await readdir(root))[0]),raw=await readFile(file,'utf8');await writeFile(file,raw.replace('synthetic-r1','synthetic-r2'));assert.equal((await read({root,environment:'QUARANTINE',anchor:saved.anchor})).reason,'QUARANTINE_HASH_MISMATCH');
}));
test('even a newly supplied hash cannot bypass replay of a forged output',async()=>withRoot(async root=>{
 const saved=await persist({...fixture(),root}),file=join(root,(await readdir(root))[0]),raw=await readFile(file,'utf8'),tampered=raw.replace('"adopted":false','"adopted":true');await writeFile(file,tampered);
 const anchor={...saved.anchor,payloadHash:createHash('sha256').update(tampered).digest('hex'),byteLength:Buffer.byteLength(tampered)};
 assert.equal((await read({root,environment:'QUARANTINE',anchor})).reason,'QUARANTINE_REPLAY_MISMATCH');
}));
test('concurrent conditional publication preserves one immutable artifact',async()=>withRoot(async root=>{
 const out=await Promise.all([persist({...fixture(),root}),persist({...fixture(),root})]);assert.equal(out.filter(x=>x.writeState==='CREATED').length,1);assert.equal(out.filter(x=>x.writeState==='EXISTING_IDENTICAL').length,1);assert.equal((await readdir(root)).length,1);
}));
test('foreign anchor identity or size cannot reconnect',async()=>withRoot(async root=>{
 const saved=await persist({...fixture(),root});assert.equal((await read({root,environment:'QUARANTINE',anchor:{...saved.anchor,byteLength:saved.anchor.byteLength+1}})).reason,'QUARANTINE_SIZE_MISMATCH');assert.equal((await read({root,environment:'QUARANTINE',anchor:{...saved.anchor,runId:'other'}})).readbackVerified,false);
}));
test('file symlink is not followed during reconnect',async()=>withRoot(async root=>{
 const saved=await persist({...fixture(),root}),file=join(root,(await readdir(root))[0]),copy=file+'.copy';await writeFile(copy,await readFile(file));await rm(file);await symlink(copy,file);assert.equal((await read({root,environment:'QUARANTINE',anchor:saved.anchor})).readbackVerified,false);
}));
test('environment, traversal IDs and size bounds reject before publication',async()=>withRoot(async root=>{
 const f=fixture();assert.equal((await persist({...f,root,environment:'PRODUCTION'})).persisted,false);f.snapshotContext.runId='../escape';await assert.rejects(prepare(f),/RUN_VERSION/);const g=fixture();g.snapshotContext.extra='x'.repeat(300001);await assert.rejects(prepare(g),/TOO_LARGE/);assert.equal((await readdir(root)).length,0);
}));
test('cutoff and source identity cannot be bypassed by context overrides',async()=>{
 const f=fixture();f.snapshotContext.source.spreadsheetId='other';await assert.rejects(prepare(f),/SOURCE_MISMATCH/);
 const g=fixture();g.snapshotContext.source.availableAt='2026-10-11T02:00:00Z';await assert.rejects(prepare(g),/SOURCE_NOT_AVAILABLE/);
 const h=fixture();h.snapshotContext.races=[];h.snapshotContext.identityMap=[];h.snapshotContext.raceId='other';assert.equal((await prepare(h)).snapshot.data.horses.length,2);
});
