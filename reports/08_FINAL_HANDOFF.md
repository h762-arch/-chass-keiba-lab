# 08 Final Handoff

Recommended branch: `chass/work-master-20260916`.

Do not upload v1. After independent audit, use only `CHASS_WORK_PATCH_v2.zip` at repository root, preserving paths. No file deletions are required. Suggested commit sequence:

1. `fix/nar: recognize JRA-origin horses in NAR exchange races`
2. `feat/audit: add historical race identity and eligibility tooling`
3. `feat/prediction: add precomputed snapshot foundation behind off flags`
4. `feat/research: add model governance foundation`
5. `docs: add audit and regression handoff reports`

Do not apply migrations remotely, create a PR, merge, deploy, or enable the new flags in this phase.

PRE-PR correction results: 126 normalized races, 5 unresolved source rows, 2 aggregate/day audit notes, and 2 conceptual duplicates resolved. Sheets readback found zero malformed normalized IDs, zero serial-date remnants, zero invalid organization values, and zero duplicate normalized IDs.

Proposed PR title: `CHASS Work Master: exchange recognition, audit, precompute and governance foundations`

Known limitation: external Drive artifacts outside the archive master are metadata-inventoried but not automatically migrated because pre-race timestamp authenticity is not yet proven. This is intentionally fail-closed.
