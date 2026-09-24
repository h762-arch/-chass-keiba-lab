import {calculateJraAbility} from './jra-ability-core.mjs';
import {projectJraAbilityResult} from './jra-ability-result-projector.mjs';

const text=value=>value==null?'':String(value).trim();
const numberOrNull=value=>{
 if(value==null||text(value)==='')return null;
 const n=Number(text(value).replace(/[^0-9+.-]/g,''));
 return Number.isFinite(n)?n:null;
};
const seconds=value=>{
 if(value==null)return null;
 if(Number.isFinite(Number(value)))return Number(value);
 const m=text(value).match(/^(?:(\d+):)?(\d{1,2})(?:\.(\d))?$/);
 return m?Number(m[1]||0)*60+Number(m[2])+Number(m[3]||0)/10:null;
};
const surface=value=>/ダ|dirt/i.test(text(value))?'ダート':/芝|turf/i.test(text(value))?'芝':'';
const condition=value=>{const s=text(value);return /稍/.test(s)?'稍重':/不良/.test(s)?'不良':/^重$|重馬場/.test(s)?'重':/良/.test(s)?'良':s||'不明'};
const corners=value=>{
 const raw=Array.isArray(value)?value:text(value).split(/[-→>\s]+/);
 return raw.map(v=>typeof v==='string'?v.trim():v).filter(v=>v!==''&&v!=null).map(Number).filter(n=>Number.isInteger(n)&&n>0);
};

// Explicitly select ability fields: arbitrary SOURCE metadata never enters Core.
export function projectJraAbilityInput(source){
 if(!source?.race||!Array.isArray(source.horses))throw new TypeError('invalid_jra_source');
 const race=source.race;
 const projectedRace={
  date:text(race.date??race.raceDate).replaceAll('/','-'),racecourse:text(race.racecourse??race.track),
  raceNo:numberOrNull(race.raceNo??race.race_no),raceName:text(race.raceName),
  surface:surface(race.surface),distance:numberOrNull(race.distance),
  courseType:text(race.courseType),trackCondition:condition(race.trackCondition??race.condition),
  weather:text(race.weather),pace:text(race.pace)||'標準',direction:text(race.direction),
  straightLength:numberOrNull(race.straightLength),hasSlope:race.hasSlope==null?null:!!race.hasSlope,
  turnSize:text(race.turnSize),cornerCount:numberOrNull(race.cornerCount),raceClass:text(race.raceClass??race.class)
 };
 const horses=source.horses.map((horse,index)=>{
  if(!['active','scratched','excluded'].includes(horse?.runningStatus))throw new TypeError('invalid_official_running_status');
  if(!Array.isArray(horse.pastRuns))throw new TypeError('invalid_jra_past_runs');
  const horseNo=numberOrNull(horse.horseNo??horse.horse_no);
  if(!Number.isInteger(horseNo)||horseNo<1||horseNo>99)throw new TypeError('invalid_jra_horse_no');
  return {
   horseNo,horseName:text(horse.horseName??horse.name),runningStatus:horse.runningStatus,
   sexAge:text(horse.sexAge),weightCarried:numberOrNull(horse.weightCarried),
   driveIndexSignal:numberOrNull(horse.driveIndexSignal),
   driveIndexEvidenceCount:numberOrNull(horse.driveIndexEvidenceCount),
   driveClusterStrength:numberOrNull(horse.driveClusterStrength),
   pastRuns:horse.pastRuns.map(run=>({
    date:text(run.date??run.raceDate).replaceAll('/','-'),racecourse:text(run.racecourse??run.track),
    surface:surface(run.surface),distance:numberOrNull(run.distance),
    trackCondition:condition(run.trackCondition??run.condition),raceClass:text(run.raceClass??run.class),
    finish:numberOrNull(run.finish??run.position),fieldSize:numberOrNull(run.fieldSize),
    timeSeconds:numberOrNull(run.timeSeconds??run.time_seconds)??seconds(run.time??run.raceTime),
    margin:numberOrNull(run.margin),cornerPositions:corners(run.cornerPositions??run.corners),
    last3F:numberOrNull(run.last3F??run.last3f),weightCarried:numberOrNull(run.weightCarried??run.weight)
   }))
  };
 }).sort((a,b)=>a.horseNo-b.horseNo);
 const active=horses.filter(h=>h.runningStatus==='active');
 if(active.length<2)throw new TypeError('no_active_jra_runners');
 if(new Set(horses.map(h=>h.horseNo)).size!==horses.length)throw new TypeError('duplicate_jra_horse_no');
 return {race:projectedRace,horses};
}

// Caller retains model/calculation version ownership. No market or clock data is emitted.
export function calculateJraData(source){
 const input=projectJraAbilityInput(source);
 const core=calculateJraAbility(input,{officialSource:true});
 const horses=projectJraAbilityResult(core).map(({dataMode,...horse})=>horse);
 return {schemaVersion:'JRA-ABILITY-DATA-1',raceType:'JRA',race:input.race,horses,
  quality:{horseCount:horses.length,simulationIterations:12000,withTime:horses.filter(h=>h.predictedTime).length}};
}
