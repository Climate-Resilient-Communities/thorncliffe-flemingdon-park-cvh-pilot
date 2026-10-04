#!/usr/bin/env bash
# Runs the layout tests (playwright.layout.config.ts) inside the pinned Playwright image, the one scripts/resident-docker.sh and
# scripts/hub-docker.sh use, so the runner never needs `npx playwright install`. They render static HTML with page.setContent: no
# server, no database, no network. CI and `npm run test:layout:docker` both run this script; arguments go to `playwright test`.
#
# The tag is the exact @playwright/test version (test/resident-image.test.ts keeps the two equal). node_modules comes from the host
# (the same linux x64).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/test-results"

exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e CI \
  -v "$root:/work" -w /work \
  "$IMAGE" \
  node_modules/.bin/playwright test -c playwright.layout.config.ts "$@"
