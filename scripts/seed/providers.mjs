#!/usr/bin/env node
// Runs the provider catalogue seed (S02.04). The seed is TypeScript inside the directory module,
// so scripts/seed/run.mjs bundles scripts/seed/providers.ts and runs it. See providers.ts for usage.
import { runSeed } from "./run.mjs";

await runSeed("providers");
