#!/usr/bin/env bash
# Runs what the three checks jobs of .github/workflows/checks.yml (Static, Database,
# Browser; ci.yml's "Checks" needs all three) run, one after the other in that order,
# with the same commands, flags and environment, so nothing is pushed that CI
# will reject. Run it on the merged result (the branch must contain origin/main).
#
#   npm run ci:local [-- --install] [-- --allow-unmerged]
#
#   --install         run `npm ci` (CI does); default only verifies node_modules
#   --require-merged  fail unless HEAD contains origin/main (default)
#   --allow-unmerged  only warn about that, for quick local runs
#
# The step lines below (`step`, `always_step`, `replaced_step`) are compared with
# checks.yml by test/ci-local.test.ts: add a step to one and it fails until the
# other has it. The tested-tree skip, the Vercel preview and production jobs need
# GitHub and secrets and are not run here.
set -euo pipefail

POSTGRES_IMAGE=supabase/postgres:17.11.0.002
SMOKE_PORT=3000

INSTALL=0
REQUIRE_MERGED=1
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    --require-merged) REQUIRE_MERGED=1 ;;
    --allow-unmerged) REQUIRE_MERGED=0 ;;
    -h | --help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "ci:local: unknown option $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
START_SECONDS=$SECONDS

# --- cleanup: the database container and temp files, whatever happens --------
CONTAINER=
RUNNER_TEMP=$(mktemp -d)
cleanup() {
  local code=$?
  trap - EXIT
  if [ -n "$CONTAINER" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
  rm -rf "$RUNNER_TEMP"
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

die() { echo "ci:local: $*" >&2; exit 2; }
warn() { printf '\n!!!!!!!! ci:local WARNING: %s\n\n' "$*" >&2; }

# --- preflight ---------------------------------------------------------------
echo "ci:local: the Vercel preview and production jobs need secrets and are not run here; the tested-tree skip is not applied (everything runs)."

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" != 22 ]; then
  warn "CI runs Node 22; this is Node $(node -v)."
fi

if [ -n "$(git status --porcelain)" ]; then
  warn "uncommitted changes: they are checked here, but CI only sees what is pushed."
fi

# Full history is needed by db:check-destructive, which compares with origin/main.
if git fetch origin main; then
  if ! git merge-base --is-ancestor origin/main HEAD; then
    if [ "$REQUIRE_MERGED" = 1 ]; then
      die "HEAD does not contain origin/main ($(git rev-parse --short origin/main)): merge or rebase it first, or pass --allow-unmerged."
    fi
    warn "HEAD does not contain origin/main ($(git rev-parse --short origin/main)); CI checks the pushed branch, so results here can differ."
  fi
else
  [ "$REQUIRE_MERGED" = 1 ] && die "could not fetch origin main; cannot tell whether the branch is merged (--allow-unmerged to continue)."
  warn "could not fetch origin main; db:check-destructive compares with a possibly stale origin/main."
fi

verify_install() {
  node -e '
    const fs = require("fs");
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")).packages;
    let hidden;
    try { hidden = JSON.parse(fs.readFileSync("node_modules/.package-lock.json", "utf8")).packages; }
    catch { console.error("node_modules is missing or has no .package-lock.json"); process.exit(1); }
    const problems = [];
    for (const [key, entry] of Object.entries(lock)) {
      if (key === "") continue;
      const installed = hidden[key];
      if (!installed) { if (!entry.optional && !entry.os && !entry.cpu) problems.push("not installed: " + key); continue; }
      if (installed.version !== entry.version) problems.push(key + ": installed " + installed.version + ", lockfile " + entry.version);
    }
    for (const key of Object.keys(hidden)) if (!(key in lock)) problems.push("not in package-lock.json: " + key);
    if (problems.length) { console.error(problems.slice(0, 20).join("\n")); process.exit(1); }
  ' || { echo "node_modules does not match package-lock.json: run npm run ci:local -- --install" >&2; return 1; }
  npm ls --all >/dev/null || { echo "npm ls reports a problem: run npm run ci:local -- --install" >&2; return 1; }
}
install_or_verify() { if [ "$INSTALL" = 1 ]; then npm ci; else verify_install; fi; }

if (echo >"/dev/tcp/127.0.0.1/$SMOKE_PORT") 2>/dev/null; then
  die "port $SMOKE_PORT is in use; the smoke check starts the production server there."
fi
command -v docker >/dev/null || die "docker is required for the disposable database and the pinned Playwright image."

# --- the disposable database (CI's service container) --------------------------
DB_PORT=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
CONTAINER="ci-local-postgres-$$"
echo "ci:local: starting $POSTGRES_IMAGE as $CONTAINER on port $DB_PORT"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -p "127.0.0.1:$DB_PORT:5432" \
  --health-cmd "pg_isready -U postgres -h 127.0.0.1" \
  --health-interval 5s \
  --health-timeout 5s \
  --health-retries 30 \
  "$POSTGRES_IMAGE" >/dev/null
for _ in $(seq 1 40); do
  health=$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER")
  [ "$health" = healthy ] && break
  [ "$health" = unhealthy ] && { docker logs "$CONTAINER" >&2; die "the database container is unhealthy."; }
  sleep 5
done
[ "$health" = healthy ] || die "the database container did not become healthy in time."

# --- the job's environment ---------------------------------------------------
export CI=true
export CI_DATABASE_URL="postgres://postgres:postgres@localhost:$DB_PORT/postgres"
export GITHUB_SHA
GITHUB_SHA=$(git rev-parse HEAD)
export GITHUB_STEP_SUMMARY="$RUNNER_TEMP/step-summary.md"

# --- steps, in the order of the three jobs (Static, Database, Browser) ------------
names=()
codes=()
notes=()
failed=0

record() { names+=("$1"); codes+=("$2"); notes+=("$3"); }

run_it() {
  local label=$1 code=0
  shift
  printf '\n==> %s\n' "$label"
  "$@" || code=$?
  [ "$code" = 0 ] || failed=1
  record "$label" "$code" ""
}

# Like a CI step: skipped once an earlier step has failed.
step() {
  if [ "$failed" = 1 ]; then
    printf '\n==> %s (skipped: an earlier step failed)\n' "$*"
    record "$*" "-" "skipped, an earlier step failed"
    return 0
  fi
  run_it "$*" "$@"
}

# `if: ${{ !cancelled() }}`: runs even when an earlier step failed.
always_step() { run_it "$*" "$@"; }

# A CI step that cannot run as is here: the first argument is the CI command,
# the rest is what runs instead.
replaced_step() {
  local label=$1
  shift
  if [ "$failed" = 1 ]; then
    printf '\n==> %s (skipped: an earlier step failed)\n' "$label"
    record "$label" "-" "skipped, an earlier step failed"
    return 0
  fi
  run_it "$label (as: $*)" "$@"
}

# Static. (Each CI job runs `npm ci` on its own runner; here one install serves all three.)
replaced_step 'npm ci' install_or_verify
step npm run lint
step npm run typecheck
step npm run check:tokens
step npm run check:spacing
step npm run check:layout
step npm run check:layers
step npm run check:logical
step npm test
step npm run lint:deps
always_step npm run check:strings

# Database.
MIGRATE_DATABASE_URL="$CI_DATABASE_URL" step npm run db:migrate -- --removals-report "$RUNNER_TEMP/migration-removals.json"
MIGRATE_DATABASE_URL="$CI_DATABASE_URL" step npm run db:check
TEST_DATABASE_URL="$CI_DATABASE_URL" step npm run test:db
# On main HEAD is origin/main, so the base is its first parent. (The workflow uses the commit before
# the push instead, to cover a multi-commit push; locally there is no push, so one commit is all there is.)
base=origin/main
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then base=HEAD~1; fi
# A contract note needs the production release, so set PRODUCTION_URL to the production app's URL to check it.
PRODUCTION_URL="${PRODUCTION_URL:-}" step npm run db:check-destructive -- --base "$base" --removals "$RUNNER_TEMP/migration-removals.json"

# Browser. The layout, staff, resident and Hub suites run in the pinned Playwright image (scripts/*-docker.sh), as in CI.
APP_VERSION="$GITHUB_SHA" step npm run build
CI=true step npm run test:layout:docker
CI=true STAFF_TEST_DATABASE_URL="$CI_DATABASE_URL" step npm run test:staff:docker
CI=true always_step npm run test:resident:docker
CI=true always_step npm run test:hub:docker
EXPECTED_VERSION="$GITHUB_SHA" step npm run test:smoke

# --- result ------------------------------------------------------------------
if [ -s "$GITHUB_STEP_SUMMARY" ]; then
  printf '\n--- job summary (check:strings) ---\n'
  cat "$GITHUB_STEP_SUMMARY"
fi
printf '\n%-4s %-6s %s\n' '#' 'exit' 'step'
for i in "${!names[@]}"; do
  printf '%-4s %-6s %s%s\n' "$((i + 1))" "${codes[$i]}" "${names[$i]}" "${notes[$i]:+  [${notes[$i]}]}"
done
printf '\nTotal runtime: %ss\n' "$((SECONDS - START_SECONDS))"
if [ "$failed" = 1 ]; then
  echo "ci:local: FAILED: CI would reject this."
  exit 1
fi
echo "ci:local: all Static, Database and Browser steps passed."
