#!/usr/bin/env node
// Runs the demo suggestions seed (PRD §6.3). The seed is TypeScript inside the directory module, so scripts/seed/run.mjs bundles
// scripts/seed/submissions.ts and runs it. See submissions.ts for usage.
import { runSeed } from "./run.mjs";

await runSeed("submissions");
