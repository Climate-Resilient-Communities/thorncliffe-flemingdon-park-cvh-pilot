#!/usr/bin/env node
// Runs the guides and essential numbers seed (S02.09). The seed is TypeScript inside the
// directory module, so scripts/seed/run.mjs bundles scripts/seed/guides.ts and runs it.
// See guides.ts for usage and exit codes.
import { runSeed } from "./run.mjs";

await runSeed("guides");
