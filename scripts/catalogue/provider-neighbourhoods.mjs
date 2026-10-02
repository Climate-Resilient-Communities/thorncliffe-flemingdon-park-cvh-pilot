#!/usr/bin/env node
// Derives data/catalogue/provider-neighbourhoods.json (S02.06). The derivation is TypeScript that reuses the places
// import's postal areas, so scripts/lib/bundleAndRun.mjs bundles scripts/catalogue/derive-neighbourhoods.ts and runs it.
// See that file for usage and exit codes.
import { bundleAndRun } from "../lib/bundleAndRun.mjs";

process.exitCode = await bundleAndRun("scripts/catalogue/derive-neighbourhoods.ts", "neighbourhoods");
