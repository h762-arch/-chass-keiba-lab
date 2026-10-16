import {createHash} from 'node:crypto';
import {auditNarCollectionRun} from './nar-collection-run-audit.mjs';
import {parseNarRaceList} from '../../meeting-discovery.mjs';
import {parseNarMobileRaceList} from '../prediction/nar-ability-precompute.mjs';

const flags = {scope:'READ_ONLY_MEETING_SOURCE_PROBE',researchOnly:true,formalKpiEligible:false,
  acquisitionCertified:false,currentStatusEligible:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO',
  executionBasis:'STANDALONE_FETCH_NOT_WORKER_REPLAY',diagnosisStatus:'NOT_ESTABLISHED',automaticSourceSwitchAllowed:false};
const tracks = {'10':'盛岡','11':'水沢','18':'浦和','19':'船橋','20':'大井','21':'川崎','22':'金沢','23':'笠松','24':'名古屋','27':'園田','28':'姫路','31':'高知','32':'佐賀','36':'門別'};
const maxBytes = 1000000;
const fail = reason => {throw Error(reason);};
const clock = f => {const n=f();if(!Number.isFinite(n)||!Number.isFinite(new Date(n).getTime()))fail('PROBE_CLOCK_INVALID');return n;};
function locationClass(value,source) {
  if (!value) return 'MISSING';
  try {const u=new URL(value,source);if(u.username||u.password||!['http:','https:'].includes(u.protocol))return 'INVALID';return u.origin===new URL(source).origin?'SAME_ORIGIN':'OTHER_ORIGIN';}
  catch {return 'INVALID';}
}
async function probe(target,{date,code,track,fetchImpl,timeoutMs,wallNow}) {
  const started=clock(wallNow),controller=new AbortController();let timer,reader,httpStatus=null;
  const base={route:target.route,sourceUrl:target.url,attemptedAt:new Date(started).toISOString(),timeoutMs,maxResponseBytes:maxBytes};
  try {
    const result=await Promise.race([
      new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('PROBE_TIMEOUT'));},timeoutMs);}),
      (async()=>{
        const r=await fetchImpl(target.url,{method:'GET',redirect:'manual',credentials:'omit',signal:controller.signal});
        if(controller.signal.aborted){void r?.body?.cancel().catch(()=>{});fail('PROBE_TIMEOUT');}
        if(!r||!Number.isInteger(r.status)||r.status<100||r.status>599)fail('RESPONSE_INVALID');httpStatus=r.status;
        const type=(r.headers.get('content-type')||'').split(';',1)[0].trim().toLowerCase();
        const contentType=type==='text/html'?'HTML':type==='application/json'?'JSON':type?'OTHER':'MISSING';
        const redirectTarget=locationClass(r.headers.get('location'),target.url);
        if(Number(r.headers.get('content-length'))>maxBytes)fail('BODY_LIMIT');
        if(!r.body)fail('BODY_UNAVAILABLE');reader=r.body.getReader();const parts=[];let bytes=0;
        for(;;){const x=await reader.read();if(controller.signal.aborted)fail('PROBE_TIMEOUT');if(x.done)break;bytes+=x.value.byteLength;if(bytes>maxBytes)fail('BODY_LIMIT');parts.push(x.value);}
        const raw=new Uint8Array(bytes);let offset=0;for(const part of parts){raw.set(part,offset);offset+=part.byteLength;}
        let meeting={status:'NOT_PARSED',raceNumbers:[]};
        if(httpStatus===200&&!r.redirected&&contentType==='HTML'){
          let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(raw);}catch{fail('BODY_DECODE');}
          const p=target.mobile?parseNarMobileRaceList(text,{code,track,date}):parseNarRaceList(text,{track,date});
          if(p.date!==date||p.track!==track||!['meeting','non_meeting','meeting_unknown'].includes(p.status)||!Array.isArray(p.raceNumbers)||p.raceNumbers.length>20||p.raceNumbers.some(n=>!Number.isInteger(n)||n<1||n>20))fail('PARSE_INVALID');
          meeting={status:p.status,raceNumbers:[...p.raceNumbers]};
        }
        return {status:'RESPONSE_OBSERVED',httpStatus,contentType,redirected:r.redirected===true,redirectTarget,
          responseBytes:bytes,responseBytesSha256:createHash('sha256').update(raw).digest('hex'),meeting};
      })()
    ]);
    const finished=clock(wallNow);if(finished<started)fail('PROBE_CLOCK_INVALID');
    return {...base,...result,finishedAt:new Date(finished).toISOString()};
  } catch(e) {
    const known=['PROBE_TIMEOUT','RESPONSE_INVALID','BODY_LIMIT','BODY_UNAVAILABLE','BODY_DECODE','PARSE_INVALID','PROBE_CLOCK_INVALID'];
    return {...base,status:'HOLD',reasonCode:known.includes(e?.message)?e.message:'PROBE_UNAVAILABLE',httpStatus};
  } finally {clearTimeout(timer);controller.abort();if(reader)void reader.cancel().catch(()=>{});}
}

// Four fixed GETs, one per route/encoding variant, without retries or redirects.
// A valid fresh source must record an unavailable meeting for this configured track.
export async function probeNarMeetingSources(bundle,{expectedDate,code,fetchImpl=globalThis.fetch,wallNow=Date.now,perRequestTimeoutMs=5000}={}) {
  let collectionAudit=null;const observations=[];
  const hold=reason=>({...flags,status:'HOLD',reasonCodes:[reason],collectionAudit,requestCount:observations.length,observations});
  try {
    if(typeof fetchImpl!=='function'||typeof wallNow!=='function'||typeof code!=='string'||!tracks[code]||!Number.isInteger(perRequestTimeoutMs)||perRequestTimeoutMs<1||perRequestTimeoutMs>5000)return hold('PROBE_CONFIGURATION_INVALID');
    let previous;
    const readNow=()=>{const at=clock(wallNow);if(previous!==undefined&&at<previous)fail('PROBE_CLOCK_INVALID');previous=at;return at;};
    const started=readNow(),source=structuredClone(bundle);
    collectionAudit=auditNarCollectionRun(source,{expectedDate,now:started});
    if(collectionAudit.mirrorAudit?.status!=='VERIFIED'||!collectionAudit.run||collectionAudit.reasonCodes.some(r=>!['MEETING_SOURCE_UNAVAILABLE','NO_ACQUISITION_ATTEMPT_RECORDED'].includes(r)))return hold('SOURCE_RUN_NOT_PROBEABLE');
    const track=tracks[code];
    if(!Array.isArray(source.snapshot.payload.trackCodes)||!source.snapshot.payload.trackCodes.includes(code)||!collectionAudit.run.events.some(e=>e.track===track&&e.reason==='MEETING_SOURCE_UNAVAILABLE'))return hold('TRACK_FAILURE_NOT_RECORDED');
    const rawDate=expectedDate.replaceAll('-','/'),query=`k_babaCode=${code}&k_raceDate=${encodeURIComponent(rawDate)}`;
    const targets=[
      {route:'RaceList',url:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?${query}`},
      {route:'RaceList_raw_slash_comparison',url:`https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/RaceList?k_babaCode=${code}&k_raceDate=${rawDate}`},
      {route:'RaceList_ipat',url:`https://www.keiba.go.jp/KeibaWeb_IPAT/TodayRaceInfo/RaceList_ipat?${query}`},
      {route:'RaceList_mobile',url:`https://sp.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?${query}`,mobile:true}
    ];
    for(const target of targets){
      observations.push(await probe(target,{date:expectedDate,code,track,fetchImpl,timeoutMs:perRequestTimeoutMs,wallNow:readNow}));
      if(observations.at(-1).reasonCode==='PROBE_CLOCK_INVALID')return hold('PROBE_CLOCK_INVALID');
    }
    const finished=readNow();
    const finalAudit=auditNarCollectionRun(source,{expectedDate,now:finished});
    collectionAudit=finalAudit;
    if(finalAudit.mirrorAudit?.status!=='VERIFIED'||finalAudit.reasonCodes.includes('RECORDED_RUN_STALE'))return hold('SOURCE_STALE_AFTER_PROBE');
    const [encoded,raw]=observations;
    const comparable=x=>x.status==='RESPONSE_OBSERVED';
    const outcome=x=>JSON.stringify({httpStatus:x.httpStatus,redirected:x.redirected,redirectTarget:x.redirectTarget,meeting:x.meeting});
    const encodingComparison=comparable(encoded)&&comparable(raw)?outcome(encoded)===outcome(raw)?'SAME_RECORDED_OUTCOME':'DIFFERENT_RECORDED_OUTCOME':'UNAVAILABLE';
    const meetingObserved=observations.some(o=>o.meeting?.status==='meeting'&&o.meeting.raceNumbers.length>0);
    const partial=observations.some(o=>o.status!=='RESPONSE_OBSERVED');
    return {...flags,status:meetingObserved?'MEETING_RESPONSE_OBSERVED':'HOLD',reasonCodes:meetingObserved?partial?['SOME_PROBES_UNAVAILABLE']:[]:['MEETING_NOT_CONFIRMED'],probeCompleteness:partial?'PARTIAL':'COMPLETE',
      collectionAudit:finalAudit,requestCount:observations.length,observations,encodingComparison,
      sourceReference:finalAudit.sourceReference,startedAt:new Date(started).toISOString(),finishedAt:new Date(finished).toISOString(),
      recordedCollectionDecision:'HOLD',recordedFailureNotResolved:true};
  } catch(e) {return hold(e?.message==='PROBE_CLOCK_INVALID'?'PROBE_CLOCK_INVALID':'PROBE_INPUT_UNREADABLE');}
}
