# NAR SQLite evidence reader v1

Reads an explicitly selected local SQLite copy and passes exact stored JSON text
to the existing independent auditor. No DB is discovered, created, migrated,
repaired or acquired automatically. No production D1 or network connection.

```
node scripts/read-nar-sqlite-evidence-v1.mjs --db /absolute/path/research-copy.sqlite --race-id '2026-10-07|園田|7'
```

The example race ID is a synthetic example, not a request to replay official data.
API: readNarSqliteEvidenceV1(JSON.stringify({dbPath,raceId})). Paths and race IDs
must be explicit. Use a stable, closed copy of the research database; active WAL,
SHM or rollback-journal files are rejected before opening. WAL file headers are
also rejected. Obtain a consistent rollback-mode export through the source's own
backup process; this reader does not checkpoint or copy a live database.

The reader requires ordinary SQLite tables research_nar_early_snapshots,
research_nar_initial_bundles and research_nar_commit_observations in that one copy.
If the real receipt journal is stored elsewhere, consolidate an authorized
consistent research export externally; this reader does not invent that link.
Views are rejected. Missing schema holds. Legacy EARLY rows require separate
audit, including when both namespaces exist; they are not replaced by a newer row.

The database opens readOnly:true, enables query_only, and uses one read transaction
for exact bound storage keys. No INSERT/UPDATE/DELETE or latest fallback exists.
It extracts bounded bundle and receipt text, releases the transaction, computes
UTF-8 hashes, builds CHASS_NAR_INITIAL_EVIDENCE_V1 and invokes
auditNarInitialEvidenceV1. Missing receipts and altered content remain HOLD.
Each stored JSON text is limited to 300,000 bytes with depth/node bounds before
serialization. Config JSON is at most 4096 bytes. Raw errors/paths are not echoed.

CONTENT_READ_AND_MATCHED means supplied local content and observed-time checks
matched. CLI exit 0 corresponds only to that status; HOLD exits 1. Every path keeps
formal HOLD, MODEL_HOLD and NO-GO. The outer reader can report storeReadPerformed
true; the nested offline auditor correctly reports false because it reads only
the supplied text. Neither reports authenticated storage or trusted durability.

The returned evidence contains original prediction information. Preserve stdout
only in the intended research evidence destination. No original signals are
recomputed or rewritten. No runId/freezeId, independent pin, clock authority or
source authenticity is invented. The reader's newly calculated hashes establish
internal consistency, not an external independent anchor.

Current validation uses synthetic evidence saved in real temporary SQLite files.
Byte comparison and directory listings verify no mutation or sidecar creation in
those tests. This does not establish behaviour against an arbitrary concurrently
modified file; use a quiescent copy. An actual user-selected research database and
target race ID are still needed to perform a real-evidence audit.

Run node --test tests/nar-sqlite-evidence-reader-v1.test.mjs with existing evidence
auditor/rehearsal and NAR initial SQL integration tests. Run npm run check.
