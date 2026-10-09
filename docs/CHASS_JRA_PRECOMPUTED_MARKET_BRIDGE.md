# Phase105: first complete JRA MARKET bridge

The Worker forwards `ENABLE_JRA_PRECOMPUTED_MARKET_BRIDGE === 'true'` to
planning integration. The new bridge defaults OFF. This patch does not set
production environment values, deploy, migrate, or write production D1.

DATA orchestration runs unchanged. A separate MARKET pass scans inspected
jobs, including unchanged DATA jobs that DATA selection would omit. Each pass
uses at most the existing maxJobs cap, with the shared execution deadline.
There is no direct fetch, new polling timer, result fallback, or odds estimate.

The bridge requires an existing DATA snapshot with matching exact date,
track, race number and raceId, valid snapshot/input hashes, and known post
time. Current time and official acquisition time must precede that post time.
The strict existing odds reader rejects expired cache. Additional validation
checks persisted payload SHA-256, metadata, parser version, official URL and
body identity. The active horse-number set must match exactly: scratched and
excluded horses are omitted, duplicates and missing odds/ranks reject the
candidate. Missing evidence returns HOLD, never an invented market.

MARKET contains only win odds, supplied popularity, acquisition time, source,
coverage, and explicit freeze metadata. DATA and its times/hashes remain
unchanged. No marks, EV, diamond/warning decisions, FINAL, or KPI promotion
are generated. The DATA-only EARLY research reader is untouched.

One conditional INSERT checks both absence of any prior race MARKET and the
expected latest revision/hash. A race with any previously saved MARKET never
reacquires odds. A competing or superseded write returns HOLD and is not
retried with replacement data. Existing generic DATA writers remain unchanged;
if a later semantic SOURCE change creates a new DATA lineage, the first MARKET
still exists in revision history and this bridge does not copy it into that
new lineage. Reading original MARKET across lineage changes belongs to a
subsequent frozen Signal reader, not this patch.

Before enabling in production, merge/check this exact patch, confirm current
Worker versions and budget, then enable the separate flag in the existing
authorized deployment workflow. Inspect marketExecution, D1 revision count,
MARKET JSON and repeat-run preservation. A HOLD is not successful Freeze.
Local synthetic tests cannot establish production MARKET coverage.

The attached CHASS diamond/warning fixed rules remain prerequisites for the
later Signal phase: popularity alone never creates a signal; scenarios and
ability evidence are required; Original Signal must remain immutable.
