import {accessSync,constants,mkdtempSync,readFileSync,realpathSync,rmSync,statSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
export const BROWSER_ROOT=fileURLToPath(new URL('../',import.meta.url));
export const BROWSER_CONFIG=JSON.parse(readFileSync(new URL('../config/browser-runtime.json',import.meta.url),'utf8'));
export function browserCacheDir(env=process.env){return path.resolve(env.CHASS_BROWSER_CACHE_DIR||path.join(BROWSER_ROOT,'.cache/chass-browser'));}
const fail=code=>Object.assign(new Error(`${code}: Run npm run browser:install or set CHASS_CHROME_PATH to a working Chrome executable.`),{code});
export function probeChrome(executable){
 const result=spawnSync(executable,['--version'],{encoding:'utf8',timeout:5000,windowsHide:true,maxBuffer:65536});
 const version=String(result.stdout||'').trim();
 if(result.error||result.status!==0||!/(?:Google Chrome|Chromium|Chrome for Testing)\s+\d+\./i.test(version))throw fail('CHASS_CHROME_UNUSABLE');
 return version;
}
export function probeChromeRender(executable){
 const profile=mkdtempSync(path.join(tmpdir(),'chass-chrome-check-'));
 try{
  const result=spawnSync(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--user-data-dir=${profile}`,'--dump-dom','data:text/html,<p id="chass-browser-check">CHASS_CHROME_RENDER_OK</p>'],{encoding:'utf8',timeout:15000,killSignal:'SIGKILL',windowsHide:true,maxBuffer:262144});
  if(result.error||result.status!==0||!String(result.stdout||'').includes('CHASS_CHROME_RENDER_OK'))throw Object.assign(new Error(`CHASS_CHROME_LAUNCH_FAILED: ${result.error?.message||String(result.stderr||result.signal||result.status).slice(0,500)}. For restricted containers try npm run browser:install -- --headless-shell; browser tests are still required.`),{code:'CHASS_CHROME_LAUNCH_FAILED'});
  return true;
 }finally{rmSync(profile,{recursive:true,force:true});}
}
function executableFile(p){try{if(!statSync(p).isFile())return false;accessSync(p,constants.X_OK);return true;}catch{return false;}}
export function resolveChrome({env=process.env,platform=process.platform,cacheDir=browserCacheDir(env),probe=probeChrome}={}){
 for(const key of ['CHASS_CHROME_PATH','CHROME_BIN','PUPPETEER_EXECUTABLE_PATH'])if(env[key]){
  const executable=path.resolve(env[key]);if(!executableFile(executable))throw fail('CHASS_CHROME_CONFIGURED_PATH_INVALID');
  return {executable,version:probe(executable),source:key};
 }
 const names=platform==='win32'?['chrome.exe','chromium.exe']:['google-chrome','google-chrome-stable','chromium','chromium-browser'];
 const directories=String(env.PATH||'').split(path.delimiter).filter(Boolean),candidates=directories.flatMap(dir=>names.map(name=>path.join(dir,name)));
 if(platform==='darwin')candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium');
 if(platform==='win32')for(const dir of [env.PROGRAMFILES,env['PROGRAMFILES(X86)'],env.LOCALAPPDATA].filter(Boolean))candidates.push(path.join(dir,'Google/Chrome/Application/chrome.exe'));
 for(const executable of candidates)if(executableFile(executable)){try{return {executable,version:probe(executable),source:'system'};}catch{/* Try another installed executable, then the managed installation. */}}
 const manifestPath=path.join(cacheDir,'runtime.json');let manifest;
 try{if(statSync(manifestPath).size>4096)throw Error();manifest=JSON.parse(readFileSync(manifestPath,'utf8'));}catch(error){if(error.code==='ENOENT')throw fail('CHASS_CHROME_NOT_FOUND');throw fail('CHASS_CHROME_MANIFEST_INVALID');}
 if(manifest?.schemaVersion!==1||manifest.buildId!==BROWSER_CONFIG.chromeVersion||typeof manifest.executable!=='string'||path.isAbsolute(manifest.executable))throw fail('CHASS_CHROME_MANIFEST_INVALID');
 const executable=path.resolve(cacheDir,manifest.executable),inside=p=>{const relative=path.relative(realpathSync(cacheDir),p);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
 try{if(!inside(realpathSync(executable))||!executableFile(executable))throw Error();}catch{throw fail('CHASS_CHROME_MANAGED_PATH_INVALID');}
 const version=probe(executable);if(!version.includes(BROWSER_CONFIG.chromeVersion))throw fail('CHASS_CHROME_MANAGED_VERSION_MISMATCH');
 return {executable,version,source:'managed'};
}
