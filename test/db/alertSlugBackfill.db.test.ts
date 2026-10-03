// The slug backfill of S04.05's migration (20261003100000_alert_log_and_submit.sql) on a database that already holds threads, a closed
// one among them: S04.03's alert_guard refuses every update of a closed thread, so the backfill switches it off for its one statement and
// back on. Run on an empty database with the migrations before this one applied (pg_cron lives only in a server's `postgres` database,
// so the first migration, which enables it, is left out and `cron.schedule` is a stub that schedules nothing), a closed and an open thread
// inserted, then this migration.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { readMigrations } from "../../scripts/db/migrations.mjs";
import { createFreshDatabase, migrationsDir, type FreshDatabase } from "./helpers";

const THIS = "20261003100000";
/** The migration that enables pg_cron and pg_net: a fresh database cannot hold them (see above). */
const ENABLES_PG_CRON = "20261002000000";

describe("the slug backfill of S04.05's migration", () => {
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

  it("gives a closed thread its slug too, and leaves the guard on", async () => {
    const all = readMigrations();
    const copy = (migration: (typeof all)[number]) => copyFileSync(migration.path, path.join(files.dir, migration.file));
    await db.sql.unsafe("create schema cron; create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as 'select 0::bigint'");
    for (const migration of all) if (migration.version < THIS && migration.version !== ENABLES_PG_CRON) copy(migration);
    await migrate({ sql: db.sql, dir: files.dir });

    const creator = randomUUID();
    const closed = randomUUID();
    const open = randomUUID();
    await db.sql`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
                 values (${creator}, ${randomUUID()}, 'backfill_creator', 'Test', 'Coordinator', 'test@example.org', 'coordinator', false)`;
    await db.sql.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${creator}, true)`;
      const reported = new Date(Date.now() - 3_600_000);
      await tx`insert into alert (id, status, closed_reason, closed_at, is_drill, reported_at, created_by) values (${closed}, 'closed', 'resolved', now(), false, ${reported}, ${creator})`;
      await tx`insert into alert (id, is_drill, reported_at, created_by) values (${open}, false, ${reported}, ${creator})`;
    });
    // The guard really does refuse a closed thread before this migration (the premise of the test).
    await expect(db.sql`update alert set closed_reason = 'expired' where id = ${closed}`).rejects.toThrow(/ALERT_CLOSED/);

    copy(all.find((migration) => migration.version === THIS)!);
    const { applied } = await migrate({ sql: db.sql, dir: files.dir });

    expect(applied).toEqual([all.find((migration) => migration.version === THIS)!.file]);
    const rows = await db.sql<{ id: string; status: string; slug: string }[]>`select id, status, slug from alert where id in (${closed}, ${open}) order by status`;
    expect(rows.map((row) => row.status)).toEqual(["closed", "open"]);
    for (const row of rows) expect(row.slug).toMatch(/^[a-z0-9]{6,16}$/);
    expect(new Set(rows.map((row) => row.slug)).size).toBe(2);
    // The guard is enabled again: a closed thread still never changes, and a slug never changes.
    const [trigger] = await db.sql<{ enabled: string }[]>`select tgenabled as enabled from pg_trigger where tgname = 'alert_guard' and tgrelid = 'alert'::regclass`;
    expect(trigger.enabled).toBe("O");
    await expect(db.sql`update alert set closed_reason = 'expired' where id = ${closed}`).rejects.toThrow(/ALERT_CLOSED/);
    await expect(db.sql`update alert set slug = 'zzzzzzzz' where id = ${open}`).rejects.toThrow(/never change/);
  });
});
