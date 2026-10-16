import {fetchNarPrecomputeMeeting} from '../prediction/nar-ability-precompute.mjs';
import {validMirrorDate} from './nar-status-mirror-audit.mjs';

const tracks={'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const jstDate=n=>new Date(n+9*3600000).toISOString().slice(0,10);
const reasons=['SOURCE_DEADLINE','SOURCE_HTTP','SOURCE_SIZE','SOURCE_URL','SOURCE_DECODE','MEETING_UNCONFIRMED','MEETING_SOURCE_FAILED'];
// Invokes only the unchanged production meeting reader in this host, never its
// collector, Worker, DB, writer or environment configuration.
export async function observeNarProductionMeetingControl({date,code,race,postTime,notBeforeMs,fetchImpl=globalThis.fetch,wallNow=Date.now}={}){
  const requests=[];let active=true,fatal=null,previous,meeting=null;
  const finish=(status,reasonCodes,extra={})=>({scope:'UNCHANGED_PRODUCTION_MEETING_HELPER_IN_CURRENT_HOST',status,reasonCodes,
    helper:'fetchNarPrecomputeMeeting',executionBasis:'STANDALONE_NOT_WORKER_REPLAY',maxTotalTransportBudgetMs:5000,
    requestCount:requests.length,requests,meeting,acquisitionCertified:false,formalKpiEligible:false,productionSourceChanged:false,
    probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',...extra});
  const clock=()=>{const n=wallNow();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime())||(previous!==undefined&&n<previous)||(Number.isFinite(notBeforeMs)&&n<notBeforeMs)){fatal='CONTROL_CLOCK_INVALID';throw Error(fatal);}previous=n;return n;};
  try{
    if(!validMirrorDate(date)||typeof code!=='string'||!Object.hasOwn(tracks,code)||!Number.isInteger(race)||race<1||race>20||!/^([01]\d|2[0-3]):[0-5]\d$/.test(postTime||'')||!Number.isFinite(notBeforeMs)||typeof fetchImpl!=='function'||typeof wallNow!=='function')return finish('HOLD',['CONTROL_CONFIGURATION_INVALID']);
    const post=Date.parse(`${date}T${postTime}:00+09:00`),gate=()=>{const n=clock();if(jstDate(n)!==date)fatal='CONTROL_DATE_CHANGED';else if(n>=post)fatal='CONTROL_POST_TIME_REACHED';if(fatal)throw Error(fatal);return n;};
    const started=gate(),query=`k_babaCode=${encodeURIComponent(code)}&k_raceDate=${encodeURIComponent(date.replaceAll('-','/'))}`;
    const routes=[['RaceList',`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?${query}`],['RaceList_ipat',`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat?${query}`],['RaceList_mobile',`https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?${query}`]];
    let parsed;
    try{
      parsed=await fetchNarPrecomputeMeeting({code,date,timeoutMs:5000,fetchImpl:async(input,init)=>{
        if(!active||fatal)throw Error('CONTROL_ABORTED');
        const route=routes[requests.length];if(!route||input!==route[1]){fatal='CONTROL_UNEXPECTED_FETCH';throw Error(fatal);}
        const attempted=gate(),record={route:route[0],sourceUrl:route[1],attemptedAt:new Date(attempted).toISOString(),status:'STARTED'};requests.push(record);
        try{
          const response=await fetchImpl(input,init);
          if(!active||init.signal.aborted){void response?.body?.cancel().catch(()=>{});throw Error('CONTROL_LATE_RESPONSE');}
          const at=gate();Object.assign(record,{status:'HEADERS_OBSERVED',httpStatus:Number.isInteger(response?.status)?response.status:null,headersAt:new Date(at).toISOString()});
          return response;
        }catch(e){if(active&&!init.signal.aborted)record.status='FETCH_FAILED';throw e;}
      }});
    }catch(e){
      const audit=Array.isArray(e?.meetingAudit)?e.meetingAudit:[];
      for(const record of requests){const item=audit.find(a=>a.route===record.route);if(item&&reasons.includes(item.reason))record.reason=item.reason;if(record.status==='STARTED')record.status='NO_HEADERS_OBSERVED';}
      const ended=gate();return finish('HOLD',[fatal??(e?.message==='MEETING_SOURCE_UNAVAILABLE'?'MEETING_SOURCE_UNAVAILABLE':'CONTROL_READ_UNAVAILABLE')],{startedAt:new Date(started).toISOString(),finishedAt:new Date(ended).toISOString()});
    }
    const finished=gate();if(fatal)return finish('HOLD',[fatal]);
    for(const record of requests)if(record.status==='STARTED')record.status='NO_HEADERS_OBSERVED';
    if(parsed.track!==tracks[code]||parsed.date!==date||parsed.status!=='meeting'||!Array.isArray(parsed.raceNumbers)||!parsed.raceNumbers.length||parsed.raceNumbers.length>20||parsed.raceNumbers.some(n=>!Number.isInteger(n)||n<1||n>20)||new Set(parsed.raceNumbers).size!==parsed.raceNumbers.length||!parsed.raceNumbers.includes(race)||!routes.some(([name])=>name===parsed.sourceRoute))return finish('HOLD',['CONTROL_MEETING_NOT_CONFIRMED'],{startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString()});
    meeting={date,code,track:tracks[code],raceNumbers:[...parsed.raceNumbers],selectedRacePresent:true,sourceRoute:parsed.sourceRoute};
    const selected=requests.find(r=>r.route===parsed.sourceRoute);if(selected)selected.status='MEETING_PARSED';
    return finish('PRODUCTION_HELPER_MEETING_OBSERVED',[],{startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString()});
  }catch{return finish('HOLD',[fatal??'CONTROL_READ_UNAVAILABLE']);}finally{active=false;}
}
