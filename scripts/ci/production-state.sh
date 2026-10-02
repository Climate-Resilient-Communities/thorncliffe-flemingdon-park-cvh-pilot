#!/usr/bin/env bash
# Prints "present <deployment id>" when the configured Vercel project serves
# PRODUCTION_URL, or "empty" when the project has no production deployment at
# all. Anything else exits non-zero: the state is unknown and callers must not
# treat it as either answer.
set -euo pipefail

: "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}" "${PRODUCTION_URL:?}"

body=$(mktemp)
trap 'rm -f "$body"' EXIT

# Prints the HTTP status of a Vercel API GET (000 when no response arrived).
api() {
  curl -sS -o "$body" -w '%{http_code}' \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$VERCEL_TOKEN") \
    "https://api.vercel.com$1" || true
}

host=${PRODUCTION_URL#https://}
host=${host%%/*}

status=$(api "/v4/aliases/$host?teamId=$VERCEL_ORG_ID")
case "$status" in
  200)
    project=$(jq -r '.projectId // empty' "$body")
    deployment=$(jq -r '.deploymentId // empty' "$body")
    if [ "$project" != "$VERCEL_PROJECT_ID" ]; then
      echo "$host is not assigned to project $VERCEL_PROJECT_ID (found '${project:-none}')." >&2
      exit 1
    fi
    if [ -z "$deployment" ]; then
      echo "$host has no deployment assigned." >&2
      exit 1
    fi
    echo "present $deployment"
    ;;
  404)
    status=$(api "/v7/deployments?projectId=$VERCEL_PROJECT_ID&target=production&limit=1&teamId=$VERCEL_ORG_ID")
    if [ "$status" != 200 ]; then
      echo "Listing production deployments failed (HTTP $status)." >&2
      exit 1
    fi
    count=$(jq -er '.deployments | length' "$body")
    if [ "$count" != 0 ]; then
      echo "The project has production deployments, but $host is not assigned to any." >&2
      exit 1
    fi
    echo "empty"
    ;;
  *)
    echo "Looking up $host failed (HTTP $status)." >&2
    exit 1
    ;;
esac
