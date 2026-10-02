// The app's database roles (S01.04): the audit migration creates cvh_app and
// cvh_app_login if missing, and refuses to go on when they already exist with
// attributes that would weaken the app's connection. Roles belong to the
// server, so every test puts the attributes back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { ROOT, connect, createFreshDatabase, migrationsDir, serverUrl, type FreshDatabase } from "./helpers";

// Only the audit migration: pg_cron (the first migration) can be created only in the server's own database.
const AUDIT_MIGRATION = "20261002010000_audit_event.sql";
const auditMigration = () =>
  migrationsDir({ [AUDIT_MIGRATION]: readFileSync(path.join(ROOT, "db", "migrations", AUDIT_MIGRATION), "utf8") });

let db: FreshDatabase | undefined;
let owner: ReturnType<typeof connect>;

const NORMAL = {
  cvh_app: "nologin nocreaterole nocreatedb",
  cvh_app_login: "login nocreaterole nocreatedb",
};

beforeAll(async () => {
  owner = connect(serverUrl());
  // Make sure both roles exist (a server never migrated before has none).
  await migrateFresh();
  await db?.drop();
  db = undefined;
});

afterEach(async () => {
  for (const [role, attributes] of Object.entries(NORMAL)) await owner.unsafe(`alter role ${role} ${attributes}`);
  await db?.drop();
  db = undefined;
});

async function migrateFresh() {
  db = await createFreshDatabase();
  const files = auditMigration();
  try {
    await migrate({ sql: db.sql, dir: files.dir, log: () => {} });
  } finally {
    files.remove();
  }
}

describe("role creation in the audit migration", () => {
  it("passes when the roles already exist with the expected attributes, again and again", async () => {
    await migrateFresh();
    await db!.drop();
    await migrateFresh();

    const roles = await owner`select rolname, rolcanlogin from pg_roles where rolname in ('cvh_app', 'cvh_app_login') order by 1`;
    expect(roles).toEqual([
      { rolname: "cvh_app", rolcanlogin: false },
      { rolname: "cvh_app_login", rolcanlogin: true },
    ]);
  });

  it.each([
    ["cvh_app", "createrole"],
    ["cvh_app", "createdb"],
    ["cvh_app", "login"],
    ["cvh_app_login", "createrole"],
    ["cvh_app_login", "createdb"],
  ])("refuses to go on when %s already exists with %s", async (role, attribute) => {
    await owner.unsafe(`alter role ${role} ${attribute}`);

    await expect(migrateFresh()).rejects.toThrow(new RegExp(`role ${role} already exists with unexpected attributes`));
  });
});
