# Isolated NAR app source and shadow research v1

Research only. Production Activation NO-GO. No UI, automatic timer, production
D1, migration or formal mark/adoption wiring.

## Source timestamp correction

acquireNarEarlyResearchRecord previously returned a local receipt acquiredAt,
while record.race.narSourceAcquiredAt retained the Worker timestamp. The initial
bundle requires those fields to agree. Real network delay therefore produced a
source-receipt mismatch even when source freshness was valid.

The research function now returns acquiredAt:data.acquiredAt and a separate
receivedAt local timestamp. It does not retimestamp the source, modify any
snapshot, widen the sixty-second window or change the fresh-start requirement.
A source time earlier than the capture start still rejects, rather than being
rewritten to look fresh. receivedAt is diagnostic and is not part of the initial
bundle or a trusted durability claim. The app's normal acquisition/UI behavior
and bootstrap are unchanged.

## Node-only source harness

createNarShadowAppAcquire({fetchImpl=globalThis.fetch,clock=Date.now}) loads the
checked-in app.js into a fresh VM, using its existing __CHASS_TEST__ API branch
to stop normal bootstrap. It returns a callable using the actual app research
fetch, transformation, prediction and snapshot functions. It does not substitute
a new prediction engine. This is an isolated execution harness for trusted
repository code, not a security boundary for arbitrary untrusted JavaScript.

The VM does not share the user's active app state. DOM readers are empty stubs;
localStorage writes/removals throw. Requests are restricted to GET
https://chass-keiba-lab7.h7625421.workers.dev/api/nar/race. The existing app function
performs one attempt with cache:no-store, validates race/source identity and
source freshness, and restores its transient state after building the record.
fetchImpl injection is used by tests. The harness installs no UI handlers or
automatic runtime acquisition. Node-only dependencies are not imported by app
or Worker production entry points.

runNarAppInitialShadowResearch({enabled=false,db,receiptStore,raceId,clock,fetchImpl})
connects that source lazily to the existing initial shadow session. OFF, existing
initial content and failed store reads do not load/evaluate the app or fetch.
db and the append-only receiptStore remain explicit local research dependencies;
schema setup remains external. The returned session keeps adopted=false and
formalKpiEligible=false. There is no formal GO path.

## Validation

Six new tests exercise actual app code and actual SQLite files, with mocked
Worker responses: complete source/storage/audit/HOLD chain; separate server and
delayed receipt timestamps; a 1.25-second delayed response; disabled/reopened
fetch bypass; one-attempt HTTP failure; and prior-to-start source or incomplete
market rejection without timestamp repair. Related suites: 150/150 pass.
Full local check: 1202/1204 pass. Missing Chrome and MCP SDK cause the two failures.
Full local PASS is not claimed. New patch CI is not yet run.

## One live source read

One actual public Worker request was made for 2026-10-08|園田|1 using the new
source harness. Local request start was 2026-10-08T00:45:36.047Z. The app returned
8 horses, postTime 10:40, acquiredAt and narSourceAcquiredAt both
2026-10-08T00:45:45.895Z, with receivedAt 2026-10-08T00:45:45.998Z.
Its market Signal status was provisional. This confirms the isolated app source
read, not an independently authenticated official HTML audit or a trusted clock.

The live call only returned the acquisition receipt; it did not run the SQLite
session or persist/freeze a live initial bundle. Market-included live Freeze,
durable commit timing and formal eligibility are unconfirmed. The current
initial-bundle market gate requires frozen complete market evidence; no fallback
or relaxation is added for the provisional live response.

## Scope and remaining work

Only the app research receipt timestamp line, this Node-only module/document,
and SQLite integration tests change. Existing store, Freeze, session, observer,
HOLD gate, popularity/mark rules and production settings are unchanged.
Trusted durability/transaction identity, formal route/market policy, actual
production D1 integration and formal EARLY adoption remain unresolved.

Baseline main: ec1deffb8b3fa10a65dc647df4268e38a7a7d027 (PR #139).
Policy source: supplied "⚠️と💎の取り扱いルール.txt".
