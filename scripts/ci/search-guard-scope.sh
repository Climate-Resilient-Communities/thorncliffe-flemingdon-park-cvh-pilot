#!/usr/bin/env bash
# The search guard's first step (S03.09, .github/workflows/search-guard.yml): does this pull request change search, and is there a
# launch bar to measure it against? It needs only git and node (no install, no secret, no network), so a pull request that does not
# change search is answered in seconds.
#
#   search-guard-scope.sh <base sha> <head sha>
#
# Changed files are the pull request's own (from the merge base to the head), matched against scripts/ci/search-guard-paths.txt.
# The bar is the base branch's data/search-test-set/bar.json (a pull request does not judge itself by a bar it changes): "set" when it
# names who approved it and when, and holds at least one minimum (the shape agreed with S03.08; the runner's bar.ts reads it again).
# Writes to GITHUB_OUTPUT (when set): changed=true|false, bar=set|none, measure=true|false; and the reasons to GITHUB_STEP_SUMMARY.
set -euo pipefail

base=${1:?base sha}
head=${2:?head sha}
root=$(git rev-parse --show-toplevel)
rules="$root/scripts/ci/search-guard-paths.txt"
merge_base=$(git merge-base "$base" "$head")

changed_files=$(mktemp)
matched=$(mktemp)
trap 'rm -f "$changed_files" "$matched"' EXIT
git diff --name-only "$merge_base" "$head" > "$changed_files"

while IFS= read -r file; do
  [ -n "$file" ] || continue
  while read -r path_rule line_rule; do
    case "$path_rule" in '' | '#'*) continue ;; esac
    printf '%s\n' "$file" | grep -Eq -- "$path_rule" || continue
    if [ -n "${line_rule:-}" ]; then
      # Only the lines this pull request adds or removes, never the file's other lines.
      git diff -U0 "$merge_base" "$head" -- "$file" | grep -E '^[+-]' | grep -Ev '^(\+\+\+|---)( |$)' | grep -Eq -- "$line_rule" || continue
    fi
    printf '%s\n' "$file" >> "$matched"
    break
  done < "$rules"
done < "$changed_files"

changed=false
[ -s "$matched" ] && changed=true

bar=none
bar_reason="there is no data/search-test-set/bar.json on the base branch yet"
if bar_text=$(git show "$base:data/search-test-set/bar.json" 2>/dev/null); then
  bar_reason=$(printf '%s' "$bar_text" | node -e '
    let text = "";
    process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
      let bar;
      try { bar = JSON.parse(text); } catch { console.log("broken: data/search-test-set/bar.json is not JSON"); return; }
      const m = (bar && bar.minimums) || {};
      const hit = m.hitRate && typeof m.hitRate === "object" ? Object.keys(m.hitRate).length : 0;
      if (!bar || bar.approvedBy == null || bar.approvedOn == null) console.log("the launch bar has not been approved yet");
      else if (hit === 0 && m.noMatchAccuracy == null && m.emergencyAccuracy == null) console.log("the launch bar holds no minimum yet");
      else console.log("set");
    });')
  case "$bar_reason" in
    set) bar=set ;;
    broken:*) bar=set ;; # measured anyway: the runner then fails, naming what is wrong with the file, rather than passing quietly
  esac
fi

measure=false
[ "$changed" = true ] && [ "$bar" = set ] && measure=true

{
  echo "### Search guard"
  echo
  if [ "$changed" = true ]; then
    echo "This pull request changes what search does:"
    echo
    sed 's/^/- `/; s/$/`/' "$matched"
    echo
    if [ "$measure" = true ]; then
      echo "The evaluation subset is measured against the launch bar in the job \"Search guard: measure\" (it waits for the owner's approval of the search-guard environment, and spends Cohere calls)."
    else
      echo "Not measured: $bar_reason. Nothing is called, and the guard passes until the Hub approves a launch bar (S03.08)."
    fi
  else
    echo "This pull request changes nothing that search depends on (scripts/ci/search-guard-paths.txt): nothing to measure."
  fi
} > "${GITHUB_STEP_SUMMARY:-/dev/stdout}"

if [ "$changed" = true ] && [ "$measure" = false ] && [ -n "${GITHUB_ACTIONS:-}" ]; then
  echo "::notice title=Search guard not measured::$bar_reason; nothing was called."
fi

{
  echo "changed=$changed"
  echo "bar=$bar"
  echo "measure=$measure"
} >> "${GITHUB_OUTPUT:-/dev/stdout}"
