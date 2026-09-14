from pathlib import Path

ROOT = Path(".")

def require_contains(path: str, *needles: str):
    p = ROOT / path
    if not p.is_file():
        raise SystemExit(f"missing expected file: {path}")
    text = p.read_text(encoding="utf-8")
    for needle in needles:
        if needle not in text:
            raise SystemExit(f"{path}: expected anchor not found: {needle}")
    return p, text

# 1) Result cache bridge -> runtime-only refresh.
result_path, result_old = require_contains(
    ".github/workflows/CHASS-JRA-Result-Cache-Bridge-v1.0.yml",
    "name: CHASS JRA Result Cache Bridge v1.0",
    "git push origin HEAD:main",
    "refresh_results:",
)

result_new = r'''name: CHASS JRA Result Cache Refresh v1.1

on:
  workflow_dispatch:
    inputs:
      date:
        description: "対象日。空欄なら日本時間の今日 (YYYY-MM-DD)"
        required: false
        default: ""
        type: string
      track:
        description: "競馬場。ALLは開催場すべて"
        required: true
        default: "ALL"
        type: choice
        options:
          - ALL
          - 札幌
          - 函館
          - 福島
          - 新潟
          - 東京
          - 中山
          - 中京
          - 京都
          - 阪神
          - 小倉
      race:
        description: "0は対象競馬場の全R"
        required: true
        default: "0"
        type: choice
        options: ["0","1","2","3","4","5","6","7","8","9","10","11","12"]
  schedule:
    - cron: "*/10 0-8 * * 6,0"

permissions:
  contents: read

concurrency:
  group: chass-jra-result-cache-refresh-v11
  cancel-in-progress: false

jobs:
  refresh_results:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      D1_DATABASE_NAME: chass-keiba-research-db
      PRODUCTION_BASE_URL: https://chass-keiba-lab7.h7625421.workers.dev
      INPUT_DATE: ${{ inputs.date }}
      INPUT_TRACK: ${{ inputs.track }}
      INPUT_RACE: ${{ inputs.race }}

    steps:
      - name: Checkout current main read-only
        uses: actions/checkout@v5
        with:
          ref: main
          fetch-depth: 1
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: 24

      - name: Verify installed result bridge
        shell: bash
        run: |
          set -euo pipefail
          test "$(node -p "require('./package.json').name")" = "chass-keiba-lab"
          test "$(node -p "require('./package.json').version")" = "10.0.1"
          test -f scripts/jra-official-result-refresh.mjs
          test -f jra-result-fetch.mjs
          test -f jra-official-cache.mjs
          grep -Fq "readJraOfficialResultCache" jra-result-fetch.mjs
          grep -Fq "export async function readJraOfficialResultCache" jra-official-cache.mjs
          node --check scripts/jra-official-result-refresh.mjs
          node --check jra-result-fetch.mjs
          node --check jra-official-cache.mjs

      - name: Authenticate Cloudflare
        shell: bash
        run: |
          set -euo pipefail
          test -n "${CLOUDFLARE_API_TOKEN:-}"
          test -n "${CLOUDFLARE_ACCOUNT_ID:-}"
          npx -y wrangler@4 whoami >/dev/null

      - name: Fetch published JRA results
        id: refresh
        shell: bash
        run: |
          set -euo pipefail

          if [ "${{ github.event_name }}" = "schedule" ]; then
            DATE_ARG=""
            TRACK_ARG="ALL"
            RACE_ARG="0"
          else
            DATE_ARG="${INPUT_DATE:-}"
            TRACK_ARG="${INPUT_TRACK:-ALL}"
            RACE_ARG="${INPUT_RACE:-0}"
          fi

          node scripts/jra-official-result-refresh.mjs \
            --date="$DATE_ARG" \
            --track="$TRACK_ARG" \
            --race="$RACE_ARG" \
            --strict=false \
            --out=/tmp/result.sql \
            --summary=/tmp/result-summary.json

          if [ -s /tmp/result.sql ] && grep -Eiq '^[[:space:]]*(BEGIN|COMMIT|SAVEPOINT|RELEASE)[[:space:];]' /tmp/result.sql; then
            echo "::error::Result cache SQL contains an explicit transaction statement."
            exit 1
          fi

          node - <<'NODE' >> "$GITHUB_OUTPUT"
          const x=require('/tmp/result-summary.json');
          console.log(`date=${x.date || ''}`);
          console.log(`targets=${Number(x.targetCount || 0)}`);
          console.log(`success=${Number(x.successCount || 0)}`);
          console.log(`pending=${Number(x.pendingCount || 0)}`);
          console.log(`failures=${Number(x.failureCount || 0)}`);
          const first=x.successes?.[0];
          if(first){
            console.log(`smoke_date=${first.date || x.date || ''}`);
            console.log(`smoke_track=${first.track || ''}`);
            console.log(`smoke_race=${Number(first.race || 0)}`);
          }
          NODE

      - name: Write published results to D1
        if: ${{ steps.refresh.outputs.success != '0' }}
        shell: bash
        run: |
          set -euo pipefail
          test -s /tmp/result.sql
          npx -y wrangler@4 d1 execute "$D1_DATABASE_NAME" \
            --remote \
            --file=/tmp/result.sql

      - name: Production D1 result smoke
        if: ${{ steps.refresh.outputs.success != '0' }}
        shell: bash
        run: |
          set -euo pipefail

          PASS=0
          for DELAY in 0 2 5 10; do
            [ "$DELAY" -eq 0 ] || sleep "$DELAY"

            : > /tmp/result-smoke.headers
            : > /tmp/result-smoke.json

            CODE="$(curl -sS --max-time 20 \
              -D /tmp/result-smoke.headers \
              --get "$PRODUCTION_BASE_URL/api/jra/result" \
              --data-urlencode "date=${{ steps.refresh.outputs.smoke_date }}" \
              --data-urlencode "track=${{ steps.refresh.outputs.smoke_track }}" \
              --data-urlencode "race=${{ steps.refresh.outputs.smoke_race }}" \
              -o /tmp/result-smoke.json \
              -w '%{http_code}' || true)"

            if [ "$CODE" = "200" ] && grep -qi '^x-chass-jra-result-cache: D1-HIT' /tmp/result-smoke.headers; then
              if node - <<'NODE'
          const x=require('/tmp/result-smoke.json');
          if(x.ok!==true) process.exit(1);
          if(x.organization!=='JRA') process.exit(1);
          if(!Array.isArray(x.finishOrder) || x.finishOrder.length<3) process.exit(1);
          if(x.bridgeCache?.kind!=='result') process.exit(1);
          NODE
              then
                PASS=1
                break
              fi
            fi
          done

          test "$PASS" = "1"

      - name: Summary
        if: always()
        shell: bash
        run: |
          {
            echo "## CHASS JRA Result Cache Refresh v1.1"
            echo
            echo "- Date: ${{ steps.refresh.outputs.date || 'unresolved' }}"
            echo "- Targets: ${{ steps.refresh.outputs.targets || '0' }}"
            echo "- Published results cached: ${{ steps.refresh.outputs.success || '0' }}"
            echo "- Before-post/unpublished: ${{ steps.refresh.outputs.pending || '0' }}"
            echo "- Fetch/parse failures: ${{ steps.refresh.outputs.failures || '0' }}"
            echo "- Repository source modification: NO"
            echo "- main direct push: NO"
            echo "- Production deploy: NO"
          } >> "$GITHUB_STEP_SUMMARY"
'''
result_path.write_text(result_new, encoding="utf-8")


# 2) Finalize/deploy -> source-immutable and explicit modes.
finalize_path, finalize_old = require_contains(
    ".github/workflows/finalize-deploy.yml",
    "name: Finalize CHASS D1 and deploy",
    "git push origin HEAD:main",
    "Apply pending D1 migrations",
)

finalize_new = r'''name: CHASS Production Finalize + Deploy v2.0

on:
  workflow_dispatch:
    inputs:
      mode:
        description: "validate_only / deploy / migrate_and_deploy"
        required: true
        default: "validate_only"
        type: choice
        options:
          - validate_only
          - deploy
          - migrate_and_deploy

permissions:
  contents: read

concurrency:
  group: chass-production-finalize-deploy-v20
  cancel-in-progress: false

jobs:
  finalize:
    runs-on: ubuntu-latest
    timeout-minutes: 25

    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      D1_DATABASE_NAME: chass-keiba-research-db
      PRODUCTION_BASE_URL: https://chass-keiba-lab7.h7625421.workers.dev
      MODE: ${{ inputs.mode }}

    steps:
      - name: Checkout main read-only
        uses: actions/checkout@v5
        with:
          ref: main
          fetch-depth: 1
          persist-credentials: false

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - name: Verify repository layout
        shell: bash
        run: |
          set -euo pipefail
          test -f migrations/0006_jra_background_refresh.sql
          test -f tests/jra-j5.test.mjs
          test -f tests/repository-layout.test.mjs
          test -f mcp/server.mjs
          test -f mcp/package.json
          test -f .gitignore

          test "$(node -p "require('./package.json').name")" = "chass-keiba-lab"
          test "$(node -p "require('./package.json').version")" = "10.0.1"
          test "$(node -p "require('./mcp/package.json').name")" = "chass-keiba-lab-mcp"

          test ! -f 0006_jra_background_refresh.sql
          test ! -f bridge-client.mjs
          test ! -f chass-tools.mjs

          test -z "$(git status --porcelain=v1)"
          echo "Repository layout OK"

      - name: Install dependencies
        run: |
          set -euo pipefail
          npm ci
          npm ci --prefix mcp

      - name: Run full regression check
        run: npm run check

      - name: Cloudflare authentication preflight
        if: ${{ inputs.mode != 'validate_only' }}
        shell: bash
        run: |
          set -euo pipefail
          test -n "${CLOUDFLARE_API_TOKEN:-}"
          test -n "${CLOUDFLARE_ACCOUNT_ID:-}"
          npx -y wrangler@4 whoami >/dev/null

      - name: Show pending D1 migrations
        if: ${{ inputs.mode == 'migrate_and_deploy' }}
        shell: bash
        run: |
          set -euo pipefail
          npx -y wrangler@4 d1 migrations list "$D1_DATABASE_NAME" --remote

      - name: Apply pending D1 migrations
        if: ${{ inputs.mode == 'migrate_and_deploy' }}
        shell: bash
        run: |
          set -euo pipefail
          npx -y wrangler@4 d1 migrations apply "$D1_DATABASE_NAME" --remote

      - name: Verify migration 0006 baseline
        if: ${{ inputs.mode == 'migrate_and_deploy' }}
        shell: bash
        run: |
          set -euo pipefail
          npx -y wrangler@4 d1 execute "$D1_DATABASE_NAME" \
            --remote \
            --command "SELECT name FROM d1_migrations WHERE name='0006_jra_background_refresh.sql';" \
            | tee /tmp/migration-check.txt
          grep -F "0006_jra_background_refresh.sql" /tmp/migration-check.txt

      - name: Deploy CHASS Worker
        if: ${{ inputs.mode == 'deploy' || inputs.mode == 'migrate_and_deploy' }}
        shell: bash
        run: |
          set -euo pipefail
          npx -y wrangler@4 deploy

      - name: Production smoke test
        if: ${{ inputs.mode == 'deploy' || inputs.mode == 'migrate_and_deploy' }}
        shell: bash
        run: |
          set -euo pipefail
          HEALTH_URL="$PRODUCTION_BASE_URL/api/chass/v1/public/health"

          PASS=0
          for DELAY in 0 3 6 10; do
            [ "$DELAY" -eq 0 ] || sleep "$DELAY"
            if curl -fsS --max-time 15 "$HEALTH_URL" -o /tmp/health.json; then
              if node - <<'NODE'
          const fs=require('fs');
          const x=JSON.parse(fs.readFileSync('/tmp/health.json','utf8'));
          if(x.ok!==true) process.exit(1);
          if(x.version && x.version!=='10.0.1') process.exit(1);
          NODE
              then
                PASS=1
                break
              fi
            fi
          done

          test "$PASS" = "1"

      - name: Final immutability check
        if: always()
        shell: bash
        run: |
          set -euo pipefail
          test -z "$(git status --porcelain=v1)"

      - name: Summary
        if: always()
        shell: bash
        run: |
          {
            echo "## CHASS Production Finalize + Deploy v2.0"
            echo
            echo "- Mode: \`${MODE}\`"
            echo "- Repository source modification: NO"
            echo "- main direct push: NO"
          } >> "$GITHUB_STEP_SUMMARY"
'''
finalize_path.write_text(finalize_new, encoding="utf-8")


# 3) AI snapshot publishing -> automatic work branch + PR.
snapshot_path, snapshot_old = require_contains(
    ".github/workflows/publish-ai-snapshot.yml",
    "name: Publish CHASS AI snapshot",
    "git push",
    "publish-ai-snapshot.mjs",
)

snapshot_new = r'''name: Publish CHASS AI snapshot v2.0 PR Safe

on:
  workflow_dispatch:
    inputs:
      date:
        description: "Snapshot date (YYYY-MM-DD)"
        required: true
        type: string
      track_slug:
        description: "ASCII track slug (for example kawasaki)"
        required: true
        default: kawasaki
        type: string

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: chass-ai-snapshot-${{ inputs.date }}-${{ inputs.track_slug }}
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout main baseline
        uses: actions/checkout@v5
        with:
          ref: main
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: 22

      - name: Validate inputs and create work branch
        id: branch
        shell: bash
        env:
          SNAPSHOT_DATE: ${{ inputs.date }}
          TRACK_SLUG: ${{ inputs.track_slug }}
        run: |
          set -euo pipefail

          printf '%s' "$SNAPSHOT_DATE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          printf '%s' "$TRACK_SLUG" | grep -Eq '^[a-z0-9][a-z0-9-]{1,39}$'

          BRANCH="chass/ai-snapshot-${SNAPSHOT_DATE}-${TRACK_SLUG}-${GITHUB_RUN_ID}"
          git checkout -b "$BRANCH"
          echo "name=$BRANCH" >> "$GITHUB_OUTPUT"

      - name: Fetch and validate snapshot
        env:
          SNAPSHOT_DATE: ${{ inputs.date }}
          TRACK_SLUG: ${{ inputs.track_slug }}
        run: |
          set -euo pipefail
          test -f publish-ai-snapshot.mjs
          node publish-ai-snapshot.mjs
          touch docs/.nojekyll

      - name: Validate snapshot-only changes
        id: diff
        shell: bash
        env:
          SNAPSHOT_DATE: ${{ inputs.date }}
          TRACK_SLUG: ${{ inputs.track_slug }}
        run: |
          set -euo pipefail

          TARGET="docs/ai-snapshot/${SNAPSHOT_DATE}/${TRACK_SLUG}.json"
          test -f "$TARGET"

          git add "$TARGET" docs/.nojekyll

          if git diff --cached --quiet; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          git diff --cached --check
          git diff --cached --name-only > /tmp/snapshot-changed.txt

          while IFS= read -r FILE; do
            case "$FILE" in
              "$TARGET"|docs/.nojekyll) ;;
              *)
                echo "::error::Unexpected snapshot change: $FILE"
                exit 20
                ;;
            esac
          done < /tmp/snapshot-changed.txt

          echo "changed=true" >> "$GITHUB_OUTPUT"

      - name: Commit and push work branch
        if: ${{ steps.diff.outputs.changed == 'true' }}
        id: commit
        shell: bash
        env:
          SNAPSHOT_DATE: ${{ inputs.date }}
          TRACK_SLUG: ${{ inputs.track_slug }}
        run: |
          set -euo pipefail

          test "${{ steps.branch.outputs.name }}" != "main"

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git commit -m "snapshot: ${SNAPSHOT_DATE} ${TRACK_SLUG}"
          SHA="$(git rev-parse HEAD)"
          git push origin "HEAD:${{ steps.branch.outputs.name }}"

          echo "sha=$SHA" >> "$GITHUB_OUTPUT"

      - name: Open pull request
        if: ${{ steps.diff.outputs.changed == 'true' }}
        id: pr
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
          SNAPSHOT_DATE: ${{ inputs.date }}
          TRACK_SLUG: ${{ inputs.track_slug }}
        run: |
          set -euo pipefail

          BODY=/tmp/snapshot-pr.md
          cat > "$BODY" <<EOF
          ## CHASS AI snapshot

          - Date: \`${SNAPSHOT_DATE}\`
          - Track: \`${TRACK_SLUG}\`
          - Commit: \`${{ steps.commit.outputs.sha }}\`

          ### Safety
          - main direct push: NO
          - snapshot-only allowlist: PASS
          - production deploy: NOT PERFORMED
          EOF

          set +e
          URL="$(gh pr create \
            --base main \
            --head "${{ steps.branch.outputs.name }}" \
            --title "CHASS AI snapshot: ${SNAPSHOT_DATE} ${TRACK_SLUG}" \
            --body-file "$BODY" 2>/tmp/snapshot-pr-error.log)"
          RC=$?
          set -e

          if [ "$RC" -ne 0 ]; then
            echo "::warning::Automatic PR creation was not permitted."
            cat /tmp/snapshot-pr-error.log || true
            echo "url=" >> "$GITHUB_OUTPUT"
            exit 0
          fi

          echo "url=$URL" >> "$GITHUB_OUTPUT"

      - name: Summary
        if: always()
        shell: bash
        run: |
          {
            echo "## Publish CHASS AI snapshot v2.0 PR Safe"
            echo
            echo "- Date: \`${{ inputs.date }}\`"
            echo "- Track: \`${{ inputs.track_slug }}\`"
            echo "- Changes: ${{ steps.diff.outputs.changed || 'unknown' }}"
            echo "- Work branch: \`${{ steps.branch.outputs.name || 'not_created' }}\`"
            echo "- main direct push: NO"
            if [ -n "${{ steps.pr.outputs.url }}" ]; then
              echo "- PR: ${{ steps.pr.outputs.url }}"
            elif [ "${{ steps.diff.outputs.changed }}" = "true" ]; then
              echo "- PR: automatic creation unavailable; open the branch PR manually."
            else
              echo "- PR: not needed (snapshot unchanged)"
            fi
          } >> "$GITHUB_STEP_SUMMARY"
'''
snapshot_path.write_text(snapshot_new, encoding="utf-8")

print("Batch7 safety patch prepared.")
