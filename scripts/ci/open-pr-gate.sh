#!/usr/bin/env bash
# Writes open=true to GITHUB_OUTPUT only when the pushed branch has an open pull
# request in this repository. Vercel's Hobby plan caps file uploads per day, so
# previews are limited to branches somebody is reviewing. A preview is not a
# safety gate: when the lookup fails the preview is skipped with a warning, and
# production is unaffected.
set -euo pipefail

: "${GITHUB_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_REF_NAME:?}"

body=$(mktemp)
trap 'rm -f "$body"' EXIT

owner=${GITHUB_REPOSITORY%%/*}
head=$(jq -rn --arg v "$owner:$GITHUB_REF_NAME" '$v|@uri')

status=$(curl -sS -o "$body" -w '%{http_code}' \
  -K <(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN") \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "${GITHUB_API_URL:-https://api.github.com}/repos/$GITHUB_REPOSITORY/pulls?state=open&per_page=1&head=$head" || true)

if [ "$status" = 200 ] && count=$(jq -er 'if type == "array" then length else empty end' "$body" 2>/dev/null); then
  if [ "$count" != 0 ]; then
    echo "open=true" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  echo "::notice title=Vercel preview skipped::Branch $GITHUB_REF_NAME has no open pull request. Open one and push again to get a preview."
else
  echo "::warning title=Vercel preview skipped::Could not check for an open pull request (HTTP $status), so no preview was deployed."
fi
echo "open=false" >> "$GITHUB_OUTPUT"
