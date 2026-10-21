# CPSI live acquisition adapter v1

Default OFF, dependency-injected collector primitives for a separately authorized operator process. No built-in network call, provider account login, credential reads, signing keys, production trust policy, application/Worker wiring, D1 writes or deployment. This change implements the acquisition-to-signature handoff, not an operated collection service or completed provider authentication.

## Operator prerequisites

An authorized operator must provision a collector identity and Ed25519 public key through an independent trust-policy process, with allowed source URLs, validity period and revocation. The private key stays in an operator-controlled signer; this module accepts a signing callback and never creates or exports production keys. The exact selected key record follows PR #291's collector schema. Caller-supplied policy is not evidence that its provisioning was authorized. Test ephemeral keys and reserved `.example` URLs are fixtures only.

The fetch callback must perform a real, authorized HTTPS request respecting the supplied GET / redirect:error / credentials:omit / no-store / AbortSignal options and provide a standard Response-like status, final URL, headers and byte stream. A callback can fabricate a response, so its own runtime identity, deployment and permitted data access must be established separately. This module does not bypass login, paywalls or browser security restrictions; no provider was accessed during development. Authenticated provider collection is not implemented here.

## Same-process sequence

1. Call `captureCollectorResponse({enabled:true,sourceUrl,key,fetchResponse,clock})`. The URL must exactly match the independent allowlist. No redirects, non-200 status, empty body, response over 1 MiB or mismatched final URL are accepted. Reads and adapter requests have a bounded deadline (10 seconds default, 100–30,000 ms configured), plus AbortSignal and reader cancellation. A dishonest adapter ignoring AbortSignal cannot be forcibly stopped by a JS promise timeout; such callbacks are outside the trust boundary.
2. Use the returned raw response bytes for provider-content interpretation and Producer input construction. The capture object supplies a caller-clock acquisition-completion claim, raw byte hash and opaque one-use handle. The image/transcription is separately retained; this collector does not parse provider-specific HTML, prove image transcription or resolve `*` semantics. A public copy of bytes is returned; mutations cannot change the privately retained response.
3. Generate a fresh Producer receipt from actual index observation and official card acquisition. Do not reuse historical receipt, invent timestamps, or populate unavailable indices. All normal Producer validation applies. A site-specific interpretation adapter is still required when the provider response is HTML rather than observation JSON.
4. Call `signCollectorAcquisition({enabled:true,handle,receiptRaw,imageBytes,sign,clock})` within 60 seconds of acquisition, before scheduled post time and within key validity. The receipt observation must follow acquisition within 60 seconds. The Producer receipt is validated, the original raw response hash and image hash are bound to Run/receipt/source identities, and the returned signature is verified against the pinned public key before export. Signing must complete before post time, within the capture window and before key expiry. Each enabled signing attempt consumes the handle, including a failed attempt, preventing retry with a substituted historical blob. Re-acquire after a failure.
5. After signing, create the immutable evidence archive using PR #290. Save exact receipt bytes, transcription, image bytes, response bytes and attestation with insert-once semantics; read back and run `verifyIndexEvidence` and `verifyAcquisitionAttestation` against the current independently managed trust policy. Archive recording time must be at or after signing. This module does not itself implement a file store or claim readback success.

Capture handles are process-local and nonserializable; a crash requires fresh acquisition. They cannot be recreated by loading an old ZIP. The signer receives domain-separated message bytes compatible with PR #291. Exact raw response bytes must be retained independently of the attestation; do not replace them with a decoded/reformatted string. A callback result that fails signature, freshness or completion-time validation is quarantined by returning HOLD without an attestation.

## Assurance and remaining work

Success is `SIGNED_RESEARCH_ONLY`, not formal PRE. `sourceOriginAuthenticated`, `formalKpiEligible`, `importable` remain false and production activation remains NO-GO. The positive flag `signatureVerifiedAgainstPinnedKey` proves only that the configured signer signed the bound claims.

The clock is a caller's clock claim, not independently attested time. This code does not prove provider identity/content or independently witness HTTPS provenance, prevent a malicious caller falsifying time/response, or prove that a screenshot belongs to that response. It does not resolve netkeiba `*`, missing current indices, model qualification or formal acceptance. Formal admission requires separate independent acquisition assurance, semantic matching, approved models and a fresh acceptance/save/readback path.

For 2026-10-21 Urawa1R, the original capture is historical and no signed acquisition receipt was obtained. Do not use this module to retroactively recognize that Run as Original EARLY. Original EARLY, Freeze, marks, diamonds/warnings and D1 remain unchanged.

Tests exercise synthetic byte streams through Producer, signer, archive and verifier; invalid acquisition, wrong key, mutated receipt, deadlines and late completion remain HOLD. No live collector/public key has been deployed and no new real race has been captured by this PR.

Primary API reference: https://nodejs.org/api/webcrypto.html . Existing repository contracts: `CPSI_ACQUISITION_ATTESTATION_V1.md`, `CPSI_INDEX_EVIDENCE_V1.md`, `CPSI_PRE_PRODUCER_V1.md`.
