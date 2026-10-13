import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeNarIndexComponents as scan} from '../src/prediction/nar-index-analysis.mjs';
import {buildNarPreAnalysisPack as build,verifyNarPreAnalysisPack as verify} from '../src/prediction/nar-pre-analysis-pack.mjs';
import {assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';
const horses=values=>values.map((value,i)=>({horseNo:i+1,horseName:'試験',runnerStatus:'active',abilityScore:50,evidence:{schemaVersion:1,components:{timeIndex:value}}}));
const column=h=>scan(h).columns[0];
test('same-column rank, percentile, top deficit, median edge and neighbor gaps are exact',()=>{
 const c=column(horses([90,80,70]));assert.equal(c.relativeScope,'FULL_FIELD_RELATIVE');assert.deepEqual(c.rows.map(h=>h.rank),[1,2,3]);assert.deepEqual(c.rows.map(h=>h.percentile),[100,50,0]);assert.deepEqual(c.rows.map(h=>h.topDeficit),[0,10,20]);assert.deepEqual(c.rows.map(h=>h.medianEdge),[10,0,-10]);assert.equal(c.rows[0].gapToNext,10);assert.equal(c.rows[2].gapToPrevious,10);
});
test('ties use competition rank and preserve the declared percentile formula',()=>{const c=column(horses([90,90,70]));assert.deepEqual(c.rows.map(h=>h.rank),[1,1,3]);assert.deepEqual(c.rows.map(h=>h.percentile),[100,100,0]);assert.equal(c.rows[1].gapToPrevious,0);});
test('missing values stay null and partial coverage is known-only, never filled with zero',()=>{
 const c=column(horses([90,null,70]));assert.equal(c.comparableCount,2);assert.deepEqual(c.coverage,{numerator:2,denominator:3});assert.equal(c.relativeScope,'KNOWN_ONLY_RELATIVE');assert.equal(c.rows[1].status,'HOLD');assert.equal(c.rows[1].rank,null);assert.equal(c.rows[2].percentile,0);
});
test('single known runner has no percentile and empty columns have no synthetic distribution',()=>{
 const c=column(horses([80,null]));assert.equal(c.rows[0].percentile,null);assert.equal(c.rows[0].percentileStatus,'INSUFFICIENT');assert.equal(c.relativeScope,'KNOWN_ONLY_RELATIVE');assert.equal(column(horses([null,null])).comparableCount,0);
});
test('inactive runners do not distort distribution and absent evidence stays explicit',()=>{
 const h=horses([90,100,70]);h[1].runnerStatus='scratched';delete h[2].evidence;const c=column(h);assert.equal(c.activeRunnerCount,2);assert.equal(c.rows[1].status,'NOT_APPLICABLE');assert.equal(c.rows[2].reasonCode,'EVIDENCE_NOT_RETAINED');assert.equal(c.rows[0].topDeficit,0);
});
test('different columns stay separate, do not aggregate strength or invent Cluster/EV/signals',()=>{
 const h=horses([90,80]);h[0].evidence.components.courseIndex=20;h[1].evidence.components.courseIndex=100;const r=scan(h);assert.equal(r.columns[0].rows[0].rank,1);assert.equal(r.columns[3].rows[0].rank,2);assert.notEqual(r.columns[0].scaleId,r.columns[3].scaleId);assert.equal(r.scoreAggregation,'NOT_PERFORMED');assert.equal(r.cluster.status,'AUTHORITY_UNRESOLVED');assert.ok(r.columns.every(c=>c.independenceGroup==='INDEX_ABILITY'));assert.doesNotThrow(()=>assertMarketIndependentData(r));
});
test('v2 stores the scan deterministically while v1 packs verify without backfill',async()=>{
 const x={raceId:'20261014-NAR-21-01',race:{date:'2026-10-14',track:'川崎',raceNo:1},sourceAcquiredAt:'2026-10-14T00:00:00Z',horses:horses([90,80])},before=structuredClone(x);
 const current=await build(x),legacy=await build({...x,contractVersion:'CHASS_PRE_ANALYSIS_PACK_V1'});assert.equal(current.body.contractVersion,'CHASS_PRE_ANALYSIS_PACK_V3');assert.equal(current.body.indexAnalysis.columns.length,4);assert.equal('indexAnalysis' in legacy.body,false);assert.equal(await verify(current,x),true);assert.equal(await verify(legacy,x),true);assert.deepEqual(await build(x),current);assert.deepEqual(x,before);
});
test('numeric zero remains valid and input order does not change horse-associated metrics',()=>{
 const h=horses([10,0,-10]),a=column(h),b=column(h.slice().reverse());assert.equal(a.rows[1].value,0);assert.equal(a.rows[1].rank,2);for(const r of a.rows){const other=b.rows.find(x=>x.horseNo===r.horseNo);assert.equal(other.rank,r.rank);assert.equal(other.topDeficit,r.topDeficit);}
});
