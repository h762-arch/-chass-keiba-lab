const TABLES={JRA:'jra_favorite_risk_snapshots',NAR:'nar_favorite_risk_snapshots'};
const SCHEMA_VERSION='favorite-risk-snapshot-v1';

function json(data,status=200){
  return new Response(JSON.stringify(data,null,2),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
}
function parseJson(value){try{return value?JSON.parse(value):null}catch{return null}}
function finite(value){if(value==null||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null}
function positive(value){const n=finite(value);return n!=null&&n>0?n:null}
function int(value){const n=finite(value);return Number.isInteger(n)?n:null}
function horseNoOf(h){return int(h?.horseNo??h?.horseNumber??h?.no)}
function horseNameOf(h){return h?.horseName??h?.name??''}
function scoreOf(h){return finite(h?.overall??h?.overallScore??h?.abilityScore??h?.score)}
function winOf(h){return finite(h?.win??h?.winProb??h?.aiWinProbability??h?.aiWinRate)}
function placeOf(h){return finite(h?.place??h?.top3Prob??h?.aiPlaceProbability??h?.aiPlaceRate)}
function oddsOf(h){return positive(h?.odds??h?.winOdds??h?.finalOdds)}
function popularityOf(h){const p=int(h?.popularity??h?.pop??h?.finalPopularity);return p!=null&&p>0?p:null}
function iso(value){const ms=Date.parse(value||'');return Number.isFinite(ms)?new Date(ms).toISOString():null}

export function classifyTimedStage(minutesToPost){
  const m=finite(minutesToPost);
  if(m==null||m<0)return null;
  if(m<=10)return 'T5';
  if(m<=20)return 'T15';
  return 'EARLY';
}

export function parsePostTime(date,postTime){
  if(!postTime)return null;
  if(typeof postTime==='number'&&Number.isFinite(postTime))return postTime;
  const raw=String(postTime).trim();
  const direct=Date.parse(raw);
  if(Number.isFinite(direct)&&(/[TZ+-]\d{0,2}/.test(raw)||/^\d{4}-\d{2}-\d{2}T/.test(raw)))return direct;
  const match=/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)||/^(\d{2})(\d{2})$/.exec(raw);
  if(!match||!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return null;
  const [y,m,d]=String(date).split('-').map(Number),hh=Number(match[1]),mm=Number(match[2]),ss=Number(match[3]||0);
  if(hh>23||mm>59||ss>59)return null;
  return Date.UTC(y,m-1,d,hh-9,mm,ss);
}

export function abilityRankForHorse(prediction,horseNo){
  const target=Number(horseNo),horses=Array.isArray(prediction?.horses)?prediction.horses:[];
  const ranked=horses.map(h=>({no:horseNoOf(h),score:scoreOf(h)})).filter(x=>x.no!=null&&x.score!=null).sort((a,b)=>b.score-a.score||a.no-b.no);
  let rank=0,prev=null;
  for(let i=0;i<ranked.length;i++){
    if(prev===null||ranked[i].score!==prev)rank=i+1;
    if(ranked[i].no===target)return rank;
    prev=ranked[i].score;
  }
  return null;
}

function predictionHorse(prediction,no){return (prediction?.horses||[]).find(h=>horseNoOf(h)===Number(no))||null}
function marketHorses(market){return Array.isArray(market?.horses)?market.horses:Array.isArray(market?.ranking)?market.ranking:[]}

export function pickMarketFavorite(market,prediction){
  const horses=marketHorses(market).filter(h=>horseNoOf(h)!=null);
  if(!horses.length)return null;
  let favorite=horses.find(h=>popularityOf(h)===1)||null;
  if(!favorite){
    const priced=horses.filter(h=>oddsOf(h)!=null).sort((a,b)=>oddsOf(a)-oddsOf(b)||horseNoOf(a)-horseNoOf(b));
    favorite=priced[0]||null;
  }
  if(!favorite)return null;
  const no=horseNoOf(favorite),pred=predictionHorse(prediction,no)||{};
  const otherOdds=horses.filter(h=>horseNoOf(h)!==no&&oddsOf(h)!=null).map(oddsOf).sort((a,b)=>a-b);
  const place=placeOf(pred);
  return {
    horseNo:no,horseName:horseNameOf(favorite)||horseNameOf(pred),popularity:popularityOf(favorite)??1,odds:oddsOf(favorite),
    secondFavoriteOdds:otherOdds[0]??null,aiWinRate:winOf(pred),aiPlaceRate:place,aiOutside3Rate:place==null?null:Number((1-place).toFixed(6)),
    abilityRank:abilityRankForHorse(prediction,no)
  };
}

export function pickFinalFavorite(result,prediction){
  const horses=Array.isArray(result?.horses)?result.horses:[];
  if(!horses.length)return null;
  let favorite=horses.find(h=>int(h?.finalPopularity??h?.popularity)===1)||null;
  if(!favorite){
    const priced=horses.filter(h=>positive(h?.finalOdds??h?.odds)!=null).sort((a,b)=>positive(a?.finalOdds??a?.odds)-positive(b?.finalOdds??b?.odds)||horseNoOf(a)-horseNoOf(b));
    favorite=priced[0]||null;
  }
  if(!favorite)return null;
  const no=horseNoOf(favorite),pred=predictionHorse(prediction,no)||{},finish=int(favorite?.position??favorite?.finish),place=placeOf(pred);
  return {
    horseNo:no,horseName:horseNameOf(favorite)||horseNameOf(pred),popularity:int(favorite?.finalPopularity??favorite?.popularity)??1,
    odds:positive(favorite?.finalOdds??favorite?.odds),secondFavoriteOdds:null,aiWinRate:winOf(pred),aiPlaceRate:place,
    aiOutside3Rate:place==null?null:Number((1-place).toFixed(6)),abilityRank:abilityRankForHorse(prediction,no),finish,
    top3Flag:finish==null?null:(finish>=1&&finish<=3?1:0),outside3Flag:finish==null?null:(finish>=4?1:0)
  };
}

function isHistoricalRow(row,race,prediction){
  const model=String(row?.model_version||prediction?.modelVersion||'');
  return model.endsWith('-background')||!!race?.historicalResearch||race?.researchMode==='historical_research'||race?.predictionKind==='backtest_prediction'||!!prediction?.historicalResearch||!!prediction?.backgroundCollector||prediction?.predictionKind==='backtest_prediction';
}
function organizationOf(race){const o=String(race?.organization??race?.raceType??'').toUpperCase();return o==='JRA'||o==='NAR'?o:null}
function raceDateOf(race){return race?.raceDate??race?.date??null}
function trackOf(race){return race?.track??race?.racecourse??null}
function raceNoOf(race,row){const n=int(race?.raceNo??race?.raceNumber);if(n!=null)return n;const tail=String(row?.race_id||'').split('|').at(-1);return int(tail)}
function postTimeOf(race){return race?.postTime??race?.startTime??null}
function marketCapturedAt(market,row){return iso(market?.acquiredAt??market?.oddsUpdatedAt??market?.fetchedAt??row?.updated_at)}
function predictionCapturedAt(prediction,row){return iso(prediction?.createdAt??prediction?.generatedAt??row?.prediction_created_at)}
function resultCapturedAt(result,row){return iso(result?.fetchedAt??result?.acquiredAt??row?.result_acquired_at??row?.updated_at)}
function minutesBetween(postMs,atIso){const at=Date.parse(atIso||'');return Number.isFinite(postMs)&&Number.isFinite(at)?(postMs-at)/60000:null}
function targetDelta(stage,minutes){if(stage==='T15')return Math.abs(minutes-15);if(stage==='T5')return Math.abs(minutes-5);if(stage==='EARLY')return Math.abs(minutes-30);return 0}

const CREATE_TABLE=(table)=>`CREATE TABLE IF NOT EXISTS ${table} (
 snapshot_id TEXT PRIMARY KEY,
 race_id TEXT NOT NULL,
 model_version TEXT,
 organization TEXT NOT NULL,
 race_date TEXT NOT NULL,
 track TEXT,
 race_no INTEGER,
 race_name TEXT,
 stage TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 source_updated_at TEXT,
 minutes_to_post REAL,
 stage_delta_minutes REAL,
 favorite_horse_no INTEGER,
 favorite_horse_name TEXT,
 favorite_popularity INTEGER,
 favorite_odds REAL,
 second_favorite_odds REAL,
 ai_win_rate REAL,
 ai_place_rate REAL,
 ai_outside3_rate REAL,
 ability_rank INTEGER,
 finish INTEGER,
 top3_flag INTEGER,
 outside3_flag INTEGER,
 final_popularity INTEGER,
 final_odds REAL,
 data_confidence TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 UNIQUE(race_id, stage)
)`;
const ready=new WeakSet();
async function ensureSchema(DB){
  if(!DB)throw new Error('d1_binding_unavailable');
  if(ready.has(DB))return;
  await DB.batch([
    DB.prepare(CREATE_TABLE(TABLES.JRA)),DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jra_favorite_risk_snapshots_day ON ${TABLES.JRA}(race_date, track, race_no)`),DB.prepare(`CREATE INDEX IF NOT EXISTS idx_jra_favorite_risk_snapshots_stage ON ${TABLES.JRA}(stage, captured_at)`),
    DB.prepare(CREATE_TABLE(TABLES.NAR)),DB.prepare(`CREATE INDEX IF NOT EXISTS idx_nar_favorite_risk_snapshots_day ON ${TABLES.NAR}(race_date, track, race_no)`),DB.prepare(`CREATE INDEX IF NOT EXISTS idx_nar_favorite_risk_snapshots_stage ON ${TABLES.NAR}(stage, captured_at)`)
  ]);
  ready.add(DB);
}

function snapshotRow({row,race,prediction,stage,capturedAt,minutesToPost,favorite,dataConfidence,result=null}){
  const organization=organizationOf(race),raceDate=raceDateOf(race),raceNo=raceNoOf(race,row),modelVersion=String(row?.model_version??prediction?.modelVersion??'');
  const payload={schemaVersion:SCHEMA_VERSION,stage,organization,raceId:row.race_id,modelVersion,raceDate,track:trackOf(race),raceNo,raceName:race?.raceName??null,capturedAt,minutesToPost,favorite,source:{predictionCreatedAt:predictionCapturedAt(prediction,row),marketUpdatedAt:row?.market_json?marketCapturedAt(parseJson(row.market_json),row):null,resultUpdatedAt:row?.result_json?resultCapturedAt(result,row):null,rowUpdatedAt:row?.updated_at??null}};
  return {
    snapshotId:`${organization}:${row.race_id}:${stage}`,raceId:row.race_id,modelVersion,organization,raceDate,track:trackOf(race),raceNo,raceName:race?.raceName??null,
    stage,capturedAt,sourceUpdatedAt:row?.updated_at??null,minutesToPost,stageDeltaMinutes:targetDelta(stage,minutesToPost??0),favoriteHorseNo:favorite?.horseNo??null,
    favoriteHorseName:favorite?.horseName??'',favoritePopularity:favorite?.popularity??null,favoriteOdds:favorite?.odds??null,secondFavoriteOdds:favorite?.secondFavoriteOdds??null,
    aiWinRate:favorite?.aiWinRate??null,aiPlaceRate:favorite?.aiPlaceRate??null,aiOutside3Rate:favorite?.aiOutside3Rate??null,abilityRank:favorite?.abilityRank??null,
    finish:favorite?.finish??null,top3Flag:favorite?.top3Flag??null,outside3Flag:favorite?.outside3Flag??null,finalPopularity:(stage==='FINAL'||stage==='POST')?(favorite?.popularity??null):null,
    finalOdds:(stage==='FINAL'||stage==='POST')?(favorite?.odds??null):null,dataConfidence,snapshotJson:JSON.stringify(payload)
  };
}

async function upsert(DB,table,x){
  const sql=`INSERT INTO ${table} (snapshot_id,race_id,model_version,organization,race_date,track,race_no,race_name,stage,captured_at,source_updated_at,minutes_to_post,stage_delta_minutes,favorite_horse_no,favorite_horse_name,favorite_popularity,favorite_odds,second_favorite_odds,ai_win_rate,ai_place_rate,ai_outside3_rate,ability_rank,finish,top3_flag,outside3_flag,final_popularity,final_odds,data_confidence,snapshot_json)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
 ON CONFLICT(race_id,stage) DO UPDATE SET
 snapshot_id=excluded.snapshot_id,model_version=excluded.model_version,organization=excluded.organization,race_date=excluded.race_date,track=excluded.track,race_no=excluded.race_no,race_name=excluded.race_name,captured_at=excluded.captured_at,source_updated_at=excluded.source_updated_at,minutes_to_post=excluded.minutes_to_post,stage_delta_minutes=excluded.stage_delta_minutes,favorite_horse_no=excluded.favorite_horse_no,favorite_horse_name=excluded.favorite_horse_name,favorite_popularity=excluded.favorite_popularity,favorite_odds=excluded.favorite_odds,second_favorite_odds=excluded.second_favorite_odds,ai_win_rate=excluded.ai_win_rate,ai_place_rate=excluded.ai_place_rate,ai_outside3_rate=excluded.ai_outside3_rate,ability_rank=excluded.ability_rank,finish=excluded.finish,top3_flag=excluded.top3_flag,outside3_flag=excluded.outside3_flag,final_popularity=excluded.final_popularity,final_odds=excluded.final_odds,data_confidence=excluded.data_confidence,snapshot_json=excluded.snapshot_json
 WHERE excluded.stage IN ('FINAL','POST') OR excluded.stage_delta_minutes < ${table}.stage_delta_minutes`;
  return DB.prepare(sql).bind(x.snapshotId,x.raceId,x.modelVersion,x.organization,x.raceDate,x.track,x.raceNo,x.raceName,x.stage,x.capturedAt,x.sourceUpdatedAt,x.minutesToPost,x.stageDeltaMinutes,x.favoriteHorseNo,x.favoriteHorseName,x.favoritePopularity,x.favoriteOdds,x.secondFavoriteOdds,x.aiWinRate,x.aiPlaceRate,x.aiOutside3Rate,x.abilityRank,x.finish,x.top3Flag,x.outside3Flag,x.finalPopularity,x.finalOdds,x.dataConfidence,x.snapshotJson).run();
}

async function collectRow(DB,row){
  const race=parseJson(row.race_json)||{},prediction=parseJson(row.prediction_json)||{};
  if(!row?.race_id||!Array.isArray(prediction?.horses)||!prediction.horses.length||isHistoricalRow(row,race,prediction))return {saved:0,skipped:true,reason:'not_prospective_prediction'};
  const organization=organizationOf(race),raceDate=raceDateOf(race),postMs=parsePostTime(raceDate,postTimeOf(race));
  if(!organization||!raceDate||!Number.isFinite(postMs))return {saved:0,skipped:true,reason:'race_identity_or_post_time_missing'};
  const table=TABLES[organization],saved=[];
  const predictionAt=predictionCapturedAt(prediction,row),predictionMinutes=minutesBetween(postMs,predictionAt);
  if(predictionAt&&predictionMinutes!=null&&predictionMinutes>20){
    const market=parseJson(row.market_json),fav=market?pickMarketFavorite(market,prediction):null;
    if(fav) {await upsert(DB,table,snapshotRow({row,race,prediction,stage:'EARLY',capturedAt:predictionAt,minutesToPost:predictionMinutes,favorite:fav,dataConfidence:'prospective_pre_race'})); saved.push('EARLY');}
  }
  const market=parseJson(row.market_json);
  if(market){
    const marketAt=marketCapturedAt(market,row),m=minutesBetween(postMs,marketAt),stage=classifyTimedStage(m),fav=pickMarketFavorite(market,prediction);
    if(marketAt&&fav&&(stage==='T15'||stage==='T5')){await upsert(DB,table,snapshotRow({row,race,prediction,stage,capturedAt:marketAt,minutesToPost:m,favorite:fav,dataConfidence:'prospective_pre_race'}));saved.push(stage)}
  }
  const result=parseJson(row.result_json);
  if(result){
    const fav=pickFinalFavorite(result,prediction),resultAt=resultCapturedAt(result,row);
    if(fav&&resultAt){
      await upsert(DB,table,snapshotRow({row,race,prediction,stage:'FINAL',capturedAt:resultAt,minutesToPost:minutesBetween(postMs,resultAt),favorite:fav,dataConfidence:'official_result',result}));
      await upsert(DB,table,snapshotRow({row,race,prediction,stage:'POST',capturedAt:resultAt,minutesToPost:minutesBetween(postMs,resultAt),favorite:fav,dataConfidence:'official_result',result}));
      saved.push('FINAL','POST');
    }
  }
  return {saved:saved.length,stages:saved};
}

export async function runFavoriteRiskCollector(env,{now=new Date(),limit=300}={}){
  if(String(env?.ENABLE_FAVORITE_RISK_SNAPSHOTS??'true').toLowerCase()!=='true')return {ok:true,skipped:true,reason:'ENABLE_FAVORITE_RISK_SNAPSHOTS_disabled'};
  const DB=env?.DB;if(!DB)return {ok:false,error:'d1_binding_unavailable'};
  await ensureSchema(DB);
  const cutoff=new Date(now.getTime()-36*60*60*1000).toISOString();
  const response=await DB.prepare(`SELECT race_id,model_version,race_json,prediction_json,market_json,final_json,result_json,prediction_created_at,result_acquired_at,status,updated_at FROM races WHERE updated_at>=? ORDER BY updated_at DESC LIMIT ?`).bind(cutoff,Math.max(1,Math.min(1000,Number(limit)||300))).all();
  let processed=0,saved=0,skipped=0;const errors=[];
  for(const row of response.results||[]){
    try{const r=await collectRow(DB,row);processed++;saved+=Number(r.saved||0);if(r.skipped)skipped++;}
    catch(error){errors.push({raceId:row?.race_id||null,error:String(error?.message||error).slice(0,240)})}
  }
  return {ok:errors.length===0,schemaVersion:SCHEMA_VERSION,processed,saved,skipped,errorCount:errors.length,errors,generatedAt:new Date().toISOString()};
}

export async function handleFavoriteRiskResearchRequest(request,env){
  const u=new URL(request.url),organization=String(u.searchParams.get('organization')||'').toUpperCase();
  if(!TABLES[organization])return json({ok:false,error:'organization must be JRA or NAR'},400);
  const DB=env?.DB;if(!DB)return json({ok:false,error:'d1_binding_unavailable'},503);
  await ensureSchema(DB);
  const date=u.searchParams.get('date')||'',track=u.searchParams.get('track')||'',raceNo=int(u.searchParams.get('race'));
  const where=['organization=?'],bind=[organization];
  if(date){where.push('race_date=?');bind.push(date)}
  if(track){where.push('track=?');bind.push(track)}
  if(raceNo!=null){where.push('race_no=?');bind.push(raceNo)}
  const limit=Math.max(1,Math.min(1000,int(u.searchParams.get('limit'))||300));bind.push(limit);
  const table=TABLES[organization],response=await DB.prepare(`SELECT * FROM ${table} WHERE ${where.join(' AND ')} ORDER BY race_date DESC,track,race_no,CASE stage WHEN 'EARLY' THEN 1 WHEN 'T15' THEN 2 WHEN 'T5' THEN 3 WHEN 'FINAL' THEN 4 WHEN 'POST' THEN 5 ELSE 9 END LIMIT ?`).bind(...bind).all();
  return json({ok:true,schemaVersion:SCHEMA_VERSION,organization,date:date||null,track:track||null,raceNo:raceNo??null,count:(response.results||[]).length,rows:response.results||[],generatedAt:new Date().toISOString()});
}
