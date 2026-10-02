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

/** Creates a client for a pooler URL. No connection is opened until the first query. */
export function createDb(url: string): Db {
  const client = postgres(url, { prepare: false });
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
  db = createDb(url);
  return db;
}

/** Test seam: forget the client (it has opened no connection unless it was queried). */
export function resetDb(): void {
  db = undefined;
}
