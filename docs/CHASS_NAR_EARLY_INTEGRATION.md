# NAR EARLY isolated integration contract

Production Activation: **NO-GO**.

## Scope

`captureNarEarlyResearch` → `saveNarEarly` / `freezeNarEarlySnapshot` →
`createNarEarlySqlStore` → local SQLite → `readNarEarly`.

The integration tests use synthetic race records and an injected acquisition
callback. Python's standard-library SQLite executes actual SQL against a private
temporary database. Each query opens and closes a connection; re-reading uses a
new adapter. No official network access or production database is involved.

Run: `node --test tests/nar-early-integration.test.mjs` (Node >=20, Python 3.8+).

## Covered behavior

- A fresh capture retains the original race, prediction, market, final and seals.
- Original marks, probabilities, predicted times and reasons survive roundtrip.
- Existing EARLY is selected before acquisition, including after race results.
- Competing candidates share one primary-key-protected first revision.
- Stored content changes without a matching digest are rejected, never repaired.
- Disabled capture performs zero acquisition, clock or SQL calls.
- A missing table fails closed without schema creation.
- Historical, result-present, cross-race and post-time input cannot create rows.

The competing-candidate test interleaves asynchronous orchestration against local
SQLite; it is not a distributed Cloudflare D1 concurrency test. The signal fixture
checks preservation, not whether the prediction model correctly assigned marks.

## Remaining activation gates

- Connect and verify an actual NAR acquisition adapter and its source timestamps.
- Independently validate race identity and official scheduled/actual post times.
- Validate the SQL adapter with an explicitly authorized non-production D1 target.
- Review and authorize schema setup, retention, access and operational monitoring.
- Verify original EARLY remains distinct from later market/live assessments.
- Keep production flags, routes and production D1 writes unchanged until approval.

`acquisitionKind:'fresh'` and receipt timestamps are caller assertions, not
authenticated proof. Saved post time is not independently official-verified by
these modules. Hashes detect content mismatch; they do not authenticate sources
or prove data was unavailable after the race. The current 60-second capture age
is this component's contract, not a universal EARLY scheduling definition.

All new captures retain `researchOnly:true` and `formalKpiEligible:false`.
Local test success does not promote historical backups or these synthetic
records to formal EARLY KPI data, and does not authorize production activation.
