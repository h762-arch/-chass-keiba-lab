import test from 'node:test';
import assert from 'node:assert/strict';
import { auditSignalEvidenceLedger } from '../src/research/signal-evidence-ledger-audit.mjs';

const at='2026-10-10T00:00:00.000Z';
function fixture(mark='⚠️'){
 const scope={runId:'run',raceId:'race',freezeId:'freeze',sourceSnapshotId:'source'};
 const warning=mark==='⚠️';
 const snapshot={policyVersion:'CHASS-SIGNAL-v1.0',schemaVersion:1,status:'frozen',frozenAt:at,
  horses:[{horseNo:1,popularityAtFreeze:warning?1:9,oddsAtFreeze:20,evAtFreeze:120,
   abilityMarkAtFreeze:'',finalMarkAtFreeze:'',valueMark:warning?'':mark,warningMark:warning?mark:'',
   warningScenario:{policyVersion:'CHASS-SIGNAL-v1.0',targetBasis:'market_top3',scenario:'4着以下',
    factors:[{code:'PACE_COLLAPSE',label:'展開不利'},{code:'DISTANCE_RISK',label:'距離不利'}]},
   longshotScenario:{policyVersion:'CHASS-SIGNAL-v1.0',level:mark==='💎'?'place':'big_win',
    scenario:'具体的な経路',marketValue:true,evidence:[{code:'PACE_FIT',label:'展開',strength:2},
     {code:'DISTANCE_FIT',label:'距離',strength:2}]}}]};
 const evidence=['pace','distance'].map((group,i)=>({...scope,horseNo:1,evidenceId:`e${i}`,
  independenceGroup:group,family:i?'EXACT_CONDITION':'POSITION_PACE',sourceRef:`receipt-${i}`,
  description:'事前に確認した根拠',direction:warning?'NEGATIVE':'POSITIVE',resolution:'RESOLVED',
  eligibility:'ELIGIBLE',strength:'STRONG',conflict:false,stage:'EARLY',capturedAt:at}));
 return {scope,snapshot,evidence,survivalReviews:warning?[{...scope,horseNo:1,reviewedAt:at,
  decision:'CLEAR',reason:'生存経路も比較した',evidenceIds:['e0','e1']}]:[]};
}
const row=input=>auditSignalEvidenceLedger(input).rows[0];

test('two independent negatives with a survival review give only research structural pass',()=>{
 const input=fixture(),before=JSON.stringify(input),out=auditSignalEvidenceLedger(input);
 assert.equal(out.rows[0].status,'STRUCTURAL_PASS');
 assert.equal(out.authenticity,'NOT_VERIFIED');assert.equal(out.formalKpiEligible,false);
 assert.equal(out.adopted,false);assert.equal(out.productionActivationReady,false);
 assert.equal(JSON.stringify(input),before);assert.ok(Object.isFrozen(out.rows[0].reasons));
});
test('two rows from one independence group cannot satisfy warning contract',()=>{
 const input=fixture();input.evidence[1].independenceGroup='pace';
 assert.equal(row(input).negativeGroupCount,1);assert.equal(row(input).status,'UNVERIFIED');
});
test('UNKNOWN, ineligible and unresolved receipts never count as negative',()=>{
 for(const change of [{direction:'UNKNOWN'},{eligibility:'INELIGIBLE'},{resolution:'SOURCE_MISSING'}]){
  const input=fixture();Object.assign(input.evidence[1],change);
  assert.equal(row(input).negativeGroupCount,1);assert.equal(row(input).status,'UNVERIFIED');
 }
});
test('market and index-cluster families never provide ability evidence',()=>{
 for(const family of ['MARKET','INDEX_CLUSTER']){
  const input=fixture();input.evidence.forEach(e=>e.family=family);
  assert.equal(row(input).negativeGroupCount,0);assert.equal(row(input).status,'UNVERIFIED');
 }
});
test('survival veto identifies a violation and missing review stays unverified',()=>{
 const input=fixture();input.survivalReviews[0].decision='VETO';
 assert.ok(row(input).reasons.includes('POPULAR_SURVIVAL_VETO'));
 input.survivalReviews=[];assert.equal(row(input).status,'UNVERIFIED');
});
test('cross-run, cross-race, cross-freeze and cross-source receipts reject',()=>{
 for(const key of ['runId','raceId','freezeId','sourceSnapshotId']){
  const input=fixture();input.evidence[0][key]='other';
  assert.equal(auditSignalEvidenceLedger(input).reason,'INVALID_EVIDENCE_RECEIPT');
 }
});
test('post-freeze, LIVE and POST evidence reject instead of backfill',()=>{
 for(const change of [{capturedAt:'2026-10-10T00:00:01.000Z'},{stage:'LIVE'},{stage:'POST'}]){
  const input=fixture();Object.assign(input.evidence[0],change);
  assert.equal(auditSignalEvidenceLedger(input).status,'REJECTED');
 }
});
test('duplicate evidence IDs and duplicate survival reviews reject',()=>{
 const input=fixture();input.evidence[1].evidenceId='e0';
 assert.equal(auditSignalEvidenceLedger(input).status,'REJECTED');
 const other=fixture();other.survivalReviews.push(other.survivalReviews[0]);
 assert.equal(auditSignalEvidenceLedger(other).status,'REJECTED');
});
test('old snapshots without ledger remain unverified and are never repaired',()=>{
 const input=fixture();delete input.evidence;
 assert.equal(auditSignalEvidenceLedger(input).status,'UNVERIFIED');
});
test('triple diamond requires two strong independent positive groups',()=>{
 const input=fixture('💎💎💎');assert.equal(row(input).status,'STRUCTURAL_PASS');
 input.evidence[1].independenceGroup='pace';assert.equal(row(input).status,'UNVERIFIED');
 const other=fixture('💎💎💎');other.evidence[1].strength='NORMAL';
 assert.ok(row(other).reasons.includes('MULTIPLE_STRONG_GROUPS_UNPROVEN'));
});
test('base popularity and mark exclusions still reject a signal violation',()=>{
 const input=fixture('💎');input.snapshot.horses[0].popularityAtFreeze=5;
 assert.equal(row(input).status,'VIOLATION');
 const warning=fixture();warning.snapshot.horses[0].finalMarkAtFreeze='◎';
 assert.ok(row(warning).reasons.includes('WARNING_MARK_CONFLICT'));
});
test('unresolved conflict never becomes a pass',()=>{
 const input=fixture();input.evidence[1].conflict=true;
 assert.ok(row(input).reasons.includes('EVIDENCE_CONFLICT_UNRESOLVED'));
});
test('opposing directions from the same group stay unverified',()=>{
 const input=fixture();input.evidence.push({...input.evidence[0],evidenceId:'e2',direction:'POSITIVE'});
 assert.ok(row(input).reasons.includes('GROUP_DIRECTION_CONFLICT'));
});
test('a review cannot cite evidence captured after it and freeze requires timezone',()=>{
 const input=fixture();input.survivalReviews[0].reviewedAt='2026-10-09T23:59:59.000Z';
 assert.equal(auditSignalEvidenceLedger(input).reason,'INVALID_SURVIVAL_REVIEW');
 const other=fixture();other.snapshot.frozenAt='2026-10-10T00:00:00';
 assert.equal(auditSignalEvidenceLedger(other).reason,'FREEZE_TIMEZONE_REQUIRED');
});
