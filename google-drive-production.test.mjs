import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {dailyArchive,driveConfigStatus,researchHash,researchOrganization,runResearchSyncQueue,syncDriveArchive,verifyDriveConnection} from '../research-storage-sync.mjs';

const env={ENABLE_DRIVE_SYNC:'true',ENABLE_AIRTABLE_INDEX:'false',GOOGLE_DRIVE_CLIENT_ID:'client',GOOGLE_DRIVE_CLIENT_SECRET:'secret-value',GOOGLE_DRIVE_REFRESH_TOKEN:'refresh-value',GOOGLE_DRIVE_ROOT_FOLDER_ID:'root-id'};
const jraRow={race_id:'jra-1',model_version:'10.0.1',race_json:JSON.stringify({raceName:'札幌テスト',surface:'芝',distance:2000,trackCondition:'良'}),prediction_json:JSON.stringify({modelVersion:'10.0.1',horses:[{horseNo:1,win:20}]}),result_json:null,validation_json:null,organization:'JRA',race_date:'2026-09-07',track:'札幌',race_no:1};
const narRow={...jraRow,race_id:'nar-1',race_json:JSON.stringify({raceName:'川崎テスト',surface:'ダート',distance:1400}),organization:'NAR',track:'川崎',race_no:9};

function archiveDb(rows,{manifest=null}={}){
  const state={manifest,calls:[]};
  return {state,prepare(sql){return {args:[],bind(...args){this.args=args;return this},async all(){state.calls.push({sql,args:this.args});if(sql.includes('JOIN research_sync_queue'))return {results:rows.filter(row=>row.organization===this.args[0]&&row.race_date===this.args[1])};return {results:[]}},async first(){state.calls.push({sql,args:this.args});if(sql.includes('research_archive_manifest'))return state.manifest;return null},async run(){state.calls.push({sql,args:this.args});if(sql.includes('INSERT INTO research_archive_manifest'))state.manifest={drive_file_id:this.args[3],content_hash:this.args[4]};return {meta:{changes:1}}}}}};
}

function driveFetch(log,{tokenOk=true,rootWritable=true}={}){let folder=0;return async(url,init={})=>{log.push({url:String(url),method:init.method||'GET',body:String(init.body||'')});if(String(url).includes('oauth2.googleapis.com'))return {ok:tokenOk,status:tokenOk?200:400,json:async()=>tokenOk?{access_token:'temporary-access'}:{error:'invalid_grant'}};if(String(url).includes('/files/root-id?'))return {ok:true,status:200,json:async()=>({id:'root-id',mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:rootWritable}})};if(String(url).includes('/files?q='))return {ok:true,status:200,json:async()=>({files:[{id:`folder-${++folder}`} ]})};if(String(url).includes('/upload/drive/v3/files'))return {ok:true,status:200,json:async()=>({id:'daily-file-id'})};throw new Error(`unexpected ${url}`)}
}

test('Drive flag OFF performs zero external I/O',async()=>{
  let calls=0;const result=await runResearchSyncQueue(null,{ENABLE_DRIVE_SYNC:'false'},{fetcher:async()=>{calls++;throw new Error('must not run')}});
  assert.equal(calls,0);assert.equal(result.reason,'disabled');
});

test('incomplete Drive config is diagnosed without acquiring a queue job',async()=>{
  let prepared=0;const DB={prepare(){prepared++;throw new Error('D1 must not be touched')}};
  const result=await runResearchSyncQueue(DB,{ENABLE_DRIVE_SYNC:'true'});
  assert.equal(result.reason,'DRIVE_CONFIG_INCOMPLETE');assert.equal(prepared,0);assert.equal(driveConfigStatus({ENABLE_DRIVE_SYNC:'true'}).complete,false);
});

test('unknown organization is not silently routed to NAR',()=>{
  assert.equal(researchOrganization({race:{date:'2026-09-07',track:'未知場'}},'unknown'),null);
});

test('JRA daily archive contains only JRA races and required schema',async()=>{
  const archive=await dailyArchive(archiveDb([jraRow,narRow]),'JRA','2026-09-07',{now:new Date('2026-09-07T00:00:00Z')});
  assert.equal(archive.organization,'JRA');assert.equal(archive.archiveDate,'2026-09-07');assert.deepEqual(archive.races.map(x=>x.track),['札幌']);assert.equal(archive.races[0].canonicalResearchKey,'20260907_JRA_札幌_1');
});

test('NAR daily archive contains only NAR races',async()=>{
  const archive=await dailyArchive(archiveDb([jraRow,narRow]),'NAR','2026-09-07');
  assert.deepEqual(archive.races.map(x=>x.track),['川崎']);assert.equal(archive.races[0].predictionSource,'CHASS_APP');
});

test('same contentHash skips OAuth and Drive upload',async()=>{
  const DB=archiveDb([jraRow]),archive=await dailyArchive(DB,'JRA','2026-09-07'),hash=researchHash(archive.races);DB.state.manifest={drive_file_id:'existing',content_hash:hash};let fetches=0;
  const result=await syncDriveArchive(DB,env,{organization:'JRA',race_date:'2026-09-07'},{fetcher:async()=>{fetches++;throw new Error('must not fetch')}});
  assert.equal(result.uploadType,'SKIP');assert.equal(fetches,0);
});

test('new JRA archive uses JRA Daily year month path and CREATE',async()=>{
  const DB=archiveDb([jraRow]),log=[],result=await syncDriveArchive(DB,env,{organization:'JRA',race_date:'2026-09-07'},{fetcher:driveFetch(log)});
  assert.equal(result.uploadType,'CREATE');const queries=log.filter(x=>x.url.includes('/files?q=')).map(x=>decodeURIComponent(x.url));for(const name of ["name='JRA'","name='Daily'","name='2026'","name='09'"])assert.ok(queries.some(x=>x.includes(name)));assert.ok(log.some(x=>x.body.includes('2026-09-07-research.json')));
});

test('existing driveFileId uses PATCH UPDATE instead of creating another file',async()=>{
  const DB=archiveDb([narRow],{manifest:{drive_file_id:'existing-file',content_hash:'old'}}),log=[],result=await syncDriveArchive(DB,env,{organization:'NAR',race_date:'2026-09-07'},{fetcher:driveFetch(log)});
  assert.equal(result.uploadType,'UPDATE');assert.ok(log.some(x=>x.method==='PATCH'&&x.url.includes('/existing-file')));assert.equal(log.filter(x=>x.method==='POST'&&x.url.includes('/upload/drive/v3/files')).length,0);
});

test('Prediction remains byte-identical when Result and Validation are added',async()=>{
  const before=await dailyArchive(archiveDb([jraRow]),'JRA','2026-09-07'),updated={...jraRow,result_json:JSON.stringify({finishOrder:[1,2,3]}),validation_json:JSON.stringify({checks:['ok']})},after=await dailyArchive(archiveDb([updated]),'JRA','2026-09-07');
  assert.equal(JSON.stringify(before.races[0].predictionSnapshot),JSON.stringify(after.races[0].predictionSnapshot));assert.ok(after.races[0].resultSnapshot);assert.ok(after.races[0].validationSnapshot);
});

test('invalid refresh token is classified without exposing Google response',async()=>{
  const result=await verifyDriveConnection(env,{fetcher:driveFetch([],{tokenOk:false})});assert.equal(result.ok,false);assert.equal(result.errorCode,'DRIVE_TOKEN_REFRESH_FAILED');assert.equal(JSON.stringify(result).includes('refresh-value'),false);
});

test('root folder permission failure is explicit and no alternate root is created',async()=>{
  const log=[],result=await verifyDriveConnection(env,{fetcher:driveFetch(log,{rootWritable:false})});assert.equal(result.errorCode,'DRIVE_PERMISSION_DENIED');assert.equal(log.filter(x=>x.method==='POST').length,1); // OAuth token only
});

test('source and internal status API never serialize configured secret values',async()=>{
  const [source,worker]=await Promise.all([readFile(new URL('../research-storage-sync.mjs',import.meta.url),'utf8'),readFile(new URL('../worker.js',import.meta.url),'utf8')]);
  assert.match(source,/DRIVE_CONFIG_INCOMPLETE/);assert.match(worker,/\/api\/db\/research-sync/);assert.match(worker,/endsWith\('\/drive-check'\)/);assert.doesNotMatch(source,/console\.(?:log|info|warn|error)\([^\n]*(?:CLIENT_SECRET|REFRESH_TOKEN|Authorization)/i);
  const diagnostic=driveConfigStatus(env);assert.equal(JSON.stringify(diagnostic).includes('secret-value'),false);assert.equal(JSON.stringify(diagnostic).includes('refresh-value'),false);
});
