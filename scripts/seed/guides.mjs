#!/usr/bin/env node
// Runs the guides and essential numbers seed (S02.09). The seed is TypeScript inside the
// directory module, so this bundles scripts/seed/guides.ts with esbuild (resolving the @/ paths
// from tsconfig.json, leaving packages external) and runs it. See guides.ts for usage and exit codes.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const outfile = path.join(root, "node_modules", ".cache", "cvh-seed", "guides.mjs");
mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  entryPoints: [path.join(root, "scripts", "seed", "guides.ts")],
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
