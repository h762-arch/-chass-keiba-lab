# GitHub upload and PR draft

1. Use branch `chass/work-master-20260916-bran` created from baseline `d9efc6e726f3c1849225de5eced91e25299b5cb4`.
2. Apply only `CHASS_WORK_PATCH_v2.zip` through the temporary `CHASS-Apply-Work-Patch-v2.yml` workflow. The workflow verifies the fixed SHA-256 and exact 33-file whitelist before expansion.
3. The transport ZIP and temporary workflow must be removed before the final PR diff. The final PR must contain exactly the approved 33 PATCH files.
4. Send the branch URL and final commit SHA for independent review.
5. Create the PR only after review. Do not deploy or apply production D1 migrations as part of this PR.

PR body should state: feature flags remain OFF; migrations are local/dry-run only; `npm run check` passes 604/604; JRA J1–J5 pass 62/62; `0006` is unchanged; no Google Drive runtime was added; no production model promotion was performed.
