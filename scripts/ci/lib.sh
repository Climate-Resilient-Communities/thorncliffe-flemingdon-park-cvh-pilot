#!/usr/bin/env bash
# Shared by the trusted CI gates (tested-tree.sh, preview-ready.sh). Sourced, never run.
# The gates run from main's copy of scripts/ci, so a branch cannot change what they decide.

CI_WORKFLOW_PATH=.github/workflows/ci.yml
CI_API=${GITHUB_API_URL:-https://api.github.com}

# gh_get <path> <body file>: prints the HTTP status of a GitHub API GET (000 when no response arrived).
gh_get() {
  curl -sS -o "$2" -w '%{http_code}' \
    -K <(printf 'header = "Authorization: Bearer %s"\n' "$GITHUB_TOKEN") \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$CI_API/repos/$GITHUB_REPOSITORY/$1" || true
}

# checks_state <sha>: prints one of
#   success      the latest "Checks" check run of this repository's CI workflow for <sha> completed and succeeded
#   failure      the latest one completed without succeeding
#   pending      there is none yet, or it is queued or running
#   unknown      the API could not be read, or the run did not come from this repository's CI workflow
# A check run only counts when it is the github-actions app's, named exactly "Checks", and its workflow run is
# .github/workflows/ci.yml, a push, for the same commit: another workflow's job called "Checks" proves nothing.
checks_state() {
  local sha=$1 list run status latest conclusion run_id state=unknown
  list=$(mktemp)
  run=$(mktemp)
  status=$(gh_get "commits/$sha/check-runs?check_name=Checks&filter=all&per_page=100" "$list")
  if [ "$status" = 200 ] && jq -e '.check_runs | type == "array"' "$list" >/dev/null 2>&1; then
    # Runs of the app only; the newest by start time decides (a re-run replaces an earlier answer).
    latest=$(jq -c '[.check_runs[] | select(.name == "Checks" and .app.slug == "github-actions")] | sort_by(.started_at // "") | last // empty' "$list")
    if [ -z "$latest" ] || [ "$(jq -r .status <<< "$latest")" != completed ]; then
      state=pending
    else
      conclusion=$(jq -r '.conclusion // ""' <<< "$latest")
      if [ "$conclusion" != success ]; then
        state=failure
      else
        run_id=$(jq -r '.html_url // ""' <<< "$latest" | sed -nE 's#.*/actions/runs/([0-9]+)(/.*)?$#\1#p')
        if [ -n "$run_id" ] && [ "$(gh_get "actions/runs/$run_id" "$run")" = 200 ] \
          && [ "$(jq -r '.path // ""' "$run" | sed 's/@.*//')" = "$CI_WORKFLOW_PATH" ] \
          && [ "$(jq -r '.head_sha // ""' "$run")" = "$sha" ] \
          && [ "$(jq -r '.event // ""' "$run")" = push ]; then
          state=success
        fi
      fi
    fi
  fi
  rm -f "$list" "$run"
  echo "$state"
}
