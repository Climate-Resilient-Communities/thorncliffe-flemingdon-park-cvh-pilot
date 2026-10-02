import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MigrationError, migrate } from "../../scripts/db/migrate.mjs";
import { checksum, readMigrations } from "../../scripts/db/migrations.mjs";
import { ROOT, connect, createFreshDatabase, migrationsDir, serverUrl, type FreshDatabase } from "./helpers";

const CREATE_A = "create table a (id int primary key);\nalter table a enable row level security;\n";
const CREATE_B = "create table b (id int primary key);\nalter table b enable row level security;\n";
const CREATE_C = "create table c (id int primary key);\nalter table c enable row level security;\n";
const BROKEN_B = "create table b (id int primary key);\ninsert into b values (1), (1);\n";

const exists = async (db: FreshDatabase, table: string) => {
  const [row] = await db.sql`select to_regclass(${table}) is not null as present`;
  return row.present as boolean;
};
const history = (db: FreshDatabase) =>
  db.sql`select version, name, checksum from cvh_migrations.applied order by version`;

async function failure(promise: Promise<unknown>): Promise<MigrationError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof MigrationError) return error;
    throw error;
  }
  throw new Error("expected the migration run to fail");
}

describe("migration runner", () => {
  let db: FreshDatabase;
  let files: ReturnType<typeof migrationsDir>;

  beforeEach(async () => {
    db = await createFreshDatabase();
    files = migrationsDir({});
  });

  afterEach(async () => {
    files.remove();
    await db.drop();
  });

  it("applies pending migrations in version order and records each with its checksum", async () => {
    files.write("20260101000002_b.sql", CREATE_B);
    files.write("20260101000001_a.sql", CREATE_A);

    const { applied } = await migrate({ sql: db.sql, dir: files.dir });

    expect(applied).toEqual(["20260101000001_a.sql", "20260101000002_b.sql"]);
    expect(await history(db)).toEqual([
      { version: "20260101000001", name: "a", checksum: checksum(CREATE_A) },
      { version: "20260101000002", name: "b", checksum: checksum(CREATE_B) },
    ]);
    expect(await exists(db, "a")).toBe(true);
  });

  it("applies nothing on a second run", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    await migrate({ sql: db.sql, dir: files.dir });

    const { applied } = await migrate({ sql: db.sql, dir: files.dir });

    expect(applied).toEqual([]);
  });

  it("rolls back a failing migration, stops, and leaves it and later ones unapplied", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    files.write("20260101000002_b.sql", BROKEN_B);
    files.write("20260101000003_c.sql", CREATE_C);

    const error = await failure(migrate({ sql: db.sql, dir: files.dir }));

    expect(error.title).toBe("Migration 20260101000002_b.sql failed and was rolled back");
    expect(error.message).toMatch(/duplicate key/);
    expect(error.message).toMatch(/not applied: 20260101000002_b.sql, 20260101000003_c.sql/);
    expect(await exists(db, "a")).toBe(true);
    expect(await exists(db, "b")).toBe(false);
    expect(await exists(db, "c")).toBe(false);
    expect((await history(db)).map((r) => r.version)).toEqual(["20260101000001"]);
  });

  it("lets a failed migration be corrected in place and the run repeated", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    files.write("20260101000002_b.sql", BROKEN_B);
    await failure(migrate({ sql: db.sql, dir: files.dir }));

    files.write("20260101000002_b.sql", CREATE_B);
    const { applied } = await migrate({ sql: db.sql, dir: files.dir });

    expect(applied).toEqual(["20260101000002_b.sql"]);
    expect((await history(db)).at(-1)?.checksum).toBe(checksum(CREATE_B));
  });

  it("rejects an edit to an applied migration and applies nothing", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    await migrate({ sql: db.sql, dir: files.dir });

    files.write("20260101000001_a.sql", `${CREATE_A}alter table a add column note text;\n`);
    files.write("20260101000002_b.sql", CREATE_B);
    const error = await failure(migrate({ sql: db.sql, dir: files.dir }));

    expect(error.title).toMatch(/do not match the database's history; nothing was applied/);
    expect(error.message).toMatch(/20260101000001_a.sql was edited after it was applied/);
    expect(await exists(db, "b")).toBe(false);
  });

  it("treats a change of line endings only as no edit", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    await migrate({ sql: db.sql, dir: files.dir });

    files.write("20260101000001_a.sql", CREATE_A.replace(/\n/g, "\r\n"));

    expect((await migrate({ sql: db.sql, dir: files.dir })).applied).toEqual([]);
  });

  it("rejects an applied migration that was deleted or renamed", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    await migrate({ sql: db.sql, dir: files.dir });
    files.remove();
    files = migrationsDir({ "20260101000001_renamed.sql": CREATE_A });

    const error = await failure(migrate({ sql: db.sql, dir: files.dir }));

    expect(error.message).toMatch(/applied as 20260101000001_a.sql; applied migrations cannot be renamed/);
  });

  it("rejects a pending migration older than the latest applied one", async () => {
    files.write("20260101000002_b.sql", CREATE_B);
    await migrate({ sql: db.sql, dir: files.dir });
    files.write("20260101000001_a.sql", CREATE_A);

    const error = await failure(migrate({ sql: db.sql, dir: files.dir }));

    expect(error.message).toMatch(/20260101000001_a.sql sorts before the applied 20260101000002/);
    expect(await exists(db, "a")).toBe(false);
  });

  it("refuses migrations that control their own transaction or cannot run in one", async () => {
    files.write("20260101000001_a.sql", `begin;\n${CREATE_A}commit;\n`);
    files.write("20260101000002_b.sql", "create index concurrently b_idx on b (id);\n");

    const error = await failure(migrate({ sql: db.sql, dir: files.dir }));

    expect(error.problems).toHaveLength(3);
    expect(error.message).toMatch(/cannot run inside a transaction/);
    expect(await exists(db, "a")).toBe(false);
  });

  it("runs the pending-migration check before applying anything", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    const seen: string[] = [];

    const error = await failure(
      migrate({
        sql: db.sql,
        dir: files.dir,
        checkPending: async (pending) => {
          seen.push(...pending.map((m) => m.file));
          return ["not allowed"];
        },
      }),
    );

    expect(seen).toEqual(["20260101000001_a.sql"]);
    expect(error.message).toMatch(/not allowed/);
    expect(await exists(db, "a")).toBe(false);
  });

  // Through Supabase's session pooler a server session can outlive the runner
  // (a killed job): a session-level lock would then stay held and block every
  // later run, so the lock lives only as long as each transaction.
  it("holds no lock outside its transactions", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    files.write("20260101000002_b.sql", CREATE_B);
    const [{ pid }] = await db.sql`select pg_backend_pid() as pid`;
    const observer = connect(db.url);
    const held: number[] = [];

    try {
      await migrate({
        sql: db.sql,
        dir: files.dir,
        checkPending: async () => {
          const [row] = await observer`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = ${pid}`;
          held.push(row.n);
          return [];
        },
        log: () => {},
      });
      const [after] = await observer`select count(*)::int as n from pg_locks where locktype = 'advisory' and pid = ${pid}`;
      held.push(after.n);
    } finally {
      await observer.end({ timeout: 5 });
    }

    expect(held).toEqual([0, 0]);
  });

  it("bounds each migration with lock, statement and idle-in-transaction timeouts", async () => {
    files.write(
      "20260101000001_settings.sql",
      `create table seen as select current_setting('lock_timeout') as lock_timeout,
         current_setting('statement_timeout') as statement_timeout,
         current_setting('idle_in_transaction_session_timeout') as idle_timeout;`,
    );

    await migrate({ sql: db.sql, dir: files.dir });

    expect(await db.sql`select * from seen`).toEqual([{ lock_timeout: "15s", statement_timeout: "5min", idle_timeout: "1min" }]);
  });

  it("stops without applying twice when another run changes the history mid-run", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    files.write("20260101000002_b.sql", CREATE_B);
    const other = connect(db.url);

    try {
      const error = await failure(
        migrate({
          sql: db.sql,
          dir: files.dir,
          // Another runner applies everything while this one is between its check and its first migration.
          checkPending: async () => {
            await migrate({ sql: other, dir: files.dir });
            return [];
          },
        }),
      );

      expect(error.title).toMatch(/Another run changed the migration history/);
    } finally {
      await other.end({ timeout: 5 });
    }
    expect((await history(db)).map((r) => r.version)).toEqual(["20260101000001", "20260101000002"]);
  });

  it("does not carry session settings from one migration to the next", async () => {
    // In production each run applies only the new migrations, so a SET left by
    // one migration must not change where the next one's objects go.
    files.write("20260101000001_a.sql", "create schema other;\nset search_path = other, public;\nset role authenticated;\n");
    files.write("20260101000002_b.sql", CREATE_B);

    await migrate({ sql: db.sql, dir: files.dir });

    const [row] = await db.sql`select relnamespace::regnamespace::text as schema, relowner::regrole::text as owner from pg_class where relname = 'b'`;
    expect(row).toEqual({ schema: "public", owner: "postgres" });
  });

  it("reads from the database what each migration removed, including what its text hides", async () => {
    files.write(
      "20260101000001_expand.sql",
      `create type mood as enum ('ok', 'bad');
       create table audit_event (id int primary key, detail text, action varchar(40), feeling mood, note text);
       create table widget (id int primary key);
       create table gadget (id int primary key);
       alter table audit_event enable row level security;`,
    );
    files.write(
      "20260101000002_contract.sql",
      `do $$ begin execute 'alter table audit_event drop column detail'; end $$;
       do $$ begin execute 'alter table widget rename to widget_v2'; end $$;
       create function shrink() returns void language plpgsql as $f$ begin alter table audit_event alter column action type varchar(10); end $f$;
       select shrink();
       drop type mood cascade;
       create schema if not exists extensions; alter table gadget set schema extensions;
       alter table audit_event add column added text;`,
    );

    const { removals } = await migrate({ sql: db.sql, dir: files.dir, recordRemovals: true });

    expect(removals).toEqual({
      "20260101000001_expand.sql": [],
      "20260101000002_contract.sql": [
        "changes the type of column public.audit_event.action from character varying(40) to character varying(10) (may narrow it)",
        "removes column public.audit_event.detail (dropped or renamed)",
        "removes column public.audit_event.feeling (dropped or renamed)",
        "removes table public.gadget (dropped, renamed or moved)",
        "removes table public.widget (dropped, renamed or moved)",
      ],
    });
  });

  it("keeps its history table locked down", async () => {
    files.write("20260101000001_a.sql", CREATE_A);
    await migrate({ sql: db.sql, dir: files.dir });

    const [row] = await db.sql`
      select c.relrowsecurity as rls,
             has_table_privilege('anon', c.oid, 'select') as anon,
             has_table_privilege('authenticated', c.oid, 'select') as authenticated
      from pg_class c where c.oid = 'cvh_migrations.applied'::regclass`;
    expect(row).toEqual({ rls: true, anon: false, authenticated: false });
  });

  it("stops at the CLI with a GitHub error annotation and exit code 1", () => {
    files.write("20260101000001_a.sql", BROKEN_B);

    const result = spawnSync("node", [path.join(ROOT, "scripts/db/migrate.mjs"), "--dir", files.dir], {
      encoding: "utf8",
      env: { ...process.env, MIGRATE_DATABASE_URL: db.url, GITHUB_ACTIONS: "true" },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/::error title=Migration 20260101000001_a.sql failed and was rolled back::/);
  });

  it("refuses the transaction pooler at the CLI", () => {
    const result = spawnSync("node", [path.join(ROOT, "scripts/db/migrate.mjs")], {
      encoding: "utf8",
      env: { ...process.env, MIGRATE_DATABASE_URL: "postgres://u:p@pooler.example:6543/postgres" },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/transaction pooler/);
  });
});

describe("the project's migrations", () => {
  it("first migration enables pg_cron and pg_net and creates no application tables", async () => {
    const [first] = readMigrations();
    const sql = connect(serverUrl());
    const RELATIONS = `
      select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'`;
    try {
      // pg_cron lives only in the server's `postgres` database, so this runs
      // there inside a transaction that is rolled back.
      await sql
        .begin(async (tx) => {
          await tx.unsafe("drop extension if exists pg_cron cascade; drop extension if exists pg_net cascade");
          const before = (await tx.unsafe(RELATIONS)).map((r) => r.name);
          await tx.unsafe(first.sql);
          const after = (await tx.unsafe(RELATIONS)).map((r) => r.name);
          const extensions = (await tx`select extname from pg_extension where extname in ('pg_cron', 'pg_net') order by 1`).map(
            (r) => r.extname,
          );

          expect(extensions).toEqual(["pg_cron", "pg_net"]);
          expect(after.filter((name) => !before.includes(name))).toEqual([]);
          throw new Error("rollback");
        })
        .catch((error) => {
          if (error.message !== "rollback") throw error;
        });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("apply cleanly to the server's database, which has pg_cron", async () => {
    const sql = connect(serverUrl());
    try {
      await migrate({ sql });
      const rows = await sql`select version, checksum from cvh_migrations.applied order by version`;

      expect(rows.map((r) => r.version)).toEqual(readMigrations().map((m) => m.version));
      expect(rows.map((r) => r.checksum)).toEqual(
        readMigrations().map((m) => checksum(readFileSync(m.path, "utf8"))),
      );
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
