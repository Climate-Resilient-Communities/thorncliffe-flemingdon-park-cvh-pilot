// Database test helpers. The tests need a disposable PostgreSQL server built
// like Supabase's (pg_cron, pg_net, the anon and authenticated roles), given
// as TEST_DATABASE_URL pointing at its `postgres` database. CI uses a service
// container; locally:
//
//   docker run -d --name cvh-db -e POSTGRES_PASSWORD=postgres -p 54329:5432 supabase/postgres:17.11.0.002
//   TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres npm run test:db
//
// Never point it at a real project: the tests create and drop databases, and
// apply the migrations to the `postgres` database itself.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postgres from "postgres";

export const ROOT = path.join(__dirname, "..", "..");
export const FIXTURES = path.join(ROOT, "test", "fixtures", "db");

export function serverUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL is not set: the database tests need a disposable Supabase PostgreSQL server (see test/db/helpers.ts)",
    );
  }
  return url;
}

export function connect(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

export interface FreshDatabase {
  url: string;
  sql: postgres.Sql;
  drop: () => Promise<void>;
}

/** An empty database on the test server, dropped by drop(). */
export async function createFreshDatabase(): Promise<FreshDatabase> {
  const admin = connect(serverUrl());
  const name = `cvh_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await admin.unsafe(`create database "${name}"`);
  const url = new URL(serverUrl());
  url.pathname = `/${name}`;
  const sql = connect(url.href);
  return {
    url: url.href,
    sql,
    drop: async () => {
      await sql.end({ timeout: 5 });
      await admin.unsafe(`drop database if exists "${name}" with (force)`);
      await admin.end({ timeout: 5 });
    },
  };
}

/** A temporary migrations directory holding the given files. */
export function migrationsDir(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-migrations-"));
  const write = (name: string, sql: string) => writeFileSync(path.join(dir, name), sql);
  for (const [name, sql] of Object.entries(files)) write(name, sql);
  return { dir, write, remove: () => rmSync(dir, { recursive: true, force: true }) };
}
