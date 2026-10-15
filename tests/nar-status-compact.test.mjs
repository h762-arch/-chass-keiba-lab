import test from 'node:test';
import assert from 'node:assert/strict';
import {compactNarPrecomputeStatus as compact} from '../src/prediction/nar-status-compact.mjs';
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
const horse=(horseNo,extra={})=>({horseNo,active:true,time:{status:'AVAILABLE'},history:{status:'OBSERVED',heldReferenceCount:0},conditions:{time:{status:'NOT_APPLICABLE'},history:{status:'NOT_APPLICABLE'}},...extra});
function fixture(){return {ok:true,savedRaceCount:12,rejectedRowCount:0,researchOnly:true,formalKpiEligible:false,productionActivationReady:false,races:[{raceId:'a',raceNo:1,horseCount:3,quality:{horseCount:3,probabilityStatus:'MODEL_HOLD',horses:[1,2,3]}},{raceId:'b',raceNo:2,horseCount:1,quality:{horses:[4]}}],qualityDiagnostics:{status:'OBSERVED',races:[{raceId:'a',diagnostics:{status:'OBSERVED',horseCount:3,time:{missingActiveCount:1},history:{heldReferenceCount:1},horses:[horse(1),horse(2,{time:{status:'MISSING'}}),horse(3,{history:{status:'OBSERVED',heldReferenceCount:1}})]}},{raceId:'b',diagnostics:{status:'OBSERVED',horseCount:1,horses:[horse(4)]}}]}};}

test('compact status keeps full race counts and diagnostic totals, with affected horse details only',()=>{
 const out=compact(fixture());assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(out.countScope,'DATE');assert.equal(out.races[0].quality.horses,undefined);assert.equal(out.races[0].quality.probabilityStatus,'MODEL_HOLD');
 const d=out.qualityDiagnostics.races[0].diagnostics;assert.deepEqual(d.horses.map(h=>h.horseNo),[2,3]);assert.equal(d.horseCount,3);assert.equal(d.displayedHorseCount,2);assert.equal(d.omittedUnaffectedHorseCount,1);assert.equal(d.time.missingActiveCount,1);assert.equal(d.history.heldReferenceCount,1);
 const normal=out.qualityDiagnostics.races[1].diagnostics;assert.equal(normal.horses.length,0);assert.equal(normal.horseCount,1);assert.equal(normal.omittedUnaffectedHorseCount,1);
});
test('compact projection never omits unavailable or unknown diagnostic statuses',()=>{
 const input=fixture(),d=input.qualityDiagnostics.races[0].diagnostics;d.horses=[horse(1,{time:{status:'UNAVAILABLE'}}),horse(2,{history:{status:'UNAVAILABLE',heldReferenceCount:null}}),horse(3,{history:{status:'OBSERVED',heldReferenceCount:null}})];assert.equal(compact(input).qualityDiagnostics.races[0].diagnostics.horses.length,3);
});
test('compact race selection limits details while preserving day-wide saved and rejected counts',()=>{
 const out=compact(fixture(),{raceNo:2});assert.equal(out.savedRaceCount,12);assert.equal(out.rejectedRowCount,0);assert.equal(out.selectedRaceNo,2);assert.equal(out.raceDetailScope,'SELECTED_RACE');assert.deepEqual(out.races.map(r=>r.raceId),['b']);assert.deepEqual(out.qualityDiagnostics.races.map(r=>r.raceId),['b']);
});
test('compact formatting preserves unavailable sidecars without fabricating success',()=>{
 const input=fixture();input.qualityDiagnostics={status:'UNAVAILABLE',reasonCode:'DIAGNOSTIC_ERROR',races:[]};assert.equal(compact(input).qualityDiagnostics.status,'UNAVAILABLE');input.qualityDiagnostics.races=[{raceId:'a',diagnostics:{status:'UNAVAILABLE',reasonCode:'DIAGNOSTIC_ERROR'}}];assert.deepEqual(compact(input).qualityDiagnostics.races[0].diagnostics,input.qualityDiagnostics.races[0].diagnostics);
});
test('compact formatting without diagnostics never adds a diagnostic sidecar',()=>{
 const input=fixture();delete input.qualityDiagnostics;const out=compact(input);assert.equal('qualityDiagnostics' in out,false);assert.equal(out.races.length,2);assert.equal(out.researchOnly,true);assert.equal(out.formalKpiEligible,false);assert.equal(out.productionActivationReady,false);
});
test('compact formatting is deterministic and never mutates frozen input',()=>{
 const input=freeze(fixture()),before=JSON.stringify(input),a=compact(input),b=compact(input);assert.deepEqual(a,b);assert.equal(JSON.stringify(input),before);assert.notStrictEqual(a,input);assert.notStrictEqual(a.races,input.races);assert.notStrictEqual(a.qualityDiagnostics.races[0].diagnostics.horses,input.qualityDiagnostics.races[0].diagnostics.horses);
});
