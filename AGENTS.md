# CHASS development and test protocol

Use current main and the current CHASS integration rules. Preserve Original EARLY predictions, frozen marks, 💎/⚠️ signals and production D1 data. Never rewrite evidence to satisfy tests.

1. During small changes, use `npm test` (all local diff kinds) or `node scripts/run-affected-tests.mjs --staged` (Bridge). This runs changed JS syntax and verified direct/transitive test consumers. Unknown impact falls back to `npm run check`. Report targeted success as targeted only.
2. For final integration, run `npm run check` (syntax + full repository tests). Draft PRs are for iteration. Mark ready only for final verification; wait for CHASS Full Integration Gate v1 to pass at the current PR head and main base before merging. Recheck when either SHA changes. Never bypass failures or treat a skipped job as full success.
3. Before production validation/deploy, preserve the full `npm run check` in finalize-deploy.yml. Do not deploy/migrate while failing.
4. State scope, test files/results, base/head SHA and whether GitHub full integration passed. Distinguish local environment blockers from product failures and do not invent counts.

See docs/TEST_STRATEGY.md for conservative fallbacks, manual revalidation and rollout. The first rollout changes workflows and dependencies and requires full integration verification. No production operation is authorized merely by a test-policy change.
