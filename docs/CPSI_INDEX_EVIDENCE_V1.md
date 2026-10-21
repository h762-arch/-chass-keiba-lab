# CPSI raw index evidence archive v1

Explicit local archival command. No app/Worker/Drive/D1 wiring and no change to the existing Producer or source contract. Links original PNG bytes, exact receipt JSON text, exact raw transcription JSON text, versioned conversion decisions, Run identity and canonical source hash. It always reports research-only, non-importable and sourceOriginAuthenticated=false.

This is retrospective local evidence linkage. The existing Producer receipt is verified at its stored Freeze for historical consistency, even after the race. This never grants current PRE admission, creates another Run, or changes an existing EARLY/Freeze. Archive recordedAt is the current local archive creation time, not an independently verified image capture/provider acquisition time.

## Raw transcription contract

```json
{
  "format":"CHASS_CPSI_RAW_TRANSCRIPTION_V1",
  "ruleVersion":"RAW_SEVEN_STAR_HELD_V1",
  "imageSha256":"actual-64-character-raw-PNG-SHA256",
  "raceId":"actual-race-id-from-receipt",
  "method":"MANUAL_TRANSCRIPTION",
  "rows":[{
    "horseNo":1,"horseName":"actual-official-name","canonicalHorseKey":"actual-key-from-receipt",
    "raw":{"highest":"0","average_5":"4*","distance":"0","course":"-1","three_runs_ago":"-","two_runs_ago":"未","previous_run":"-2"}
  }]
}
```

Illustration only; real full roster, image hash and values are required. No row can be missing, duplicated or changed relative to the receipt. Canonical keys and names match receipt/archived official identities and index observation. Five raw columns map to peak/baseline5/distance/course/prev. Current must remain null because it is not present in this seven-column image. Two older runs remain raw-only evidence.

Rules are deliberately narrow: safe integer text remains numeric, zero and negative values are valid; `-` and `未` remain distinct raw missing labels and adopt null; star is allowed only on average_5, records a numeric candidate, and adopts null. Exact meaning of star is not certified. No star stripping policy, probability, market, result or authorized D–G scorer is synthesized. Unsupported fields, symbols and rule versions are rejected. A legitimate receipt with a Current from another source needs a future separately specified evidence contract; this command refuses to attribute that Current to an image lacking it.

## Command

```sh
node scripts/archive-cpsi-index-evidence-v1.mjs --enabled --receipt-file /path/receipt.json --image-file /path/image.png --transcription-file /path/raw.json --output-dir /path/new-evidence
```

Default OFF performs no file/network work. Enabled reads are bounded and file metadata is checked before/after using the same open file handle. Input text must decode as UTF-8. PNG is stored as bounded opaque bytes with a PNG signature check; this is not full image decoding or an automatic visual transcription check. Maximum PNG 768 KiB, transcription 128 KiB, receipt 1.5 MB; the existing canonical-hash total limit also applies.

Every invocation creates a unique `CPSI-EVIDENCE-<uuid>/evidence.json` using exclusive creation. Original files are never overwritten. Only after a separate physical read and full revalidation does it return LOCAL_INDEX_EVIDENCE_READBACK_VERIFIED. A partial write/read failure leaves a quarantined directory with no success result. A generic store adapter must implement insertIfAbsent that resolves true only after commit, then an independent get; its authenticity is not proven by the library. CLI readback scope is LOCAL_FILESYSTEM.

The archive content hash uses existing canonical JSON; PNG sha256 uses raw bytes. Exact receipt/transcription text and PNG bytes are retained. Every readback recalculates decisions and checks raw-to-receipt mappings. Creating an archive does not prove a human transcribed the image correctly, that the PNG came from the stated provider, or that local clock claims are authentic. Coordinated rewrites of all bytes/hashes are not prevented without a trusted attestation/signature.

No production activation or source-origin verifier is introduced. Official provider acquisition identity/time and an approved trust contract remain separate future work. Existing EARLY, frozen marks, 💎/⚠️ and D1 records are untouched.
