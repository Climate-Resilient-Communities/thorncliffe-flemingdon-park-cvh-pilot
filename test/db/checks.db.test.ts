import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkOwnership, checkRls } from "../../scripts/db/check-schema.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import { FIXTURES, ROOT, connect, createFreshDatabase, serverUrl, type FreshDatabase } from "./helpers";

const require = createRequire(import.meta.url);
const { readTableOwnership } = require("../../scripts/table-ownership.cjs");
const owners: Record<string, string> = readTableOwnership();

let db: FreshDatabase | undefined;

afterEach(async () => {
  await db?.drop();
  db = undefined;
});

async function migrated(fixture: string) {
  db = await createFreshDatabase();
  await migrate({ sql: db.sql, dir: path.join(FIXTURES, "checks", fixture) });
  return db;
}

describe("RLS check", () => {
  it("passes a table with RLS on and only a service_role policy", async () => {
    const { sql } = await migrated("valid");

    expect(await checkRls(sql)).toEqual([]);
  });

  it("rejects a table with RLS disabled", async () => {
    const { sql } = await migrated("rls-off");

    expect(await checkRls(sql)).toEqual([expect.stringMatching(/^public\.audit_event has row level security disabled/)]);
  });

  it("rejects an anon policy", async () => {
    const { sql } = await migrated("anon-policy");

    expect(await checkRls(sql)).toEqual([expect.stringMatching(/policy "audit_event_read" for anon/)]);
  });

  it("rejects an authenticated policy", async () => {
    const { sql } = await migrated("authenticated-policy");

    expect(await checkRls(sql)).toEqual([expect.stringMatching(/policy "audit_event_write" for authenticated/)]);
  });

  it("rejects a policy for PUBLIC (no TO clause)", async () => {
    const { sql } = await migrated("public-policy");

    expect(await checkRls(sql)).toEqual([expect.stringMatching(/policy "audit_event_all" for public/)]);
  });
});

describe("table ownership check (AD-2)", () => {
  it("passes a table in the spine's ownership table", async () => {
    const { sql } = await migrated("valid");

    expect(await checkOwnership(sql, owners)).toEqual([]);
  });

  it("rejects a table missing from the ownership table", async () => {
    const { sql } = await migrated("unowned");

    expect(await checkOwnership(sql, owners)).toEqual([
      expect.stringMatching(/^public\.widget is not in the table ownership table/),
    ]);
  });

  it("rejects a table placed in another module's schema", async () => {
    const { sql } = await migrated("wrong-module-schema");

    expect(await checkOwnership(sql, owners)).toEqual(["ops.audit_event is in the ops schema but is owned by audit (AD-2)"]);
  });
});

describe("db:check on the project's migrations", () => {
  it("passes on the server's migrated database", async () => {
    const sql = connect(serverUrl());
    try {
      await migrate({ sql });
    } finally {
      await sql.end({ timeout: 5 });
    }

    const result = spawnSync("node", [path.join(ROOT, "scripts/db/check-schema.mjs")], {
      encoding: "utf8",
      env: { ...process.env, MIGRATE_DATABASE_URL: serverUrl() },
    });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Row level security: ok\nTable ownership: ok/);
  });

  it("fails with annotations on a database with an unowned, unprotected table", async () => {
    db = await createFreshDatabase();
    await db.sql.unsafe("create table widget (id int)");

    const result = spawnSync("node", [path.join(ROOT, "scripts/db/check-schema.mjs")], {
      encoding: "utf8",
      env: { ...process.env, MIGRATE_DATABASE_URL: db.url, GITHUB_ACTIONS: "true" },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/::error title=Row level security::public\.widget has row level security disabled/);
    expect(result.stdout).toMatch(/::error title=Table ownership::public\.widget is not in the table ownership table/);
  });
});
