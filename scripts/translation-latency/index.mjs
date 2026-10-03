#!/usr/bin/env node
// The translation latency measurement (S04.01). It is TypeScript sharing src/ (the translation module's Cohere
// adapter, so the times are of the app's own code path), so scripts/lib/bundleAndRun.mjs bundles
// scripts/translation-latency/main.ts and runs its `main(argv, env, root)`, which returns the exit code.
// Usage is in main.ts; npm run translation-latency -- plan | run --max-calls-per-model <n> ... | timeouts <report>
import { bundleAndRun } from "../lib/bundleAndRun.mjs";

process.exitCode = await bundleAndRun("scripts/translation-latency/main.ts", "translation-latency");
