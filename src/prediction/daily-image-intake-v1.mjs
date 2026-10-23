/** Explicit image intake. Google Vision is called only with opt-in/key; no result pages. */
import {createCpsiDriveReadSession} from './cpsi-drive-reader-v1.mjs';
import {officialRosterForOcr,compactVisionWords,parseNarIndexImage} from './nar-image-table-v1.mjs';
import {captureCpsiPreRun,verifyCpsiProducerReceipt,cpsiProducerCardUrl} from './cpsi-pre-producer-v1.mjs';
import {sourceRootFromInput,sourceSha256,stableSourceJson} from './cpsi-source-recovery-v1.mjs';
import {extractNarOfficialHistoryLinks} from './nar-official-history-links.mjs';
import {parseNarRaceList} from '../../meeting-discovery.mjs';
import {jstDate} from './daily-analysis-v1.mjs';
import {validRetryId} from './daily-retry-v1.mjs';
const DRIVE='https://www.googleapis.com/drive/v3/files/';
export const IMAGE_INTAKE_FORMAT='CHASS_DAILY_IMAGE_INTAKE_V1';
const venues={盛岡:'10',水沢:'11',浦和:'18',船橋:'19',大井:'20',川崎:'21',金沢:'22',笠松:'23',名古屋:'24',園田:'27',姫路:'28',高知:'31',佐賀:'32',門別:'36'};
const fail=code=>{throw Object.assign(Error(code),{code});};
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{10,160}$/.test(s);
const code=e=>/^(IMAGE|DRIVE|PRODUCER)_[A-Z0-9_]{1,90}$/.test(e?.code||e?.message||'')?(e.code||e.message):'IMAGE_INTAKE_FAILED';
const responseSignals=new WeakMap();
function abortable(operation,signal){
 if(!signal)return Promise.resolve().then(operation);
 if(signal.aborted)return Promise.reject(Object.assign(Error('IMAGE_JOB_TIMEOUT'),{code:'IMAGE_JOB_TIMEOUT'}));
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(Object.assign(Error('IMAGE_JOB_TIMEOUT'),{code:'IMAGE_JOB_TIMEOUT'}));signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(operation).then(value=>{if(signal.aborted){value?.body?.cancel?.().catch(()=>{});abort();}else resolve(value);},reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
async function bytes(response,max){
 if(!response.ok)fail('IMAGE_PROVIDER_READ_FAILED');if(!response.body||Number(response.headers.get('content-length'))>max)fail('IMAGE_RESPONSE_SIZE');
 const reader=response.body.getReader(),parts=[];let size=0;
 try{for(;;){const {done,value}=await abortable(()=>reader.read(),responseSignals.get(response));if(done)break;size+=value.length;if(size>max)fail('IMAGE_RESPONSE_SIZE');parts.push(value);}}catch(e){reader.cancel().catch(()=>{});throw e;}
 const out=new Uint8Array(size);let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;
}
const decode=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const json=async(r,max=1500000)=>JSON.parse(decode(await bytes(r,max)));
function b64(b){let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);}
async function binaryHash(b){return 'sha256:'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');}
const metaFields='id,name,mimeType,size,version,modifiedTime,trashed,parents';
async function listing(call,parent,extra=''){
 const q=`'${parent}' in parents and trashed = false${extra}`;
 const v=await json(await call(DRIVE.slice(0,-1)+'?'+new URLSearchParams({q,pageSize:'100',fields:`files(${metaFields}),nextPageToken`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'})));
 if(!Array.isArray(v.files)||v.files.length>100||v.nextPageToken)fail('IMAGE_FOLDER_LIST_INCOMPLETE');return v.files;
}
async function readPng(file,parent,call){
 const valid=m=>m?.id===file.id&&m.name===file.name&&m.mimeType==='image/png'&&m.trashed!==true&&Array.isArray(m.parents)&&m.parents.includes(parent)&&/^\d{1,30}$/.test(m.version||'')&&Number.isFinite(Date.parse(m.modifiedTime))&&Number(m.size)>24&&Number(m.size)<=2097152;
 const url=DRIVE+file.id+'?'+new URLSearchParams({fields:metaFields,supportsAllDrives:'true'}),before=await json(await call(url));
 if(!valid(before))fail('IMAGE_METADATA_INVALID');
 const image=await bytes(await call(DRIVE+file.id+'?alt=media&supportsAllDrives=true'),2097152),after=await json(await call(url));
 if(!valid(after)||stableSourceJson(before)!==stableSourceJson(after)||image.length!==Number(before.size))fail('IMAGE_CHANGED_DURING_READ');
 if(image.slice(0,8).join(',')!=='137,80,78,71,13,10,26,10')fail('IMAGE_PNG_REQUIRED');
 const view=new DataView(image.buffer,image.byteOffset,image.byteLength),width=view.getUint32(16),height=view.getUint32(20);
 return {image,metadata:before,imageHash:await binaryHash(image),width,height};
}
function officialUrl(race,path){const u=new URL('https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/'+path);u.searchParams.set('k_raceDate',race.raceDate.replaceAll('-','/'));u.searchParams.set('k_babaCode',race.code);if(race.raceNo)u.searchParams.set('k_raceNo',String(race.raceNo));return u.href;}
async function enrichedRoot(receipt,parsed,ocrRaw,imageInfo){
 const root=sourceRootFromInput(receipt.body.artifact.input),f=root.race.metricInputFreeze;
 root.race.waveEligibility='NAR_FLAT';f.marketSnapshotId='IMAGE-MARKET:'+await sourceSha256([f.runId,parsed.predictedMarket]);
 const authorityRef='image-ocr:'+await sourceSha256(ocrRaw),market={organizer:'NAR',raceId:`${root.race.raceDate}|${root.race.track}|${root.race.raceNo}`,runId:f.runId,inputSnapshotId:f.inputSnapshotId,kind:'EARLY',isPreResult:true,capturedAt:f.freezeAt,snapshotId:f.marketSnapshotId,authorityRef,sourceRef:'drive-image:'+imageInfo.metadata.id,sourceClass:'PREDICTED_ODDS',horses:parsed.predictedMarket};
 root.race.originalEarlyMarket=market;
 const favorite=market.horses.find(h=>h.popularity===1),ranked=root.horses.filter(h=>Number.isFinite(h.canonicalIndex.peak)).sort((a,b)=>b.canonicalIndex.peak-a.canonicalIndex.peak),favoritePeak=root.horses.find(h=>h.horseNo===favorite?.horseNo)?.canonicalIndex.peak;
 root.race.waveEvidence={...market,snapshotId:'IMAGE-WAVE:'+await sourceSha256([f.runId,authorityRef]),indexSnapshotId:f.indexSnapshotId,marketSnapshotId:f.marketSnapshotId,indexAuthorityRef:root.horses[0]?.canonicalIndex.authorityRef,...(Number.isFinite(favoritePeak)?{favoriteHighestIndexRank:1+ranked.filter(h=>h.canonicalIndex.peak>favoritePeak).length}:{})};
 root.imageObservation={layout:parsed.layout,imageId:imageInfo.metadata.id,imageVersion:imageInfo.metadata.version,imageModifiedAt:imageInfo.metadata.modifiedTime,imageHash:imageInfo.imageHash,ocrHash:await sourceSha256(ocrRaw),rawRows:parsed.rawRows,starPolicy:parsed.starPolicy,currentPolicy:parsed.currentPolicy,timeMeaning:'SERVER_BYTES_READ_NOT_ORIGINAL_SCREENSHOT_TIME',sourceOriginAuthenticated:false};
 return root;
}
export async function createImageResearchInput({parsed,rawCard,acquireFreshCard,ocrRaw,imageInfo,clock=Date.now}){
 const race=parsed.observation.race;let receipt;
 const captured=await captureCpsiPreRun({enabled:true,clock,acquireIndex:async()=>JSON.stringify(parsed.observation),acquireCard:acquireFreshCard||(async()=>rawCard),store:{async insertIfAbsent(id,r){if(receipt)return false;receipt=structuredClone(r);return true;},async get(){return structuredClone(receipt);}}});
 if(captured.status!=='LOCAL_PRE_SOURCE_READY')fail(captured.reason);
 // No invented clustering, EV, pace or caller scenario assertions.
 const root=await enrichedRoot(receipt,parsed,ocrRaw,imageInfo);
 const body={root,producerReceipt:receipt,ocrRaw,imageInfo:{metadata:imageInfo.metadata,imageHash:imageInfo.imageHash},researchOnly:true,formalKpiEligible:false,sourceOriginAuthenticated:false};
 return {format:IMAGE_INTAKE_FORMAT,contentHash:await sourceSha256(body),body};
}
export async function verifyImageResearchInput(packet,{now=Date.now()}={}){
 if(packet?.format!==IMAGE_INTAKE_FORMAT||packet.contentHash!==await sourceSha256(packet.body))fail('IMAGE_RECEIPT_HASH_MISMATCH');
 const b=packet.body;if(b.researchOnly!==true||b.formalKpiEligible!==false||b.sourceOriginAuthenticated!==false)fail('IMAGE_GOVERNANCE_INVALID');
 await verifyCpsiProducerReceipt(b.producerReceipt,{now});
 const race=b.producerReceipt.body.artifact.input.race,roster=officialRosterForOcr(b.producerReceipt.body.officialCard.raw);
 const parsed=parseNarIndexImage(compactVisionWords(JSON.parse(b.ocrRaw)),{race:{raceDate:race.raceDate,track:race.track,code:b.producerReceipt.body.officialIdentities.body.code,raceNo:race.raceNo},expectedHorses:roster});
 if(stableSourceJson(parsed.observation)!==stableSourceJson(JSON.parse(b.producerReceipt.body.indexObservation.raw))||stableSourceJson(parsed.rawRows)!==stableSourceJson(b.root.imageObservation.rawRows)||stableSourceJson(parsed.predictedMarket)!==stableSourceJson(b.root.race.originalEarlyMarket.horses))fail('IMAGE_RECEIPT_OBSERVATION_MISMATCH');
 // Canonical root + exact index/identity/context must remain bound to the Producer.
 if(!validId(b.imageInfo?.metadata?.id)||!/^sha256:[a-f0-9]{64}$/.test(b.imageInfo?.imageHash||'')||stableSourceJson(b.root)!==stableSourceJson(await enrichedRoot(b.producerReceipt,parsed,b.ocrRaw,b.imageInfo)))fail('IMAGE_RECEIPT_BINDING_INVALID');
 return packet;
}
/** Once-per-date OCR capture; every held/missing race stays explicit. No silent retries with later evidence. */
export async function runDailyImageIntake(env={},options={}){
 if(env.ENABLE_DAILY_ANALYSIS_V1!=='true'||env.ENABLE_DAILY_IMAGE_INTAKE_V1!=='true')return {status:'DISABLED',rows:[],issues:[]};
 const clock=options.clock||Date.now,date=options.date||jstDate(clock()),db=env.DB;
 const report={status:'HOLD',rows:[],issues:[],expectedRaceCount:0,imageFileCount:0,readbackVerifiedCount:0,scope:'NAR_REGISTERED_IMAGE_FOLDERS',allScheduledRacesConfirmed:false,imageOcrAttempted:false};
 if(options.retryId&&!validRetryId(options.retryId,date))return {...report,issues:[{reason:'IMAGE_RETRY_INVALID'}]};
 const jobId=options.retryId?'IMAGE_'+options.retryId:'IMAGE_0900_JST:'+date;
 let claimed=false;
 const controller=new AbortController(),timeoutMs=options.timeoutMs??210000;
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>210000)return {...report,issues:[{reason:'IMAGE_CONFIG_INVALID'}]};
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date!==jstDate(clock())||!db?.prepare||!validId(env.CHASS_DAILY_IMAGE_ROOT_FOLDER_ID)||typeof env.CHASS_DAILY_VISION_API_KEY!=='string'||!/^[-A-Za-z0-9_]{20,256}$/.test(env.CHASS_DAILY_VISION_API_KEY))fail('IMAGE_CONFIG_INVALID');
  const claim=await db.prepare('INSERT OR IGNORE INTO chass_daily_image_jobs (job_id,race_date,status,started_at) VALUES (?,?,?,?)').bind(jobId,date,'RUNNING',new Date(clock()).toISOString()).run();
  if(claim.meta?.changes!==1){
   const job=await db.prepare('SELECT status,report_json FROM chass_daily_image_jobs WHERE job_id=?').bind(jobId).first();
   if(!job||job.status==='RUNNING'){report.status='IN_PROGRESS';report.issues.push({reason:'IMAGE_JOB_ALREADY_RUNNING_OR_INTERRUPTED'});return report;}
   const stored=JSON.parse(job.report_json),records=await db.prepare('SELECT race_id,packet_json FROM chass_daily_image_inputs WHERE job_id=? ORDER BY race_id').bind(jobId).all();
   const failed=new Set((stored.issues||[]).map(x=>x.raceId));
   for(const r of records.results||[]){if(failed.has(r.race_id))continue;const p=JSON.parse(r.packet_json);await verifyImageResearchInput(p,{now:clock()});if(p.body.root.race.raceDate!==date||`${p.body.root.race.raceDate}|${p.body.root.race.track}|${p.body.root.race.raceNo}`!==r.race_id)fail('IMAGE_RECEIPT_BINDING_INVALID');report.rows.push({root:p.body.root,sourceRef:'image-intake:'+p.contentHash});}
   if(report.rows.length!==stored.readbackVerifiedCount)fail('IMAGE_READBACK_COUNT_MISMATCH');
   return {...stored,rows:report.rows};
  }
  claimed=true;
  const underlyingFetch=options.fetchImpl||fetch,fetchImpl=async(url,init)=>{const response=await abortable(()=>underlyingFetch(url,init),controller.signal);responseSignals.set(response,controller.signal);return response;},session=await abortable(()=>createCpsiDriveReadSession(env,{fetchImpl,signal:controller.signal,clock}),controller.signal);
  const call=url=>fetchImpl(url,{method:'GET',headers:{authorization:'Bearer '+session.token,'cache-control':'no-cache'},redirect:'manual',signal:controller.signal});
  const root=env.CHASS_DAILY_IMAGE_ROOT_FOLDER_ID,folders=await listing(call,root,` and mimeType = 'application/vnd.google-apps.folder' and name contains '${date}'`),selected=[];
  const seen=new Set();
  for(const folder of folders){const m=folder.name?.match(/^NAR_指数画像_(\d{4}-\d{2}-\d{2})_([^_]+)$/);if(!m||m[1]!==date||!venues[m[2]])continue;if(!validId(folder.id)||seen.has(m[2]))fail('IMAGE_FOLDER_AMBIGUOUS');seen.add(m[2]);selected.push({folder,track:m[2],code:venues[m[2]]});}
  if(!selected.length)fail('IMAGE_DAY_FOLDER_NOT_FOUND');
  if(selected.length>14)fail('IMAGE_FOLDER_LIMIT');
  for(const {folder,track,code:venue} of selected){
   const base={raceDate:date,track,code:venue};
   const official=async url=>decode(await bytes(await fetchImpl(url,{method:'GET',headers:{accept:'text/html'},redirect:'manual',signal:controller.signal}),1000000));
   const listHtml=await official(officialUrl(base,'RaceList')),meeting=parseNarRaceList(listHtml,{track,date});
   if(meeting.status!=='meeting'||!meeting.raceNumbers.length||meeting.raceNumbers.length>12){report.issues.push({reason:'IMAGE_OFFICIAL_MEETING_UNCONFIRMED',track});continue;}
   const images=await listing(call,folder.id),tasks=meeting.raceNumbers;
   report.expectedRaceCount+=tasks.length;
   for(const raceNo of tasks){
    const race={...base,raceNo},raceId=`${date}|${track}|${raceNo}`,name=`${date}_${track}_${String(raceNo).padStart(2,'0')}R_タイム指数.png`,matches=images.filter(f=>f.name===name&&f.mimeType==='image/png');
    try{
     if(controller.signal.aborted)fail('IMAGE_JOB_TIMEOUT');
     if(meeting.changes?.some(c=>c.raceNo===raceNo))fail('IMAGE_OFFICIAL_RUNNER_CHANGE_REQUIRES_REVIEW');
     if(matches.length!==1||!validId(matches[0].id))fail('IMAGE_RACE_FILE_MISSING_OR_DUPLICATE');report.imageFileCount++;
     const rawCard=await official(cpsiProducerCardUrl(race)),roster=officialRosterForOcr(rawCard);
     const currentHeader=rawCard.slice(rawCard.search(/<h4\b/i),rawCard.search(/<tr\b[^>]*class=["'][^"']*\btBorder\b/i));
     if(!/ダート\s*[0-9０-９]+\s*[mｍ]/.test(currentHeader))fail('IMAGE_OFFICIAL_DIRT_RACE_REQUIRED');
     await extractNarOfficialHistoryLinks(rawCard,{sourceUrl:cpsiProducerCardUrl(race),date,track,code:venue,raceNo,observedAt:new Date(clock()).toISOString(),expectedHorses:roster});
     const imageInfo=await readPng(matches[0],folder.id,call);
     report.imageOcrAttempted=true;
     if(controller.signal.aborted)fail('IMAGE_JOB_TIMEOUT');
     const vision=await fetchImpl('https://vision.googleapis.com/v1/images:annotate',{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':env.CHASS_DAILY_VISION_API_KEY},redirect:'manual',signal:controller.signal,body:JSON.stringify({requests:[{image:{content:b64(imageInfo.image)},features:[{type:'DOCUMENT_TEXT_DETECTION'}],imageContext:{languageHints:['ja']}}]})});
     const ocrRaw=decode(await bytes(vision,650000)),compact=compactVisionWords(JSON.parse(ocrRaw));
     if(compact.width!==imageInfo.width||compact.height!==imageInfo.height)fail('IMAGE_DIMENSION_MISMATCH');
     const parsed=parseNarIndexImage(compact,{race,expectedHorses:roster});
     const packet=await createImageResearchInput({parsed,rawCard,acquireFreshCard:()=>official(cpsiProducerCardUrl(race)),ocrRaw,imageInfo,clock});
     await verifyImageResearchInput(packet,{now:clock()});
     if(clock()>=Date.parse(packet.body.root.race.metricInputFreeze.postAt))fail('IMAGE_COMPLETED_AFTER_START');
     const raw=JSON.stringify(packet);if(new TextEncoder().encode(raw).length>900000)fail('IMAGE_RECEIPT_TOO_LARGE');
     if(controller.signal.aborted)fail('IMAGE_JOB_TIMEOUT');
     await db.prepare('INSERT INTO chass_daily_image_inputs (job_id,race_id,packet_json) VALUES (?,?,?)').bind(jobId,raceId,raw).run();
     const back=await db.prepare('SELECT packet_json FROM chass_daily_image_inputs WHERE job_id=? AND race_id=?').bind(jobId,raceId).first();
     if(back?.packet_json!==raw)fail('IMAGE_READBACK_MISMATCH');await verifyImageResearchInput(JSON.parse(back.packet_json),{now:clock()});
     if(clock()>=Date.parse(packet.body.root.race.metricInputFreeze.postAt))fail('IMAGE_READBACK_AFTER_START');
     report.rows.push({root:packet.body.root,sourceRef:'image-intake:'+packet.contentHash});report.readbackVerifiedCount++;
    }catch(e){report.issues.push({raceId,reason:code(e)});}
   }
  }
  report.status=report.rows.length&&report.issues.length===0?'INPUTS_READY':report.rows.length?'PARTIAL':'HOLD';
 }catch(e){report.issues.push({reason:code(e)});}
 finally{clearTimeout(timer);}
 if(claimed){const {rows,...summary}=report;await db.prepare('UPDATE chass_daily_image_jobs SET status=?,report_json=?,completed_at=? WHERE job_id=? AND status=?').bind(report.status,JSON.stringify(summary),new Date(clock()).toISOString(),jobId,'RUNNING').run();const back=await db.prepare('SELECT status,report_json FROM chass_daily_image_jobs WHERE job_id=?').bind(jobId).first();if(back?.status!==report.status||back.report_json!==JSON.stringify(summary))return {...report,status:'HOLD',rows:[],issues:[...report.issues,{reason:'IMAGE_JOB_READBACK_MISMATCH'}]};}
 return report;
}
