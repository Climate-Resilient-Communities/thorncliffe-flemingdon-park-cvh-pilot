import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkNetAccess, checkOwnership, checkRls } from "../../scripts/db/check-schema.mjs";
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

describe("RLS check cannot be sidestepped", () => {
  const PROTECTED = "create table audit_event (id int primary key); alter table audit_event enable row level security;";

  async function checked(sqlText: string) {
    db = await createFreshDatabase();
    await db.sql.unsafe(sqlText);
    return checkRls(db.sql);
  }

  it("rejects a view that clients can read, since it runs as its owner and skips RLS", async () => {
    // Supabase's default privileges give anon and authenticated every new relation in public.
    const problems = await checked(`${PROTECTED} create view audit_feed as select * from audit_event; grant select on audit_feed to anon;`);

    expect(problems).toEqual([expect.stringMatching(/^public\.audit_feed is a view that anon can read/)]);
  });

  it("passes a security_invoker view, which applies the table's RLS to the caller", async () => {
    const problems = await checked(
      `${PROTECTED} create view audit_feed with (security_invoker = true) as select * from audit_event; grant select on audit_feed to anon, authenticated;`,
    );

    expect(problems).toEqual([]);
  });

  it("passes a view that clients cannot read", async () => {
    const problems = await checked(
      `${PROTECTED} create view audit_feed as select * from audit_event; revoke all on audit_feed from public, anon, authenticated;`,
    );

    expect(problems).toEqual([]);
  });

  it("rejects a materialized view that clients can read (it has no RLS)", async () => {
    const problems = await checked(
      `${PROTECTED} create materialized view audit_copy as select * from audit_event; grant select on audit_copy to authenticated;`,
    );

    expect(problems).toEqual([expect.stringMatching(/^public\.audit_copy is a materialized view that authenticated can read/)]);
  });

  it("rejects a table owned by a client role, to which RLS does not apply", async () => {
    const problems = await checked(
      `create schema audit; grant usage, create on schema audit to anon;
       create table audit.audit_event (id int); alter table audit.audit_event enable row level security;
       alter table audit.audit_event owner to anon;`,
    );

    expect(problems).toEqual([expect.stringMatching(/^audit\.audit_event is owned by anon/)]);
  });

  it("rejects a policy for a role that anon is a member of", async () => {
    // Roles belong to the server, not the database: this one is removed afterwards.
    let problems: string[];
    try {
      problems = await checked(
        `${PROTECTED} create role cvh_test_readers; grant cvh_test_readers to anon;
         create policy audit_event_read on audit_event for select to cvh_test_readers using (true);`,
      );
    } finally {
      await db?.drop();
      db = undefined;
      const admin = connect(serverUrl());
      await admin.unsafe("drop role if exists cvh_test_readers");
      await admin.end({ timeout: 5 });
    }

    expect(problems).toEqual([expect.stringMatching(/policy "audit_event_read" for cvh_test_readers \(anon is a member\)/)]);
  });

  it("checks a table a migration placed in a Supabase schema", async () => {
    const problems = await checked("create schema if not exists extensions; create table extensions.audit_event (id int);");

    expect(problems).toEqual([expect.stringMatching(/^extensions\.audit_event has row level security disabled/)]);
    expect(await checkOwnership(db!.sql, owners)).toEqual([]);
    await db!.sql.unsafe("create table extensions.widget (id int)");
    expect(await checkOwnership(db!.sql, owners)).toEqual([
      expect.stringMatching(/^extensions\.widget is not in the table ownership table/),
    ]);
  });
});

describe("network access check (pg_net)", () => {
  const CALLER = `create function public.notify_partner() returns bigint language plpgsql as
    $$ begin return net.http_post(url := 'https://example.com'); end $$;`;

  async function checked(sqlText: string) {
    db = await createFreshDatabase();
    await db.sql.unsafe("create schema if not exists extensions; create extension if not exists pg_net with schema extensions");
    await db.sql.unsafe(sqlText);
    return checkNetAccess(db.sql);
  }

  it("rejects a client-callable function that calls net.http_post", async () => {
    // Functions are executable by PUBLIC unless revoked.
    const problems = await checked(CALLER);

    expect(problems).toEqual([expect.stringMatching(/^public\.notify_partner\(\) uses the net schema \(pg_net\) and anon and authenticated can execute it/)]);
  });

  it("rejects a SECURITY DEFINER function a client can call", async () => {
    const problems = await checked(`${CALLER.replace("language plpgsql", "language plpgsql security definer")} grant execute on function public.notify_partner() to anon;`);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/notify_partner\(\) uses the net schema/);
  });

  it("rejects a quoted or http_get/http_delete reference, and a procedure", async () => {
    const problems = await checked(
      `create function public.a() returns void language sql as $$ select "net"."http_get"('https://example.com') $$;
       create procedure public.b() language plpgsql as $$ begin perform net.http_delete('https://example.com'); end $$;`,
    );

    expect(problems).toEqual([expect.stringMatching(/^public\.a\(\)/), expect.stringMatching(/^public\.b\(\)/)]);
  });

  it("passes the same function once EXECUTE is revoked from public, anon and authenticated", async () => {
    const problems = await checked(`${CALLER} revoke all on function public.notify_partner() from public, anon, authenticated;`);

    expect(problems).toEqual([]);
  });

  it("still rejects it when only anon and authenticated are revoked but PUBLIC keeps EXECUTE", async () => {
    const problems = await checked(`${CALLER} revoke all on function public.notify_partner() from anon, authenticated;`);

    expect(problems).toEqual([expect.stringMatching(/^public\.notify_partner\(\)/)]);
  });

  it("passes a function only service_role can execute", async () => {
    const problems = await checked(
      `${CALLER} revoke all on function public.notify_partner() from public, anon, authenticated; grant execute on function public.notify_partner() to service_role;`,
    );

    expect(problems).toEqual([]);
  });

  it("passes a client-callable function that does not use pg_net", async () => {
    const problems = await checked("create function public.ping() returns int language sql as $$ select 1 $$;");

    expect(problems).toEqual([]);
  });

  it("rejects a view on net._http_response that anon can read", async () => {
    const problems = await checked(
      `create view public.http_log as select * from net._http_response; grant select on public.http_log to anon;`,
    );

    expect(problems).toEqual([expect.stringMatching(/^public\.http_log is a view on the net schema \(pg_net\) that anon can read/)]);
  });

  it("passes that view once clients cannot read it", async () => {
    const problems = await checked(
      `create view public.http_log as select * from net._http_response; revoke all on public.http_log from public, anon, authenticated;`,
    );

    expect(problems).toEqual([]);
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
