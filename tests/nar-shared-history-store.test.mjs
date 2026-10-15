import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {stableHash,assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';
import {retainNarCardHistory} from '../src/prediction/nar-history-pack.mjs';
import {attachNarHistoryIdentity} from '../src/prediction/nar-history-identity-bridge.mjs';
import {materializeNarSharedHistory as save,readNarRollingHistory as read,narSharedHistorySchemaReady,verifyNarRollingHistory as verify} from '../src/prediction/nar-shared-history-store.mjs';
import {buildNarPreAnalysisPack,verifyNarPreAnalysisPack} from '../src/prediction/nar-pre-analysis-pack.mjs';
import {createNarAbilityPrecomputeRunner,handleNarAbilityViewer,readNarAbilityCanaryStatus} from '../src/prediction/nar-ability-precompute.mjs';
const schema=readFileSync(new URL('../migrations/0014_nar_shared_history.sql',import.meta.url),'utf8');
function db(shared=true){
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'));if(shared)sql.exec(schema);
 return {sql,prepare(text){let args=[];return {bind(...a){args=a;return this;},async all(){return {results:sql.prepare(text).all(...args)};},async first(){return sql.prepare(text).get(...args)||null;},async run(){const r=sql.prepare(text).run(...args);return {meta:{changes:Number(r.changes)}};}};}};
}
const horseKey='NAR_LINEAGE:30012403217',raceId=date=>`${date.replaceAll('-','')}-NAR-21-01`;
async function fixture({date='2026-10-14',dates=['2026-09-30'],timeSec=91.2,observedAt=`${date}T00:00:00.000Z`,key=horseKey}={}){
 const sourceAcquiredAt=`${date}T00:00:00.000Z`,refs=dates.map(d=>({date:d,code:'21',raceNo:1,raceId:raceId(d)})),body={status:'IDENTITY_LINKS_RESOLVED',date,postTime:'15:00',code:'21',raceNo:1,observedAt,rows:[{horseNo:1,horseName:'A',providerHorseKey:key,pastRaceReferences:refs}]},links={body,linksHash:await stableHash(body)};
 const context={raceId:raceId(date),horseNo:1,horseName:'A',sourceAcquiredAt},runs=dates.map(d=>({date:d.slice(5).replace('-','.'),venue:'川崎',runOrganization:'NAR',timeSec})),history=await attachNarHistoryIdentity(await retainNarCardHistory({...context,runs}),links,context);
 return {raceId:context.raceId,sourceAcquiredAt,cutoffAt:observedAt,links,horses:[{horseNo:1,horseName:'A',history}]};
}
const context={horseKey,targetDate:'2026-10-14',cutoffAt:'2026-10-14T00:00:00.000Z'};
test('immutable schema can be reapplied and observation writes are verified/idempotent',async()=>{
 const DB=db(),f=await fixture();DB.sql.exec(schema);const a=await save(DB,f),b=await save(DB,f);assert.equal(await narSharedHistorySchemaReady(DB),true);assert.equal(a.audit.insertedObservationCount,1);assert.equal(b.audit.existingObservationCount,1);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM nar_shared_history_observations').get().n,1);assert.equal(a.horses[0].rollingHistory.body.availableCount,1);assert.doesNotThrow(()=>assertMarketIndependentData(a.horses));assert.throws(()=>DB.sql.exec('UPDATE nar_shared_history_observations SET fact_hash=\'bad\''),/IMMUTABLE/);assert.throws(()=>DB.sql.exec('DELETE FROM nar_shared_history_observations'),/IMMUTABLE/);
});
test('cross-race observations reuse episodes while preserving both physical lineages',async()=>{
 const DB=db();await save(DB,await fixture({date:'2026-10-13'}));const out=await save(DB,await fixture());const b=out.horses[0].rollingHistory.body;assert.equal(b.episodeCount,1);assert.equal(b.episodes[0].provenance.length,2);assert.equal(b.availableCount,1);assert.equal(b.tenRunCoverage,'NOT_CONFIRMED');assert.equal(b.modelInputStatus,'NOT_CONNECTED');
});
test('same names never join separate official horse identities',async()=>{
 const DB=db();await save(DB,await fixture());await save(DB,await fixture({key:'NAR_LINEAGE:30012403218',timeSec:93}));assert.equal((await read(DB,context)).body.episodes[0].facts.timeSec,91.2);assert.equal((await read(DB,{...context,horseKey:'NAR_LINEAGE:30012403219'})).body.status,'EMPTY');
});
test('new fact revisions HOLD only when observed by the requested cutoff',async()=>{
 const DB=db();await save(DB,await fixture({date:'2026-10-13'}));await save(DB,await fixture({timeSec:93,observedAt:'2026-10-14T01:00:00.000Z'}));const early=await read(DB,context),late=await read(DB,{...context,cutoffAt:'2026-10-14T01:00:00.000Z'});assert.equal(early.body.availableCount,1);assert.equal(late.body.heldCount,1);assert.equal(late.body.episodes[0].facts,null);assert.equal(late.body.episodes[0].reasonCode,'FACT_REVISION_CONFLICT');assert.equal(early.body.episodes[0].facts.timeSec,91.2);
});
test('Rolling read is bounded to latest ten different prior episodes',async()=>{
 const DB=db();for(const dates of [['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05'],['2026-09-06','2026-09-07','2026-09-08','2026-09-09','2026-09-10'],['2026-09-11']])await save(DB,await fixture({dates}));const p=await read(DB,context);assert.equal(p.body.episodeCount,10);assert.equal(p.body.episodes[0].canonicalDate,'2026-09-11');assert.equal(p.body.episodes[9].canonicalDate,'2026-09-02');assert.equal(p.body.tenRunCoverage,'NOT_CONFIRMED');
});
test('invalid history, forged future references and closed budget cannot insert observations',async()=>{
 const DB=db(),f=await fixture();f.horses[0].history.body.episodes[0].facts.timeSec=9;await assert.rejects(save(DB,f),/IDENTITY_UNVERIFIED/);await assert.rejects(save(DB,{...await fixture(),canContinue:()=>false}),/DEADLINE/);await assert.rejects(read(DB,{...context,horseKey:'name:A'}),/READ_CONTEXT/);await assert.rejects(save(DB,{...await fixture(),cutoffAt:'2026-10-14T06:00:00.000Z'}),/WRITE_CONTEXT/);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM nar_shared_history_observations').get().n,0);
});
test('schema absence and physical readback/hash failure never claim availability',async()=>{
 assert.equal(await narSharedHistorySchemaReady(db(false)),false);await assert.rejects(save(db(false),await fixture()),/SCHEMA_UNAVAILABLE/);
 const DB=db(),bad={prepare(text){const s=DB.prepare(text);if(text.startsWith('SELECT record_json'))s.first=async()=>null;return s;}};await assert.rejects(save(bad,await fixture()),/SAVE_UNVERIFIED/);
 const corrupt={prepare(text){const s=DB.prepare(text);if(text.includes('LIMIT 257')){const all=s.all;s.all=async()=>{const r=await all();r.results[0].fact_hash='bad';return r;};}return s;}};await assert.rejects(read(corrupt,context),/READ_UNVERIFIED/);
});
test('excessive observation provenance cannot be truncated into false availability',async()=>{
 const DB=db();await save(DB,await fixture());const excess={prepare(text){const s=DB.prepare(text);if(text.includes('LIMIT 257')){const all=s.all;s.all=async()=>{const r=await all();return {results:Array.from({length:257},()=>r.results[0])};};}return s;}};await assert.rejects(read(excess,context),/OBSERVATION_LIMIT/);
});
test('concurrent same-source appends keep one observation and independently verify reads',async()=>{
 const DB=db(),f=await fixture(),out=await Promise.all([save(DB,f),save(DB,f)]);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM nar_shared_history_observations').get().n,1);assert.equal(out.reduce((n,r)=>n+r.audit.insertedObservationCount,0),1);assert.ok(out.every(r=>r.horses[0].rollingHistory.body.availableCount===1));
});
test('future canonical episodes and duplicate official horse keys fail before writes',async()=>{
 const DB=db();await assert.rejects(save(DB,await fixture({dates:['2026-10-15']})),/IDENTITY_UNVERIFIED/);const f=await fixture();f.horses.push({...f.horses[0],horseNo:2});await assert.rejects(save(DB,f),/IDENTITY_UNVERIFIED/);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM nar_shared_history_observations').get().n,0);
});
test('deadline reached by a D1 write aborts projection without changing source timestamps',async()=>{
 const DB=db(),f=await fixture();let active=true;const wrapped={prepare(text){const s=DB.prepare(text);if(text.startsWith('INSERT')){const run=s.run;s.run=async()=>{const r=await run();active=false;return r;};}return s;}};await assert.rejects(save(wrapped,{...f,canContinue:()=>active}),/DEADLINE/);assert.equal(DB.sql.prepare('SELECT observed_at FROM nar_shared_history_observations').get().observed_at,f.cutoffAt);
});
test('frozen projection checks its own hash, horse identity, cutoff and conflict state',async()=>{
 const DB=db(),f=await fixture(),p=(await save(DB,f)).horses[0].rollingHistory,c={horseKey,targetDate:'2026-10-14',sourceAcquiredAt:f.sourceAcquiredAt,postTime:'15:00',calculatedAt:f.cutoffAt};assert.equal(await verify(p,c),true);assert.equal(await verify(p,{...c,horseKey:'NAR_LINEAGE:30012403218'}),false);assert.equal(await verify(p,{...c,calculatedAt:'2026-10-13T00:00:00.000Z'}),false);p.body.availableCount=0;p.historyHash=await stableHash(p.body);assert.equal(await verify(p,c),false);
});
async function runFixture({shared=true,enabled=true}={}){
 const DB=db(shared),f=await fixture(),at=Date.parse(f.cutoffAt),env={DB,ENABLE_NAR_ABILITY_PRECOMPUTE:'true',ENABLE_NAR_ABILITY_VIEWER:'true',ENABLE_NAR_HISTORY_LINKS:'true',ENABLE_NAR_SHARED_HISTORY:String(enabled),NAR_PRECOMPUTE_TRACK_CODES:'21',NAR_PRECOMPUTE_MAX_JOBS:'1',NAR_PRECOMPUTE_BUDGET_MS:'20000',NAR_PRECOMPUTE_CANARY_DATE:'2026-10-14',NAR_PRECOMPUTE_STOP_AT:'2026-10-14T14:55:00+09:00'};
 const body=structuredClone(f.links.body);body.rows.push({...body.rows[0],horseNo:2,horseName:'B',providerHorseKey:'NAR_LINEAGE:30012403218'});const links={body,linksHash:await stableHash(body)};
 const run=createNarAbilityPrecomputeRunner(env,{wallNow:()=>at,scheduledTime:0,meeting:async()=>({status:'meeting',date:'2026-10-14',track:'川崎',raceNumbers:[1]}),card:async()=>({ok:true,date:'2026-10-14',track:'川崎',code:'21',race:1,organization:'NAR',postTime:'15:00',distance:1400,surface:'ダート',horses:[1,2].map(no=>({horseNo:no,horseName:no===1?'A':'B',abilityScore:81-no,runs:[{date:'09.30',venue:'川崎',runOrganization:'NAR',timeSec:91.2}]}))}),historyLinks:async()=>links});return {DB,env,run,at};
}
test('runtime saves and public API reads frozen Rolling projection without app activation',async()=>{
 const f=await runFixture();assert.equal((await f.run()).saved,1);const response=await handleNarAbilityViewer(new Request('https://example.test/api/chass/v1/public/day-ai?organization=NAR&date=2026-10-14'),f.env),p=await response.json();assert.equal(p.count,1);assert.equal(p.races[0].historyStoreAudit.insertedObservationCount,2);assert.equal(p.races[0].preAnalysisPack.body.contractVersion,'CHASS_PRE_ANALYSIS_PACK_V4');assert.equal(p.races[0].preAnalysisPack.body.rollingHistoryPacks[0].history.body.availableCount,1);assert.equal(p.races[0].horses[0].abilityScore,80);assert.equal(p.races[0].horses[0].probability.win,null);assert.equal((await readNarAbilityCanaryStatus(f.env,{date:'2026-10-14',now:f.at})).historyStoreSchemaReady,true);const before=f.DB.sql.prepare('SELECT data_json FROM precomputed_race_snapshots').get().data_json;assert.equal((await f.run()).saved,0);assert.equal(f.DB.sql.prepare('SELECT data_json FROM precomputed_race_snapshots').get().data_json,before);
});
test('disabled or missing shared schema preserves ability DATA with explicit reason',async()=>{
 for(const mode of [{shared:false,enabled:true},{shared:true,enabled:false}]){const f=await runFixture(mode);assert.equal((await f.run()).saved,1);const d=JSON.parse(f.DB.sql.prepare('SELECT data_json FROM precomputed_race_snapshots').get().data_json);assert.equal(d.horses[0].abilityScore,80);assert.equal(d.horses[0].rollingHistory,undefined);assert.equal(d.historyStoreAudit.reasonCode,mode.enabled?'HISTORY_SCHEMA_UNAVAILABLE':'SHARED_HISTORY_STORE_DISABLED');}
});
test('V1/V2/V3 packs remain verifiable alongside new V4 projections',async()=>{
 const f=await fixture(),input={raceId:f.raceId,race:{date:'2026-10-14',track:'川崎',raceNo:1,postTime:'15:00'},sourceAcquiredAt:f.sourceAcquiredAt,horses:f.horses};for(const contractVersion of ['CHASS_PRE_ANALYSIS_PACK_V1','CHASS_PRE_ANALYSIS_PACK_V2','CHASS_PRE_ANALYSIS_PACK_V3','CHASS_PRE_ANALYSIS_PACK_V4']){const p=await buildNarPreAnalysisPack({...input,contractVersion});assert.equal(await verifyNarPreAnalysisPack(p,input),true);assert.equal('rollingHistoryPacks' in p.body,contractVersion==='CHASS_PRE_ANALYSIS_PACK_V4');}
});

test('Phase140.6 versioned corrected identities materialize without changing old observations or source history',async()=>{
 const DB=db(),old=await fixture();delete old.horses[0].history.body.identity.venueMappingVersion;
 old.horses[0].history.historyHash=await stableHash(old.horses[0].history.body);
 await save(DB,old);const prior=JSON.stringify(DB.sql.prepare('SELECT * FROM nar_shared_history_observations').all());
 const f=JSON.parse(readFileSync(new URL('./fixtures/nar-legacy-venue-identity.json',import.meta.url),'utf8'));
 f.context.sourceAcquiredAt=new Date(f.context.sourceAcquiredAt).toISOString();f.links.body.observedAt=f.context.sourceAcquiredAt;for(const ref of f.links.body.rows[0].pastRaceReferences){ref.raceNo=1;ref.raceId=ref.date.replaceAll('-','')+'-NAR-'+ref.code+'-01';}f.links.linksHash=await stableHash(f.links.body);
 const original=await retainNarCardHistory({...f.context,runs:[{date:'09.30',venue:'笠松',runOrganization:'NAR',timeSec:91.2},{date:'09.29',venue:'金沢',runOrganization:'NAR',timeSec:90}]}),history=await attachNarHistoryIdentity(original,f.links,f.context),before=JSON.stringify(history);
 const out=await save(DB,{raceId:f.context.raceId,sourceAcquiredAt:f.context.sourceAcquiredAt,cutoffAt:f.context.sourceAcquiredAt,links:f.links,horses:[{horseNo:1,horseName:f.context.horseName,history}]});
 assert.equal(out.audit.insertedObservationCount,2);assert.equal(out.audit.unresolvedObservationCount,0);assert.equal(JSON.stringify(history),before);
 const rows=DB.sql.prepare('SELECT * FROM nar_shared_history_observations').all();assert.equal(rows.length,3);assert.equal(JSON.stringify(rows.slice(0,1)),prior);
 const bad=structuredClone(history);bad.body.identity.venueMappingVersion='FUTURE';bad.historyHash=await stableHash(bad.body);
 await assert.rejects(save(DB,{raceId:f.context.raceId,sourceAcquiredAt:f.context.sourceAcquiredAt,cutoffAt:f.context.sourceAcquiredAt,links:f.links,horses:[{horseNo:1,horseName:f.context.horseName,history:bad}]}),/IDENTITY_UNVERIFIED/);assert.equal(DB.sql.prepare('SELECT COUNT(*) n FROM nar_shared_history_observations').get().n,3);
});
