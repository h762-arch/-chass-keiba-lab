export const NAR_HISTORY_INTERPRETATION_VERSION='NAR_HISTORY_INTERPRETATION_V1';
const fail=reason=>{throw new TypeError(reason);};
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const positive=value=>finite(value)>0?value:null;
const integer=value=>Number.isInteger(value)&&value>0;
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)
  &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const surface=value=>['ダ','ダート','dirt'].includes(value)?'dirt':['芝','turf'].includes(value)?'turf':null;
const going=value=>['良','稍重','重','不良'].includes(value)?value:'UNKNOWN';
const round=value=>finite(value)===null?null:Math.round(value*1000)/1000;
function median(values){
  const a=values.filter(v=>finite(v)!==null).sort((a,b)=>a-b);
  return !a.length?null:round(a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2);
}
function seconds(value){
  if(positive(value)!==null)return value;
  const match=typeof value==='string'&&value.match(/^(\d+):(\d{2}(?:\.\d+)?)$/);
  const result=match&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):null;
  return positive(result);
}
function resultSummary(rows){
  const results=rows.filter(r=>r.finish!==null);
  return {runCount:rows.length,validResultCount:results.length,
    wins:results.length?results.filter(r=>r.finish===1).length:null,
    top3:results.length?results.filter(r=>r.finish<=3).length:null,
    medianFinish:median(results.map(r=>r.finish)),
    medianFinishFraction:median(results.map(r=>(r.finish-1)/(r.fieldSize-1))),
    refs:rows.map(r=>r.ref)};
}
function groupedSummary(rows,field){
  const groups=new Map();
  for(const row of rows)if(row[field]!==null){
    if(!groups.has(row.going))groups.set(row.going,[]);
    groups.get(row.going).push(row);
  }
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([going,items])=>({
    going,sampleCount:items.length,median:median(items.map(r=>r[field])),
    minimum:Math.min(...items.map(r=>r[field])),maximum:Math.max(...items.map(r=>r[field])),
    refs:items.map(r=>r.ref),comparableToCurrentGoing:going!=='UNKNOWN'}));
}

// Descriptive interpretation only. No ratings, fitted weights, race-flow forecast or signal assignment.
export function buildNarHistoryInterpretation({race,horse}={}){
  if(!date(race?.date)||typeof race.racecourse!=='string'||!race.racecourse.trim()
    ||positive(race.distance)===null||surface(race.surface)!=='dirt')fail('NAR_HISTORY_RACE_CONTEXT_INVALID');
  if(!Array.isArray(horse?.pastRuns)||horse.pastRuns.length>10)fail('NAR_HISTORY_BOUNDED_INPUT_REQUIRED');
  if(horse.pastRuns.some(r=>!date(r?.date)||r.date>=race.date))fail('NAR_HISTORY_CURRENT_OR_FUTURE');
  const excluded={surfaceMissing:0,otherSurface:0};
  const records=[];
  horse.pastRuns.forEach((run,historyIndex)=>{
    const s=surface(run.surface);
    if(!s){excluded.surfaceMissing++;return;}
    if(s!=='dirt'){excluded.otherSurface++;return;}
    const fieldSize=integer(run.fieldSize)&&run.fieldSize>1?run.fieldSize:null;
    const finish=fieldSize&&integer(run.finish)&&run.finish<=fieldSize?run.finish:null;
    const timeSec=seconds(run.time),last3F=positive(run.last3F);
    // First retained passage is not proof of first-corner / early-race position.
    const passage=Array.isArray(run.cornerPositions)&&fieldSize&&run.cornerPositions.length
      &&run.cornerPositions.every(p=>integer(p)&&p<=fieldSize)?[...run.cornerPositions]:[];
    records.push({date:run.date,course:typeof run.racecourse==='string'?run.racecourse:null,
      distance:positive(run.distance),going:going(run.trackCondition),fieldSize,finish,timeSec,
      last3F:last3F!==null&&(timeSec===null||last3F<timeSec)?last3F:null,passage,
      ref:{historyIndex,date:run.date,course:run.racecourse??null,distance:positive(run.distance)}});
  });
  records.sort((a,b)=>b.date.localeCompare(a.date)||a.ref.historyIndex-b.ref.historyIndex);
  const sameCourse=records.filter(r=>r.course===race.racecourse);
  const sameDistance=records.filter(r=>r.distance===race.distance);
  const exact=sameCourse.filter(r=>r.distance===race.distance);
  const clockGroups=groupedSummary(exact,'timeSec'),closingGroups=groupedSummary(exact,'last3F');
  const targetGoing=going(race.trackCondition);
  for(const group of [...clockGroups,...closingGroups])group.comparableToCurrentGoing=
    targetGoing!=='UNKNOWN'&&group.going===targetGoing;
  const positionRows=exact.filter(r=>r.passage.length>=2&&r.finish!==null);
  const position={sampleCount:positionRows.length,meaning:'FIRST_RECORDED_PASSAGE_NOT_FIRST_CORNER',
    observations:positionRows.map(r=>({ref:r.ref,fieldSize:r.fieldSize,
      firstRecorded:r.passage[0],lastRecorded:r.passage.at(-1),finish:r.finish,
      firstToLastGain:r.passage[0]-r.passage.at(-1),lastToFinishGain:r.passage.at(-1)-r.finish})),
    medianFirstToLastGain:median(positionRows.map(r=>r.passage[0]-r.passage.at(-1))),
    medianLastToFinishGain:median(positionRows.map(r=>r.passage.at(-1)-r.finish))};
  const counterEvidence=[];
  const add=(condition,code,detail)=>{if(condition)counterEvidence.push({code,detail});};
  add(!records.length,'NO_USABLE_DIRT_HISTORY',{excluded});
  add(!sameCourse.length,'NO_SAME_COURSE_HISTORY',{course:race.racecourse});
  add(!sameDistance.length,'NO_EXACT_DISTANCE_HISTORY',{distance:race.distance});
  add(!exact.length,'NO_EXACT_COURSE_DISTANCE_HISTORY',{});
  add(targetGoing==='UNKNOWN','CURRENT_GOING_UNCONFIRMED',{});
  add(!clockGroups.some(g=>g.comparableToCurrentGoing),'NO_CURRENT_GOING_CLOCK_REFERENCE',{targetGoing});
  add(!closingGroups.some(g=>g.comparableToCurrentGoing),'NO_CURRENT_GOING_LAST3F_REFERENCE',{targetGoing});
  add(!positionRows.length,'POSITION_OR_RESULT_SAMPLE_MISSING',{});
  add(records.some(r=>r.finish===null),'RESULT_DENOMINATOR_MISSING_OR_INVALID',{});
  add(clockGroups.some(g=>g.sampleCount===1)||closingGroups.some(g=>g.sampleCount===1),'SINGLE_OBSERVATION_NOT_GENERALIZED',{});
  return {version:NAR_HISTORY_INTERPRETATION_VERSION,horseKey:horse.horseKey??null,horseNo:horse.horseNo??null,
    context:{date:race.date,course:race.racecourse,distance:race.distance,surface:'dirt',going:targetGoing},
    historicalRunCount:horse.pastRuns.length,usableDirtRunCount:records.length,excluded,
    recent:resultSummary(records.slice(0,5)),sameCourse:resultSummary(sameCourse),
    sameDistance:resultSummary(sameDistance),exactCourseDistance:resultSummary(exact),
    clock:{groups:clockGroups,distanceAdjustment:'NONE',goingAdjustment:'NONE'},
    closingSpeed:{groups:closingGroups,paceAdjustment:'NONE'},position,counterEvidence,
    reviewStatus:'INTERPRETED_RESEARCH_ONLY',probabilityDriver:false,markDriver:false,
    unassessed:['pace_fit','class_equivalence','current_ability','pressure','pedigree','jockey_intent','market_value'],
    researchOnly:true,formalKpiEligible:false,productionActivationReady:false,signalStatus:'NOT_GENERATED'};
}
