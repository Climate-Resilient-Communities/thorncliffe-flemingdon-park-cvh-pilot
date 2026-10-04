#!/usr/bin/env bash
# The gate of a preview, run from main's copy of scripts/ci (a branch cannot weaken it). Writes ready=true to GITHUB_OUTPUT
# only when, for the pull request that triggered the run:
#   - it is open, carries the label "preview", and its head is still the commit the event named (a newer push runs by itself);
#   - its head repository is this repository (never a fork: a fork's code must not get the preview environment's secrets);
#   - the head commit's "Checks" (this repository's CI workflow) succeeded. The push that made the commit started those checks
#     only moments ago, so a run that finds them pending waits, polling, up to PREVIEW_WAIT_SECONDS (default 1500).
# A preview is not a safety gate for production: when something cannot be confirmed the preview is skipped with a warning
# (or the run fails, when the checks failed) and production is unaffected.
set -euo pipefail

: "${GITHUB_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_OUTPUT:?}" "${PR_NUMBER:?}" "${HEAD_SHA:?}"
LABEL=${PREVIEW_LABEL:-preview}
wait_seconds=${PREVIEW_WAIT_SECONDS:-1500}
poll_seconds=${PREVIEW_POLL_SECONDS:-30}
here=$(dirname "$0")
# shellcheck source=lib.sh
. "$here/lib.sh"

body=$(mktemp)
trap 'rm -f "$body"' EXIT

skip() { # skip <reason>
  echo "::warning title=Vercel preview skipped::$1"
  echo "ready=false" >> "$GITHUB_OUTPUT"
  exit 0
}

status=$(gh_get "pulls/$PR_NUMBER" "$body")
if [ "$status" != 200 ]; then
  skip "Could not read pull request #$PR_NUMBER (HTTP $status), so no preview was deployed."
fi
if [ "$(jq -r '.state' "$body")" != open ]; then
  skip "Pull request #$PR_NUMBER is not open."
fi
if ! jq -e --arg l "$LABEL" '[.labels[].name] | index($l)' "$body" >/dev/null; then
  skip "Pull request #$PR_NUMBER does not carry the label \"$LABEL\"."
fi
head_repo=$(jq -r '.head.repo.full_name // ""' "$body")
if [ "$head_repo" != "$GITHUB_REPOSITORY" ]; then
  skip "Pull request #$PR_NUMBER comes from '${head_repo:-a deleted repository}', not from $GITHUB_REPOSITORY. Previews are never built for forks."
fi
current=$(jq -r '.head.sha' "$body")
if [ "$current" != "$HEAD_SHA" ]; then
  skip "Pull request #$PR_NUMBER has moved on to $current; the run for that commit builds its preview."
fi

waited=0
while :; do
  state=$(checks_state "$HEAD_SHA")
  case "$state" in
    success)
      echo "Checks succeeded for $HEAD_SHA."
      echo "ready=true" >> "$GITHUB_OUTPUT"
      exit 0
      ;;
    failure)
      echo "::error title=Vercel preview not built::The \"Checks\" of $HEAD_SHA did not succeed, so no preview was deployed."
      echo "ready=false" >> "$GITHUB_OUTPUT"
      exit 1
      ;;
    unknown)
      skip "Could not confirm a successful \"Checks\" run of this repository's CI workflow for $HEAD_SHA, so no preview was deployed."
      ;;
  esac
  if [ "$waited" -ge "$wait_seconds" ]; then
    skip "The \"Checks\" of $HEAD_SHA had not finished after ${wait_seconds}s. Apply the label \"$LABEL\" again (or push) once they pass."
  fi
  echo "Checks of $HEAD_SHA still pending; waited ${waited}s of ${wait_seconds}s."
  sleep "$poll_seconds"
  waited=$((waited + poll_seconds))
done
