#!/usr/bin/env bash
# Writes current=true to GITHUB_OUTPUT only when GITHUB_SHA is still the head of
# main. Workflow concurrency does not guarantee run order, and a re-run can be
# for an old commit, so an older commit must never reach production.
set -euo pipefail

: "${GITHUB_SHA:?}"
if ! refs=$(git ls-remote origin refs/heads/main); then
  refs=
fi
head=$(cut -f1 <<< "$refs")
if [ -z "$head" ]; then
  echo "::error title=Production not deployed::Could not read the head of main."
  exit 1
fi
if [ "$head" = "$GITHUB_SHA" ]; then
  echo "current=true" >> "$GITHUB_OUTPUT"
else
  echo "::warning title=Production not deployed::$GITHUB_SHA is no longer the head of main ($head); the newer commit's run deploys."
  echo "current=false" >> "$GITHUB_OUTPUT"
fi
