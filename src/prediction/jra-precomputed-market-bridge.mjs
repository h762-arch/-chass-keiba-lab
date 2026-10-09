import {readJraOfficialOddsCache} from '../../jra-official-cache.mjs';
import {JRA_ODDS_PARSER_VERSION} from '../../jra-odds-fetch.mjs';
import {runMarketRevision,raceJobKey} from './background-precompute.mjs';
import {createSnapshotHash,createPrecomputedIdentity,assertMarketIndependentData} from './precomputed-snapshot.mjs';
import {readLatestPrecomputedSnapshot,snapshotToD1Values} from './precomputed-store.mjs';

const hold=reason=>Object.freeze({status:'HOLD',saved:false,reason});
const frozen=()=>Object.freeze({status:'PRESERVED',saved:false,reason:'MARKET_ALREADY_FROZEN'});

export async function readVerifiedJraMarketOdds(env,options,cryptoImpl=globalThis.crypto){
 const cached=await readJraOfficialOddsCache(env,options);
 if(!cached)return null;
 const row=await env.DB.prepare("SELECT payload_json,source_url,fetched_at,expires_at,parser_version,content_hash FROM jra_official_cache WHERE kind='odds' AND cache_key=?")
  .bind(`odds|${options.date}|${options.track}|${options.race}`).first();
 if(!row||typeof row.payload_json!=='string')throw new Error('jra_market_cache_changed');
 const digest=await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(row.payload_json));
 const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const body=JSON.parse(row.payload_json);
 if(hash!==row.content_hash||hash!==cached.body.bridgeCache.contentHash||row.fetched_at!==cached.body.bridgeCache.fetchedAt||row.expires_at!==cached.body.bridgeCache.expiresAt||row.source_url!==body.sourceUrl||row.parser_version!==JRA_ODDS_PARSER_VERSION||body.parserVersion!==row.parser_version||body.acquiredAt!==row.fetched_at)throw new Error('jra_market_cache_integrity');
 return cached;
}

// One atomic conditional INSERT: concurrent cron invocations cannot replace
// the original market or append a revision based on a superseded DATA row.
export async function saveFirstJraMarket(DB,snapshot,base,{createdAt}){
 const columns='organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at';
 const sql=`INSERT INTO precomputed_race_snapshots (${columns})
 SELECT ${Array(21).fill('?').join(',')} WHERE
 NOT EXISTS (SELECT 1 FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND market_json IS NOT NULL)
 AND (SELECT MAX(revision) FROM precomputed_race_snapshots WHERE organization=? AND race_id=?)=?
 AND EXISTS (SELECT 1 FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND revision=? AND snapshot_hash=?)`;
 const result=await DB.prepare(sql).bind(...snapshotToD1Values(snapshot,{revision:base.revision+1,createdAt}),
 'JRA',base.raceId,'JRA',base.raceId,base.revision,'JRA',base.raceId,base.revision,base.snapshotHash).run();
 if(result?.success===false)throw new Error('jra_market_save_failed');
 if(result?.meta?.changes!==1)return hold('MARKET_SAVE_CONFLICT');
 return Object.freeze({status:'FROZEN',saved:true,revision:base.revision+1});
}

export function createJraPrecomputedMarketBridge({DB,now,deadline,
 readLatest=readLatestPrecomputedSnapshot,readOdds,
 save=saveFirstJraMarket,cryptoImpl=globalThis.crypto}={}){
 if(!DB?.prepare||typeof now!=='function'||!Number.isFinite(deadline))throw new TypeError('invalid_jra_market_bridge');
 return async job=>{
  if(job?.organization!=='JRA'||job.raceId!==raceJobKey(job))return hold('RACE_IDENTITY');
  const start=now();
  if(!Number.isFinite(start)||start>=deadline)return hold('DEADLINE');
  const prior=await DB.prepare('SELECT revision FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND market_json IS NOT NULL ORDER BY revision ASC LIMIT 1').bind('JRA',job.raceId).first();
  if(prior)return frozen();
  const base=await readLatest(DB,'JRA',job.raceId);
  if(!base?.layers?.DATA)return hold('DATA_MISSING');
  if(base.layers.MARKET)return frozen();
  if(base.layers.FINAL||base.layers.RESULT)return hold('LIFECYCLE_CONFLICT');
  const source=base.layers.SOURCE,race=source?.race;
  if(base.organization!=='JRA'||base.raceId!==job.raceId||source?.organization!=='JRA'||source.raceId!==job.raceId||race?.date!==job.date||race.racecourse!==job.track||race.raceNo!==job.raceNo||!Number.isInteger(base.revision)||base.revision<1)return hold('DATA_IDENTITY');
  assertMarketIndependentData(base.layers.DATA);
  const identity=await createPrecomputedIdentity({organization:'JRA',source,versions:base,cryptoImpl});
  if(identity.sourceHash!==base.sourceHash||identity.inputHash!==base.inputHash)return hold('DATA_INPUT_HASH');
  const verified=await createSnapshotHash({...base,cryptoImpl});
  if(verified!==base.snapshotHash)return hold('DATA_HASH');
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(race.postTime||''))return hold('POST_TIME_UNKNOWN');
  const post=Date.parse(`${job.date}T${race.postTime}:00+09:00`);
  if(!Number.isFinite(post)||start>=post)return hold('NOT_PRE_RACE');
  const options={date:job.date,track:job.track,race:job.raceNo,nowMs:start};
  const cached=readOdds?await readOdds({DB},options):await readVerifiedJraMarketOdds({DB},options,cryptoImpl);
  const body=cached?.body;
  if(!body)return hold('ODDS_UNAVAILABLE');
  const fetched=Date.parse(body.bridgeCache?.fetchedAt),expires=Date.parse(body.bridgeCache?.expiresAt);
  let official=false;try{official=new URL(body.sourceUrl).origin==='https://www.jra.go.jp';}catch{}
  if(!official||body.source!=='JRA_OFFICIAL'||body.parserVersion!==JRA_ODDS_PARSER_VERSION||body.organization!=='JRA'||body.date!==job.date||body.track!==job.track||body.race!==job.raceNo||!Number.isFinite(fetched)||fetched>start||fetched>=post||!Number.isFinite(expires)||expires<=start||body.oddsSnapshotType==='final')return hold('ODDS_IDENTITY_OR_TIME');
  const active=source.horses?.filter(h=>h.runningStatus==='active').map(h=>h.horseNo);
  const odds=body.odds;
  if(!active||active.length<2||new Set(active).size!==active.length||!Array.isArray(odds)||odds.length!==active.length||new Set(odds.map(h=>h.horseNo)).size!==active.length||odds.some(h=>!active.includes(h.horseNo)||typeof h.odds!=='number'||!Number.isFinite(h.odds)||h.odds<1||!Number.isInteger(h.popularity)||h.popularity<1||h.popularity>active.length)||body.quality?.complete!==true||body.quality.oddsCoverage!==1||body.quality.activeHorseCount!==active.length||body.quality.oddsHorseCount!==active.length)return hold('ODDS_INCOMPLETE');
  const finish=now();
  if(!Number.isFinite(finish)||finish<start||finish>=deadline||finish>=post||finish>=expires)return hold('DEADLINE_OR_TIME');
  const at=new Date(finish).toISOString();
  const market={schemaVersion:1,organization:'JRA',raceId:job.raceId,
   horses:odds.map(({horseNo,odds,popularity})=>({horseNo,odds,popularity})),
   acquiredAt:body.bridgeCache.fetchedAt,source:body.source,sourceUrl:body.sourceUrl,
   parserVersion:body.parserVersion,contentHash:body.bridgeCache.contentHash,
   coverage:1,activeHorseCount:active.length,complete:true,
   frozen:true,frozenAt:at,freezePolicy:'FIRST_COMPLETE_MARKET_V1',dataSnapshotHash:base.snapshotHash};
  const next=await runMarketRevision(base,market,{at,cryptoImpl});
  return save(DB,next,base,{createdAt:at});
 };
}
