#!/usr/bin/env node
// The search test-set runner (S03.01). It is TypeScript sharing src/contracts, so
// scripts/lib/bundleAndRun.mjs bundles scripts/search-test-set/main.ts and runs its
// `main(argv, env, root)`, which returns the exit code.
// Usage is in main.ts; npm run search-test-set -- validate | run ... | --compare a b
import { bundleAndRun } from "../lib/bundleAndRun.mjs";

process.exitCode = await bundleAndRun("scripts/search-test-set/main.ts", "search-test-set");
