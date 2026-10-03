export const JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION='jra-ability-data-v1';
export const JRA_PRECOMPUTED_VIEWER_MODEL_VERSION='10.0.1-jra-drive1-ability';
export const JRA_PRECOMPUTED_VIEWER_MAX_AGE_MS=15*60_000;

const ALLOWED_ROW_STATUSES=new Set(['PARTIAL','CALCULATED']);
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>typeof value==='string'?value.trim():'';

export function precomputedViewerEnabled(env={}){
  return String(env?.ENABLE_PRECOMPUTED_VIEWER||'').trim().toLowerCase()==='true';
}

function rejected(reason,extra={}){
  return Object.freeze({status:'REJECTED',reason,...extra,race:null});
}

function parseRaceId(raceId){
  const match=/^(\d{8})-JRA-(.+)-(\d{2})$/.exec(String(raceId||''));
  if(!match)return null;
  const raceNo=Number(match[3]);
  if(!Number.isInteger(raceNo)||raceNo<1||raceNo>12)return null;
  return {date:match[1],track:match[2],raceNo};
}

function normalizeDate(value){
  return String(value||'').replace(/\D/g,'').slice(0,8);
}

function probability(value){
  return Number((value/100).toFixed(6));
}

function validateDataIdentity(data,raceId){
  if(!isObject(data)||data.schemaVersion!=='JRA-ABILITY-DATA-1'||data.raceType!=='JRA')return false;
  if(!isObject(data.race)||!Array.isArray(data.horses)||data.horses.length<2)return false;
  const expected=parseRaceId(raceId);
  if(!expected)return false;
  if(normalizeDate(data.race.date)!==expected.date)return false;
  if(text(data.race.racecourse)!==expected.track)return false;
  if(Number(data.race.raceNo)!==expected.raceNo)return false;
  return true;
}

function projectHorse(horse){
  if(!isObject(horse))throw new Error('invalid_horse');
  const horseNumber=Number(horse.horseNo);
  const abilityRank=Number(horse.abilityRank);
  if(!Number.isInteger(horseNumber)||horseNumber<1||horseNumber>99)throw new Error('invalid_horse_number');
  if(!text(horse.horseName))throw new Error('invalid_horse_name');
  if(!Number.isInteger(abilityRank)||abilityRank<1)throw new Error('invalid_ability_rank');
  if(!finite(horse.overall)||!finite(horse.win)||!finite(horse.place))throw new Error('invalid_ability_data');
  if(horse.win<0||horse.win>100||horse.place<0||horse.place>100||horse.place<horse.win)throw new Error('invalid_probability_scale');
  return Object.freeze({
    horseNumber,
    horseName:horse.horseName,
    abilityRank,
    score:horse.overall,
    winProb:probability(horse.win),
    top3Prob:probability(horse.place),
    predictedTime:text(horse.predictedTime)||null,
    mark:text(horse.abilityMark)||null,
    runningStyle:text(horse.runningStyle)||null,
    distanceScore:finite(horse?.jraIndices?.distance)?horse.jraIndices.distance:null,
    courseScore:finite(horse?.jraIndices?.course)?horse.jraIndices.course:null,
    paceScore:finite(horse?.jraIndices?.pace)?horse.jraIndices.pace:null,
    conditionScore:null,
    runnerStatus:'active'
  });
}

export function projectJraPrecomputedViewerRace(row,{raceId}={}){
  if(!row||row.organization!=='JRA'||row.race_id!==raceId)throw new Error('identity_mismatch');
  if(row.calculation_version!==JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION||row.model_version!==JRA_PRECOMPUTED_VIEWER_MODEL_VERSION)throw new Error('version_mismatch');
  if(!ALLOWED_ROW_STATUSES.has(row.status))throw new Error('invalid_snapshot_status');
  if(row.data_json==null||row.data_json==='')throw new Error('data_missing');
  let data;
  try{data=JSON.parse(row.data_json);}catch{throw new Error('malformed_data_json');}
  if(!validateDataIdentity(data,raceId))throw new Error('data_identity_mismatch');
  const horses=data.horses.map(projectHorse);
  if(new Set(horses.map(h=>h.horseNumber)).size!==horses.length)throw new Error('duplicate_horse_number');
  const probabilityValid=horses.every(h=>h.winProb>=0&&h.winProb<=1&&h.top3Prob>=h.winProb&&h.top3Prob<=1);
  if(!probabilityValid)throw new Error('invalid_probability_projection');
  return Object.freeze({
    ok:true,
    apiVersion:'ability-compact-v1',
    format:'compact',
    evaluationMode:'ability-only',
    marketEvaluation:'disabled',
    viewerMode:'precomputed-early-data-only',
    race:Object.freeze({
      organization:'JRA',
      raceId,
      date:data.race.date||null,
      track:data.race.racecourse||null,
      raceNo:data.race.raceNo??null,
      raceName:data.race.raceName||null,
      surface:data.race.surface||null,
      distance:data.race.distance??null,
      going:data.race.trackCondition||null,
      startTime:null,
      fieldSize:horses.length,
      marketAvailable:false
    }),
    horses:Object.freeze(horses),
    validation:Object.freeze({probabilityValid,dataOnly:true,probabilityScale:'0-1'}),
    predictionGeneratedAt:row.data_calculated_at||row.calculated_at||null,
    raceDataUpdatedAt:row.source_validated_at||null,
    revision:Number(row.revision)||null
  });
}

export async function readJraPrecomputedViewerRace({
  env={},
  DB=env?.DB,
  raceId,
  now=Date.now(),
  maxAgeMs=JRA_PRECOMPUTED_VIEWER_MAX_AGE_MS
}={}){
  if(!precomputedViewerEnabled(env))return Object.freeze({status:'DISABLED',reason:'VIEWER_FLAG_OFF',race:null});
  if(!DB?.prepare)return rejected('D1_UNAVAILABLE');
  if(!parseRaceId(raceId))return rejected('INVALID_RACE_ID');
  if(!finite(now)||!finite(maxAgeMs)||maxAgeMs<0)return rejected('INVALID_READER_CLOCK');
  const sql=`SELECT organization,race_id,revision,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,status,data_json
    FROM precomputed_race_snapshots
    WHERE organization=? AND race_id=? AND calculation_version=? AND model_version=?
    ORDER BY revision DESC LIMIT 1`;
  let row;
  try{
    row=await DB.prepare(sql).bind(
      'JRA',raceId,JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION
    ).first();
  }catch{
    return rejected('D1_READ_FAILED');
  }
  if(!row)return rejected('DATA_NOT_FOUND');
  if(row.organization!=='JRA'||row.race_id!==raceId)return rejected('IDENTITY_MISMATCH');
  if(row.calculation_version!==JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION||row.model_version!==JRA_PRECOMPUTED_VIEWER_MODEL_VERSION)return rejected('VERSION_MISMATCH');
  if(!ALLOWED_ROW_STATUSES.has(row.status))return rejected('SNAPSHOT_NOT_READABLE');
  const validatedAt=Date.parse(row.source_validated_at||'');
  if(!Number.isFinite(validatedAt))return rejected('INVALID_FRESHNESS');
  const age=now-validatedAt;
  if(age<0||age>maxAgeMs)return rejected('STALE');
  try{
    return Object.freeze({status:'READY',reason:null,race:projectJraPrecomputedViewerRace(row,{raceId})});
  }catch(error){
    const reason={
      version_mismatch:'VERSION_MISMATCH',
      identity_mismatch:'IDENTITY_MISMATCH',
      data_identity_mismatch:'IDENTITY_MISMATCH',
      data_missing:'DATA_MISSING',
      malformed_data_json:'MALFORMED_DATA',
      invalid_snapshot_status:'SNAPSHOT_NOT_READABLE'
    }[error?.message]||'MALFORMED_DATA';
    return rejected(reason);
  }
}
