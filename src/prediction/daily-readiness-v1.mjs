/** Authenticated operator view: presence and table reads only, never values. */
export async function dailyReadiness(env={}){
 const checks=[],add=(key,label,present)=>checks.push({key,label,present:!!present});
 const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{10,160}$/.test(x);
 add('ENABLE_DAILY_ANALYSIS_V1','日次分析の有効化',env.ENABLE_DAILY_ANALYSIS_V1==='true');
 add('ENABLE_CPSI_DRIVE_READ','Drive読取の有効化',env.ENABLE_CPSI_DRIVE_READ==='true');
 let sa,oauth;try{sa=JSON.parse(env.CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON||'');}catch{}try{oauth=JSON.parse(env.CHASS_DAILY_DRIVE_OAUTH_JSON||'');}catch{}
 add('CHASS_CPSI_DRIVE_SERVICE_ACCOUNT_JSON','Drive読取用サービスアカウント',sa?.type==='service_account'&&typeof sa.client_email==='string'&&typeof sa.private_key==='string');
 add('ENABLE_DAILY_IMAGE_INTAKE_V1','保存画像の自動読取',env.ENABLE_DAILY_IMAGE_INTAKE_V1==='true');
 add('CHASS_DAILY_IMAGE_ROOT_FOLDER_ID','指数画像の親フォルダ',id(env.CHASS_DAILY_IMAGE_ROOT_FOLDER_ID));
 add('CHASS_DAILY_VISION_API_KEY','Google Visionの接続設定',/^[-A-Za-z0-9_]{20,256}$/.test(env.CHASS_DAILY_VISION_API_KEY||''));
 add('ENABLE_DAILY_DRIVE_ARCHIVE_V1','分析結果のDrive保存',env.ENABLE_DAILY_DRIVE_ARCHIVE_V1==='true');
 add('CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID','分析結果の保存フォルダ',id(env.CHASS_DAILY_DRIVE_OUTPUT_FOLDER_ID));
 add('CHASS_DAILY_DRIVE_OAUTH_JSON','Drive書込用OAuth設定',['client_id','client_secret','refresh_token'].every(k=>typeof oauth?.[k]==='string'&&oauth[k].length>5));
 for(const [table,label] of Object.entries({chass_daily_analysis_jobs:'日次ジョブ保存',chass_daily_analysis_runs:'日次結果保存',chass_daily_drive_archives:'Drive保存確認記録',chass_daily_image_jobs:'画像取得ジョブ保存',chass_daily_image_inputs:'画像取得証跡保存'})){
  let present=false;try{await env.DB.prepare('SELECT 1 FROM '+table+' LIMIT 1').first();present=true;}catch{}add(table,label,present);
 }
 return {format:'CHASS_DAILY_READINESS_V1',status:checks.every(c=>c.present)?'CONFIG_PRESENT_LIVE_UNVERIFIED':'SETUP_REQUIRED',checks,missing:checks.filter(c=>!c.present).map(c=>({key:c.key,label:c.label})),credentialConnectivityVerified:false,liveImageAccuracyVerified:false,researchOnly:true,formalKpiEligible:false,outstanding:['LIVE_OCR_AND_GOOGLE_READBACK_UNVERIFIED','OFFICIAL_LIVE_ODDS_NOT_CONNECTED','FAVORITE_PROBABILITY_NOT_CALIBRATED','FORMAL_SOURCE_AUTHENTICATION_UNVERIFIED']};
}
