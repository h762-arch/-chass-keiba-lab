# Phase140.27: meeting-link rejection evidence without changing acceptance

Base: c21ec8672c4108fa0d5cff676a60be0b6987f309 (registered diagnostic workflow).

## Confirmed failure and remaining unknown

GitHub Actions run38849426924 / attempt1 executed the existing read-only source
probe on main at 2026-10-16T04:12:40.378Z (13:12 JST). Its checked-out commit
and report sourceSha were c21ec8672c4108fa0d5cff676a60be0b6987f309.
Meeting GET returned HTTP200, existing parser identified Kawasaki and races1..12,
then preflight held RACE_LINK_IDENTITY_INVALID without its card GET. The
independent direct-card check returned HTTP200 and passed existing card gates:
12 runners, 12 active finite ability values, 11 nonempty predictedTime fields.
Overall DIRECT_CARD_ONLY_OBSERVED / exit1 was expected, not a setup failure.

Artifact12024324041 ZIP SHA256 was independently verified:
44ea38cecfcc0aa5195030b40e0ed98828f98061b5264accf2536b11ecaf9d60.
The JSON digest matched its separate .sha256 file and stdout JSON bytes:
b032da2ccf718fdca5c028156ab70825bdb00c5115a2b82d5d3090aa77469838.
Those facts establish the observed rejection and direct-card success, not
the literal rejected href or the specific reason that identity matching failed.
Raw meeting HTML was deliberately not retained by the prior workflow.

One local bounded meeting inspection at 04:15:13.035Z timed out after5seconds.
A separate curl inspection also timed out at connection establishment with
its explicit5-second cap. Official web-rendered menu/card pages could be read,
but those rendered views do not establish the literal raw attribute/base markup
from the earlier GitHub capture. No specific URL-format cause is proven.

## Four-file diagnostic change

Add a pure research auditor and tests, modify only the research preflight to
retain its output, and add this document. No production runtime, source route,
parser, D1, collector condition, limit, model, existing workflow or template
change. Registered CHASS NAR ReadOnly Source Probe v1 already calls this
preflight: after merge, a new manual run on main will include the new evidence
when its meeting stage is reached. No new workflow registration is required.

auditNarMeetingLinks receives only already captured meeting HTML plus explicit
validated date/code/race. It performs zero network reads and has no env, DB,
writer or follow-link port. Input HTML is capped at1MB of UTF-8. The existing
preflight calls it only after meeting identity and selected-race membership
pass. Earlier transport/meeting failures retain meeting=null, not fake evidence.

The original Phase140.24 quoted-href scanner, amp decoding and URL-resolution
base remain the acceptance rule. Require exact official HTTPS origin, no
credentials, one of the original three card routes, exactly one of each
identity parameter, exact code/slash-date and original race-number syntax and
value. Continue deriving the actual subsequent DebaTableSmall URL locally;
never follow an HTML-provided link. No additional source or GET is introduced.

## Evidence fields and limitations

meeting.selectedRaceLinkAudit is retained on both link HOLD and success.
It records the original scanner's total quoted-href count, full match/rejection
counts and href-form counts; fixed rejection enums distinguish origin,
credentials, path, parameter count, code, date and race mismatches or URL errors.
rejectionCounts includes MATCHED as the successful decision count.

At most8 selected-race samples and4 other card-like samples record only enums,
identity parameter counts and match booleans. No raw href, base URL, hostname,
arbitrary query values, HTML, horse names, scores, odds, exception text or
credentials are emitted. dateShape identifies padded/nonpadded slash,
hyphenated, still-percent-encoded or other shape without emitting its value.
samplesComplete is false unless every scanned quoted href is represented;
aggregate counting and acceptance continue beyond sample limits.

Additional anchor/base hints count quoted/unquoted href syntax, onclick and
embedded other-quote occurrences, base tags and the first parseable href hint.
firstBaseHintMatchCount computes an alternate resolution solely as a diagnostic
hint. It never changes matched or authorizes card fetching. Hints use bounded
regular-expression syntax inspection, not a browser DOM parser; script/comment
contexts, malformed markup and browser base behavior are not fully modeled.
Do not treat a hint, synthetic example or count pattern alone as a proven cause.
In particular, synthetic base-relative, uppercase-entity and JavaScript cases
are tests of evidence retention, not observations of the actual NAR page.

HOLD remains RACE_LINK_IDENTITY_INVALID if no original-policy link matches.
Accepting a new markup/URL form requires a separate evidence-backed change.
acquisitionCertified=false, MODEL_HOLD and NO-GO remain fixed. Missing TIME
is neither repaired nor substituted. No History/DATA/Pack or Original EARLY
signal change. October18 code22 acquisition remains a separate pending trial.

## Current verification and next manual run

One final local runner verification started 2026-10-16T04:19:24.997Z and ended
04:19:32.614Z (13:19 JST), code21/race1. Meeting timed out: SOURCE_DEADLINE,
meeting=null, so no real link-audit output could be produced. The independent
direct card parsed successfully again. Overall DIRECT_CARD_ONLY_OBSERVED,
requestCount2. Real new link evidence, root cause and meeting-to-card success
remain unconfirmed; earlier successful card observations are not rewritten.

After Bridge passes and the patch is merged, manually run registered source
probe v1 on main with current JST date/code/race before its post time.
For October16 Kawasaki1R only before15:00 JST: date2026-10-16, code21, race1.
Audit the new report against run metadata and digest before proposing a fix.
HOLD may still make the run red; artifacts retain the diagnostic result.

New tests22 PASS; related existing tests148 PASS; combined170 PASS. Actual
existing parsers exercise successful and rejected preflights, unchanged derived
card URLs/GET budgets and the registered runner's nested evidence. Pure audit
tests cover old allowed forms, duplicates/missing identities, rejected schemes,
origins/credentials/routes, date/race shapes, relative/base hints, unquoted/JS
syntax, bounded samples, privacy, malformed/oversized config and zero network.
Full local npm run check:2353 tests /2351 PASS /2 FAIL /skip0. Both failures
require absent Chrome (JRA browser smoke and NAR viewer). The full local suite
is not PASS; Bridge must pass all tests before merge GO.
