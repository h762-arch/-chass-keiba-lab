import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {parseJraRaceCard} from '../jra-race-fetch.mjs';
import {readJraOfficialRaceCache} from '../jra-official-cache.mjs';
import * as abilityCore from '../src/prediction/jra-ability-core.mjs';
import * as abilityProjector from '../src/prediction/jra-ability-result-projector.mjs';

const selection={date:'2026-09-05',racecourse:'中山',raceNo:5};
const parsed=parseJraRaceCard(fs.readFileSync(new URL('./fixtures/jra/jra-race-card-fixture.html',import.meta.url),'utf8'),{date:selection.date,track:selection.racecourse,race:selection.raceNo});
const payload=()=>({ok:true,organization:'JRA',...structuredClone(parsed),dataConfidence:'high'});
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const commitSource=app.match(/function commitJraOfficial\(data,generation\)\{[\s\S]*?\n\}/)[0];

function appCommit({generation=1,mode='JRA',identityMatches=true}={}){
  let prediction=null,transitions=0,filled=0;
  const window={CHASS_JRA_ABILITY_CORE:abilityCore,CHASS_JRA_ABILITY_RESULT_PROJECTOR:abilityProjector};
  const context=vm.createContext({window,console,activeRaceGeneration:generation,state:{},
    raceTypeOf:()=>mode,jraRaceInput:()=>selection,
    jraPayloadMatchesActive:value=>identityMatches&&value.date===selection.date&&value.track===selection.racecourse&&Number(value.race)===selection.raceNo,
    beginActiveRaceTransition:()=>{transitions++},jraDraftFromSelection:value=>value,
    fillJraRace:()=>{filled++},
    commitJraNormalized:normalized=>{prediction=window.CHASS_JRA_ADAPTER.run(normalized).prediction}
  });
  for(const name of ['jra-normalizer.js','jra-model.js','jra-adapter.js'])vm.runInContext(fs.readFileSync(new URL('../'+name,import.meta.url),'utf8'),context);
  vm.runInContext(commitSource,context);
  return {commit:(data,turn=1)=>context.commitJraOfficial(data,turn),get prediction(){return prediction},get transitions(){return transitions},get filled(){return filled}};
}

test('nested official card identity reaches the real JRA prediction adapter',()=>{
  const c=appCommit();assert.equal(c.commit(payload()),true);
  assert.equal(c.prediction.horses.length,parsed.quality.activeHorseCount);
  assert.ok(Math.abs(c.prediction.horses.reduce((sum,h)=>sum+h.win,0)-100)<.1);
  assert.equal(c.transitions,0);assert.equal(c.filled,1);
});

test('expired official D1 card still commits as saved base without fabricated live fields',async()=>{
  const row={payload_json:JSON.stringify(payload()),expires_at:'2026-09-04T00:00:00Z',fetched_at:'2026-09-03T00:00:00Z'};
  const env={DB:{prepare:()=>({bind:()=>({first:async()=>row})})}};
  const {body}=await readJraOfficialRaceCache(env,{nowMs:Date.parse('2026-09-05T00:00:00Z')});
  const before=JSON.stringify(body),c=appCommit();assert.equal(c.commit(body),true);
  assert.equal(c.prediction.horses.length,body.horses.length);
  assert.equal(body.liveFieldsVerified,false);assert.ok(body.horses.every(h=>h.jockey===''&&h.odds===null));
  assert.equal(JSON.stringify(body),before);
});

test('wrong nested date, course, race, organization or missing race never reaches calculation',()=>{
  for(const patch of [{race:{...parsed.race,date:'2026-09-06'}},{race:{...parsed.race,racecourse:'東京'}},{race:{...parsed.race,raceNo:6}},{organization:'NAR'},{race:5},{race:null}]){
    const c=appCommit();assert.equal(c.commit({...payload(),...patch,date:selection.date,track:selection.racecourse}),false);
    assert.equal(c.prediction,null);assert.equal(c.filled,0);
  }
});

test('stale generation and NAR mode reject a matching card before calculation',()=>{
  for(const options of [{generation:2},{mode:'NAR'}]){const c=appCommit(options);assert.equal(c.commit(payload()),false);assert.equal(c.prediction,null)}
});

test('cancelled runners remain excluded and active identity is established before commit',()=>{
  const data=payload();data.horses[0].runningStatus='scratched';
  const c=appCommit({identityMatches:false});assert.equal(c.commit(data),true);
  assert.equal(c.transitions,1);assert.equal(c.prediction.horses.length,data.horses.length-1);
  assert.ok(c.prediction.horses.every(h=>h.horseNo!==data.horses[0].horseNo));
});

function client(commit){
  const elements=Object.fromEntries(['jraOfficialLoad','jraStatus','jraDataFile','jraManualFallback'].map(id=>[id,{addEventListener(){},textContent:'',disabled:false}]));
  const events=[];
  const window={CHASS_FEATURES:{},dispatchEvent:event=>events.push(event)};
  const context=vm.createContext({window,document:{getElementById:id=>elements[id]},fetch:async()=>({ok:true,json:async()=>payload()}),URLSearchParams,AbortController,setTimeout,clearTimeout,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}}});
  vm.runInContext(fs.readFileSync(new URL('../jra-race-client.js',import.meta.url),'utf8'),context);
  const api=window.CHASS_JRA_RACE_CLIENT.create({isActive:()=>true,getGeneration:()=>1,getSelection:()=>({date:selection.date,track:selection.racecourse,race:selection.raceNo}),commit});
  api.setActive(true);return {api,elements,events};
}

test('rejected app commit cannot report success or trigger odds acquisition',async()=>{
  const c=client(()=>false);await c.api.load();
  assert.match(c.elements.jraStatus.textContent,/JRA_RACE_COMMIT_REJECTED/);
  assert.doesNotMatch(c.elements.jraStatus.textContent,/予想計算完了/);
  assert.equal(c.events.length,0);assert.equal(c.elements.jraOfficialLoad.disabled,false);
});

test('successful app commit reports completion and triggers the race-ready event once',async()=>{
  const app=appCommit(),c=client(data=>app.commit(data));await c.api.load();
  assert.ok(app.prediction.horses.length>0);assert.match(c.elements.jraStatus.textContent,/予想計算完了/);
  assert.equal(c.events.length,1);assert.equal(c.events[0].type,'chass:jra-race-ready');
});
