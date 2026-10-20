import {mkdir,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {Browser,detectBrowserPlatform,install} from '@puppeteer/browsers';
import {BROWSER_CONFIG,browserCacheDir,probeChrome,resolveChrome} from './browser-runtime.mjs';
try{
 const args=process.argv.slice(2);if(args.some(x=>!['--install-deps','--headless-shell'].includes(x)))throw Error('Usage: npm run browser:install [-- --install-deps | --headless-shell]');
 const kind=args.includes('--headless-shell')?Browser.CHROMEHEADLESSSHELL:Browser.CHROME;
 if(kind===Browser.CHROMEHEADLESSSHELL&&args.includes('--install-deps'))throw Error('--install-deps is supported for full Chrome only.');
 const platform=detectBrowserPlatform();if(!platform)throw Error('Unsupported Chrome for Testing platform; set CHASS_CHROME_PATH to an existing Chrome.');
 const cacheDir=browserCacheDir();await mkdir(cacheDir,{recursive:true});
 console.log(`Installing Chrome for Testing ${BROWSER_CONFIG.chromeVersion} (${platform}, ${kind})`);
 const browser=await install({browser:kind,buildId:BROWSER_CONFIG.chromeVersion,platform,cacheDir,installDeps:args.includes('--install-deps')});
 const version=probeChrome(browser.executablePath);
 if(!version.includes(BROWSER_CONFIG.chromeVersion))throw Error('Installed Chrome version does not match the pinned version.');
 const manifest={schemaVersion:1,browser:kind,buildId:BROWSER_CONFIG.chromeVersion,platform,executable:path.relative(cacheDir,browser.executablePath)},temporary=path.join(cacheDir,`runtime-${process.pid}.tmp`);
 try{await writeFile(temporary,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});await rename(temporary,path.join(cacheDir,'runtime.json'));}finally{await rm(temporary,{force:true});}
 // Resolve through the same managed route as tests, independently of system/PATH overrides.
 const selected=resolveChrome({env:{PATH:''},platform:process.platform,cacheDir});console.log(`${selected.version}\nInstalled: ${selected.executable}\nRun npm run browser:check to verify actual headless rendering.`);
}catch(error){console.error(`Chrome setup failed: ${error.message}\nFor missing Linux libraries, rerun explicitly with --install-deps or use an existing Chrome via CHASS_CHROME_PATH.`);process.exitCode=1;}
