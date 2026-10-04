#!/usr/bin/env bash
# Runs the staff sign-in end-to-end tests (playwright.staff.config.ts) inside the pinned Playwright image, the one
# scripts/resident-docker.sh uses, so the runner never needs `npx playwright install`. They need the production build (`npm run build`
# first; .next and node_modules are the host's, the same linux x64) and a disposable database given as STAFF_TEST_DATABASE_URL (as its
# owner; scripts/e2e/staff-server.mjs migrates it). The server and the browser both run in the container; only the database is
# outside, so the container shares the host's network (`--network host`, Linux only) and reaches it at localhost, where the CI
# service container and `npm run ci:local` publish it. CI and `npm run test:staff:docker` both run this script; arguments go to
# `playwright test`.
#
# The tag is the exact @playwright/test version (test/resident-image.test.ts keeps the two equal).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

: "${STAFF_TEST_DATABASE_URL:?a disposable database, as its owner (it is migrated and written to)}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/test-results"
# Next's data cache in .next/cache may hold answers of an earlier run in the same folder; the staff tests start with none
# (the resident and Hub scripts do the same).
rm -rf "$root/.next/cache/fetch-cache"

exec docker run --rm --init --ipc=host --network host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI -e E2E_STAFF_PORT -e STAFF_TEST_DATABASE_URL \
  -v "$root:/work" -w /work \
  "$IMAGE" \
  node_modules/.bin/playwright test -c playwright.staff.config.ts "$@"
