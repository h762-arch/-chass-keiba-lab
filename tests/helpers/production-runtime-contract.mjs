import assert from 'node:assert/strict';

// Test-only contract: Viewer may transition, but production safety must not.
export const STABLE_PRODUCTION_INVARIANTS=Object.freeze({
 ENABLE_BACKGROUND_PRECOMPUTE:'true',
 ENABLE_JRA_DIRECT_FETCH:'false',
 ENABLE_JRA_ODDS_DIRECT_FETCH:'false',
 JRA_PRECOMPUTE_SOURCE_MODE:'official-cache',
 JRA_PRECOMPUTE_CALCULATION_VERSION:'jra-ability-data-v2',
 JRA_PRECOMPUTE_MODEL_VERSION:'10.0.1-jra-drive1-ability',
 JRA_PRECOMPUTE_MAX_JOBS:'1'
});

export function assertStableProductionInvariants(vars){
 assert.ok(vars&&typeof vars==='object'&&!Array.isArray(vars),'production vars required');
 for(const [key,value] of Object.entries(STABLE_PRODUCTION_INVARIANTS))assert.equal(vars[key],value,key);
}

export function assertViewerTransitionState(vars){
 assert.ok(vars&&typeof vars==='object'&&!Array.isArray(vars),'production vars required');
 assert.ok(vars.ENABLE_PRECOMPUTED_VIEWER==='true'||vars.ENABLE_PRECOMPUTED_VIEWER==='false',
  'ENABLE_PRECOMPUTED_VIEWER must be explicitly "true" or "false"');
 return vars.ENABLE_PRECOMPUTED_VIEWER;
}

export function assertProductionRuntimeContract(vars){
 assertStableProductionInvariants(vars);
 return assertViewerTransitionState(vars);
}

// Pure comparison of isolated candidates; never writes config or executes workflow.
export function assertViewerOffOnlyTransition(before,after){
 assertProductionRuntimeContract(before?.vars);
 assertProductionRuntimeContract(after?.vars);
 assert.equal(before.vars.ENABLE_PRECOMPUTED_VIEWER,'true','transition starts ON');
 assert.equal(after.vars.ENABLE_PRECOMPUTED_VIEWER,'false','transition ends OFF');
 const expected=structuredClone(before);
 expected.vars.ENABLE_PRECOMPUTED_VIEWER='false';
 assert.deepEqual(after,expected,'Viewer must be the only config change');
}
