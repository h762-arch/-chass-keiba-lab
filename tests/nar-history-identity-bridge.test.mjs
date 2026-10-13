import test from 'node:test';import assert from 'node:assert/strict';
import {retainNarCardHistory} from '../src/prediction/nar-history-pack.mjs';
import {attachNarHistoryIdentity as attach,verifyNarHistoryIdentity as verify} from '../src/prediction/nar-history-identity-bridge.mjs';
import {stableHash,assertMarketIndependentData} from '../src/prediction/precomputed-snapshot.mjs';
const context={raceId:'20261014-NAR-21-01',horseNo:1,horseName:'試験',sourceAcquiredAt:'2026-10-14T00:00:00Z'};
const run={date:'09.30',venue:'川崎',runOrganization:'NAR',timeSec:91.2};
async function links(refs=[{date:'2026-09-30',code:'21',raceNo:1,raceId:'20260930-NAR-21-01'}]){const body={status:'IDENTITY_LINKS_RESOLVED',date:'2026-10-14',postTime:'15:00',code:'21',raceNo:1,observedAt:context.sourceAcquiredAt,rows:[{horseNo:1,horseName:'試験',providerHorseKey:'NAR_LINEAGE:30012403217',pastRaceReferences:refs}]};return {body,linksHash:await stableHash(body)};}
test('unique official link adds identity without changing original observed facts',async()=>{
 const old=await retainNarCardHistory({...context,runs:[run]}),before=structuredClone(old),l=await links(),h=await attach(old,l,context);assert.equal(h.body.schemaVersion,2);assert.equal(h.body.globalHorseIdentity,'NAR_LINEAGE:30012403217');assert.equal(h.body.identity.references[0].raceReference.date,'2026-09-30');assert.equal(h.body.episodes[0].facts.canonicalDate,null);assert.equal(h.body.identity.resolvedEpisodeCount,1);assert.equal(h.body.reuseStatus,'HOLD');assert.deepEqual(old,before);assert.equal(await verify(h,l,context),true);assert.doesNotThrow(()=>assertMarketIndependentData(h));
});
test('month/day collision, duplicate observations, foreign origin and unmatched venue retain HOLD',async()=>{
 for(const runs of [[run,run],[{...run,runOrganization:'JRA'}],[{...run,venue:'大井'}]]){const h=await attach(await retainNarCardHistory({...context,runs}),await links(),context);assert.equal(h.body.identity.resolvedEpisodeCount,0);assert.ok(h.body.identity.references.every(r=>r.status==='HOLD'));}
 const refs=[{date:'2026-09-30',code:'21'},{date:'2025-09-30',code:'21'}];const h=await attach(await retainNarCardHistory({...context,runs:[run]}),await links(refs),context);assert.equal(h.body.identity.references[0].reasonCode,'EPISODE_AMBIGUOUS');
});
test('tampered history/links and wrong identity reject, while v1 stays readable',async()=>{
 const old=await retainNarCardHistory({...context,runs:[run]}),l=await links();assert.equal(await verify(old,null,context),true);await assert.rejects(attach(old,l,{...context,horseName:'別馬'}),/IDENTITY_BRIDGE_INPUT/);l.body.rows[0].horseName='別馬';await assert.rejects(attach(old,l,context),/IDENTITY_BRIDGE_INPUT/);
});
test('resolved identity is revalidated against both physical hash lineages',async()=>{
 const old=await retainNarCardHistory({...context,runs:[run]}),l=await links(),h=await attach(old,l,context);h.body.identity.references[0].raceReference.date='2025-09-30';h.historyHash=await stableHash(h.body);assert.equal(await verify(h,l,context),false);
});
