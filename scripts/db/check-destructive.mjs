#!/usr/bin/env node
// Expand/contract check for the Checks job (contracts.mjs explains the rule).
// It checks the migrations this branch adds or changes compared with --base
// (origin/main in CI), so a destructive change fails before it is merged. The
// production job checks the migrations still pending in production again,
// against the release production serves at that moment (migrate.mjs).
//
// Usage: node scripts/db/check-destructive.mjs [--base <ref>] [--dir <dir>]
//   Without --base every migration in the directory is checked.
//   PRODUCTION_URL (or PRODUCTION_RELEASE) is read only when a contract note needs it.

import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { checkDestructiveMigrations, lookUpProductionRelease } from "./contracts.mjs";
import { MIGRATIONS_DIR, readMigrations } from "./migrations.mjs";

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

/**
 * Migration files added or modified since the merge base of `base` and HEAD
 * (working-tree changes included).
 *
 * @returns {{ added: string[], modified: string[] }} file names
 */
export function changedMigrations(base, dir, cwd) {
  const mergeBase = git(["merge-base", base, "HEAD"], cwd);
  const relativeDir = path.relative(git(["rev-parse", "--show-toplevel"], cwd), dir) || ".";
  const output = git(["diff", "--name-status", "--no-renames", mergeBase, "--", relativeDir], cwd);
  const added = [];
  const modified = [];
  for (const line of output.split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    const name = path.basename(file);
    if (status === "A") added.push(name);
    if (status === "M") modified.push(name);
  }
  // Untracked files are new migrations too.
  const untracked = git(["ls-files", "--others", "--exclude-standard", "--", relativeDir], cwd);
  added.push(...untracked.split("\n").filter(Boolean).map((f) => path.basename(f)));
  return { added, modified };
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dir = option("--dir") ? path.resolve(option("--dir")) : MIGRATIONS_DIR;
  const base = option("--base");
  const annotate = process.env.GITHUB_ACTIONS === "true";

  let migrations = readMigrations(dir);
  if (base) {
    const { added, modified } = changedMigrations(base, dir, process.cwd());
    for (const file of modified) {
      const message = `${file} already exists on ${base} and was changed. If it has been applied in production, the production job will reject the edit: fix forward with a new migration instead.`;
      console.warn(message);
      if (annotate) console.log(`::warning title=Migration edited::${message}`);
    }
    const selected = new Set([...added, ...modified]);
    migrations = migrations.filter((m) => selected.has(m.file));
  }
  console.log(`Checking ${migrations.length} migration(s) for destructive changes.`);

  const problems = await checkDestructiveMigrations(migrations, {
    productionRelease: () => lookUpProductionRelease(),
    cwd: process.cwd(),
  });
  for (const problem of problems) {
    console.error(`- ${problem}`);
    if (annotate) console.log(`::error title=Destructive migration::${problem}`);
  }
  if (problems.length > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
