#!/usr/bin/env node
// Runs the seed of the Hub and partner space's dummy data (2026-11-07). The seed is TypeScript inside the partners module, so
// scripts/seed/run.mjs bundles scripts/seed/partners.ts and runs it. See partners.ts for usage and exit codes.
import { runSeed } from "./run.mjs";

await runSeed("partners");
