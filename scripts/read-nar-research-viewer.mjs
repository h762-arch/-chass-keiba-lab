import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readAndAuditNarResearchViewer} from '../src/research/nar-research-viewer-readback.mjs';

export async function runNarResearchViewerReadbackCli(args){
 if(args.length!==6||args[0]!=='--bundle'||!args[1]||/^[a-z]+:\/\//i.test(args[1])||args[2]!=='--date'||!/^\d{4}-\d{2}-\d{2}$/.test(args[3])||args[4]!=='--slug'||!args[5])throw Error('READBACK_ARGUMENTS_INVALID');
 const info=await stat(args[1]);if(!info.isFile()||info.size>4*1024*1024)throw Error('READBACK_FILE_INVALID');
 const bytes=await readFile(args[1]);if(bytes.length>4*1024*1024)throw Error('READBACK_FILE_INVALID');
 const bundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 return readAndAuditNarResearchViewer(bundle,{expectedDate:args[3],slug:args[5]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const r=await runNarResearchViewerReadbackCli(process.argv.slice(2));console.log(JSON.stringify(r,null,2));if(r.status!=='VERIFIED')process.exitCode=1;}
 catch{console.error('RESEARCH_VIEWER_READBACK_FAILED');process.exitCode=1;}
}
