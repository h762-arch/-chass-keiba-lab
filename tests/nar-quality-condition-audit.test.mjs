import test from 'node:test';
import assert from 'node:assert/strict';
import {auditNarTimeInputConditions as time, auditNarHistoryMatchConditions as history} from '../src/prediction/nar-quality-condition-audit.mjs';
import {diagnoseNarRaceQuality as diagnose} from '../src/prediction/nar-quality-diagnostics.mjs';
import {predictTimeFromRuns, classifyPredictedTimeMissing} from '../worker.js';

const freeze = x => {if (x && typeof x === 'object') {Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
function fixture(facts=[{distance:2000,timeSec:130,originCircuit:'NAR',dateText:'09.30',venue:'川崎'}], official=[{date:'2026-09-30',code:'21'}]) {
 const episodes=facts.map((f,i)=>({observationKey:`o${i}`,contentHash:`h${i}`,facts:f}));
 const horse={horseNo:1,horseName:'PRIVATE_NAME',runnerStatus:'active',predictedTime:null,evidence:{schemaVersion:1,runCount:facts.length,sameDistanceCount:0,sameTrackCount:1,timeMissingReason:'time_missing_unknown'},history:{body:{schemaVersion:2,parsedCount:facts.length,retainedCount:facts.length,episodes,identity:{references:episodes.map(e=>({observationKey:e.observationKey,contentHash:e.contentHash,status:'HOLD',reasonCode:'EPISODE_LINK_UNMATCHED'}))}}}};
 const race={race:{distance:1400},horses:[horse],historyLinks:{body:{rows:[{horseNo:1,horseName:'PRIVATE_NAME',pastRaceReferences:official}]}}};return {horse,race};
}

test('TIME same-distance absence is not failure when a 300m candidate exists',()=>{
 const {horse,race}=fixture([{distance:1700,timeSec:110}]);const out=time(horse,race);assert.equal(out.coverageComplete,true);assert.equal(out.exactFiniteTimeCount,0);assert.equal(out.within300mFiniteTimeCount,1);assert.equal(out.observation,'NEAR_TIME_CANDIDATE_PRESENT');assert.ok(predictTimeFromRuns([{distance:1700,timeSec:110}],1400).time);
});
test('TIME complete retained history identifies no finite TIME within 300m',()=>{
 const {horse,race}=fixture();const out=time(horse,race);assert.equal(out.finiteTimeCount,1);assert.equal(out.within300mFiniteTimeCount,0);assert.equal(out.observation,'NO_FINITE_TIME_WITHIN_300M');assert.equal(predictTimeFromRuns([{distance:2000,timeSec:130}],1400).time,'');assert.equal(classifyPredictedTimeMissing([{distance:2000,timeSec:130}],1400),'time_missing_unknown');
});
test('TIME candidate counts agree with existing predictor at exact and 300m boundaries',()=>{
 for(const distance of [1100,1099,1400,1700,1701]){const facts=[{distance,timeSec:90}],{horse,race}=fixture(facts),out=time(horse,race);assert.equal(Boolean(predictTimeFromRuns(facts,1400).time),out.exactFiniteTimeCount>0||out.within300mFiniteTimeCount>0);assert.equal(out.exactFiniteTimeCount,distance===1400?1:0);}
});
test('TIME absent numeric times, invalid distances and nonpositive times remain separate',()=>{
 for(const [fact,expected] of [[{distance:1400,timeSec:null},'NO_FINITE_TIME_RETAINED'],[{distance:null,timeSec:80},'DISTANCE_FACTS_UNAVAILABLE'],[{distance:1400,timeSec:0},'NONPOSITIVE_TIME_RETAINED']]){const {horse,race}=fixture([fact]);assert.equal(time(horse,race).observation,expected);}
});
test('TIME truncated history cannot establish complete candidate coverage',()=>{
 const {horse,race}=fixture();horse.history.body.parsedCount=8;horse.evidence.runCount=8;const out=time(horse,race);assert.equal(out.coverageComplete,false);assert.equal(out.observation,'RETAINED_COVERAGE_INCOMPLETE');
});
test('TIME count disagreement and legacy evidence cannot establish coverage',()=>{
 for(const patch of [{runCount:2},{schemaVersion:99}]){const {horse,race}=fixture();Object.assign(horse.evidence,patch);assert.equal(time(horse,race).coverageComplete,false);}
});
test('TIME unsupported target, malformed retained history and oversized episodes are unavailable',()=>{
 const {horse,race}=fixture();for(const distance of [null,'1400',0,4000])assert.equal(time(horse,{race:{distance}}).status,'UNAVAILABLE');
 horse.history.body.episodes=new Array(6);assert.equal(time(horse,race).status,'UNAVAILABLE');delete horse.history;assert.equal(time(horse,race).status,'UNAVAILABLE');
});
test('History JRA origin is reported without guessing identity or promoting held links',()=>{
 const {horse,race}=fixture([{originCircuit:'JRA',dateText:'09.30',venue:'川崎'}]);const out=history(horse,race),r=out.references[0];assert.equal(r.observation,'ORIGIN_NOT_NAR');assert.equal(r.origin,'JRA');assert.equal(r.dateVenueReferenceCount,1);assert.equal(r.eligibleCandidateCount,0);assert.equal(horse.history.body.identity.references[0].status,'HOLD');
});
test('History empty official reference list is distinct from date mismatch',()=>{
 const {horse,race}=fixture(undefined,[]);assert.equal(history(horse,race).references[0].observation,'NO_OFFICIAL_PAST_REFERENCES');
});
test('History month/day mismatch is distinguished from venue mismatch',()=>{
 const a=fixture(undefined,[{date:'2026-09-29',code:'21'}]),b=fixture(undefined,[{date:'2026-09-30',code:'20'}]);assert.equal(history(a.horse,a.race).references[0].observation,'NO_MONTH_DAY_MATCH');assert.equal(history(b.horse,b.race).references[0].observation,'NO_VENUE_MATCH');
});
test('History individually matching date and venue do not invent a combined match',()=>{
 const {horse,race}=fixture(undefined,[{date:'2026-09-30',code:'20'},{date:'2026-09-29',code:'21'}]);const r=history(horse,race).references[0];assert.equal(r.sameMonthDayReferenceCount,1);assert.equal(r.sameVenueReferenceCount,1);assert.equal(r.dateVenueReferenceCount,0);assert.equal(r.observation,'DATE_VENUE_COMBINATION_UNMATCHED');
});
test('History multiple official candidates and duplicate episode facts are explicit observations',()=>{
 const a=fixture(undefined,[{date:'2026-09-30',code:'21'},{date:'2025-09-30',code:'21'}]);assert.equal(history(a.horse,a.race).references[0].observation,'MULTIPLE_CANDIDATES_OR_EPISODES');
 const facts={originCircuit:'NAR',dateText:'09.30',venue:'川崎'},b=fixture([facts,{...facts}]);assert.equal(history(b.horse,b.race).references[0].sameDateVenueEpisodeCount,2);
});
test('History supported match still does not repair an existing unmatched source reason',()=>{
 const {horse,race}=fixture();const out=history(horse,race);assert.equal(out.references[0].observation,'MATCHING_CANDIDATE_PRESENT');assert.equal(out.references[0].sourceReason,'EPISODE_LINK_UNMATCHED');
});
test('History unsupported date, venue and origin expose only safe observations',()=>{
 const a=fixture([{originCircuit:'NAR',dateText:'PRIVATE_DATE',venue:'川崎'}]),b=fixture([{originCircuit:'NAR',dateText:'09.30',venue:'PRIVATE_VENUE'}]),c=fixture([{originCircuit:'PRIVATE_ORIGIN',dateText:'09.30',venue:'川崎'}]);
 assert.equal(history(a.horse,a.race).references[0].observation,'DATE_TEXT_UNSUPPORTED');assert.equal(history(b.horse,b.race).references[0].observation,'VENUE_NOT_RECOGNIZED');assert.equal(history(c.horse,c.race).references[0].origin,'OTHER');
 for(const f of [a,b,c])assert.equal(JSON.stringify(history(f.horse,f.race)).includes('PRIVATE'),false);
});
test('History unavailable/malformed official links are never counted as zero held references',()=>{
 for(const rows of [undefined,[],new Array(31)]){const {horse,race}=fixture();race.historyLinks.body.rows=rows;assert.equal(history(horse,race).status,'UNAVAILABLE');}
 const {horse,race}=fixture();race.historyLinks.body.rows[0].pastRaceReferences=new Array(6);assert.equal(history(horse,race).status,'UNAVAILABLE');
});
test('History reference-to-episode lineage must be unique and matched by key and content hash',()=>{
 const {horse,race}=fixture();horse.history.body.identity.references[0].contentHash='wrong';assert.equal(history(horse,race).reasonCode,'EPISODE_REFERENCE_UNAVAILABLE');
});
test('condition exceptions are isolated from existing TIME and History diagnostics',()=>{
 const {horse,race}=fixture();Object.defineProperty(race,'historyLinks',{get(){throw Error('PRIVATE_ERROR');}});const out=diagnose(race);assert.strictEqual(out.race,race);assert.equal(out.diagnostics.horses[0].history.heldReferenceCount,1);assert.equal(out.diagnostics.horses[0].conditions.history.reasonCode,'CONDITION_AUDIT_ERROR');assert.equal(JSON.stringify(out.diagnostics).includes('PRIVATE_ERROR'),false);
});
test('frozen inputs produce deterministic independent projections without names, links or predicted times',()=>{
 const {horse,race}=fixture();freeze(race);const before=JSON.stringify(race),a=history(horse,race),b=history(horse,race);assert.deepEqual(a,b);a.references[0].eligibleCandidateCount=99;assert.equal(b.references[0].eligibleCandidateCount,1);assert.equal(JSON.stringify(race),before);assert.equal(JSON.stringify(time(horse,race)).includes('predictedTime'),false);assert.equal(JSON.stringify(b).includes('PRIVATE_NAME'),false);
});
