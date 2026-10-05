import {readJraEarlyResearchSnapshot} from '../prediction/jra-early-research-reader.mjs';

const rejected=reason=>Object.freeze({status:'REJECTED',reason,comparison:null});
const pending=()=>Object.freeze({status:'PENDING',reason:'OFFICIAL_RESULT_NOT_FOUND',comparison:null});
const number=value=>Number.isInteger(value)&&value>=1&&value<=99;
const average=values=>values.length?Number((values.reduce((sum,value)=>sum+value,0)/values.length).toFixed(6)):null;

function seconds(value){
 const match=/^(\d+):([0-5]\d)\.(\d+)$/.exec(String(value||''));
 return match?Number(match[1])*60+Number(match[2])+Number(`0.${match[3]}`):null;
}

function raceIdentity(raceId){
 const match=/^(\d{4})(\d{2})(\d{2})-JRA-(.+)-(\d{2})$/.exec(raceId);
 return match?{date:`${match[1]}-${match[2]}-${match[3]}`,track:match[4],race:Number(match[5])}:null;
}

function validOfficialResult(row,result,id,early,now){
 if(row.organization!=='JRA'||row.race_date!==id.date||row.track!==id.track||Number(row.race_no)!==id.race)return false;
 if(result?.ok!==true||result.organization!=='JRA'||result.source!=='JRA_OFFICIAL'||
  result.date!==id.date||result.track!==id.track||Number(result.race)!==id.race||
  result.quality?.complete!==true||Number(result.quality?.finishOrderCount)<3||
  !Array.isArray(result.finishOrder)||result.finishOrder.length!==3||
  !Array.isArray(result.results)||result.results.length<3)return false;
 const fetchedAt=Date.parse(row.fetched_at||'');
 if(!Number.isFinite(fetchedAt)||fetchedAt>now||fetchedAt<Date.parse(early.dataCalculatedAt)||
  fetchedAt<Date.parse(early.sourceValidatedAt))return false;
 const order=result.finishOrder;
 if(order.some(horseNo=>!number(horseNo))||new Set(order).size!==3)return false;
 const runners=result.results;
 if(runners.some(horse=>!number(horse?.horseNo)||!Number.isInteger(horse.position)||horse.position<1)||
  new Set(runners.map(horse=>horse.horseNo)).size!==runners.length)return false;
 return order.every((horseNo,index)=>runners.some(horse=>horse.horseNo===horseNo&&horse.position===index+1));
}

// Research-only comparison. No public route, scheduler, D1 writes or outbound fetch.
export async function compareJraEarlyToOfficialResult({DB,raceId,now=Date.now()}={}){
 const early=await readJraEarlyResearchSnapshot({DB,raceId,now});
 if(early.status!=='READY')return rejected(`EARLY_${early.reason}`);
 const snapshot=early.snapshot,id=raceIdentity(raceId);
 const postTime=snapshot.data.race.postTime;
 let postTimeStatus='UNVERIFIED';
 if(postTime!=null&&postTime!==''){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(postTime))return rejected('INVALID_POST_TIME');
  const postAt=Date.parse(`${id.date}T${postTime}:00+09:00`);
  if(!Number.isFinite(postAt))return rejected('INVALID_POST_TIME');
  if(Date.parse(snapshot.sourceValidatedAt)>postAt||Date.parse(snapshot.dataCalculatedAt)>postAt)
   return rejected('EARLY_AFTER_POST_TIME');
  postTimeStatus='PRE_POST';
 }
 let row;
 try{
  row=await DB.prepare(`SELECT organization,race_date,track,race_no,payload_json,fetched_at
   FROM jra_official_cache WHERE kind='result' AND cache_key=?`)
   .bind(`result|${id.date}|${id.track}|${id.race}`).first();
 }catch{return rejected('RESULT_READ_FAILED');}
 if(!row)return pending();
 let result;
 try{result=JSON.parse(row.payload_json);}catch{return rejected('MALFORMED_RESULT');}
 if(!validOfficialResult(row,result,id,snapshot,now))return rejected('RESULT_INTEGRITY_FAILED');
 const predicted=new Map(snapshot.data.horses.map(horse=>[horse.horseNo,horse]));
 if(result.finishOrder.some(horseNo=>!predicted.has(horseNo)))return rejected('RESULT_RUNNER_MISMATCH');
 const actual=new Map(result.results.map(horse=>[horse.horseNo,horse]));
 const top3=new Set(result.finishOrder),win=[],place=[],time=[];
 const runners=snapshot.data.horses.map(horse=>{
  const observed=actual.get(horse.horseNo);
  if(!observed)return Object.freeze({horseNo:horse.horseNo,matched:false,win:null,top3:null,timeErrorSeconds:null});
  const won=horse.horseNo===result.finishOrder[0],placed=top3.has(horse.horseNo);
  win.push((horse.win/100-Number(won))**2);
  place.push((horse.place/100-Number(placed))**2);
  const predictedTime=seconds(horse.predictedTime),actualTime=seconds(observed.actualTime??observed.time);
  const error=predictedTime!=null&&actualTime!=null?Number((actualTime-predictedTime).toFixed(3)):null;
  if(error!=null)time.push(Math.abs(error));
  return Object.freeze({horseNo:horse.horseNo,matched:true,win:won,top3:placed,timeErrorSeconds:error});
 });
 return Object.freeze({status:'READY',reason:null,comparison:Object.freeze({
  raceId,earlyRevision:snapshot.revision,calculationVersion:snapshot.calculationVersion,
  modelVersion:snapshot.modelVersion,earlyCalculatedAt:snapshot.dataCalculatedAt,
  resultFetchedAt:row.fetched_at,resultSource:'JRA_OFFICIAL',postTimeStatus,
  formalKpiEligible:postTimeStatus==='PRE_POST',
  matchedRunnerCount:win.length,unmatchedRunnerCount:runners.length-win.length,
  winBrier:average(win),top3Brier:average(place),timeSampleCount:time.length,timeMaeSeconds:average(time),
  runners:Object.freeze(runners)
 })});
}
