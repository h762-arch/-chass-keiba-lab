# CPSI PRE Producer v1

This is an explicit local research command, without app, Worker, timer, Google write, or production D1 wiring. It generates a **new** Run from bytes read during this execution. It never repairs an existing EARLY or reuses a screenshot clock as Freeze evidence. A successful local receipt remains research-only, with `sourceOriginAuthenticated: false` and `formalKpiEligible: false`.

## Input

Supply a UTF-8 file in `CHASS_CPSI_INDEX_OBSERVATION_V1` format:

```json
{
  "format": "CHASS_CPSI_INDEX_OBSERVATION_V1",
  "race": {"organization":"NAR","raceDate":"2026-10-21","track":"浦和","code":"18","raceNo":1,"surface":"ダート"},
  "horses": [
    {"horseNo":1,"horseName":"正式馬名A","peak":50,"baseline5":null,"current":null,"prev":40,"distance":35,"course":38},
    {"horseNo":2,"horseName":"正式馬名B","peak":45,"baseline5":null,"current":null,"prev":42,"distance":40,"course":39}
  ]
}
```

The example is a schema illustration, not a usable race input. Runner names and complete roster must match the current official NAR card. Numbers must be finite JSON numbers or null; a standalone dash, `未`, `*` string, predicted odds, results, prior snapshots and additional fields are rejected. Resolve raw-symbol meaning before assigning numeric inputs. A caller may intentionally leave unresolved primitives null. No missing value becomes zero and no authorized D–G scorer is manufactured.

This command observes a **new local reading of the supplied index bytes**. It does not prove when the underlying image was captured, when its numbers were calculated, or whether transcription was correct. Retain original images and transcription audit separately. Do not relabel output as the original 22:12 EARLY. It cannot certify formal source authority.

## Run

```sh
node scripts/produce-cpsi-pre-run-v1.mjs --enabled --index-file /absolute/path/index-observation.json --output-dir /absolute/path/new-research-runs
```

Without `--enabled`, no index, network or output access occurs. With explicit enablement:

1. Read bounded index bytes and check the file did not change during reading.
2. GET only the official NAR full card for the same date, track/code and race. Follow no redirects or profile/result links.
3. Match all runner names/numbers and unique official identifiers using the existing full-card parser. Use its official post time.
4. Record read-completion timestamps from the execution clock; reject clock reversal, more than 60 seconds of acquisition, and any operation at/after post time.
5. Generate distinct random UUID identifiers and fix a new Run at the observed clock time. Bind raw index bytes, official card bytes, identities and all primitives into a SHA-256 receipt.
6. Insert the Run once, then independently read and validate the receipt, source artifact, roster, values and timestamps.
7. Export `source-bundle.json` and `drive-feed-row.json` only after readback. Existing Run directories/files are never overwritten.

Outputs are under a unique `CPSI-RUN-<uuid>` directory. `receipt.json` retains raw bytes and observation timestamps. `source-bundle.json` uses the existing CPSI source contract. `drive-feed-row.json` contains the exact `[organization, raceId, sourceJson]` values for a bounded Drive feed, but does **not** publish them. Review a successful receipt before any separately authorized feed write. Export does not imply app import or 404 resolution. The existing reader independently rejects expired/prestart-invalid artifacts.

The store contract requires `insertIfAbsent(runId, receipt)` to resolve `true` only after commit and `get(runId)` to read independently. The orchestration library cannot authenticate a caller-provided acquisition/store adapter. Its verified scope is reported explicitly. The CLI uses the local filesystem; production D1 and IndexedDB have not been exercised by this command. A commit followed by failed/late readback can leave a quarantined receipt, but cannot return READY or export a feed row.

## Boundaries

This version supports NAR flat dirt races, excluding 帯広. It preserves the source artifact's shadow-only governance and never alters marks, probabilities, original EARLY or production flags. It does not create actual market EARLY evidence. Publishing a reviewed new Run to Drive and integrating an authenticated upstream index acquisition adapter are separate operations.
