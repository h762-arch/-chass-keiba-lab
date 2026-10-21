# CPSI acquisition attestation verification v1

Offline, default-OFF validation of an approved collector's Ed25519 signature. No network requests, credential access, capture/signing service, keys installed in production, app wiring or change to existing CPSI flags. It is a missing verification primitive, not completed provider authentication.

`verifyAcquisitionAttestation({enabled, archive, attestation, trustPolicy, sourceBytes, now})` consumes the immutable evidence archive from PR #290 and the raw provider response bytes. The trust policy is supplied separately by an authorized caller, never loaded from the evidence envelope. No default keys, auto-generated production keys, trust-on-first-use or issuer inferred from a URL label are accepted.

## Trust policy

The exact shape is `{format:'CHASS_CPSI_COLLECTOR_TRUST_V1',collectors:[...]}`. Each entry has exactly `collectorId`, globally unique `keyId`, `publicKeySpkiBase64` (44-byte Ed25519 SPKI), `allowedSourceUrls` (exact canonical HTTPS URLs), `validFrom`, `validUntil`, `revoked`. Bounds: 16 keys, 16 URLs per key. Key/collector identities and authorization must be established out of band; this library cannot prove who provisioned an object passed as trustPolicy. A production policy must not be derived from the archive or from a caller's self-declared public key. Revoked keys are refused even in historical review.

## Signed envelope

Exact top-level keys: `format:'CHASS_CPSI_ACQUISITION_ATTESTATION_V1'`, `algorithm:'Ed25519'`, `keyId`, `payload`, `signatureBase64` (64-byte signature).

Exact payload keys: `collectorId`, `sourceUrl`, `requestMethod:'GET'`, `httpStatus:200`, `acquiredAt`, `signedAt`, `receiptContentHash`, `sourceHash`, `imageSha256`, `providerBytesSha256` (raw-byte SHA-256 hex), `raceId`, `runId`.

Signed bytes are UTF-8 of the format string, newline, then existing stableSourceJson({keyId,payload}). This domain separation binds key selection and all claims. The verifier imports only the pinned public key; it has no signing capability or private key input. Tests generate synthetic ephemeral keys exclusively as test fixtures.

Acquired/signed timestamps are timezone-qualified. Signing must follow acquisition within 60 seconds, before post time and by the evidence archive's recording time, and within the pinned key validity interval. Acquisition must precede the receipt's index observation by at most 60 seconds. A newly signed assertion cannot retrospectively turn last night's screenshot into a proven original capture. No missing timestamp is populated. `now` bounds signature time, but the function is historical claim validation, not live PRE admission.

The provider response must be nonempty and <=1 MiB. Its exact hash is signed, as are the Run/receipt/source/image identities. The archive is fully revalidated using the existing verifier. Wrong issuer, revoked/expired key, unlisted URL, signature substitution, wrong bytes, wrong Run and inconsistent times cause HOLD with a stable reason. Missing signature or trust root also causes HOLD.

## Meaning of success

`COLLECTOR_SIGNATURE_VERIFIED_RESEARCH_ONLY` means the separately trusted collector signed these claims and the supplied bytes match its signed hash. It does not prove the collector genuinely fetched the HTTPS response, that image transcription matches the provider response, or that local clock claims are independently attested. No provider-specific parser is included. Compromise or dishonest provisioning of the trusted collector remains outside this verifier's assurance.

Success therefore preserves sourceOriginAuthenticated=false, formalKpiEligible=false, importable=false and Production NO-GO. Positive diagnostic fields are named collectorSignatureVerified, not source/provider authenticated. No production collector or policy is configured by this change. Formal source authentication still requires an approved acquisition service, independently established identity/time evidence, provider-content matching and an admission policy; model/probability/KPI qualification is a separate layer.

For existing Urawa1R materials, no actual signed collector acquisition receipt and approved trust policy have been obtained. The correct current result is HOLD / SIGNED_ACQUISITION_RECEIPT_MISSING. Do not sign the already assembled archive with a new local key and call that independent provider evidence.

Implementation uses the standard Web Crypto Ed25519 verify/importKey operations documented at https://nodejs.org/api/webcrypto.html . Existing EARLY, Freeze, marks, diamonds/warnings and D1 records remain unchanged.
