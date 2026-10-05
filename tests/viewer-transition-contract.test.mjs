import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {STABLE_PRODUCTION_INVARIANTS,assertProductionRuntimeContract,assertViewerOffOnlyTransition} from './helpers/production-runtime-contract.mjs';

const checkedInConfig=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
const candidate=viewer=>{
 const config=structuredClone(checkedInConfig);
 config.vars.ENABLE_PRECOMPUTED_VIEWER=viewer;
 return config;
};

test('test contract accepts explicit Viewer ON and OFF with identical stable invariants',()=>{
 for(const state of ['true','false'])assert.equal(assertProductionRuntimeContract(candidate(state).vars),state);
});

test('Viewer state rejects missing, boolean and noncanonical values instead of silently defaulting',()=>{
 for(const invalid of [undefined,null,true,false,'','TRUE','FALSE','0','1','yes','no']){
  const vars=candidate('true').vars;vars.ENABLE_PRECOMPUTED_VIEWER=invalid;
  assert.throws(()=>assertProductionRuntimeContract(vars));
 }
 const vars=candidate('true').vars;delete vars.ENABLE_PRECOMPUTED_VIEWER;
 assert.throws(()=>assertProductionRuntimeContract(vars));
});

test('each stable production invariant remains mandatory under both Viewer modes',()=>{
 for(const state of ['true','false'])for(const key of Object.keys(STABLE_PRODUCTION_INVARIANTS)){
  for(const replacement of [undefined,null,'changed']){
   const vars=candidate(state).vars;vars[key]=replacement;
   assert.throws(()=>assertProductionRuntimeContract(vars),error=>
    error.code==='ERR_ASSERTION'&&error.message.startsWith(key)&&
    error.actual===replacement&&error.expected===STABLE_PRODUCTION_INVARIANTS[key]);
  }
 }
});

test('isolated ON-to-OFF candidate changes only the Viewer field without mutating checked-in config',()=>{
 const serialized=JSON.stringify(checkedInConfig);
 assertViewerOffOnlyTransition(candidate('true'),candidate('false'));
 assert.equal(JSON.stringify(checkedInConfig),serialized);
 assertProductionRuntimeContract(checkedInConfig.vars);
});

test('Viewer OFF transition rejects reverse, unchanged and malformed states',()=>{
 for(const [before,after] of [['false','true'],['true','true'],['false','false'],['true',undefined]]){
  assert.throws(()=>assertViewerOffOnlyTransition(candidate(before),candidate(after)));
 }
});

test('Viewer OFF candidate rejects any companion config, binding, cron or NAR change',()=>{
 const mutations=[
  config=>{config.vars.ENABLE_BACKGROUND_PRECOMPUTE='false';},
  config=>{config.vars.ENABLE_JRA_DIRECT_FETCH='true';},
  config=>{config.vars.ENABLE_JRA_ODDS_DIRECT_FETCH='true';},
  config=>{config.vars.JRA_PRECOMPUTE_SOURCE_MODE='direct';},
  config=>{config.vars.JRA_PRECOMPUTE_CALCULATION_VERSION='jra-ability-data-v1';},
  config=>{config.vars.JRA_PRECOMPUTE_MODEL_VERSION='changed';},
  config=>{config.vars.JRA_PRECOMPUTE_MAX_JOBS='2';},
  config=>{config.vars.ENABLE_NAR_PREFETCH='false';},
  config=>{config.vars.JRA_PRECOMPUTE_TOTAL_WINDOW_MS='9999';},
  config=>{config.vars.NEW_FLAG='true';},
  config=>{delete config.vars.ENABLE_FAVORITE_RISK_SNAPSHOTS;},
  config=>{config.d1_databases[0].database_id='changed';},
  config=>{config.triggers.crons.push('* * * * *');},
  config=>{config.main='worker.js';},
  config=>{config.assets.run_worker_first=[];}
 ];
 for(const mutate of mutations){
  const after=candidate('false');mutate(after);
  assert.throws(()=>assertViewerOffOnlyTransition(candidate('true'),after));
 }
});
