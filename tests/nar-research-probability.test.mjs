import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrecomputedSnapshot} from '../src/prediction/precomputed-snapshot.mjs';
import {NAR_ABILITY_VERSION} from '../src/prediction/nar-ability-precompute.mjs';
import {materializeNarResearchProbability as predict} from '../src/prediction/nar-research-probability.mjs';
async function fixture(scores=[80,75,70,65],edit=()=>{}){
 const raceId='20261014-NAR-21-01',at='2026-10-14T00:00:00.000Z',race={date:'2026-10-14',track:'川崎',raceNo:1,postTime:'15:00'};
 const horses=scores.map((abilityScore,i)=>({horseNo:i+1,horseName:'試験'+i,abilityScore,runnerStatus:'active',evidence:{schemaVersion:1,runCount:3,components:{fiveRaceAvgIndex:abilityScore}}}));
 const data={race,horses,formalKpiEligible:false};edit(data);
 return createPrecomputedSnapshot({organization:'NAR',raceId,source:{organization:'NAR',raceId,...race,acquiredAt:at},data,versions:{calculationVersion:NAR_ABILITY_VERSION,modelVersion:NAR_ABILITY_VERSION},now:at});
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
test('exact probabilities obey sums, range, ordering and research-only contract',async()=>{
 const s=await fixture(),before=JSON.stringify(s),r=await predict(s);assert.equal(r.status,'RESEARCH_READY');close(r.winTotal,1);close(r.top3Total,3);assert.equal(r.calibrated,false);assert.equal(r.formalKpiEligible,false);assert.equal(r.inputSnapshotHash,s.snapshotHash);assert.equal(JSON.stringify(s),before);
 for(let i=0;i<r.horses.length;i++){const h=r.horses[i];assert.ok(h.win>0&&h.top3>=h.win&&h.top3<=1);if(i)assert.ok(r.horses[i-1].win>h.win&&r.horses[i-1].top3>h.top3);}
});
test('equal evidenced scores yield symmetry without missing-value substitution',async()=>{const r=await predict(await fixture([70,70,70,70]));for(const h of r.horses){close(h.win,.25);close(h.top3,.75);}});
test('two and three runner fields define top3 as finishing within three, not payout probability',async()=>{for(const n of [2,3]){const r=await predict(await fixture(Array(n).fill(70)));close(r.winTotal,1);close(r.top3Total,n);assert.ok(r.horses.every(h=>h.top3===1));}});
test('missing ability or evidence holds entire field with no fabricated numbers',async()=>{
 for(const [edit,reason] of [[d=>d.horses[0].abilityScore=null,'ABILITY_COVERAGE_INCOMPLETE'],[d=>delete d.horses[0].evidence,'EVIDENCE_NOT_RETAINED'],[d=>d.horses[0].evidence.runCount=0,'ABILITY_EVIDENCE_INSUFFICIENT'],[d=>d.horses[0].evidence.components={},'ABILITY_EVIDENCE_INSUFFICIENT']]){const r=await predict(await fixture(undefined,edit));assert.equal(r.reasonCode,reason);assert.deepEqual(r.horses,[]);}
});
test('scratched runners do not consume mass; unknown status and undersized active field hold',async()=>{
 const r=await predict(await fixture(undefined,d=>{d.horses[3].runnerStatus='scratched';delete d.horses[3].evidence;d.horses[3].abilityScore=null;}));close(r.winTotal,1);close(r.top3Total,3);assert.equal(r.horses[3].win,null);assert.equal(r.horses[3].status,'NOT_APPLICABLE');
 assert.equal((await predict(await fixture(undefined,d=>d.horses[0].runnerStatus='unknown'))).reasonCode,'RUNNER_STATUS_UNKNOWN');
 assert.equal((await predict(await fixture(undefined,d=>d.horses.slice(1).forEach(h=>h.runnerStatus='excluded')))).reasonCode,'ACTIVE_FIELD_INSUFFICIENT');
});
test('horse permutation preserves probability attached to its horse identity',async()=>{
 const a=await predict(await fixture()),b=await predict(await fixture(undefined,d=>d.horses.reverse()));for(const h of a.horses){const other=b.horses.find(x=>x.horseNo===h.horseNo);close(h.win,other.win);close(h.top3,other.top3);}
});
test('tampered snapshots, post-off data and unsupported contracts hold',async()=>{
 const original=await fixture(),s=structuredClone(original);s.layers.DATA.horses[0].abilityScore++;assert.equal((await predict(s)).reasonCode,'SNAPSHOT_HASH');
 assert.equal((await predict({...original,organization:'JRA'})).reasonCode,'SNAPSHOT_CONTRACT');
 assert.equal((await predict(await fixture(undefined,d=>d.race.postTime='08:00'))).reasonCode,'PRE_RACE_IDENTITY');
 assert.equal((await predict(await fixture(undefined,d=>d.horses[1].horseNo=1))).reasonCode,'FIELD_INVALID');
});
test('extreme numerical range holds instead of clipping; thirty runners remain normalized',async()=>{
 assert.equal((await predict(await fixture([10000,0,50,40]))).reasonCode,'NUMERICAL_RANGE');const r=await predict(await fixture(Array.from({length:30},(_,i)=>70+i/10)));assert.equal(r.status,'RESEARCH_READY');close(r.winTotal,1);close(r.top3Total,3);
});
test('repeat calculation is deterministic and finite-score shifts preserve output',async()=>{
 const s=await fixture(),a=await predict(s);assert.deepEqual(await predict(s),a);const b=await predict(await fixture([90,85,80,75]));for(let i=0;i<4;i++){close(a.horses[i].win,b.horses[i].win);close(a.horses[i].top3,b.horses[i].top3);}
});
