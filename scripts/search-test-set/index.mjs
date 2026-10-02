#!/usr/bin/env node
// The search test-set runner (S03.01). It is TypeScript sharing src/contracts, so this bundles
// scripts/search-test-set/main.ts with esbuild (resolving the @/ paths from tsconfig.json, leaving
// packages external) and runs its `main(argv, env, root)`, which returns the exit code.
// Usage is in main.ts; npm run search-test-set -- validate | run ... | --compare a b
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outfile = path.join(root, "node_modules", ".cache", "cvh-search-test-set", "main.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "search-test-set", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  tsconfig: path.join(root, "tsconfig.json"),
  logLevel: "error",
});

const { main } = await import(pathToFileURL(outfile).href);
process.exitCode = await main(process.argv.slice(2), process.env, root);
