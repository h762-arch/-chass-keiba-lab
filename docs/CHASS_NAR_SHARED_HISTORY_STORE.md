# NAR shared history research store (Phase138)

## Scope and contract

The existing Cron can append identified card observations and freeze a maximum
ten-episode research projection into new DATA / Pre-Analysis Pack V4. A browser
does not perform materialization. Pack V1/V2/V3 and original snapshots remain
readable and are not backfilled. Ability/TIME calculations are unchanged: shared
history is material for review, not a connected model input, CPSI, calibrated
probability, formal signal or formal readiness.

`NAR_LINEAGE:<11-digit provider ID>` identifies the horse; the full official
past race ID identifies the episode. Only Phase137 RESOLVED references verified
against both original history and link hashes may enter the store. Unresolved
observations remain in the original card history. A matched link identifies the
episode; it does not independently validate its numerical facts against a past
result page. No additional source fetch is introduced.

Each immutable row contains raw market-independent facts, their hash, source
race identity, acquisition and observation timestamps, pre-off source boundary,
and both history/link hashes. Its primary key is the hash of the entire record.
Same-source retries are insert-ignore plus physical readback; another source
retains another provenance record. SQL triggers reject UPDATE and DELETE.
Cross-source identical facts share one read episode; differing fact hashes
produce FACT_REVISION_CONFLICT with null facts. No chosen-latest correction or
automatic overwriting of EARLY occurs.

## Cutoff, coverage and limits

Read only observations at or before the captured run cutoff and episodes dated
strictly before the target JST date. Order by episode date/race ID and retain up
to ten episodes, including conflict slots. A same-day historical episode is
excluded. Up to 256 observations across these ten slots can be verified; a 257th
row yields HISTORY_OBSERVATION_LIMIT rather than silently truncating provenance.
Ten slots do not prove complete career or Rolling10 coverage: tenRunCoverage
remains NOT_CONFIRMED. No fictitious facts or missing-value zeros are generated.

Every D1 operation checks the existing deadline/post boundary before starting
and after completion; those checks cannot cancel an in-flight D1 operation.
An interrupted append may leave valid research observations without a parent
snapshot. They retain their real source times; a later eligible run can reuse
them. Late DATA is not saved. The frozen projection contains its cutoff/hash
and is read independently of subsequently changing store contents.

Existing 20-second NAR budget, three attempts, Kawasaki-only daily trial,
JRA maxJobs=1, planning caps, and official history fetch limits remain unchanged.
Additional D1 work has not been benchmarked in production. Large fields can
require up to five observation writes/readbacks per runner plus its read query;
do not infer daily throughput or full ten-run coverage from unit tests.

## Provisioning and activation

The patch ships `ENABLE_NAR_SHARED_HISTORY=false`. Merge/deploy alone does not
enable store writes. History link enrichment remains enabled. There is no
automatic DDL or production migration from Cron.

1. Verify Bridge PR/CI and deployed revision.
2. Confirm the selected production D1 matches the Worker's `DB` binding.
3. Apply only `migrations/0014_nar_shared_history.sql` in that D1 console.
   The script is additive/idempotent; it does not alter snapshot tables. Do not
   run every historical migration indiscriminately.
4. Check columns with `PRAGMA table_info(nar_shared_history_observations);` and
   inspect all objects:

   ```sql
   SELECT type,name FROM sqlite_master
   WHERE tbl_name='nar_shared_history_observations' ORDER BY type,name;
   ```

   Expect one table, the named read index (plus primary-key autoindex), and both
   no-update/no-delete triggers. The public nar-precompute-status endpoint must
   report historyStoreSchemaReady=true. That field validates column readability;
   object inspection is additionally required to verify indexes/triggers.
5. In a separate reviewed activation change, set ENABLE_NAR_SHARED_HISTORY=true
   within the existing daily trial. Measure real D1 duration, deadline outcomes,
   saved coverage and per-race historyStoreAudit before expanding.

When enabled without schema or verified identities, the ability snapshot may
still save, with explicit HOLD and no rolling projection. The shared-store
adapter never claims success without row readback/hash validation. Failure
details are sanitized to bounded reason codes. Turning the flag off stops new
store work and preserves already-frozen DATA.

## Review and verification

Real SQLite tests cover immutable DDL/idempotency, per-horse identity isolation,
cross-race provenance, cutoff-based conflict visibility, latest ten slots,
tampering, schema/readback failure, explicit disabled/HOLD fallback, Cron-to-API
readback, original snapshot preservation, and Pack V1–V4 compatibility.
Production provisioning, enabled throughput, and actual cross-day coverage
remain unverified until the separate activation audit.
