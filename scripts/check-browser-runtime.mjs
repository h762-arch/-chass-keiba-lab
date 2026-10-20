import {resolveChrome,probeChromeRender} from './browser-runtime.mjs';
try{const browser=resolveChrome();probeChromeRender(browser.executable);console.log(`${browser.version}\nHeadless render: PASS\nSource: ${browser.source}\nExecutable: ${browser.executable}`);}catch(error){console.error(error.message);process.exitCode=1;}
