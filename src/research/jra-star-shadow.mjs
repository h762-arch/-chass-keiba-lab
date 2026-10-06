import {assertMarketIndependentData} from '../prediction/precomputed-snapshot.mjs';
import {JRA_EARLY_CALCULATION_VERSION,JRA_EARLY_MODEL_VERSION} from '../prediction/jra-early-research-reader.mjs';

const rejected=reason=>Object.freeze({status:'REJECTED',reason,candidate:null});

// Research only. Never rewrite frozen DATA or promote a candidate to an Original Signal.
export function buildJraStarShadow(readResult){
 if(readResult?.status!=='READY'||!readResult.snapshot)return rejected('EARLY_NOT_READY');
 const {snapshot}=readResult;
 if(snapshot.calculationVersion!==JRA_EARLY_CALCULATION_VERSION||
    snapshot.modelVersion!==JRA_EARLY_MODEL_VERSION)return rejected('VERSION_MISMATCH');
 const data=snapshot.data;
 if(data?.raceType!=='JRA'||!Array.isArray(data.horses))return rejected('INVALID_DATA');
 try{assertMarketIndependentData(data)}catch{return rejected('MARKET_DATA_FORBIDDEN')}
 const seen=new Set();
 let fifth=null;
 for(const horse of data.horses){
  const no=horse?.horseNo,rank=horse?.abilityRank;
  if(!Number.isInteger(no)||no<1||no>99||seen.has(no)||
     !Number.isInteger(rank)||rank<1)return rejected('INVALID_DATA');
  seen.add(no);
  if(rank===5){
   if(fifth)return rejected('AMBIGUOUS_RANK_FIVE');
   fifth=horse;
  }
 }
 if(!fifth)return rejected('NO_RANK_FIVE');
 return Object.freeze({status:'CANDIDATE',reason:null,
  raceId:snapshot.raceId,revision:snapshot.revision,
  candidate:Object.freeze({horseNo:fifth.horseNo,horseName:fifth.horseName,
   abilityRank:5,candidateMark:'☆'})});
}
