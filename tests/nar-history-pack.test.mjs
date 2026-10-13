import test from 'node:test';
import assert from 'node:assert/strict';
import {retainNarCardHistory as retain,verifyNarCardHistory as verify} from '../src/prediction/nar-history-pack.mjs';
import {buildNarPreAnalysisPack as build,verifyNarPreAnalysisPack as verifyPack} from '../src/prediction/nar-pre-analysis-pack.mjs';
import {assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';
const context={raceId:'20261014-NAR-21-01',horseNo:1,sourceAcquiredAt:'2026-10-14T00:00:00Z'};
const run={date:'09.30',venue:'川崎',runOrganization:'NAR',distance:1400,condition:'良',direction:'左',finish:2,fieldSize:12,timeSec:91.2,last3f:39.5,corners:'2-3-2',popularity:4,odds:7.8,score:80,sameDistance:true};
test('card history retains past performance and provenance while excluding market/target-derived fields',async()=>{
 const p=await retain({...context,runs:[run]}),f=p.body.episodes[0].facts;assert.equal(f.timeSec,91.2);assert.deepEqual(f.cornerPositions,[2,3,2]);assert.equal(f.finish,2);assert.equal(f.dateText,'09.30');assert.equal(f.canonicalDate,null);assert.equal(p.body.sourceReference,context.raceId);assert.equal('popularity' in f,false);assert.equal('odds' in f,false);assert.equal('score' in f,false);assert.equal('sameDistance' in f,false);assert.doesNotThrow(()=>assertMarketIndependentData(p));assert.equal(await verify(p,context),true);
});
test('capacity is five observations and never claims full Rolling10 or inferred year',async()=>{const p=await retain({...context,runs:Array(10).fill(run)});assert.equal(p.body.retainedCount,5);assert.equal(p.body.parsedCount,10);assert.equal(p.body.tenRunCoverage,'NOT_CONFIRMED');assert.equal(p.body.reuseStatus,'HOLD');assert.ok(p.body.episodes.every(e=>e.facts.dateStatus==='YEAR_UNRESOLVED'));});
test('equal observable facts preserve distinct observations without false episode deduplication',async()=>{const p=await retain({...context,runs:[run,run]});assert.equal(p.body.episodes[0].contentHash,p.body.episodes[1].contentHash);assert.notEqual(p.body.episodes[0].observationKey,p.body.episodes[1].observationKey);assert.equal(p.body.retainedCount,2);});
test('missing source array differs from successfully parsed empty array',async()=>{const a=await retain(context),b=await retain({...context,runs:[]});assert.equal(a.body.status,'SOURCE_NOT_RETAINED');assert.equal(a.body.parsedCount,null);assert.equal(b.body.status,'RETAINED');assert.equal(b.body.parsedCount,0);assert.equal(b.body.tenRunCoverage,'NOT_CONFIRMED');});
test('race/horse/time mismatch and tampered history fail; repeated capture is deterministic',async()=>{
 const p=await retain({...context,runs:[run]});assert.deepEqual(await retain({...context,runs:[run]}),p);for(const patch of [{horseNo:2},{raceId:'20261014-NAR-21-02'},{sourceAcquiredAt:'2026-10-15T00:00:00Z'}])assert.equal(await verify(p,{...context,...patch}),false);p.body.episodes[0].facts.timeSec=80;assert.equal(await verify(p,context),false);
});
test('pack v3 exposes local histories, retains v2/v1 semantics and rejects unsupported versions',async()=>{
 const history=await retain({...context,runs:[run]}),x={raceId:context.raceId,sourceAcquiredAt:context.sourceAcquiredAt,race:{date:'2026-10-14',track:'川崎',raceNo:1},horses:[{horseNo:1,horseName:'A',runnerStatus:'active',abilityScore:80,history}]};
 const p=await build(x);assert.equal(p.body.contractVersion,'CHASS_PRE_ANALYSIS_PACK_V4');assert.equal(p.body.historyPacks[0].history.historyHash,history.historyHash);assert.equal(await verifyPack(p,x),true);for(const contractVersion of ['CHASS_PRE_ANALYSIS_PACK_V1','CHASS_PRE_ANALYSIS_PACK_V2']){const old=await build({...x,contractVersion});assert.equal('historyPacks' in old.body,false);assert.equal(await verifyPack(old,x),true);}await assert.rejects(build({...x,contractVersion:'unknown'}),/PACK_CONTRACT_UNSUPPORTED/);
});
