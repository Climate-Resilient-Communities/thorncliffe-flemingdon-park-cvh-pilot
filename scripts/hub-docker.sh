#!/usr/bin/env bash
# Runs the Hub shell's screenshot tests (playwright.hub.config.ts) inside the one image whose operating system
# renders the baseline screenshots, the image scripts/resident-docker.sh uses. The text rasteriser (freetype,
# fontconfig) and the system fonts belong to the OS, so baselines made on another OS differ. The Latin text is set in
# the self-hosted Public Sans (the harness inlines src/app/staff/fonts.generated.css with the files as data URIs and
# fails unless the face has loaded); the system fonts still draw the glyphs it lacks, such as Urdu. CI and
# `npm run test:hub:docker` both run this script; arguments go to `playwright test`.
#
# The tag is the exact @playwright/test version (test/resident-image.test.ts keeps the two equal). The image
# holds the Chromium that version expects. node_modules comes from the host (the same linux x64).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/test-results"
# Next's data cache in .next/cache may hold a building list from an earlier run in the same folder (the staff tests' server, with its
# database); these tests have no database and expect none. They start with an empty cache (as scripts/resident-docker.sh does).
rm -rf "$root/.next/cache/fetch-cache"

# HUB_PINNED_IMAGE is what lets the screenshot assertions run (e2e/hub/helpers.ts).
exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e HUB_PINNED_IMAGE=1 \
  -e CI \
  -v "$root:/work" -w /work \
  "$IMAGE" \
  node_modules/.bin/playwright test -c playwright.hub.config.ts "$@"
