import {createSnapshotHash} from './precomputed-snapshot.mjs';
import {d1RowToSnapshot} from './precomputed-store.mjs';
import {JRA_PRECOMPUTED_VIEWER_CALCULATION_VERSION as CALC,JRA_PRECOMPUTED_VIEWER_MODEL_VERSION as MODEL} from './jra-precomputed-viewer-reader.mjs';

export const FROZEN_MARKET_VIEWER_MODE='precomputed-early-frozen-market';
const hold=reason=>({status:'HOLD',reason});
const columns=['organization','race_id','revision','source_hash','input_hash','snapshot_hash','source_acquired_at','source_validated_at','data_calculated_at','calculated_at','calculation_version','model_version','cluster_version','signal_rule_version','source_json','data_json','market_json','status'];
const sql=`SELECT ${columns.map(c=>`m.${c}`).join(',')},
 b.snapshot_hash AS base_hash,b.data_json AS base_data,b.source_json AS base_source,
 b.input_hash AS base_input,b.status AS base_status,
 b.calculation_version AS base_calc,b.model_version AS base_model,
 e.data_json AS early_data
 FROM precomputed_race_snapshots m
 LEFT JOIN precomputed_race_snapshots b ON b.organization=m.organization AND b.race_id=m.race_id AND b.revision=m.revision-1
 LEFT JOIN precomputed_race_snapshots e ON e.organization=m.organization AND e.race_id=m.race_id AND e.revision=?
 WHERE m.organization=? AND m.race_id=? AND m.market_json IS NOT NULL
 ORDER BY m.revision ASC LIMIT 1`;

export async function readJraViewerFrozenMarket(DB,item,{now=Date.now()}={}){
 const identity=item?.race,raceId=identity?.raceId;
 if(identity?.organization!=='JRA'||!Number.isInteger(item.revision)||item.revision<1)return hold('DATA_IDENTITY');
 try{
  const row=await DB.prepare(sql).bind(item.revision,'JRA',raceId).first();
  if(!row)return hold('MARKET_NOT_SAVED');
  if(row.organization!=='JRA'||row.race_id!==raceId||row.status!=='PARTIAL'||row.calculation_version!==CALC||row.model_version!==MODEL)return hold('MARKET_IDENTITY');
  if(row.base_calc!==CALC||row.base_model!==MODEL||row.base_status!=='PARTIAL'||row.base_input!==row.input_hash||!row.base_hash||row.base_data!==row.data_json||row.base_source!==row.source_json||row.early_data!==row.data_json)return hold('DATA_BINDING');
  const snapshot=d1RowToSnapshot(row),m=snapshot.layers.MARKET,source=snapshot.layers.SOURCE;
  if(await createSnapshotHash(snapshot)!==snapshot.snapshotHash)return hold('MARKET_HASH');
  const base={...snapshot,status:row.base_status,layers:{...snapshot.layers,MARKET:null}};
  if(await createSnapshotHash(base)!==row.base_hash||m?.dataSnapshotHash!==row.base_hash)return hold('DATA_HASH');
  if(m?.schemaVersion!==1||m.organization!=='JRA'||m.raceId!==raceId||source?.organization!=='JRA'||source.raceId!==raceId||source.race?.date!==identity.date||source.race?.racecourse!==identity.track||source.race?.raceNo!==identity.raceNo)return hold('MARKET_IDENTITY');
  if(m.source!=='JRA_OFFICIAL'||new URL(m.sourceUrl).origin!=='https://www.jra.go.jp'||m.parserVersion!=='jra-official-win-odds-v1'||!/^([a-f0-9]{64})$/.test(m.contentHash||''))return hold('MARKET_SOURCE');
  const acquired=Date.parse(m.acquiredAt),frozen=Date.parse(m.frozenAt);
  const post=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(source.race.postTime||'')?Date.parse(`${identity.date}T${source.race.postTime}:00+09:00`):NaN;
  if(!Number.isFinite(now)||!Number.isFinite(acquired)||!Number.isFinite(frozen)||!Number.isFinite(post)||acquired>frozen||frozen>now||frozen>=post)return hold('MARKET_TIME');
  const expected=item.horses.map(h=>h.horseNumber),active=source.horses.filter(h=>h.runningStatus==='active').map(h=>h.horseNo);
  if(m.frozen!==true||m.complete!==true||m.coverage!==1||m.freezePolicy!=='FIRST_COMPLETE_MARKET_V1'||m.activeHorseCount!==expected.length||!Array.isArray(m.horses)||m.horses.length!==expected.length||new Set(m.horses.map(h=>h.horseNo)).size!==expected.length||active.length!==expected.length||new Set(active).size!==expected.length||expected.some(n=>!active.includes(n))||m.horses.some(h=>!expected.includes(h.horseNo)||typeof h.odds!=='number'||!Number.isFinite(h.odds)||h.odds<1||!Number.isInteger(h.popularity)||h.popularity<1||h.popularity>expected.length))return hold('MARKET_INCOMPLETE');
  return {status:'READY',reason:null,acquiredAt:m.acquiredAt,frozenAt:m.frozenAt,source:m.source,coverage:m.coverage,revision:row.revision,horses:m.horses.map(({horseNo,odds,popularity})=>({horseNo,odds,popularity}))};
 }catch{return hold('MARKET_READ_OR_VALIDATION_FAILED');}
}

// Separate public-view composition. The formal DATA reader remains unchanged.
export async function composeJraFrozenMarketResponse(response,DB,{now=Date.now()}={}){
 if(response.status!==200||response.headers.get('X-CHASS-Viewer-Mode')!=='precomputed-early-data-only')return response;
 const payload=await response.clone().json();
 const items=Array.isArray(payload.races)?payload.races:payload.race?[payload]:[];
 if(!items.length||items.length>12||items.some(i=>!Array.isArray(i.horses)))return response;
 const races=[];
 for(const item of items){
  const market=await readJraViewerFrozenMarket(DB,item,{now}),{horses:quotes,...metadata}=market;
  const byNo=new Map((quotes||[]).map(h=>[h.horseNo,h]));
  races.push({...item,race:{...item.race,marketAvailable:market.status==='READY',marketFreeze:metadata},
   horses:item.horses.map(h=>market.status==='READY'?{...h,odds:byNo.get(h.horseNumber).odds,popularity:byNo.get(h.horseNumber).popularity,marketStatus:'frozen'}:{...h})});
 }
 const mode=races.some(i=>i.race.marketAvailable)?FROZEN_MARKET_VIEWER_MODE:payload.viewerMode;
 const result=Array.isArray(payload.races)?{...payload,viewerMode:mode,races}:{...races[0],viewerMode:mode};
 const headers=new Headers(response.headers);headers.set('X-CHASS-Viewer-Mode',mode);
 return new Response(JSON.stringify(result),{status:response.status,headers});
}
