import * as abilityCore from './jra-ability-core.mjs';
import * as abilityResultProjector from './jra-ability-result-projector.mjs';

window.CHASS_JRA_ABILITY_CORE=abilityCore;
window.CHASS_JRA_ABILITY_RESULT_PROJECTOR=abilityResultProjector;
const scripts=[
 '/jra-model.js',
 '/jra-adapter.js',
 '/src/research/longshot-scenario.js',
 '/src/research/calibration-research.js',
 '/jra-meeting-selector.js',
 '/jra-race-client.js',
 '/jra-odds-client.js',
 '/jra-result-client.js',
 '/app.js'
];
for(const src of scripts){
 await new Promise((resolve,reject)=>{
  const element=document.createElement('script');
  element.src=src;
  element.onload=resolve;
  element.onerror=()=>reject(new Error(`Failed to load ${src}`));
  document.body.append(element);
 });
}
