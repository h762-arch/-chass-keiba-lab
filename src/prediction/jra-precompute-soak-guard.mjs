function guardError(code,cause){
 const error=new Error(code,{cause});
 error.code=code;
 return error;
}

function validDate(value){
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))&&
  new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
}

function positiveInteger(value){
 return typeof value==='string'&&/^[1-9]\d*$/.test(value)&&
  Number.isSafeInteger(Number(value));
}

export function parseJraPrecomputeSoakGuard(env={}){
 const target=env.JRA_PRECOMPUTE_CANARY_TARGET_DATE;
 const max=env.JRA_PRECOMPUTE_CANARY_MAX_DISTINCT_RACES;

 const configured=target!==undefined||max!==undefined;
 if(!configured)return null;

 if(!validDate(target)){
  throw guardError('jra_precompute_canary_target_date_invalid');
 }
 if(!positiveInteger(max)){
  throw guardError('jra_precompute_canary_max_distinct_races_invalid');
 }

 return Object.freeze({
  targetDate:target,
  maxDistinctRaces:Number(max)
 });
}

export async function inspectJraPrecomputeSoakGuard({
 DB,
 guard,
 scheduledTargetDate,
 calculationVersion,
 modelVersion
}={}){
 if(!guard){
  return Object.freeze({status:'DISABLED'});
 }

 if(scheduledTargetDate!==guard.targetDate){
  return Object.freeze({
   status:'DATE_MISMATCH',
   targetDate:scheduledTargetDate,
   canaryTargetDate:guard.targetDate
  });
 }

 if(!DB||typeof DB.prepare!=='function'){
  throw guardError('jra_precompute_canary_guard_db_invalid');
 }

 const racePrefix=`${guard.targetDate.replace(/-/g,'')}-JRA-%`;

 let row;
 try{
  const statement=DB.prepare(
   "SELECT COUNT(DISTINCT race_id) AS count "+
   "FROM precomputed_race_snapshots "+
   "WHERE organization='JRA' "+
   "AND race_id LIKE ? "+
   "AND calculation_version=? "+
   "AND model_version=? "+
   "AND data_json IS NOT NULL"
  );

  if(!statement||typeof statement.bind!=='function'){
   throw new TypeError('invalid_guard_statement');
  }

  const bound=statement.bind(
   racePrefix,
   calculationVersion,
   modelVersion
  );

  if(!bound||typeof bound.first!=='function'){
   throw new TypeError('invalid_guard_statement');
  }

  row=await bound.first();
 }catch(error){
  throw guardError('jra_precompute_canary_guard_unavailable',error);
 }

 const distinctRaces=Number(row?.count);

 if(!Number.isSafeInteger(distinctRaces)||distinctRaces<0){
  throw guardError('jra_precompute_canary_guard_invalid_count');
 }

 if(distinctRaces>=guard.maxDistinctRaces){
  return Object.freeze({
   status:'CAP_REACHED',
   targetDate:guard.targetDate,
   distinctRaces,
   maxDistinctRaces:guard.maxDistinctRaces
  });
 }

 return Object.freeze({
  status:'OPEN',
  targetDate:guard.targetDate,
  distinctRaces,
  maxDistinctRaces:guard.maxDistinctRaces
 });
}
