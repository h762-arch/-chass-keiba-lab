# EARLY save-path audit v1

Inspected base: 785f516ea46d6c67f422e3690927c17d318bfd6f.
This is code-path evidence, not proof that a live production job ran.

## Reachable JRA path

worker.js scheduled entrypoint creates createJraPrecomputeWorkerRunner. Its
default composer is createJraPrecomputePlanningIntegration, which injects
save:snapshot=>saveSnapshot(DB,snapshot) into createIsolatedJraDataRaceRunner.
The race adapter invokes runRacePrecomputeJob, whose save dependency defaults
through that composition to savePrecomputedSnapshot. Runtime entry is gated by
ENABLE_BACKGROUND_PRECOMPUTE and additional explicit versions, approved source
mode, schema, budget and canary checks. Current production flag values and actual
execution were not queried.

The separate production-composition and cache-only-composition modules also offer
saveSnapshot injection points. They are not the default scheduled composition.
The planning module's comment claiming no Worker import is stale: the Worker
scaffold imports it. This patch records the finding without altering runtime.

## Evidence available at each boundary

| Boundary | Available evidence | Missing evidence |
| --- | --- | --- |
| save callback before invocation | full proposed snapshot, SOURCE/input/snapshot hashes, versions and hash-bound calculation/validation times | committed revision, actual save completion time |
| savePrecomputedSnapshot return | saved/reason/revision | full hashes, runId, original EARLY freezeId, authenticated completion receipt |
| exact revision SELECT | row content, hashes, created_at, revision | independently trusted record/pin, signal-generation lineage, authenticated EARLY freeze |
| generic runner return | branch-dependent status/metadata | a uniform original save receipt with all hashes and freeze identity |

SAVED means the insert returned successfully. UNCHANGED means that snapshot hash
already existed: a later observation is not its original save time. SUPERSEDED
means the candidate was not inserted and the returned revision can belong to
different content; never pair that revision with the candidate's hashes.
Exceptions/retry exhaustion are not successful save evidence.

created_at is caller supplied (or a default time chosen on function entry), not
an independently trusted commit-completion timestamp. It is not covered by the
snapshot hash. The runner's now is a job timestamp, not database commit time.

## Required correction found while tracing

When semantic SOURCE identity is unchanged, runRacePrecomputeJob reuses DATA,
updates SOURCE and sourceValidatedAt, and saves a new snapshot revision. The DATA
calculation time remains older. Therefore sourceValidatedAt <= dataCalculatedAt
incorrectly rejected this normal path in the independent binding module.

The corrected check independently requires each hash-bound timestamp to be no
later than savedAt; savedAt must remain <= frozenAt < offAt. Added tests run the
real race adapter, runner, snapshot revision and SQLite save/readback functions.
They verify no DATA recalculation, exact revision 2, valid later SOURCE validation,
late-validation HOLD, and the save-time equality boundary. Signal ledgers and
save records in these tests remain synthetic.

## Concrete integration boundary

The saveSnapshot injection in planning integration can in future observe the
proposed snapshot and returned disposition. A receipt wrapper would need a
trusted clock, external run/freeze identity, an append-only receipt sink and an
independently preserved pin, followed by exact-revision readback. Existing code
does not provide all of these. No wrapper, sink, flags or production writes are
introduced here; successful synthetic bindings cannot promote formal KPI.

The code trace above covers the JRA precomputed path. It does not establish that
NAR production acquisition or EARLY prediction persistence uses this path.
The actual original EARLY signal producer, trusted receipt location and pin
authority remain unverified. Further implementation should resolve those actual
owners before adding a production hook or claiming end-to-end authenticity.

Formal KPI HOLD, MODEL_HOLD and NO-GO remain. Original Signal Freeze is not
rewritten by SOURCE refresh, market updates or later results through this patch.
