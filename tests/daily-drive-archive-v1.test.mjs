import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {archiveDailyAnalysis,buildDailyReference,verifyDailyReference,DAILY_REFERENCE_PROMPT} from '../src/prediction/daily-drive-archive-v1.mjs';
import {runDailyAnalysis,handleDailyAnalysisRequest} from '../src/prediction/daily-analysis-worker-v1.mjs';
import {createDailyRaceArtifact} from '../src/prediction/daily-analysis-v1.mjs';
import {stableSourceJson} from '../src/prediction/cpsi-source-recovery-v1.mjs';
const DATE='2026-10-23',NOW=Date.parse(DATE+'T09:00:01+09:00'),FOLDER='SYNTHETIC_OUTPUT_FOLDER',FILE='SYNTHETIC_RESERVED_FILE',TOKEN='SYNTHETIC_READER_01234567890123456789';
function input(){
 const raceId=DATE+'|浦和|1',m={organizer:'NAR',raceId,runId:'SYNTHETIC-RUN',inputSnapshotId:'INPUT',kind:'EARLY',isPreResult:true,capturedAt:DATE+'T08:00:00+09:00',authorityRef:'SYNTHETIC-INDEX'};
 return {format:'CHASS_CPSI_PRE_INPUT_V1',race:{raceDate:DATE,track:'浦和',raceNo:1,raceType:'NAR',surface:'ダート',metricInputFreeze:{runId:m.runId,inputSnapshotId:'INPUT',indexSnapshotId:'INDEX',freezeAt:DATE+'T08:30:00+09:00',postAt:DATE+'T12:00:00+09:00'}},horses:[1,2,3,4].map(horseNo=>({horseNo,canonicalHorseKey:'KEY-'+horseNo,canonicalIndex:{...m,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'INDEX',peak:90,baseline5:80,current:70,distance:60,course:60}}))};
}
function database(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec("CREATE TABLE races(id TEXT PRIMARY KEY,original_early TEXT); INSERT INTO races VALUES('KEEP','FROZEN');");
 for(const file of ['0016_daily_analysis_v1.sql','0017_daily_drive_archive_v1.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 return {sqlite,prepare(sql){return {bind(...args){const s=sqlite.prepare(sql);return {async run(){const r=s.run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}};}};}};
}
const environment=DB=>({DB,ENABLE_DAILY_ANALYSIS_V1:'true',ENABLE_DAILY_DRIVE_ARCHIVE_V1:'true',CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID:FOLDER,CHASS_DAILY_DRIVE_OAUTH_JSON:JSON.stringify({client_id:'synthetic-client',client_secret:'synthetic-secret',refresh_token:'synthetic-refresh'}),CHASS_CPSI_DRIVE_READER_TOKEN:TOKEN});
async function seed(db){await runDailyAnalysis(environment(db),{scheduledTime:NOW-1000,clock:()=>NOW,readInputs:async()=>[{root:input(),sourceRef:'synthetic-only'}]});}
function provider(options={}){
 const files=new Map(),calls=[];let generated=0,uploads=0,lost=false;
 return {files,calls,get uploads(){return uploads;},async fetch(url,init={}){
  url=String(url);calls.push({url,init});assert.equal(init.redirect,'manual');
  if(url==='https://oauth2.googleapis.com/token'){
   assert.match(init.body,/grant_type=refresh_token/);assert.ok(!init.body.includes('scope='));
   if(options.tokenRejected)return new Response('PRIVATE GOOGLE ERROR',{status:401});
   return Response.json({access_token:'SYNTHETIC_ACCESS_TOKEN',token_type:'Bearer',expires_in:3600});
  }
  assert.equal(init.headers.authorization,'Bearer SYNTHETIC_ACCESS_TOKEN');
  if(url.includes('/upload/drive/')){
   uploads++;assert.equal(init.method,'POST');
   const boundary=init.headers['content-type'].split('boundary=')[1],parts=init.body.split('--'+boundary),metadata=JSON.parse(parts[1].split('\r\n\r\n')[1].trim());
   const raw=parts[2].split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/,'');
   if(files.has(metadata.id))return new Response('',{status:409});
   files.set(metadata.id,{metadata,raw});
   if(options.loseUploadResponse&&!lost){lost=true;throw Error('PRIVATE_NETWORK_ERROR');}
   return Response.json({...metadata,mimeType:options.wrongMime?'text/html':metadata.mimeType});
  }
  if(url.includes('/generateIds?'))return Response.json({ids:[generated++?FILE+'_'+generated:FILE]});
  if(url.includes('/'+FOLDER+'?'))return Response.json({id:FOLDER,mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:!options.forbiddenFolder}});
  const found=[...files.values()].find(f=>url.includes('/'+f.metadata.id+'?'));
  if(!found)return new Response('',{status:404});
  if(url.includes('alt=media'))return options.corruptMedia?new Response('{}'):new Response(found.raw);
  return Response.json(found.metadata);
 }};
}
const opts=p=>({date:DATE,clock:()=>NOW,fetchImpl:p.fetch});
test('packet includes all four lanes and bounded Japanese prompt; deterministic hashes and recomputation reject altered result',async()=>{
 const a=await createDailyRaceArtifact({root:input(),sourceRef:'synthetic-only'},{now:NOW,date:DATE});
 const job={race_date:DATE,status:'PARTIAL',completed_at:new Date(NOW).toISOString(),summary_json:JSON.stringify({savedCount:1,issues:[]})},records=[{race_id:DATE+'|浦和|1',content_hash:a.contentHash,artifact_json:JSON.stringify(a)}];
 const packet=await buildDailyReference(job,records);await verifyDailyReference(packet);
 assert.deepEqual(packet,await buildDailyReference(job,records));assert.equal(packet.body.predictionPrompt,DAILY_REFERENCE_PROMPT);
 assert.equal(packet.body.races[0].artifact.body.result.favorite.trustProbability,undefined);
 assert.equal(packet.body.formalKpiEligible,false);assert.match(packet.body.predictionPrompt,/人気順位だけでは付けない/);
 const changed=structuredClone(packet);changed.body.races[0].artifact.body.result.status='REVIEW_COMPLETE';await assert.rejects(()=>verifyDailyReference(changed),/HASH_MISMATCH/);
 await assert.rejects(()=>buildDailyReference({...job,summary_json:JSON.stringify({savedCount:2,issues:[]})},records),/COUNT_MISMATCH/);
 await assert.rejects(()=>buildDailyReference(job,[{...records[0],content_hash:'WRONG'}]),/BINDING_INVALID/);
});
test('real SQLite batch -> OAuth create -> exact media readback -> immutable receipt -> authenticated app history',async()=>{
 const db=database();try{
  await seed(db);const p=provider(),e=environment(db),r=await archiveDailyAnalysis(e,opts(p));assert.equal(r.status,'VERIFIED');assert.equal(p.uploads,1);
  const file=p.files.get(FILE);await verifyDailyReference(JSON.parse(file.raw));assert.equal(file.raw,stableSourceJson(JSON.parse(file.raw)));
  assert.ok(!file.raw.includes('synthetic-secret'));assert.ok(!file.raw.includes('synthetic-refresh'));assert.equal(db.sqlite.prepare('SELECT original_early FROM races').get().original_early,'FROZEN');
  const again=await archiveDailyAnalysis(e,{...opts(p),fetchImpl:()=>{throw Error('must not contact provider for history');}});assert.equal(again.status,'PREVIOUSLY_VERIFIED');
  const req=new Request('https://synthetic.example/api/chass/v1/research/daily?date='+DATE,{headers:{authorization:'Bearer '+TOKEN}}),body=await (await handleDailyAnalysisRequest(req,e)).json();assert.equal(body.driveArchive.status,'PREVIOUSLY_VERIFIED');assert.equal(body.rows.length,1);assert.equal(body.summary.driveOutputSync,false);
 }finally{db.sqlite.close();}
});
test('lost upload response retries same reserved ID without creating another file or recalculating EARLY',async()=>{
 const db=database();try{await seed(db);const p=provider({loseUploadResponse:true}),e=environment(db);assert.equal((await archiveDailyAnalysis(e,opts(p))).status,'HOLD');assert.equal(p.files.size,1);assert.equal((await archiveDailyAnalysis(e,opts(p))).status,'VERIFIED');assert.equal(p.uploads,1);assert.equal(p.files.size,1);}finally{db.sqlite.close();}
});
test('concurrent archive attempts reserve one ID and converge to the same verified file',async()=>{
 const db=database();try{await seed(db);const p=provider(),e=environment(db),r=await Promise.all([archiveDailyAnalysis(e,opts(p)),archiveDailyAnalysis(e,opts(p))]);assert.ok(r.every(x=>['VERIFIED','PREVIOUSLY_VERIFIED'].includes(x.status)));assert.equal(p.files.size,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM chass_daily_drive_archives').get().n,1);}finally{db.sqlite.close();}
});
for(const [label,config,reason] of [['tampered media',{corruptMedia:true},'DAILY_ARCHIVE_READBACK_MISMATCH'],['wrong file MIME',{wrongMime:true},'DAILY_ARCHIVE_FILE_INVALID'],['folder without write permission',{forbiddenFolder:true},'DAILY_ARCHIVE_FOLDER_INVALID'],['OAuth rejection',{tokenRejected:true},'DAILY_ARCHIVE_GOOGLE_REJECTED']])test(label+' cannot become a verified receipt',async()=>{
 const db=database();try{await seed(db);const p=provider(config),r=await archiveDailyAnalysis(environment(db),opts(p));assert.equal(r.status,'HOLD');assert.equal(r.reason,reason);assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM chass_daily_drive_archives WHERE verified_at IS NOT NULL').get().n,0);assert.ok(!JSON.stringify(r).includes('PRIVATE'));}finally{db.sqlite.close();}
});
test('defaults never access storage or network; unfinished job is not uploaded; historical work is refused',async()=>{
 assert.equal((await archiveDailyAnalysis({DB:{prepare(){throw Error('touched');}}})).status,'DISABLED');
 const db=database();try{const e=environment(db),p=provider();assert.equal((await archiveDailyAnalysis(e,opts(p))).status,'NOT_READY');assert.equal(p.calls.length,0);assert.equal((await archiveDailyAnalysis(e,{...opts(p),date:'2026-10-22'})).reason,'DAILY_ARCHIVE_CONFIG_INVALID');}finally{db.sqlite.close();}
});
test('D1 content or folder change cannot silently reuse a successful receipt',async()=>{
 const db=database();try{await seed(db);const p=provider(),e=environment(db);assert.equal((await archiveDailyAnalysis(e,opts(p))).status,'VERIFIED');e.CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID='SYNTHETIC_OTHER_FOLDER';assert.equal((await archiveDailyAnalysis(e,opts(p))).reason,'DAILY_ARCHIVE_RECEIPT_CONFLICT');e.CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID=FOLDER;db.sqlite.prepare('UPDATE chass_daily_analysis_runs SET content_hash=?').run('WRONG');assert.equal((await archiveDailyAnalysis(e,opts(p))).reason,'DAILY_ARCHIVE_BINDING_INVALID');}finally{db.sqlite.close();}
});
test('corrupt stored result is rejected before OAuth, and API shows no false archive history',async()=>{
 const db=database();try{await seed(db);db.sqlite.prepare('UPDATE chass_daily_analysis_runs SET artifact_json=?').run('{}');const p=provider(),e=environment(db);assert.equal((await archiveDailyAnalysis(e,opts(p))).status,'HOLD');assert.equal(p.calls.length,0);}finally{db.sqlite.close();}
});
test('downloaded JSON verifier succeeds read-only, rejects tampering and returns a nonzero CLI exit',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'chass-daily-reference-')),db=database();
 try{
  await seed(db);const p=provider();await archiveDailyAnalysis(environment(db),opts(p));const raw=p.files.get(FILE).raw,path=join(dir,'reference.json');await writeFile(path,raw);
  const script=new URL('../scripts/verify-daily-reference-v1.mjs',import.meta.url),ok=spawnSync(process.execPath,[script.pathname,path],{encoding:'utf8'});
  assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).status,'LOCAL_REFERENCE_VERIFIED');assert.equal(await readFile(path,'utf8'),raw);
  const changed=JSON.parse(raw);changed.body.formalKpiEligible=true;await writeFile(path,JSON.stringify(changed));
  const bad=spawnSync(process.execPath,[script.pathname,path],{encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/HASH_MISMATCH/);
 }finally{db.sqlite.close();await rm(dir,{recursive:true,force:true});}
});
