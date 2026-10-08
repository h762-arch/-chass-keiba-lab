# NAR initial readiness diagnostics v1

Research only. Production Activation NO-GO. This read-only diagnostic does not
change admission, storage, market eligibility, scenario rules or formal flags.

## API and evidence boundary

`inspectNarInitialReadinessResearch({store,receiptStore,raceId})` calls the
existing verified admission reader. It reports HOLD/MISSING/REJECTED and safe
blockers without accepting caller-supplied certification. No fetch, clock,
write, schema setup, repair, re-Freeze or automatic runtime wiring is added.

For a verified initial bundle, VERIFIED_LOCAL describes content/semantic
verification and frozen full market coverage under the existing gate. It is
not authenticated source evidence or certification of odds accuracy, ranking,
EV, scenario quality, prediction performance or physical durability. Receipt
verification is separate from timing: a valid receipt may show late or unknown
application-observed COMMIT timing. Missing evidence is not reconstructed.

MISSING and REJECTED have no positive checks. Legacy EARLY is explicitly not
reported as a verified initial market bundle. Initial diamond research does
not certify warning scenarios or their exclusion from ability marks.

## Unresolved formal conditions

The current implementation always exposes six unresolved conditions:

| Blocker | Evidence still needed |
| --- | --- |
| SOURCE_AUTHENTICATION_UNVERIFIED | Source origin/identity and acquisition provenance beyond local hash consistency |
| TRUSTED_DURABLE_TIME_UNVERIFIED | Trusted evidence of actual persistence timing; driver-return observation alone is insufficient |
| TRUSTED_TRANSACTION_IDENTITY_UNVERIFIED | Trusted association of persistence evidence with the exact transaction/content |
| SCENARIO_POLICY_UNAPPROVED | Validated separate WIN/PLACE route criteria, conditions and failure conditions |
| MARKET_POLICY_UNAPPROVED | Defined probability/EV units, bet type and validated market evaluation criteria |
| STRONG_SUPPORT_POLICY_UNAPPROVED | Validated support strength and independence, including overlapping prior runs |

Missing, unavailable, late or unknown COMMIT evidence adds its existing safe
reason code. These are diagnostics, not a new formal certification mechanism.
All output retains formalKpiEligible=false, adopted=false and
productionActivationReady=false. No arbitrary thresholds or approval claims
are introduced. Original Signal remains unchanged; candidate marks remain
WITHHELD. The supplied signal rules remain authoritative.

## Saved live readback

On main e5ec8a99f02e728cc5632b6cd564f1231bdfe9b5, an isolated live session for
2026-10-08|園田|6 acquired twelve horses and twelve valid odds at
2026-10-08T04:04:26.586Z, before the official 13:10 JST post time. Local capture
and audit each returned CREATED, with one bundle and one receipt. Closing and
reopening the local SQLite database preserved the exact JSON bytes.

At 2026-10-08T04:19:53.158Z, this new diagnostic read that saved database using
SELECT only. It was not a new fresh acquisition or post-race re-evaluation.
The stored JSON SHA-256 remained
11d0274f7a077dc60b05e7f09d0e6ca338d6508ad6df39597b3d87d498fa756f.
The report returned HOLD, OBSERVED_WITHIN_WINDOW, seven INSUFFICIENT assessments,
WITHHELD candidates and all six unresolved formal conditions. Production D1,
active app state and localStorage were not written by this validation.

## Validation and scope

Six new tests use actual SQLite files and synthetic source/clock fixtures:
in-window evidence and immutable content; missing evidence without regeneration;
late timing; absent source; corrupt evidence without detail leakage; and legacy
EARLY preservation. SQLite integration: 56/56 pass; related research suites:
159/159 pass. Full local check:
1211/1213 pass; absent Chrome and MCP SDK account for the two failures. Full
local PASS is not claimed. Bridge CI has not run for this patch.

Only this document, the new diagnostic module and the SQLite integration tests
change. Store, admission, Freeze, app, Worker and runtime settings are unchanged.

Sources:
- https://github.com/h762-arch/-chass-keiba-lab/pull/141
- https://www.keiba.go.jp/KeibaWeb/TodayRaceInfo/DebaTable?k_babaCode=27&k_raceDate=2026%2F10%2F08&k_raceNo=6
- Saved live validation evidence and supplied "⚠️と💎の取り扱いルール.txt".
