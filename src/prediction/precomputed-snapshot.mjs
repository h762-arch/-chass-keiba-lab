export const LAYERS=Object.freeze(['SOURCE','DATA','MARKET','FINAL','RESULT']);
export const SNAPSHOT_STATUSES=Object.freeze(['CALCULATED','NOT_CALCULATED','STALE','PARTIAL']);
const TRANSIENT_SOURCE_KEYS=new Set([
  'acquiredat','fetchedat','retrievedat','collectedat','receivedat','requestedat',
  'downloadedat','observedat','capturedat','ingestedat','cachedat',
  'fetchstartedat','fetchcompletedat','acquisitionmetadata','fetchmetadata'
]);

const stable=value=>Array.isArray(value)
  ? value.map(stable)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])]))
    : value;
const clone=value=>value==null?value:structuredClone(value);
const deepFreeze=value=>{
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  for(const child of Object.values(value))deepFreeze(child);
  return Object.freeze(value);
};
const normalizedKey=key=>String(key).replace(/[^a-z0-9]/gi,'').toLowerCase();
const semanticSource=value=>Array.isArray(value)
  ? value.map(semanticSource)
  : value&&typeof value==='object'
    ? Object.fromEntries(Object.entries(value).filter(([key])=>!TRANSIENT_SOURCE_KEYS.has(normalizedKey(key))).map(([key,item])=>[key,semanticSource(item)]))
    : value;
const marketKey=key=>{
  const raw=String(key);
  const normalized=normalizedKey(raw);
  return /(?:オッズ|人気|期待値|市場)/u.test(raw)
    || normalized==='ev'
    || normalized==='sp'
    || normalized==='price'
    || normalized.includes('odds')
    || normalized.includes('popularity')
    || normalized.includes('expectedvalue')
    || normalized.includes('expectedreturn')
    || normalized.includes('impliedprobability')
    || normalized.includes('bettingprice')
    || normalized.includes('startingprice')
    || normalized.includes('publicrank')
    || normalized.includes('bettingrank')
    || normalized.includes('favoriterank')
    || normalized.includes('favouriterank')
    || normalized.startsWith('market');
};

export function assertMarketIndependentData(value,path='DATA'){
  if(Array.isArray(value)){
    value.forEach((item,index)=>assertMarketIndependentData(item,`${path}[${index}]`));
    return value;
  }
  if(!value||typeof value!=='object')return value;
  for(const [key,item] of Object.entries(value)){
    if(marketKey(key))throw new Error(`market_field_in_data:${path}.${key}`);
    assertMarketIndependentData(item,`${path}.${key}`);
  }
  return value;
}

function webCrypto(cryptoImpl=globalThis.crypto){
  if(!cryptoImpl?.subtle?.digest)throw new Error('web_crypto_unavailable');
  return cryptoImpl;
}

export async function stableHash(value,{cryptoImpl=globalThis.crypto}={}){
  const bytes=new TextEncoder().encode(JSON.stringify(stable(value)));
  const digest=await webCrypto(cryptoImpl).subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export function normalizedVersions(versions={}){
  return {
    calculationVersion:versions.calculationVersion||'precompute-v1',
    modelVersion:versions.modelVersion||'10.0.1',
    clusterVersion:versions.clusterVersion||null,
    signalRuleVersion:versions.signalRuleVersion||null
  };
}

export async function createPrecomputedIdentity({organization,source,versions={},cryptoImpl=globalThis.crypto}={}){
  if(!['JRA','NAR'].includes(organization))throw new Error('invalid_race_identity');
  if(!source||typeof source!=='object')throw new Error('source_required');
  const version=normalizedVersions(versions);
  const sourceHash=await stableHash(semanticSource(source),{cryptoImpl});
  const inputHash=await stableHash({sourceHash,organization,calculationVersion:version.calculationVersion,modelVersion:version.modelVersion,clusterVersion:version.clusterVersion,signalRuleVersion:version.signalRuleVersion},{cryptoImpl});
  return deepFreeze({sourceHash,inputHash,...version});
}

export async function createSnapshotHash({organization,raceId,inputHash,status,layers,sourceValidatedAt,dataCalculatedAt,cryptoImpl=globalThis.crypto}={}){
  return stableHash({organization,raceId,inputHash,status,layers,sourceValidatedAt,dataCalculatedAt},{cryptoImpl});
}

export async function createPrecomputedSnapshot({raceId,organization,source,data,market=null,final=null,result=null,versions={},now=new Date().toISOString(),sourceValidatedAt=now,cryptoImpl=globalThis.crypto}={}){
  if(!raceId||!['JRA','NAR'].includes(organization))throw new Error('invalid_race_identity');
  if(!data||typeof data!=='object')throw new Error('data_required');
  if(final!=null&&market==null)throw new Error('final_requires_market');
  if(result!=null&&final==null)throw new Error('result_requires_final');
  assertMarketIndependentData(data);
  const identity=await createPrecomputedIdentity({organization,source,versions,cryptoImpl});
  const layers={SOURCE:clone(source),DATA:clone(data),MARKET:clone(market),FINAL:clone(final),RESULT:clone(result)};
  const status=final?'CALCULATED':'PARTIAL';
  const dataCalculatedAt=now;
  const snapshotHash=await createSnapshotHash({organization,raceId,inputHash:identity.inputHash,status,layers,sourceValidatedAt,dataCalculatedAt,cryptoImpl});
  return deepFreeze({
    schemaVersion:1,
    raceId,
    organization,
    status,
    sourceAcquiredAt:source.acquiredAt||null,
    sourceValidatedAt,
    dataCalculatedAt,
    sourceHash:identity.sourceHash,
    inputHash:identity.inputHash,
    snapshotHash,
    calculatedAt:now,
    calculationVersion:identity.calculationVersion,
    modelVersion:identity.modelVersion,
    clusterVersion:identity.clusterVersion,
    signalRuleVersion:identity.signalRuleVersion,
    layers
  });
}

export async function shouldRecalculate(existing,input,{cryptoImpl=globalThis.crypto}={}){
  const inputHash=typeof input==='string'?input:await stableHash(input,{cryptoImpl});
  return !existing||existing.inputHash!==inputHash;
}

export async function appendLayerRevision(snapshot,layer,value,{at=new Date().toISOString(),cryptoImpl=globalThis.crypto}={}){
  if(!LAYERS.includes(layer))throw new Error('invalid_layer');
  if(layer==='SOURCE'&&Date.parse(at)<Date.parse(snapshot.sourceValidatedAt||0))return snapshot;
  if(layer==='RESULT'&&!snapshot.layers.FINAL)throw new Error('result_requires_final');
  if(layer==='FINAL'&&!snapshot.layers.MARKET)throw new Error('final_requires_market');
  if(snapshot.layers.FINAL&&!['RESULT','SOURCE'].includes(layer))throw new Error('finalized_upstream_frozen');
  if(layer==='DATA')assertMarketIndependentData(value);
  const previousFinalHash=await stableHash(snapshot.layers.FINAL,{cryptoImpl});
  const next=clone(snapshot);
  next.layers[layer]=clone(value);
  if(layer==='SOURCE'){
    const identity=await createPrecomputedIdentity({organization:next.organization,source:next.layers.SOURCE,versions:next,cryptoImpl});
    const semanticChanged=identity.sourceHash!==snapshot.sourceHash;
    if(semanticChanged){
      next.layers.DATA=null;
      next.layers.MARKET=null;
      next.layers.FINAL=null;
      next.layers.RESULT=null;
      next.dataCalculatedAt=null;
      next.calculatedAt=null;
    }
    next.sourceHash=identity.sourceHash;
    next.inputHash=identity.inputHash;
    next.sourceAcquiredAt=next.layers.SOURCE?.acquiredAt||null;
    next.sourceValidatedAt=Date.parse(at)>=Date.parse(snapshot.sourceValidatedAt||0)?at:snapshot.sourceValidatedAt;
  }else if(layer==='DATA'){
    next.layers.MARKET=null;
    next.layers.FINAL=null;
    next.layers.RESULT=null;
    next.calculatedAt=at;
    next.dataCalculatedAt=at;
  }else if(layer==='MARKET'){
    next.layers.FINAL=null;
    next.layers.RESULT=null;
  }else if(layer==='FINAL'){
    next.layers.RESULT=null;
  }
  next.status=next.layers.DATA&&next.layers.FINAL?'CALCULATED':'PARTIAL';
  next.snapshotHash=await createSnapshotHash({organization:next.organization,raceId:next.raceId,inputHash:next.inputHash,status:next.status,layers:next.layers,sourceValidatedAt:next.sourceValidatedAt,dataCalculatedAt:next.dataCalculatedAt,cryptoImpl});
  next.revision={layer,at,previousHash:await stableHash(snapshot.layers[layer],{cryptoImpl}),hash:await stableHash(value,{cryptoImpl}),finalHash:await stableHash(next.layers.FINAL,{cryptoImpl}),snapshotHash:next.snapshotHash};
  if(layer==='RESULT'&&next.revision.finalHash!==previousFinalHash)throw new Error('final_mutated_by_result');
  return deepFreeze(next);
}

export function viewerState(snapshot,{maxAgeMs=15*60_000,now=Date.now()}={}){
  if(!snapshot)return {status:'NOT_CALCULATED',snapshot:null};
  if(!snapshot.layers?.DATA||!snapshot.layers?.FINAL)return {status:'PARTIAL',snapshot};
  const age=now-Date.parse(snapshot.sourceValidatedAt||snapshot.dataCalculatedAt||snapshot.calculatedAt||0);
  if(Number.isFinite(age)&&age>maxAgeMs)return {status:'STALE',snapshot};
  return {status:'CALCULATED',snapshot};
}
