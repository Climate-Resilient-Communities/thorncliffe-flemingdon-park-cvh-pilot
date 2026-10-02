#!/usr/bin/env node
// Migration runner (S01.03). Applies the pending files of db/migrations in
// version order, each in its own transaction together with its history row, and
// stops at the first failure, which is rolled back and stays pending.
// Applied migrations are immutable: before anything is applied, every file's
// checksum is compared with the target database's history, and an edited,
// renamed or deleted applied migration stops the run.
//
// Usage: MIGRATE_DATABASE_URL=postgres://... node scripts/db/migrate.mjs [--dir <dir>] [--check-destructive] [--removals-report <file>]
//   --check-destructive  also refuse pending migrations that break the release
//                        in production (contracts.mjs); used by the production job.
//   --removals-report    write, per applied migration, the tables and columns it
//                        removed or retyped as read from the database (removals.mjs);
//                        used by the Checks job on its disposable database.

import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { checkDestructiveMigrations, lookUpProductionRelease } from "./contracts.mjs";
import { MIGRATIONS_DIR, ROOT, readMigrations } from "./migrations.mjs";
import { compareColumns, snapshotColumns } from "./removals.mjs";
import { HISTORY_SCHEMA, HISTORY_TABLE } from "./schemas.mjs";
import { findTransactionProblems } from "./sql.mjs";

// Any fixed key works; it only keeps two runners off the same database at once.
// The lock is transaction-scoped (pg_try_advisory_xact_lock): through Supabase's
// session pooler a server session can outlive a runner that was killed, and a
// session-level lock would then stay held and block every later run.
const LOCK_KEY = 7_315_420_031;
// Every transaction of the runner is bounded, so a stuck or abandoned run
// cannot keep production tables locked:
//  - lock_timeout: a migration that waits this long for a lock is failing, not
//    slow: while it waits, every app query on that table queues behind it;
//  - statement_timeout: a statement that runs this long is stopped and rolled
//    back, well within the job's timeout;
//  - idle_in_transaction_session_timeout: if the runner dies mid-transaction
//    while the pooler keeps the server session open, the server ends it.
const TIMEOUTS = {
  lock_timeout: "15s",
  statement_timeout: "5min",
  idle_in_transaction_session_timeout: "1min",
};

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

async function ensureHistory(tx) {
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
}

/**
 * Runs fn in a transaction that holds the runner's lock, with the timeouts set.
 * Fails at once if another run holds the lock.
 *
 * @template T
 * @param {import("postgres").Sql} sql
 * @param {(tx: import("postgres").TransactionSql) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function lockedTransaction(sql, fn) {
  return sql.begin(async (tx) => {
    await tx.unsafe(Object.entries(TIMEOUTS).map(([name, value]) => `set local ${name} = '${value}'`).join("; "));
    const [{ locked }] = await tx`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`;
    if (!locked) {
      throw new MigrationError("Another migration run holds the lock", ["wait for it to finish, then run again"]);
    }
    return fn(tx);
  });
}

/**
 * @param {object} options
 * @param {import("postgres").Sql} options.sql  a client with max: 1, so every transaction uses one session
 * @param {string} [options.dir]
 * @param {(pending: import("./migrations.mjs").Migration[]) => Promise<string[]>} [options.checkPending]
 *   extra check of the pending migrations before any is applied; returns problems
 * @param {boolean} [options.recordRemovals]  read from the database what each migration removed or retyped
 * @param {(line: string) => void} [options.log]
 * @returns {Promise<{ applied: string[], removals: Record<string, string[]> }>} the files applied by this run
 */
export async function migrate({ sql, dir = MIGRATIONS_DIR, checkPending, recordRemovals = false, log = () => {} }) {
  const migrations = readMigrations(dir);

  const transactionProblems = migrations.flatMap((m) =>
    findTransactionProblems(m.sql).map((p) => `${m.file}: ${p}`),
  );
  if (transactionProblems.length > 0) {
    throw new MigrationError("Migrations cannot run in the runner's transaction", transactionProblems);
  }

  const history = await lockedTransaction(sql, async (tx) => {
    await ensureHistory(tx);
    return tx.unsafe(`select version, name, checksum from ${HISTORY} order by version`);
  });
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
  const removals = {};
  const summary = () => [
    done.length > 0 ? `applied before the failure: ${done.join(", ")}` : "nothing was applied in this run",
    `not applied: ${pending.filter((m) => !done.includes(m.file)).map((m) => m.file).join(", ")}`,
  ];
  for (const migration of pending) {
    // The lock is not held between transactions, so each one first checks that
    // the history is still what this run read and extended.
    const expected = { count: history.length + done.length, latest: pending[done.length - 1]?.version ?? latest ?? null };
    try {
      await lockedTransaction(sql, async (tx) => {
        const [now] = await tx.unsafe(`select count(*)::int as count, max(version) as latest from ${HISTORY}`);
        if (now.count !== expected.count || now.latest !== expected.latest) {
          throw new MigrationError("Another run changed the migration history; this run stopped", [
            `expected ${expected.count} applied migration(s) up to ${expected.latest ?? "none"}, ` +
              `found ${now.count} up to ${now.latest ?? "none"}`,
            ...summary(),
            "run again: it starts from the history as it is now",
          ]);
        }
        const before = recordRemovals ? await snapshotColumns(tx) : undefined;
        await tx.unsafe(migration.sql);
        if (before) removals[migration.file] = compareColumns(before, await snapshotColumns(tx));
        // A migration's own SET (search_path, role, ...) ends with it: the next
        // migration runs as it would in a later run on a fresh session, which is
        // how production applies it.
        await tx.unsafe("reset all; reset role");
        await tx.unsafe(`insert into ${HISTORY} (version, name, checksum) values ($1, $2, $3)`, [
          migration.version,
          migration.name,
          migration.checksum,
        ]);
      });
    } catch (error) {
      if (error instanceof MigrationError) throw error;
      throw new MigrationError(`Migration ${migration.file} failed and was rolled back`, [
        error.message,
        ...summary(),
        "a failed migration was never recorded, so it may be corrected in place and the run repeated",
      ]);
    }
    done.push(migration.file);
    log(`Applied ${migration.file}`);
  }
  return { applied: done, removals };
}

/** Refuses Supabase's transaction pooler: the runner's transactions and SETs need a session. */
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
      "migrations need a session: use the session pooler (port 5432)",
    ]);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const dir = option("--dir") ? path.resolve(option("--dir")) : MIGRATIONS_DIR;
  const removalsReport = option("--removals-report");
  const checkDestructive = args.includes("--check-destructive");
  const url = process.env.MIGRATE_DATABASE_URL;

  let sql;
  try {
    checkMigrationUrl(url);
    sql = postgres(url, { max: 1, onnotice: () => {}, connect_timeout: 30 });
    const { applied, removals } = await migrate({
      sql,
      dir,
      log: (line) => console.log(line),
      recordRemovals: removalsReport !== undefined,
      checkPending: checkDestructive
        ? (pending) => checkDestructiveMigrations(pending, { productionRelease: () => lookUpProductionRelease(), cwd: ROOT })
        : undefined,
    });
    if (removalsReport) writeFileSync(removalsReport, `${JSON.stringify(removals, null, 2)}\n`);
    if (process.env.GITHUB_STEP_SUMMARY && applied.length > 0) {
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
