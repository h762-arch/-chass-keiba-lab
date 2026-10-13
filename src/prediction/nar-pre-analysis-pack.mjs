import {analyzeNarIndexComponents} from './nar-index-analysis.mjs';
import {stableHash} from './precomputed-snapshot.mjs';
import {auditNarAbilityEvidence} from './nar-ability-evidence.mjs';
export const PRE_ANALYSIS_PACK_CONTRACT='CHASS_PRE_ANALYSIS_PACK_V2';
const finite=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const pending=id=>({id,status:'NOT_CONNECTED',reasonCode:'UPSTREAM_NOT_CONNECTED',recoveryAction:`Connect and validate ${id} for a new eligible pre-cutoff run.`});
export async function buildNarPreAnalysisPack({raceId,race,sourceAcquiredAt,horses,contractVersion=PRE_ANALYSIS_PACK_CONTRACT}){
 if(!['CHASS_PRE_ANALYSIS_PACK_V1',PRE_ANALYSIS_PACK_CONTRACT].includes(contractVersion))throw Error('PACK_CONTRACT_UNSUPPORTED');
 const body={contractVersion,scope:'NAR_ABILITY_PRE_ANALYSIS',raceId,race:structuredClone(race),sourceAcquiredAt,
  inputHorseFactsHash:await stableHash(horses),researchOnly:true,formalKpiEligible:false,status:'PARTIAL',
  runnerCards:horses.map(h=>({runnerKey:`${raceId}:${h.horseNo}`,horseNo:h.horseNo,horseName:h.horseName,runnerStatus:h.runnerStatus,
   ability:{score:finite(h.abilityScore),rank:h.abilityRank??null,basis:'NAR_OFFICIAL_CARD_DERIVED',isCpsi:false},
   time:{value:h.predictedTime||null,status:h.predictedTime?'AVAILABLE':'HOLD',reasonCode:h.predictedTime?null:h.evidence?.timeMissingReason||'EVIDENCE_NOT_RETAINED',recoveryAction:h.predictedTime?'NONE':'Review TIME lineage in a new eligible run; preserve original DATA.'},
   evidence:h.evidence?structuredClone(h.evidence):null,
   decision:{status:'NOT_DECIDED',reasonCode:'CHASS_COMPARISON_REQUIRED',recoveryAction:'Use the full Evidence/Scenario/Boundary/Role/Win workflow before final decisions.'}})),
  quality:auditNarAbilityEvidence(horses),
  candidateCoverage:{reviewedRunnerCount:0,allRunnerCount:horses.length,runnerKeys:horses.map(h=>`${raceId}:${h.horseNo}`),status:'ALL_RUNNERS_PRESERVED',discoveryComplete:false},
  workflows:['INDEX_MASTER','ROLLING_HISTORY','CONTEXT_SCENARIOS','CPSI_INLINE','POSITION_PACE','PRESSURE','EARLY_MARKET','FAVORITE_AUDIT','BOTTOM4_AUDIT','ALL_RUNNER_LONGSHOT_RETRIEVER','CANDIDATE_RETENTION','WAVE','BOUNDARY','ROLE_WIN','FORMAL_READINESS'].map(pending)};
 if(contractVersion===PRE_ANALYSIS_PACK_CONTRACT){body.indexAnalysis=analyzeNarIndexComponents(horses);body.workflows.push({id:'INDEX_DERIVED_SCAN',status:'DESCRIPTIVE_RESEARCH',reasonCode:null,recoveryAction:'NONE'});}
 return {body,packHash:await stableHash(body)};
}
export async function verifyNarPreAnalysisPack(pack,{raceId,race,sourceAcquiredAt,horses}){
 try{const expected=await buildNarPreAnalysisPack({raceId,race,sourceAcquiredAt,horses,contractVersion:pack?.body?.contractVersion});return ['CHASS_PRE_ANALYSIS_PACK_V1',PRE_ANALYSIS_PACK_CONTRACT].includes(pack?.body?.contractVersion)&&pack.body.raceId===raceId&&pack.body.sourceAcquiredAt===sourceAcquiredAt&&
  await stableHash(pack.body.race)===await stableHash(race)&&pack.body.inputHorseFactsHash===await stableHash(horses)&&
  pack.packHash===await stableHash(pack.body)&&pack.packHash===expected.packHash&&pack.body.formalKpiEligible===false&&pack.body.runnerCards.length===horses.length&&
  new Set(pack.body.runnerCards.map(h=>h.runnerKey)).size===horses.length&&pack.body.runnerCards.every((h,i)=>h.runnerKey===`${raceId}:${horses[i].horseNo}`);
 }catch{return false;}
}
