// Expand/contract rule (AD-15): production can be rolled back to the previous
// app release without rolling back the database, so a migration must not break
// the release that is serving production when it is applied. A destructive
// change needs a `-- contract: <sha>` note naming the release that stopped
// using the table or column, and that release must already be in production.
//
// "Already in production" means: the named commit is the commit production
// reports as its version (GET $PRODUCTION_URL/api/health, the APP_VERSION the
// production job builds with), or an ancestor of it.

import { spawnSync } from "node:child_process";
import { findDestructiveChanges, readContractNotes } from "./sql.mjs";

const SHA = /^[0-9a-f]{40}$/i;

/**
 * The commit production is serving. PRODUCTION_RELEASE overrides the lookup
 * (tests, or an operator who knows better); otherwise PRODUCTION_URL is asked.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<string>}
 */
export async function lookUpProductionRelease(env = process.env) {
  if (env.PRODUCTION_RELEASE) return env.PRODUCTION_RELEASE.trim();
  const base = env.PRODUCTION_URL;
  if (!base) {
    throw new Error("the variable PRODUCTION_URL is not set, so the release in production cannot be read");
  }
  const url = `${base.replace(/\/+$/, "")}/api/health`;
  let response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new Error(`could not read the release in production from ${url}: ${error.message}`);
  }
  if (response.status !== 200) {
    throw new Error(`could not read the release in production: ${url} answered ${response.status}`);
  }
  const body = await response.json().catch(() => ({}));
  if (typeof body.version !== "string" || !SHA.test(body.version)) {
    throw new Error(`${url} did not report a commit SHA as its version`);
  }
  return body.version;
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function resolveCommit(ref, cwd) {
  const result = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
  return result.status === 0 ? result.stdout.trim() : null;
}

/**
 * A migration's destructive changes come from its text (sql.mjs), or, when
 * given, from what applying it removed from a database (removals.mjs), which
 * also sees DO blocks, EXECUTE, called functions and CASCADE. The Checks job
 * has that database; the production job does not, so there every migration
 * that carries a contract note has its release checked, whether or not its
 * text shows the change.
 *
 * @param {{ file: string, sql: string }[]} migrations
 * @param {{ productionRelease: () => Promise<string>, cwd?: string, databaseChanges?: Record<string, string[]> }} options
 * @returns {Promise<string[]>} problems; empty when every destructive change is covered
 */
export async function checkDestructiveMigrations(migrations, { productionRelease, cwd = process.cwd(), databaseChanges }) {
  const problems = [];
  let production;

  for (const { file, sql } of migrations) {
    const changes = databaseChanges && file in databaseChanges ? databaseChanges[file] : findDestructiveChanges(sql);
    const notes = readContractNotes(sql);
    problems.push(...notes.problems.map((p) => `${file}: ${p}`));
    if (changes.length === 0 && notes.releases.length === 0) continue;

    const what = changes.length > 0 ? changes.join("; ") : "carries a contract note";
    if (notes.releases.length === 0) {
      problems.push(
        `${file} ${what}. The previous release may still use it: add the column or table first, ` +
          `stop using it in a release, then remove it in a later migration with ` +
          `"-- contract: <commit SHA of that release>" once that release is in production.`,
      );
      continue;
    }

    if (production === undefined) {
      try {
        production = { sha: await productionRelease() };
      } catch (error) {
        production = { error: error.message };
      }
    }
    for (const release of notes.releases) {
      const commit = resolveCommit(release, cwd);
      if (!commit) {
        problems.push(`${file}: the contract note names ${release}, which is not a commit in this repository`);
        continue;
      }
      if (production.error) {
        problems.push(`${file} ${what}, but ${production.error}`);
        continue;
      }
      const productionCommit = resolveCommit(production.sha, cwd);
      if (!productionCommit) {
        problems.push(
          `${file}: production runs ${production.sha}, which is not in this checkout's history (fetch the full history)`,
        );
        continue;
      }
      const ancestor = git(["merge-base", "--is-ancestor", commit, productionCommit], cwd);
      if (ancestor.status !== 0) {
        problems.push(
          `${file} ${what}, but the release named in its contract note (${release}) is not in production yet ` +
            `(production runs ${production.sha}). Deploy that release first.`,
        );
      }
    }
  }
  return problems;
}
