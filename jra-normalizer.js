(function(root){
'use strict';
const JRA_COURSES=Object.freeze(['札幌','函館','福島','新潟','東京','中山','中京','京都','阪神','小倉']);
const numberOrNull=value=>{if(value==null||String(value).trim()==='')return null;const n=Number(String(value).replace(/[^0-9+.-]/g,''));return Number.isFinite(n)?n:null};
const text=value=>value==null?'':String(value).trim();
const isoDate=value=>{const s=text(value).replaceAll('/','-');return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''};
const timeSeconds=value=>{if(Number.isFinite(Number(value)))return Number(value);const m=text(value).match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d))?$/);if(!m)return null;return Number(m[1]||0)*60+Number(m[2])+Number(m[3]||0)/10};
const corners=value=>Array.isArray(value)?value.map(Number).filter(Number.isFinite):text(value).split(/[-→>\s]+/).map(Number).filter(Number.isFinite);
function parseJsonMaybe(value,fallback=[]){if(Array.isArray(value))return value;if(!text(value))return fallback;try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:fallback}catch{return fallback}}
function normalizeSurface(value){const s=text(value);return /ダ|dirt/i.test(s)?'ダート':/芝|turf/i.test(s)?'芝':''}
function normalizeCondition(value){const s=text(value);if(/稍/.test(s))return '稍重';if(/不良/.test(s))return '不良';if(/^重$|重馬場/.test(s))return '重';if(/良/.test(s))return '良';return s||'不明'}
function normalizePastRun(run={}){
 const seconds=numberOrNull(run.timeSeconds??run.time_seconds)??timeSeconds(run.time??run.raceTime);
 return {date:isoDate(run.date??run.raceDate),racecourse:text(run.racecourse??run.track),surface:normalizeSurface(run.surface),distance:numberOrNull(run.distance),trackCondition:normalizeCondition(run.trackCondition??run.condition),raceClass:text(run.raceClass??run.class),finish:numberOrNull(run.finish??run.position),fieldSize:numberOrNull(run.fieldSize),time:text(run.time??run.raceTime),timeSeconds:seconds,margin:numberOrNull(run.margin),cornerPositions:corners(run.cornerPositions??run.corners),last3F:numberOrNull(run.last3F??run.last3f),weightCarried:numberOrNull(run.weightCarried??run.weight),bodyWeight:numberOrNull(run.bodyWeight),odds:numberOrNull(run.odds),popularity:numberOrNull(run.popularity),laps:{first3F:numberOrNull(run.first3F),fiveF:numberOrNull(run.fiveF),sevenF:numberOrNull(run.sevenF),nineF:numberOrNull(run.nineF),L3F:numberOrNull(run.L3F??run.last3F),L2F:numberOrNull(run.L2F),L1F:numberOrNull(run.L1F)}};
}
function normalizeHorse(horse={},index=0){
 const past=parseJsonMaybe(horse.pastRuns??horse.runs??horse.past_runs_json,[]).map(normalizePastRun);
 return {horseNo:numberOrNull(horse.horseNo??horse.horse_no)??index+1,frameNo:numberOrNull(horse.frameNo??horse.frame_no),horseName:text(horse.horseName??horse.horse_name??horse.name),sexAge:text(horse.sexAge??horse.sex_age),weightCarried:numberOrNull(horse.weightCarried??horse.weight_carried),jockey:text(horse.jockey),trainer:text(horse.trainer),odds:numberOrNull(horse.odds),popularity:numberOrNull(horse.popularity),bodyWeight:numberOrNull(horse.bodyWeight??horse.body_weight),bodyWeightChange:numberOrNull(horse.bodyWeightChange??horse.body_weight_change),pastRuns:past};
}
function normalizeRace(input={}){
 const source=input.race||input.meta||input;
 const racecourse=text(source.racecourse??source.track);
 return {date:isoDate(source.date??source.raceDate),racecourse,raceNo:numberOrNull(source.raceNo??source.race_no),raceName:text(source.raceName??source.race_name),surface:normalizeSurface(source.surface),distance:numberOrNull(source.distance),courseType:text(source.courseType??source.course_type),trackCondition:normalizeCondition(source.trackCondition??source.track_condition),weather:text(source.weather),pace:text(source.pace)||'標準',direction:text(source.direction),straightLength:numberOrNull(source.straightLength),hasSlope:source.hasSlope==null?null:!!source.hasSlope,turnSize:text(source.turnSize),cornerCount:numberOrNull(source.cornerCount),raceClass:text(source.raceClass??source.class)};
}
function validateNormalized(data){
 const errors=[],warnings=[];if(!data.race.date)errors.push('開催日が必要です。');if(!JRA_COURSES.includes(data.race.racecourse))errors.push('JRA競馬場を選択してください。');if(!Number.isInteger(data.race.raceNo)||data.race.raceNo<1||data.race.raceNo>12)errors.push('レース番号は1〜12Rです。');if(!data.race.surface)errors.push('芝・ダートを指定してください。');if(!data.race.distance)errors.push('距離が必要です。');if(data.horses.length<2)errors.push('出走馬は2頭以上必要です。');const seen=new Set();for(const h of data.horses){if(!h.horseName)errors.push(`${h.horseNo}番の馬名がありません。`);if(seen.has(h.horseNo))errors.push(`馬番${h.horseNo}が重複しています。`);seen.add(h.horseNo);if(!h.pastRuns.length)warnings.push(`${h.horseNo}番 ${h.horseName||'馬名不明'}：過去走なし`);if(h.odds==null)warnings.push(`${h.horseNo}番 ${h.horseName||'馬名不明'}：オッズなし`)}return {ok:!errors.length,errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}
function normalizeJraData(input={}){
 const race=normalizeRace(input),horses=(Array.isArray(input.horses)?input.horses:[]).map(normalizeHorse).sort((a,b)=>a.horseNo-b.horseNo),data={schemaVersion:'JRA-1.0',raceType:'JRA',race,horses,normalizedAt:new Date().toISOString()};data.validation=validateNormalized(data);return data;
}
function csvRows(csv){
 const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<String(csv).length;i++){const c=csv[i],next=csv[i+1];if(c==='"'&&quoted&&next==='"'){cell+='"';i++;continue}if(c==='"'){quoted=!quoted;continue}if(c===','&&!quoted){row.push(cell);cell='';continue}if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&next==='\n')i++;row.push(cell);cell='';if(row.some(x=>text(x)))rows.push(row);row=[];continue}cell+=c}row.push(cell);if(row.some(x=>text(x)))rows.push(row);return rows;
}
function csvToObjects(csv){const rows=csvRows(csv);if(rows.length<2)return [];const headers=rows[0].map(x=>text(x).replace(/^\uFEFF/,''));return rows.slice(1).map(row=>Object.fromEntries(headers.map((key,i)=>[key,row[i]??''])))}
function normalizeJraCsv(csv){
 const rows=csvToObjects(csv);if(!rows.length)return normalizeJraData({});const first=rows[0],horses=new Map();for(const row of rows){const no=numberOrNull(row.horse_no??row.horseNo);if(no==null)continue;let horse=horses.get(no);if(!horse){horse={horseNo:no,frameNo:row.frame_no,horseName:row.horse_name,sexAge:row.sex_age,weightCarried:row.weight_carried,jockey:row.jockey,trainer:row.trainer,odds:row.odds,popularity:row.popularity,bodyWeight:row.body_weight,bodyWeightChange:row.body_weight_change,pastRuns:parseJsonMaybe(row.past_runs_json,[])};horses.set(no,horse)}if(row.past_date||row.past_time||row.past_finish)horse.pastRuns.push({date:row.past_date,racecourse:row.past_racecourse,surface:row.past_surface,distance:row.past_distance,trackCondition:row.past_track_condition,raceClass:row.past_class,finish:row.past_finish,fieldSize:row.past_field_size,time:row.past_time,margin:row.past_margin,cornerPositions:row.past_corners,last3F:row.past_last3f,weightCarried:row.past_weight_carried,bodyWeight:row.past_body_weight,odds:row.past_odds,popularity:row.past_popularity})}
 return normalizeJraData({race:{date:first.race_date,racecourse:first.racecourse,raceNo:first.race_no,raceName:first.race_name,surface:first.surface,distance:first.distance,courseType:first.course_type,trackCondition:first.track_condition,weather:first.weather,raceClass:first.race_class},horses:[...horses.values()]});
}
function parseManualHorses(textValue){return csvToObjects(`horse_no,frame_no,horse_name,sex_age,weight_carried,jockey,trainer,odds,popularity,body_weight,body_weight_change,past_runs_json\n${textValue}`).map(row=>({horseNo:row.horse_no,frameNo:row.frame_no,horseName:row.horse_name,sexAge:row.sex_age,weightCarried:row.weight_carried,jockey:row.jockey,trainer:row.trainer,odds:row.odds,popularity:row.popularity,bodyWeight:row.body_weight,bodyWeightChange:row.body_weight_change,pastRuns:parseJsonMaybe(row.past_runs_json,[])}))}
root.CHASS_JRA_NORMALIZER={JRA_COURSES,normalizeJraData,normalizeJraCsv,normalizePastRun,validateNormalized,parseManualHorses,timeSeconds};
})(typeof window!=='undefined'?window:globalThis);
