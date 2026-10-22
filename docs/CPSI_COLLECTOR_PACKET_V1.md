# CPSI collector packet v1

An opt-in **research-only** orchestration and local filesystem command connecting the Collector, Producer, image/transcription archive and pinned signature verifier. No key generation, live service, automatic fetch, provider login, formal acceptance, Drive feed write, D1 write or EARLY/signal changes. Development tests use only synthetic responses and ephemeral keys.

## Exact response scope

The acquisition endpoint must return UTF-8 `CHASS_CPSI_INDEX_OBSERVATION_V1` JSON, which is used verbatim as the Producer's index observation. The packet verifier compares the decoded retained response bytes to that exact raw observation before verifying the signature. Raw bytes are preserved in canonical base64. HTML, a login page, arbitrary provider JSON or an old image ZIP is not automatically converted. Netkeiba HTML parsing/authenticated collection and `*` interpretation remain unimplemented. This format restriction is intentional; it does not establish who produced the JSON endpoint's contents.

## Explicit operator adapters

`collectCpsiResearchPacket` defaults OFF. An authorized caller must supply `sourceUrl`, `keyId`, `fetchResponse`, `acquireCard`, `prepareEvidence`, `sign`, `loadTrustPolicy` and a local-only `store` with insert-if-absent/get. The clock defaults to Date.now. These adapters are trusted executable operator code; they must not be loaded from evidence packets, user-submitted ZIPs, web responses or another untrusted source. This repository does not install a collector identity, approve keys or operate those adapters.

`loadTrustPolicy` obtains the independently managed PR #291 trust policy. It is called at initial key selection, before storage and after readback so a newly revoked key is rejected. Policy is never embedded in or trusted from the packet. `sign` must use the separately managed corresponding private key. `fetchResponse` must perform the permitted HTTPS request and honor the existing collector's fetch options. `acquireCard({url})` must return freshly acquired official NAR HTML for the exact requested URL, bounded to the Producer limit; it remains a trusted adapter whose acquisition assurance is external. `prepareEvidence({sourceBytes,receipt})` must return exact `{imageBytes,transcriptionRaw}` for the new capture, following PR #290's schemas. It receives copies, cannot modify retained bytes/receipt, and is validated before signing. No raw index values, IDs, missing timestamps or symbol meanings are fabricated.

The Producer creates new identifiers and Freeze, retaining the official-card bytes. Its temporary insert/readback is process-local. After evidence validation, the collector signs, a new immutable archive is made, and the final packet is verified against current policy. Only then is it inserted once into the final store, independently read back and fully verified again. All stages must finish before post time; final readback must finish within 60 seconds of Freeze. `freshPreResearchCheck` reflects the caller's clock and is not independent time certification or formal PRE admission.

## Local command

```bash
node scripts/collect-cpsi-research-packet-v1.mjs --enabled --adapter-file /operator/approved-adapter.mjs --output-dir /operator/new-research-packets
```

Without `--enabled`, no adapters are imported and no files or network are touched. The explicitly selected adapter module exports the names above (apart from store/clock); importing it executes operator code with normal local privileges. No default fetch or private-key handling is provided. Do not put private keys, credentials or an unapproved trust policy in the repository or patch. No production adapter is included as a working sample, and this command is not yet usable for real acquisition until authorized adapters and data are provided.

The command creates a unique `CPSI-RUN-.../packet.json` with exclusive file creation and mode 0600 inside mode 0700 directories. It refuses an existing Run directory and does not overwrite/retry it. A failed write or readback can leave quarantined partial material. **The presence of packet.json does not imply successful readiness.** Only the successful command result indicates completion at that time, and consumers must independently verify the packet with current policy. No READY file, Drive row or production import is emitted. Output paths are operator-controlled local storage; filesystem permissions do not defend against a privileged or malicious co-user.

`storageState` distinguishes NOT_ATTEMPTED, INSERT_ATTEMPTED (including uncertain write failure), INSERTED_UNVERIFIED and READBACK_VERIFIED. HOLD returns no packet/feed/import result. If a callback hangs or fails, do not interpret partial files as success; reacquire a fresh Run. The collector bounds its own network/signing adapters; other operator adapters must also have bounded operations and honest clocks.

## Verification and limits

`verifyCollectorPacket(packet,{trustPolicy,now})` is a **historical** verifier for exact packet shape, 4 MiB limit, unchanged research governance, archive/receipt/image/transcription hashes, exact observation response bytes, signature and Run/time bindings. It does not grant live admission. Saving proves local readback, not a production D1 write. A policy administrator or dishonest collection adapter can fabricate data/time; no independent provider witness, authenticated time service, provider-specific parser or model qualification is added here. `sourceOriginAuthenticated`, `formalKpiEligible`, `importable` stay false and activation stays NO-GO.

This does not retroactively authenticate Urawa1R on 2026-10-21. Existing Original EARLY, Freeze, marks and 💎/⚠️ stay unchanged. A future formal gate still needs independently approved acquisition assurance, semantic/provider matching and model/admission qualifications. Trust/clock/policy requirements are not satisfied merely by a new local key and a passing test.
