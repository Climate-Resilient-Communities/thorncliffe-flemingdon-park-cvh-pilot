#!/usr/bin/env node
// The daily latency probe (.github/workflows/search-latency.yml): one English search to PRODUCTION_URL, judged by
// search-probe.mjs. Exit 1 with an `::error` annotation per problem. Reads PRODUCTION_URL, SEARCH_LATENCY_BUDGET_MS and
// SMOKE_SEARCH (off: sends nothing). Alert-only: it never changes anything.
import { appendFileSync } from "node:fs";
import { runProbe, searchSmokeEnabled } from "./search-probe.mjs";

async function main() {
  if (!searchSmokeEnabled(process.env.SMOKE_SEARCH)) {
    console.log("SMOKE_SEARCH is off: no search sent.");
    return 0;
  }
  let outcome;
  try {
    outcome = await runProbe(process.env);
  } catch (error) {
    outcome = { problems: [error instanceof Error ? error.message : String(error)], lines: [] };
  }
  if (process.env.GITHUB_STEP_SUMMARY && outcome.lines.length > 0) appendFileSync(process.env.GITHUB_STEP_SUMMARY, outcome.lines.join("\n") + "\n");
  for (const line of outcome.lines) console.log(line);
  for (const problem of outcome.problems) console.log(`::error title=Search latency probe failed::${problem}`);
  return outcome.problems.length > 0 ? 1 : 0;
}

process.exitCode = await main();
