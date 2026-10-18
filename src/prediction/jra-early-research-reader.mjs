import {assertMarketIndependentData} from './precomputed-snapshot.mjs';

export const JRA_EARLY_CALCULATION_VERSION='jra-ability-data-v2';
export const JRA_EARLY_MODEL_VERSION='10.0.1-jra-drive1-ability';

const READABLE_STATUSES=new Set(['PARTIAL','CALCULATED']);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'?value.trim():'';
const rejected=reason=>Object.freeze({status:'REJECTED',reason,snapshot:null});
function deepFreeze(value){
 if(value&&typeof value==='object'){
  for(const child of Object.values(value))deepFreeze(child);
  Object.freeze(value);
 }
 return value;
}

export function jraEarlyIdentity(raceId){
 const match=/^(\d{8})-JRA-(.+)-(\d{2})$/.exec(String(raceId||''));
 if(!match||Number(match[3])<1||Number(match[3])>12
  ||!['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉'].includes(match[2]))return null;
 const date=match[1].replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const parsed=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date)return null;
 return {date:match[1],track:match[2],raceNo:Number(match[3])};
}
export function earlyEvidenceTime(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return NaN;
 const day=value.slice(0,10),calendar=Date.parse(day+'T00:00:00Z');
 if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==day)return NaN;
 return Date.parse(value);
}
function containsCurrentOutcome(value,depth=0){
 if(depth>32)throw Error('DEPTH');
 if(!value||typeof value!=='object')return false;
 const forbidden=new Set(['result','results','resultsnapshot','finishorder','actualtimes','actualtime',
  'validationsnapshot','validationcompleted','liveassessment','hasresult']);
 return Object.entries(value).some(([k,v])=>forbidden.has(k.replace(/[^a-z0-9]/gi,'').toLowerCase())||containsCurrentOutcome(v,depth+1));
}

function validData(data,raceId){
 const expected=jraEarlyIdentity(raceId);
 if(!expected||!object(data)||data.schemaVersion!=='JRA-ABILITY-DATA-1'||data.raceType!=='JRA')return false;
 if(!object(data.race)||!Array.isArray(data.horses)||data.horses.length<2||data.horses.length>32)return false;
 if(data.race.date!==expected.date.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3')||
   text(data.race.racecourse)!==expected.track||Number(data.race.raceNo)!==expected.raceNo)return false;
 const numbers=new Set();
 for(const horse of data.horses){
  if(!object(horse))return false;
  const number=horse.horseNo,rank=horse.abilityRank;
  if(!Number.isInteger(number)||number<1||number>99||numbers.has(number)||!text(horse.horseName)||
    !Number.isInteger(rank)||rank<1||rank>data.horses.length||!finite(horse.overall)||horse.overall<0||horse.overall>100||!finite(horse.win)||!finite(horse.place)||
    Object.hasOwn(horse,'finish')||Object.hasOwn(horse,'position')||
    horse.win<0||horse.win>100||horse.place<horse.win||horse.place>100)return false;
  numbers.add(number);
 }
 return true;
}

// Internal research/KPI read path. The viewer flag and public API are deliberately absent.
// Select the earliest nonempty DATA first; validate that one row only, never fall forward.
export async function readJraEarlyResearchSnapshot({DB,raceId,now=Date.now()}={}){
 if(!DB?.prepare)return rejected('D1_UNAVAILABLE');
 if(!jraEarlyIdentity(raceId))return rejected('INVALID_RACE_ID');
 if(!finite(now))return rejected('INVALID_READER_CLOCK');
 const sql=`SELECT organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json
  FROM precomputed_race_snapshots
  WHERE organization=? AND race_id=? AND calculation_version=? AND model_version=?
    AND data_json IS NOT NULL AND data_json<>''
  ORDER BY revision ASC LIMIT 1`;
 let row;
 try{
  row=await DB.prepare(sql).bind('JRA',raceId,JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION).first();
 }catch{return rejected('D1_READ_FAILED');}
 if(!row)return rejected('DATA_NOT_FOUND');
 if(!Number.isInteger(row.revision)||row.revision<1)return rejected('INVALID_REVISION');
 if(row.organization!=='JRA'||row.race_id!==raceId)return rejected('IDENTITY_MISMATCH');
 if(row.calculation_version!==JRA_EARLY_CALCULATION_VERSION||row.model_version!==JRA_EARLY_MODEL_VERSION)return rejected('VERSION_MISMATCH');
 if(!READABLE_STATUSES.has(row.status))return rejected('SNAPSHOT_NOT_READABLE');
 const validatedAt=earlyEvidenceTime(row.source_validated_at);
 const calculatedAt=earlyEvidenceTime(row.data_calculated_at||row.calculated_at);
 if(!Number.isFinite(validatedAt)||!Number.isFinite(calculatedAt))return rejected('INVALID_FRESHNESS');
 if(validatedAt>now||calculatedAt>now)return rejected('FUTURE_TIMESTAMP');
 if(validatedAt>calculatedAt)return rejected('SOURCE_AFTER_CALCULATION');
 if(typeof row.data_json!=='string'||row.data_json.length>1000000)return rejected('DATA_SIZE_INVALID');
 let data;
 try{data=JSON.parse(row.data_json);}catch{return rejected('MALFORMED_DATA');}
 if(!validData(data,raceId))return rejected('MALFORMED_DATA');
 if(data.historicalResearch||data.race.historicalResearch||data.predictionKind==='backtest_prediction'
  ||data.race.predictionKind==='backtest_prediction'||data.race.researchMode==='historical_research')return rejected('HISTORICAL_REFERENCE_ONLY');
 try{if(containsCurrentOutcome(data))return rejected('RESULT_DATA_FORBIDDEN');}catch{return rejected('MALFORMED_DATA');}
 try{assertMarketIndependentData(data);}catch{return rejected('MARKET_DATA_FORBIDDEN');}
 return Object.freeze({status:'READY',reason:null,snapshot:Object.freeze({
  raceId,revision:row.revision,calculationVersion:row.calculation_version,modelVersion:row.model_version,
  sourceValidatedAt:row.source_validated_at,dataCalculatedAt:row.data_calculated_at||row.calculated_at,
  data:deepFreeze(data)
 })});
}
