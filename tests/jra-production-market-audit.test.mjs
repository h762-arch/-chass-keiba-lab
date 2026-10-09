import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditJraProductionMarket,marketAuditQueries,readProductionMarketAudit} from '../scripts/jra-production-market-audit.mjs';
import {createPrecomputedSnapshot,appendLayerRevision} from '../src/prediction/precomputed-snapshot.mjs';
import {snapshotToD1Values} from '../src/prediction/precomputed-store.mjs';
import {rotateJraPrecomputePlanningJobs} from '../src/prediction/jra-precompute-scheduling-contract.mjs';
const date='2026-10-10',now=Date.parse('2026-10-10T00:00:00Z');
const columns='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at'.split(',');
const row=(s,n)=>Object.fromEntries(columns.map((k,i)=>[k,snapshotToD1Values(s,{revision:n,createdAt:'2026-10-09T23:59:00Z'})[i]]));
async function fixture(count=1){
 const meetings=['東京','京都'].slice(0,count>12?2:1).map((track,i)=>({organization:'JRA',date,track,status:'meeting',raceNumbers:Array.from({length:Math.min(count-i*12,12)},(_,n)=>n+1)}));
 const meetingRows=[{date,status:'complete',meetings_json:JSON.stringify(meetings),checked_at:'2026-10-09T23:00:00Z',next_refresh_at:'2026-10-10T05:00:00Z',source:'JRA_OFFICIAL',parser_version:'jra-program-v1',error_code:null}];
 const snapshotRows=[],jobs=[];
 for(const meeting of meetings)for(const raceNo of meeting.raceNumbers){
  const raceId=`20261010-JRA-${meeting.track}-${String(raceNo).padStart(2,'0')}`;
  jobs.push({organization:'JRA',date,track:meeting.track,raceNo,raceId});
  const s=await createPrecomputedSnapshot({organization:'JRA',raceId,source:{organization:'JRA',raceId,race:{date,racecourse:meeting.track,raceNo,postTime:'10:00'},horses:[{horseNo:1,runningStatus:'active'},{horseNo:2,runningStatus:'active'}]},data:{scores:[80,70]},now:'2026-10-09T23:00:00Z'});
  const market={organization:'JRA',raceId,source:'JRA_OFFICIAL',sourceUrl:'https://www.jra.go.jp/JRADB/accessD.html',parserVersion:'jra-official-win-odds-v1',contentHash:'a'.repeat(64),dataSnapshotHash:s.snapshotHash,acquiredAt:'2026-10-09T23:58:00Z',frozenAt:'2026-10-09T23:59:00Z',frozen:true,freezePolicy:'FIRST_COMPLETE_MARKET_V1',complete:true,coverage:1,activeHorseCount:2,horses:[{horseNo:1,odds:2,popularity:1},{horseNo:2,odds:3,popularity:2}]};
  snapshotRows.push(row(s,1),row(await appendLayerRevision(s,'MARKET',market,{at:market.frozenAt}),2));
 }
 return {date,now,meetingRows,snapshotRows,jobs};
}
test('24 race audit validates first MARKET and repeat observation',async()=>{
 const f=await fixture(24),baseline=await auditJraProductionMarket(f);
 assert.equal(baseline.status,'PASS');assert.equal(baseline.passCount,24);
 const next=await auditJraProductionMarket({...f,now:now+360000,baseline});
 assert.equal(next.status,'PASS');assert.equal(next.observation,'PASS');assert.equal(next.formalKpiAdopted,false);
});
test('missing MARKET is HOLD, never successful coverage',async()=>{
 const f=await fixture();f.snapshotRows.pop();const r=await auditJraProductionMarket(f);
 assert.equal(r.status,'HOLD');assert.equal(r.missingCount,1);
});
test('corrupt MARKET rejects hash rather than resealing',async()=>{
 const f=await fixture();const m=JSON.parse(f.snapshotRows[1].market_json);m.horses[0].odds=90;f.snapshotRows[1].market_json=JSON.stringify(m);
 assert.equal((await auditJraProductionMarket(f)).status,'FAIL');
});
test('missing original DATA parent rejects Freeze',async()=>{
 const f=await fixture();f.snapshotRows.shift();assert.equal((await auditJraProductionMarket(f)).status,'FAIL');
});
test('malformed JSON is isolated as a race failure',async()=>{
 const f=await fixture();f.snapshotRows[1].market_json='{';assert.equal((await auditJraProductionMarket(f)).status,'FAIL');
});
test('baseline detects disappearance of original frozen MARKET',async()=>{
 const f=await fixture(),baseline=await auditJraProductionMarket(f);f.snapshotRows.pop();
 const r=await auditJraProductionMarket({...f,baseline});assert.equal(r.status,'FAIL');assert.equal(r.observation,'FAIL');
});
test('baseline date mismatch is blocked',async()=>{
 const f=await fixture(),baseline=await auditJraProductionMarket(f);baseline.targetDate='2026-10-11';
 await assert.rejects(auditJraProductionMarket({...f,baseline}),/BASELINE_IDENTITY/);
});
test('SQL is two date-scoped SELECTs; injection is rejected',()=>{
 for(const sql of Object.values(marketAuditQueries(date)))assert.match(sql,/^SELECT /);
 assert.throws(()=>marketAuditQueries("2026-10-10' OR 1=1"));
});
test('24 race planning rotation reaches each first MARKET candidate under caps 4/1',async()=>{
 const {jobs}=await fixture(24),seen=new Set();
 for(let turn=0;turn<24;turn++)seen.add(rotateJraPrecomputePlanningJobs(jobs,turn,4)[0].raceId);
 assert.equal(seen.size,24);
});
test('activation only adds MARKET flag and retains operational limits',()=>{
 const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.vars.ENABLE_JRA_PRECOMPUTED_MARKET_BRIDGE,'true');
 for(const [key,value] of Object.entries({ENABLE_PRECOMPUTED_VIEWER:'false',ENABLE_JRA_DIRECT_FETCH:'false',ENABLE_JRA_ODDS_DIRECT_FETCH:'false',JRA_PRECOMPUTE_MAX_PLANNING_JOBS:'4',JRA_PRECOMPUTE_MAX_JOBS:'1',JRA_PRECOMPUTE_TOTAL_WINDOW_MS:'8000'}))assert.equal(config.vars[key],value);
});
test('existing Preflight invokes MARKET reader; remote adapter sends only two SELECTs',async()=>{
 const f=await fixture(),queries=[];
 const r=await readProductionMarketAudit(date,{now,execute:async sql=>{
  queries.push(sql);assert.match(sql,/^SELECT /);
  return sql.includes('jra_meeting_calendar')?f.meetingRows:f.snapshotRows;
 }});
 assert.equal(r.status,'PASS');assert.equal(queries.length,2);
 const preflight=readFileSync(new URL('../scripts/jra-production-preflight.mjs',import.meta.url),'utf8');
 assert.match(preflight,/await readProductionMarketAudit/);assert.match(preflight,/MARKET_EVIDENCE_JSON/);
});
