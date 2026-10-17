# NAR initial evidence rehearsal v1

The CLI runs the existing runNarInitialShadowSession using synthetic acquisition,
a fresh disk-backed temporary SQLite database and a separate receipt table in
that database. It captures the original bundle, application-observed COMMIT and
readback as one exported JSON report. No production binding, DB path, URL,
date, real acquisition provider or external clock can be supplied.

```
node scripts/nar-initial-evidence-rehearsal-v1.mjs
node scripts/nar-initial-evidence-rehearsal-v1.mjs --scenario late_ack
```

Supported scenarios: baseline, late_ack, lost_ack, missing_receipt,
tampered_bundle. All writes and intentional fault injections occur only in the
fresh temporary database. After the first session, the database closes and is
reopened read-only. The second session runs with a later synthetic clock and a
forbidden acquisition callback. Queries must be SELECT-only, original stored
bytes must remain unchanged, and acquisition must occur exactly once.

The report includes first/reopened session results, source bundle and receipt,
storage keys, exact UTF-8 SHA-256 values and boolean checks. Nested content hashes
remain the existing semantic hashes; top-level UTF-8 hashes describe serialized
stored text. In fault scenarios exported evidence describes the intentionally
altered local state and must not be mistaken for valid original evidence.

| Scenario | Expected reopened result |
| --- | --- |
| baseline | HOLD: DURABLE_TIME_AND_FORMAL_POLICY_UNVERIFIED |
| late_ack | HOLD: COMMIT_OBSERVED_LATE |
| lost_ack | HOLD: COMMIT_TIMING_UNCONFIRMED; committed bundle retained |
| missing_receipt | HOLD: COMMIT_EVIDENCE_MISSING |
| tampered_bundle | REJECTED: BUNDLE_CONTENT_OR_SCHEMA_INVALID; no repair |

Rehearsal PASS means those expected outcomes and preservation checks passed.
It never means formal EARLY PASS. COMMIT times are fixed synthetic observations,
trustedDurableTime remains false, formalKpiEligible and adopted remain false,
Probability is MODEL_HOLD and Production Activation is NO-GO. The synthetic
original signal fixture assigns no diamond or warning marks. Generated research
assessments remain withheld by the existing bundle policy.

The receipt journal shares this isolated database for reproducibility. It is
not an independently trusted store or external pin. This does not bind the
research bundle to a precomputed snapshot revision, authenticate a runId/freezeId,
or establish actual production acquisition/storage. The historical fixture date
is synthetic only, not an official-data historical replay.

Temporary SQLite files are removed after the run. Preserve stdout JSON to retain
the evidence pack. No runtime modules, production flags, workflows or schemas are
changed by this patch; the three files are this document, the CLI and its tests.

Run node --test tests/nar-initial-evidence-rehearsal-v1.test.mjs and existing
nar-initial-sql-integration / nar-initial-research-bundle tests; npm run check
for full regression. Existing original signal preservation rules remain in force.
