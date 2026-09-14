import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAR_TIME_THEORY_VERSION,
  normalizeNarTimeRun,
  buildNarTimeTheory,
  rankNarTimeTheoryHorses,
  summarizeNarTimeTheoryRace
} from '../src/nar/nar-time-theory.mjs';

test('exact same-track time evidence is preferred over faster cross-track evidence',()=>{
  const runs=[
    {date:'2026-09-01',track:'大井',surface:'ダ',distance:1600,timeSec:100,last3f:38,finish:2},
    {date:'2026-08-01',track:'大井',surface:'ダ',distance:1600,timeSec:101,last3f:38.5,finish:3},
    {date:'2026-07-01',track:'大井',surface:'ダ',distance:1600,timeSec:102,last3f:39,finish:4},
    {date:'2026-06-01',track:'門別',surface:'ダ',distance:1600,timeSec:95,last3f:37,finish:1}
  ];
  const x=buildNarTimeTheory({runs,targetDistance:1600,targetTrack:'大井',abilityPredictedTimeSec:101.4});
  assert.equal(x.version,NAR_TIME_THEORY_VERSION);
  assert.equal(x.available,true);
  assert.equal(x.evidence.type,'exact_same_track');
  assert.equal(x.evidence.sampleCount,3);
  assert.equal(x.times.peakTimeSec,100);
  assert.equal(x.times.targetTimeSec,101);
  assert.ok(x.times.currentTimeSec<101);
  assert.equal(x.researchOnly,true);
  assert.equal(x.affectsProbability,false);
});

test('near-distance fallback uses transparent linear target-distance normalization',()=>{
  const run={track:'大井',surface:'ダ',distance:1400,timeSec:88};
  const normalized=normalizeNarTimeRun(run,{targetDistance:1600,targetTrack:'大井'});
  assert.equal(normalized.exactDistance,false);
  assert.equal(normalized.sameTrack,true);
  assert.ok(Math.abs(normalized.targetEquivalentSec-(88*1600/1400))<1e-9);

  const x=buildNarTimeTheory({
    runs:[
      {...run,date:'2026-09-01'},
      {...run,date:'2026-08-01',timeSec:89},
      {...run,date:'2026-07-01',timeSec:90}
    ],
    targetDistance:1600,
    targetTrack:'大井'
  });
  assert.equal(x.evidence.type,'near_same_track');
  assert.equal(x.evidence.distanceAdjusted,true);
  assert.equal(x.confidence,'low');
});

test('scenario band and time trend are data-derived from comparable recent runs',()=>{
  const runs=[
    {track:'大井',surface:'ダ',distance:1200,timeSec:72.0,last3f:36.0,finish:3},
    {track:'大井',surface:'ダ',distance:1200,timeSec:72.4,last3f:36.2,finish:4},
    {track:'大井',surface:'ダ',distance:1200,timeSec:72.6,last3f:36.4,finish:5},
    {track:'大井',surface:'ダ',distance:1200,timeSec:73.6,last3f:37.0,finish:6},
    {track:'大井',surface:'ダ',distance:1200,timeSec:74.0,last3f:37.3,finish:7},
    {track:'大井',surface:'ダ',distance:1200,timeSec:74.2,last3f:37.4,finish:8}
  ];
  const x=buildNarTimeTheory({runs,targetDistance:1200,targetTrack:'大井'});
  assert.ok(x.times.peakTimeSec<=x.times.bestScenarioTimeSec);
  assert.ok(x.times.bestScenarioTimeSec<=x.times.slowScenarioTimeSec);
  assert.equal(x.trend.time.direction,'improving');
  assert.equal(x.trend.last3f.direction,'improving');
});

test('poor finish with time held is surfaced as a research signal, not a probability change',()=>{
  const runs=[
    {track:'大井',surface:'ダ',distance:1600,timeSec:101.0,last3f:39.0,finish:9},
    {track:'大井',surface:'ダ',distance:1600,timeSec:101.2,last3f:39.2,finish:3},
    {track:'大井',surface:'ダ',distance:1600,timeSec:100.8,last3f:38.8,finish:2}
  ];
  const x=buildNarTimeTheory({runs,targetDistance:1600,targetTrack:'大井'});
  assert.equal(x.signals.poorFinishButTimeHeld,true);
  assert.equal(x.affectsProbability,false);
});

test('race ranking exposes ability-vs-time rank gap for future longshot and danger research',()=>{
  const ranked=rankNarTimeTheoryHorses([
    {horseNumber:1,horseName:'A',ability:{abilityRank:5},timeTheory:{available:true,times:{targetTimeSec:100}}},
    {horseNumber:2,horseName:'B',ability:{abilityRank:1},timeTheory:{available:true,times:{targetTimeSec:102}}},
    {horseNumber:3,horseName:'C',ability:{abilityRank:2},timeTheory:{available:true,times:{targetTimeSec:101}}},
    {horseNumber:4,horseName:'D',ability:{abilityRank:3},timeTheory:{available:true,times:{targetTimeSec:103}}}
  ]);
  const a=ranked.find(h=>h.horseNumber===1);
  assert.equal(a.timeTheory.timeRank,1);
  assert.equal(a.timeTheory.abilityRankGap,4);
  assert.equal(a.timeTheory.rankSignal,'time_theory_upside');

  const summary=summarizeNarTimeTheoryRace(ranked);
  assert.equal(summary.availableHorseCount,4);
  assert.equal(summary.fastestTargetHorse.horseNumber,1);
  assert.deepEqual(summary.upsideHorseNumbers,[1]);
});

test('missing comparable times stays unavailable instead of inventing a number',()=>{
  const x=buildNarTimeTheory({
    runs:[{track:'大井',distance:1600,timeSec:null}],
    targetDistance:1600,
    targetTrack:'大井'
  });
  assert.equal(x.available,false);
  assert.equal(x.missingReason,'comparable_time_history_missing');
});


test('null numeric inputs stay missing instead of becoming zero',()=>{
  const runs=[
    {track:'大井',surface:'ダ',distance:1600,timeSec:101.0,last3f:39.0,finish:3},
    {track:'大井',surface:'ダ',distance:1600,timeSec:101.2,last3f:39.2,finish:4}
  ];
  const missingTarget=buildNarTimeTheory({runs,targetDistance:null,targetTrack:'大井'});
  assert.equal(missingTarget.available,false);
  assert.equal(missingTarget.missingReason,'target_distance_missing');

  const x=buildNarTimeTheory({
    runs,
    targetDistance:1600,
    targetTrack:'大井',
    abilityPredictedTimeSec:null
  });
  assert.equal(x.comparison.abilityPredictedTimeSec,null);
  assert.equal(x.comparison.abilityVsTargetGapSec,null);
  assert.equal(x.comparison.abilityAlignment,'unavailable');

  const ranked=rankNarTimeTheoryHorses([
    {horseNumber:1,ability:{abilityRank:null},timeTheory:{available:true,times:{targetTimeSec:101}}}
  ]);
  assert.equal(ranked[0].timeTheory.abilityRankGap,null);
  assert.equal(ranked[0].timeTheory.rankSignal,'unavailable');
});
