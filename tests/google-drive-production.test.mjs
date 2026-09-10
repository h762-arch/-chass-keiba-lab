import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runResearchSyncQueue} from '../research-storage-sync.mjs';
import {runScheduledTasks} from '../worker.js';

const runtimeFiles=['../research-storage-sync.mjs','../worker.js','../app.js','../index.html','../server.mjs','../wrangler.jsonc'];
const driveRuntimePattern=/GOOGLE_DRIVE|ENABLE_DRIVE|oauth2\.googleapis|googleapis\.com\/drive|drive-check|syncDriveArchive|verifyDriveConnection/i;

test('Google Drive Runtime is decommissioned from application sources',async()=>{
  const sources=await Promise.all(runtimeFiles.map(file=>readFile(new URL(file,import.meta.url),'utf8')));
  for(const source of sources)assert.doesNotMatch(source,driveRuntimePattern);
});

test('legacy Drive environment values cannot activate external I/O',async()=>{
  let fetches=0;
  const result=await runResearchSyncQueue(null,{ENABLE_DRIVE_SYNC:'true',GOOGLE_DRIVE_REFRESH_TOKEN:'legacy'},{fetcher:async()=>{fetches++;throw new Error('must not fetch')}});
  assert.equal(fetches,0);
  assert.deepEqual(result,{processed:0,skipped:true,reason:'disabled'});
});

test('scheduled handler never requires a Drive runner',async()=>{
  const calls=[];
  await runScheduledTasks({}, {env:{ENABLE_DRIVE_SYNC:'true'},resultRunner:async()=>{calls.push('result');return {processed:0}},meetingRunner:async()=>{calls.push('meeting');return {processed:0}},historicalRunner:async()=>{calls.push('history');return {processed:0}},researchRunner:async()=>{calls.push('research');return {processed:0,skipped:true}}});
  assert.deepEqual(calls,['result','meeting','history','research']);
  assert.equal(calls.includes('drive'),false);
});

test('legacy D1 Drive columns are retained without destructive migration',async()=>{
  const [migration,worker]=await Promise.all([readFile(new URL('../migrations/0004_research_storage_sync.sql',import.meta.url),'utf8'),readFile(new URL('../worker.js',import.meta.url),'utf8')]);
  assert.match(migration,/drive_status/);
  assert.match(worker,/drive_status/);
  assert.doesNotMatch(migration,/DROP\s+(?:TABLE|COLUMN)|DELETE\s+FROM/i);
});

test('D1 Public API, snapshots, JRA and NAR routes remain present',async()=>{
  const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');
  for(const token of ['/api/chass/v1/public/','/api/jra/meeting','/api/jra/race','/api/jra/odds','/api/jra/result','saveD1Record','prediction_json','result_json','validation_json'])assert.ok(worker.includes(token),token);
  assert.match(worker,/NAR公式/);
});
