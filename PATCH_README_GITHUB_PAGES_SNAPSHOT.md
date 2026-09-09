# CHASS GitHub Pages Snapshot Mirror Patch

This patch does not change the Worker, D1, prediction logic, or `ability-compact-v1` schema.
It adds a manually triggered GitHub Actions workflow that fetches the existing Worker snapshot,
validates it, and commits a static JSON copy under `docs/ai-snapshot/`.

## Apply

Copy these paths to the repository root:

- `.github/workflows/publish-ai-snapshot.yml`
- `scripts/publish-ai-snapshot.mjs`
- `docs/.nojekyll`

Push the files to the default branch.

## One-time GitHub settings

1. Settings > Actions > General > Workflow permissions
2. Select **Read and write permissions**
3. Settings > Pages > Build and deployment
4. Select **Deploy from a branch**
5. Select the default branch and `/docs`

## Publish the current snapshot

1. Open Actions > Publish CHASS AI snapshot
2. Select **Run workflow**
3. Enter `2026-09-09` and `kawasaki`
4. Run once and wait for success

Expected public URL:

`https://h762-arch.github.io/-chass-keiba-lab/ai-snapshot/2026-09-09/kawasaki.json`

## Safety

- The workflow is manual; it does not poll D1 or the Worker.
- One run performs one GET against the existing cached snapshot endpoint.
- Invalid JSON, a schema mismatch, count mismatch, or payload over 100KB stops publication.
- Existing snapshot files are only replaced after successful validation.
- The workflow commits only when the snapshot content changed.
