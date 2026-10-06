import test from 'node:test';
import assert from 'node:assert/strict';
import {buildJraStarShadow} from '../src/research/jra-star-shadow.mjs';

const horses=Array.from({length:7},(_,i)=>({horseNo:i+1,horseName:`馬${i+1}`,abilityRank:i+1,win:20-i,overall:80-i}));
function ready(hs=horses){return {status:'READY',snapshot:{raceId:'20261010-JRA-東京-01',revision:1,
 calculationVersion:'jra-ability-data-v2',modelVersion:'10.0.1-jra-drive1-ability',
 data:{raceType:'JRA',race:{postTime:'10:05'},horses:hs}}};}

test('shadow candidate is stable under runner order and cannot change frozen DATA or numbers',()=>{
 const frozen=ready();const before=JSON.stringify(frozen);
 const a=buildJraStarShadow(frozen),b=buildJraStarShadow(ready([...horses].reverse()));
 assert.equal(a.status,'CANDIDATE');assert.deepEqual(a.candidate,{horseNo:5,horseName:'馬5',abilityRank:5,candidateMark:'☆'});
 assert.deepEqual(a.candidate,b.candidate);
 assert.equal(JSON.stringify(frozen),before);
 assert.equal(frozen.snapshot.data.horses[4].abilityMark,undefined);
 assert.ok(!('win' in a.candidate)&&!('overall' in a.candidate));
});

test('old version and unavailable EARLY cannot create a candidate',()=>{
 assert.equal(buildJraStarShadow({status:'REJECTED',reason:'MALFORMED_DATA'}).reason,'EARLY_NOT_READY');
 const old=ready();old.snapshot.calculationVersion='jra-ability-data-v1';
 assert.equal(buildJraStarShadow(old).reason,'VERSION_MISMATCH');
});

test('market contamination, ambiguous rank and absent rank five fail closed',()=>{
 assert.equal(buildJraStarShadow(ready(horses.map((h,i)=>i===4?{...h,odds:10}:h))).reason,'MARKET_DATA_FORBIDDEN');
 assert.equal(buildJraStarShadow(ready([...horses,{horseNo:8,horseName:'重複順位',abilityRank:5}])).reason,'AMBIGUOUS_RANK_FIVE');
 assert.equal(buildJraStarShadow(ready(horses.slice(0,4))).reason,'NO_RANK_FIVE');
 assert.equal(buildJraStarShadow(ready([...horses,{...horses[0]}])).reason,'INVALID_DATA');
});
