# Phase140.5: read-only comparison of venue codes 22/23

Base: main 33f01fd2980925d02a6eefd19157b65ac3e9a190 (PR #208).

## Verified mapping defect, not yet verified production attribution

Primary NAR pages confirm 22=金沢 and 23=笠松. Existing code reverses these names
in worker.js TRACK_NAMES, nar-recent-history, nar-ability-precompute TRACKS,
nar-history-identity-bridge venues and the condition audit baseline table.
Sources retrieved 2026-10-15 JST:

- https://www.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_RaceList?k_babaCode=22&k_raceDate=2026%2F09%2F22
  NAR header: 金沢競馬 2026年9月22日.
- https://www.keiba.go.jp/KeibaWebSP/TodayRaceInfo/S_DebaTable?k_babaCode=23&k_raceDate=2026%2F08%2F27&k_raceNo=2
  NAR header: 笠松競馬場 2026年8月27日.
- https://www.keiba.or.jp/?p=127784 (高知競馬 official: 金沢 with code 22).
- https://www.keiba.or.jp/?p=123585 (高知競馬 official: 笠松 with code 23).

The user's production evidence identifies 3R #9, episodes 3 and 4, as NAR
NO_VENUE_MATCH, each with one same-month/day reference and five total links.
It does NOT yet show their retained venue or code. This mapping defect is
confirmed, but its responsibility for these exact two references is pending.

## Why not replace the baseline table here

verifyNarHistoryIdentity rebuilds identities by calling attachNarHistoryIdentity
with current matching rules. Changing the baseline map without persisted rule
versioning can change rebuilt hashes for old RESOLVED/HOLD records and reject
previously readable races. Existing DATA, Pack, History and link hashes are
immutable. A direct constant replacement would violate the readback contract.
This patch therefore does not fix production matching/acquisition constants.
It adds only a comparison projection, retaining original eligibility/HOLD and
verification behavior. Historical tables remain known-deprecated baseline
semantics until a separately reviewed versioned correction is implemented.

## Optional diagnostic detail

Within existing diagnostics=1 compact output, only NAR HOLD references whose
current observation is NO_VENUE_MATCH or DATE_VENUE_COMBINATION_UNMATCHED gain
`venueCodeComparison`. JRA/normal/ambiguous references do not gain this repeated
payload. Each comparison has:

- factMonthDay and factVenue: allowlisted retained observations, or null.
- Up to five official link entries: date, two-digit code, baselineVenue,
  comparisonVenue, mappingBasis, codeMapDisagrees and month/day+venue flags.
- Codes 22/23 alone use PRIMARY_SOURCE_VERIFIED_22_23 (22 金沢 / 23 笠松).
  Other codes remain LEGACY_UNCHECKED, not falsely labeled independently verified.
- Baseline/comparison/verified-code date+venue candidate counts.
- VERIFIED_CODE_MAPPING_CHANGES_CANDIDATES only when a verified 22/23 mapping
  provides a date+venue candidate absent under the original map.

Candidate presence is not proof of unique identity, factual episode equality,
canonical year or a promoted RESOLVED state. Existing duplicate counts and
sourceReason remain authoritative for original observations. The output does
not rewrite any old diagnosis or table. New helper failures are UNAVAILABLE
without raw error text; all old observations/counts remain.

This helper follows no URLs and performs no IO, hashing, model calls or D1 work.
It emits no horse names, arbitrary venues/origins, source URLs, IDs or errors.
Five references and normalized numeric code strings bound the projection.
The original post-restoration exception boundary, compact projection and
100,000-byte response cap remain. Normal status, Viewer, reader, writer,
models, flags, schedules, limits and Signal semantics are unchanged.
Probability MODEL_HOLD, researchOnly, formalKpiEligible=false and
productionActivationReady=false remain.

## Validation and next gate

Unit cases cover both corrected codes, unverified other codes, date mismatch,
multiple years, missing/private facts, malformed and oversized inputs, frozen
input, safe output and exceptions. Real identity attachment demonstrates that a
金沢/code22 observation remains old HOLD and passes existing hash verification,
while new comparison reports a candidate. This is synthetic evidence.
A real-runner/status/Viewer fixture retains 12 saved / 0 rejected and unchanged
row bytes, original HOLDs and hashes; compact per-race detail remains readable.
The earlier 141-horse and 30-horse response-size regressions remain required.

After approved Bridge audit/merge/build, open:
/api/chass/v1/public/nar-precompute-status?date=2026-10-15&diagnostics=1&format=compact&race=3
Date-wide saved/rejected must remain 12/0. Inspect #9's two comparison details
for actual factVenue, codes, baseline/comparison names and candidate counts.
Only then attribute the confirmed table defect to those exact production items.

A later correction must version matching/acquisition semantics and preserve old
verification; do not relabel saved DATA, backfill identities or silently adopt
the corrected map in current hash verification. Cross-module scope and legacy
22/23 race IDs must be audited before changing live acquisition constants.
The earlier three-route 404 issue remains separate and unproven as related.

## Local results (2026-10-15 JST)

- New tests: 11 PASS (10 comparison unit/integrity + 1 twelve-race regression).
- Related nine-file suite: 147 PASS, 0 fail.
- Full npm run check: 1955 total / 1953 PASS / 2 FAIL.
- Remaining failures require Chrome (jra-browser-smoke and
  viewer-nar-ability-browser). Full local check NOT PASS; Bridge CI pending.
- node --check (new/changed modules) and git diff --check: PASS.
- Temporary MCP dependency symlink removed; no dependency file changes.
- No production reads/writes/migration/deploy/merge during implementation.
  The primary-source web lookups above are separate from production DATA access.
- Actual venue names/codes for 3R #9's two production references still pending.
