import test from 'node:test';
import assert from 'node:assert/strict';

import {
 parseJraPrecomputeSoakGuard,
 inspectJraPrecomputeSoakGuard
} from '../src/prediction/jra-precompute-soak-guard.mjs';

import {
 createJraPrecomputeWorkerRunner
} from '../src/prediction/jra-precompute-worker-scaffold.mjs';

const scheduledTime=Date.parse('2026-09-24T15:30:00Z');

const baseEnv={
 ENABLE_BACKGROUND_PRECOMPUTE:'true',
 JRA_PRECOMPUTE_CALCULATION_VERSION:'jra-ability-data-v1',
 JRA_PRECOMPUTE_MODEL_VERSION:'10.0.1-jra-drive1-ability',
 JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',
 JRA_PRECOMPUTE_MAX_PLANNING_JOBS:'4',
 JRA_PRECOMPUTE_MAX_JOBS:'1',
 JRA_PRECOMPUTE_PLANNING_WINDOW_MS:'2000',
 JRA_PRECOMPUTE_TOTAL_WINDOW_MS:'8000'
};

test('guard is disabled when no canary settings are declared',()=>{
 assert.equal(parseJraPrecomputeSoakGuard({}),null);
});

test('guard parses exact target date and distinct-race cap',()=>{
 assert.deepEqual(
  parseJraPrecomputeSoakGuard({
   JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25',
   JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24'
  }),
  {
   targetDate:'2026-09-25',
   maxDistinctRaces:24
  }
 );
});

test('partial or invalid guard configuration fails closed',()=>{
 assert.throws(
  ()=>parseJraPrecomputeSoakGuard({
   JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25'
  }),
  {code:'jra_precompute_canary_max_distinct_races_invalid'}
 );

 assert.throws(
  ()=>parseJraPrecomputeSoakGuard({
   JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24'
  }),
  {code:'jra_precompute_canary_target_date_invalid'}
 );

 assert.throws(
  ()=>parseJraPrecomputeSoakGuard({
   JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25',
   JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'0'
  }),
  {code:'jra_precompute_canary_max_distinct_races_invalid'}
 );
});

test('guard reports OPEN below cap with exact version-scoped D1 count',async()=>{
 const binds=[];

 const DB={
  prepare(sql){
   assert.match(sql,/COUNT\(DISTINCT race_id\)/);
   assert.match(sql,/data_json IS NOT NULL/);

   return {
    bind(...args){
     binds.push(args);
     return this;
    },
    async first(){
     return {count:23};
    }
   };
  }
 };

 const guard=parseJraPrecomputeSoakGuard({
  JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25',
  JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24'
 });

 const result=await inspectJraPrecomputeSoakGuard({
  DB,
  guard,
  scheduledTargetDate:'2026-09-25',
  calculationVersion:'jra-ability-data-v1',
  modelVersion:'10.0.1-jra-drive1-ability'
 });

 assert.deepEqual(result,{
  status:'OPEN',
  targetDate:'2026-09-25',
  distinctRaces:23,
  maxDistinctRaces:24
 });

 assert.deepEqual(binds,[[
  '20260925-JRA-%',
  'jra-ability-data-v1',
  '10.0.1-jra-drive1-ability'
 ]]);
});

test('guard reports CAP_REACHED at configured distinct-race limit',async()=>{
 const DB={
  prepare(){
   return {
    bind(){return this},
    async first(){return {count:24}}
   };
  }
 };

 const guard=parseJraPrecomputeSoakGuard({
  JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25',
  JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24'
 });

 assert.deepEqual(
  await inspectJraPrecomputeSoakGuard({
   DB,
   guard,
   scheduledTargetDate:'2026-09-25',
   calculationVersion:'jra-ability-data-v1',
   modelVersion:'10.0.1-jra-drive1-ability'
  }),
  {
   status:'CAP_REACHED',
   targetDate:'2026-09-25',
   distinctRaces:24,
   maxDistinctRaces:24
  }
 );
});

test('worker stops before clock, DB and composition on canary date mismatch',async()=>{
 const calls={db:0,clock:0,compose:0};

 const env={
  ...baseEnv,
  JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-26',
  JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24',
  DB:{
   prepare(){
    calls.db++;
    throw new Error('unexpected_db_io');
   }
  }
 };

 const runner=createJraPrecomputeWorkerRunner(env,{
  scheduledTime,
  wallNow(){
   calls.clock++;
   return scheduledTime+1000;
  },
  compose(){
   calls.compose++;
   throw new Error('unexpected_compose');
  }
 });

 assert.deepEqual(await runner(),{
  status:'CANARY_DATE_MISMATCH',
  targetDate:'2026-09-25',
  canaryTargetDate:'2026-09-26',
  ran:false
 });

 assert.deepEqual(calls,{
  db:0,
  clock:0,
  compose:0
 });
});

test('worker stops before planning composition when canary cap is reached',async()=>{
 let prepares=0;
 let compose=0;

 const DB={
  prepare(sql){
   prepares++;

   if(/LIMIT 0/.test(sql)){
    return {
     async first(){return null}
    };
   }

   assert.match(sql,/COUNT\(DISTINCT race_id\)/);

   return {
    bind(){return this},
    async first(){return {count:24}}
   };
  }
 };

 const env={
  ...baseEnv,
  JRA_PRECOMPUTE_CANARY_TARGET_DATE:'2026-09-25',
  JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES:'24',
  DB
 };

 const runner=createJraPrecomputeWorkerRunner(env,{
  scheduledTime,
  wallNow:()=>scheduledTime+1000,
  compose(){
   compose++;
   throw new Error('unexpected_compose');
  }
 });

 assert.deepEqual(await runner(),{
  status:'CANARY_CAP_REACHED',
  targetDate:'2026-09-25',
  distinctRaces:24,
  maxDistinctRaces:24,
  ran:false
 });

 assert.equal(prepares,2);
 assert.equal(compose,0);
});
