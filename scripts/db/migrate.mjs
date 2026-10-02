#!/usr/bin/env node
// Migration runner (S01.03). Applies the pending files of db/migrations in
// version order, each in its own transaction together with its history row, and
// stops at the first failure, which is rolled back and stays pending.
// Applied migrations are immutable: before anything is applied, every file's
// checksum is compared with the target database's history, and an edited,
// renamed or deleted applied migration stops the run.
//
// Usage: MIGRATE_DATABASE_URL=postgres://... node scripts/db/migrate.mjs [--dir <dir>] [--check-destructive]
//   --check-destructive  also refuse pending migrations that break the release
//                        in production (contracts.mjs); used by the production job.

import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { checkDestructiveMigrations, lookUpProductionRelease } from "./contracts.mjs";
import { MIGRATIONS_DIR, ROOT, readMigrations } from "./migrations.mjs";
import { HISTORY_SCHEMA, HISTORY_TABLE } from "./schemas.mjs";
import { findTransactionProblems } from "./sql.mjs";

// Any fixed key works; it only keeps two runners off the same database at once.
const LOCK_KEY = 7_315_420_031;
// A migration that waits this long for a lock is failing, not slow: while it
// waits, every app query on that table queues behind it.
const LOCK_TIMEOUT = "15s";

export class MigrationError extends Error {
  /** @param {string} title @param {string[]} problems */
  constructor(title, problems) {
    super(`${title}\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "MigrationError";
    this.title = title;
    this.problems = problems;
  }
}

const HISTORY = `"${HISTORY_SCHEMA}"."${HISTORY_TABLE}"`;

async function ensureHistory(sql) {
  await sql.begin(async (tx) => {
    await tx.unsafe(`
      create schema if not exists "${HISTORY_SCHEMA}";
      create table if not exists ${HISTORY} (
        version text primary key,
        name text not null,
        checksum text not null,
        applied_at timestamptz not null default now()
      );
      alter table ${HISTORY} enable row level security;
      revoke all on schema "${HISTORY_SCHEMA}" from public;
      revoke all on ${HISTORY} from public;
      do $$
      declare r text;
      begin
        foreach r in array array['anon', 'authenticated'] loop
          if exists (select 1 from pg_roles where rolname = r) then
            execute format('revoke all on schema "${HISTORY_SCHEMA}" from %I', r);
            execute format('revoke all on ${HISTORY} from %I', r);
          end if;
        end loop;
      end $$;
    `);
  });
}

/**
 * @param {object} options
 * @param {import("postgres").Sql} options.sql  a client with max: 1, so the lock and the transactions share one session
 * @param {string} [options.dir]
 * @param {(pending: import("./migrations.mjs").Migration[]) => Promise<string[]>} [options.checkPending]
 *   extra check of the pending migrations before any is applied; returns problems
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<{ applied: string[] }>} the files applied by this run
 */
export async function migrate({ sql, dir = MIGRATIONS_DIR, checkPending, log = () => {} }) {
  const migrations = readMigrations(dir);

  const transactionProblems = migrations.flatMap((m) =>
    findTransactionProblems(m.sql).map((p) => `${m.file}: ${p}`),
  );
  if (transactionProblems.length > 0) {
    throw new MigrationError("Migrations cannot run in the runner's transaction", transactionProblems);
  }

  const [{ locked }] = await sql`select pg_try_advisory_lock(${LOCK_KEY}) as locked`;
  if (!locked) {
    throw new MigrationError("Another migration run holds the lock", [
      "wait for it to finish, then run again",
    ]);
  }
  try {
    await ensureHistory(sql);
    const history = await sql.unsafe(`select version, name, checksum from ${HISTORY} order by version`);
    const byVersion = new Map(migrations.map((m) => [m.version, m]));

    const problems = [];
    for (const row of history) {
      const local = byVersion.get(row.version);
      const recorded = `${row.version}_${row.name}.sql`;
      if (!local) {
        problems.push(`${recorded} is recorded as applied but is missing from ${path.relative(ROOT, dir) || dir}`);
      } else if (local.name !== row.name) {
        problems.push(`${local.file} was applied as ${recorded}; applied migrations cannot be renamed`);
      } else if (local.checksum !== row.checksum) {
        problems.push(
          `${local.file} was edited after it was applied (checksum ${local.checksum.slice(0, 12)}, ` +
            `applied ${row.checksum.slice(0, 12)}). Applied migrations are immutable: restore the file ` +
            `and fix forward with a new migration.`,
        );
      }
    }
    if (problems.length > 0) {
      throw new MigrationError("Applied migrations do not match the database's history; nothing was applied", problems);
    }

    const applied = new Set(history.map((row) => row.version));
    const pending = migrations.filter((m) => !applied.has(m.version));
    const latest = history.at(-1)?.version;
    const early = pending.filter((m) => latest !== undefined && m.version < latest);
    if (early.length > 0) {
      throw new MigrationError(
        "Pending migrations are older than the latest applied one; nothing was applied",
        early.map((m) => `${m.file} sorts before the applied ${latest}: rename it with a later timestamp`),
      );
    }

    if (checkPending && pending.length > 0) {
      const checkProblems = await checkPending(pending);
      if (checkProblems.length > 0) {
        throw new MigrationError("Pending migrations failed the checks; nothing was applied", checkProblems);
      }
    }

    if (pending.length === 0) log("No pending migrations.");
    const done = [];
    for (const migration of pending) {
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
          await tx.unsafe(migration.sql);
          await tx.unsafe(`insert into ${HISTORY} (version, name, checksum) values ($1, $2, $3)`, [
            migration.version,
            migration.name,
            migration.checksum,
          ]);
        });
      } catch (error) {
        const left = pending.filter((m) => !done.includes(m.file)).map((m) => m.file);
        throw new MigrationError(`Migration ${migration.file} failed and was rolled back`, [
          error.message,
          done.length > 0 ? `applied before the failure: ${done.join(", ")}` : "nothing was applied in this run",
          `not applied: ${left.join(", ")}`,
          "a failed migration was never recorded, so it may be corrected in place and the run repeated",
        ]);
      }
      done.push(migration.file);
      log(`Applied ${migration.file}`);
    }
    return { applied: done };
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  }
}

/** Refuses Supabase's transaction pooler: session state (the lock, SET LOCAL) needs a session. */
export function checkMigrationUrl(url) {
  if (!url) throw new MigrationError("MIGRATE_DATABASE_URL is not set", ["give the runner a database URL"]);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new MigrationError("MIGRATE_DATABASE_URL is not a valid URL", ["expected postgres://user:password@host:port/database"]);
  }
  if (parsed.port === "6543") {
    throw new MigrationError("MIGRATE_DATABASE_URL points at the transaction pooler (port 6543)", [
      "migrations need a session: use the direct connection or the session pooler (port 5432)",
    ]);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf("--dir");
  const dir = dirIndex >= 0 ? path.resolve(args[dirIndex + 1]) : MIGRATIONS_DIR;
  const checkDestructive = args.includes("--check-destructive");
  const url = process.env.MIGRATE_DATABASE_URL;

  let sql;
  try {
    checkMigrationUrl(url);
    sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 30 });
    const { applied } = await migrate({
      sql,
      dir,
      log: (line) => console.log(line),
      checkPending: checkDestructive
        ? (pending) => checkDestructiveMigrations(pending, { productionRelease: () => lookUpProductionRelease(), cwd: ROOT })
        : undefined,
    });
    if (process.env.GITHUB_STEP_SUMMARY && applied.length > 0) {
      const { appendFileSync } = await import("node:fs");
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Migrations applied: ${applied.join(", ")}\n`);
    }
  } catch (error) {
    const title = error instanceof MigrationError ? error.title : "Migration run failed";
    console.error(error instanceof MigrationError ? error.message : `${title}: ${error.message}`);
    if (process.env.GITHUB_ACTIONS === "true") {
      const detail = (error.problems ?? [error.message]).join(" | ").replace(/\r?\n/g, " ");
      console.log(`::error title=${title.replace(/[:,]/g, "")}::${detail}`);
    }
    process.exitCode = 1;
  } finally {
    await sql?.end({ timeout: 5 });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
