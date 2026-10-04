#!/usr/bin/env bash
# Decides whether the checks of a push to main can be skipped, because the exact tree being deployed was already tested.
# Writes skip=true|false (and tested_sha=<sha> when true) to GITHUB_OUTPUT and the reason to the job summary.
#
# skip=true only when both hold:
#   1. HEAD is a merge commit whose tree equals the tree of its second parent (the merged pull request's head): the merge
#      brought in nothing that was not in that head, so the content is what the pull request's checks saw.
#   2. That second parent has a completed, successful "Checks" check run of this repository's CI workflow (lib.sh).
# Anything else, including an API that cannot be read, is skip=false and everything runs as before: this script can only
# ever skip work, never block a deploy. Needs the history of HEAD and its parents (fetch-depth: 2), and `checks: read` and
# `actions: read` on GITHUB_TOKEN.
set -euo pipefail

: "${GITHUB_TOKEN:?}" "${GITHUB_REPOSITORY:?}" "${GITHUB_OUTPUT:?}"
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
here=$(dirname "$0")
# shellcheck source=lib.sh
. "$here/lib.sh"

decide() { # decide <true|false> <reason> [sha]
  {
    echo "## Tested-tree check"
    echo
    echo "$2"
  } >> "$summary"
  echo "tested-tree: skip=$1: $2"
  echo "skip=$1" >> "$GITHUB_OUTPUT"
  if [ "$1" = true ]; then echo "tested_sha=$3" >> "$GITHUB_OUTPUT"; fi
  exit 0
}

head=$(git rev-parse HEAD)
parents=$(git rev-list --parents -n 1 "$head" | cut -d' ' -f2-)
count=$(wc -w <<< "$parents")
if [ "$count" -lt 2 ]; then
  decide false "Not a merge commit ($head has $count parent(s)): the checks run."
fi
second=$(cut -d' ' -f2 <<< "$parents")
if ! second_tree=$(git rev-parse --verify --quiet "$second^{tree}"); then
  decide false "The merged head $second is not in the fetched history: the checks run."
fi
head_tree=$(git rev-parse "$head^{tree}")
if [ "$head_tree" != "$second_tree" ]; then
  decide false "The tree of $head differs from the tree of the merged head $second (main had moved on, or the merge changed something): the checks run."
fi

state=$(checks_state "$second")
case "$state" in
  success)
    decide true "Tested at $second: $head has the same tree as the merged pull request head, whose \"Checks\" succeeded. The checks are skipped and production deploys." "$second"
    ;;
  pending)
    decide false "The merged head $second has no completed \"Checks\" run: the checks run."
    ;;
  failure)
    decide false "The \"Checks\" run of the merged head $second did not succeed: the checks run."
    ;;
  *)
    decide false "Could not confirm a successful \"Checks\" run of this repository's CI workflow for $second: the checks run."
    ;;
esac
