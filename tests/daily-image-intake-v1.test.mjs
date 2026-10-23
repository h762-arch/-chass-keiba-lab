import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {officialRosterForOcr,compactVisionWords,parseNarIndexImage,IMAGE_LAYOUT} from '../src/prediction/nar-image-table-v1.mjs';
import {createImageResearchInput,verifyImageResearchInput,runDailyImageIntake} from '../src/prediction/daily-image-intake-v1.mjs';
import {runDailyResearchCycle} from '../src/prediction/daily-research-cycle-v1.mjs';
import {handleDailyAnalysisRequest} from '../src/prediction/daily-analysis-worker-v1.mjs';
import {sourceSha256} from '../src/prediction/cpsi-source-recovery-v1.mjs';
import {dailyReadiness} from '../src/prediction/daily-readiness-v1.mjs';
import {handleDailyRetryRequest} from '../src/prediction/daily-retry-v1.mjs';
import worker from '../worker-entry.mjs';
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',pair.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
const DATE='2026-10-23',NOW=Date.parse(DATE+'T09:00:01+09:00'),ROOT='SYNTHETIC_IMAGE_ROOT',FOLDER='SYNTHETIC_DAY_FOLDER',FILE='SYNTHETIC_IMAGE_FILE',KEY='SYNTHETIC_VISION_KEY_0123456789',TOKEN='SYNTHETIC_READER_TOKEN_01234567890123';
const race={raceDate:DATE,track:'浦和',code:'18',raceNo:1};
const retryRequest=(date=DATE,headers={})=>new Request('https://synthetic.example/api/chass/v1/research/daily/retry?date='+date,{method:'POST',headers:{origin:'https://synthetic.example',authorization:'Bearer '+TOKEN,...headers}});
function failedScheduled(d){d.sqlite.prepare('INSERT INTO chass_daily_analysis_jobs (job_id,race_date,started_at,completed_at,status,summary_json) VALUES (?,?,?,?,?,?)').run('DAILY_0900_JST:'+DATE,DATE,new Date(NOW).toISOString(),new Date(NOW).toISOString(),'HOLD',JSON.stringify({issues:[{reason:'IMAGE_DAY_FOLDER_NOT_FOUND'}]}));d.sqlite.prepare('INSERT INTO chass_daily_image_jobs (job_id,race_date,started_at,completed_at,status,report_json) VALUES (?,?,?,?,?,?)').run('IMAGE_0900_JST:'+DATE,DATE,new Date(NOW).toISOString(),new Date(NOW).toISOString(),'HOLD',JSON.stringify({issues:[{reason:'IMAGE_DAY_FOLDER_NOT_FOUND'}]}));}
const card=(no=1)=>`<h4>2026年10月23日（金） 浦和 第${no}競走 12:20発走</h4><ul><li>ダート 1300ｍ 左</li></ul>`+[1,2].map(n=>`<tr class="tBorder"><td class="horseNum">${n}</td><td><a class="horseName" href="../DataRoom/HorseMarkInfo?k_lineageLoginCode=3009440491${n}">試験${n}</a></td></tr>`).join('');
function vision(){
 const words=[],add=(text,x,y)=>words.push({text,x,y,confidence:1});
 add('10/23(金)',.1,.14);add('浦和',.26,.14);add('1R',.06,.21);
 const xs=[.038,.23,.354,.406,.46,.51,.555,.60,.65,.916,.976];
 for(const [i,t] of ['最高','5走平均','距離','コース','3走','2走','前走'].entries())add(t,xs[i+2],.48);
 for(let n=1;n<=2;n++){const y=.52+(n-1)*.03;[String(n),'試験'+n,'60',n===1?'22*':'40','未','45','-','-69','30',String(n===1?2:5),String(n)].forEach((t,i)=>add(t,xs[i],y));}
 return {responses:[{fullTextAnnotation:{pages:[{width:1000,height:2200,blocks:[{paragraphs:[{words:words.map(w=>({symbols:[...w.text].map(text=>({text})),confidence:w.confidence,boundingBox:{vertices:[{x:Math.round((w.x-.002)*1000),y:Math.round((w.y-.002)*2200)},{x:Math.round((w.x+.002)*1000),y:Math.round((w.y-.002)*2200)},{x:Math.round((w.x+.002)*1000),y:Math.round((w.y+.002)*2200)},{x:Math.round((w.x-.002)*1000),y:Math.round((w.y+.002)*2200)}]}}))}]}]}]}}]};
}
function parse(v=vision()){return parseNarIndexImage(compactVisionWords(v),{race,expectedHorses:officialRosterForOcr(card())});}
test('retry is authenticated, same-origin, today-only and never starts OCR in HTTP; duplicate queue is atomic',async()=>{
 const d=db();try{const e=env(d),opts={clock:()=>NOW};
  assert.equal((await handleDailyRetryRequest(retryRequest(DATE,{authorization:'Bearer invalid'}),e,opts)).status,401);
  assert.equal((await handleDailyRetryRequest(retryRequest(DATE,{origin:'https://other.example'}),e,opts)).status,403);
  assert.equal((await handleDailyRetryRequest(retryRequest('2026-10-22'),e,opts)).status,400);
  assert.equal((await handleDailyRetryRequest(retryRequest(),e,opts)).status,409);
  failedScheduled(d);const before=d.sqlite.prepare('SELECT * FROM chass_daily_analysis_jobs').get();
  const r=await Promise.all([handleDailyRetryRequest(retryRequest(),e,opts),handleDailyRetryRequest(retryRequest(),e,opts)]);assert.deepEqual(r.map(x=>x.status).sort(),[202,409]);
  assert.deepEqual(d.sqlite.prepare('SELECT * FROM chass_daily_analysis_jobs WHERE job_id=?').get(before.job_id),before);
  assert.equal(d.sqlite.prepare('SELECT COUNT(*) AS n FROM chass_daily_image_jobs').get().n,1);
 }finally{d.sqlite.close();}
});
test('failed 09:00 images retry through later cron with actual Freeze and separate IDs; original evidence stays byte-identical',async()=>{
 const d=db();try{const e=env(d),p=provider();failedScheduled(d);const original=JSON.stringify(d.sqlite.prepare('SELECT * FROM chass_daily_analysis_jobs').all()),image=JSON.stringify(d.sqlite.prepare('SELECT * FROM chass_daily_image_jobs').all());
  const later=NOW+10*60000,queued=await (await handleDailyRetryRequest(retryRequest(),e,{clock:()=>later})).json();assert.equal(queued.status,'QUEUED');
  let tick=later;const result=await runDailyResearchCycle(e,{clock:()=>++tick,scheduledTime:later-1000,fetchImpl:p.fetch,readInputs:async()=>{throw Error('retry must read fresh images only');}});
  assert.equal(result.analysis.jobId,queued.jobId);assert.equal(result.analysis.savedCount,1);assert.equal(p.ocrCalls,1);assert.equal(result.archive.status,'DISABLED');
  assert.equal(JSON.stringify(d.sqlite.prepare('SELECT * FROM chass_daily_analysis_jobs WHERE job_id=?').all('DAILY_0900_JST:'+DATE)),original);
  assert.equal(JSON.stringify(d.sqlite.prepare('SELECT * FROM chass_daily_image_jobs WHERE job_id=?').all('IMAGE_0900_JST:'+DATE)),image);
  const packet=JSON.parse(d.sqlite.prepare('SELECT packet_json FROM chass_daily_image_inputs WHERE job_id=?').get('IMAGE_'+queued.jobId).packet_json),start=d.sqlite.prepare('SELECT started_at FROM chass_daily_analysis_jobs WHERE job_id=?').get(queued.jobId).started_at;
  assert.ok(Date.parse(packet.body.root.race.metricInputFreeze.freezeAt)>later);assert.ok(Date.parse(start)>Date.parse(packet.body.root.race.metricInputFreeze.freezeAt));
  const data=await (await handleDailyAnalysisRequest(new Request('https://synthetic.example/api/chass/v1/research/daily?date='+DATE,{headers:{authorization:'Bearer '+TOKEN}}),e)).json();assert.equal(data.runMode,'RESEARCH_RETRY');assert.equal(data.originalScheduledStatus,'HOLD');assert.equal(data.rows.length,1);assert.equal(data.jobId,queued.jobId);
  await runDailyResearchCycle(e,{clock:()=>++tick,scheduledTime:later+300000,fetchImpl:p.fetch});assert.equal(p.ocrCalls,1);
 }finally{d.sqlite.close();}
});
test('retry failure preserves image diagnosis; next attempt has a new ID and eight-attempt limit',async()=>{
 const d=db();try{const e=env(d);failedScheduled(d);let first;
  for(let i=0;i<8;i++){
   const q=await handleDailyRetryRequest(retryRequest(),e,{clock:()=>NOW+600000+i*300000});assert.equal(q.status,202);const body=await q.json();if(first)assert.notEqual(body.jobId,first);else first=body.jobId;
   const result=await runDailyResearchCycle(e,{clock:()=>NOW+600000+i*300000,scheduledTime:NOW+599000,intake:async()=>({status:'HOLD',rows:[],issues:[{reason:'IMAGE_DAY_FOLDER_NOT_FOUND'}]})});assert.equal(result.status,'HOLD');assert.ok(result.analysis.issues.some(x=>x.reason==='IMAGE_DAY_FOLDER_NOT_FOUND'));
  }
  assert.equal((await handleDailyRetryRequest(retryRequest(),e,{clock:()=>NOW+600000})).status,409);
 }finally{d.sqlite.close();}
});
test('post-start retry holds without materializing PRE and next-day cron never backdates queued work',async()=>{
 const d=db();try{const e=env(d),p=provider();failedScheduled(d);await handleDailyRetryRequest(retryRequest(),e,{clock:()=>NOW});
  const result=await runDailyResearchCycle(e,{clock:()=>Date.parse(DATE+'T13:00:00+09:00'),scheduledTime:NOW+600000,fetchImpl:p.fetch});assert.equal(result.analysis.savedCount,0);assert.equal(result.status,'HOLD');
  await handleDailyRetryRequest(retryRequest(),e,{clock:()=>NOW});
  const next=await runDailyResearchCycle(e,{clock:()=>NOW+86400000,scheduledTime:NOW+86400000+600000,fetchImpl:()=>{throw Error('must not fetch');}});assert.equal(next.status,'NOT_DUE');
  const route=await worker.fetch(retryRequest(),{...e,ENABLE_DAILY_IMAGE_INTAKE_V1:'false'},{});assert.equal(route.status,503);
 }finally{d.sqlite.close();}
});
test('fixed-layout OCR preserves all seven raw cells, missing symbols, negative values, holds starred baseline and binds names',()=>{
 const out=parse();assert.equal(out.observation.horses[0].baseline5,null);assert.equal(out.observation.horses[1].baseline5,40);assert.equal(out.rawRows[0].indices.baseline5,'22*');assert.equal(out.rawRows[0].indices.previous2,'-69');assert.equal(out.observation.horses[0].distance,null);assert.equal(out.observation.horses[0].current,null);assert.equal(out.predictedMarket[0].popularity,1);
});
for(const [label,mutate,reason] of [
 ['low confidence',c=>c.words.find(w=>w.text==='60').confidence=.8,'IMAGE_CELL_MISSING_OR_LOW_CONFIDENCE'],
 ['wrong horse',c=>c.words.find(w=>w.text==='試験1').text='別馬','IMAGE_HORSE_NAME_MISMATCH'],
 ['unknown symbol',c=>c.words.find(w=>w.text==='22*').text='22?','IMAGE_INDEX_SYMBOL_UNRESOLVED'],
 ['wrong column',c=>c.words.find(w=>w.text==='最高').text='最低','IMAGE_COLUMN_HEADER_MISMATCH'],
 ['wrong date',c=>c.words.find(w=>w.text==='10/23(金)').text='10/22(木)','IMAGE_RACE_LABEL_MISMATCH'],
 ['wrong odds order',c=>c.words.find(w=>w.x>.88&&w.x<.94&&w.text==='5').text='1.1','IMAGE_PREDICTED_MARKET_INVALID'],
 ['missing runner',c=>c.words=c.words.filter(w=>!(w.x<.065&&w.y>.54)),'IMAGE_RUNNER_COVERAGE_OR_CONFIDENCE']
])test(label+' holds instead of guessing',()=>{const c=compactVisionWords(vision());mutate(c);assert.throws(()=>parseNarIndexImage(c,{race,expectedHorses:officialRosterForOcr(card())}),new RegExp(reason));});
test('unsupported geometry and provider errors never fall back to guessed table cells',()=>{const v=vision();v.responses[0].fullTextAnnotation.pages[0].width=200;assert.throws(()=>compactVisionWords(v),/LAYOUT_UNSUPPORTED/);assert.throws(()=>compactVisionWords({responses:[{error:{message:'PRIVATE'}}]}),/OCR_PROVIDER_REJECTED/);});
test('new Producer input binds official IDs and predicted market; recomputing outer hash cannot replace a horse or insert real odds',async()=>{
 const ocrRaw=JSON.stringify(vision()),imageInfo={metadata:{id:FILE,version:'1',modifiedTime:new Date(NOW-60000).toISOString()},imageHash:'sha256:'+'a'.repeat(64)};
 const p=await createImageResearchInput({parsed:parse(),rawCard:card(),ocrRaw,imageInfo,clock:()=>NOW});await verifyImageResearchInput(p,{now:NOW});
 assert.equal(p.body.root.horses[0].canonicalHorseKey,'NAR_LINEAGE:30094404911');assert.equal(p.body.root.race.originalEarlyMarket.sourceClass,'PREDICTED_ODDS');assert.equal(p.body.formalKpiEligible,false);
 const bad=structuredClone(p);bad.body.root.race.originalEarlyMarket.sourceClass='REAL_PRE_ODDS';bad.contentHash=await sourceSha256(bad.body);await assert.rejects(()=>verifyImageResearchInput(bad,{now:NOW}),/BINDING_INVALID/);
});
function db(){const sqlite=new DatabaseSync(':memory:');for(const f of ['0016_daily_analysis_v1.sql','0017_daily_drive_archive_v1.sql','0018_daily_image_intake_v1.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+f,import.meta.url),'utf8'));return {sqlite,prepare(sql){return {bind(...a){const q=sqlite.prepare(sql);return {async run(){return {meta:{changes:Number(q.run(...a).changes)}};},async first(){return q.get(...a)||null;},async all(){return {results:q.all(...a)};}};}};}};}
function env(DB){return {DB,ENABLE_DAILY_ANALYSIS_V1:'true',ENABLE_DAILY_IMAGE_INTAKE_V1:'true',ENABLE_CPSI_DRIVE_READ:'true',CHASS_DAILY_IMAGE_ROOT_FOLDER_ID:ROOT,CHASS_DAILY_VISION_API_KEY:KEY,CHASS_CPSI_DRIVE_READER_TOKEN:TOKEN,CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON:JSON.stringify({type:'service_account',client_email:'synthetic@synthetic.iam.gserviceaccount.com',private_key:pem})};}
function provider(options={}){
 let ocrCalls=0,metadataCalls=0;const calls=[],png=new Uint8Array(32);png.set([137,80,78,71,13,10,26,10]);const view=new DataView(png.buffer);view.setUint32(16,1000);view.setUint32(20,2200);
 const meta={id:FILE,name:DATE+'_浦和_01R_タイム指数.png',mimeType:'image/png',size:'32',version:'1',modifiedTime:new Date(NOW-60000).toISOString(),parents:[FOLDER]};
 return {calls,get ocrCalls(){return ocrCalls;},async fetch(url,init={}){
  calls.push({url,init});assert.equal(init.redirect,'manual');
  if(url==='https://oauth2.googleapis.com/token'){const jwt=new URLSearchParams(init.body).get('assertion').split('.')[1],grant=JSON.parse(Buffer.from(jwt,'base64url'));assert.equal(grant.scope,'https://www.googleapis.com/auth/drive.readonly');return Response.json({access_token:'SYNTHETIC_GOOGLE_TOKEN',token_type:'Bearer',expires_in:3600});}
  if(url.startsWith('https://vision.googleapis.com/')){ocrCalls++;assert.equal(init.headers['x-goog-api-key'],KEY);if(options.ocrFail)return new Response('PRIVATE',{status:403});return Response.json(vision());}
  if(url.startsWith('https://www.keiba.go.jp/')){
   assert.equal(init.headers.authorization,undefined);if(url.includes('RaceList'))return new Response(`<h2>2026年10月23日 浦和競馬 当日メニュー</h2><a href="?k_raceNo=1&">1R</a>${options.missingSecond?'<a href="?k_raceNo=2&">2R</a>':''}`);
   assert.ok(url.includes('/DebaTable?'));return new Response(card());
  }
  assert.equal(init.headers.authorization,'Bearer SYNTHETIC_GOOGLE_TOKEN');assert.equal(init.method,'GET');
  if(url.includes('alt=media'))return new Response(png);
  if(url.includes('/'+FILE+'?')){metadataCalls++;return Response.json({...meta,version:options.changed&&metadataCalls>1?'2':'1'});}
  const q=new URL(url).searchParams.get('q');
  if(q?.includes(ROOT))return Response.json({files:[{id:FOLDER,name:'NAR_指数画像_'+DATE+'_浦和'}]});
  if(q?.includes(FOLDER))return Response.json({files:options.duplicate?[meta,meta]:[meta]});
  throw Error('unexpected request');
 }};
}
test('actual SQLite image capture -> real Producer -> daily CPSI/Wave computation -> authenticated app replay, no market relabelling',async()=>{
 const d=db();try{
  const e=env(d),p=provider(),result=await runDailyResearchCycle(e,{clock:()=>NOW,scheduledTime:NOW-1000,fetchImpl:p.fetch,readInputs:async()=>[]});
  assert.equal(result.intake.status,'INPUTS_READY');assert.equal(result.analysis.savedCount,1);assert.equal(p.ocrCalls,1);assert.equal(result.archive.status,'DISABLED');
  const body=await (await handleDailyAnalysisRequest(new Request('https://synthetic.example/api/chass/v1/research/daily?date='+DATE,{headers:{authorization:'Bearer '+TOKEN}}),e)).json();
  assert.equal(body.rows.length,1);assert.equal(body.summary.imageOcrConnected,true);assert.equal(body.summary.allScheduledRacesConfirmed,false);assert.equal(body.rows[0].result.longshots.sourceClass,'PREDICTED_ODDS');assert.equal(body.rows[0].result.cpsi.cpsi.numericMaterializedCount,1);
  const retry=await runDailyResearchCycle(e,{clock:()=>NOW,scheduledTime:NOW-1000,fetchImpl:p.fetch,readInputs:async()=>[]});assert.equal(retry.analysis.status,'ALREADY_CLAIMED');assert.equal(p.ocrCalls,1);
 }finally{d.sqlite.close();}
});
for(const [label,settings,reason] of [['duplicate image',{duplicate:true},'IMAGE_RACE_FILE_MISSING_OR_DUPLICATE'],['changed image',{changed:true},'IMAGE_CHANGED_DURING_READ'],['OCR rejected',{ocrFail:true},'IMAGE_PROVIDER_READ_FAILED']])test(label+' produces explicit per-race HOLD without fake success',async()=>{
 const d=db();try{const p=provider(settings),r=await runDailyImageIntake(env(d),{date:DATE,clock:()=>NOW,fetchImpl:p.fetch});assert.equal(r.status,'HOLD');assert.equal(r.rows.length,0);assert.equal(r.issues[0].reason,reason);assert.ok(!JSON.stringify(r).includes('PRIVATE'));}finally{d.sqlite.close();}
});
test('official race without an image remains missing while available race is preserved',async()=>{const d=db();try{const p=provider({missingSecond:true}),r=await runDailyImageIntake(env(d),{date:DATE,clock:()=>NOW,fetchImpl:p.fetch});assert.equal(r.status,'PARTIAL');assert.equal(r.expectedRaceCount,2);assert.equal(r.rows.length,1);assert.equal(r.issues[0].raceId,DATE+'|浦和|2');}finally{d.sqlite.close();}});
test('no opt-in or non-09 cron never invokes OCR; existing archive retry is independent',async()=>{assert.equal((await runDailyImageIntake({})).status,'DISABLED');let calls=0;const out=await runDailyResearchCycle({ENABLE_DAILY_ANALYSIS_V1:'true',ENABLE_DAILY_IMAGE_INTAKE_V1:'true'},{clock:()=>NOW,scheduledTime:NOW+5*60000,intake:async()=>{throw Error('must not run');},archive:async()=>{calls++;return {status:'DISABLED'};}});assert.equal(out.status,'NOT_DUE');assert.equal(calls,1);});
test('concurrent cycles cannot let an empty second intake claim the daily analysis first',async()=>{
 const d=db();try{const e=env(d),p=provider(),r=await Promise.all([runDailyResearchCycle(e,{clock:()=>NOW,scheduledTime:NOW-1000,fetchImpl:p.fetch,readInputs:async()=>[]}),runDailyResearchCycle(e,{clock:()=>NOW,scheduledTime:NOW-1000,fetchImpl:p.fetch,readInputs:async()=>[]})]);assert.equal(r.filter(x=>x.status==='WAITING_FOR_IMAGE_INTAKE').length,1);assert.equal(r.find(x=>x.analysis?.savedCount)?.analysis.savedCount,1);assert.equal(p.ocrCalls,1);}finally{d.sqlite.close();}
});
test('real acquisition times advance after nominal 09:00; analysis starts after input Freeze without backdating',async()=>{
 const d=db();try{const e=env(d),p=provider();let tick=NOW;const r=await runDailyResearchCycle(e,{clock:()=>{tick+=100;return tick;},scheduledTime:NOW-1000,fetchImpl:p.fetch,readInputs:async()=>[]});assert.equal(r.analysis.savedCount,1);const packet=JSON.parse(d.sqlite.prepare('SELECT packet_json FROM chass_daily_image_inputs').get().packet_json),job=d.sqlite.prepare('SELECT started_at FROM chass_daily_analysis_jobs').get(),freeze=Date.parse(packet.body.root.race.metricInputFreeze.freezeAt);assert.ok(freeze>NOW);assert.ok(Date.parse(job.started_at)>freeze);}finally{d.sqlite.close();}
});
test('readiness never returns secrets or calls providers, and authenticated setup stays available with daily processing OFF',async()=>{
 const d=db();try{const e=env(d),r=await dailyReadiness(e);assert.equal(r.status,'SETUP_REQUIRED');assert.ok(r.missing.some(c=>c.key==='CHASS_DAILY_DRIVE_OAUTH_JSON'));assert.ok(!JSON.stringify(r).includes(KEY));assert.ok(!JSON.stringify(r).includes('PRIVATE KEY'));e.ENABLE_DAILY_ANALYSIS_V1='false';const url='https://synthetic.example/api/chass/v1/research/daily/setup';assert.equal((await handleDailyAnalysisRequest(new Request(url),e)).status,401);const req=new Request(url,{headers:{authorization:'Bearer '+TOKEN}}),res=await handleDailyAnalysisRequest(req,e);assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.equal((await res.json()).credentialConnectivityVerified,false);req.headers.set('origin','https://other.example');assert.equal((await handleDailyAnalysisRequest(req,e)).status,401);}finally{d.sqlite.close();}
});
test('whole intake aborts an uncooperative OAuth fetch without later source reads or partial output',async()=>{
 const d=db();try{let calls=0;const r=await runDailyImageIntake(env(d),{date:DATE,clock:()=>NOW,timeoutMs:20,fetchImpl:()=>{calls++;return new Promise(()=>{});}});assert.equal(r.status,'HOLD');assert.equal(r.issues[0].reason,'IMAGE_JOB_TIMEOUT');assert.equal(r.rows.length,0);assert.equal(calls,1);assert.equal(d.sqlite.prepare('SELECT status FROM chass_daily_image_jobs').get().status,'HOLD');}finally{d.sqlite.close();}
});
test('whole intake also bounds an OAuth response whose body never completes',async()=>{
 const d=db();try{const r=await runDailyImageIntake(env(d),{date:DATE,clock:()=>NOW,timeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))});assert.equal(r.status,'HOLD');assert.equal(r.issues[0].reason,'IMAGE_JOB_TIMEOUT');assert.equal(r.rows.length,0);}finally{d.sqlite.close();}
});
