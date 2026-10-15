import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {auditNarStoredVersions as audit} from '../src/prediction/nar-stored-version-audit.mjs';
import {diagnoseNarRaceQuality as diagnose} from '../src/prediction/nar-quality-diagnostics.mjs';
import {compactNarPrecomputeStatus as compact} from '../src/prediction/nar-status-compact.mjs';
const routing='NAR_VENUE_ROUTING_22_23_V1',history='NAR_HISTORY_VENUES_22_23_V1';
const horse=(identity={references:[]})=>({horseNo:1,predictedTime:'1:30.0',history:{body:{schemaVersion:2,identity}}});
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
test('Phase140.8 legacy DATA and identity expose absent versions explicitly without assuming current rules',()=>{
 const out=audit({horses:[horse()]});assert.equal(out.status,'OBSERVED');assert.equal(out.scope,'STORED_VERSION_FIELDS_ONLY');assert.deepEqual(out.routing,{status:'LEGACY_UNVERSIONED',recordedVersion:null});assert.equal(out.history.legacyUnversionedHorseCount,1);assert.equal(out.history.versionedHorseCount,0);assert.deepEqual(out.history.recordedVersions,[]);
});
test('Phase140.8 routing and History versions remain independent across all four combinations',()=>{
 for(const r of [false,true])for(const h of [false,true]){const data={horses:[horse(h?{references:[],venueMappingVersion:history}:undefined)]};if(r)data.venueRoutingVersion=routing;const out=audit(data);assert.equal(out.routing.status,r?'VERSIONED':'LEGACY_UNVERSIONED');assert.equal(out.history.legacyUnversionedHorseCount,h?0:1);assert.equal(out.history.versionedHorseCount,h?1:0);assert.deepEqual(out.history.recordedVersions,h?[history]:[]);}
});
test('Phase140.8 all horse versions are counted including inactive and absent/schema-1 History',()=>{
 const out=audit({venueRoutingVersion:routing,horses:[horse(),{...horse({venueMappingVersion:history}),horseNo:2,runnerStatus:'scratched'},{horseNo:3},{horseNo:4,history:{body:{schemaVersion:1}}}]});assert.equal(out.history.horseCount,4);assert.equal(out.history.legacyUnversionedHorseCount,1);assert.equal(out.history.versionedHorseCount,1);assert.equal(out.history.notRetainedHorseCount,2);assert.equal(out.history.unavailableHorseCount,0);assert.equal(out.routing.recordedVersion,routing);
});
test('Phase140.8 explicit null, undefined and unknown versions are unavailable without echoing raw values',()=>{
 for(const v of [null,undefined,'PRIVATE_UNSUPPORTED',{},1]){const out=audit({venueRoutingVersion:v,horses:[horse({venueMappingVersion:v})]});assert.equal(out.status,'PARTIAL');assert.equal(out.routing.status,'UNAVAILABLE');assert.equal(out.history.unavailableHorseCount,1);assert.equal(out.history.legacyUnversionedHorseCount,0);assert.equal(JSON.stringify(out).includes('PRIVATE'),false);}
});
test('Phase140.8 version accessor failures preserve the rest of quality diagnostics and original race',()=>{
 const data={horses:[horse()]};Object.defineProperty(data,'venueRoutingVersion',{get(){throw Error('PRIVATE');}});Object.defineProperty(data.horses[0].history.body.identity,'venueMappingVersion',{get(){throw Error('PRIVATE');}});
 const out=diagnose(data);assert.strictEqual(out.race,data);assert.equal(out.diagnostics.status,'OBSERVED');assert.equal(out.diagnostics.time.missingActiveCount,0);assert.equal(out.diagnostics.history.heldReferenceCount,0);assert.equal(out.diagnostics.versions.status,'PARTIAL');assert.equal(out.diagnostics.versions.history.unavailableHorseCount,1);assert.equal(JSON.stringify(out.diagnostics).includes('PRIVATE'),false);
});
test('Phase140.8 projection is deterministic, fresh and immutable with no IO handles used',()=>{
 const data=freeze({venueRoutingVersion:routing,horses:[horse({venueMappingVersion:history})],DB:{},preAnalysisPack:{packHash:'PRIVATE'},mark:'PRIVATE'}),before=JSON.stringify(data),a=audit(data),b=audit(data);assert.deepEqual(a,b);a.history.recordedVersions.push('changed');assert.deepEqual(b.history.recordedVersions,[history]);assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(b).includes('PRIVATE'),false);
});
test('Phase140.8 malformed and throwing inputs stay bounded and never count partial arrays as complete',()=>{
 const throwing={};Object.defineProperty(throwing,'horses',{get(){throw Error('PRIVATE');}});for(const x of [null,[],{},throwing,{horses:[]},{horses:Array(31)}])assert.equal(audit(x).status,'UNAVAILABLE');
 const out=audit({horses:[null,horse(null),{history:{body:{schemaVersion:99}}}]});assert.equal(out.history.unavailableHorseCount,3);assert.equal(out.history.status,'PARTIAL');assert.equal(JSON.stringify(out).includes('PRIVATE'),false);
});
test('Phase140.8 frozen legacy fixtures retain their stored versions without hash mutation',async()=>{
 for(const file of ['nar-legacy-venue-row.json','nar-legacy-routing-rows.json']){const raw=JSON.parse(await readFile(new URL('./fixtures/'+file,import.meta.url),'utf8')),rows=Array.isArray(raw)?raw:[raw];for(const row of rows){const data=freeze(JSON.parse(row.data_json)),before=JSON.stringify(data),out=audit(data);assert.equal(out.routing.status,'LEGACY_UNVERSIONED');assert.equal(JSON.stringify(data),before);if(file==='nar-legacy-venue-row.json')assert.equal(out.history.legacyUnversionedHorseCount,2);}}
});
test('Phase140.8 compact keeps complete version summaries when all unaffected horse details are omitted',()=>{
 const data={venueRoutingVersion:routing,horses:[horse({references:[],venueMappingVersion:history})]},d=diagnose(data).diagnostics,value={savedRaceCount:12,rejectedRowCount:0,races:[{raceId:'a',raceNo:1,quality:{horses:[]}}],qualityDiagnostics:{races:[{raceId:'a',diagnostics:d}]}},before=JSON.stringify(value),out=compact(value);assert.deepEqual(out.qualityDiagnostics.races[0].diagnostics.versions,d.versions);assert.deepEqual(out.qualityDiagnostics.races[0].diagnostics.horses,[]);assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(JSON.stringify(value),before);
});
