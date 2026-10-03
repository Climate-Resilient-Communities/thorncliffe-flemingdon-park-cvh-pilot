import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getEnv } from "../config/env";

/**
 * Database access for the app (spine Stack: Database).
 *
 * The app connects through Supabase's transaction pooler (DATABASE_URL, port
 * 6543). A transaction pooler hands each transaction to any server
 * connection, so prepared statements are off (`prepare: false`).
 * Migrations never use this client: CI applies them over a session connection
 * (scripts/db/migrate.mjs).
 *
 * Drizzle tables are hand-written beside each module's adapters, in
 * src/modules/<module>/adapters/schema.ts, and only for tables that module
 * owns (AD-2). A CI drift test compares them with the migrated database
 * (test/db/drift.db.test.ts). Modules pass their own tables to queries, so this
 * client takes no schema and src/platform never imports src/modules.
 */
export type Db = PostgresJsDatabase & { $client: postgres.Sql };

/** The transaction Drizzle passes to `db.transaction(async (tx) => ...)`. */
export type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Where a write can run: the client itself, or inside a caller's transaction. */
export type DbExecutor = Db | DbTransaction;

/**
 * The most connections one client opens (postgres.js's default, stated so tests can match it). A
 * transaction holds one of them until it ends, so code inside a transaction must query through the
 * transaction, never the client: a second connection taken while others wait for a lock the
 * transaction holds can exhaust the pool and deadlock it.
 */
export const DB_POOL_MAX = 10;

/**
 * How long one connection attempt may take before it fails (postgres.js's default is 30 s, which would outlast the search's
 * whole budget and a function's maxDuration). A pooler answers a connect in tens of milliseconds, even cold.
 */
export const DB_CONNECT_TIMEOUT_SECONDS = 5;

/** The app's request-path client (getDb) gives up on a connect sooner: a stalled connect must not outlast the search's 2.5 s budget. */
export const DB_REQUEST_CONNECT_TIMEOUT_SECONDS = 2;

/** Creates a client for a pooler URL. No connection is opened until the first query. */
export function createDb(url: string, options: { max?: number; connectTimeoutSeconds?: number } = {}): Db {
  const client = postgres(url, { prepare: false, max: options.max ?? DB_POOL_MAX, connect_timeout: options.connectTimeoutSeconds ?? DB_CONNECT_TIMEOUT_SECONDS });
  return drizzle({ client });
}

let db: Db | undefined;

/** The app's client, created on first use from the validated environment. */
export function getDb(): Db {
  if (db) return db;
  const url = getEnv().databaseUrl;
  if (!url) {
    throw new Error("DATABASE_URL is not set: the database is unavailable in this environment");
  }
  db = createDb(url, { connectTimeoutSeconds: DB_REQUEST_CONNECT_TIMEOUT_SECONDS });
  return db;
}

/** Test seam: forget the client (it has opened no connection unless it was queried). */
export function resetDb(): void {
  db = undefined;
}
