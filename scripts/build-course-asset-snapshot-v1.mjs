import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, basename} from 'node:path';

const VERSION='CHASS_V2220_COURSE_ASSET_RUNTIME_V1';
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');

function argsOf(argv){
  const out=new Map();
  if(argv.length!==8)return null;
  for(let i=0;i<argv.length;i+=2){if(!['--geometry','--distance','--coverage','--out'].includes(argv[i])||!argv[i+1]||out.has(argv[i]))return null;out.set(argv[i],argv[i+1]);}
  return out;
}

const args=argsOf(process.argv.slice(2));
if(!args||!args.get('--geometry')||!args.get('--distance')||!args.get('--coverage')||!args.get('--out')){
  console.error('usage: node scripts/build-course-asset-snapshot-v1.mjs --geometry <csv> --distance <csv> --coverage <csv> --out <dir>');
  process.exit(2);
}
const out=resolve(args.get('--out'));
await mkdir(out,{recursive:true});
const specs=[
  ['geometry',args.get('--geometry'),'course-geometry-v1.csv','STATIC_CANONICAL'],
  ['distanceProfiles',args.get('--distance'),'course-distance-profile-v1.csv','STATIC_CANONICAL'],
  ['coverage',args.get('--coverage'),'course-sample-coverage-v1.csv','SHADOW_GUARD_ONLY']
];
const assets={};
for(const [key,source,file,runtimeUse] of specs){
  const text=await readFile(source,'utf8');
  if(!text.trim())throw Error(`empty input: ${source}`);
  await copyFile(source,resolve(out,file));
  assets[key]={file,sha256:sha(text),runtimeUse,bundled:true,sourceFile:basename(source)};
}
assets.historicalRaw={bundled:false,runtimeUse:'FORBIDDEN',sourceTab:'CHASS_COURSE_HIST_SAMPLE_V1',reason:'POST result-bearing runner ledger is research-only; never bundled into PRE runtime snapshot.'};
assets.frameAggregate={bundled:false,runtimeUse:'FORBIDDEN',sourceTab:'CHASS_COURSE_FRAME_AGG_V1',reason:'Historical SHADOW aggregate remains in Drive authority until separate promotion gate.'};
assets.biasShadow={bundled:false,runtimeUse:'FORBIDDEN',sourceTab:'CHASS_COURSE_BIAS_SHADOW_V1',reason:'SHADOW-only, no fixed PRE coefficient.'};
assets.forwardJoin={bundled:false,runtimeUse:'FORBIDDEN',sourceTab:'CHASS_COURSE_FORWARD_JOIN_V1',reason:'VALIDATION_ONLY'};
assets.forwardReadiness={bundled:false,runtimeUse:'FORBIDDEN',sourceTab:'CHASS_COURSE_FORWARD_READINESS_V1',reason:'VALIDATION_ONLY'};
const manifest={
  version:VERSION,mode:'STATIC_SNAPSHOT_SHADOW',generatedAt:new Date().toISOString(),
  source:{spreadsheetId:'CALLER_SUPPLIED_CSV_ORIGIN_UNVERIFIED',title:'Local CSV snapshot; Drive source not authenticated',tabs:['CHASS_COURSE_PROFILE_V1','CHASS_COURSE_DISTANCE_PROFILE_V1','CHASS_COURSE_SAMPLE_COVERAGE_V1']},
  policy:{productionDriveDirectRead:false,resultLeakageAllowed:false,validationOnlyLeakageAllowed:false,unknownIsNegative:false,longFirstTurnImpliesSlow:false},assets
};
await writeFile(resolve(out,'course-asset-manifest-v1.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
console.log(JSON.stringify({status:'PASS',out,assets:Object.keys(assets),version:VERSION},null,2));
