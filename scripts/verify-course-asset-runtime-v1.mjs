import {loadCourseAssets, resolveCourseContextFromAssets} from '../src/research/course-asset-runtime-v1.mjs';

const assets=await loadCourseAssets();
const tok=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'東京',surface:'芝',distance:1600,layout:'標準',railVariant:'A'});
const son=resolveCourseContextFromAssets(assets,{organizer:'NAR',venue:'園田',surface:'ダート',distance:1400,layout:'標準',railVariant:'NA'});
const nii=resolveCourseContextFromAssets(assets,{organizer:'JRA',venue:'新潟',surface:'芝',distance:1400});
const obi=resolveCourseContextFromAssets(assets,{organizer:'NAR',venue:'帯広',surface:'ばんえい',distance:200,layout:'直線',railVariant:'NA'});
const pass = assets.integrity==='PASS'
  && tok.status==='READY' && tok.distanceProfile.firstTurnDistanceM===540
  && son.status==='DEGRADED_TERMINAL' && son.reasons.includes('COURSE_START_DETAIL_PENDING')
  && nii.status==='HOLD' && nii.reasons.includes('COURSE_PROFILE_IDENTITY_AMBIGUOUS')
  && obi.status==='SPECIALIST_CONTEXT' && obi.genericFlatPaceEligible===false;
const report={
  version:assets.version,status:pass?'PASS':'FAIL',
  counts:{geometry:assets.geometry.length,distanceProfiles:assets.profiles.length},
  tokyoTurf1600:{status:tok.status,profile:tok.courseProfileId,firstTurnM:tok.distanceProfile.firstTurnDistanceM,straightM:tok.geometry.finishStraightM,frontPressureCue:tok.paceHandoff.frontPressureGeometryCue},
  sonodaDirt1400:{status:son.status,profile:son.courseProfileId,reasons:son.reasons},
  niigataTurf1400WithoutLayout:{status:nii.status,reasons:nii.reasons,candidates:nii.candidateProfileIds},
  obihiroBanei200:{status:obi.status,profile:obi.courseProfileId,genericFlatPaceEligible:obi.genericFlatPaceEligible},
  historicalSupport:{coefficientsPromoted:false,rawHistoricalRunnerDataBundled:false,validationOnlyAssetsBundled:false}
};
console.log(JSON.stringify(report,null,2));
process.exitCode=pass?0:1;
