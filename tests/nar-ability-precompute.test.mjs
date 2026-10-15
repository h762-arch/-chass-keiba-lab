import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
import {createSnapshotHash} from '../src/prediction/precomputed-snapshot.mjs';
import {d1RowToSnapshot} from '../src/prediction/precomputed-store.mjs';
import {retainNarAbilityEvidence,auditNarAbilityEvidence} from '../src/prediction/nar-ability-evidence.mjs';
import {narAbilityRunWindow} from '../src/prediction/nar-ability-run-window.mjs';
import {handlePublicApi} from '../worker.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createNarAbilityPrecomputeRunner as create,handleNarAbilityViewer as api,NAR_ABILITY_VERSION,assertNarAbilityCardIdentity,fetchNarPrecomputeHtml,readNarAbilityCanaryStatus} from '../src/prediction/nar-ability-precompute.mjs';
import {sanitizeViewerDayPayload,buildViewerDayUrl} from '../viewer/viewer-core.js';
const cols='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at'.split(',');
function database(){const rows=[];return {rows,prepare(sql){let args=[];const matching=()=>rows.filter(r=>r.organization===args[0]&&(sql.includes('race_id>=')?r.race_id>=args[1]&&r.race_id<args[2]&&r.calculation_version===args[3]&&r.model_version===args[4]:r.race_id===args[1]));return {bind(...v){args=v;return this;},async all(){return {results:sql.includes('LIMIT 0')?[]:matching()};},async first(){return matching()[0]||null;},async run(){const r=Object.fromEntries(cols.map((c,i)=>[c,args[i]])),exists=rows.some(x=>x.organization===r.organization&&x.race_id===r.race_id&&x.revision===r.revision);if(!exists)rows.push(r);return {meta:{changes:exists?0:1}};}};}};}
function fixture(){const DB=database(),env={DB,ENABLE_NAR_ABILITY_PRECOMPUTE:'true',ENABLE_NAR_ABILITY_VIEWER:'true',NAR_PRECOMPUTE_TRACK_CODES:'21',NAR_PRECOMPUTE_MAX_JOBS:'3',NAR_PRECOMPUTE_CANARY_DATE:'2026-10-13',NAR_PRECOMPUTE_STOP_AT:'2026-10-13T14:55:00+09:00'};const clock=()=>Date.parse('2026-10-12T22:00:00Z');const meeting=async({date})=>({status:'meeting',track:'川崎',date,raceNumbers:[1,2,3,4]});const card=async({date,race,track,code})=>({ok:true,organization:'NAR',date,race,track,code,postTime:'12:00',raceName:'試験',distance:1400,surface:'ダート',horses:[{horseNo:1,horseName:'A',abilityScore:80,predictedTime:'1:30.0',odds:9,abilityWinRate:80},{horseNo:2,horseName:'B',abilityScore:70,predictedTime:'1:31.0',odds:2,abilityWinRate:20}]});return {DB,env,clock,meeting,card,run:(extra={})=>create(env,{meeting,card,wallNow:clock,scheduledTime:0,...extra})()};}
const req=(path='day-ai',track='川崎')=>new Request(`https://example.test/api/chass/v1/public/${path}?organization=NAR&date=2026-10-13&track=${encodeURIComponent(track)}&race=1`);
test('default OFF does not create a runner or query D1',()=>{assert.equal(create({}),null);assert.equal(create({ENABLE_NAR_ABILITY_PRECOMPUTE:'false'}),null);});
test('separate NAR budget saves ability/TIME with no market, probabilities or signals',async()=>{const f=fixture();f.env.JRA_PRECOMPUTE_MAX_JOBS='1';const out=await f.run();assert.equal(out.saved,3);assert.equal(out.attempted,3);assert.equal(f.DB.rows.length,3);const d=JSON.parse(f.DB.rows[0].data_json);assert.equal(d.horses[0].abilityRank,1);assert.equal(d.horses[0].predictedTime,'1:30.0');assert.equal('odds' in d.horses[0],false);assert.equal('win' in d.horses[0],false);assert.equal(f.DB.rows[0].market_json,null);assert.equal(out.formalKpiEligible,false);assert.ok(out.events.some(e=>e.reason==='NOT_SELECTED_LIMIT'));});
test('rerun preserves earlier data and reaches unsaved races',async()=>{const f=fixture();await f.run();const before=f.DB.rows[0].data_json;const out=await f.run();assert.equal(out.saved,1);assert.equal(f.DB.rows.length,4);assert.equal(f.DB.rows[0].data_json,before);assert.equal(out.events.filter(e=>e.reason==='ALREADY_SAVED').length,3);});
test('a held candidate does not starve later candidates on subsequent turns',async()=>{const f=fixture();f.env.NAR_PRECOMPUTE_MAX_JOBS='1';const card=async j=>{if(j.race===1)throw new Error('private');return f.card(j);};assert.equal((await f.run({card})).saved,0);assert.equal((await f.run({card,scheduledTime:300000})).saved,1);assert.match(f.DB.rows[0].race_id,/-02$/);});
test('missing, invalid, excessive and unsupported settings block without requests',async()=>{for(const change of [{NAR_PRECOMPUTE_TRACK_CODES:''},{NAR_PRECOMPUTE_TRACK_CODES:'3'},{NAR_PRECOMPUTE_TRACK_CODES:'21,21'},{NAR_PRECOMPUTE_MAX_JOBS:'5'},{NAR_PRECOMPUTE_BUDGET_MS:'30001'}]){const f=fixture();Object.assign(f.env,change);let calls=0;const out=await f.run({meeting:async()=>{calls++;}});assert.equal(out.status,'BLOCKED');assert.equal(calls,0);}});
test('non-meetings and uncertain meeting identity never enqueue race jobs',async()=>{const f=fixture();for(const meeting of [async()=>({status:'non_meeting',track:'川崎',date:'2026-10-13',raceNumbers:[]}),async()=>({status:'meeting',track:'大井',date:'2026-10-13',raceNumbers:[1]})]){let calls=0;const out=await f.run({meeting,card:async()=>{calls++;}});assert.equal(calls,0);assert.equal(out.saved,0);}});
test('card identity, missing post time, post-off, invalid field and missing ability hold',async()=>{for(const [patch,reason] of [[{track:'大井'},'CARD_IDENTITY'],[{distance:null},'RACE_CONTEXT_INVALID'],[{resultSnapshot:{}},'CARD_IDENTITY'],[{postTime:''},'POST_TIME_UNKNOWN'],[{postTime:'06:00'},'POST_TIME_REACHED'],[{horses:[]},'FIELD_INVALID'],[{horses:[{horseNo:1,horseName:'A'},{horseNo:2,horseName:'B'}]},'ABILITY_INSUFFICIENT']]){const f=fixture(),out=await f.run({card:async j=>({...await f.card(j),...patch})});assert.equal(out.saved,0);assert.ok(out.events.some(e=>e.reason===reason));}});
test('deadline exhaustion prevents card work and late saves',async()=>{const f=fixture();let at=f.clock();const out=await f.run({wallNow:()=>at,meeting:async j=>{at+=30000;return f.meeting(j);}});assert.equal(out.saved,0);assert.ok(out.events.some(e=>e.reason==='DEADLINE'));assert.equal(f.DB.rows.length,0);});
test('concurrent runs conditionally insert one immutable revision per race',async()=>{const f=fixture();await Promise.all([f.run(),f.run()]);assert.equal(f.DB.rows.length,3);assert.ok(f.DB.rows.every(r=>r.revision===1));});
test('new Viewer API returns readable NAR research ability and disables market overlay',async()=>{const f=fixture();await f.run();const response=await api(new Request(buildViewerDayUrl({date:'2026-10-13',track:'川崎',organization:'NAR',origin:'https://example.test'})),f.env),body=await response.json(),day=sanitizeViewerDayPayload(body);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.count,3);assert.equal(body.viewerMode,'nar-precomputed-ability-research');assert.equal(body.marketEvaluation,'disabled');assert.equal(day.races.length,3);assert.equal(day.races[0].horses[0].abilityScore,80);assert.equal(day.races[0].horses[0].aiWinRate,null);});
test('listing and single-race Viewer routes retain their existing response shapes',async()=>{const f=fixture();await f.run();const list=await (await api(req('races'),f.env)).json();assert.equal(list.races.length,3);assert.equal(list.races[0].track,'川崎');const one=await (await api(req('race'),f.env)).json();assert.equal(one.raceNo,1);assert.equal(one.horses.length,2);});
test('empty, disabled and JRA requests fall back to existing public readers',async()=>{const f=fixture();assert.equal(await api(req(),f.env),null);await f.run();assert.equal(await api(req(),{...f.env,ENABLE_NAR_ABILITY_VIEWER:'false'}),null);assert.equal(await api(new Request(req().url.replace('NAR','JRA')),f.env),null);});
test('wrong date/venue and tampered rows never become Viewer predictions',async()=>{const f=fixture();await f.run();assert.equal((await api(new Request(req().url.replace('2026-10-13','2026-99-99')),f.env)).status,400);assert.equal(await api(req('day-ai','大井'),f.env),null);f.DB.rows.forEach(r=>{const d=JSON.parse(r.data_json);d.horses[0].abilityScore=999;r.data_json=JSON.stringify(d);});assert.equal(await api(req(),f.env),null);});
test('Cron and public routing are wired without changing JRA planning caps',async()=>{const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8');assert.match(worker,/createNarAbilityPrecomputeRunner\(env/);assert.match(worker,/handleNarAbilityViewer\(request,env\)/);assert.match(worker,/u!==urls.detail/);const app=await readFile(new URL('../viewer/viewer-app.js',import.meta.url),'utf8');assert.match(app,/NAR事前能力計算・研究用/);});

test('official spaced venue and full-width race number are normalized, wrong card identity rejects',()=>{
 const html='<b>2026年10月13日（火） 川　崎　第１競走</b><tr class="dbitem"><td>past rows</td></tr>';
 assert.doesNotThrow(()=>assertNarAbilityCardIdentity(html,{date:'2026-10-13',track:'川崎',race:1}));
 for(const patch of [{date:'2026-10-12'},{track:'大井'},{race:10}])assert.throws(()=>assertNarAbilityCardIdentity(html,{date:'2026-10-13',track:'川崎',race:1,...patch}),/CARD_IDENTITY/);
});

test('missing snapshot schema blocks before discovery',async()=>{const f=fixture();f.env.DB={prepare(){throw new Error('schema missing');}};let calls=0;const out=await f.run({meeting:async()=>{calls++;}});assert.equal(out.reason,'SCHEMA_UNAVAILABLE');assert.equal(calls,0);});
test('source fetch is bounded across stalls and size, and rejects redirects and foreign paths',async()=>{
 const url='https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTableSmall?k_raceNo=1';
 await assert.rejects(fetchNarPrecomputeHtml(url,{timeoutMs:10,fetchImpl:()=>new Promise(()=>{})}),/SOURCE_DEADLINE/);
 await assert.rejects(fetchNarPrecomputeHtml(url,{fetchImpl:async()=>new Response('x'.repeat(1000001))}),/SOURCE_SIZE/);
 await assert.rejects(fetchNarPrecomputeHtml(url,{fetchImpl:async()=>new Response('',{status:302})}),/SOURCE_HTTP/);
 await assert.rejects(fetchNarPrecomputeHtml('https://evil.example/KeibaWeb/TodayRaceInfo/DebaTableSmall'),/SOURCE_URL/);
});

test('missing canary configuration and expired dates block before DB or discovery',async()=>{
 for(const patch of [{NAR_PRECOMPUTE_CANARY_DATE:''},{NAR_PRECOMPUTE_STOP_AT:'bad'},{NAR_PRECOMPUTE_CANARY_DATE:'2026-10-12',NAR_PRECOMPUTE_STOP_AT:'2026-10-12T14:55:00+09:00'},{NAR_PRECOMPUTE_STOP_AT:'2026-10-13T06:00:00+09:00'}]){const f=fixture();Object.assign(f.env,patch);let calls=0;const out=await f.run({meeting:async()=>{calls++;}});assert.equal(calls,0);assert.ok(['CANARY_WINDOW_CLOSED','CANARY_CONFIGURATION_INVALID'].includes(out.reason));}
});
test('canary stop time reached during discovery prevents any card or save',async()=>{const f=fixture();let at=f.clock(),calls=0;const out=await f.run({wallNow:()=>at,meeting:async j=>{at=Date.parse(f.env.NAR_PRECOMPUTE_STOP_AT);return f.meeting(j);},card:async()=>{calls++;}});assert.equal(out.saved,0);assert.equal(calls,0);});
test('read-only canary status reports saved coverage and does not fetch or insert',async()=>{const f=fixture();await f.run();const before=JSON.stringify(f.DB.rows),out=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.equal(out.active,true);assert.equal(out.schemaReady,true);assert.equal(out.savedRaceCount,3);assert.equal(out.races[0].timeCount,2);assert.equal(JSON.stringify(f.DB.rows),before);assert.equal((await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:Date.parse('2026-10-13T06:00:00Z')})).active,false);});
test('canary status rejects invalid dates and exposes unreadable schema without guessing zero',async()=>{const f=fixture();assert.equal((await readNarAbilityCanaryStatus(f.env,{date:'bad'})).ok,false);f.env.DB={prepare(){throw Error('missing');}};const out=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.equal(out.schemaReady,false);assert.equal(out.savedRaceCount,null);});
test('production daily trial is one venue, seven days and preserves JRA caps',async()=>{
 const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.equal(config.vars.NAR_PRECOMPUTE_TRACK_CODES,'21');assert.equal(config.vars.NAR_PRECOMPUTE_RUN_MODE,'daily');assert.equal(config.vars.NAR_PRECOMPUTE_DAILY_FROM,'2026-10-14');assert.equal(config.vars.NAR_PRECOMPUTE_DAILY_UNTIL,'2026-10-20');assert.equal(config.vars.NAR_PRECOMPUTE_MAX_JOBS,'3');assert.equal(config.vars.JRA_PRECOMPUTE_MAX_JOBS,'1');assert.equal(config.vars.JRA_PRECOMPUTE_MAX_PLANNING_JOBS,'4');assert.equal(config.vars.NAR_PRECOMPUTE_DAILY_START_JST,'07:00');assert.equal(config.vars.NAR_PRECOMPUTE_DAILY_STOP_JST,'14:55');assert.equal(config.vars.NAR_PRECOMPUTE_STOP_AT,undefined);
});

test('real public handler exposes canary status as GET/HEAD only without D1 writes',async()=>{const f=fixture();await f.run();const before=JSON.stringify(f.DB.rows),url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13';const response=await handlePublicApi(new Request(url),f.env);assert.equal(response.status,200);assert.equal((await response.json()).savedRaceCount,3);assert.equal(response.headers.get('access-control-allow-origin'),'*');assert.equal((await handlePublicApi(new Request(url,{method:'HEAD'}),f.env)).status,200);assert.equal((await handlePublicApi(new Request(url,{method:'POST'}),f.env)).status,405);assert.equal((await handlePublicApi(new Request(url.replace('2026-10-13','bad')),f.env)).status,400);assert.equal(JSON.stringify(f.DB.rows),before);});

test('existing JRA market queue precedes NAR and busy result runs suppress NAR work',async()=>{const worker=await readFile(new URL('../worker.js',import.meta.url),'utf8'),part=worker.slice(worker.indexOf('async scheduled'));assert.ok(part.indexOf('await marketQueueRunner()')<part.indexOf('narAbility:await narRunner()'));assert.match(part,/Number\(result.autoResult\?\.processed\)>=3/);assert.match(part,/AUTO_RESULT_PRIORITY/);});

const dailySettings={NAR_PRECOMPUTE_RUN_MODE:'daily',NAR_PRECOMPUTE_DAILY_FROM:'2026-10-14',NAR_PRECOMPUTE_DAILY_UNTIL:'2026-10-20',NAR_PRECOMPUTE_DAILY_START_JST:'07:00',NAR_PRECOMPUTE_DAILY_STOP_JST:'14:55'};
const jst=d=>Date.parse(d+'+09:00');
test('daily window uses JST including inclusive trial dates and exclusive daily stop',()=>{
 for(const [at,active,reason] of [['2026-10-13T08:00:00',false,'DAILY_DATE_CLOSED'],['2026-10-14T06:59:59',false,'DAILY_WINDOW_CLOSED'],['2026-10-14T07:00:00',true],['2026-10-20T14:54:59',true],['2026-10-20T14:55:00',false,'DAILY_WINDOW_CLOSED'],['2026-10-21T08:00:00',false,'DAILY_DATE_CLOSED']]){const w=narAbilityRunWindow(dailySettings,jst(at));assert.equal(w.active,active);assert.equal(w.reason,reason);}
 assert.equal(narAbilityRunWindow(dailySettings,Date.parse('2026-10-13T22:00:00Z')).date,'2026-10-14');
});
test('missing daily settings, invalid dates, overnight windows and excessive trial fail closed',()=>{
 for(const patch of [{NAR_PRECOMPUTE_DAILY_FROM:''},{NAR_PRECOMPUTE_DAILY_FROM:'2026-02-30'},{NAR_PRECOMPUTE_DAILY_UNTIL:'2026-10-13'},{NAR_PRECOMPUTE_DAILY_UNTIL:'2026-10-21'},{NAR_PRECOMPUTE_DAILY_START_JST:'7:00'},{NAR_PRECOMPUTE_DAILY_STOP_JST:'07:00'},{NAR_PRECOMPUTE_DAILY_START_JST:'23:00'},{NAR_PRECOMPUTE_RUN_MODE:'unknown'}])assert.equal(narAbilityRunWindow({...dailySettings,...patch},jst('2026-10-14T08:00:00')).status,'BLOCKED');
});
test('closed daily schedule touches neither schema nor official source',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);f.env.DB={prepare(){throw Error('must not query');}};let calls=0;
 for(const at of ['2026-10-13T08:00:00','2026-10-14T06:59:59','2026-10-14T14:55:00','2026-10-21T08:00:00']){const out=await f.run({wallNow:()=>jst(at),meeting:async()=>{calls++;}});assert.equal(out.status,'SKIPPED');}assert.equal(calls,0);
});
test('daily schedule saves distinct days, preserves original rows and reads after expiry',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);let at=jst('2026-10-14T08:00:00');const extra={wallNow:()=>at};assert.equal((await f.run(extra)).saved,3);assert.equal((await f.run(extra)).saved,1);const first=JSON.stringify(f.DB.rows);assert.equal((await f.run(extra)).saved,0);assert.equal(JSON.stringify(f.DB.rows),first);
 at=jst('2026-10-15T08:00:00');assert.equal((await f.run(extra)).saved,3);assert.equal(f.DB.rows.length,7);assert.match(f.DB.rows[4].race_id,/^20261015-/);
 const response=await api(new Request(req().url.replace('2026-10-13','2026-10-14')),f.env);assert.equal((await response.json()).count,4);
 const status=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-14',now:jst('2026-10-21T08:00:00')});assert.equal(status.active,false);assert.equal(status.savedRaceCount,4);assert.equal(status.scheduleMode,'daily');
});
test('daily stop reached during discovery prevents cards and writes',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);let at=jst('2026-10-14T14:54:59'),calls=0;
 const out=await f.run({wallNow:()=>at,meeting:async j=>{at=jst('2026-10-14T14:55:00');return f.meeting(j);},card:async()=>{calls++;}});assert.equal(calls,0);assert.equal(out.saved,0);assert.equal(f.DB.rows.length,0);
});
test('daily stop reached after card acquisition prevents save',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);let at=jst('2026-10-14T14:54:59');const out=await f.run({wallNow:()=>at,card:async j=>{const p=await f.card(j);at=jst('2026-10-14T14:55:00');return {...p,postTime:'15:00'};}});assert.equal(out.saved,0);assert.equal(f.DB.rows.length,0);assert.ok(out.events.some(e=>e.reason==='DEADLINE'));
});
test('daily post-off cards remain rejected within an otherwise active window',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);const out=await f.run({wallNow:()=>jst('2026-10-14T08:00:00'),card:async j=>({...await f.card(j),postTime:'08:00'})});assert.equal(out.saved,0);assert.ok(out.events.every(e=>['POST_TIME_REACHED','NOT_SELECTED_LIMIT'].includes(e.reason)));
});
test('daily status cannot claim another date active or bypass invalid schedule',async()=>{
 const f=fixture();Object.assign(f.env,dailySettings);const now=jst('2026-10-14T08:00:00');assert.equal((await readNarAbilityCanaryStatus(f.env,{date:'2026-10-14',now})).active,true);assert.equal((await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now})).active,false);f.env.NAR_PRECOMPUTE_DAILY_STOP_JST='bad';const out=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-14',now});assert.equal(out.active,false);assert.equal(out.scheduleReason,'DAILY_CONFIGURATION_INVALID');
});

test('evidence projection retains bounded official components without market or arbitrary fields',()=>{
 const input={runs:[{sameDistance:true,sameTrack:true,odds:4},{sameDistance:false,sameTrack:false}],recentIndex:Array.from({length:20},(_,i)=>i),timeIndex:80,fiveRaceAvgIndex:75,distanceIndex:70,courseIndex:65,predictedTime:'1:30.0',predictedTimeType:'実績',predictedTimeConfidence:86,odds:5,abilityWinRate:60,features:{market:5}};
 const before=structuredClone(input),e=retainNarAbilityEvidence(input);assert.equal(e.runCount,2);assert.equal(e.sameDistanceCount,1);assert.equal(e.sameTrackCount,1);assert.equal(e.recentIndices.length,10);assert.equal(e.timeType,'実績');assert.equal(e.timeMissingReason,null);assert.deepEqual(e.components,{timeIndex:80,fiveRaceAvgIndex:75,distanceIndex:70,courseIndex:65});assert.equal('odds' in e,false);assert.equal('features' in e,false);assert.equal('abilityWinRate' in e,false);assert.deepEqual(input,before);
});
test('upstream TIME reasons are retained exactly, unknown reasons remain unavailable',()=>{
 for(const reason of ['time_missing_no_history','time_missing_no_same_surface','time_missing_parse','time_missing_unknown'])assert.equal(retainNarAbilityEvidence({predictedTimeMissingReason:reason}).timeMissingReason,reason);
 assert.equal(retainNarAbilityEvidence({predictedTimeMissingReason:'made_up'}).timeMissingReason,'TIME_REASON_UNAVAILABLE');assert.equal(retainNarAbilityEvidence({}).runCount,null);
});
test('old snapshots distinguish unretained reasons from known no-history',()=>{
 const audit=auditNarAbilityEvidence([{horseNo:1,abilityScore:null,predictedTime:null},{horseNo:2,abilityScore:null,evidence:retainNarAbilityEvidence({runs:[],predictedTimeMissingReason:'time_missing_no_history'})}]);assert.equal(audit.horses[0].abilityReason,'EVIDENCE_NOT_RETAINED');assert.equal(audit.horses[0].timeReason,'EVIDENCE_NOT_RETAINED');assert.equal(audit.horses[1].abilityReason,'NO_PARSED_HISTORY');assert.equal(audit.horses[1].timeReason,'time_missing_no_history');assert.equal(audit.retainedEvidenceCount,1);
});
test('quality audit separates active runners and never substitutes probability for ability coverage',()=>{
 const audit=auditNarAbilityEvidence([{horseNo:1,abilityScore:80,predictedTime:'1:30.0',runnerStatus:'active'},{horseNo:2,abilityScore:70,runnerStatus:'active'},{horseNo:3,abilityScore:null,runnerStatus:'scratched'}]);assert.equal(audit.horseCount,3);assert.equal(audit.activeHorseCount,2);assert.equal(audit.activeAbilityCount,2);assert.equal(audit.activeTimeCount,1);assert.equal(audit.abilityComplete,true);assert.equal(audit.probabilityStatus,'MODEL_HOLD');assert.equal(audit.probabilityReason,'PROBABILITY_MODEL_NOT_CONNECTED');assert.equal(auditNarAbilityEvidence([{abilityScore:null},{abilityScore:70}]).abilityComplete,false);assert.equal(auditNarAbilityEvidence([]).abilityComplete,false);
});
test('new evidence is persisted in immutable DATA and exposed through read-only status and Viewer',async()=>{
 const f=fixture();await f.run({card:async j=>({...await f.card(j),horses:[{horseNo:1,horseName:'A',abilityScore:80,predictedTime:'1:30.0',runs:[{sameDistance:true}],timeIndex:80,predictedTimeType:'実績'},{horseNo:2,horseName:'B',abilityScore:70,runs:[],predictedTimeMissingReason:'time_missing_no_history'}]})});const first=JSON.stringify(f.DB.rows),data=JSON.parse(f.DB.rows[0].data_json);assert.equal(data.horses[0].evidence.runCount,1);assert.equal(data.horses[1].evidence.timeMissingReason,'time_missing_no_history');const status=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.equal(status.races[0].quality.activeTimeCount,1);const body=await (await api(req(),f.env)).json();assert.equal(body.races[0].quality.retainedEvidenceCount,2);assert.equal(body.races[0].horses[0].probability.win,null);assert.equal(body.races[0].horses[0].probability.reasonCode,'PROBABILITY_MODEL_NOT_CONNECTED');assert.equal(JSON.stringify(f.DB.rows),first);
});

test('Cron persists partial pre-analysis packs and API returns stored readback hashes',async()=>{
 const f=fixture();await f.run();const saved=JSON.parse(f.DB.rows[0].data_json),before=JSON.stringify(f.DB.rows);assert.equal(saved.preAnalysisPack.body.contractVersion,'CHASS_PRE_ANALYSIS_PACK_V4');assert.equal(saved.preAnalysisPack.body.runnerCards.length,2);const body=await (await api(req(),f.env)).json();assert.equal(body.races[0].preAnalysisPack.packHash,saved.preAnalysisPack.packHash);assert.equal(body.races[0].preAnalysisStatus,'PARTIAL');const status=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.equal(status.races[0].preAnalysisPackHash,saved.preAnalysisPack.packHash);const listing=await (await api(req('races'),f.env)).json();assert.equal('preAnalysisPack' in listing.races[0],false);assert.equal(JSON.stringify(f.DB.rows),before);
});
test('legacy DATA without pack remains readable and is not silently backfilled',async()=>{
 const f=fixture();await f.run();for(const row of f.DB.rows){const data=JSON.parse(row.data_json);delete data.preAnalysisPack;row.data_json=JSON.stringify(data);row.snapshot_hash=await createSnapshotHash(d1RowToSnapshot(row));}const before=JSON.stringify(f.DB.rows),body=await (await api(req(),f.env)).json();assert.equal(body.races[0].preAnalysisPack,null);assert.equal(body.races[0].preAnalysisStatus,'NOT_MATERIALIZED');await f.run();assert.equal(f.DB.rows[0].data_json,JSON.parse(before)[0].data_json);
});

test('Cron persists card-history observations in DATA and Pack without additional source reads',async()=>{
 const f=fixture();let calls=0;await f.run({card:async j=>{calls++;const p=await f.card(j);p.horses[0].runs=[{date:'09.30',venue:'川崎',runOrganization:'NAR',distance:1400,finish:2,fieldSize:10,timeSec:91.2,corners:'2-2-1',popularity:3}];return p;}});assert.equal(calls,3);const d=JSON.parse(f.DB.rows[0].data_json);assert.equal(d.horses[0].history.body.retainedCount,1);assert.equal(d.horses[1].history.body.status,'SOURCE_NOT_RETAINED');const before=JSON.stringify(f.DB.rows),apiBody=await (await api(req(),f.env)).json();assert.equal(apiBody.races[0].preAnalysisPack.body.historyPacks[0].history.body.episodes[0].facts.timeSec,91.2);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('enabled bounded history provider enriches new DATA and readback without changing cap',async()=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';let calls=0;
 const out=await f.run({card:async j=>{const p=await f.card(j);p.horses.forEach(h=>h.runs=[{date:'09.30',venue:'川崎',runOrganization:'NAR',timeSec:91.2}]);return p;},historyLinks:async j=>{calls++;assert.ok(j.timeoutMs>0&&j.timeoutMs<=2000);const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+Number(h.horseNo)),pastRaceReferences:[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]}))};return {body,linksHash:await stableHash(body)};}});
 assert.equal(out.saved,3);assert.equal(calls,3);const d=JSON.parse(f.DB.rows[0].data_json);assert.equal(d.historyLinkAudit.resolvedEpisodeCount,2);assert.equal(d.horses[0].history.body.schemaVersion,2);const body=await (await api(req(),f.env)).json();assert.equal(body.count,3);assert.equal(body.races[0].historyLinkAudit.providerHorseCount,2);
});
test('history provider failure/disabled/missing preserves ability DATA with honest audit',async()=>{
 for(const mode of ['failure','disabled','missing']){const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS=mode==='disabled'?'false':'true';let calls=0;const out=await f.run(mode==='missing'?{}:{historyLinks:async()=>{calls++;throw Error('private source failure');}});assert.equal(out.saved,3);assert.equal(calls,mode==='failure'?3:0);const d=JSON.parse(f.DB.rows[0].data_json);assert.equal(d.historyLinkAudit.status,mode==='disabled'?'DISABLED':'HOLD');assert.equal(d.horses[0].history.body.schemaVersion,1);assert.equal('historyLinks' in d,false);}
});
test('late history completion cannot save after daily stop or post time',async()=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';let at=f.clock();const out=await f.run({wallNow:()=>at,historyLinks:async()=>{at=Date.parse(f.env.NAR_PRECOMPUTE_STOP_AT);throw Error('late');}});assert.equal(out.saved,0);assert.equal(f.DB.rows.length,0);
});
test('Worker history link wiring uses full card only and production retains daily/cap limits',async()=>{
 const source=await readFile(new URL('../worker.js',import.meta.url),'utf8'),cfg=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));assert.match(source,/historyLinks:async/);assert.match(source,/extractNarOfficialHistoryLinks\(html/);assert.equal(cfg.vars.ENABLE_NAR_HISTORY_LINKS,'true');assert.equal(cfg.vars.NAR_PRECOMPUTE_MAX_JOBS,'3');assert.equal(cfg.vars.NAR_PRECOMPUTE_BUDGET_MS,'20000');assert.equal(cfg.vars.JRA_PRECOMPUTE_MAX_JOBS,'1');
});

test('Phase140.2 offline diagnostics preserve 12 restored races, audits and immutable rows', async () => {
 const {diagnoseNarRaceQuality} = await import('../src/prediction/nar-quality-diagnostics.mjs');
 const f=fixture(), meeting=async({date})=>({status:'meeting',track:'川崎',date,raceNumbers:Array.from({length:12},(_,i)=>i+1)});
 for(let i=0;i<4;i++)assert.equal((await f.run({meeting})).saved,3);
 const before=JSON.stringify(f.DB.rows), status=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});
 assert.equal(status.savedRaceCount,12);assert.equal(status.rejectedRowCount,0);
 assert.deepEqual([status.races[0].horseCount,status.races[0].abilityCount,status.races[0].timeCount],[2,2,2]);
 const viewer=await(await api(req(),f.env)).json();assert.equal(viewer.races.length,12);
 for(const row of f.DB.rows){const data=d1RowToSnapshot(row).layers.DATA, original=JSON.stringify(data), out=diagnoseNarRaceQuality(data);assert.strictEqual(out.race,data);assert.equal(out.diagnostics.time.missingActiveCount,0);assert.equal(JSON.stringify(data),original);}
 for(const race of viewer.races){
  const original=JSON.stringify(race), faulty=new Proxy(race,{get(target,key){if(key==='horses')throw Error('forced diagnostic exception');return Reflect.get(target,key);}}),out=diagnoseNarRaceQuality(faulty);
  assert.strictEqual(out.race,faulty);assert.equal(out.diagnostics.reasonCode,'DIAGNOSTIC_ERROR');assert.equal(JSON.stringify(race),original);
  assert.ok('historyStoreAudit' in race);assert.ok('historyLinkAudit' in race);assert.equal(race.researchOnly,true);assert.equal(race.formalKpiEligible,false);assert.equal(race.productionActivationReady,false);
  assert.ok(race.horses.every(h=>h.probability.status==='MODEL_HOLD'&&h.probability.win===null&&h.probability.top3===null));
 }
 const after=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.deepEqual(after,status);assert.equal(JSON.stringify(f.DB.rows),before);
});

const statusWithDiagnostics=(f,extra={})=>readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock(),includeDiagnostics:true,...extra});
async function twelveRaceFixture(){const f=fixture(),meeting=async({date})=>({status:'meeting',track:'川崎',date,raceNumbers:Array.from({length:12},(_,i)=>i+1)});for(let i=0;i<4;i++)assert.equal((await f.run({meeting})).saved,3);return f;}

test('Phase140.3 diagnostics are opt-in and default status remains unchanged',async()=>{
 const f=fixture();await f.run();const before=JSON.stringify(f.DB.rows),normal=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()}),withDiag=await statusWithDiagnostics(f),{qualityDiagnostics,...rest}=withDiag;
 assert.equal('qualityDiagnostics' in normal,false);assert.deepEqual(rest,normal);assert.equal(qualityDiagnostics.races.length,3);assert.equal(qualityDiagnostics.status,'PARTIAL');assert.equal(JSON.stringify(f.DB.rows),before);
 for(const r of qualityDiagnostics.races){assert.equal(r.diagnostics.time.missingActiveCount,0);assert.equal(r.diagnostics.history.heldReferenceCount,null);assert.equal(r.diagnostics.history.status,'UNAVAILABLE');}
});

test('Phase140.3 12 restored races survive every diagnostic throwing with SELECT-only access',async()=>{
 const f=await twelveRaceFixture(),before=JSON.stringify(f.DB.rows),normal=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()}),prepare=f.DB.prepare.bind(f.DB);let selects=0,calls=0;
 f.DB.prepare=sql=>{assert.match(sql,/^SELECT /);selects++;return prepare(sql);};
 const out=await statusWithDiagnostics(f,{diagnoseRace(){calls++;throw Error('PRIVATE_DIAGNOSTIC_ERROR');}}),{qualityDiagnostics,...rest}=out;
 assert.deepEqual(rest,normal);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(out.schemaReady,true);assert.equal(calls,12);assert.ok(selects>0);
 assert.equal(qualityDiagnostics.status,'PARTIAL');assert.ok(qualityDiagnostics.races.every(r=>r.diagnostics.status==='UNAVAILABLE'&&r.diagnostics.reasonCode==='DIAGNOSTIC_ERROR'));
 assert.equal(JSON.stringify(out).includes('PRIVATE_DIAGNOSTIC_ERROR'),false);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('Phase140.3 a single diagnostic failure does not suppress other race diagnostics',async()=>{
 const {diagnoseNarRaceQuality}=await import('../src/prediction/nar-quality-diagnostics.mjs');const f=fixture();await f.run();let calls=0;
 const out=await statusWithDiagnostics(f,{diagnoseRace(data){calls++;if(calls===2)throw Error('forced');return diagnoseNarRaceQuality(data);}});
 assert.equal(out.savedRaceCount,3);assert.equal(out.rejectedRowCount,0);assert.equal(out.qualityDiagnostics.races[1].diagnostics.status,'UNAVAILABLE');assert.equal(out.qualityDiagnostics.races[0].diagnostics.horseCount,2);assert.equal(out.qualityDiagnostics.races[2].diagnostics.horseCount,2);
});

test('Phase140.3 diagnostic result with replaced race fails closed only in sidecar',async()=>{
 const f=fixture();await f.run();const out=await statusWithDiagnostics(f,{diagnoseRace:()=>({race:{},diagnostics:{status:'OBSERVED'}})});
 assert.equal(out.savedRaceCount,3);assert.equal(out.rejectedRowCount,0);assert.ok(out.qualityDiagnostics.races.every(r=>r.diagnostics.reasonCode==='DIAGNOSTIC_ERROR'));
});

test('Phase140.3 actual status handler exposes optional diagnostics on GET, not default or alternate values',async()=>{
 const f=fixture();await f.run();const before=JSON.stringify(f.DB.rows),url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13';
 for(const suffix of ['', '&diagnostics=0','&diagnostics=true']){const body=await(await handlePublicApi(new Request(url+suffix),f.env)).json();assert.equal('qualityDiagnostics' in body,false);assert.equal(body.savedRaceCount,3);}
 const res=await handlePublicApi(new Request(url+'&diagnostics=1'),f.env),body=await res.json();assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(body.qualityDiagnostics.races.length,3);assert.equal(body.savedRaceCount,3);
 const head=await handlePublicApi(new Request(url+'&diagnostics=1',{method:'HEAD'}),f.env);assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal((await handlePublicApi(new Request(url+'&diagnostics=1',{method:'POST'}),f.env)).status,405);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('Phase140.3 missing TIME is diagnosed from restored DATA without Viewer TIME conversion',async()=>{
 const f=fixture();await f.run({card:async j=>({...await f.card(j),horses:[{horseNo:1,horseName:'A',abilityScore:80,predictedTime:'1:30.0',runs:[]},{horseNo:2,horseName:'B',abilityScore:70,predictedTime:null,runs:[],predictedTimeMissingReason:'time_missing_unknown'}]})});
 const out=await statusWithDiagnostics(f);for(const race of out.qualityDiagnostics.races){const d=race.diagnostics;assert.equal(d.time.missingActiveCount,1);assert.equal(d.horses[0].time.status,'AVAILABLE');assert.equal(d.horses[1].time.observation,'UPSTREAM_REASON_UNKNOWN');assert.equal(d.horses[1].time.evidenceObservation,'NO_PARSED_HISTORY');}
 assert.ok(out.races.every(r=>r.timeCount===1&&r.quality.probabilityStatus==='MODEL_HOLD'));assert.equal(out.researchOnly,true);assert.equal(out.formalKpiEligible,false);assert.equal(out.productionActivationReady,false);
});

test('Phase140.3 rejected hash rows never reach diagnostics and are not repaired',async()=>{
 const f=fixture();await f.run();f.DB.rows[0].data_json=f.DB.rows[0].data_json.replace('1:30.0','1:20.0');const before=JSON.stringify(f.DB.rows);let calls=0;
 const out=await statusWithDiagnostics(f,{diagnoseRace(){calls++;throw Error('forced');}});assert.equal(out.savedRaceCount,2);assert.equal(out.rejectedRowCount,1);assert.equal(calls,2);assert.equal(out.qualityDiagnostics.races.length,2);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('Phase140.3 empty status and unreadable schema never fabricate diagnostic success',async()=>{
 const f=fixture(),empty=await statusWithDiagnostics(f);assert.equal(empty.savedRaceCount,0);assert.deepEqual(empty.qualityDiagnostics,{schemaVersion:1,status:'EMPTY',races:[]});let calls=0;
 f.env.DB={prepare(){throw Error('private schema');}};const blocked=await statusWithDiagnostics(f,{diagnoseRace(){calls++;}});assert.equal(blocked.schemaReady,false);assert.equal(blocked.savedRaceCount,null);assert.equal('qualityDiagnostics' in blocked,false);assert.equal(calls,0);
});

test('Phase140.3 all-three-route 404 remains a source failure while 12 saved races stay readable',async()=>{
 const {fetchNarPrecomputeMeeting}=await import('../src/prediction/nar-ability-precompute.mjs');const f=await twelveRaceFixture(),before=JSON.stringify(f.DB.rows);let fetches=0;
 const out=await f.run({meeting:({code,date,timeoutMs})=>fetchNarPrecomputeMeeting({code,date,timeoutMs,fetchImpl:async()=>{fetches++;return new Response('',{status:404});}})});
 assert.equal(fetches,3);assert.equal(out.status,'COMPLETED');assert.equal(out.attempted,0);assert.equal(out.saved,0);assert.equal(out.events[0].reason,'MEETING_SOURCE_UNAVAILABLE');assert.deepEqual(out.events[0].meetingAttempts.map(a=>a.httpStatus),[404,404,404]);
 const status=await statusWithDiagnostics(f);assert.equal(status.savedRaceCount,12);assert.equal(status.rejectedRowCount,0);assert.equal(status.qualityDiagnostics.races.length,12);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('Phase140.3 verified schema-v2 History reasons match retained link audit without rewriting it',async()=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';
 const out=await f.run({card:async j=>{const p=await f.card(j),run={date:'09.30',venue:'川崎',runOrganization:'NAR',timeSec:91.2};p.horses[0].runs=[run,{...run}];p.horses[1].runs=[{...run,venue:'大井'}];return p;},historyLinks:async j=>{const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+Number(h.horseNo)),pastRaceReferences:[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]}))};return {body,linksHash:await stableHash(body)};}});
 assert.equal(out.saved,3);const before=JSON.stringify(f.DB.rows),status=await statusWithDiagnostics(f);assert.equal(status.savedRaceCount,3);assert.equal(status.rejectedRowCount,0);
 for(const r of status.qualityDiagnostics.races){assert.equal(r.diagnostics.status,'OBSERVED');assert.equal(r.diagnostics.history.heldReferenceCount,3);assert.deepEqual(r.diagnostics.history.reasonCounts,{EPISODE_AMBIGUOUS:2,EPISODE_LINK_UNMATCHED:1});assert.equal(status.races.find(x=>x.raceId===r.raceId).historyLinkAudit.heldEpisodeCount,3);}
 assert.equal(JSON.stringify(f.DB.rows),before);assert.equal((await(await api(req(),f.env)).json()).count,3);
});

test('Phase140.4 verified saved DATA exposes input conditions without changing status or frozen values',async()=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';
 const saved=await f.run({card:async j=>{const p=await f.card(j);p.horses[0].runs=[{date:'09.30',venue:'川崎',runOrganization:'NAR',distance:1400,timeSec:90}];p.horses[1]={...p.horses[1],predictedTime:null,predictedTimeMissingReason:'time_missing_unknown',runs:[{date:'09.30',venue:'川崎',runOrganization:'JRA',distance:2000,timeSec:130}]};return p;},historyLinks:async j=>{const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:Number(h.horseNo),horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+Number(h.horseNo)),pastRaceReferences:[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]}))};return {body,linksHash:await stableHash(body)};}});
 assert.equal(saved.saved,3);const before=JSON.stringify(f.DB.rows),normal=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()}),withDiag=await statusWithDiagnostics(f),{qualityDiagnostics,...rest}=withDiag;assert.deepEqual(rest,normal);
 for(const r of qualityDiagnostics.races){const h=r.diagnostics.horses[1];assert.equal(h.time.sourceReason,'time_missing_unknown');assert.equal(h.conditions.time.observation,'NO_FINITE_TIME_WITHIN_300M');assert.equal(h.conditions.time.coverageComplete,true);assert.equal(h.conditions.history.references[0].observation,'ORIGIN_NOT_NAR');assert.equal(h.conditions.history.references[0].origin,'JRA');assert.equal(h.history.heldReferenceCount,1);}
 assert.equal(JSON.stringify(f.DB.rows),before);assert.ok(normal.races.every(r=>r.quality.probabilityStatus==='MODEL_HOLD'));assert.equal((await(await api(req(),f.env)).json()).count,3);
});

test('Phase140.4 optional condition audits preserve 12-race readback when legacy facts are unavailable',async()=>{
 const f=await twelveRaceFixture(),before=JSON.stringify(f.DB.rows),out=await statusWithDiagnostics(f);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(out.qualityDiagnostics.races.length,12);assert.equal(JSON.stringify(f.DB.rows),before);
 assert.ok(out.qualityDiagnostics.races.every(r=>r.diagnostics.horses.every(h=>h.conditions.time.status==='NOT_APPLICABLE')));assert.equal((await(await api(req(),f.env)).json()).races.length,12);
});

async function diagnosticSizeFixture(){
 const counts=[12,8,9,12,12,14,12,14,12,11,11,14],missing={3:[6],8:[11,12],11:[2,6,8,9,11],12:[2]},held={3:{2:1,9:2},7:{4:4,5:2},9:{8:4},10:{2:1,3:4,5:3,8:4,9:4,11:2},11:{10:1}};
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';
 const meeting=async({date})=>({status:'meeting',track:'川崎',date,raceNumbers:Array.from({length:12},(_,i)=>i+1)});
 const card=async j=>({...await f.card(j),horses:Array.from({length:counts[j.race-1]},(_,i)=>{const no=i+1,isMissing=missing[j.race]?.includes(no);return {horseNo:no,horseName:`試験馬${no}`,abilityScore:90-no,predictedTime:isMissing?null:'1:30.0',predictedTimeMissingReason:isMissing?'time_missing_unknown':null,runs:Array.from({length:4},(_,k)=>({date:`09.${30-k}`,venue:'川崎',runOrganization:k<(held[j.race]?.[no]||0)?'JRA':'NAR',distance:isMissing?2000:1400,timeSec:130,sameDistance:!isMissing,sameTrack:true}))};})});
 const historyLinks=async j=>{const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:h.horseNo,horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+h.horseNo),pastRaceReferences:Array.from({length:4},(_,k)=>({date:`2026-09-${30-k}`,code:'21',raceNo:1,raceId:`202609${30-k}-NAR-21-01`}))}))};return {body,linksHash:await stableHash(body)};};
 for(let i=0;i<4;i++)assert.equal((await f.run({meeting,card,historyLinks})).saved,3);return f;
}

test('Phase140.4a real handler reproduces oversized 141-horse full response and returns compact 12/0 with all 9/32 details',async t=>{
 const f=await diagnosticSizeFixture(),before=JSON.stringify(f.DB.rows),url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13&diagnostics=1';
 const full=await handlePublicApi(new Request(url+'&format=full'),f.env);assert.equal(full.status,413);assert.equal((await full.json()).error.code,'RESPONSE_TOO_LARGE');
 const res=await handlePublicApi(new Request(url),f.env),text=await res.text(),body=JSON.parse(text);assert.equal(res.status,200);assert.ok(new TextEncoder().encode(text).length<100000);assert.equal(Number(res.headers.get('X-CHASS-Response-Bytes')),new TextEncoder().encode(text).length);t.diagnostic('Representative compact response bytes: '+new TextEncoder().encode(text).length);assert.equal(body.format,'compact');assert.equal(body.savedRaceCount,12);assert.equal(body.rejectedRowCount,0);assert.equal(body.races.length,12);assert.equal(body.qualityDiagnostics.races.length,12);
 const diag=body.qualityDiagnostics.races.map(r=>r.diagnostics),horses=diag.flatMap(d=>d.horses);assert.equal(diag.reduce((s,d)=>s+d.horseCount,0),141);assert.equal(diag.reduce((s,d)=>s+d.time.missingActiveCount,0),9);assert.equal(diag.reduce((s,d)=>s+d.history.heldReferenceCount,0),32);assert.equal(horses.length,21);assert.equal(horses.filter(h=>h.time.status==='MISSING').length,9);assert.equal(horses.filter(h=>h.history.heldReferenceCount>0).length,12);assert.ok(horses.filter(h=>h.time.status==='MISSING').every(h=>h.conditions.time.observation==='NO_FINITE_TIME_WITHIN_300M'));assert.equal(JSON.stringify(f.DB.rows),before);
 const explicit=await(await handlePublicApi(new Request(url+'&format=compact'),f.env)).json();assert.deepEqual(explicit,body);assert.equal(body.researchOnly,true);assert.equal(body.formalKpiEligible,false);assert.equal(body.productionActivationReady,false);
});

test('Phase140.4a compact race filter supports 30 affected horses within shared byte limit',async t=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';
 const historyLinks=async j=>{const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:h.horseNo,horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+h.horseNo),pastRaceReferences:[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]}))};return {body,linksHash:await stableHash(body)};};
 await f.run({historyLinks,card:async j=>({...await f.card(j),horses:Array.from({length:30},(_,i)=>({horseNo:i+1,horseName:`試験馬${i+1}`,abilityScore:80,predictedTime:null,predictedTimeMissingReason:'time_missing_unknown',runs:Array.from({length:5},()=>({date:'09.30',venue:'川崎',runOrganization:'NAR',distance:2000,timeSec:130}))}))})});
 const url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13&diagnostics=1&format=compact&race=1',res=await handlePublicApi(new Request(url),f.env),text=await res.text(),body=JSON.parse(text);assert.equal(res.status,200);assert.ok(new TextEncoder().encode(text).length<100000);assert.equal(body.savedRaceCount,3);assert.equal(body.races.length,1);assert.equal(body.qualityDiagnostics.races.length,1);assert.equal(body.qualityDiagnostics.races[0].diagnostics.horses.length,30);assert.equal(body.qualityDiagnostics.races[0].diagnostics.history.heldReferenceCount,150);t.diagnostic('Thirty-horse/150-reference compact response bytes: '+new TextEncoder().encode(text).length);assert.equal(body.selectedRaceNo,1);assert.equal(body.countScope,'DATE');assert.equal(res.headers.get('cache-control'),'no-store');
 const head=await handlePublicApi(new Request(url,{method:'HEAD'}),f.env);assert.equal(head.status,200);assert.equal(await head.text(),'');
});

test('Phase140.4a normal status stays full by default and compact format/race validation is explicit',async()=>{
 const f=fixture();await f.run();const before=JSON.stringify(f.DB.rows),url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13';
 const normal=await(await handlePublicApi(new Request(url),f.env)).json();assert.equal('format' in normal,false);assert.equal('qualityDiagnostics' in normal,false);assert.equal(normal.races[0].quality.horses.length,2);
 const full=await(await handlePublicApi(new Request(url+'&format=full'),f.env)).json();assert.deepEqual(full,normal);
 const compact=await(await handlePublicApi(new Request(url+'&format=compact'),f.env)).json();assert.equal(compact.format,'compact');assert.equal(compact.races[0].quality.horses,undefined);assert.equal(compact.races[0].quality.horseCount,2);
 for(const query of ['&format=tabular','&race=0','&race=100','&race=1.5','&race=abc'])assert.equal((await handlePublicApi(new Request(url+query),f.env)).status,400);
 assert.equal((await handlePublicApi(new Request(url+'&race=99'),f.env)).status,404);assert.equal(JSON.stringify(f.DB.rows),before);
});

test('Phase140.6 twelve-race mixed version readback preserves frozen legacy row and resolves new identities',async()=>{
 const f=fixture();f.env.ENABLE_NAR_HISTORY_LINKS='true';
 const meeting=async({date})=>({status:'meeting',track:'川崎',date,raceNumbers:Array.from({length:12},(_,i)=>i+1)});
 const card=async j=>{const p=await f.card(j);p.horses[0].runs=[{date:'09.30',venue:'川崎',runOrganization:'NAR',distance:1400,timeSec:90}];p.horses[1].runs=[{date:'09.30',venue:'金沢',runOrganization:'NAR',distance:1400,timeSec:91},{date:'09.29',venue:'金沢',runOrganization:'NAR',distance:1400,timeSec:92}];return p;};
 const historyLinks=async j=>{const body={status:'IDENTITY_LINKS_RESOLVED',date:j.date,postTime:'12:00',code:j.code,raceNo:j.race,observedAt:new Date(f.clock()).toISOString(),rows:j.expectedHorses.map(h=>({horseNo:h.horseNo,horseName:h.horseName,providerHorseKey:'NAR_LINEAGE:'+String(30012403217+h.horseNo),pastRaceReferences:h.horseNo===1?[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]:[{date:'2026-09-30',code:'22',raceNo:1,raceId:'20260930-NAR-22-01'},{date:'2026-09-29',code:'22',raceNo:1,raceId:'20260929-NAR-22-01'}]}))};return {body,linksHash:await stableHash(body)};};
 for(let i=0;i<4;i++)assert.equal((await f.run({meeting,card,historyLinks})).saved,3);
 const legacy=JSON.parse(await readFile(new URL('./fixtures/nar-legacy-venue-row.json',import.meta.url),'utf8'));
 f.DB.rows.splice(f.DB.rows.findIndex(r=>r.race_id===legacy.race_id),1,legacy);
 const before=JSON.stringify(f.DB.rows),normal=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()}),out=await statusWithDiagnostics(f),{qualityDiagnostics,...rest}=out;assert.deepEqual(rest,normal);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);
 for(const r of qualityDiagnostics.races){const v=r.diagnostics.versions;assert.equal(v.routing.status,r.raceId===legacy.race_id?'LEGACY_UNVERSIONED':'VERSIONED');assert.equal(v.history.legacyUnversionedHorseCount,r.raceId===legacy.race_id?2:0);assert.equal(v.history.versionedHorseCount,r.raceId===legacy.race_id?0:2);const h=r.diagnostics.horses[1];if(r.raceId!==legacy.race_id){assert.equal(h.history.heldReferenceCount,0);continue;}assert.equal(h.history.heldReferenceCount,2);assert.equal(h.conditions.history.references.length,2);for(const ref of h.conditions.history.references){assert.equal(ref.eligibleCandidateCount,0);assert.equal(ref.venueCodeComparison.baselineDateVenueCandidateCount,0);assert.equal(ref.venueCodeComparison.verifiedDateVenueCandidateCount,1);assert.equal(ref.venueCodeComparison.factVenue,'金沢');}}
 const url='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13&diagnostics=1&format=compact&race=3',response=await handlePublicApi(new Request(url),f.env),text=await response.text(),body=JSON.parse(text);assert.equal(response.status,200);assert.ok(new TextEncoder().encode(text).length<100000);assert.equal(body.savedRaceCount,12);assert.equal(body.rejectedRowCount,0);assert.equal(body.qualityDiagnostics.races[0].diagnostics.horses[0].conditions.history.references[0].venueCodeComparison.references[0].comparisonVenue,'金沢');assert.equal(JSON.stringify(f.DB.rows),before);assert.equal((await(await api(req(),f.env)).json()).count,12);
});

test('Phase140.7 mixed legacy/current 22/23 snapshots read without rewriting frozen rows',async()=>{
 const f=fixture(),legacy=JSON.parse(await readFile(new URL('./fixtures/nar-legacy-routing-rows.json',import.meta.url),'utf8'));
 f.DB.rows.push(...structuredClone(legacy));f.env.NAR_PRECOMPUTE_TRACK_CODES='22,23';
 const out=await f.run({meeting:async({code,date})=>({status:'meeting',track:code==='22'?'金沢':'笠松',date,raceNumbers:[2]})});assert.equal(out.saved,2);
 const before=JSON.stringify(f.DB.rows),status=await statusWithDiagnostics(f);assert.equal(status.savedRaceCount,4);assert.equal(status.rejectedRowCount,0);
 for(const code of ['22','23']){const row=f.DB.rows.find(r=>r.race_id===`20261013-NAR-${code}-02`),d=JSON.parse(row.data_json);assert.equal(d.venueRoutingVersion,'NAR_VENUE_ROUTING_22_23_V1');assert.equal(d.race.track,code==='22'?'金沢':'笠松');}
 const all=await(await api(req('day-ai',''),f.env)).json();assert.equal(all.count,4);
 for(const track of ['金沢','笠松']){const body=await(await api(req('day-ai',track),f.env)).json();assert.equal(body.count,2);assert.ok(body.races.every(r=>r.track===track));}
 assert.equal(JSON.stringify(f.DB.rows),before);assert.deepEqual(f.DB.rows.slice(0,2),legacy);
});
test('Phase140.7 unsupported, null and stripped routing versions reject even after outer hash recomputation',async()=>{
 for(const version of [null,'FUTURE',undefined]){const f=fixture();f.env.NAR_PRECOMPUTE_TRACK_CODES='22';await f.run({meeting:async({date})=>({status:'meeting',track:'金沢',date,raceNumbers:[1]})});
  const row=f.DB.rows[0],d=JSON.parse(row.data_json);if(version===undefined)delete d.venueRoutingVersion;else d.venueRoutingVersion=version;row.data_json=JSON.stringify(d);row.snapshot_hash=await createSnapshotHash(d1RowToSnapshot(row));
  const status=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()});assert.equal(status.savedRaceCount,0);assert.equal(status.rejectedRowCount,1);assert.equal(await api(req('day-ai','金沢'),f.env),null);
 }
});
test('Phase140.7 swapped venue card cannot be saved under corrected code',async()=>{
 const f=fixture();f.env.NAR_PRECOMPUTE_TRACK_CODES='22';const out=await f.run({meeting:async({date})=>({status:'meeting',track:'金沢',date,raceNumbers:[1]}),card:async j=>({...await f.card(j),track:'笠松'})});assert.equal(out.saved,0);assert.equal(out.events[0].reason,'CARD_IDENTITY');assert.equal(f.DB.rows.length,0);
});

test('Phase140.8 twelve-race version summaries are SELECT-only and never change counts, hashes or flags',async()=>{
 const f=await twelveRaceFixture(),legacy=JSON.parse(await readFile(new URL('./fixtures/nar-legacy-venue-row.json',import.meta.url),'utf8'));
 f.DB.rows.splice(f.DB.rows.findIndex(r=>r.race_id===legacy.race_id),1,legacy);
 const before=JSON.stringify(f.DB.rows),normal=await readNarAbilityCanaryStatus(f.env,{date:'2026-10-13',now:f.clock()}),prepare=f.DB.prepare.bind(f.DB);let reads=0;
 f.DB.prepare=sql=>{assert.match(sql,/^SELECT /);reads++;return prepare(sql);};
 const out=await statusWithDiagnostics(f),{qualityDiagnostics,...rest}=out;assert.deepEqual(rest,normal);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(qualityDiagnostics.races.length,12);assert.ok(reads>0);
 for(const item of qualityDiagnostics.races){const v=item.diagnostics.versions;assert.equal(v.status,'OBSERVED');assert.equal(v.routing.status,item.raceId===legacy.race_id?'LEGACY_UNVERSIONED':'VERSIONED');assert.equal(v.history.horseCount,2);assert.equal(v.history.legacyUnversionedHorseCount,item.raceId===legacy.race_id?2:0);assert.equal(v.history.notRetainedHorseCount,item.raceId===legacy.race_id?0:2);}
 const prefix='https://example.test/api/chass/v1/public/nar-precompute-status?date=2026-10-13';
 for(const [suffix,count] of [['&diagnostics=1&format=compact',12],['&diagnostics=1&format=compact&race=3',1],['&diagnostics=1&format=full',12]]){const response=await handlePublicApi(new Request(prefix+suffix),f.env),body=await response.json();assert.equal(response.status,200);assert.equal(body.savedRaceCount,12);assert.equal(body.rejectedRowCount,0);assert.equal(body.qualityDiagnostics.races.length,count);assert.ok(body.qualityDiagnostics.races.every(x=>x.diagnostics.versions.scope==='STORED_VERSION_FIELDS_ONLY'));assert.equal(body.researchOnly,true);assert.equal(body.formalKpiEligible,false);assert.equal(body.productionActivationReady,false);}
 assert.equal(JSON.stringify(f.DB.rows),before);assert.equal((await(await api(req(),f.env)).json()).count,12);
});
test('Phase140.8 stored-version diagnostic accessor failure cannot reject any restored race',async()=>{
 const {diagnoseNarRaceQuality}=await import('../src/prediction/nar-quality-diagnostics.mjs'),f=await twelveRaceFixture(),before=JSON.stringify(f.DB.rows),normal=await statusWithDiagnostics(f);
 const out=await statusWithDiagnostics(f,{diagnoseRace(data){const shadow=Object.create(data);Object.defineProperty(shadow,'venueRoutingVersion',{get(){throw Error('PRIVATE_VERSION');}});return {race:data,diagnostics:diagnoseNarRaceQuality(shadow).diagnostics};}});
 const {qualityDiagnostics,...rest}=out,{qualityDiagnostics:baseline,...base}=normal;assert.deepEqual(rest,base);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);
 for(let i=0;i<12;i++){const {versions,...d}=qualityDiagnostics.races[i].diagnostics,{versions:old,...b}=baseline.races[i].diagnostics;assert.deepEqual(d,b);assert.equal(versions.routing.status,'UNAVAILABLE');assert.equal(versions.status,'PARTIAL');}
 assert.equal(JSON.stringify(out).includes('PRIVATE_VERSION'),false);assert.equal(JSON.stringify(f.DB.rows),before);
});
