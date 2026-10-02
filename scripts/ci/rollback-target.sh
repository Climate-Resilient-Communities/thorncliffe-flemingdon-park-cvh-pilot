#!/usr/bin/env bash
# Writes the deployment serving production to GITHUB_OUTPUT as id=<id>, the
# target of a rollback. Only a project with no production deployment at all may
# deploy without one; any other failure stops the deploy.
set -euo pipefail

here=$(dirname "$0")
if ! state=$("$here/production-state.sh"); then
  echo "::error title=Production not deployed::Could not establish which deployment serves $PRODUCTION_URL, so a failed smoke check could not be rolled back."
  exit 1
fi
case "$state" in
  present\ *)
    echo "id=${state#present }" >> "$GITHUB_OUTPUT"
    ;;
  empty)
    echo "::warning title=No rollback target::The project has no production deployment yet, so a failed smoke check cannot be rolled back."
    echo "id=" >> "$GITHUB_OUTPUT"
    ;;
esac
