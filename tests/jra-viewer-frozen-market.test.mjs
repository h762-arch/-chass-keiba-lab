import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {runMarketRevision} from '../src/prediction/background-precompute.mjs';
import {snapshotToD1Values} from '../src/prediction/precomputed-store.mjs';
import {projectJraPrecomputedViewerRace} from '../src/prediction/jra-precomputed-viewer-reader.mjs';
import {readJraViewerFrozenMarket,composeJraFrozenMarketResponse,FROZEN_MARKET_VIEWER_MODE} from '../src/prediction/jra-viewer-frozen-market.mjs';
import {sanitizeViewerDayPayload,viewerAllowsMarketOverlay} from '../viewer/viewer-core.js';
import {handlePublicApi} from '../worker.js';

const date='2026-10-10',raceId='20261010-JRA-東京-01',now=Date.parse('2026-10-11T00:00:00Z');
const cols='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';
const toRow=(s,revision)=>Object.fromEntries(cols.split(',').map((c,i)=>[c,snapshotToD1Values(s,{revision})[i]]));
async function fixture(change=()=>{}){
 const source={organization:'JRA',raceId,race:{date,racecourse:'東京',raceNo:1,postTime:'10:00'},horses:[{horseNo:1,runningStatus:'active'},{horseNo:2,runningStatus:'active'}]};
 const data={schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:{date,racecourse:'東京',raceNo:1},horses:[{horseNo:1,horseName:'Alpha',abilityRank:1,overall:80,win:60,place:80,abilityMark:'◎'},{horseNo:2,horseName:'Beta',abilityRank:2,overall:70,win:40,place:70,abilityMark:'○'}]};
 const base=await createPrecomputedSnapshot({organization:'JRA',raceId,source,data,versions:{calculationVersion:'jra-ability-data-v2',modelVersion:'10.0.1-jra-drive1-ability'},now:'2026-10-09T23:00:00Z'});
 const m={schemaVersion:1,organization:'JRA',raceId,horses:[{horseNo:1,odds:2,popularity:1},{horseNo:2,odds:3,popularity:2}],acquiredAt:'2026-10-09T23:59:00Z',frozenAt:'2026-10-10T00:00:00Z',source:'JRA_OFFICIAL',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html',parserVersion:'jra-official-win-odds-v1',contentHash:'a'.repeat(64),coverage:1,activeHorseCount:2,complete:true,frozen:true,freezePolicy:'FIRST_COMPLETE_MARKET_V1',dataSnapshotHash:base.snapshotHash};
 change(m);
 const next=await runMarketRevision(base,m,{at:m.frozenAt});
 const early=toRow(base,1),row={...toRow(next,2),base_hash:base.snapshotHash,base_data:early.data_json,base_source:early.source_json,base_input:early.input_hash,base_status:early.status,base_calc:early.calculation_version,base_model:early.model_version,early_data:early.data_json};
 const item=projectJraPrecomputedViewerRace(early,{raceId});
 const calls=[];const DB={prepare(sql){assert.match(sql,/^SELECT /);assert.doesNotMatch(sql,/jra_official_cache|FROM races\b|INSERT|UPDATE|DELETE|final_json|result_json/);calls.push(sql);return {bind(...args){assert.deepEqual(args,[1,'JRA',raceId]);return {first:async()=>row}}}}};
 return {base,next,early,row,item,DB,calls};
}

test('frozen historical MARKET retains its original prices without freshness reacquisition',async()=>{
 const f=await fixture();const m=await readJraViewerFrozenMarket(f.DB,f.item,{now});
 assert.equal(m.status,'READY');assert.deepEqual(m.horses,[{horseNo:1,odds:2,popularity:1},{horseNo:2,odds:3,popularity:2}]);assert.equal(f.calls.length,1);
});
test('composition attaches market separately and preserves every DATA output',async()=>{
 const f=await fixture(),before=JSON.stringify(f.item);
 const payload={ok:true,date,track:'東京',organization:'JRA',viewerMode:'precomputed-early-data-only',marketEvaluation:'disabled',races:[f.item]};
 const response=new Response(JSON.stringify(payload),{headers:{'X-CHASS-Viewer-Mode':'precomputed-early-data-only'}});
 const body=await (await composeJraFrozenMarketResponse(response,f.DB,{now})).json();
 assert.equal(body.viewerMode,FROZEN_MARKET_VIEWER_MODE);assert.equal(JSON.stringify(f.item),before);
 for(let i=0;i<2;i++)for(const [k,v] of Object.entries(f.item.horses[i]))assert.deepEqual(body.races[0].horses[i][k],v);
 assert.equal(body.races[0].race.marketFreeze.coverage,1);
 const day=sanitizeViewerDayPayload(body);assert.equal(viewerAllowsMarketOverlay(day),false);
 assert.equal(day.races[0].horses[0].odds,2);assert.equal(day.races[0].horses[0].marketStatus,'frozen');
 for(const h of body.races[0].horses)for(const k of ['expectedValue','diamond','warning'])assert.equal(k in h,false);
 const app=readFileSync(new URL('../viewer/viewer-app.js',import.meta.url),'utf8');
 const fn=app.match(/function liveExpectedValue\(horse\) \{[\s\S]*?\n\}/)[0];
 const c=vm.createContext({});vm.runInContext(fn,c);
 assert.equal(c.liveExpectedValue(day.races[0].horses[0]),null);
 assert.equal(c.liveExpectedValue({aiWinRate:.6,odds:2}),1.2);
});
for(const [name,change,reason] of [
 ['race identity',m=>{m.raceId='20261010-JRA-京都-01'},'MARKET_IDENTITY'],
 ['incomplete field',m=>{m.horses.pop()},'MARKET_INCOMPLETE'],
 ['duplicate runner',m=>{m.horses[1].horseNo=1},'MARKET_INCOMPLETE'],
 ['different runner',m=>{m.horses[1].horseNo=3},'MARKET_INCOMPLETE'],
 ['invalid odds',m=>{m.horses[0].odds=0},'MARKET_INCOMPLETE'],
 ['invalid popularity',m=>{m.horses[0].popularity=null},'MARKET_INCOMPLETE'],
 ['not frozen',m=>{m.frozen=false},'MARKET_INCOMPLETE'],
 ['wrong base hash',m=>{m.dataSnapshotHash='b'.repeat(64)},'DATA_HASH'],
 ['after post',m=>{m.frozenAt='2026-10-10T01:00:00Z'},'MARKET_TIME'],
 ['reversed times',m=>{m.acquiredAt='2026-10-10T00:01:00Z'},'MARKET_TIME'],
 ['unofficial source',m=>{m.sourceUrl='https://example.test/odds'},'MARKET_SOURCE']
])test(`${name} retains ability but refuses market`,async()=>{const f=await fixture(change);const m=await readJraViewerFrozenMarket(f.DB,f.item,{now});assert.equal(m.status,'HOLD');assert.equal(m.reason,reason);assert.equal('horses' in m,false)});
test('future freeze, changed earliest DATA and tampered snapshot fail closed',async()=>{
 const f=await fixture();assert.equal((await readJraViewerFrozenMarket(f.DB,f.item,{now:Date.parse('2026-10-09T23:59:30Z')})).reason,'MARKET_TIME');
 f.row.early_data='{}';assert.equal((await readJraViewerFrozenMarket(f.DB,f.item,{now})).reason,'DATA_BINDING');
 f.row.early_data=f.row.data_json;f.row.snapshot_hash='b'.repeat(64);assert.equal((await readJraViewerFrozenMarket(f.DB,f.item,{now})).reason,'MARKET_HASH');
});
test('missing MARKET and failed reads preserve all ability horses with an explicit reason',async()=>{
 const f=await fixture();
 for(const [first,reason] of [[async()=>null,'MARKET_NOT_SAVED'],[async()=>{throw new Error('DB down')},'MARKET_READ_OR_VALIDATION_FAILED']]){
  const DB={prepare(){return {bind(){return {first}}}}};
  const response=new Response(JSON.stringify(f.item),{headers:{'X-CHASS-Viewer-Mode':'precomputed-early-data-only'}});
  const body=await (await composeJraFrozenMarketResponse(response,DB,{now})).json();
  assert.deepEqual(body.horses,f.item.horses);assert.equal(body.race.marketFreeze.reason,reason);assert.equal(body.race.marketAvailable,false);
 }
});
test('real Worker composes frozen MARKET while the DATA reader response stays unchanged',async()=>{
 const f=await fixture(),sqls=[];
 const DB={prepare(sql){assert.match(sql,/^SELECT /);sqls.push(sql);return {bind(){return {all:async()=>({results:[f.early]}),first:async()=>f.row}}}}};
 const response=await handlePublicApi(new Request(`https://example.test/api/chass/v1/public/day?date=${date}&organization=JRA&track=東京`),{ENABLE_PRECOMPUTED_VIEWER:'true',DB});
 assert.equal(response.status,200);const body=await response.json();
 assert.equal(body.viewerMode,FROZEN_MARKET_VIEWER_MODE);assert.equal(body.races[0].horses[0].odds,2);
 assert.equal(sqls.length,2);assert.doesNotMatch(sqls[0],/market_json/);assert.match(sqls[1],/LEFT JOIN/);
});
test('composition bypasses NAR, summaries, errors and oversized day payloads without market reads',async()=>{
 const f=await fixture(),DB={prepare(){assert.fail('unexpected market query')}};
 for(const response of [new Response('{}'),new Response('{}',{status:503,headers:{'X-CHASS-Viewer-Mode':'precomputed-early-data-only'}}),new Response(JSON.stringify({races:[{raceNo:1}]}),{headers:{'X-CHASS-Viewer-Mode':'precomputed-early-data-only'}}),new Response(JSON.stringify({races:Array(13).fill(f.item)}),{headers:{'X-CHASS-Viewer-Mode':'precomputed-early-data-only'}})]){
  assert.equal(await composeJraFrozenMarketResponse(response,DB,{now}),response);
 }
});
test('real SQLite selects first MARKET and binds the parent to earliest DATA',async t=>{
 const f=await fixture(),dir=mkdtempSync(join(tmpdir(),'chass-viewer-market-')),path=join(dir,'db.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const script=`import sqlite3,json,sys
x=json.load(sys.stdin)
with sqlite3.connect(x['path']) as db:
 db.row_factory=sqlite3.Row
 if 'schema' in x:
  db.executescript(x['schema'])
  for r in x['rows']: db.execute(x['insert'],r)
  print('null')
 else:
  r=db.execute(x['sql'],x['args']).fetchone()
  print(json.dumps(dict(r) if r else None))`;
 const run=x=>{const p=spawnSync('python3',['-c',script],{input:JSON.stringify({path,...x}),encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout)};
 const later=await runMarketRevision(f.base,{...f.next.layers.MARKET,horses:[{horseNo:1,odds:99,popularity:2},{horseNo:2,odds:1.1,popularity:1}]},{at:'2026-10-10T00:10:00Z'});
 run({schema:readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'),insert:`INSERT INTO precomputed_race_snapshots (${cols}) VALUES (${Array(21).fill('?').join(',')})`,rows:[snapshotToD1Values(f.base,{revision:1}),snapshotToD1Values(f.next,{revision:2}),snapshotToD1Values(later,{revision:3})]});
 const DB={prepare(sql){assert.match(sql,/^SELECT /);return {bind(...args){return {first:async()=>run({sql,args})}}}}};
 const m=await readJraViewerFrozenMarket(DB,f.item,{now});assert.equal(m.status,'READY');assert.equal(m.revision,2);assert.equal(m.horses[0].odds,2);
});
