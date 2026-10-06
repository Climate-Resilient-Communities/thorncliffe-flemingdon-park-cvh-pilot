// Alerts that run past their time close on their own (S05.04), against a real database. The expire job finds every open thread whose covering entry is past its
// valid-until and, for each, in its own transaction and under the thread's lock, adds a system `final` (`published_system`, web-only) and closes the thread
// `expired` through `closeAlert`. The database refuses a `published_system` entry unless the expire job's session variable is set; two runs at once close a thread
// once with one final; a run that fails changes nothing and is an ops event, and the next run closes the thread; and a thread closed late says so.
// The job runs as the app's own role (cvh_app_login); the fixtures are written by the owner.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createAlertExpiry, createResidentAlerts } from "../../src/modules/alerting";
import { recordOpsEvent } from "../../src/modules/ops";
import { createDb, type Db } from "../../src/platform/db";
import { deliveryFixtures, type SeededEntry } from "./deliveryFixtures";
import { connect, serverUrl } from "./helpers";

const FINAL_TEXT = "This alert has expired without a further update. The problem may continue. Contact the Hub for current information.";
const HOUR = 3600_000;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let fixtures: ReturnType<typeof deliveryFixtures>;

const expirer = (over: Partial<Parameters<typeof createAlertExpiry>[0]> = {}) => createAlertExpiry({ db: app, finalText: () => FINAL_TEXT, ...over });

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx`delete from ops_event where kind in ('alert.expire_failed', 'alert.expire_late')`;
    await tx.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 10, onnotice: () => {} });
  app = createDb(url.href);
  fixtures = deliveryFixtures(owner);
});

afterAll(async () => {
  await clear();
  await fixtures.cleanup();
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await clear();
  await fixtures.cleanup();
});

// --- helpers ---------------------------------------------------------------------------------------------------------------------------

/** An approved acknowledgement that ran out `agoMs` ago (the thread of a fixture: its entry's own trigger is off for the insert). */
const overdue = (agoMs = 2 * HOUR, options: { isDrill?: boolean; types?: string[]; scope?: "neighbourhood" | "buildings" } = {}) =>
  fixtures.entry("approved", { validUntil: new Date(Date.now() - agoMs), ...options });
const live = () => fixtures.entry("approved", { validUntil: new Date(Date.now() + 2 * HOUR) });

const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const entryRows = async (alertId: string) => await owner`select * from alert_entry where alert_id = ${alertId} order by created_at, id`;
const finalsOf = async (alertId: string) => (await entryRows(alertId)).filter((row) => row.kind === "final");
const feedVersion = async () => Number((await owner`select version from feed_version`)[0].version);
const opsEvents = () => owner<{ kind: string; subject_id: string | null; detail: Record<string, unknown> }[]>`select kind, subject_id, detail from ops_event where kind in ('alert.expire_failed', 'alert.expire_late') order by at, id`;
const auditRows = (alertId: string) =>
  owner<{ action: string; actor_staff_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, actor_staff_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') and (subject_id = ${alertId} or meta->>'entry_id' is not null) order by id`;

/** An instant after the fixtures' fixed publication time (3 October 2026, 15:00 UTC) and after now: the later entry is the newer news, whatever the clock says. */
const later = () => new Date(Math.max(Date.now(), Date.parse("2026-10-03T15:00:00Z")) + 1000);

/** Another entry in the thread of `like`, written with the entry guard off (the fixtures' way) and published `afterMs` after the first. */
async function addEntry(like: SeededEntry, status: "approved" | "pending_approval" | "draft", over: { kind?: string; validUntil?: Date } = {}) {
  const id = randomUUID();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at,
                                      approved_by, approved_at, approved_version, approved_hash, web_published_at, created_at)
             select ${id}, alert_id, ${over.kind ?? "update"}, ${status}, author_id, editor_ids, 'later words', types, audience, phase, ${over.validUntil ?? new Date(Date.now() + 2 * HOUR)},
                    ${status === "draft" ? 0 : 1}, ${status === "draft" ? null : "c".repeat(64)}, ${status === "draft" ? null : tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } } as never)},
                    ${status === "draft" ? null : new Date()},
                    ${status === "approved" ? like.approverId : null}, ${status === "approved" ? new Date() : null}, ${status === "approved" ? 1 : null},
                    ${status === "approved" ? "c".repeat(64) : null}, ${status === "approved" ? later() : null}, ${later()}
             from alert_entry where id = ${like.entryId}`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  return id;
}

// --- the job ---------------------------------------------------------------------------------------------------------------------------

describe("the expire job", () => {
  it("closes a thread whose covering entry is past its valid-until: a published_system final from the catalog's words, web-only, recorded as the entry that closed it", async () => {
    const seeded = await overdue();
    const before = await feedVersion();

    const report = await expirer().run();

    expect(report).toEqual({ due: 1, closed: 1, skipped: 0, failed: 0 });
    const thread = await threadRow(seeded.alertId);
    expect(thread).toMatchObject({ status: "closed", closed_reason: "expired" });
    const finals = await finalsOf(seeded.alertId);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      status: "published_system",
      original_text: FINAL_TEXT,
      author_id: seeded.authorId,
      version: 0,
      approved_by: null,
      content_hash: null,
      sms_bodies: null,
      supersedes_id: null,
    });
    expect(finals[0].web_published_at).not.toBeNull();
    // It covers the same people and says what the entry that ran out was about; the thread is closed by it, at the database's own instant.
    const [first] = (await entryRows(seeded.alertId)).filter((row) => row.id === seeded.entryId);
    expect(finals[0].audience).toEqual(first.audience);
    expect(finals[0].types).toEqual(first.types);
    expect(thread.closing_entry_id).toBe(finals[0].id);
    expect(new Date(thread.closed_at).getTime()).toBeGreaterThanOrEqual(new Date(finals[0].web_published_at).getTime());
    // Web only: the system final is never approved, so no text is queued for it, and the feed (open threads only) changed.
    expect(await owner`select 1 from delivery where entry_id = ${finals[0].id}`).toHaveLength(0);
    expect(await feedVersion()).toBe(before + 1);
    // Audited with no actor (the system), naming the entry that closed it.
    const closed = (await auditRows(seeded.alertId)).filter((row) => row.action === "alert.closed");
    expect(closed).toEqual([{ action: "alert.closed", actor_staff_id: null, is_drill: false, meta: { closed_as: "expired", discarded: 0, kept_entry_id: finals[0].id } }]);
  });

  it("shows residents the expired thread as Expired with the system's words, in no thread list of the feed, and never as resolved", async () => {
    const seeded = await overdue();
    const slug = (await threadRow(seeded.alertId)).slug as string;
    const residents = createResidentAlerts(app);
    expect((await residents.read("en")).threads.map((thread) => thread.slug)).toEqual([slug]);

    await expirer().run();

    expect((await residents.read("en")).threads).toEqual([]);
    for (const lang of ["en", "ur"] as const) {
      const closed = await residents.readClosed!(lang, slug);
      expect(closed).toMatchObject({ slug, state: "closed", close_reason: "expired" });
      // The newest entry is the system final, in English until it is translated (no translation exists for it).
      const newest = closed!.entries[closed!.entries.length - 1];
      expect(newest).toMatchObject({ kind: "final" });
      expect(newest.text.body).toBe(FINAL_TEXT);
    }
    expect(await residents.readClosedSlugs!()).toEqual([slug]);
  });

  it("leaves alone a thread that is still valid, one with only an acknowledgement waiting for approval, and a thread that already closed", async () => {
    const stillValid = await live();
    const waiting = await fixtures.entry("pending_approval", { validUntil: new Date(Date.now() - 2 * HOUR) });
    const closedAlready = await overdue();
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${closedAlready.alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });

    expect(await expirer().run()).toEqual({ due: 0, closed: 0, skipped: 0, failed: 0 });

    expect(await threadRow(stillValid.alertId)).toMatchObject({ status: "open" });
    expect(await threadRow(waiting.alertId)).toMatchObject({ status: "open" });
    expect(await threadRow(closedAlready.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved" });
    for (const seeded of [stillValid, waiting, closedAlready]) expect(await finalsOf(seeded.alertId)).toHaveLength(0);
  });

  it("judges the entry that covers the thread: a later approved update with a valid-until ahead keeps it open, a later one that ran out closes it", async () => {
    const renewed = await overdue(3 * HOUR);
    await addEntry(renewed, "approved", { validUntil: new Date(Date.now() + 2 * HOUR) });
    const shortened = await live();
    await addEntry(shortened, "approved", { validUntil: new Date(Date.now() - HOUR) });

    const report = await expirer().run();

    expect(report).toMatchObject({ due: 1, closed: 1 });
    expect(await threadRow(renewed.alertId)).toMatchObject({ status: "open" });
    expect(await threadRow(shortened.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
  });

  it("discards the drafts and entries waiting for approval, cancels nothing of the system final, and closes a drill without raising the feed version", async () => {
    const drill = await overdue(2 * HOUR, { isDrill: true });
    const draft = await addEntry(drill, "draft");
    const pending = await addEntry(drill, "pending_approval");
    const before = await feedVersion();

    expect(await expirer().run()).toMatchObject({ closed: 1, failed: 0 });

    expect(await threadRow(drill.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
    const statuses = Object.fromEntries((await entryRows(drill.alertId)).map((row) => [row.id, row.status]));
    expect(statuses[draft]).toBe("discarded");
    expect(statuses[pending]).toBe("discarded");
    expect(statuses[drill.entryId]).toBe("approved");
    expect(await feedVersion()).toBe(before);
    const rows = await auditRows(drill.alertId);
    expect(rows.filter((row) => row.action === "entry.discarded").map((row) => row.meta.by_close)).toEqual([true, true]);
    expect(rows.every((row) => row.is_drill && row.actor_staff_id === null)).toBe(true);
  });

  it("stops the queued texts of every entry of the thread but the system final's own, through cancelQueued in the closing transaction", async () => {
    const seeded = await overdue();
    const cancelled: string[][] = [];
    await expirer({ cancelQueued: async (_tx, ids) => void cancelled.push([...ids]) }).run();
    const [final] = await finalsOf(seeded.alertId);
    expect(cancelled).toHaveLength(1);
    // Every entry of the thread but the system final (whose texts do not exist).
    expect(cancelled[0]).toEqual([seeded.entryId]);
    expect(cancelled[0]).not.toContain(final.id);
  });
});

describe("running twice, at once, or again after a failure", () => {
  it("closes the thread once with one final when the job is run again", async () => {
    const seeded = await overdue();
    expect(await expirer().run()).toMatchObject({ closed: 1 });
    expect(await expirer().run()).toEqual({ due: 0, closed: 0, skipped: 0, failed: 0 });
    expect(await finalsOf(seeded.alertId)).toHaveLength(1);
    expect((await auditRows(seeded.alertId)).filter((row) => row.action === "alert.closed")).toHaveLength(1);
  });

  it("closes each thread once with one final when several runs start at once", async () => {
    const seeded = await Promise.all(Array.from({ length: 4 }, () => overdue()));
    const reports = await Promise.all(Array.from({ length: 4 }, () => expirer().run()));

    expect(reports.reduce((sum, report) => sum + report.closed, 0)).toBe(4);
    expect(reports.reduce((sum, report) => sum + report.failed, 0)).toBe(0);
    for (const one of seeded) {
      expect(await threadRow(one.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
      expect(await finalsOf(one.alertId)).toHaveLength(1);
      expect((await auditRows(one.alertId)).filter((row) => row.action === "alert.closed")).toHaveLength(1);
    }
    expect((await opsEvents()).filter((event) => event.kind === "alert.expire_failed")).toEqual([]);
  });

  it("is a no-op for a thread another run closed after this one listed it (skipped, not failed)", async () => {
    const seeded = await overdue();
    // A blocker holds the thread's lock and closes it; the run lists the thread (still open to it), waits on the lock, and finds it closed.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const blockerSql = connect(serverUrl());
    const blocker = blockerSql.begin(async (tx) => {
      await tx`select id from alert where id = ${seeded.alertId} for update`;
      locked();
      await held;
      // Triggers off for this transaction only (no table lock, so the waiting run is not in its way): the thread is closed as another run's close would leave it.
      await tx`set local session_replication_role = replica`;
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${seeded.alertId}`;
    });
    await lockTaken;
    const running = expirer().run();
    for (let tries = 0; tries < 200; tries++) {
      const waiting = await owner`select 1 from pg_stat_activity where usename = 'cvh_app_login' and wait_event_type = 'Lock'`;
      if (waiting.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      if (tries === 199) throw new Error("the run never waited on the thread's lock");
    }
    release();
    await blocker;
    await blockerSql.end({ timeout: 5 });
    expect(await running).toEqual({ due: 1, closed: 0, skipped: 1, failed: 0 });
    expect(await finalsOf(seeded.alertId)).toHaveLength(0);
    expect(await threadRow(seeded.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved" });
  });

  it("records an ops event with no thread when the run as a whole fails, and throws so the route answers 500", async () => {
    const broken = createAlertExpiry({
      db: Object.assign(Object.create(app) as Db, {
        execute: async () => {
          throw Object.assign(new Error("relation missing for +14165550123"), { code: "42P01" });
        },
      }),
      finalText: () => FINAL_TEXT,
      ops: { record: (event) => recordOpsEvent(app, event) },
    });
    await expect(broken.run()).rejects.toThrow();
    const events = await opsEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "alert.expire_failed", subject_id: null });
    expect(JSON.stringify(events)).not.toContain("4165550123");
  });

  it("rolls back a thread whose close fails (no final, still open), records an ops event, goes on to the others, and closes it on the next run", async () => {
    const broken = await overdue(3 * HOUR);
    const fine = await overdue(2 * HOUR);
    let failures = 1;
    const flaky = expirer({
      cancelQueued: async (tx, ids) => {
        if (ids.includes(broken.entryId) && failures-- > 0) throw Object.assign(new Error("connection reset for +14165550123"), { code: "ECONNRESET" });
      },
    });

    const first = await flaky.run();

    expect(first).toEqual({ due: 2, closed: 1, skipped: 0, failed: 1 });
    expect(await threadRow(broken.alertId)).toMatchObject({ status: "open" });
    expect(await finalsOf(broken.alertId)).toHaveLength(0);
    expect(await threadRow(fine.alertId)).toMatchObject({ status: "closed" });
    const failed = (await opsEvents()).filter((event) => event.kind === "alert.expire_failed");
    expect(failed).toEqual([{ kind: "alert.expire_failed", subject_id: broken.alertId, detail: { error: "ECONNRESET" } }]);
    expect(JSON.stringify(failed)).not.toContain("4165550123");

    const second = await flaky.run();

    expect(second).toEqual({ due: 1, closed: 1, skipped: 0, failed: 0 });
    expect(await threadRow(broken.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
    expect(await finalsOf(broken.alertId)).toHaveLength(1);
  });

  it("records an ops event for a thread closed more than five minutes late (runs were missed), and none for a thread closed on time", async () => {
    const late = await overdue(90 * 60_000);
    const onTime = await overdue(30_000);

    await expirer().run();

    const events = await opsEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "alert.expire_late", subject_id: late.alertId });
    expect(Number(events[0].detail.minutes_late)).toBeGreaterThanOrEqual(89);
    expect(Number(events[0].detail.minutes_late)).toBeLessThanOrEqual(92);
    expect(await threadRow(onTime.alertId)).toMatchObject({ status: "closed" });
  });

  it("closes only as many as its batch limit in a run and the rest on the next run", async () => {
    const seeded = await Promise.all(Array.from({ length: 3 }, (_, index) => overdue((index + 2) * HOUR)));
    expect(await expirer({ batchLimit: 2 }).run()).toMatchObject({ due: 2, closed: 2 });
    expect(await expirer({ batchLimit: 2 }).run()).toMatchObject({ due: 1, closed: 1 });
    for (const one of seeded) expect(await threadRow(one.alertId)).toMatchObject({ status: "closed" });
  });
});

describe("the database and the system final", () => {
  const insertFinal = async (tx: postgres.TransactionSql, alertId: string, authorId: string, over: { status?: string; kind?: string } = {}) => {
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, web_published_at)
             select ${randomUUID()}, alert_id, ${over.kind ?? "final"}, ${over.status ?? "published_system"}, ${authorId}, ${[authorId]}, 'System words', types, audience, phase, valid_until, ${null}
             from alert_entry where alert_id = ${alertId} limit 1`;
  };

  it("refuses a published_system entry without the expire job's session variable, with or without an acting account, as the app's role", async () => {
    const seeded = await overdue();
    await expect(appSql.begin((tx) => insertFinal(tx, seeded.alertId, seeded.authorId))).rejects.toThrow(/starts as a draft/);
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${seeded.authorId}, true)`;
        await insertFinal(tx, seeded.alertId, seeded.authorId);
      }),
    ).rejects.toThrow(/starts as a draft/);
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'someone', true)`;
        await insertFinal(tx, seeded.alertId, seeded.authorId);
      }),
    ).rejects.toThrow(/starts as a draft/);
    expect(await finalsOf(seeded.alertId)).toHaveLength(0);
  });

  it("refuses the job's session variable for anything but a final of an open thread whose covering entry has run out", async () => {
    const stillValid = await live();
    const expiring = await overdue();
    const asJob = (alertId: string, authorId: string, over: { status?: string; kind?: string } = {}) =>
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'expire', true)`;
        await insertFinal(tx, alertId, authorId, over);
      });
    await expect(asJob(stillValid.alertId, stillValid.authorId)).rejects.toThrow(/past its valid-until/);
    await expect(asJob(expiring.alertId, expiring.authorId, { kind: "update" })).rejects.toThrow(/makes a final/);
    // A status other than a draft or published_system is still refused as a new entry's status.
    await expect(asJob(expiring.alertId, expiring.authorId, { status: "approved" })).rejects.toThrow(/starts as a draft/);
    expect(await finalsOf(expiring.alertId)).toHaveLength(0);
    // The one case that is allowed, as the job makes it.
    await asJob(expiring.alertId, expiring.authorId);
    expect(await finalsOf(expiring.alertId)).toMatchObject([{ status: "published_system" }]);
    // And only one, whether it is made again or approved.
    await expect(asJob(expiring.alertId, expiring.authorId)).rejects.toThrow(/alert_entry_one_final/);
  });

  it("refuses a system final that carries approval fields, or that names an author other than the thread's own", async () => {
    const seeded = await overdue();
    const others = await owner<{ id: string }[]>`select id from staff_account where id <> ${seeded.authorId} limit 1`;
    const asJob = (column: string | null, value: string | null, author = seeded.authorId) =>
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'expire', true)`;
        await tx.unsafe(
          `insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until${column ? `, ${column}` : ""})
           select '${randomUUID()}', alert_id, 'final', 'published_system', '${author}', array['${author}']::uuid[], 'System words', types, audience, phase, valid_until${value ? `, ${value}` : ""}
           from alert_entry where alert_id = '${seeded.alertId}' limit 1`,
        );
      });
    await expect(asJob("approved_at", "now()")).rejects.toThrow(/no version, return/);
    await expect(asJob("approved_version", "1")).rejects.toThrow(/no version, return/);
    await expect(asJob("approved_hash", `'${"c".repeat(64)}'`)).rejects.toThrow(/no version, return/);
    if (others[0]) await expect(asJob(null, null, others[0].id)).rejects.toThrow(/thread's own author/);
    expect(await finalsOf(seeded.alertId)).toHaveLength(0);
  });

  it("refuses to make a system final in a closed thread", async () => {
    const seeded = await overdue();
    await expirer().run();
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'expire', true)`;
        await insertFinal(tx, seeded.alertId, seeded.authorId);
      }),
    ).rejects.toThrow(/ALERT_CLOSED/);
  });

  it("gives no way into published_system from an existing entry, and no way out of it, for the job or anyone", async () => {
    const seeded = await overdue();
    const draft = await addEntry(seeded, "draft");
    const pending = await addEntry(seeded, "pending_approval");
    for (const [id, from] of [[draft, "draft"], [pending, "pending_approval"], [seeded.entryId, "approved"]] as const) {
      await expect(
        appSql.begin(async (tx) => {
          await tx`select set_config('cvh.system_actor', 'expire', true)`;
          await tx`select set_config('cvh.actor_id', ${seeded.authorId}, true)`;
          await tx`update alert_entry set status = 'published_system' where id = ${id}`;
        }),
        from,
      ).rejects.toThrow(/not an allowed transition/);
    }
    await expirer().run();
    const [final] = await finalsOf(seeded.alertId);
    for (const to of ["approved", "discarded", "superseded", "draft"]) {
      await expect(
        appSql.begin(async (tx) => {
          await tx`select set_config('cvh.system_actor', 'expire', true)`;
          await tx`select set_config('cvh.actor_id', ${seeded.authorId}, true)`;
          await tx`update alert_entry set status = ${to} where id = ${final.id}`;
        }),
        to,
      ).rejects.toThrow(/ALERT_CLOSED|not an allowed transition/);
    }
  });

  it("lets the job's session variable discard an unread entry without an account, and nothing else without one", async () => {
    const seeded = await overdue();
    const draft = await addEntry(seeded, "draft");
    await expect(appSql.begin((tx) => tx`update alert_entry set status = 'discarded' where id = ${draft}`)).rejects.toThrow(/acting account/);
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'expire', true)`;
        await tx`update alert_entry set original_text = 'changed' where id = ${draft}`;
      }),
    ).rejects.toThrow(/acting account/);
    // The session variable alone discards nothing: it needs the system final made in the same transaction.
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.system_actor', 'expire', true)`;
        await tx`update alert_entry set status = 'discarded' where id = ${draft}`;
      }),
    ).rejects.toThrow(/acting account/);
    expect((await owner`select status from alert_entry where id = ${draft}`)[0].status).toBe("draft");
    await appSql.begin(async (tx) => {
      await tx`select set_config('cvh.system_actor', 'expire', true)`;
      await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until)
               select ${randomUUID()}, alert_id, 'final', 'published_system', author_id, editor_ids, 'System words', types, audience, phase, valid_until
               from alert_entry where id = ${seeded.entryId}`;
      await tx`update alert_entry set status = 'discarded', discard_reason = 'by_close' where id = ${draft}`;
    });
    expect((await owner`select status from alert_entry where id = ${draft}`)[0].status).toBe("discarded");
  });

  it("still refuses the app's role closing a thread as expired without the system final made in the same transaction", async () => {
    const seeded = await overdue();
    await expect(appSql.begin((tx) => tx`update alert set status = 'closed', closed_reason = 'expired', closed_at = now() where id = ${seeded.alertId}`)).rejects.toThrow(/closed beside the entry/);
    const [only] = await entryRows(seeded.alertId);
    await expect(
      appSql.begin((tx) => tx`update alert set status = 'closed', closed_reason = 'expired', closed_at = now(), closing_entry_id = ${only.id} where id = ${seeded.alertId}`),
    ).rejects.toThrow(/closes only beside/);
    expect(await threadRow(seeded.alertId)).toMatchObject({ status: "open" });
  });
});
