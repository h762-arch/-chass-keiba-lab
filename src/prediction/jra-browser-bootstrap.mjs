import * as abilityCore from './jra-ability-core.mjs';
import * as abilityResultProjector from './jra-ability-result-projector.mjs';
import {evaluateWebCourseShadowFromSnapshot} from './course-asset-web-adapter-v1.mjs';
import * as cpsiWaveCore from './chass-cpsi-wave-core-v1.mjs';
import * as cpsiSourceRecovery from './cpsi-source-recovery-v1.mjs';
import * as earlyKpiBoundary from './early-kpi-dashboard-boundary-v1.mjs';

window.CHASS_JRA_ABILITY_CORE=abilityCore;
window.CHASS_JRA_ABILITY_RESULT_PROJECTOR=abilityResultProjector;
window.CHASS_CPSI_WAVE_CORE=cpsiWaveCore;
window.CHASS_CPSI_SOURCE_RECOVERY=cpsiSourceRecovery;
window.CHASS_EARLY_KPI_BOUNDARY=earlyKpiBoundary;
// Prepared before app.js loads. Explicit opt-in only; production prediction is unchanged.
window.CHASS_COURSE_SHADOW_PREFLIGHT=Object.freeze({evaluate:evaluateWebCourseShadowFromSnapshot,mode:'SHADOW_ONLY_UNWIRED'});
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
