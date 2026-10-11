# Phase121: official card HTML to PDF identity and history associations

Base: 934c0c6d5f065efd28ef507074b43430147cb576 (merged PR181).

## Offline research connection

`buildJraPdfOfficialCardEvidence({pdfInput,html,sourceUrl,capturedAt,nowAt,
maxAgeMs})` connects explicitly supplied JRA card HTML to the Phase119 resolver.
It does no network IO or master write. The existing production parser is reused
without changing the parser, cache, app, flags or EARLY reader. This adapter
supports the flat-race card contexts supported by that existing parser.

sourceUrl must use https://www.jra.go.jp/JRADB/accessD.html without credentials.
HTML is limited to 1000000 UTF-8 bytes. The caller must decode the source's
actual encoding first. capturedAt/nowAt must be explicit zoned timestamps;
nowAt cannot precede capture and maxAgeMs is an explicit 1..3600000 ms bound.
These are caller timing declarations, not independent trusted clock proofs.
The card header must match the PDF date/course/race/surface/distance, with the
same runner count and exact horse number/name joins. No alias is inferred.

Within each runner's horse-name block, an official horse link must have the
same JRA origin, /JRADB/accessU.html path, exact linked name and the observed
CNAME format pw01dud00 + ten-digit horse ID + / + two hex digits. Missing or
ambiguous links do not produce an identity association. Reused IDs reject.
CanonicalHorse_Key is namespaced as JRA_OFFICIAL|ID, derived from the linked
official ID, never a temporary PDF key. The adapter emits bounded virtual
race/horse mapping tables with the Phase119 header format. They are research
associations generated from this card, not updates to Drive's native maps.
mapSpreadsheetId OFFICIAL_CARD_SHA256:... is a provenance namespace, not an
actual Google Sheet ID. The source/ref retains the real card URL and decoded
HTML SHA256. This does not prove authenticity of arbitrary caller HTML.

MM/DD dates are associated only when one parsed official prior run matches
month/day, course, surface, distance, finish and exact TIME, and carries a valid
full date before the current race date. PDF slot number does not select an
official run. Missing or ambiguous matches remain HOLD, and UNKNOWN slots
remain unchanged. The output includes original PDF features, year-bearing date
and source reference for the Phase119 proof contract. Current market data and
unrelated parser fields such as last3F are not mapped by this patch.

Starter state is emitted only when both declared capture and observation are
strictly before the card's JST post time. Late/current saved card status cannot
prove historical pre-off status. Late capture can still associate identities
and prior-history dates for research, but emits no starter-state proof. Caller
statuses in pdfInput are cleared, avoiding reuse of unrelated prior declarations.
All formalKpiEligible/adopted/productionActivationReady flags remain false;
sourceAuthentication/trustedTiming remain UNVERIFIED and Freeze mutation NONE.

## Real source inspection and result

The public app's saved official card exposed the exact source URL below but
did not expose official horse IDs. Raw JRA HTML was then fetched directly and
decoded as declared Shift_JIS. The observed horse-link syntax matches the
existing repository fixture, which was captured before this patch.

The measured direct response completed at 2026-10-11T14:55:21.410366+00:00
(23:55 JST), after Tokyo1R's 10:05 JST off time. Raw response: 164760 bytes.
Raw-byte hash and request/capture timestamps were recorded separately for this
local audit; the adapter hashes decoded UTF-8 HTML, a distinct representation.
The retained bounded PDF export from Phase118 comprises manifest A1:Q2,
runner A1:Y16 and history A1:AI76 from the date-specific Native authority.

Actual result: 15/15 official horse IDs joined; all 21 known MM/DD history rows
matched full dates. Starter proofs emitted: 0 (post-off). The resolver still
returns HOLD with starter-state-unconfirmed 15 and missing-date slots 54.
No identity-unconfirmed or year-unconfirmed reasons remain for this sample.
The Phase120 quarantine saved this HOLD artifact and a separate Node process
reconnected successfully with its independently retained anchor. snapshot:null;
no real prediction, pre-off availability or successful formal EARLY is claimed.

Sources:
- https://www.jra.go.jp/JRADB/accessD.html?CNAME=pw01dde0105202604040120261011/7C
- https://chass-keiba-lab7.h7625421.workers.dev/api/jra/race?date=2026-10-11&track=%E6%9D%B1%E4%BA%AC&race=1
- https://docs.google.com/spreadsheets/d/1t6dIEcq7Ug3h6ScHEeKudGyx5FIZ-tVqvhAKxp8BBy8/edit
- https://github.com/h762-arch/-chass-keiba-lab/pull/181

## Verification and remaining work

12 new tests cover observed horse-link syntax, exact field join, post-off and
stale/reversed clocks, official URL boundary, missing/foreign/ambiguous/reused
IDs, race context, full-year history proof, UNKNOWN and market exclusion, bounds.
Full local check: 1718 PASS, 0 failures, Chromium included.

For an upcoming race, actual pre-off source capture, trusted timing and status
proofs remain required. UNKNOWN slots need explicit missing-history handling,
not synthetic dates or zero-valued runs. Pipeline persistence proves replay
integrity only; app auto-sync, remote durable retention and formal adoption are
still unconnected. Original EARLY, marks, diamonds/warnings are unchanged.
