#!/usr/bin/env node
/** Read-only verifier for downloaded daily reference JSON. */
import {readFile,stat} from 'node:fs/promises';
import {verifyDailyReference} from '../src/prediction/daily-drive-archive-v1.mjs';
try{
 if(process.argv.length!==3)throw Error('USAGE: node scripts/verify-daily-reference-v1.mjs <reference.json>');
 const path=process.argv[2],s=await stat(path);if(!s.isFile()||s.size>4*1024*1024)throw Error('DAILY_ARCHIVE_TOO_LARGE');
 const packet=await verifyDailyReference(JSON.parse(await readFile(path,'utf8')));
 process.stdout.write(JSON.stringify({status:'LOCAL_REFERENCE_VERIFIED',date:packet.body.date,raceCount:packet.body.races.length,contentHash:packet.contentHash,researchOnly:true,sourceOriginAuthenticated:false,formalKpiEligible:false})+'\n');
}catch(e){process.stderr.write((/^DAILY_ARCHIVE_[A-Z_]+$/.test(e.code||e.message||'')?(e.code||e.message):'DAILY_ARCHIVE_VERIFICATION_FAILED')+'\n');process.exitCode=1;}
