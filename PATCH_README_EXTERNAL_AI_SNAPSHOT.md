# EXTERNAL AI SNAPSHOT API patch

Replace the included files at the project root, then deploy the Worker using the project’s normal Cloudflare deployment procedure.

Included:

- `worker.js` — fixed-path snapshot endpoint and cache headers
- `tests/public-read-only-api.test.mjs` — endpoint, stability, identity, HEAD, validation, and read-only tests
- `EXTERNAL_AI_SNAPSHOT_API_REPORT.md` — behavior and local verification report

Production URL after deployment:

`https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/ai-snapshot/2026-09-09/kawasaki.json`

Verification:

```sh
npm test
curl -i 'https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/ai-snapshot/2026-09-09/kawasaki.json'
curl -I 'https://chass-keiba-lab7.h7625421.workers.dev/api/chass/v1/public/ai-snapshot/2026-09-09/kawasaki.json'
```

Expected after production deployment: HTTP 200, JSON content type, stable ETag, byte count below 100,000, and the same race/horse ability data as `day-ai?format=compact`.

This endpoint is intended to improve external fetch compatibility. It cannot guarantee the behavior of ChatGPT’s external retrieval cache.
