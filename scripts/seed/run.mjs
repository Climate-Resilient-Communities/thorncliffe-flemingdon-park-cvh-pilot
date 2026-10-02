// Runs a seed script written in TypeScript inside a module's code (S02.09 guides, S02.04 providers).
// The seeds import from src/modules, so scripts/lib/bundleAndRun.mjs bundles scripts/seed/<name>.ts and
// runs its `main(argv, env, root)`, which returns the exit code. See each seed's .ts for usage and exit codes.
import { bundleAndRun } from "../lib/bundleAndRun.mjs";

/** Bundles and runs scripts/seed/<name>.ts; sets the process exit code. */
export async function runSeed(name) {
  process.exitCode = await bundleAndRun(`scripts/seed/${name}.ts`, "seed");
}
