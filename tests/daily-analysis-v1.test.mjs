import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {analyzeDailyRace,createDailyRaceArtifact,verifyDailyRaceArtifact} from '../src/prediction/daily-analysis-v1.mjs';
import {projectAndCalculateCpsiShadow} from '../src/prediction/chass-cpsi-wave-core-v1.mjs';
import {sourceSha256,createSourceArtifact} from '../src/prediction/cpsi-source-recovery-v1.mjs';
import {runDailyAnalysis,handleDailyAnalysisRequest,dailyScheduleDue} from '../src/prediction/daily-analysis-worker-v1.mjs';
const DATE='2026-10-23',NOW=Date.parse(DATE+'T09:00:01+09:00'),AT=DATE+'T08:57:00+09:00',CUT=DATE+'T08:58:00+09:00',POST=DATE+'T12:00:00+09:00',TOKEN='SYNTHETIC_DAILY_READER_0123456789012345';
const copy=x=>structuredClone(x);
function fixture(no=1){
 const id=`${DATE}|浦和|${no}`,meta={organizer:'NAR',raceId:id,runId:'SYNTHETIC-RUN-'+no,inputSnapshotId:'INPUT-'+no,kind:'EARLY',isPreResult:true,capturedAt:AT,authorityRef:'INDEX'};
 const root={format:'CHASS_CPSI_PRE_INPUT_V1',race:{raceDate:DATE,track:'浦和',raceNo:no,raceType:'NAR',surface:'ダート',waveEligibility:'NAR_FLAT',metricInputFreeze:{runId:meta.runId,inputSnapshotId:meta.inputSnapshotId,indexSnapshotId:'INDEX-'+no,marketSnapshotId:'MARKET-'+no,freezeAt:CUT,postAt:POST},originalEarlyMarket:{...meta,snapshotId:'MARKET-'+no,sourceRef:'synthetic-market',authorityRef:'MARKET',sourceClass:'REAL_PRE_ODDS',horses:Array.from({length:9},(_,i)=>({horseNo:i+1,popularity:i+1,odds:i+2}))},waveEvidence:{...meta,snapshotId:'EV',indexSnapshotId:'INDEX-'+no,marketSnapshotId:'MARKET-'+no,indexAuthorityRef:'INDEX',favoriteHighestIndexRank:1,multiClusterCount:0,clusterAuthorityRef:'CL',marketGapCount:0,marketGapAuthorityRef:'MG'}},horses:Array.from({length:9},(_,i)=>({horseNo:i+1,horseName:'馬'+(i+1),canonicalHorseKey:'KEY-'+(i+1),canonicalIndex:{...meta,sourceClass:'CANONICAL_INDEX_PRE',sourceSnapshotId:'INDEX-'+no,peak:100-i,baseline5:90-i,current:80-i,distance:70-i,course:60-i}}))};
 const c=projectAndCalculateCpsiShadow({race:root.race,horses:root.horses,organization:'NAR',raceId:id},{now:NOW}).cpsi.rows[0];
 root.dailyEvidence={context:{raceId:id,runId:meta.runId,inputSnapshotId:meta.inputSnapshotId,marketSnapshotId:'MARKET-'+no,capturedAt:AT,sourceRef:'synthetic-evidence'},favorite:{raceId:id,circuit:'NAR',favoriteHorseNo:1,earlyPopularity:1,earlySnapshotId:'MARKET-'+no,earlyFrozen:true,originalFormalMark:'',recentStarts:7,cpsi:{value:c.cpsiMainCompat,rank:c.rank,eligibleHorses:9,coreUsable:c.coreUsableCount,neutralizedWeightPct:c.neutralizedWeightPct,authority:'RECONSTRUCTED_SHADOW',preResult:true,marketBlind:true},negatives:[],directNegatives:[],challengers:[],survivalScenarios:[],collapseScenarios:[],rescueRebuttalScenarios:[],scenarioStatus:{BASE:'PRE_FROZEN',FAVORITE_FRIENDLY:'PRE_FROZEN',FAVORITE_HOSTILE:'PRE_FROZEN'},paceStressInBase:false,wideFieldRoute:false,hasResult:false,hasLateMarket:false,evidenceContext:{raceId:id,circuit:'NAR',earlySnapshotId:'MARKET-'+no,runId:meta.runId,inputFreezeId:meta.inputSnapshotId,sourceId:'SYNTHETIC',sourceAt:new Date(AT).toISOString(),freezeAt:new Date(CUT).toISOString(),scheduledStartAt:new Date(POST).toISOString(),population:'FLAT',runners:root.horses.map(h=>({horseNo:h.horseNo,horseKey:h.canonicalHorseKey}))}},longshots:[6,7,8,9].map(n=>({horseNo:n,horseKey:'KEY-'+n,winScenario:'Synthetic pre-race lead-survival route '+n,supportRefs:['CPSI','POSITION']}))};
 for(const e of root.dailyEvidence.longshots){e.abilitySupport={horseKey:e.horseKey,indexSnapshotId:'INDEX-'+no,explanation:'Synthetic index-backed condition route, not an empirical claim'};e.strongSupportRefs=['CPSI','POSITION'];}
 return root;
}
const analyze=root=>analyzeDailyRace(JSON.stringify(root),{now:NOW,date:DATE});
test('all four research lanes run, cover popularity 6 onward, preserve input and never invent trust probability',()=>{
 const root=fixture(),before=JSON.stringify(root),out=analyze(root);
 assert.equal(out.status,'REVIEW_COMPLETE');assert.equal(out.cpsi.cpsi.numericMaterializedCount,9);
 assert.equal(out.favorite.status,'SHADOW_REVIEW');assert.equal(out.favorite.trustProbability,null);
 assert.deepEqual(out.longshots.rows.map(h=>h.horseNo),[6,7,8,9]);
 assert.equal(out.longshots.rows[0].diamondCandidate,'💎💎');assert.equal(out.longshots.rows[3].diamondCandidate,'💎💎💎');
 assert.equal(out.wave.status,'ANALYSIS_TERMINAL');assert.equal(JSON.stringify(root),before);assert.equal(out.originalEarlyMutation,false);
});
test('missing market does not stop market-blind CPSI; popularity scope and favorite stay held',()=>{
 const root=fixture();delete root.race.originalEarlyMarket;const out=analyze(root);
 assert.equal(out.cpsi.cpsi.numericMaterializedCount,9);assert.equal(out.favorite.status,'HOLD');assert.equal(out.longshots.rows.length,9);assert.ok(out.longshots.rows.every(h=>h.popularity===null&&h.diamondCandidate===null));
});
for(const [name,mutate] of [['wrong Run',r=>r.race.originalEarlyMarket.runId='OTHER'],['late market',r=>r.race.originalEarlyMarket.capturedAt=DATE+'T09:30:00+09:00'],['bad roster',r=>r.race.originalEarlyMarket.horses.pop()],['result field',r=>r.race.originalEarlyMarket.finalOdds=1.2],['duplicate popularity',r=>r.race.originalEarlyMarket.horses[8].popularity=1]])test(`invalid ${name} cannot define favorite or longshot scope`,()=>{const r=fixture();mutate(r);const out=analyze(r);assert.equal(out.favorite.status,'HOLD');assert.equal(out.longshots.reason,'POPULARITY_SCOPE_UNCONFIRMED');assert.ok(out.cpsi.cpsi);});
test('predicted odds are explicitly labelled and never called actual market',()=>{const r=fixture();r.race.originalEarlyMarket.sourceClass='PREDICTED_ODDS';const out=analyze(r);assert.equal(out.favorite.sourceClass,'PREDICTED_ODDS');assert.equal(out.longshots.sourceClass,'PREDICTED_ODDS');});
test('every horse ranked 6 or lower remains listed when scenario evidence is missing',()=>{const r=fixture();r.dailyEvidence.longshots=[];const out=analyze(r);assert.equal(out.longshots.rows.length,4);assert.ok(out.longshots.rows.every(h=>h.status==='HOLD'&&h.diamondCandidate===null));});
test('numeric CPSI alone is not ability support, and two weak references cannot yield three diamonds',()=>{const r=fixture();delete r.dailyEvidence.longshots[0].abilitySupport;delete r.dailyEvidence.longshots[3].strongSupportRefs;const out=analyze(r);assert.equal(out.longshots.rows[0].diamondCandidate,null);assert.equal(out.longshots.rows[3].diamondCandidate,'💎💎');});
test('place scenario requires EV support; popularity alone never awards a diamond',()=>{const r=fixture();for(const e of r.dailyEvidence.longshots){delete e.winScenario;e.placeScenario='Synthetic 2-3 place route';}assert.ok(analyze(r).longshots.rows.every(h=>h.diamondCandidate===null));r.dailyEvidence.longshots[0].evSupported=true;r.dailyEvidence.longshots[0].evSourceRef='SYNTHETIC-EV';assert.equal(analyze(r).longshots.rows[0].diamondCandidate,'💎');});
test('mismatched evidence context, duplicate horses and arbitrary CPSI cannot be reused',()=>{
 const r=fixture();r.dailyEvidence.context.runId='OTHER';assert.equal(analyze(r).favorite.status,'HOLD');
 const s=fixture();s.dailyEvidence.favorite.cpsi.value=99.9;assert.equal(analyze(s).favorite.reason,'FAVORITE_CPSI_OR_ROSTER_MISMATCH');
 const t=fixture();t.dailyEvidence.longshots.push(copy(t.dailyEvidence.longshots[0]));assert.equal(analyze(t).longshots.rows[0].diamondCandidate,null);
});
test('POST/result source is held in all four lanes',()=>{const r=fixture();r.result={finishOrder:[1,2,3]};const out=analyze(r);assert.equal(out.status,'HOLD');assert.equal(out.cpsi.cpsi,null);assert.equal(out.longshots.status,'HOLD');});
test('daily artifact independently recomputes and rejects sealed but changed result',async()=>{
 const a=await createDailyRaceArtifact({root:fixture(),sourceRef:'synthetic'},{now:NOW,date:DATE});await verifyDailyRaceArtifact(a);
 const bad=copy(a);bad.body.result.longshots.rows[0].diamondCandidate='💎💎💎';bad.contentHash=await sourceSha256(bad.body);await assert.rejects(()=>verifyDailyRaceArtifact(bad),/RECOMPUTE/);
});
test('verified source cannot attest a different full root',async()=>{const root=fixture(),artifact=await createSourceArtifact(root,{now:NOW});root.horses[0].canonicalIndex.peak--;await assert.rejects(()=>createDailyRaceArtifact({root,artifact,sourceRef:'synthetic'},{now:NOW,date:DATE}),/MISMATCH/);});
function database({corruptReadback=false}={}){
 const jobs=new Map(),runs=new Map();return {jobs,runs,prepare(sql){let args;return {bind(...values){args=values;return this;},async run(){
  if(sql.startsWith('INSERT OR IGNORE')){const [id,date,started,status]=args;if(jobs.has(id))return {meta:{changes:0}};jobs.set(id,{race_date:date,started_at:started,status});}
  else if(sql.startsWith('INSERT INTO chass_daily_analysis_runs')){const [job,race,hash,raw]=args;const key=job+race;if(runs.has(key))throw Error('duplicate');runs.set(key,{job_id:job,race_id:race,content_hash:hash,artifact_json:raw});}
  else if(sql.startsWith('UPDATE chass_daily_analysis_jobs')){const [completed,status,summary,id,expected]=args;const j=jobs.get(id);if(j?.status===expected)Object.assign(j,{completed_at:completed,status,summary_json:summary});}
  else throw Error('unexpected SQL mutation');return {meta:{changes:1}};
 },async first(){if(sql.includes('FROM chass_daily_analysis_runs')){const r=runs.get(args[0]+args[1]);return corruptReadback?{artifact_json:'{}'}:r;}return jobs.get(args[0])||null;},async all(){return {results:[...runs.values()].filter(r=>r.job_id===args[0])};}};}};
}
const env=db=>({DB:db,ENABLE_DAILY_ANALYSIS_V1:'true',CHASS_CPSI_DRIVE_READER_TOKEN:TOKEN});
const options=roots=>({clock:()=>NOW,scheduledTime:Date.parse(DATE+'T09:00:00+09:00'),readInputs:async()=>roots.map(root=>({root,sourceRef:'synthetic'}))});
const request=(auth='Bearer '+TOKEN)=>new Request('https://synthetic.example'+ '/api/chass/v1/research/daily?date='+DATE,{headers:{authorization:auth}});
test('migration is additive, enforces one job/race record, and leaves Original EARLY rows intact',()=>{
 const db=new DatabaseSync(':memory:');
 try{db.exec("CREATE TABLE races (id TEXT PRIMARY KEY, original_early TEXT); INSERT INTO races VALUES ('KEEP','FROZEN');");db.exec(readFileSync(new URL('../migrations/0016_daily_analysis_v1.sql',import.meta.url),'utf8'));
 db.prepare('INSERT INTO chass_daily_analysis_jobs VALUES (?,?,?,?,?,?)').run('JOB',DATE,'START',null,'RUNNING',null);
 db.prepare('INSERT INTO chass_daily_analysis_runs VALUES (?,?,?,?)').run('JOB','RACE','HASH','{}');
 assert.throws(()=>db.prepare('INSERT INTO chass_daily_analysis_runs VALUES (?,?,?,?)').run('JOB','RACE','HASH2','{}'),/UNIQUE/);
 assert.equal(db.prepare('SELECT original_early FROM races WHERE id=?').get('KEEP').original_early,'FROZEN');
 }finally{db.close();}
});
test('actual SQLite executes the complete job SQL, persists hashes and serves a verified research replay',async()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  sqlite.exec(readFileSync(new URL('../migrations/0016_daily_analysis_v1.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...args){const s=sqlite.prepare(sql);return {async run(){const r=s.run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};}};}};}};
  const e=env(db),out=await runDailyAnalysis(e,options([fixture()]));assert.equal(out.savedCount,1);
  const response=await handleDailyAnalysisRequest(request(),e),body=await response.json();assert.equal(body.rows[0].result.status,'REVIEW_COMPLETE');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM chass_daily_analysis_runs').get().n,1);
 }finally{sqlite.close();}
});
test('9am JST schedule has bounded lateness and never backdates a late run',()=>{const due=NOW-1000;assert.ok(dailyScheduleDue(due,NOW));assert.ok(!dailyScheduleDue(due,NOW+300001));assert.ok(!dailyScheduleDue(due-5*60000,NOW));assert.ok(!dailyScheduleDue(due,due-1));});
test('scheduled batch persists and verifies, GET replays historical results after start, second invocation is idempotent',async()=>{
 const db=database(),e=env(db);const out=await runDailyAnalysis(e,options([fixture()]));assert.equal(out.status,'COMPLETE');assert.equal(out.savedCount,1);
 const second=await runDailyAnalysis(e,options([fixture()]));assert.equal(second.status,'ALREADY_CLAIMED');assert.equal(db.runs.size,1);
 const response=await handleDailyAnalysisRequest(request(),e);assert.equal(response.status,200);const data=await response.json();assert.equal(data.rows.length,1);assert.equal(data.rows[0].result.status,'REVIEW_COMPLETE');assert.equal(data.summary.allScheduledRacesConfirmed,false);
});
test('concurrent scheduled invocations cannot acquire the same date twice',async()=>{const db=database(),e=env(db);const rows=await Promise.all([runDailyAnalysis(e,options([fixture()])),runDailyAnalysis(e,options([fixture()]))]);assert.equal(rows.filter(r=>r.status==='ALREADY_CLAIMED').length,1);assert.equal(db.runs.size,1);});
test('ambiguous Runs hold only their race while another race is saved',async()=>{const a=fixture(),b=fixture();b.horses[0].canonicalIndex.peak--;const db=database();const out=await runDailyAnalysis(env(db),options([a,b,fixture(2)]));assert.equal(out.status,'PARTIAL');assert.equal(out.savedCount,1);assert.equal(out.heldCount,1);});
test('empty feed and provider exception are explicit HOLD, without fabricated cold score or leaked details',async()=>{const db=database();assert.equal((await runDailyAnalysis(env(db),options([]))).status,'HOLD');const db2=database(),o=options([]);o.readInputs=async()=>{throw Error('PRIVATE_SECRET');};const out=await runDailyAnalysis(env(db2),o);assert.equal(out.status,'HOLD');assert.ok(!JSON.stringify(out).includes('PRIVATE_SECRET'));});
test('source frozen after job start cannot become the 9am result',async()=>{const root=fixture();root.race.metricInputFreeze.freezeAt=new Date(NOW+100).toISOString();const db=database(),out=await runDailyAnalysis(env(db),options([root]));assert.equal(out.savedCount,0);assert.equal(out.issues[0].reason,'DAILY_INPUT_FROZEN_AFTER_JOB_START');assert.equal(db.runs.size,0);});
test('completion crossing post time cannot be counted or served as completed',async()=>{let clock=NOW;const db=database(),o=options([fixture()]);o.clock=()=>{const value=clock;clock+=3600000;return value;};const e=env(db),out=await runDailyAnalysis(e,o);assert.equal(out.savedCount,0);assert.equal(out.status,'HOLD');const data=await (await handleDailyAnalysisRequest(request(),e)).json();assert.equal(data.rows.length,0);});
test('readback failure cannot become completed or be served as a numeric result',async()=>{const db=database({corruptReadback:true}),e=env(db),out=await runDailyAnalysis(e,options([fixture()]));assert.equal(out.savedCount,0);assert.equal(out.status,'HOLD');const data=await (await handleDailyAnalysisRequest(request(),e)).json();assert.equal(data.rows.length,0);});
test('disabled feature never touches storage, unauthorized and cross-site GET cannot read records',async()=>{const disabled=await runDailyAnalysis({DB:{prepare(){throw Error('unexpected');}}},options([]));assert.equal(disabled.status,'DISABLED');const e=env(database());assert.equal((await handleDailyAnalysisRequest(request('Bearer WRONG'),e)).status,401);const cross=request();cross.headers.set('origin','https://other.example');assert.equal((await handleDailyAnalysisRequest(cross,e)).status,401);});
test('a failed race does not stop another, and output hashes are checked again on API read',async()=>{const a=fixture();a.race.raceDate='2026-10-22';const db=database(),e=env(db),out=await runDailyAnalysis(e,options([a,fixture(2)]));assert.equal(out.savedCount,1);const value=[...db.runs.values()][0],bad=JSON.parse(value.artifact_json);bad.body.result.status='FAKE';value.artifact_json=JSON.stringify(bad);const data=await (await handleDailyAnalysisRequest(request(),e)).json();assert.equal(data.rows[0].result.reason,'DAILY_STORED_ARTIFACT_INVALID');});
