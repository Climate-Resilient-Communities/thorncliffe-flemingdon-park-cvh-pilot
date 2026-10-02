#!/usr/bin/env bash
# Writes deploy=true to GITHUB_OUTPUT only when the project positively has a
# production deployment. Vercel makes a project's first deployment production,
# so an empty project or an unknown state skips the preview.
set -euo pipefail

here=$(dirname "$0")
if state=$("$here/production-state.sh"); then
  case "$state" in
    present\ *)
      echo "deploy=true" >> "$GITHUB_OUTPUT"
      exit 0
      ;;
    empty)
      reason="Production has no deployment yet, and Vercel would make this preview production. The first deployment comes from main."
      ;;
  esac
else
  reason="Could not confirm that production already has a deployment, so a preview could become production."
fi
echo "::warning title=Vercel preview not built::$reason"
echo "deploy=false" >> "$GITHUB_OUTPUT"
