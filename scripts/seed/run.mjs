// Runs a seed script written in TypeScript inside a module's code (S02.09 guides, S02.04 providers).
// The seeds import from src/modules, so this bundles scripts/seed/<name>.ts with esbuild (resolving the
// @/ paths from tsconfig.json, leaving packages external) and runs its `main(argv, env, root)`, which
// returns the exit code. See each seed's .ts for usage and exit codes.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Bundles and runs scripts/seed/<name>.ts; sets the process exit code. */
export async function runSeed(name) {
  const outfile = path.join(root, "node_modules", ".cache", "cvh-seed", `${name}.mjs`);
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(root, "scripts", "seed", `${name}.ts`)],
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
}
