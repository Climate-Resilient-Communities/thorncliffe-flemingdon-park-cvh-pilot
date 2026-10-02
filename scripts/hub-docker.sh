#!/usr/bin/env bash
# Runs the Hub shell's screenshot tests (playwright.hub.config.ts) inside the one image whose operating system
# renders the baseline screenshots, the image scripts/resident-docker.sh uses. The text rasteriser (freetype,
# fontconfig) and the system fonts belong to the OS, and the Hub's pages declare no web font, so baselines made
# on another OS differ. CI and `npm run test:hub:docker` both run this script; arguments go to `playwright test`.
#
# The tag is the exact @playwright/test version (test/resident-image.test.ts keeps the two equal). The image
# holds the Chromium that version expects. node_modules comes from the host (the same linux x64).
set -euo pipefail

IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$root/test-results"

# HUB_PINNED_IMAGE is what lets the screenshot assertions run (e2e/hub/helpers.ts).
exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  -e HOME=/tmp \
  -e HUB_PINNED_IMAGE=1 \
  -e CI \
  -v "$root:/work" -w /work \
  "$IMAGE" \
  node_modules/.bin/playwright test -c playwright.hub.config.ts "$@"
