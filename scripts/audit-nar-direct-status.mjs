import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {auditNarDirectStatus} from '../src/research/nar-direct-status-audit.mjs';

export async function runNarDirectStatusAuditCli(args){
 if(args.length!==4||args[0]!=='--capture'||!args[1]||args[2]!=='--date'||!/^\d{4}-\d{2}-\d{2}$/.test(args[3])||/^[a-z]+:\/\//i.test(args[1]))throw Error('CLI_ARGUMENTS_INVALID');
 const file=await stat(args[1]);if(!file.isFile()||file.size>1000000)throw Error('CAPTURE_FILE_INVALID');
 const bytes=await readFile(args[1]);if(bytes.length>1000000)throw Error('CAPTURE_FILE_INVALID');
 const capture=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 return auditNarDirectStatus(capture,{expectedDate:args[3]});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const report=await runNarDirectStatusAuditCli(process.argv.slice(2));console.log(JSON.stringify(report,null,2));if(report.status==='HOLD')process.exitCode=1;}
 catch{console.error('DIRECT_STATUS_AUDIT_FAILED');process.exitCode=1;}
}
