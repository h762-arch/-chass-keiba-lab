import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {snapshotToD1Values,readLatestPrecomputedSnapshot} from '../src/prediction/precomputed-store.mjs';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {createJraPrecomputedMarketBridge,saveFirstJraMarket,readVerifiedJraMarketOdds} from '../src/prediction/jra-precomputed-market-bridge.mjs';
const time=Date.parse('2026-10-10T00:00:00Z');
const job={organization:'JRA',date:'2026-10-10',track:'東京',raceNo:1,raceId:'20261010-JRA-東京-01'};
async function setup(){
 const source={organization:'JRA',raceId:job.raceId,race:{date:job.date,racecourse:job.track,raceNo:1,postTime:'10:00'},horses:[{horseNo:1,runningStatus:'active'},{horseNo:2,runningStatus:'active'},{horseNo:3,runningStatus:'scratched'}]};
 const base={...await createPrecomputedSnapshot({raceId:job.raceId,organization:'JRA',source,data:{horses:[{horseNo:1,score:80}]},now:'2026-10-09T23:00:00.000Z'}),revision:1};
 const body={organization:'JRA',date:job.date,track:job.track,race:1,source:'JRA_OFFICIAL',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html',parserVersion:'jra-official-win-odds-v1',oddsSnapshotType:'live',odds:[{horseNo:1,odds:2.1,popularity:1},{horseNo:2,odds:4.3,popularity:2}],quality:{complete:true,oddsCoverage:1,activeHorseCount:2,oddsHorseCount:2},bridgeCache:{fetchedAt:'2026-10-09T23:59:00.000Z',expiresAt:'2026-10-10T00:20:00.000Z',contentHash:'a'.repeat(64)}};
 let prior=null,saved=null,reads=0;
 const options={DB:{prepare(){return {bind(){return {first:async()=>prior}}}}},now:()=>time,deadline:time+5000,readLatest:async()=>base,readOdds:async()=>{reads++;return {body}},save:async(_db,next)=>{saved=next;return {status:'FROZEN',saved:true}}};
 return {base,body,options,run:()=>createJraPrecomputedMarketBridge(options)(job),get saved(){return saved},get reads(){return reads},freeze(){prior={revision:2}}};
}
test('complete active field freezes only MARKET and preserves DATA hashes/timestamps',async()=>{
 const s=await setup();assert.equal((await s.run()).status,'FROZEN');
 assert.deepEqual(s.saved.layers.DATA,s.base.layers.DATA);assert.deepEqual(s.saved.layers.SOURCE,s.base.layers.SOURCE);
 for(const key of ['inputHash','sourceHash','dataCalculatedAt','sourceValidatedAt','calculatedAt'])assert.equal(s.saved[key],s.base[key]);
 assert.equal(s.saved.layers.MARKET.horses.length,2);assert.equal(s.saved.layers.MARKET.frozen,true);
 assert.equal(s.saved.layers.FINAL,null);assert.equal(s.saved.layers.RESULT,null);
 s.freeze();s.body.odds[0].odds=99;assert.equal((await s.run()).status,'PRESERVED');assert.equal(s.reads,1);
});
for(const [name,change] of [
 ['wrong race',s=>{s.body.race=2}],['incomplete',s=>{s.body.odds.pop()}],
 ['duplicate horse',s=>{s.body.odds[1].horseNo=1}],['scratched horse',s=>{s.body.odds[1].horseNo=3}],
 ['missing rank',s=>{s.body.odds[1].popularity=null}],['future acquisition',s=>{s.body.bridgeCache.fetchedAt='2026-10-10T00:01:00Z'}],
 ['expired odds',s=>{s.body.bridgeCache.expiresAt='2026-10-10T00:00:00Z'}],['final market',s=>{s.body.oddsSnapshotType='final'}],
 ['unknown post time',s=>{s.base.layers; s.options.readLatest=async()=>({...s.base,layers:{...s.base.layers,SOURCE:{...s.base.layers.SOURCE,race:{...s.base.layers.SOURCE.race,postTime:''}}}})}],
 ['deadline',s=>{s.options.deadline=time}],['after post',s=>{s.options.now=()=>time+3600000;s.options.deadline=time+7200000}]
])test(`${name} never saves`,async()=>{const s=await setup();change(s);assert.equal((await s.run()).status,'HOLD');assert.equal(s.saved,null)});
test('atomic save checks all historical MARKET rows and expected latest revision',async()=>{
 const s=await setup();await s.run();let args;
 const DB={prepare(sql){
  assert.match(sql,/NOT EXISTS/);assert.match(sql,/market_json IS NOT NULL/);assert.match(sql,/MAX\(revision\)/);assert.match(sql,/snapshot_hash=\?/);
  return {bind(...values){args=values;return {run:async()=>({success:true,meta:{changes:0}})}}};
 }};
 assert.equal((await saveFirstJraMarket(DB,s.saved,s.base,{createdAt:new Date(time).toISOString()})).status,'HOLD');
 assert.equal(args[2],2);assert.equal(args.at(-1),s.base.snapshotHash);
});
test('cache integrity validates exact persisted bytes and rejects tampering',async()=>{
 const s=await setup();const payload={...s.body,ok:true,acquiredAt:s.body.bridgeCache.fetchedAt};delete payload.bridgeCache;
 const text=JSON.stringify(payload),row={payload_json:text,source_url:payload.sourceUrl,fetched_at:payload.acquiredAt,expires_at:s.body.bridgeCache.expiresAt,parser_version:payload.parserVersion,content_hash:createHash('sha256').update(text).digest('hex')};
 const env={DB:{prepare(){return {bind(){return {first:async()=>row}}}}}};
 const opts={date:job.date,track:job.track,race:1,nowMs:time};
 assert.ok(await readVerifiedJraMarketOdds(env,opts));row.payload_json=text+' ';
 await assert.rejects(readVerifiedJraMarketOdds(env,opts),/integrity/);
});
test('real SQLite competing freezes append once; reopen keeps Original MARKET',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'chass-market-')),path=join(directory,'market.sqlite');
 t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const python=`import json,sqlite3,sys
x=json.load(sys.stdin)
with sqlite3.connect(x['path']) as db:
 db.row_factory=sqlite3.Row
 if x.get('schema'): db.executescript(x['sql']); print('null')
 else:
  c=db.execute(x['sql'],x['args'])
  print(json.dumps((dict(r) if (r:=c.fetchone()) is not None else None) if x['first'] else {'success':True,'meta':{'changes':max(c.rowcount,0)}}))`;
 const query=(sql,args=[],first=false,schema=false)=>{
  const p=spawnSync('python3',['-c',python],{input:JSON.stringify({path,sql,args,first,schema}),encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
 };
 query(readFileSync(new URL('../migrations/0012_precomputed_snapshots.sql',import.meta.url),'utf8'),[],false,true);
 const s=await setup();await s.run();
 const cols='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';
 query(`INSERT INTO precomputed_race_snapshots (${cols}) VALUES (${Array(21).fill('?').join(',')})`,snapshotToD1Values(s.base,{revision:1}));
 const DB={prepare(sql){return {bind(...args){return {first:async()=>query(sql,args,true),run:async()=>query(sql,args)}}}}};
 const competing=await Promise.all([saveFirstJraMarket(DB,s.saved,s.base,{createdAt:new Date(time).toISOString()}),saveFirstJraMarket(DB,s.saved,s.base,{createdAt:new Date(time).toISOString()})]);
 assert.deepEqual(competing.map(r=>r.status).sort(),['FROZEN','HOLD']);
 assert.equal(query('SELECT COUNT(*) AS n FROM precomputed_race_snapshots',[],true).n,2);
 const reopened=await readLatestPrecomputedSnapshot(DB,'JRA',job.raceId);
 assert.deepEqual(reopened.layers.MARKET,s.saved.layers.MARKET);
 const run=createJraPrecomputedMarketBridge({DB,now:()=>time,deadline:time+5000,readOdds:async()=>assert.fail('Frozen market must not reacquire')});
 assert.equal((await run(job)).status,'PRESERVED');
});
