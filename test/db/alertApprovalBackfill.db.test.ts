// The return backfill of S04.07's migration (20261003300000_alert_approval.sql) on a database that already holds entries: a draft an approver sent back
// before notes existed (`returned_for = 'return'`, S04.03's use case) has no note, and the new check "a return has a note" (NOT VALID, but it still binds
// every UPDATE of every row) would otherwise stop it from ever being saved or discarded. The migration makes it a plain draft, switching S04.05's entry
// guard off for that one statement and back on. Run on an empty database with the migrations before this one applied (pg_cron lives only in a server's
// `postgres` database, so the first migration, which enables it, is left out and `cron.schedule` is a stub that schedules nothing), entries inserted
// directly, then this migration.
import { copyFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { readMigrations } from "../../scripts/db/migrations.mjs";
import { createFreshDatabase, migrationsDir, type FreshDatabase } from "./helpers";

const THIS = "20261003300000";
/** The migration that enables pg_cron and pg_net: a fresh database cannot hold them (see above). */
const ENABLES_PG_CRON = "20261002000000";

describe("the return backfill of S04.07's migration", () => {
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

  it("makes an entry that was sent back without a note a plain draft, keeps its text, leaves the other drafts alone and the guard on, and the draft can be saved", async () => {
    const all = readMigrations();
    const copy = (migration: (typeof all)[number]) => copyFileSync(migration.path, path.join(files.dir, migration.file));
    await db.sql.unsafe("create schema cron; create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as 'select 0::bigint'");
    for (const migration of all) if (migration.version < THIS && migration.version !== ENABLES_PG_CRON) copy(migration);
    await migrate({ sql: db.sql, dir: files.dir });

    const author = randomUUID();
    const alertId = randomUUID();
    const [sentBack, pulledBack, plain, discarded] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.sql`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
                 values (${author}, ${randomUUID()}, 'backfill_author', 'Test', 'Coordinator', 'test@example.org', 'coordinator', false)`;
    await db.sql.begin(async (tx) => {
      // The guards stand aside for the statements that write what the app's use cases of S04.03 could have left behind, in this transaction only.
      await tx.unsafe("alter table alert disable trigger alert_insert_guard");
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, false, now() - interval '1 hour', ${author}, ${alertId.slice(-10)})`;
      for (const [id, status, returnedFor] of [
        [sentBack, "draft", "return"],
        [pulledBack, "draft", "edit"],
        [plain, "draft", null],
        [discarded, "discarded", "return"],
      ] as const) {
        await tx`
          insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, returned_for)
          values (${id}, ${alertId}, 'ack', ${status}, ${author}, ${[author]}, ${`Text of ${returnedFor ?? "a plain draft"}.`}, ${["power"]},
                  ${tx.json({ scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] })}, 'problem', now() + interval '1 day', ${returnedFor})`;
      }
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      await tx.unsafe("alter table alert enable trigger alert_insert_guard");
    });

    copy(all.find((migration) => migration.version === THIS)!);
    const { applied } = await migrate({ sql: db.sql, dir: files.dir });
    expect(applied).toEqual([all.find((migration) => migration.version === THIS)!.file]);

    const rows = await db.sql<{ id: string; status: string; returned_for: string | null; returned_note: string | null; original_text: string }[]>`
      select id, status, returned_for, returned_note, original_text from alert_entry where alert_id = ${alertId}`;
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    // The return that carried no note is gone, the text it kept is not; the other states of an entry are as they were.
    expect(byId[sentBack]).toMatchObject({ status: "draft", returned_for: null, returned_note: null, original_text: "Text of return." });
    expect(byId[discarded]).toMatchObject({ status: "discarded", returned_for: null, returned_note: null });
    expect(byId[pulledBack]).toMatchObject({ status: "draft", returned_for: "edit", returned_note: null });
    expect(byId[plain]).toMatchObject({ status: "draft", returned_for: null, returned_note: null });

    // The guard is on again, and it is the new one: it asks for the acting account, and a return that carries no note cannot be written any more.
    const [trigger] = await db.sql<{ enabled: string }[]>`select tgenabled as enabled from pg_trigger where tgname = 'alert_entry_guard' and tgrelid = 'alert_entry'::regclass`;
    expect(trigger.enabled).toBe("O");
    const asAuthor = <T>(run: (tx: typeof db.sql) => PromiseLike<T>) =>
      db.sql.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${author}, true)`;
        return await run(tx as unknown as typeof db.sql);
      });
    await expect(asAuthor((tx) => tx`update alert_entry set returned_for = 'return' where id = ${plain}`)).rejects.toThrow(/frozen fields|alert_entry_return_has_note/);
    // The check is there (not validated, as every new check on an existing table), and the entry that was sent back before notes can be saved.
    const [check] = await db.sql<{ validated: boolean }[]>`select convalidated as validated from pg_constraint where conname = 'alert_entry_return_has_note'`;
    expect(check.validated).toBe(false);
    await asAuthor((tx) => tx`update alert_entry set original_text = 'Edited after the migration.' where id = ${sentBack}`);
    expect((await db.sql`select original_text from alert_entry where id = ${sentBack}`)[0].original_text).toBe("Edited after the migration.");
  });
});
