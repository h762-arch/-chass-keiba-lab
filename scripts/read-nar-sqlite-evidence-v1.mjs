import {pathToFileURL} from 'node:url';
import {readNarSqliteEvidenceV1} from '../src/research/nar-sqlite-evidence-reader-v1.mjs';

export async function readNarSqliteEvidenceCliV1(args){
 if(!Array.isArray(args)||args.length!==4||args[0]!=='--db'||typeof args[1]!=='string'||args[2]!=='--race-id'||typeof args[3]!=='string')return {status:'HOLD',reason:'EXPLICIT_DB_AND_RACE_REQUIRED',formalReadiness:'HOLD',formalKpiEligible:false,productionEvidenceVerified:false,probabilityDecision:'MODEL_HOLD',productionActivationDecision:'NO-GO'};
 return readNarSqliteEvidenceV1(JSON.stringify({dbPath:args[1],raceId:args[3]}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await readNarSqliteEvidenceCliV1(process.argv.slice(2));process.stdout.write(JSON.stringify(r,null,2)+'\n');process.exitCode=r.status==='CONTENT_READ_AND_MATCHED'?0:1;}
