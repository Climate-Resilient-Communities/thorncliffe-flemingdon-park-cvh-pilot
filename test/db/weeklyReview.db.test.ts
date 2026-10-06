// The weekly reliability review against a real database (S09.04, NFR-N4, AR-21 weekly view, AR-18): the SQL view `weekly_review` over `ops_event`, `delivery` and
// `audit_event`, read as the app's own role (cvh_app_login), and scripts/export-weekly's CSV.
//  - every section of the AC: health conditions with start, end and duration; failed, undelivered and unknown texts by language and reason; resends; pauses;
//    cap overruns; translation fallbacks by language; publish failures; approval-to-first-hand-off and to-90%-delivered per entry ("not reached"); slow
//    deliveries over 10 minutes; access requests open longer than 25 days;
//  - the week is Monday to Sunday in Toronto (across the end of daylight time), and the small-number rule (1 to 4 hidden, a second cell hidden when one
//    would be revealed, a percentage from a numerator or denominator of 1 to 4 not shown, zero shown), with drills on their own lines;
//  - no personal data: the view's columns, its rows and the CSV hold no phone number, recipient id or message body; the app's client roles cannot read it;
//  - no notes table and no write endpoint (the notes are files in docs/procedures/weekly-notes).
// Every time is relative to the real clock or to a fixed week the database never compares with its own clock (test/db/helpers.ts inDays).
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runExportWeekly } from "../../scripts/ops/export-weekly";
import { migrate } from "../../scripts/db/migrate.mjs";
import { WEEKLY_CSV_COLUMNS, lastFullWeek, readWeeklyReview, weeklyReviewExport, type WeeklyRow, type WeeklySection } from "../../src/modules/ops";
import { createDb, type Db } from "../../src/platform/db";
import { deliveryFixtures, type SeededEntry } from "./deliveryFixtures";
import { connect, ROOT, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let fx: ReturnType<typeof deliveryFixtures>;
let opsBaseline = 0;
let auditBaseline = 0;
let madeNeighbourhood = false;

/** The last complete week, relative to the real clock, and a fixed week across the end of daylight time (Sunday 2026-11-01 is 25 hours long). */
const WEEK = lastFullWeek(new Date());
const DST_WEEK = "2026-10-26";

/** An instant `days` days and `hours` hours after a week's Monday 00:00 in Toronto. */
async function at(week: string, days: number, hours = 0, minutes = 0): Promise<Date> {
  const [row] = await owner`select (((${week}::date + ${days}::int * interval '1 day' + ${hours}::int * interval '1 hour' + ${minutes}::int * interval '1 minute')::timestamp) at time zone 'America/Toronto') as t`;
  return new Date(row.t);
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  fx = deliveryFixtures(owner);
  [{ max: opsBaseline }] = await owner`select coalesce(max(id), 0)::int as max from ops_event`;
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhood = true;
  }
});

async function clear() {
  // The translations of an approved entry are frozen (a trigger): a test that made some removes them with the triggers off.
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`delete from alert_entry_translation`;
  });
  await fx.cleanup();
  await owner`delete from ops_event where id > ${opsBaseline}`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
}

beforeEach(clear);
afterEach(clear);
afterAll(async () => {
  await clear();
  if (madeNeighbourhood) await owner`delete from neighbourhood where id = 'TP'`;
  await appSql.end({ timeout: 5 });
  await app.$client.end({ timeout: 5 });
  await owner.end({ timeout: 5 });
});

// --- seeding -----------------------------------------------------------------------------------------------

async function opsEvent(kind: string, when: Date, detail: Record<string, unknown> = {}, subject?: { type: string; id: string }) {
  await owner`insert into ops_event (at, kind, severity, subject_type, subject_id, detail)
              values (${when}, ${kind}, 'warning', ${subject?.type ?? null}, ${subject?.id ?? null}, ${owner.json(detail as never)})`;
}

async function audit(action: string, when: Date, over: { outcome?: "ok" | "refused"; subject?: string; isDrill?: boolean } = {}) {
  await owner`insert into audit_event (at, actor_staff_id, action, subject_type, subject_id, outcome, is_drill, meta)
              values (${when}, null, ${action}, ${action.startsWith("access") ? "access_request" : "messaging_control"}, ${over.subject ?? "1"}, ${over.outcome ?? "ok"}::audit_outcome, ${over.isDrill ?? false}, '{}'::jsonb)`;
}

interface DeliverySeed {
  state?: string;
  lang?: string;
  entryId?: string | null;
  recipientKind?: string;
  kind?: "alert" | "transactional";
  body?: string;
  key?: string;
  errorCode?: number | null;
  handedOffAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

/** One delivery row, written by the owner with the row guards off (the guards bind the app; a review test needs rows from any week and any state). */
async function delivery(seed: DeliverySeed = {}): Promise<string> {
  const id = randomUUID();
  const state = seed.state ?? "failed";
  const kind = seed.kind ?? (seed.entryId ? "alert" : "transactional");
  const handedOff = seed.handedOffAt ?? null;
  const terminal = ["delivered", "undelivered", "failed", "cancelled", "skipped", "skipped_env"].includes(state);
  const completedAt = terminal ? (seed.completedAt ?? seed.updatedAt ?? new Date()) : null;
  const providerId = ["submitted", "delivered", "undelivered"].includes(state) ? `SM${randomBytes(16).toString("hex")}` : null;
  const claimed = handedOff !== null ? (seed.createdAt ?? handedOff) : null;
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, purpose, lang, body, segments, cost_estimate_cents, idempotency_key,
                                   state, attempts, send_by, claimed_at, claimed_by, claim_token, handed_off_at, submitted_at, provider_message_id, provider_error_code,
                                   completed_at, created_at, updated_at, due_at)
             values (${id}, ${kind}, ${seed.recipientKind ?? "subscriber"}, ${randomUUID()}, ${kind === "alert" ? (seed.entryId ?? null) : null},
                     ${kind === "alert" ? "alerting" : "subscriptions"}, ${kind === "alert" ? null : "signup_confirm"}, ${seed.lang ?? "en"}, ${seed.body ?? "Hello"}, 1, 1,
                     ${seed.key ?? `k:${id}`}, ${state}, 0, ${kind === "alert" ? null : new Date(Date.now() + 86_400_000)}, ${claimed}, ${claimed ? "worker-1" : null},
                     ${state === "claimed" ? randomUUID() : null}, ${handedOff}, ${handedOff}, ${providerId}, ${seed.errorCode ?? null}, ${completedAt},
                     ${seed.createdAt ?? new Date(Date.now() - 2 * 86_400_000)}, ${seed.updatedAt ?? seed.createdAt ?? new Date(Date.now() - 86_400_000)}, ${seed.createdAt ?? new Date(Date.now() - 2 * 86_400_000)})`;
  });
  return id;
}

/** `count` rows of the same kind of text. */
async function many(count: number, seed: DeliverySeed) {
  for (let i = 0; i < count; i += 1) await delivery(seed);
}

/** An approved entry (of a drill thread when asked) whose approval is at `approvedAt`. */
async function approvedEntry(approvedAt: Date, isDrill = false): Promise<SeededEntry> {
  const entry = await fx.entry("approved", { isDrill });
  await owner.begin(async (tx) => {
    await tx.unsafe("set local session_replication_role = replica");
    await tx`update alert_entry set approved_at = ${approvedAt} where id = ${entry.entryId}`;
  });
  return entry;
}

const review = (week = WEEK) => readWeeklyReview(app, week);
const of = (rows: WeeklyRow[], section: WeeklySection, isDrill = false) => rows.filter((row) => row.section === section && row.isDrill === isDrill);
const cells = (rows: WeeklyRow[]) => rows.map((row) => `${row.lang ?? "total"}${row.reason === null ? "" : `/${row.reason}`}=${row.nShown}`).sort();

// --- the sections --------------------------------------------------------------------------------------------

describe("health conditions", () => {
  it("lists an episode with its start, end and duration, and one still going with no end", async () => {
    const start = await at(WEEK, 1, 9);
    await opsEvent("health.condition_alerted", start, { condition: "queue_stuck", count: 3, notified: 2, first: true });
    // A later alert of the same episode (the 30-minute repeat) is not a new episode.
    await opsEvent("health.condition_alerted", await at(WEEK, 1, 9, 30), { condition: "queue_stuck", count: 3, notified: 2, first: false });
    await opsEvent("health.condition_recovered", await at(WEEK, 1, 9, 25), { condition: "queue_stuck" });
    // Another condition's recovery does not end this one.
    await opsEvent("health.condition_alerted", await at(WEEK, 2, 8), { condition: "job_failed", count: 1, notified: 0, first: true, rate_limited: true });
    await opsEvent("health.condition_recovered", await at(WEEK, 2, 8, 5), { condition: "queue_stuck" });
    // An episode of another week is not this week's.
    await opsEvent("health.condition_alerted", await at(WEEK, -2, 8), { condition: "sender_stalled", count: 1, notified: 1, first: true });

    const rows = of(await review(), "health_condition");

    expect(rows.map((row) => row.reason)).toEqual(["queue_stuck", "job_failed"]);
    expect(rows[0]).toMatchObject({ startedAt: start, endedAt: await at(WEEK, 1, 9, 25), durationSeconds: 25 * 60, isDrill: false, lang: null, n: null });
    expect(rows[1]).toMatchObject({ endedAt: null, durationSeconds: null });
  });

  it("ends an episode at the next first alert of the same condition when no recovery came between", async () => {
    await opsEvent("health.condition_alerted", await at(WEEK, 1, 9), { condition: "queue_stuck", count: 1, notified: 1, first: true });
    await opsEvent("health.condition_alerted", await at(WEEK, 1, 10), { condition: "queue_stuck", count: 1, notified: 1, first: true });
    await opsEvent("health.condition_recovered", await at(WEEK, 1, 11), { condition: "queue_stuck" });

    const rows = of(await review(), "health_condition");

    expect(rows.map((row) => row.durationSeconds)).toEqual([3600, 3600]);
  });

  it("reads an episode from the week it began in", async () => {
    await opsEvent("health.condition_alerted", await at(WEEK, 8, 3), { condition: "queue_stuck", count: 1, notified: 0, first: true });
    const [{ week }] = await owner`select ((${WEEK}::date + 7))::text as week`;
    expect(of(await review(), "health_condition")).toEqual([]);
    expect(of(await review(week), "health_condition")).toHaveLength(1);
  });
});

describe("failed, undelivered and unknown texts", () => {
  it("counts them by language and reason, with a total, and gives an unknown text its cause", async () => {
    const when = await at(WEEK, 2, 10);
    await many(6, { state: "undelivered", lang: "en", errorCode: 30003, updatedAt: when, completedAt: when });
    await many(8, { state: "undelivered", lang: "ur", errorCode: 30003, updatedAt: when, completedAt: when });
    await many(5, { state: "failed", lang: "en", errorCode: null, updatedAt: when, completedAt: when });
    for (let i = 0; i < 5; i += 1) {
      const id = await delivery({ state: "unknown", lang: "ps", updatedAt: when });
      await opsEvent("delivery.unknown", when, { cause: "timeout" }, { type: "delivery", id });
    }

    const rows = of(await review(), "delivery_problem");

    expect(cells(rows)).toEqual(
      ["en/failed:no_code=5", "en/undelivered:30003=6", "ps/unknown:timeout=5", "total/failed:no_code=5", "total/unknown:timeout=5", "total/undelivered:30003=14", "ur/undelivered:30003=8"].sort(),
    );
  });

  it("hides a count of 1 to 4 and, when one hidden cell would be revealed by the total, the smallest visible cell too", async () => {
    const when = await at(WEEK, 2, 10);
    // One hidden cell (ps 2) beside two visible ones: the smallest visible (en 6) is hidden as well, so the total (15) reveals neither.
    await many(6, { state: "undelivered", lang: "en", errorCode: 30005, updatedAt: when, completedAt: when });
    await many(7, { state: "undelivered", lang: "ur", errorCode: 30005, updatedAt: when, completedAt: when });
    await many(2, { state: "undelivered", lang: "ps", errorCode: 30005, updatedAt: when, completedAt: when });
    // Two hidden cells (ps 2, ta 3) beside one visible (en 9): nothing more is hidden, since neither can be told from the total.
    await many(9, { state: "undelivered", lang: "en", errorCode: 30006, updatedAt: when, completedAt: when });
    await many(2, { state: "undelivered", lang: "ps", errorCode: 30006, updatedAt: when, completedAt: when });
    await many(3, { state: "undelivered", lang: "ta", errorCode: 30006, updatedAt: when, completedAt: when });
    // A total of 1 to 4 is hidden as well.
    await many(3, { state: "failed", lang: "es", errorCode: 21610, updatedAt: when, completedAt: when });

    const rows = of(await review(), "delivery_problem");

    expect(cells(rows)).toEqual(
      [
        "en/undelivered:30005=fewer than 5",
        "ur/undelivered:30005=7",
        "ps/undelivered:30005=fewer than 5",
        "total/undelivered:30005=15",
        "en/undelivered:30006=9",
        "ps/undelivered:30006=fewer than 5",
        "ta/undelivered:30006=fewer than 5",
        "total/undelivered:30006=14",
        "es/failed:21610=fewer than 5",
        "total/failed:21610=fewer than 5",
      ].sort(),
    );
    // A hidden cell has no number at all, not only a different label.
    for (const row of rows.filter((candidate) => candidate.nShown === "fewer than 5")) expect(row.n).toBeNull();
  });

  it("keeps a drill apart: its texts are never in the real counts", async () => {
    const when = await at(WEEK, 3, 10);
    await many(6, { state: "undelivered", lang: "en", errorCode: 30003, updatedAt: when, completedAt: when });
    await many(6, { state: "undelivered", lang: "en", errorCode: 30003, updatedAt: when, completedAt: when, recipientKind: "roster" });

    const rows = await review();

    expect(cells(of(rows, "delivery_problem"))).toEqual(["en/undelivered:30003=6", "total/undelivered:30003=6"].sort());
    expect(cells(of(rows, "delivery_problem", true))).toEqual(["en/undelivered:30003=6", "total/undelivered:30003=6"].sort());
  });

  it("leaves out texts that did not fail, and texts of another week", async () => {
    const when = await at(WEEK, 3, 10);
    await many(6, { state: "delivered", handedOffAt: when, completedAt: when, updatedAt: when });
    await many(6, { state: "undelivered", errorCode: 30003, updatedAt: await at(WEEK, -3, 10), completedAt: await at(WEEK, -3, 10) });
    expect(of(await review(), "delivery_problem")).toEqual([]);
  });
});

describe("resends", () => {
  it("counts the resends of the week by language and number", async () => {
    const when = await at(WEEK, 4, 11);
    for (let i = 0; i < 5; i += 1) await delivery({ state: "queued", lang: "en", key: `resend:${randomUUID()}:1`, createdAt: when });
    await delivery({ state: "queued", lang: "en", key: `resend:${randomUUID()}:2`, createdAt: when });
    await delivery({ state: "queued", lang: "en", createdAt: when });

    expect(cells(of(await review(), "resend"))).toEqual(["en/resend_1=5", "en/resend_2=fewer than 5", "total/resend_1=5", "total/resend_2=fewer than 5"].sort());
  });
});

describe("pauses", () => {
  it("lists each pause with its start, end and duration, and ignores a refused one", async () => {
    const paused = await at(WEEK, 2, 14);
    await audit("sending.paused", paused);
    await audit("sending.resumed", await at(WEEK, 2, 15));
    await audit("sending.paused", await at(WEEK, 3, 14), { outcome: "refused" });
    await audit("sending.paused", await at(WEEK, 5, 9));

    const rows = of(await review(), "pause");

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ startedAt: paused, endedAt: await at(WEEK, 2, 15), durationSeconds: 3600 });
    expect(rows[1]).toMatchObject({ endedAt: null, durationSeconds: null });
  });
});

describe("cap overruns and publish failures", () => {
  it("lists each cap overrun with by how much it passed the cap, and each failed publish with its reason", async () => {
    await opsEvent("spend.cap_overrun", await at(WEEK, 1, 12), { over_cents: 250 });
    await opsEvent("spend.cap_overrun", await at(WEEK, 6, 12), {});
    await opsEvent("directory.publish_failed", await at(WEEK, 2, 12), { reason: "gave_up", attempts: 3 });

    const rows = await review();

    expect(of(rows, "cap_overrun").map((row) => row.amountCents)).toEqual([250, null]);
    expect(of(rows, "publish_failure").map((row) => row.reason)).toEqual(["gave_up"]);
  });
});

describe("search below the launch bar (S03.09)", () => {
  it("lists each measure a manual run of the search test set found below its minimum, with its language and when it ran", async () => {
    await opsEvent("search.below_bar", await at(WEEK, 3, 10), { measure: "hit_rate", lang: "ur", observed_permille: 600, minimum_permille: 700, checkpoint: "week_4" }, { type: "directory_release", id: "4" });
    await opsEvent("search.below_bar", await at(WEEK, 3, 10, 1), { measure: "emergency_accuracy", minimum_permille: 1000, checkpoint: "week_4" }, { type: "directory_release", id: "4" });
    // Another week's run is that week's.
    await opsEvent("search.below_bar", await at(WEEK, -4, 10), { measure: "no_match_accuracy", observed_permille: 800, minimum_permille: 900, checkpoint: "pre_launch" });

    const rows = of(await review(), "search_below_bar").sort((a, b) => a.startedAt!.getTime() - b.startedAt!.getTime());

    expect(rows.map((row) => [row.reason, row.lang, row.isDrill, row.n, row.nShown])).toEqual([
      ["hit_rate", "ur", false, null, null],
      ["emergency_accuracy", null, false, null, null],
    ]);
    expect(rows[0]!.startedAt).toEqual(await at(WEEK, 3, 10));
  });
});

describe("translation fallbacks", () => {
  it("counts the entries whose language fell back, once each, by language, a drill apart", async () => {
    const entries: SeededEntry[] = [];
    for (let i = 0; i < 5; i += 1) entries.push(await approvedEntry(await at(WEEK, 1, 10)));
    const drill = await approvedEntry(await at(WEEK, 1, 10), true);
    const fallback = async (entry: SeededEntry, lang: string, status = "fallback_en") => {
      await owner.begin(async (tx) => {
        await tx.unsafe("set local session_replication_role = replica");
        await tx`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash)
                 values (${entry.entryId}, ${lang}, 'English text', ${status !== "fallback_en"}, ${status === "fallback_en" ? null : "model-x"}, ${status}, ${randomBytes(32).toString("hex")})`;
      });
    };
    for (const entry of entries) {
      await fallback(entry, "ur");
      await opsEvent("alert.translation_fallback", await at(WEEK, 1, 11), { languages: 1 }, { type: "alert_entry", id: entry.entryId });
    }
    // Submitted twice: still one entry, one language.
    await opsEvent("alert.translation_fallback", await at(WEEK, 1, 12), { languages: 1 }, { type: "alert_entry", id: entries[0].entryId });
    // A language that was translated is no fallback; two entries fell back in Pashto (a hidden cell).
    await fallback(entries[0], "ta", "translated");
    await fallback(entries[0], "ps");
    await fallback(entries[1], "ps");
    await fallback(drill, "ur");
    await opsEvent("alert.translation_fallback", await at(WEEK, 1, 11), { languages: 1 }, { type: "alert_entry", id: drill.entryId });

    const rows = await review();

    // Pashto (2) is hidden and Urdu (5) is the one visible cell beside it, so it is hidden too, and the total (7) shows.
    expect(cells(of(rows, "translation_fallback"))).toEqual(["ps=fewer than 5", "total=7", "ur=fewer than 5"].sort());
    expect(cells(of(rows, "translation_fallback", true))).toEqual(["total=fewer than 5", "ur=fewer than 5"].sort());
  });
});

describe("slow deliveries", () => {
  it("counts the texts delivered more than 10 minutes after they were handed to the provider", async () => {
    const handed = await at(WEEK, 2, 9);
    const done = (minutes: number, seconds = 0) => new Date(handed.getTime() + minutes * 60_000 + seconds * 1000);
    await many(5, { state: "delivered", lang: "en", handedOffAt: handed, completedAt: done(11) });
    await many(3, { state: "delivered", lang: "en", handedOffAt: handed, completedAt: done(9) });
    await delivery({ state: "delivered", lang: "en", handedOffAt: handed, completedAt: done(10) });
    await delivery({ state: "delivered", lang: "en", handedOffAt: handed, completedAt: done(10, 1) });

    expect(cells(of(await review(), "slow_delivery"))).toEqual(["en=6", "total=6"].sort());
  });
});

describe("approval-to-first-hand-off and to-90%-delivered times per entry", () => {
  it("reports the times per entry and language, 'not reached' with the share, and keeps the denominator to the texts handed off", async () => {
    const approved = await at(WEEK, 2, 9);
    const after = (seconds: number) => new Date(approved.getTime() + seconds * 1000);
    const entry = await approvedEntry(approved);
    // English: 10 handed off, 9 delivered (the 90% is the 9th delivery, at 180 s); cancelled and skipped texts were never sent, so not in the denominator.
    for (let i = 0; i < 9; i += 1) await delivery({ state: "delivered", lang: "en", entryId: entry.entryId, handedOffAt: after(30 + i), completedAt: after(100 + 10 * i) });
    await delivery({ state: "submitted", lang: "en", entryId: entry.entryId, handedOffAt: after(31) });
    await many(2, { state: "cancelled", lang: "en", entryId: entry.entryId });
    await delivery({ state: "skipped", lang: "en", entryId: entry.entryId });
    // Urdu: 10 handed off, 5 delivered: 90% is never reached and the delivered share is 50%.
    for (let i = 0; i < 5; i += 1) await delivery({ state: "delivered", lang: "ur", entryId: entry.entryId, handedOffAt: after(45), completedAt: after(70 + i) });
    for (let i = 0; i < 5; i += 1) await delivery({ state: "undelivered", lang: "ur", entryId: entry.entryId, handedOffAt: after(46), errorCode: 30003, completedAt: after(80) });
    // Pashto: 6 handed off and none delivered: not reached, and 0% is shown as 0.
    await many(6, { state: "submitted", lang: "ps", entryId: entry.entryId, handedOffAt: after(50) });
    // Tamil: 3 handed off and all delivered: the count shows as "fewer than 5", the hand-off time shows, and the 90% reading (a percentage of 3) does not.
    for (let i = 0; i < 3; i += 1) await delivery({ state: "delivered", lang: "ta", entryId: entry.entryId, handedOffAt: after(40), completedAt: after(90 + i) });
    // Spanish: 8 handed off, 2 delivered: 25% is a numerator of 2, so the share is not shown.
    for (let i = 0; i < 2; i += 1) await delivery({ state: "delivered", lang: "es", entryId: entry.entryId, handedOffAt: after(41), completedAt: after(95) });
    await many(6, { state: "submitted", lang: "es", entryId: entry.entryId, handedOffAt: after(42) });
    // An entry that is not approved has no timing.
    const pending = await fx.entry("pending_approval");
    await delivery({ state: "queued", lang: "en", entryId: pending.entryId, kind: "alert" });

    const rows = of(await review(), "entry_timing");
    const by = Object.fromEntries(rows.map((row) => [row.lang, row]));

    expect(rows.every((row) => row.entryId === entry.entryId)).toBe(true);
    expect(rows).toHaveLength(5);
    expect(by.en).toMatchObject({ nShown: "10", firstHandOffSeconds: 30, ninetyPercentStatus: "reached", deliveredSharePercent: null });
    expect(by.en.ninetyPercentSeconds).toBe(180);
    expect(by.ur).toMatchObject({ nShown: "10", firstHandOffSeconds: 45, ninetyPercentStatus: "not reached", ninetyPercentSeconds: null, deliveredSharePercent: 50 });
    expect(by.ps).toMatchObject({ nShown: "6", firstHandOffSeconds: 50, ninetyPercentStatus: "not reached", deliveredSharePercent: 0 });
    expect(by.ta).toMatchObject({ n: null, nShown: "fewer than 5", firstHandOffSeconds: 40, ninetyPercentSeconds: null, ninetyPercentStatus: null, deliveredSharePercent: null });
    expect(by.es).toMatchObject({ nShown: "8", ninetyPercentStatus: "not reached", deliveredSharePercent: null });
  });

  it("shows neither the 90% status nor its time when 1 to 4 texts were handed off, whatever was delivered", async () => {
    const approved = await at(WEEK, 2, 9);
    const entry = await approvedEntry(approved);
    await delivery({ state: "delivered", lang: "ta", entryId: entry.entryId, handedOffAt: new Date(approved.getTime() + 30_000), completedAt: new Date(approved.getTime() + 60_000) });
    await many(2, { state: "submitted", lang: "ta", entryId: entry.entryId, handedOffAt: new Date(approved.getTime() + 31_000) });

    const [row] = of(await review(), "entry_timing");

    expect(row).toMatchObject({ n: null, nShown: "fewer than 5", firstHandOffSeconds: 30, ninetyPercentStatus: null, ninetyPercentSeconds: null, deliveredSharePercent: null });
  });

  it("reports a drill's entry apart", async () => {
    const approved = await at(WEEK, 2, 9);
    const entry = await approvedEntry(approved, true);
    await many(5, { state: "delivered", lang: "en", entryId: entry.entryId, recipientKind: "roster", handedOffAt: new Date(approved.getTime() + 10_000), completedAt: new Date(approved.getTime() + 20_000) });

    const rows = await review();

    expect(of(rows, "entry_timing")).toEqual([]);
    expect(of(rows, "entry_timing", true)).toHaveLength(1);
  });
});

describe("access requests open longer than 25 days", () => {
  it("flags a request in each week it was open for more than 25 days, not one answered in time", async () => {
    const day = (days: number, hours = 12) => at(WEEK, days, hours);
    // Open since 20 days before the week: over 25 days from the Saturday of the week on, so flagged in this week and every week after.
    await audit("access_request.received", await day(-20), { subject: "open_now" });
    // Answered 27 days after it came in, in the week before: flagged in that week only.
    await audit("access_request.received", await day(-30), { subject: "answered_late" });
    await audit("access_request.closed", await day(-3), { subject: "answered_late" });
    // Answered in 11 days: never flagged.
    await audit("access_request.received", await day(-10), { subject: "in_time" });
    await audit("access_request.closed", await day(1), { subject: "in_time" });
    // Came in 26 days before the week, answered the Thursday of it (29 days): late in the week before and in this week.
    await audit("access_request.received", await day(-26), { subject: "late_two_weeks" });
    await audit("access_request.closed", await day(3), { subject: "late_two_weeks" });
    // A drill's request and a refused record are not the real requests.
    await audit("access_request.received", await day(-40), { subject: "drill", isDrill: true });
    await audit("access_request.received", await day(-40), { subject: "refused", outcome: "refused" });

    const thisWeek = await review();
    const [{ week: previous }] = await owner`select ((${WEEK}::date - 7))::text as week`;
    const lastWeek = await review(previous);

    expect(of(thisWeek, "access_request_overdue").map((row) => row.reason).sort()).toEqual(["closed_late", "open"]);
    expect(of(thisWeek, "access_request_overdue", true).map((row) => row.reason)).toEqual(["open"]);
    expect(of(lastWeek, "access_request_overdue").map((row) => row.reason).sort()).toEqual(["closed_late", "closed_late"]);
    const open = of(thisWeek, "access_request_overdue").find((row) => row.reason === "open");
    expect(open?.endedAt).toBeNull();
    expect(open?.durationSeconds).toBeGreaterThan(25 * 86_400);
  });
});

// --- the week, the rule and the data ------------------------------------------------------------------------------

describe("the week", () => {
  it("is Monday 00:00 to Sunday 23:59 in Toronto, across the end of daylight time", async () => {
    await opsEvent("directory.publish_failed", await at(DST_WEEK, 0, 0), { reason: "gave_up", attempts: 3 });
    // The last minute of Sunday 2026-11-01, an hour after daylight time ended: still the week of 2026-10-26.
    const sunday = new Date("2026-11-02T04:59:00Z");
    expect(sunday.getTime()).toBe((await at("2026-11-02", 0, 0)).getTime() - 60_000);
    await opsEvent("directory.publish_failed", sunday, { reason: "unexpected", attempts: 1 });
    // The first minute of Monday 2026-11-02.
    await opsEvent("directory.publish_failed", new Date("2026-11-02T05:00:00Z"), { reason: "storage_unavailable", attempts: 1 });
    // The last minute of Sunday 2026-10-25.
    await opsEvent("directory.publish_failed", new Date("2026-10-26T03:59:00Z"), { reason: "invalid_catalogue", attempts: 1 });

    expect(of(await review(DST_WEEK), "publish_failure").map((row) => row.reason)).toEqual(["gave_up", "unexpected"]);
    expect(of(await review("2026-11-02"), "publish_failure").map((row) => row.reason)).toEqual(["storage_unavailable"]);
    expect(of(await review("2026-10-19"), "publish_failure").map((row) => row.reason)).toEqual(["invalid_catalogue"]);
  });

  it("is asked for by its Monday", async () => {
    await expect(readWeeklyReview(app, "2026-10-27")).rejects.toThrow(/Monday/);
    await expect(readWeeklyReview(app, "not a date")).rejects.toThrow(/Monday/);
  });
});

describe("personal data and access", () => {
  const PHONE = "4165550123";
  const BODY = "SECRET BODY: call 416-555-0123 about Building 12";

  it("holds no phone number, recipient id or message body in the view's columns, its rows or the CSV", async () => {
    const when = await at(WEEK, 2, 10);
    const recipientIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const id = await delivery({ state: "undelivered", errorCode: 30003, body: BODY, updatedAt: when, completedAt: when });
      recipientIds.push(((await owner`select recipient_id from delivery where id = ${id}`)[0] as { recipient_id: string }).recipient_id);
    }
    const entry = await approvedEntry(when);
    const handed = new Date(when.getTime() + 5000);
    for (let i = 0; i < 6; i += 1) {
      const id = await delivery({ state: "delivered", entryId: entry.entryId, body: BODY, handedOffAt: handed, completedAt: new Date(handed.getTime() + 11 * 60_000) });
      recipientIds.push(((await owner`select recipient_id from delivery where id = ${id}`)[0] as { recipient_id: string }).recipient_id);
    }

    const columns = (await owner`select column_name from information_schema.columns where table_name = 'weekly_review' order by ordinal_position`).map((row) => row.column_name);
    const asSeen = JSON.stringify(await appSql`select * from weekly_review where week_start = ${WEEK}::date`);
    const csv = await weeklyReviewExport(app, WEEK);

    expect(columns).toEqual([
      "week_start", "section", "is_drill", "lang", "reason", "entry_id", "started_at", "ended_at", "duration_seconds", "first_hand_off_seconds",
      "ninety_percent_seconds", "ninety_percent_status", "delivered_share_percent", "amount_cents", "n", "n_shown",
    ]);
    for (const column of columns) expect(column).not.toMatch(/phone|number|body|recipient|subscriber|email|name|token/);
    expect(csv.split("\r\n")[0]).toBe(WEEKLY_CSV_COLUMNS.join(","));
    expect(csv.split("\r\n").length).toBeGreaterThan(3);
    for (const text of [asSeen, csv]) {
      expect(text).not.toContain(PHONE);
      expect(text).not.toContain("416-555");
      expect(text).not.toContain("SECRET BODY");
      for (const id of recipientIds) expect(text).not.toContain(id);
    }
  });

  it("is readable by the app's role and by no client role", async () => {
    const [grants] = await owner`select has_table_privilege('cvh_app', 'weekly_review', 'select') as app,
                                        has_table_privilege('anon', 'weekly_review', 'select') as anon,
                                        has_table_privilege('authenticated', 'weekly_review', 'select') as authenticated,
                                        has_table_privilege('service_role', 'weekly_review', 'select') as service,
                                        has_table_privilege('cvh_app', 'weekly_review', 'insert, update, delete') as app_writes`;
    expect(grants).toEqual({ app: true, anon: false, authenticated: false, service: false, app_writes: false });
  });

  it("has no notes table and no write endpoint: the notes are files under docs/procedures/weekly-notes", async () => {
    const relations = await owner`select table_name, table_type from information_schema.tables where table_schema = 'public' and (table_name ilike '%note%' or table_name ilike '%weekly%' or table_name ilike '%review%')`;
    expect(relations).toEqual([{ table_name: "weekly_review", table_type: "VIEW" }]);
    expect(statSync(path.join(ROOT, "docs", "procedures", "weekly-notes")).isDirectory()).toBe(true);

    const routes: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/^route\.tsx?$/.test(name) || /^actions?\.tsx?$/.test(name)) routes.push(path.relative(ROOT, full));
      }
    };
    walk(path.join(ROOT, "src", "app"));
    expect(routes.filter((route) => /weekly/i.test(route))).toEqual([]);
    expect(existsSync(path.join(ROOT, "src", "app", "api", "weekly-review"))).toBe(false);
  });
});

describe("scripts/export-weekly against the database", () => {
  it("writes the week's CSV, with the small-number rule applied and no phone number, subscriber id or message body", async () => {
    const when = await at(WEEK, 2, 10);
    await many(6, { state: "undelivered", lang: "en", errorCode: 30003, body: "SECRET 416-555-0123", updatedAt: when, completedAt: when });
    await many(2, { state: "undelivered", lang: "ur", errorCode: 30003, body: "SECRET 416-555-0123", updatedAt: when, completedAt: when });
    await opsEvent("directory.publish_failed", await at(WEEK, 3, 10), { reason: "gave_up", attempts: 3 });
    const written: Record<string, string> = {};
    const out: string[] = [];
    const error: string[] = [];

    const code = await runExportWeekly(["--week", WEEK, "--out", "review.csv"], {
      env: { DATABASE_URL: "postgres://unused" },
      now: () => new Date(),
      out: (line) => out.push(line),
      error: (line) => error.push(line),
      write: (file, content) => void (written[file] = content),
      connect: () => ({ db: app, close: async () => {} }),
    });

    expect(code).toBe(0);
    expect(error).toEqual([]);
    const csv = written["review.csv"];
    expect(csv).toBe(await weeklyReviewExport(app, WEEK));
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(WEEKLY_CSV_COLUMNS.join(","));
    // The total (8) shows; the one hidden cell (ur 2) has the smallest visible cell (en 6) hidden with it.
    expect(lines).toContain(`${WEEK},delivery_problem,false,en,undelivered:30003,,,,,,,,,,fewer than 5`);
    expect(lines).toContain(`${WEEK},delivery_problem,false,ur,undelivered:30003,,,,,,,,,,fewer than 5`);
    expect(lines).toContain(`${WEEK},delivery_problem,false,,undelivered:30003,,,,,,,,,,8`);
    expect(lines.some((line) => line.startsWith(`${WEEK},publish_failure,false,,gave_up,`))).toBe(true);
    expect(csv).not.toContain("SECRET");
    expect(csv).not.toContain("416-555");
    expect(out.join("\n")).toContain(`docs/procedures/weekly-notes/${WEEK}.md`);
  });
});
