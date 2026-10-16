import {readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {validMirrorDate} from '../src/research/nar-status-mirror-audit.mjs';
import {auditNarCollectionRun} from '../src/research/nar-collection-run-audit.mjs';

export function runNarCollectionAuditCli(args, {now = Date.now()} = {}) {
  const hold = reason => ({status:'HOLD', reasonCodes:[reason], run:null,
    acquisitionCertified:false, formalKpiEligible:false, probabilityDecision:'MODEL_HOLD', productionActivationDecision:'NO-GO'});
  if (args.length !== 4 || args[0] !== '--bundle' || args[2] !== '--date' || !validMirrorDate(args[3])) return hold('CLI_ARGUMENTS_INVALID');
  try {
    const stat = statSync(args[1]);if (!stat.isFile() || stat.size > 1000000) return hold('BUNDLE_READ_UNAVAILABLE');
    const bytes = readFileSync(args[1]);if (bytes.byteLength > 1000000) return hold('BUNDLE_READ_UNAVAILABLE');
    return auditNarCollectionRun(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),{expectedDate:args[3],now});
  } catch {return hold('BUNDLE_READ_UNAVAILABLE');}
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = runNarCollectionAuditCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');process.exitCode = result.status === 'OBSERVED' ? 0 : 1;
}
