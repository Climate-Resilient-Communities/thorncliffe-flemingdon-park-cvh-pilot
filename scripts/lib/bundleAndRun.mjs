// Runs a command-line script that is written in TypeScript and shares code with src/ (the seeds,
// the search test set). It bundles the entry with esbuild (resolving the @/ paths from tsconfig.json,
// leaving packages external) and runs its `main(argv, env, root)`, which returns the exit code.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Bundles `entry` (a path from the repository root, or absolute) into
 * node_modules/.cache/cvh-<cacheName>/<content hash>.mjs and returns that path. The file name holds a
 * hash of the bundle, so two worktrees or two runs that bundle different code never overwrite each
 * other's file while it is being imported; the same code gives the same file.
 */
export async function bundleToCache(entry, cacheName) {
  const dir = path.join(root, "node_modules", ".cache", `cvh-${cacheName}`);
  const result = await build({
    entryPoints: [path.resolve(root, entry)],
    outfile: path.join(dir, "bundle.mjs"),
    write: false,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    tsconfig: path.join(root, "tsconfig.json"),
    logLevel: "error",
  });
  const code = result.outputFiles[0].contents;
  const outfile = path.join(dir, `${createHash("sha256").update(code).digest("hex").slice(0, 16)}.mjs`);
  if (!existsSync(outfile)) {
    mkdirSync(dir, { recursive: true });
    const temp = `${outfile}.${process.pid}.tmp`;
    writeFileSync(temp, code);
    renameSync(temp, outfile);
  }
  return outfile;
}

/** Bundles `entry`, runs its `main(argv, env, root)` with this process's arguments, and returns its exit code. */
export async function bundleAndRun(entry, cacheName) {
  const outfile = await bundleToCache(entry, cacheName);
  const { main } = await import(pathToFileURL(outfile).href);
  return main(process.argv.slice(2), process.env, root);
}
