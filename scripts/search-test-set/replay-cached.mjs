#!/usr/bin/env node
// Replays the search test set through the real search use case with cached vectors, no vendor call (replayCached.ts says how).
// Usage: node scripts/search-test-set/replay-cached.mjs --cache <vector-cache.json> [--json <out.json>]
import { bundleAndRun } from "../lib/bundleAndRun.mjs";

process.exitCode = await bundleAndRun("scripts/search-test-set/replayCached.ts", "search-replay-cached");
