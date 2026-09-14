import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAR_RACE_CONTEXT_POLICY_VERSION,
  classifyAbilityAvailability
} from '../src/nar/nar-race-context-policy.mjs';

test('successful ability payload stays ability+history',()=>{
  const x=classifyAbilityAvailability({status:200,payload:{ok:true,horses:[]}});
  assert.equal(NAR_RACE_CONTEXT_POLICY_VERSION,'nar-race-context-history-only-v1');
  assert.deepEqual(x,{available:true,historyOnly:false,reason:null});
});

test('404 RACE_NOT_FOUND degrades to history-only instead of failing context',()=>{
  const x=classifyAbilityAvailability({
    status:404,
    payload:{ok:false,error:{code:'RACE_NOT_FOUND',message:'Race data was not found.'}}
  });
  assert.deepEqual(x,{available:false,historyOnly:true,reason:'ability_race_not_found'});
});

test('other ability failures remain hard failures',()=>{
  assert.deepEqual(
    classifyAbilityAvailability({status:500,payload:{ok:false,error:{code:'INTERNAL_ERROR'}}}),
    {available:false,historyOnly:false,reason:'ability_api_failed'}
  );
  assert.deepEqual(
    classifyAbilityAvailability({status:404,payload:{ok:false,error:{code:'OTHER_NOT_FOUND'}}}),
    {available:false,historyOnly:false,reason:'ability_api_failed'}
  );
});
