# CHASS v2.22 Web/Worker Course Shadow Boundary v1

**Target:** existing CHASS v2.22 course assets already committed to main. **No asset CSVs are modified.**

## Architecture

- `course-asset-core-v1.mjs`: pure resolver and schema check, no Node imports. Existing Node resolver delegates to this core only *after* its own verified-assets WeakSet gate.
- `course-asset-web-adapter-v1.mjs`: same-origin static fetch; Web Crypto SHA-256 validates an **independently pinned manifest hash** and the exact three CSVs, rejects changed URL, redirects, HTML 200, invalid schema and forbidden POST/Forward dataset roles.
- `course-shadow-preflight-v1.mjs`: extracts only PRE static race identity; a RESULT-bearing object fails closed; missing turf `railVariant` returns `COURSE_RAIL_VARIANT_REQUIRED`, never assumes A. Only verified, matching Profile identity produces a course hint.
- `course-asset-worker-adapter-v1.mjs`: optional Worker adapter via `env.ASSETS.fetch` only. **Not** exposed as public HTTP endpoint and **not** automatically attached to the Production prediction pipeline.
- `.assetsignore`: permits exactly three extra browser `.mjs` files, while keeping Node resolver, Worker adapter and all other internal modules hidden.
- `jra-browser-bootstrap.mjs`: makes `window.CHASS_COURSE_SHADOW_PREFLIGHT.evaluate` available before `app.js` loads. This exposes an opt-in Shadow API only; no auto-run or forecast mutation.

## Reviewed PRE Coverage contract

Node, browser and Worker expose only the same seven static NAR inventory counts,
with nonnegative safe-integer `value` fields. Coverage validation/Forward metrics,
production readiness, status, gate, timestamps and free-text notes are excluded
from PRE output. Invalid counts are omitted rather than returned as strings.
Regression tests cover forbidden fields, invalid counts and Web/Worker parity
with the existing Node contract. Asset CSVs and the pinned manifest are unchanged.

## Critical rail limitation

Existing race Snapshots do not contain authenticated `railVariant`. With JRA turf the Shadow therefore emits **HOLD**, not `JRA_..._A_...` even though the static asset currently contains only A profiles. Supplying official rail evidence and freezing it in a new **pre-result Snapshot revision** is a separate upstream change. A race after result publication cannot be retrofitted into EARLY.

## Scope and authority

This is a **wiring boundary / unit-tested Shadow adapter**, NOT a proven deployed Browser/Worker preprediction integration. The standalone `shadowThenGenerate()` function is a test harness demonstrating evaluation-before-generation with zero prediction modifications; the live UI and Worker prediction generator have **not** been hooked into it. Do not describe this as Production Ready.

- Formal KPI = **HOLD**
- AI win/place probability = **MODEL_HOLD**
- Production = **NO-GO**
- No marks/EV/Final5/ticket changes
- No D1 writes, no EARLY mutation, no Forward/RESULT leakage
- An actual staging deployment and end-to-end network smoke test are pending.

## How to validate

```bash
node --test tests/course-web-worker-shadow-v1.test.mjs
node --test tests/browser-asset-boundary.test.mjs
node --test tests/course-asset-runtime-v1.test.mjs
npm run check
```

All tests run with mocked same-origin Fetch and a synthetic Worker `ASSETS` binding, not an actual Cloudflare deployment. The Patch PR Bridge requires `npm run check` before opening a PR.

## Next prerequisites before Production

1. Add trusted `railVariant` acquisition + cutoff/authority provenance into the true PRE Snapshot; no inferred A rail.
2. Wire the Shadow boundary into the actual PRE generation lifecycle, without modifying frozen EARLY or replacing it with T15/T5.
3. Confirm `.assetsignore` in deployed Cloudflare Worker and HTTP response content types, and verify a staging network smoke.
4. Run forward-only holdout evaluation; pass the existing readiness/KPI and Change Control gates.
