import test from 'node:test';
import assert from 'node:assert/strict';
import {auditNarAbilityEvidence,retainNarAbilityEvidence} from '../src/prediction/nar-ability-evidence.mjs';

const identity=references=>({body:{identity:{references}}});
const resolved={status:'RESOLVED',reasonCode:null,privateUrl:'https://private.invalid'};
const base=(horseNo,evidence,extra={})=>({horseNo,horseName:`H${horseNo}`,abilityScore:70,predictedTime:null,runnerStatus:'active',evidence,history:identity([resolved]),...extra});

test('unknown TIME with no parsed history is observed without inventing a cause',()=>{
 const evidence=retainNarAbilityEvidence({runs:[],predictedTime:null,predictedTimeMissingReason:'time_missing_unknown'}),q=auditNarAbilityEvidence([base(1,evidence),base(2,evidence,{predictedTime:'1:40.0'})]);
 assert.equal(q.horses[0].timeReason,'time_missing_unknown');
 assert.deepEqual(q.horses[0].timeDiagnostic,{status:'OBSERVED',sourceReason:'time_missing_unknown',observation:'NO_PARSED_HISTORY',runCount:0,sameDistanceCount:0,sameTrackCount:0});
 assert.deepEqual(q.timeDiagnosticSummary,{missingActiveCount:1,observations:{NO_PARSED_HISTORY:1}});
});

test('unknown TIME separates missing same-distance evidence from retained evidence',()=>{
 const none=retainNarAbilityEvidence({runs:[{sameDistance:false,sameTrack:true}],predictedTimeMissingReason:'time_missing_unknown'}),present=retainNarAbilityEvidence({runs:[{sameDistance:true,sameTrack:true}],predictedTimeMissingReason:'time_missing_unknown'}),q=auditNarAbilityEvidence([base(1,none),base(2,present)]);
 assert.equal(q.horses[0].timeDiagnostic.observation,'NO_SAME_DISTANCE_EVIDENCE');
 assert.equal(q.horses[1].timeDiagnostic.observation,'RETAINED_EVIDENCE_PRESENT');
});

test('known upstream TIME reasons remain explicit observations',()=>{
 const cases=[['time_missing_no_history','UPSTREAM_NO_HISTORY'],['time_missing_no_same_surface','UPSTREAM_NO_SAME_SURFACE'],['time_missing_parse','UPSTREAM_PARSE_UNAVAILABLE']];
 for(const [reason,observation] of cases){const q=auditNarAbilityEvidence([base(1,retainNarAbilityEvidence({runs:[{sameDistance:true,sameTrack:true}],predictedTimeMissingReason:reason}))]);assert.equal(q.horses[0].timeDiagnostic.observation,observation);}
});

test('history identity diagnostics count only the two verified HOLD reason codes',()=>{
 const evidence=retainNarAbilityEvidence({runs:[{sameDistance:true,sameTrack:true}],predictedTimeMissingReason:'time_missing_unknown'}),q=auditNarAbilityEvidence([
  base(1,evidence,{history:identity([{status:'HOLD',reasonCode:'EPISODE_AMBIGUOUS'},{status:'HOLD',reasonCode:'EPISODE_LINK_UNMATCHED'},resolved])}),
  base(2,evidence,{history:identity([resolved])})
 ]);
 assert.deepEqual(q.historyIdentityDiagnostic,{status:'OBSERVED',heldReferenceCount:2,unavailableHorseCount:0,reasonCounts:{EPISODE_AMBIGUOUS:1,EPISODE_LINK_UNMATCHED:1}});
 assert.deepEqual(q.horses[0].historyIdentityDiagnostic,{status:'OBSERVED',heldReferenceCount:2,reasonCounts:{EPISODE_AMBIGUOUS:1,EPISODE_LINK_UNMATCHED:1}});
 assert.equal(JSON.stringify(q).includes('private.invalid'),false);
});

test('unknown history reason fails diagnostic closed without breaking existing quality',()=>{
 const evidence=retainNarAbilityEvidence({runs:[{sameDistance:true,sameTrack:true}],predictedTimeMissingReason:'time_missing_unknown'}),q=auditNarAbilityEvidence([base(1,evidence,{history:identity([{status:'HOLD',reasonCode:'PRIVATE_NEW_REASON',secret:'x'}])}),base(2,evidence,{predictedTime:'1:39.0'})]);
 assert.equal(q.horses[0].historyIdentityDiagnostic.status,'UNAVAILABLE');
 assert.deepEqual(q.historyIdentityDiagnostic,{status:'PARTIAL',heldReferenceCount:null,unavailableHorseCount:1,reasonCounts:null});
 assert.equal(q.activeAbilityCount,2);
 assert.equal(q.abilityComplete,true);
 assert.equal(JSON.stringify(q).includes('PRIVATE_NEW_REASON'),false);
 assert.equal(JSON.stringify(q).includes('secret'),false);
});

test('missing retained evidence is diagnosed without exposing arbitrary upstream values',()=>{
 const q=auditNarAbilityEvidence([base(1,null,{evidence:{schemaVersion:99,timeMissingReason:'PRIVATE_REASON'},history:null})]);
 assert.deepEqual(q.horses[0].timeDiagnostic,{status:'UNAVAILABLE',sourceReason:null,observation:'EVIDENCE_NOT_RETAINED',runCount:null,sameDistanceCount:null,sameTrackCount:null});
 assert.equal(q.horses[0].historyIdentityDiagnostic.status,'UNAVAILABLE');
 assert.equal(q.horses[0].timeDiagnostic.sourceReason,null);
});

test('diagnostics remain research-only and do not connect probability output',()=>{
 const evidence=retainNarAbilityEvidence({runs:[{sameDistance:true,sameTrack:true}],predictedTimeMissingReason:'time_missing_unknown'}),q=auditNarAbilityEvidence([base(1,evidence)]);
 assert.equal(q.probabilityStatus,'MODEL_HOLD');
 assert.equal(q.probabilityReason,'PROBABILITY_MODEL_NOT_CONNECTED');
 assert.equal(q.horses[0].probabilityStatus,'MODEL_HOLD');
});
