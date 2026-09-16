# GitHub upload and PR draft

1. Create branch `chass/work-master-20260916` from `d9efc6e726f3c1849225de5eced91e25299b5cb4`.
2. Extract `CHASS_WORK_PATCH.zip` into repository root with directories preserved.
3. Commit the changed files; delete nothing.
4. Send the branch URL and commit SHA for independent review.
5. Create a PR only after review. Do not merge/deploy or apply D1 migrations yet.

PR body should state: feature flags remain OFF; migrations are local/dry-run only; 596 tests pass; JRA J1–J5 pass 62/62; `0006` is unchanged; no Google Drive runtime was added.
