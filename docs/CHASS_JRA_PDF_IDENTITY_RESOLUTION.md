# Phase119: Drive identity maps and full-date evidence resolution

Base: 4b443efc8f67d8e1ad92e8e8615b3b69632e6ebf (merged PR179).

`resolveJraPdfEvidence` connects bounded, offline CHASS_RACE_ID_MAP and
CHASS_HORSE_KEY_MAP exports to the Phase118 PDF adapter. No network, database,
source-master write, app adoption, market or Signal generation is performed.
It returns the existing Snapshot bridge tables and explicit resolutionAudit.

## Map contracts

Inputs: pdfInput (the existing adapter arguments), raceMapTable, horseMapTable,
mapSpreadsheetId, optional original map data start rows (default 2), and
historyDateEvidence. Each map has its original header and at most 5000 scalar
data rows / 50 columns. Caller pdfInput.associations are replaced by map-derived
associations, so they cannot bypass the mapping rules. Inputs are cloned.

Race association requires exactly one SHEET / JRA_RACE_RUNNER source row with
CONFIRMED, JRA, exact canonical ID, date, course and race number. Ambiguity or
conflict returns HOLD with PDF_RACE_MAP_UNCONFIRMED_OR_CONFLICT.

Horse association requires exactly one matching source horse key under the same
source system/sheet, an exact horse name, IdentityStatus CONFIRMED, nonempty
OfficialHorse_ID and a non-temporary canonical key. PROVISIONAL is not upgraded.
Repeated canonical keys or official IDs across selected runners reject. The
output retains the exact map sheet/row reference. These are caller-supplied
associations, not independent authentication of the spreadsheet or official ID.

Starter state remains independently supplied via pdfInput.statuses using the
Phase118 exact race/horse-number/name/status/evidenceRef contract. Missing or
ambiguous status remains UNKNOWN/HOLD. This patch does not convert saved or
expired app card status into current official status.

## Full-date evidence

Only an existing PDF MM/DD value can be associated with a separately supplied
full date. A proof needs exact sourceRaceId, sourceHorseKey, canonicalHorseKey,
horseNo, horseName, runNo, rawDate, PASS, fullDate and evidenceRef. The full date
must be a valid prior calendar date with the same month/day. pdfFeatures must
exactly match the PDF values for 競馬場, 芝ダ, 距離, 着順 and 走破TIME. These
features must all be known. Proof absence, duplicate proofs or feature conflict
leaves the raw date unresolved; no year is inferred. UNKNOWN slots are not
filled. Proofs are limited to 5000 items. Changed dates are applied only to the
detached adapter input, and resolutionAudit preserves rawDate/fullDate/ref.

The resolver calls the original adapter again after associations. Remaining
identity/status/date omissions stay HOLD. Confirmed synthetic evidence can
reach READY_FOR_UNVERIFIED_RESEARCH_SNAPSHOT and the existing Snapshot bridge.
All formalKpiEligible/adopted/productionActivationReady flags remain false;
authentication and trusted timing remain UNVERIFIED. Source revision,
availability, run and cutoff/off timestamps must still be separately supplied
to the existing bridge. This function does not generate them.

## Actual Drive inspection and limits

2026-10-11 read-only inspection of the master confirmed the existing native
map headers. The sampled horse rows were PROVISIONAL, with TEMP canonical keys
and empty official IDs. A bounded search of CHASS_RACE_ID_MAP A1:M400 for
20261011_東京_1 returned 0 rows; CHASS_HORSE_KEY_MAP A1:L1200 for
ステラガーネット returned 0 rows. This is not evidence of absence outside those
ranges, nor a successful real-source identity connection. No real official ID,
starter proof or full-date association was manufactured or written to Drive.

Sources:
- https://docs.google.com/spreadsheets/d/1dqFySEgG6cYEXIx8BmOw7tPOe7wI90H_No1FRoXlgoI/edit
- https://github.com/h762-arch/-chass-keiba-lab/pull/179

14 new synthetic tests cover map joins, bridge integration, provisional IDs,
race/horse ambiguity, reused IDs, date/feature proof conflicts, unknown slots,
starter-state preservation, source row offsets and input bounds.

Next operational input: independently retained confirmed mappings, official
starter-state evidence and year-bearing history evidence for a selected race.
Then validate a real research Snapshot and its isolated durable readback before
connecting an app consumer. App auto-sync and formal EARLY adoption remain
incomplete. Production Activation remains NO-GO for this research connection.
