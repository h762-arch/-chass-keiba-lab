import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile,readdir} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
const runtimeFiles=[
  'worker.js',
  'worker-entry.mjs',
  'wrangler.jsonc',
  'src/research/research-storage-sync.mjs',
  '.github/workflows/CHASS-JRA-Health-Smoke-v1.0.yml'
];
const removedFiles=[
  'google-drive-readonly-api.mjs',
  'google-drive-readonly-import.mjs',
  'jra-drive-prediction-input.mjs',
  '.github/workflows/CHASS-JRA-D1-Retention-v1.0.yml'
];
const forbidden=[
  'oauth2.googleapis.com',
  'sheets.googleapis.com',
  'GOOGLE_DRIVE_READ_SERVICE_ACCOUNT_JSON',
  'ENABLE_DRIVE_READ_IMPORT',
  'CHASS_DRIVE_SPREADSHEET_ID',
  '/api/drive-read/health',
  '/api/chass/v1/drive',
  'handleDriveReadHealth',
  'handleDriveReadBridge',
  'google-drive-readonly-api.mjs',
  'google-drive-readonly-import.mjs'
];

async function text(path){return readFile(new URL(path,root),'utf8')}

test('production Worker and active runtime configuration contain no Google API runtime',async()=>{
  const sources=await Promise.all(runtimeFiles.map(async path=>[path,await text(path)]));
  for(const [path,source] of sources){
    for(const token of forbidden)assert.equal(source.includes(token),false,`${path}: ${token}`);
  }
});

test('Drive and Sheets runtime modules and reactivation workflow are absent',async()=>{
  for(const path of removedFiles){
    await assert.rejects(access(new URL(path,root)),undefined,path);
  }
});

test('active workflows cannot authenticate to Google APIs',async()=>{
  const workflowDir=new URL('.github/workflows/',root);
  const names=(await readdir(workflowDir)).filter(name=>/\.ya?ml$/i.test(name));
  for(const name of names){
    const source=await readFile(new URL(name,workflowDir),'utf8');
    for(const token of forbidden.slice(0,5))assert.equal(source.includes(token),false,`${name}: ${token}`);
  }
});

test('official JRA route and non-Drive AI Data Bridge routes remain wired',async()=>{
  const worker=await text('worker.js');
  assert.match(worker,/handleJraRaceRequest[^\n]+\.\/jra-race-fetch\.mjs/);
  for(const route of [
    '/api/jra/race',
    '/api/chass/v1/health',
    '/api/chass/v1/context',
    '/api/chass/v1/race',
    '/api/chass/v1/research',
    '/api/chass/v1/pending'
  ])assert.ok(worker.includes(route),route);
});

test('legacy D1 compatibility remains disabled without Google API I/O',async()=>{
  const source=await text('src/research/research-storage-sync.mjs');
  assert.match(source,/disabled_legacy/);
  assert.doesNotMatch(source,/oauth2\.googleapis\.com|sheets\.googleapis\.com|googleapis\.com\/drive/i);
});
