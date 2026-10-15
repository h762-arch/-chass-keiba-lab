import test from 'node:test';
import assert from 'node:assert/strict';
import {compareNarVenueCodes as compare} from '../src/prediction/nar-venue-code-comparison.mjs';
import {auditNarHistoryMatchConditions as conditions} from '../src/prediction/nar-quality-condition-audit.mjs';
import {retainNarCardHistory} from '../src/prediction/nar-history-pack.mjs';
import {attachNarHistoryIdentity,verifyNarHistoryIdentity} from '../src/prediction/nar-history-identity-bridge.mjs';
import {stableHash} from '../src/prediction/precomputed-snapshot.mjs';
const baseline={21:'川崎',22:'笠松',23:'金沢'};
const fact=(venue='金沢',dateText='09.30')=>({originCircuit:'NAR',venue,dateText});
const ref=(code='22',date='2026-09-30')=>({code,date,sourceUrl:'PRIVATE_URL',raceId:'PRIVATE_ID'});
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};

test('primary code 22=金沢 changes candidate observation without changing baseline table',()=>{
 const before=structuredClone(baseline),out=compare(fact(),[ref()],baseline);assert.equal(out.baselineDateVenueCandidateCount,0);assert.equal(out.comparisonDateVenueCandidateCount,1);assert.equal(out.verifiedDateVenueCandidateCount,1);assert.equal(out.observation,'VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES');assert.equal(out.references[0].baselineVenue,'笠松');assert.equal(out.references[0].comparisonVenue,'金沢');assert.deepEqual(baseline,before);
});
test('primary code 23=笠松 is explicitly compared and code strings are bounded',()=>{
 const out=compare(fact('笠松'),[ref(23)],baseline);assert.equal(out.verifiedDateVenueCandidateCount,1);assert.equal(out.references[0].code,'23');assert.equal(out.references[0].comparisonVenue,'笠松');assert.equal(out.references[0].mappingBasis,'PRIMARY_SOURCE_VERIFIED_22_23');
});
test('other codes are not falsely labeled independently verified',()=>{
 const out=compare(fact('川崎'),[ref('21')],baseline);assert.equal(out.references[0].mappingBasis,'LEGACY_UNCHECKED');assert.equal(out.verifiedDateVenueCandidateCount,0);assert.equal(out.comparisonDateVenueCandidateCount,1);assert.equal(out.references[0].codeMapDisagrees,false);
});
test('code-table disagreement on another month/day is not a matching candidate',()=>{
 const out=compare(fact(),[ref('22','2026-09-29')],baseline);assert.equal(out.codeMapDisagreementCount,1);assert.equal(out.comparisonDateVenueCandidateCount,0);assert.equal(out.observation,'NO_COMPARISON_CANDIDATE');
});
test('matching dates in multiple years remain multiple candidates, never a repaired identity',()=>{
 const out=compare(fact(),[ref('22','2026-09-30'),ref('22','2025-09-30')],baseline);assert.equal(out.comparisonDateVenueCandidateCount,2);assert.equal('status' in out.references[0],false);assert.equal('resolved' in out,false);
});
test('unsupported fact names/dates and unknown codes never expose arbitrary strings',()=>{
 const out=compare(fact('PRIVATE_VENUE','PRIVATE_DATE'),[ref('99')],baseline),text=JSON.stringify(out);assert.equal(out.factVenue,null);assert.equal(out.factMonthDay,null);assert.equal(out.references[0].comparisonVenue,null);assert.equal(text.includes('PRIVATE'),false);
});
test('JRA observations and malformed/oversized official references fail diagnostic closed',()=>{
 assert.equal(compare({...fact(),originCircuit:'JRA'},[ref()],baseline).reasonCode,'NON_NAR_SCOPE');
 for(const input of [null,new Array(6),[{code:'PRIVATE_CODE',date:'2026-09-30'}],[{code:'22',date:'PRIVATE_DATE'}]]){const out=compare(fact(),input,baseline);assert.equal(out.status,'UNAVAILABLE');assert.equal(JSON.stringify(out).includes('PRIVATE'),false);}
});
test('frozen inputs yield deterministic fresh projection without URLs or source IDs',()=>{
 const f=freeze(fact()),refs=freeze([ref()]),table=freeze({...baseline}),before=JSON.stringify({f,refs,table}),a=compare(f,refs,table),b=compare(f,refs,table);assert.deepEqual(a,b);a.references[0].comparisonVenue=null;assert.equal(b.references[0].comparisonVenue,'金沢');assert.equal(JSON.stringify({f,refs,table}),before);assert.equal(JSON.stringify(b).includes('PRIVATE'),false);
});
test('throwing reference field remains a diagnostic unavailability without raw error text',()=>{
 const r={};Object.defineProperty(r,'date',{get(){throw Error('PRIVATE');}});assert.deepEqual(compare(fact(),[r],baseline),{status:'UNAVAILABLE',reasonCode:'VENUE_COMPARISON_UNAVAILABLE'});
});
test('existing identity/hash verification keeps legacy HOLD while new comparison exposes table difference',async()=>{
 const fixture=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('./fixtures/nar-legacy-venue-identity.json',import.meta.url),'utf8'));
 const {context,history,links}=fixture,horse={horseNo:1,horseName:'試験',history},race={historyLinks:links},before=JSON.stringify({history,links});assert.equal(history.body.identity.references[0].status,'HOLD');assert.equal(await verifyNarHistoryIdentity(history,links,context),true);
 const out=conditions(horse,race),r=out.references[0];assert.equal(out.heldReferenceCount,2);assert.equal(r.sourceReason,'EPISODE_LINK_UNMATCHED');assert.equal(r.observation,'DATE_VENUE_COMBINATION_UNMATCHED');assert.equal(r.venueCodeComparison.verifiedDateVenueCandidateCount,1);assert.equal(JSON.stringify({history,links}),before);assert.equal(await verifyNarHistoryIdentity(history,links,context),true);
});
