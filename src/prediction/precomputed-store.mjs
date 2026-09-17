const json=value=>value==null?null:JSON.stringify(value);
const parsed=value=>value==null?null:JSON.parse(value);
const deepFreeze=value=>{if(!value||typeof value!=='object'||Object.isFrozen(value))return value;for(const child of Object.values(value))deepFreeze(child);return Object.freeze(value);};

export function snapshotToD1Values(snapshot,{revision,createdAt=new Date().toISOString()}={}){
  if(!Number.isInteger(revision)||revision<1)throw new Error('invalid_revision');
  if(!snapshot.snapshotHash)throw new Error('snapshot_hash_required');
  return [snapshot.organization,snapshot.raceId,revision,snapshot.sourceHash,snapshot.inputHash,snapshot.snapshotHash,snapshot.sourceAcquiredAt,snapshot.sourceValidatedAt,snapshot.dataCalculatedAt,snapshot.calculatedAt,snapshot.calculationVersion,snapshot.modelVersion,snapshot.clusterVersion,snapshot.signalRuleVersion,json(snapshot.layers.SOURCE),json(snapshot.layers.DATA),json(snapshot.layers.MARKET),json(snapshot.layers.FINAL),json(snapshot.layers.RESULT),snapshot.status,createdAt];
}

export function d1RowToSnapshot(row){
  if(!row)return null;
  return deepFreeze({schemaVersion:1,organization:row.organization,raceId:row.race_id,revision:Number(row.revision),sourceHash:row.source_hash,inputHash:row.input_hash,snapshotHash:row.snapshot_hash,sourceAcquiredAt:row.source_acquired_at,sourceValidatedAt:row.source_validated_at,dataCalculatedAt:row.data_calculated_at,calculatedAt:row.calculated_at,calculationVersion:row.calculation_version,modelVersion:row.model_version,clusterVersion:row.cluster_version,signalRuleVersion:row.signal_rule_version,status:row.status,layers:{SOURCE:parsed(row.source_json),DATA:parsed(row.data_json),MARKET:parsed(row.market_json),FINAL:parsed(row.final_json),RESULT:parsed(row.result_json)}});
}

export async function findPrecomputedInput(DB,organization,raceId,inputHash){
  if(!DB?.prepare)throw new Error('d1_binding_unavailable');
  const row=await DB.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND input_hash=? ORDER BY revision DESC LIMIT 1').bind(organization,raceId,inputHash).first();
  return d1RowToSnapshot(row);
}

export async function findPrecomputedRevision(DB,organization,raceId,snapshotHash){
  if(!DB?.prepare)throw new Error('d1_binding_unavailable');
  return DB.prepare('SELECT organization,race_id,revision,snapshot_hash FROM precomputed_race_snapshots WHERE organization=? AND race_id=? AND snapshot_hash=? ORDER BY revision DESC LIMIT 1').bind(organization,raceId,snapshotHash).first();
}

export async function readLatestPrecomputedSnapshot(DB,organization,raceId){
  if(!DB?.prepare)throw new Error('d1_binding_unavailable');
  const row=await DB.prepare('SELECT * FROM precomputed_race_snapshots WHERE organization=? AND race_id=? ORDER BY revision DESC LIMIT 1').bind(organization,raceId).first();
  return d1RowToSnapshot(row);
}

export async function savePrecomputedSnapshot(DB,snapshot,{createdAt=new Date().toISOString()}={}){
  if(!DB?.prepare)throw new Error('d1_binding_unavailable');
  const existing=await findPrecomputedRevision(DB,snapshot.organization,snapshot.raceId,snapshot.snapshotHash);
  if(existing)return {saved:false,reason:'UNCHANGED',revision:Number(existing.revision)};
  const latest=await DB.prepare('SELECT MAX(revision) AS revision FROM precomputed_race_snapshots WHERE organization=? AND race_id=?').bind(snapshot.organization,snapshot.raceId).first();
  const revision=(Number(latest?.revision)||0)+1;
  const sql='INSERT INTO precomputed_race_snapshots (organization,race_id,revision,source_hash,input_hash,snapshot_hash,source_acquired_at,source_validated_at,data_calculated_at,calculated_at,calculation_version,model_version,cluster_version,signal_rule_version,source_json,data_json,market_json,final_json,result_json,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)';
  await DB.prepare(sql).bind(...snapshotToD1Values(snapshot,{revision,createdAt})).run();
  return {saved:true,reason:'SAVED',revision};
}
