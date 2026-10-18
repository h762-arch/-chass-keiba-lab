import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFavoriteV21Shadow as evaluate } from '../src/prediction/chass-favorite-trust-v21-shadow.mjs';
const S=['BASE','FAVORITE_FRIENDLY','FAVORITE_HOSTILE'];
const cpsi = () => ({value:58.2,rank:5,eligibleHorses:16,coreUsable:2,uncertainty:'HIGH',
  authority:'RECONSTRUCTED_SHADOW',preResult:true,marketBlind:true,neutralizedWeightPct:40});
function rivals(...scenarios) { return [2,3,4].map(n=>({horseNo:n,horseKey:`HORSE-${n}`,
  beatingScenarios:scenarios,evidenceFamilies:['CPSI','PACE'],preResult:true,
  cpsi:cpsi(),routeDescription:`Pre-frozen position and performance: ${n}`,routeSourceId:`PRE-EV-${n}`})); }
function baseline(patch={}) { const input = {raceId:'2026-10-25|東京|8',circuit:'JRA',favoriteHorseNo:1,
  earlyPopularity:1,earlySnapshotId:'PRE-LOCK-01',earlyFrozen:true,originalFormalMark:'',
  cpsi:cpsi(),
  recentStarts:7,negatives:['PACE','CURRENT'],directNegatives:['PACE','CURRENT'],
  challengers:rivals('FAVORITE_HOSTILE'),survivalScenarios:[],collapseScenarios:['FAVORITE_HOSTILE'],
  rescueRebuttalScenarios:[],scenarioStatus:Object.fromEntries(S.map(k=>[k,'PRE_FROZEN'])),
  paceStressInBase:false,wideFieldRoute:false,hasResult:false,hasLateMarket:false,...patch};
  input.evidenceContext ??= {raceId:input.raceId,circuit:input.circuit,earlySnapshotId:input.earlySnapshotId,
    runId:'TEST-RUN',inputFreezeId:'TEST-FREEZE',sourceId:'SYNTHETIC-ONLY',
    sourceAt:'2026-10-25T02:00:00.000Z',freezeAt:'2026-10-25T02:10:00.000Z',
    scheduledStartAt:'2026-10-25T03:00:00.000Z',population:'FLAT',
    runners:Array.from({length:16},(_,i)=>({horseNo:i+1,horseKey:`HORSE-${i+1}`}))};
  input.jointSeatProofs ??= S.filter(s=>input.challengers.filter(c=>c.beatingScenarios.includes(s)).length>=3)
    .map(s=>{const c=input.challengers.filter(c=>c.beatingScenarios.includes(s)).slice(0,3);
      return {scenario:s,horseNos:c.map(x=>x.horseNo),routeSourceIds:c.map(x=>x.routeSourceId),
        compatible:true,sourceId:'SYNTHETIC-JOINT-'+s,
        displacementDescription:'Synthetic same-scenario claim: horses 2,3,4 take all Top3 seats; favorite is fourth or worse.'};});
  return input;
}
const label = x => evaluate(x).label;
test('blocks result fields and later-market inputs',()=>{
  assert.throws(()=>evaluate(baseline({hasResult:true})),/RESULT_OR_LATE_MARKET/);
  assert.throws(()=>evaluate(baseline({hasLateMarket:true})),/RESULT_OR_LATE_MARKET/);
  assert.throws(()=>evaluate({...baseline(),resultRank:1}),/POST_OR_LATE_FIELD/);
});
test('rejects unfrozen Original EARLY',()=>assert.throws(()=>evaluate(baseline({earlyFrozen:false})),/ORIGINAL_EARLY_FREEZE/));
test('scope is EARLY popularity 1-3 only',()=>assert.equal(label(baseline({earlyPopularity:4})),'NO_WARNING'));
test('Production mark conflict is review-only and never changes formal signal',()=>{
  const x=evaluate(baseline({originalFormalMark:'◎'}));
  assert.equal(x.label,'WATCH_RECHECK');assert.equal(x.productionWrite,false);assert.equal(x.originalEarlyMutation,false);
});
test('2-year-old thin history is not automatic collapse evidence',()=>{
  assert.equal(label(baseline({recentStarts:1,negatives:['LOW_SAMPLE','CPSI_RANK_LOW'],directNegatives:[]})),'WATCH_RECHECK');
});
test('first class and unknown distance are not independent negative families',()=>{
  const x=evaluate(baseline({negatives:['FIRST_CLASS_ONLY','DISTANCE_UNKNOWN'],directNegatives:[]}));
  assert.equal(x.distinctDirectNegativeFamilies,0);
});
test('exactly two credible challengers cannot claim all three Top3 seats',()=>{
  const x=evaluate(baseline({challengers:rivals('FAVORITE_HOSTILE').slice(0,2)}));
  assert.equal(x.label,'WATCH_RECHECK');assert.equal(x.hostileChallengerCount,2);
});
test('three named challengers with direct route in SAME scenario can trigger Shadow warning',()=>{
  assert.equal(label(baseline()),'SHADOW_⚠️');
});
test('candidates scattered across scenarios cannot be aggregated',()=>{
  const c=rivals('BASE').map((x,i)=>({...x,beatingScenarios:[S[i]]}));
  assert.equal(label(baseline({challengers:c,collapseScenarios:S})),'WATCH_RECHECK');
});
test('strong warning requires three independent negatives and two scenarios',()=>{
  const x=baseline({negatives:['PACE','CURRENT','CLASS'],directNegatives:['PACE','CURRENT','CLASS'],
     challengers:rivals('BASE','FAVORITE_HOSTILE'),collapseScenarios:['BASE','FAVORITE_HOSTILE']});
  assert.equal(label(x),'SHADOW_⚠️⚠️');
});
test('catastrophic warning requires all three scenarios and four independently evidenced negatives',()=>{
  const x=baseline({negatives:['PACE','CURRENT','CLASS','TRAINING'],directNegatives:['PACE','CURRENT','CLASS','TRAINING'],
     challengers:rivals(...S),collapseScenarios:S});
  assert.equal(label(x),'SHADOW_⚠️⚠️⚠️');
});
test('direct survival/rescue counter-evidence blocks warning',()=>{
  assert.equal(label(baseline({rescueRebuttalScenarios:['FAVORITE_HOSTILE']})),'WATCH_RECHECK');
  assert.equal(label(baseline({survivalScenarios:['FAVORITE_HOSTILE']})),'WATCH_RECHECK');
});
test('unknown scenario provenance blocks warning',()=>{
  assert.equal(evaluate(baseline({scenarioStatus:{BASE:'PRE_FROZEN'}})).reason,'SCENARIO_PROOF_INCOMPLETE');
});
test('CPSI unavailable does not fabricate numeric score or cause warning on its own',()=>{
  const c=baseline();c.cpsi={value:null,rank:null,eligibleHorses:0,coreUsable:1,authority:'UNKNOWN',preResult:true,marketBlind:true};
  c.negatives=['CPSI_RANK_LOW'];c.directNegatives=['CPSI_RANK_LOW'];
  const x=evaluate(c);assert.equal(x.cpsiStatus,'INSUFFICIENT');assert.equal(x.label,'WATCH_RECHECK');
});
test('forward pace-fragility watch is retained with official mark',()=>{
  const x=evaluate(baseline({originalFormalMark:'◎',paceStressInBase:true}));
  assert.equal(x.paceStressWatch,true);assert.equal(x.label,'WATCH_RECHECK');
});
test('pace and position are one independent negative family',()=>{
  const x=evaluate(baseline({negatives:['PACE','POSITION'],directNegatives:['PACE','POSITION']}));
  assert.equal(x.distinctDirectNegativeFamilies,1);assert.equal(x.label,'WATCH_RECHECK');
});
test('peak and average alone cannot certify independent challenger routes',()=>{
  const c=rivals('FAVORITE_HOSTILE').map(x=>({...x,evidenceFamilies:['PEAK','AVG']}));
  const x=evaluate(baseline({challengers:c}));
  assert.equal(x.hostileChallengerCount,0);assert.equal(x.label,'WATCH_RECHECK');
});
test('CPSI and raw index components collapse to one ability family',()=>{
  const x=evaluate(baseline({negatives:['CPSI_RANK_LOW','INDEX','CURRENT'],directNegatives:['CURRENT']}));
  assert.equal(x.distinctDirectNegativeFamilies,1);
});
test('inputs are immutable to the consumer and output is frozen',()=>{
  const x=baseline(),before=structuredClone(x),out=evaluate(x);
  assert.deepEqual(x,before);assert.equal(Object.isFrozen(out),true);
});
test('getter-based untrusted input rejected without executing getter',()=>{
  const x=baseline();let ran=0;
  Object.defineProperty(x,'resultRank',{enumerable:true,get(){ran++;return 1;}});
  assert.throws(()=>evaluate(x),/GETTER/);assert.equal(ran,0);
});
test('duplicate challenger identity rejected',()=>{
  const c=rivals('FAVORITE_HOSTILE');c[1].horseNo=2;
  assert.throws(()=>evaluate(baseline({challengers:c})),/CHALLENGER_ID/);
});
test('JRA and NAR remain circuit-separated; no cross-circuit calculation',()=>{
  assert.equal(evaluate(baseline({circuit:'JRA'})).raceId,'2026-10-25|東京|8');
  assert.equal(evaluate(baseline({circuit:'NAR',raceId:'2026-10-25|高知|8'})).productionWrite,false);
  assert.throws(()=>evaluate(baseline({circuit:'NAR'})),/RACE_CIRCUIT/);
});
test('prospective warning is never a probability, CPSI revision, or Formal KPI',()=>{
  const x=evaluate(baseline());
  assert.equal(x.aiProbabilityMutation,false);assert.equal(x.scoreMutation,false);assert.equal(x.formalKpiEligible,false);
  assert.equal(x.sourceOriginAuthenticated,false);assert.equal(x.warningAuthority,'SHADOW_ONLY');
});

// All fixtures are synthetic schema tests; no live acquisition or performance claim.
for (const [name,mutate,reason] of [
  ['unknown direct family', x=>{x.negatives=x.directNegatives=['MADE_UP_A','MADE_UP_B'];},'UNKNOWN_FAMILY'],
  ['prototype name as family', x=>{x.negatives=['toString','CURRENT'];},'UNKNOWN_FAMILY'],
  ['invented challenger family', x=>{x.challengers[0].evidenceFamilies=['CPSI','MADE_UP'];},'UNKNOWN_FAMILY'],
  ['duplicate horseKey under different numbers', x=>{x.challengers[1].horseKey=x.challengers[0].horseKey;},'CHALLENGER_PROOF'],
  ['challenger identity absent from roster', x=>{x.challengers[0].horseKey='OTHER-RACE-HORSE';},'CHALLENGER_ROSTER'],
  ['favorite relabelled as challenger', x=>{x.challengers[0].horseKey='HORSE-1';},'CHALLENGER_ROSTER'],
  ['duplicate roster identity', x=>{x.evidenceContext.runners[1].horseKey='HORSE-1';},'ROSTER'],
  ['CPSI negative coverage', x=>{x.cpsi.coveragePct=-5;},'CPSI_COVERAGE'],
  ['CPSI neutralized weight over 100', x=>{x.cpsi.neutralizedWeightPct=200;},'CPSI_COVERAGE'],
  ['CPSI fabricated core count', x=>{x.cpsi.coreUsable=999;},'CPSI_CORE'],
  ['CPSI rank missing', x=>{delete x.cpsi.rank;},'CPSI_RANK'],
  ['CPSI cohort exceeds roster', x=>{x.cpsi.eligibleHorses=17;},'CPSI_ROSTER'],
  ['challenger CPSI cohort exceeds roster', x=>{x.challengers[0].cpsi.eligibleHorses=17;},'CPSI_ROSTER'],
  ['challenger CPSI cohort differs from favorite', x=>{x.challengers[0].cpsi.eligibleHorses=12;},'CPSI_COHORT'],
  ['CPSI invalid numeric score', x=>{x.cpsi.value=-1;},'CPSI_VALUE'],
  ['invalid calendar day', x=>{x.raceId='2026-02-30|東京|8';},'RACE_CIRCUIT'],
  ['JRA and NAR circuit mismatch', x=>{x.circuit='NAR';},'RACE_CIRCUIT'],
  ['nonexistent race number', x=>{x.raceId='2026-10-25|東京|13';},'RACE_CIRCUIT'],
  ['source race mismatch', x=>{x.evidenceContext.raceId='2026-10-25|東京|9';},'EVIDENCE_BINDING'],
  ['source circuit mismatch', x=>{x.evidenceContext.circuit='NAR';},'EVIDENCE_BINDING'],
  ['source freeze snapshot mismatch', x=>{x.evidenceContext.earlySnapshotId='OTHER';},'EVIDENCE_BINDING'],
  ['source acquired after cutoff', x=>{x.evidenceContext.sourceAt='2026-10-25T02:11:00.000Z';},'EVIDENCE_TIME'],
  ['cutoff equal to start', x=>{x.evidenceContext.freezeAt=x.evidenceContext.scheduledStartAt;},'EVIDENCE_TIME'],
  ['start on wrong JST day', x=>{x.evidenceContext.scheduledStartAt='2026-10-26T03:00:00.000Z';},'EVIDENCE_TIME'],
  ['unrecognized formal mark', x=>{x.originalFormalMark='NOT_A_MARK';},'FORMAL_MARK'],
  ['missing recent history count', x=>{delete x.recentStarts;},'RECENT_STARTS'],
  ['negative recent history count', x=>{x.recentStarts=-1;},'RECENT_STARTS'],
  ['string boolean', x=>{x.paceStressInBase='false';},'BOOLEAN'],
  ['string negative list', x=>{x.directNegatives='PACE';},'FAMILY_SCHEMA'],
  ['duplicate horse in joint proof', x=>{x.jointSeatProofs[0].horseNos=[2,2,3];},'JOINT_PROOF'],
  ['duplicate scenario joint proof', x=>{x.jointSeatProofs.push(structuredClone(x.jointSeatProofs[0]));},'JOINT_PROOF'],
  ['missing fourth-or-worse explanation', x=>{delete x.jointSeatProofs[0].displacementDescription;},'JOINT_PROOF'],
  ['false survival list cannot mean no counter-evidence', x=>{x.survivalScenarios=false;},'SURVIVAL_SCENARIOS'],
  ['missing rescue list cannot mean completed review', x=>{delete x.rescueRebuttalScenarios;},'RESCUE_SCENARIOS'],
]) test('review rejects '+name,()=>{
  const input=baseline();mutate(input);
  assert.throws(()=>evaluate(input),new RegExp(reason));
});

for (const [name,mutate] of [
  ['missing shared frozen context', x=>{delete x.evidenceContext;}],
  ['missing joint displacement proof', x=>{delete x.jointSeatProofs;}],
  ['joint route source mismatch', x=>{x.jointSeatProofs[0].routeSourceIds[0]='OTHER';}],
  ['incompatible joint routes', x=>{x.jointSeatProofs[0].compatible=false;}],
  ['missing challenger CPSI', x=>{delete x.challengers[0].cpsi;}],
  ['legacy raw indices are not CPSI', x=>{x.challengers[0].evidenceFamilies=['PEAK','PACE'];}],
  ['non-market-blind CPSI', x=>{x.cpsi.marketBlind=false;}],
  ['unavailable CPSI despite negative families', x=>{x.cpsi.value=null;}],
  ['missing CPSI neutralization disclosure', x=>{delete x.cpsi.neutralizedWeightPct;}],
  ['newcomer requires specialty route', x=>{x.evidenceContext.population='NEWCOMER';}],
  ['jump requires specialty route', x=>{x.evidenceContext.population='JUMP';}],
  ['ABILITY canonical cannot count as observed negative', x=>{x.negatives=x.directNegatives=['ABILITY','CURRENT'];}],
]) test('review watches '+name,()=>{
  const input=baseline();mutate(input);
  assert.equal(label(input),'WATCH_RECHECK');
});

test('array getters rejected without execution',()=>{
  const input=baseline();let ran=0;
  Object.defineProperty(input.challengers,'0',{enumerable:true,get(){ran++;return {};}});
  assert.throws(()=>evaluate(input),/GETTER/);assert.equal(ran,0);
});
test('sparse arrays rejected',()=>{
  const input=baseline();delete input.challengers[1];
  assert.throws(()=>evaluate(input),/ARRAY_KEYS|ARRAY_HOLE/);
});
test('hidden and symbol data cannot bypass rejection',()=>{
  for(const array of [false,true])for(const key of ['hidden',Symbol('result')]){
    const input=baseline(),target=array?input.challengers:input;
    Object.defineProperty(target,key,{value:1,enumerable:false});
    assert.throws(()=>evaluate(input),/ARRAY_KEYS|SYMBOL_KEY|HIDDEN_KEY/);
  }
});
test('prototype-modified arrays rejected',()=>{
  const input=baseline();Object.setPrototypeOf(input.challengers,null);
  assert.throws(()=>evaluate(input),/PROTOTYPE/);
});
test('all five formal marks block warning even with strongest scenario claims',()=>{
  for(const originalFormalMark of ['◎','○','▲','△','☆']){
    const input=baseline({originalFormalMark,negatives:['PACE','CURRENT','CLASS','TRAINING'],
      directNegatives:['PACE','CURRENT','CLASS','TRAINING'],challengers:rivals(...S),collapseScenarios:S});
    assert.equal(label(input),'WATCH_RECHECK');
  }
});
test('bounded coverage percentages are disclosures, not performance proof',()=>{
  const input=baseline();input.cpsi.coveragePct=60;
  const out=evaluate(input);assert.equal(out.label,'SHADOW_⚠️');
  assert.equal(out.liveAcquisitionVerified,false);assert.equal(out.sourceOriginAuthenticated,false);
  assert.equal(out.winAssessment,'NOT_IMPLEMENTED');assert.equal(out.top3Assessment,'SCENARIO_REVIEW_ONLY');
});
test('numeric CPSI eligible cohort may be smaller than complete field',()=>{
  const input=baseline();input.cpsi.eligibleHorses=12;
  for(const rival of input.challengers)rival.cpsi.eligibleHorses=12;
  assert.equal(label(input),'SHADOW_⚠️');
});
