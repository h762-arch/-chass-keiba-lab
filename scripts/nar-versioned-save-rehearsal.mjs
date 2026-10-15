import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {buildNarRacePayloadStable,handlePublicApi} from '../worker.js';
import {createNarAbilityPrecomputeRunner,fetchNarPrecomputeMeeting,fetchNarPrecomputeHtml,assertNarAbilityCardIdentity,readNarAbilityCanaryStatus,handleNarAbilityViewer} from '../src/prediction/nar-ability-precompute.mjs';
import {extractNarOfficialHistoryLinks} from '../src/prediction/nar-official-history-links.mjs';
import {createSnapshotHash} from '../src/prediction/precomputed-snapshot.mjs';
import {d1RowToSnapshot} from '../src/prediction/precomputed-store.mjs';
import {REHEARSAL_DATE as date,REHEARSAL_AT as at,REHEARSAL_SCENARIOS,versionedSaveFixture} from '../tests/fixtures/nar/phase1409-versioned-save-fixtures.mjs';

const context={evidenceKind:'SYNTHETIC_REHEARSAL',productionEvidence:false,database:'SQLITE_MEMORY',transport:'FIXTURE_ONLY',researchOnly:true,formalKpiEligible:false,productionActivationReady:false,probabilityStatus:'MODEL_HOLD'};
// No DB path, environment bindings, source URL, fetcher or production flag is accepted.
export async function runNarVersionedSaveRehearsal(scenario='baseline'){
 if(!REHEARSAL_SCENARIOS.includes(scenario))return {...context,status:'REJECTED',reasonCode:'SCENARIO_UNSUPPORTED'};
 const sql=new DatabaseSync(':memory:');let readOnly=false,writeCount=0;const requests=[];
 try{
  for(const file of ['0012_precomputed_snapshots.sql','0014_nar_shared_history.sql'])sql.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  const DB={prepare(text){let args=[];const allowed=()=>{if(readOnly&&!/^\s*SELECT\b/i.test(text))throw Error('REHEARSAL_READ_ONLY');};return {bind(...a){args=a;return this;},async all(){allowed();return {results:sql.prepare(text).all(...args)};},async first(){allowed();return sql.prepare(text).get(...args)||null;},async run(){allowed();writeCount++;const r=sql.prepare(text).run(...args);return {meta:{changes:Number(r.changes)}};}};}};
  const fixtureFetch=async input=>{const url=String(input),body=versionedSaveFixture(url,scenario);requests.push(new URL(url).pathname);return new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});};
  const env={DB,ENABLE_NAR_ABILITY_PRECOMPUTE:'true',ENABLE_NAR_ABILITY_VIEWER:'true',ENABLE_NAR_HISTORY_LINKS:'true',ENABLE_NAR_SHARED_HISTORY:'true',NAR_PRECOMPUTE_TRACK_CODES:'22,23',NAR_PRECOMPUTE_MAX_JOBS:'2',NAR_PRECOMPUTE_BUDGET_MS:'20000',NAR_PRECOMPUTE_CANARY_DATE:date,NAR_PRECOMPUTE_STOP_AT:date+'T14:55:00+09:00'};
  const urlFor=(path,code,race)=>`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/${path}?k_babaCode=${code}&k_raceDate=${encodeURIComponent(date.replaceAll('-','/'))}&k_raceNo=${race}`;
  const run=createNarAbilityPrecomputeRunner(env,{wallNow:()=>Date.parse(at),scheduledTime:0,
   meeting:job=>fetchNarPrecomputeMeeting({...job,fetchImpl:fixtureFetch}),
   card:async({code,date,race,track,timeoutMs})=>{
    const detail=urlFor('DebaTableSmall',code,race),html=await fetchNarPrecomputeHtml(detail,{timeoutMs,fetchImpl:fixtureFetch});assertNarAbilityCardIdentity(html,{date,track,race});
    return buildNarRacePayloadStable({code,date,race,urls:{detail,card:'OPTIONAL_DISABLED',odds:'OPTIONAL_DISABLED'},fetcher:async u=>{if(u!==detail)throw Error('OPTIONAL_DISABLED');return html;}});
   },historyLinks:async({code,date,race,track,timeoutMs,expectedHorses})=>{
    const sourceUrl=urlFor('DebaTable',code,race),html=await fetchNarPrecomputeHtml(sourceUrl,{timeoutMs,fetchImpl:fixtureFetch});
    return extractNarOfficialHistoryLinks(html,{sourceUrl,date,track,code,raceNo:race,observedAt:at,expectedHorses});
   }});
  const first=await run();
  if(scenario==='tampered_readback'){
   const row=sql.prepare("SELECT * FROM precomputed_race_snapshots WHERE race_id=?").get('20261016-NAR-22-01'),data=JSON.parse(row.data_json);data.venueRoutingVersion='UNSUPPORTED_REHEARSAL_VERSION';row.data_json=JSON.stringify(data);row.snapshot_hash=await createSnapshotHash(d1RowToSnapshot(row));
   sql.prepare('UPDATE precomputed_race_snapshots SET data_json=?,snapshot_hash=? WHERE race_id=?').run(row.data_json,row.snapshot_hash,row.race_id);
  }
  const snapshots=()=>sql.prepare('SELECT * FROM precomputed_race_snapshots ORDER BY race_id,revision').all();
  const observations=()=>sql.prepare('SELECT * FROM nar_shared_history_observations ORDER BY observation_hash').all();
  const before=JSON.stringify({snapshots:snapshots(),observations:observations()}),writesBeforeRead=writeCount;
  readOnly=true;
  const status=await readNarAbilityCanaryStatus(env,{date,now:Date.parse(at),includeDiagnostics:true});
  const response=await handlePublicApi(new Request(`https://rehearsal.invalid/api/chass/v1/public/nar-precompute-status?date=${date}&diagnostics=1&format=compact`),env),compact=await response.json();
  const viewer=await handleNarAbilityViewer(new Request(`https://rehearsal.invalid/api/chass/v1/public/day-ai?organization=NAR&date=${date}`),env),view=viewer?await viewer.json():{count:0,races:[]};
  const rerun=await run(),rows=snapshots(),sharedCount=observations().length;
  const expectedSaved=scenario==='swapped_card'?1:2,expectedRejected=scenario==='tampered_readback'?1:0,expectedRead=expectedSaved-expectedRejected,expectedShared=['swapped_card','history_link_failure'].includes(scenario)?4:8;
  const races=rows.map(row=>{const d=JSON.parse(row.data_json),diag=status.qualityDiagnostics.races.find(r=>r.raceId===row.race_id)?.diagnostics;return {raceId:row.race_id,track:d.race.track,horseCount:d.horses.length,timeCount:d.horses.filter(h=>h.predictedTime).length,linkStatus:d.historyLinkAudit.status,storeReason:d.historyStoreAudit.reasonCode,resolvedEpisodeCount:d.historyLinkAudit.resolvedEpisodeCount??0,preAnalysisContract:d.preAnalysisPack.body.contractVersion,rollingAvailableCount:d.horses.reduce((n,h)=>n+(h.rollingHistory?.body.availableCount||0),0),versions:diag?.versions??null,readerAccepted:!!diag};});
  const checks={expectedSaves:first.saved===expectedSaved,expectedReadback:status.savedRaceCount===expectedRead&&status.rejectedRowCount===expectedRejected&&view.count===expectedRead,expectedSharedObservations:sharedCount===expectedShared,
   compactPreservesCounts:response.status===200&&compact.savedRaceCount===expectedRead&&compact.rejectedRowCount===expectedRejected&&compact.qualityDiagnostics.races.length===expectedRead,
   boundedRouting:rows.every(row=>{const d=JSON.parse(row.data_json);return d.race.track===(row.race_id.includes('-22-')?'金沢':'笠松');}),
   expectedLinkStates:races.every(r=>r.linkStatus===(scenario==='history_link_failure'&&r.raceId.includes('-22-')?'HOLD':'RESOLVED')),
   preAnalysisV4:races.every(r=>r.preAnalysisContract==='CHASS_PRE_ANALYSIS_PACK_V4'),
   expectedRollingProjection:races.reduce((n,r)=>n+r.rollingAvailableCount,0)===expectedShared,
   observedRoutingVersions:status.qualityDiagnostics.races.every(r=>r.diagnostics.versions.routing.status==='VERSIONED'),
   modelHold:status.races.every(r=>r.quality.probabilityStatus==='MODEL_HOLD')&&view.races.every(r=>r.horses.every(h=>h.probability.win===null&&h.probability.status==='MODEL_HOLD')),
   noMarketLayers:rows.every(r=>!r.market_json&&!r.final_json&&!r.result_json),
   fixturePathsOnly:requests.every(p=>['/KeibaWeb/TodayRaceInfo/RaceList','/KeibaWeb/TodayRaceInfo/DebaTableSmall','/KeibaWeb/TodayRaceInfo/DebaTable'].includes(p)),
   readAndRerunNoWrites:writeCount===writesBeforeRead,rerunPreservesRows:rerun.saved===0&&rerun.events.filter(e=>e.reason==='ALREADY_SAVED').length===expectedSaved&&before===JSON.stringify({snapshots:snapshots(),observations:observations()}),
   expectedTimeGaps:status.races.reduce((n,r)=>n+r.horseCount-r.timeCount,0)===(scenario==='time_gap'?1:0),
   expectedIdentityVersions:status.qualityDiagnostics.races.every(r=>{const h=r.diagnostics.versions.history;return h.versionedHorseCount===(scenario==='history_link_failure'&&r.raceId.includes('-22-')?0:2)&&h.notRetainedHorseCount===(scenario==='history_link_failure'&&r.raceId.includes('-22-')?2:0);})};
  return {...context,status:Object.values(checks).every(Boolean)?'PASS':'FAIL',scenario,date,first:{attempted:first.attempted,saved:first.saved,events:first.events},rerun:{attempted:rerun.attempted,saved:rerun.saved,events:rerun.events},savedRaceCount:status.savedRaceCount,rejectedRowCount:status.rejectedRowCount,sharedObservationCount:sharedCount,fixtureRequestCount:requests.length,resultPageRequestCount:requests.filter(p=>p.endsWith('/RaceMarkTable')).length,checks,races};
 }catch{return {...context,status:'FAIL',scenario,reasonCode:'REHEARSAL_EXECUTION_FAILED'};}
 finally{sql.close();}
}
export async function runNarVersionedSaveRehearsalCli(args){
 if(args.length!==0&&(args.length!==2||args[0]!=='--scenario'))return {...context,status:'REJECTED',reasonCode:'CLI_ARGUMENTS_UNSUPPORTED'};
 return runNarVersionedSaveRehearsal(args.length===0?'baseline':args[1]);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await runNarVersionedSaveRehearsalCli(process.argv.slice(2));process.stdout.write(JSON.stringify(report,null,2)+'\n');process.exitCode=report.status==='PASS'?0:1;}
