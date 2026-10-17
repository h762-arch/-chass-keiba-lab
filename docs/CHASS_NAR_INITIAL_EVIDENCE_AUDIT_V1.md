# NAR initial evidence audit v1

Independent offline audit of the previous rehearsal's exported evidence envelope.
It does not read a store, acquire data, write snapshots or authenticate provenance.
Every result preserves formal HOLD, MODEL_HOLD, NO-GO and no formal eligibility.

The rehearsal now includes schema CHASS_NAR_INITIAL_EVIDENCE_V1 and exact
bundleRawJson / receiptRawJson strings as read from SQLite. Existing parsed bundle,
receipt, storage keys and exact UTF-8 SHA-256 fields remain. Raw strings preserve
the stored serialization, including whitespace, instead of reconstructing bytes
from parsed objects. Missing receipt exports raw text as null.

`auditNarInitialEvidenceV1(evidenceJson)` accepts JSON text of that evidence
envelope, not the report's outer PASS/status/checks. It recomputes both UTF-8
hashes, checks keys, ensures parsed summaries match the raw text semantically,
and invokes existing verifyNarInitialResearchBundle and
verifyNarCommitObservationResearch. It requires observed in-window timing for
CONTENT_AND_OBSERVED_TIME_MATCH. Other paths hold with a fixed reason; raw
evidence/error strings are not echoed.

| Evidence | Audit result |
| --- | --- |
| Valid baseline | CONTENT_AND_OBSERVED_TIME_MATCH, formal HOLD |
| Late COMMIT observation | HOLD / COMMIT_OBSERVED_LATE |
| Lost acknowledgement | HOLD / COMMIT_TIMING_UNCONFIRMED |
| Missing receipt text | HOLD / ORIGINAL_RECEIPT_TEXT_REQUIRED |
| Semantically altered bundle | HOLD / BUNDLE_SEMANTICS_INVALID |

The outer report's rehearsal PASS means expected failure scenarios behaved
correctly. It cannot be used as evidence that those scenarios contain valid
EARLY evidence. This auditor re-evaluates contents regardless of report flags.

Input limits: envelope 1,000,000 UTF-8 bytes; each raw document 300,000; each parsed
document at most 30,000 nodes/depth 32. JSON strings only; no caller serialization
callbacks. Old exports missing the raw documents hold until original bytes are
provided; do not invent original text by pretty-printing parsed data.

Hashes remain supplied claims until independently pinned. A caller can provide
different whitespace with its own matching hash; accepting its content never
authenticates the original stored bytes. The semantic verifiers assess declared
relative chronology and application observations, not a trusted clock or current
date. No external pin, official acquisition, production store, runId/freezeId
producer, durability proof or signal-generation lineage is certified here.

For example, regenerate a rehearsal report, then pass
JSON.stringify(report.evidence) to auditNarInitialEvidenceV1. For five scenario
reports, audit each evidence separately. The synthetic evidenceKind label is
reported as a declaration; unrecognized labels become UNSPECIFIED and never
grant trust. No content is automatically repaired or upgraded.

Run node --test tests/nar-initial-evidence-audit-v1.test.mjs together with the
previous rehearsal and existing NAR initial/commit integration tests. Run npm run
check for full regression. Tests include altered raw bytes, forged summaries,
locally recomputed hashes and attempted trustedDurableTime promotion.
