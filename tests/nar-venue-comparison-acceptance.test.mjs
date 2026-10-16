import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {diagnoseNarRestoredRaceBatch} from '../src/prediction/nar-quality-diagnostics.mjs';
import {compactNarPrecomputeStatus} from '../src/prediction/nar-status-compact.mjs';
import {narStatusSourceUrl,narStatusSnapshotPath} from '../src/research/nar-status-mirror-audit.mjs';
import {auditNarVenueCodeComparison as audit} from '../src/research/nar-venue-comparison-acceptance.mjs';
import {reportNarMaterialConditions as report} from '../src/research/nar-material-condition-report.mjs';
import {acceptNarMaterialDiagnostics as accept} from '../src/research/nar-material-diagnostic-acceptance.mjs';
import {readNarMaterialDiagnostics as read} from '../src/research/nar-material-diagnostic-reader.mjs';
import {CURRENT_NAR_HISTORY_VENUE_VERSION as current} from '../src/prediction/nar-history-venue-mapping.mjs';
const date='2026-10-15',now=Date.parse('2026-10-15T13:40:00.000Z'),id='20261015-NAR-21-01';
function refresh(b){b.snapshot.payloadSha256=createHash('sha256').update(JSON.stringify(b.snapshot.payload)).digest('hex');const {payload,...a}=b.snapshot;b.attempt={...a,snapshotPath:narStatusSnapshotPath(date)};b.manifest={ok:true,schemaVersion:'chass-chat-mirror-manifest-v1',branch:'chass-data',statusMirror:{latestAttemptPath:'chat-snapshot/status/latest-attempt.json',latestAttempt:structuredClone(b.attempt)}};return b;}
function fixture(venue='金沢',code='22',version=undefined,official=undefined){
 const episode={observationKey:'o',contentHash:'h',facts:{distance:2000,timeSec:130,originCircuit:'NAR',dateText:'09.30',venue}};
 const data={race:{distance:1400},horses:[{horseNo:1,horseName:'PRIVATE_HORSE',runnerStatus:'active',predictedTime:null,evidence:{schemaVersion:1,runCount:1,sameDistanceCount:0,sameTrackCount:1,timeMissingReason:'time_missing_unknown'},history:{body:{schemaVersion:2,parsedCount:1,retainedCount:1,episodes:[episode],identity:{venueMappingVersion:version,references:[{observationKey:'o',contentHash:'h',status:'HOLD',reasonCode:'EPISODE_LINK_UNMATCHED'}]}}}},{horseNo:2,horseName:'OTHER',runnerStatus:'active',predictedTime:'1:26.0',history:{body:{schemaVersion:2,identity:{references:[]}}}}],historyLinks:{body:{rows:[{horseNo:1,horseName:'PRIVATE_HORSE',pastRaceReferences:official??[{date:'2026-09-30',code}]}]}}};
 const row={raceId:id,track:'川崎',raceNo:1,horseCount:2,abilityCount:2,timeCount:1,quality:{schemaVersion:1,horseCount:2,activeHorseCount:2,activeAbilityCount:2,activeTimeCount:1},historyLinkAudit:{heldEpisodeCount:1},historyStoreAudit:{heldEpisodeCount:0,unresolvedObservationCount:1},preAnalysisStatus:'PARTIAL',preAnalysisPackHash:'a'.repeat(64)};
 const b=refresh({commitSha:'b'.repeat(40),snapshot:{schemaVersion:'chass-nar-status-snapshot-v1',status:'CAPTURED',date,sourceUrl:narStatusSourceUrl(date),attemptedAt:'2026-10-15T13:35:53.000Z',capturedAt:'2026-10-15T13:35:54.000Z',hashBasis:'UTF8_JSON_STRINGIFY_PAYLOAD',readOnlyCapture:true,payload:{ok:true,date,schemaReady:true,historyStoreSchemaReady:true,savedRaceCount:1,rejectedRowCount:0,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,races:[row]}}});
 const response=compactNarPrecomputeStatus({...structuredClone(b.snapshot.payload),qualityDiagnostics:diagnoseNarRestoredRaceBatch([{raceId:id,data}])});return {b,response};
}
const ref=f=>f.response.qualityDiagnostics.races[0].diagnostics.horses[0].conditions.history.references[0];
const options={expectedDate:date,now};
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
test('real generator legacy code22 comparison is recomputed without resolving original HOLD',()=>{
 const r=ref(fixture()),a=audit(r);
 assert.equal(r.observation,'NO_VENUE_MATCH');assert.equal(a.status,'CONSISTENT');
 assert.deepEqual(a.baselineCompatibility,['LEGACY_UNVERSIONED']);
 assert.equal(a.comparison.observation,'VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES');
 assert.equal(a.comparison.baselineDateVenueCandidateCount,0);assert.equal(a.comparison.verifiedDateVenueCandidateCount,1);
 assert.equal(a.comparison.references[0].baselineVenue,'笠松');assert.equal(a.comparison.references[0].comparisonVenue,'金沢');
 assert.equal(a.identityDecision,'UNCHANGED');assert.equal(a.baselineVersionAuthenticated,false);
});
test('legacy code23 comparison uses the opposite correction without changing mappings',()=>{
 const a=audit(ref(fixture('笠松','23')));assert.equal(a.status,'CONSISTENT');
 assert.equal(a.comparison.references[0].baselineVenue,'金沢');assert.equal(a.comparison.references[0].comparisonVenue,'笠松');
 assert.equal(a.comparison.verifiedDateVenueCandidateCount,1);
});
test('current table compatibility is retained without attributing a legacy mismatch',()=>{
 const a=audit(ref(fixture('金沢','23',current)));assert.equal(a.status,'CONSISTENT');
 assert.deepEqual(a.baselineCompatibility,[current]);assert.equal(a.comparison.codeMapDisagreementCount,0);
 assert.equal(a.comparison.observation,'NO_COMPARISON_CANDIDATE');
});
test('absence of distinguishing code22/23 evidence leaves both baseline tables compatible',()=>{
 const a=audit(ref(fixture('金沢','21')));assert.equal(a.status,'CONSISTENT');
 assert.deepEqual(a.baselineCompatibility,['LEGACY_UNVERSIONED',current]);
 assert.equal(a.baselineVersionAuthenticated,false);assert.equal(a.comparison.references[0].mappingBasis,'LEGACY_UNCHECKED');
});
test('unknown official numeric code remains null-mapped and unverified',()=>{
 const a=audit(ref(fixture('金沢','99')));assert.equal(a.status,'CONSISTENT');
 assert.equal(a.comparison.references[0].baselineVenue,null);assert.equal(a.comparison.references[0].comparisonVenue,null);
 assert.equal(a.comparison.verifiedDateVenueCandidateCount,0);
});
test('date/venue combination mismatch is checked against independent source counts',()=>{
 const f=fixture('金沢','22',undefined,[{date:'2026-09-30',code:'21'},{date:'2026-08-30',code:'23'}]);
 assert.equal(ref(f).observation,'DATE_VENUE_COMBINATION_UNMATCHED');
 const a=audit(ref(f));assert.equal(a.status,'CONSISTENT');assert.equal(a.comparison.baselineDateVenueCandidateCount,0);
});
test('multiple candidate years stay multiple candidates and never become a resolved identity',()=>{
 const a=audit(ref(fixture('金沢','22',undefined,[{date:'2026-09-30',code:'22'},{date:'2025-09-30',code:'22'}])));
 assert.equal(a.status,'CONSISTENT');assert.equal(a.comparison.verifiedDateVenueCandidateCount,2);
 assert.equal(a.identityDecision,'UNCHANGED');assert.equal(a.diagnosisStatus,'NOT_ESTABLISHED');
});
test('missing or unavailable required comparisons HOLD with no fabricated projection',()=>{
 for(const c of [undefined,null,{status:'UNAVAILABLE',reasonCode:'PRIVATE_SECRET'}]){
  const r=ref(fixture());r.venueCodeComparison=c;const a=audit(r);
  assert.equal(a.status,'HOLD');assert.deepEqual(a.reasonCodes,['VENUE_COMPARISON_UNAVAILABLE']);assert.equal(a.comparison,null);
  assert.equal(JSON.stringify(a).includes('PRIVATE_SECRET'),false);
 }
});
test('changed candidate totals, observation labels and schema cannot pass recomputation',()=>{
 for(const patch of [{schemaVersion:2},{scope:'PRIVATE_SECRET'},{status:'READY'},{verifiedDateVenueCandidateCount:0},{comparisonDateVenueCandidateCount:0},{baselineDateVenueCandidateCount:1},{codeMapDisagreementCount:0},{observation:'NO_COMPARISON_CANDIDATE'}]){
  const r=ref(fixture());Object.assign(r.venueCodeComparison,patch);const a=audit(r);
  assert.equal(a.status,'HOLD');assert.deepEqual(a.reasonCodes,['VENUE_COMPARISON_INVALID']);
 }
});
test('reference index, table labels, match booleans and mapping basis must agree',()=>{
 for(const patch of [{referenceIndex:2},{baselineVenue:'金沢'},{comparisonVenue:'PRIVATE_SECRET'},{mappingBasis:'LEGACY_UNCHECKED'},{codeMapDisagrees:false},{monthDayMatches:false},{baselineVenueMatches:true},{comparisonVenueMatches:false}]){
  const r=ref(fixture());Object.assign(r.venueCodeComparison.references[0],patch);assert.equal(audit(r).status,'HOLD');
 }
});
test('official dates and codes are strict and invalid calendar dates are not silently normalized',()=>{
 for(const patch of [{date:'2026-02-30'},{date:'PRIVATE_SECRET'},{code:22},{code:'022'},{code:'PRIVATE_SECRET'}]){
  const r=ref(fixture());Object.assign(r.venueCodeComparison.references[0],patch);assert.equal(audit(r).status,'HOLD');
 }
 for(const factMonthDay of ['02.30','04.31','PRIVATE_SECRET',null]){
  const r=ref(fixture());r.venueCodeComparison.factMonthDay=factMonthDay;assert.equal(audit(r).status,'HOLD');
 }
});
test('empty and oversized reference arrays are rejected',()=>{
 for(const make of [()=>[],r=>Array.from({length:6},()=>r.venueCodeComparison.references[0])]){
  const r=ref(fixture());r.venueCodeComparison.references=make(r);assert.equal(audit(r).status,'HOLD');
 }
});
test('parent official/match counts and source flags must reconcile with the comparison',()=>{
 for(const patch of [{officialReferenceCount:2},{sameMonthDayReferenceCount:0},{sameVenueReferenceCount:1},{dateVenueReferenceCount:1},{eligibleCandidateCount:1},{sameDateVenueEpisodeCount:0},{dateSupported:false},{venueRecognized:false},{observation:'DATE_VENUE_COMBINATION_UNMATCHED'}]){
  const r=ref(fixture());Object.assign(r,patch);assert.equal(audit(r).status,'HOLD');
 }
});
test('non-NAR and other observations are explicitly not applicable and do not emit supplied detail',()=>{
 for(const patch of [{origin:'JRA',observation:'ORIGIN_NOT_NAR'},{observation:'MATCHING_CANDIDATE_PRESENT'}]){
  const r=ref(fixture());Object.assign(r,patch);r.venueCodeComparison.privateNote='PRIVATE_SECRET';const a=audit(r);
  assert.equal(a.status,'NOT_APPLICABLE');assert.equal(a.comparison,null);assert.equal(JSON.stringify(a).includes('PRIVATE_SECRET'),false);
 }
});
test('arbitrary text, URLs and extra caller fields never enter validated comparison output',()=>{
 const r=ref(fixture());r.privateNote='PRIVATE_SECRET';r.venueCodeComparison.sourceUrl='PRIVATE_SECRET';
 r.venueCodeComparison.references[0].horseName='PRIVATE_SECRET';const a=audit(r);
 assert.equal(a.status,'CONSISTENT');assert.equal(JSON.stringify(a).includes('PRIVATE_SECRET'),false);
});
test('frozen input yields deterministic independent projections without mutations or private errors',()=>{
 const r=freeze(ref(fixture())),before=JSON.stringify(r),a=audit(r),b=audit(r);
 assert.deepEqual(a,b);a.comparison.references[0].code='99';assert.equal(b.comparison.references[0].code,'22');assert.equal(JSON.stringify(r),before);
 const bad={};Object.defineProperty(bad,'origin',{enumerable:true,get(){throw Error('PRIVATE_SECRET');}});
 assert.equal(audit(bad).status,'HOLD');assert.equal(JSON.stringify(audit(bad)).includes('PRIVATE_SECRET'),false);
});
test('condition report includes only recomputed venue comparison and keeps original observation',()=>{
 const f=fixture(),before=JSON.stringify(f),a=accept(f.b,f.response,options),r=report(f.b,f.response,options);
 assert.equal(a.status,'INSPECTION_READY');assert.equal(r.status,'CONDITION_REPORT_READY');assert.equal(r.venueCodeComparison,'CONSISTENCY_CHECKED');
 const h=r.races[0].history[0];assert.equal(h.observation,'NO_VENUE_MATCH');assert.equal(h.sourceReason,'EPISODE_LINK_UNMATCHED');
 assert.equal(h.venueCodeComparison.status,'CONSISTENT');assert.equal(r.totals.venueCodeComparisons.heldReferenceCount,1);
 assert.deepEqual(r.totals.venueCodeComparisons.observations,{VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES:1});
 assert.equal(r.remainingTasks.every(t=>t.status==='UNRESOLVED'),true);assert.equal(JSON.stringify(f),before);
});
test('report fails closed on unvalidated required comparison even when base acceptance passes',()=>{
 const f=fixture();delete ref(f).venueCodeComparison;assert.equal(accept(f.b,f.response,options).status,'INSPECTION_READY');
 const r=report(f.b,f.response,options);assert.equal(r.status,'HOLD');assert.equal(r.totals,null);assert.deepEqual(r.races,[]);
 assert.deepEqual(r.reasonCodes,['VENUE_COMPARISON_UNAVAILABLE']);
});
test('one-GET reader propagates report validation HOLD without changing captured transport facts',async()=>{
 const f=fixture();ref(f).venueCodeComparison.verifiedDateVenueCandidateCount=0;let calls=0;
 const r=await read(f.b,{expectedDate:date,wallNow:()=>now,includeConditionReport:true,fetchImpl:async()=>{calls++;return Response.json(f.response);}});
 assert.equal(calls,1);assert.equal(r.readAudit.status,'CAPTURED');assert.equal(r.acceptance.status,'INSPECTION_READY');
 assert.equal(r.status,'HOLD');assert.equal(r.conditionReport.status,'HOLD');assert.equal(r.conditionReport.totals,null);
});
test('historical comparison report retains stale source HOLD, hashes and model gates',()=>{
 const f=fixture(),r=report(f.b,f.response,{...options,mode:'HISTORICAL',now:now+3600000});
 assert.equal(r.status,'HISTORICAL_CONDITION_REPORT_READY');assert.equal(r.sourceMirrorDecision,'HOLD');assert.deepEqual(r.sourceMirrorReasons,['SNAPSHOT_STALE']);
 assert.equal(r.sourceReference.payloadSha256,f.b.snapshot.payloadSha256);assert.equal(r.probabilityDecision,'MODEL_HOLD');assert.equal(r.productionActivationDecision,'NO-GO');
 assert.equal(r.currentStatusEligible,false);assert.equal(r.diagnosisStatus,'NOT_ESTABLISHED');
});
test('two held episodes with repeated official links count as two held references, never four identities',()=>{
 const f=fixture('金沢','22',undefined,[{date:'2026-09-30',code:'22'},{date:'2025-09-30',code:'22'}]);
 const d=f.response.qualityDiagnostics.races[0].diagnostics,h=d.horses[0],first=ref(f);
 first.sameDateVenueEpisodeCount=2;
 h.conditions.history.references.push({...structuredClone(first),episodeIndex:2});
 h.conditions.history.heldReferenceCount=2;h.conditions.history.observations={NO_VENUE_MATCH:2};
 h.history.heldReferenceCount=2;h.history.reasonCounts.EPISODE_LINK_UNMATCHED=2;
 d.history.heldReferenceCount=2;d.history.reasonCounts.EPISODE_LINK_UNMATCHED=2;
 f.b.snapshot.payload.races[0].historyLinkAudit.heldEpisodeCount=2;
 f.response.races[0].historyLinkAudit.heldEpisodeCount=2;refresh(f.b);
 const r=report(f.b,f.response,options);assert.equal(r.status,'CONDITION_REPORT_READY');
 assert.equal(r.totals.heldHistoryReferenceCount,2);assert.equal(r.totals.venueCodeComparisons.heldReferenceCount,2);
 assert.equal(r.races[0].history[0].venueCodeComparison.comparison.verifiedDateVenueCandidateCount,2);
 assert.deepEqual(r.totals.venueCodeComparisons.observations,{VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES:2});
 assert.ok(r.remainingTasks.every(t=>t.status==='UNRESOLVED'));
});
