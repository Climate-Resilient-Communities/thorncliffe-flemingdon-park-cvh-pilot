#!/usr/bin/env bash
# Runs the resident page tests (playwright.resident.config.ts) inside the one image whose operating system
# renders the baseline screenshots. Fonts are self-hosted, but the text rasteriser (freetype, fontconfig) and
# the system fallback fonts belong to the OS, so baselines made on another OS differ by 1 to 2 percent of
# their pixels. CI and `npm run test:resident:docker` both run this script; arguments go to `playwright test`.
#
# The tag is the exact @playwright/test version (test/resident-image.test.ts keeps the two equal). The image
# holds the Chromium that version expects. node_modules and .next come from the host (the same linux x64).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/test-results"
# The servers these tests start read Next's data cache in .next/cache, which an earlier run in the same folder (the staff tests' server, with
# its database) may have filled: a building list from that run would be served to these tests, which have no database and expect the list
# to be unavailable. They start with none.
rm -rf "$root/.next/cache/fetch-cache"

# RESIDENT_PINNED_IMAGE is what lets the screenshot assertions run (e2e/resident/helpers.ts).
exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e RESIDENT_PINNED_IMAGE=1 \
  -e CI -e E2E_PORT -e E2E_ALERTS_PORT \
  -v "$root:/work" -w /work \
  "$IMAGE" \
  node_modules/.bin/playwright test -c playwright.resident.config.ts "$@"
