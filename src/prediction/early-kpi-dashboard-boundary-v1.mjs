// Browser metadata is reference-only. A seal, D1 location or eligibility flag
// cannot authenticate a PRE acquisition; this module has no promotion API.
export const EARLY_DASHBOARD_BOUNDARY_VERSION='CHASS_EARLY_DASHBOARD_BOUNDARY_V1';
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
export function summarizeBrowserReferenceCohort(records){
 const common={version:EARLY_DASHBOARD_BOUNDARY_VERSION,basis:'BROWSER_COMPATIBILITY_RECORDS',
  formalRaceCount:0,formalKpiReadiness:'HOLD',sourceOriginAuthenticated:false,
  probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
 if(!Array.isArray(records)||records.length>5000)return freeze({...common,status:'HOLD',reason:'BOUNDED_RECORDS_REQUIRED',referenceRaceCount:null,groups:null});
 const groups={JRA:{count:0,historical:0,earlyMissing:0},NAR:{count:0,historical:0,earlyMissing:0},UNKNOWN:{count:0,historical:0,earlyMissing:0}};
 for(const record of records){
  const r=record?.race||record?.predictionSnapshot?.race||{},kind=record?.predictionSnapshot?.raceType||r.raceType||r.category||'';
  const org=/^(?:JRA|中央競馬)$/.test(kind)?'JRA':/^(?:NAR|地方競馬)$/.test(kind)?'NAR':'UNKNOWN';
  const g=groups[org];g.count++;
  if(record?.historicalResearch||r.researchMode==='historical_research'||r.predictionKind==='backtest_prediction'
   ||record?.predictionSnapshot?.predictionKind==='backtest_prediction')g.historical++;
  if(!Array.isArray(record?.predictionSnapshot?.horses)||!record.predictionSnapshot.horses.length)g.earlyMissing++;
 }
 return freeze({...common,status:'REFERENCE_ONLY',reason:'AUTHENTICATED_EARLY_READER_REQUIRED',referenceRaceCount:records.length,groups});
}
