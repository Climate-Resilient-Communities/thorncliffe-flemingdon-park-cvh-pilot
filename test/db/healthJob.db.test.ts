// The health job against a real database (S06.07, and from S09.01 every AD-23 condition, the heartbeat and the banner for every condition): each of the five conditions (a text queued and due for more than 5 minutes outside a pause, a
// delivery that became `unknown` or a hand-off the sweep could not settle, no sender lease renewal for 3 minutes while texts are due, Smart
// Encoding found on, signature failures past 5 in 10 minutes), the text to every on-call number at most once per condition per 30 minutes, the
// `ops_event` of each alert and recovery without personal data, the claim order of the on-call texts, the Hub's banner when the sender itself
// fails, two runs at once, and one condition failing without stopping the others. Nothing here sends a text: the sender runs with a fake provider.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal } from "../../src/modules/audit";
import { createContactResolver, createDeliveryQueue, createSenderHealth } from "../../src/modules/messaging";
import { lastPublishedAt } from "../../src/modules/directory";
import {
  HEALTH_CONDITIONS,
  activeHealthConditions,
  createHealthJob,
  createOncallRoster,
  oncallNumberSource,
  oncallText,
  readHeartbeat,
  type HealthCondition,
  type HealthJob,
  type OncallRoster,
} from "../../src/modules/ops";
import { loadHealthBanner } from "../../src/app/staff/healthBannerModel";
import { DEFAULT_SMS_TRANSACTIONAL_DAILY_CEILING } from "../../src/platform/config/env";
import { createDb, type Db } from "../../src/platform/db";
import { dispatcherWorld, fakeProvider, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let roster: OncallRoster;
let admin: string;
let auditBaseline = 0;
const errors: { evt: string; fields: Record<string, string> }[] = [];

const NUMBERS = ["416-555-0123", "647-555-0199"];
const DIGITS = NUMBERS.map((number) => number.replace(/\D/g, ""));

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 6, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  roster = createOncallRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
});

async function resetAll() {
  await owner`delete from oncall_roster`;
  await owner`update health_condition set active = false, since = null, last_alerted_at = null, last_event_id = null, checked_at = null`;
  await owner`delete from ops_event`;
  await owner`update health_heartbeat set completed_at = null`;
  await owner`delete from cron.job_run_details`;
  await owner`delete from net._http_response`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await world.reset();
  errors.length = 0;
}

afterAll(async () => {
  await resetAll();
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetAll();
  admin = (await world.fx.staff("admin")).id;
  // A sender that is running, unless a test says otherwise: the on-call texts the job queues are due texts too.
  await owner`update dispatcher_lease set renewed_at = now() where id = 1`;
});

const PRICE = 1.5;

/** A ceiling far above what any test seeds, unless a test says otherwise. */
const CEILING = 1000;

function job(
  over: { enqueue?: Parameters<typeof createHealthJob>[0]["enqueue"]; ceiling?: number; lastPublishedAt?: Parameters<typeof createHealthJob>[0]["lastPublishedAt"] } = {},
): HealthJob {
  const queue = createDeliveryQueue();
  return createHealthJob({
    db: app,
    sender: createSenderHealth(),
    enqueue: over.enqueue ?? ((tx, input) => queue.enqueueTransactional(tx, input)),
    pricePerSegmentCents: () => PRICE,
    transactionalDailyCeiling: () => over.ceiling ?? CEILING,
    lastPublishedAt: over.lastPublishedAt ?? ((executor) => lastPublishedAt(executor)),
    logError: (evt, fields) => void errors.push({ evt, fields }),
  });
}

async function addOncall(count = 2): Promise<string[]> {
  const ids: string[] = [];
  for (const number of NUMBERS.slice(0, count)) {
    const added = await roster.add({ actorStaffId: admin, label: "On call", number });
    if (added.kind !== "added") throw new Error("not added");
    ids.push(added.id);
  }
  return ids;
}

/** Changes a delivery row as the owner with the row guard off (the guard binds the app; a test needs to make a row old). */
async function age(id: string, set: string) {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table delivery disable trigger delivery_guard");
    await tx.unsafe(`update delivery set ${set} where id = '${id}'`);
    await tx.unsafe("alter table delivery enable trigger delivery_guard");
  });
}

/** A queued resident text that has been due for `minutes` minutes. */
async function queuedFor(minutes: number): Promise<string> {
  const [id] = await world.seedTransactional(1);
  await age(id, `due_at = now() - interval '${minutes} minutes'`);
  return id;
}

/** The sender renewed its lease just now (or `minutes` ago). */
const renewLease = (minutes = 0) => owner.unsafe(`update dispatcher_lease set renewed_at = now() - interval '${minutes} minutes' where id = 1`);

/** The health_condition row of a condition, and the ops_event rows of the health job, oldest first. */
const stateOf = async (condition: HealthCondition) => (await owner`select active, since is not null as has_since, last_alerted_at is not null as alerted from health_condition where condition = ${condition}`)[0];
const healthEvents = () => owner`select kind, severity, subject_type, subject_id, detail from ops_event where kind like 'health.%' order by id`;
const oncallTexts = () => owner`select id, kind, purpose, recipient_kind, recipient_id, claim_rank, lang, body, segments, cost_estimate_cents, idempotency_key, state, created_by_module,
                                   send_by > now() + interval '29 minutes' and send_by <= now() + interval '31 minutes' as send_by_ok
                              from delivery where purpose = 'oncall_alert' order by created_at, id`;
const backdateAlert = (condition: HealthCondition, minutes: number) =>
  owner.unsafe(`update health_condition set last_alerted_at = now() - interval '${minutes} minutes' where condition = '${condition}'`);
/**
 * Moves the last alert back, but never past midnight in Toronto: for a condition that alerts once a Toronto day, a test run just after
 * midnight would otherwise put the alert on the day before, when alerting again is right.
 */
const backdateAlertWithinToday = (condition: HealthCondition, minutes: number) =>
  owner.unsafe(`update health_condition
                   set last_alerted_at = greatest(now() - interval '${minutes} minutes', (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto'))
                 where condition = '${condition}'`);
const reportOf = async (condition: HealthCondition, run: HealthJob = job()) => (await run.run()).conditions.find((row) => row.condition === condition);

/** What must hold of everything the job stored: no on-call number anywhere. */
async function expectNoNumberStored() {
  const everything = JSON.stringify({
    deliveries: await owner`select * from delivery`,
    events: await owner`select * from ops_event`,
    audit: await owner`select * from audit_event where id > ${auditBaseline}`,
    health: await owner`select * from health_condition`,
    lease: await owner`select * from dispatcher_lease`,
  });
  for (const digits of DIGITS) expect(everything).not.toContain(digits);
  expect(everything).not.toContain("+1416");
  expect(everything).not.toContain("+1647");
}

describe("when everything is fine", () => {
  it("judges every condition, texts nobody, records nothing but the heartbeat", async () => {
    await addOncall();
    await renewLease();
    const report = await job().run();

    expect(report.conditions.map((row) => [row.condition, row.status, row.holds, row.action])).toEqual(HEALTH_CONDITIONS.map((condition) => [condition, "ok", false, "quiet"]));
    expect(report.conditions).toHaveLength(11);
    expect(report.heartbeat).toBe(true);
    expect(await oncallTexts()).toEqual([]);
    expect(await healthEvents()).toEqual([]);
    expect(await owner`select count(*)::int as n from health_condition where active`).toEqual([{ n: 0 }]);
  });
});

describe("a text queued and due for more than 5 minutes outside a pause", () => {
  it("texts every on-call number once, records the alert without personal data, and is then quiet", async () => {
    const ids = await addOncall(2);
    await renewLease();
    await queuedFor(6);

    const first = await reportOf("queue_stuck");

    expect(first).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    const texts = await oncallTexts();
    expect(texts).toHaveLength(2);
    expect(texts.map((row) => row.recipient_id).sort()).toEqual([...ids].sort());
    for (const text of texts) {
      expect(text).toMatchObject({
        kind: "transactional",
        purpose: "oncall_alert",
        recipient_kind: "oncall",
        created_by_module: "ops",
        claim_rank: 1,
        lang: "en",
        body: oncallText("queue_stuck", 1),
        segments: 1,
        cost_estimate_cents: 2,
        state: "queued",
        send_by_ok: true,
      });
      expect(text.idempotency_key).toMatch(/^transactional:queue_stuck:oncall_alert:[0-9a-f-]{36}\.[0-9]{13}$/);
    }
    expect(await healthEvents()).toEqual([
      { kind: "health.condition_alerted", severity: "error", subject_type: null, subject_id: null, detail: { condition: "queue_stuck", count: 1, notified: 2, first: true } },
    ]);
    expect(await stateOf("queue_stuck")).toEqual({ active: true, has_since: true, alerted: true });
    await expectNoNumberStored();

    // The next run, a minute later: the condition still holds, and nothing more is sent.
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: true, action: "held" });
    expect(await oncallTexts()).toHaveLength(2);
    expect(await healthEvents()).toHaveLength(1);
  });

  it("does not count a text due for less than 5 minutes", async () => {
    await addOncall();
    await renewLease();
    await queuedFor(4);
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: false, action: "quiet" });
    expect(await oncallTexts()).toEqual([]);
  });

  it("does not count a text that is not due yet (its backoff is ahead)", async () => {
    await addOncall();
    const [id] = await world.seedTransactional(1);
    await age(id, "due_at = now() + interval '10 minutes'");
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: false });
  });

  it("does not count the texts a pause holds, but does count an on-call text that waits during a pause", async () => {
    await addOncall();
    await renewLease();
    await queuedFor(30);
    await world.setPause(true);
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: false, action: "quiet" });

    const [oncallText1] = await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    await age(oncallText1, "due_at = now() - interval '6 minutes'");
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: true, action: "alerted" });
  });

  it("reminds every 30 minutes while it holds, never sooner", async () => {
    await addOncall(1);
    await renewLease();
    await queuedFor(6);
    expect(await reportOf("queue_stuck")).toMatchObject({ action: "alerted" });

    await backdateAlert("queue_stuck", 29);
    expect(await reportOf("queue_stuck")).toMatchObject({ action: "held" });
    expect(await oncallTexts()).toHaveLength(1);

    await backdateAlert("queue_stuck", 31);
    expect(await reportOf("queue_stuck")).toMatchObject({ action: "alerted", texts: 1 });
    expect(await oncallTexts()).toHaveLength(2);
    expect((await healthEvents()).map((row) => (row.detail as { first: boolean }).first)).toEqual([true, false]);
    // The stuck on-call texts are themselves stuck texts if nobody sends them: still one text per number per half hour.
  });

  it("records the recovery once when the queue clears, sends nothing for it, and stays quiet after", async () => {
    await addOncall();
    await renewLease();
    const stuck = await queuedFor(6);
    await reportOf("queue_stuck");

    await age(stuck, "state = 'skipped', completed_at = now()");
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: false, action: "recovered" });
    expect(await oncallTexts()).toHaveLength(2);
    expect((await healthEvents()).map((row) => [row.kind, row.severity, row.detail])).toEqual([
      ["health.condition_alerted", "error", { condition: "queue_stuck", count: 1, notified: 2, first: true }],
      ["health.condition_recovered", "info", { condition: "queue_stuck" }],
    ]);
    expect(await stateOf("queue_stuck")).toEqual({ active: false, has_since: false, alerted: true });

    expect(await reportOf("queue_stuck")).toMatchObject({ holds: false, action: "quiet" });
    expect(await healthEvents()).toHaveLength(2);
    expect(await oncallTexts()).toHaveLength(2);
  });

  it("does not text again for a condition that came back within 30 minutes of the last text, and does after", async () => {
    await addOncall(1);
    await renewLease();
    const stuck = await queuedFor(6);
    await reportOf("queue_stuck");
    await age(stuck, "state = 'skipped', completed_at = now()");
    await reportOf("queue_stuck");

    await queuedFor(7);
    expect(await reportOf("queue_stuck")).toMatchObject({ holds: true, action: "held" });
    expect(await oncallTexts()).toHaveLength(1);
    expect(await stateOf("queue_stuck")).toMatchObject({ active: true });
    // The second episode is in ops_event though nobody was texted for it.
    expect((await healthEvents()).map((row) => [row.kind, row.detail])).toEqual([
      ["health.condition_alerted", { condition: "queue_stuck", count: 1, notified: 1, first: true }],
      ["health.condition_recovered", { condition: "queue_stuck" }],
      ["health.condition_alerted", { condition: "queue_stuck", count: 1, notified: 0, first: true, rate_limited: true }],
    ]);

    await backdateAlert("queue_stuck", 31);
    expect(await reportOf("queue_stuck")).toMatchObject({ action: "alerted", texts: 1 });
    expect(await oncallTexts()).toHaveLength(2);
  });
});

describe("a delivery that became unknown", () => {
  /** A text the sender handed over whose answer was lost: `unknown`, with the sender's own `delivery.unknown` event. */
  async function becomeUnknown(): Promise<string> {
    const [id] = await world.seedTransactional(1);
    world.useProvider(fakeProvider(world.clock, { kind: "no_answer", reason: "timeout" }));
    await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    return id;
  }

  it("texts the on-call Admins about it once, however long it stays unknown", async () => {
    await addOncall(2);
    await renewLease();
    await becomeUnknown();

    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await healthEvents())[0]).toMatchObject({ kind: "health.condition_alerted", detail: { condition: "delivery_unknown", count: 1, notified: 2, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("delivery_unknown", 1), oncallText("delivery_unknown", 1)]);

    await backdateAlert("delivery_unknown", 120);
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: true, action: "held" });
    expect(await oncallTexts()).toHaveLength(2);
    await expectNoNumberStored();
  });

  it("texts about a second unknown delivery, once the interval has passed, and counts both", async () => {
    await addOncall(1);
    await renewLease();
    await becomeUnknown();
    await reportOf("delivery_unknown");

    // The on-call text the job queued is itself handed to the (failing) fake provider by the next run and goes unknown too: take it away, so the count is of the two.
    await owner`delete from delivery where purpose = 'oncall_alert'`;
    await becomeUnknown();
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: true, action: "held" });
    await backdateAlert("delivery_unknown", 31);
    expect(await reportOf("delivery_unknown")).toMatchObject({ action: "alerted", texts: 1 });
    expect((await healthEvents()).at(-1)).toMatchObject({ detail: { condition: "delivery_unknown", count: 2, first: false } });
  });

  it("clears when every unknown delivery has been answered, records the recovery and sends no more", async () => {
    await addOncall(1);
    await renewLease();
    const id = await becomeUnknown();
    await reportOf("delivery_unknown");

    await age(id, "state = 'delivered', provider_message_id = 'SM" + "9".repeat(32) + "', completed_at = now()");
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: false, action: "recovered" });
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: false, action: "quiet" });
    expect((await healthEvents()).map((row) => row.kind)).toEqual(["health.condition_alerted", "health.condition_recovered"]);
    expect(await oncallTexts()).toHaveLength(1);
  });

  it("leaves an unknown delivery older than 24 hours to the weekly review", async () => {
    await addOncall(1);
    await renewLease();
    const id = await becomeUnknown();
    await age(id, "updated_at = now() - interval '25 hours'");
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: false, action: "quiet" });
  });

  it("raises a text still handed off with no outcome after 10 minutes (the sweep could not settle it), but not after 9", async () => {
    await addOncall(1);
    await renewLease();
    const [id] = await world.seedTransactional(1);
    await appSql.begin(async (tx) => {
      await tx`update delivery set state = 'claimed', claimed_by = 'w', claim_token = gen_random_uuid() where id = ${id}`;
      await tx`update delivery set handed_off_at = now() where id = ${id}`;
    });
    await age(id, "handed_off_at = now() - interval '9 minutes'");
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: false });

    await age(id, "handed_off_at = now() - interval '11 minutes'");
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect(await oncallTexts()).toHaveLength(1);
    // It does not text again for the same stuck hand-off, whatever the interval.
    await backdateAlert("delivery_unknown", 90);
    expect(await reportOf("delivery_unknown")).toMatchObject({ holds: true, action: "held" });
  });
});

describe("no sender lease renewal for 3 minutes while texts are due", () => {
  it("holds when texts are due and the lease was last renewed more than 3 minutes ago, and texts the on-call Admins", async () => {
    await addOncall(2);
    await world.seedTransactional(1);
    await renewLease(4);
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await healthEvents())[0]).toMatchObject({ detail: { condition: "sender_stalled", count: 1, notified: 2, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("sender_stalled", 1), oncallText("sender_stalled", 1)]);
  });

  it("does not hold for a lease renewed 2 minutes ago, or when nothing is due", async () => {
    await addOncall(1);
    await world.seedTransactional(1);
    await renewLease(2);
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: false });

    await owner`delete from delivery`;
    await renewLease(30);
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: false });
  });

  it("does not count texts that are not due yet, or that the pause holds", async () => {
    await addOncall(1);
    await renewLease(30);
    const [later] = await world.seedTransactional(1);
    await age(later, "due_at = now() + interval '5 minutes'");
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: false });

    await world.seedTransactional(1);
    await world.setPause(true);
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: false });
  });

  it("clears when a sender renews the lease again (a real run of the dispatcher), and records the recovery", async () => {
    await addOncall(1);
    await world.seedTransactional(1);
    await renewLease(10);
    await reportOf("sender_stalled");

    await world.dispatcher().run();
    expect(await reportOf("sender_stalled")).toMatchObject({ holds: false, action: "recovered" });
    expect((await healthEvents()).map((row) => row.kind)).toEqual(["health.condition_alerted", "health.condition_recovered"]);
  });
});

describe("Smart Encoding found on", () => {
  const found = (kind: "on" | "off") => owner.unsafe(`insert into ops_event (kind, severity, detail) values ('messaging.smart_encoding_${kind}', '${kind === "on" ? "error" : "info"}', '{}')`);

  it("texts the on-call Admins once, then holds until a later daily check finds it off, then records the recovery", async () => {
    await addOncall(2);
    await found("on");
    expect(await reportOf("smart_encoding_on")).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("smart_encoding_on", 1), oncallText("smart_encoding_on", 1)]);

    await backdateAlert("smart_encoding_on", 300);
    expect(await reportOf("smart_encoding_on")).toMatchObject({ holds: true, action: "held" });

    await found("off");
    expect(await reportOf("smart_encoding_on")).toMatchObject({ holds: false, action: "recovered" });
    expect(await reportOf("smart_encoding_on")).toMatchObject({ action: "quiet" });
    expect(await oncallTexts()).toHaveLength(2);
  });

  it("texts again when a later daily check finds it on again, after the interval", async () => {
    await addOncall(1);
    await found("on");
    await reportOf("smart_encoding_on");
    await found("off");
    await reportOf("smart_encoding_on");
    await found("on");
    expect(await reportOf("smart_encoding_on")).toMatchObject({ holds: true, action: "held" });
    await backdateAlert("smart_encoding_on", 31);
    expect(await reportOf("smart_encoding_on")).toMatchObject({ action: "alerted", texts: 1 });
  });

  it("is quiet when the check has only ever found it off", async () => {
    await addOncall(1);
    await found("off");
    expect(await reportOf("smart_encoding_on")).toMatchObject({ holds: false, action: "quiet" });
  });
});

describe("webhook signature failures past 5 in 10 minutes", () => {
  const failures = (count: number, minutesAgo = 1) =>
    owner.unsafe(
      `insert into ops_event (kind, severity, at, detail) select 'webhook.signature_invalid', 'warning', now() - interval '${minutesAgo} minutes', '{"route":"twilio_status","reason":"signature_mismatch"}'::jsonb from generate_series(1, ${count})`,
    );

  it("does not hold at 5, holds at 6, and counts only the last 10 minutes", async () => {
    await addOncall(1);
    await failures(5);
    expect(await reportOf("signature_failures")).toMatchObject({ holds: false });

    await failures(1);
    expect(await reportOf("signature_failures")).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect((await healthEvents())[0]).toMatchObject({ detail: { condition: "signature_failures", count: 6, notified: 1, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("signature_failures", 6)]);
  });

  it("does not count failures older than 10 minutes, and recovers when they age out", async () => {
    await addOncall(1);
    await failures(20, 11);
    expect(await reportOf("signature_failures")).toMatchObject({ holds: false });

    await failures(6, 2);
    await reportOf("signature_failures");
    await owner`update ops_event set at = now() - interval '11 minutes' where kind = 'webhook.signature_invalid'`;
    expect(await reportOf("signature_failures")).toMatchObject({ holds: false, action: "recovered" });
  });
});

describe("with nobody on call", () => {
  it("still records the condition (no text can be queued), and the Hub's banner shows a sender that is failing", async () => {
    await renewLease(10);
    await world.seedTransactional(1);
    await queuedFor(6);

    const report = await job().run();

    expect(report.conditions.find((row) => row.condition === "queue_stuck")).toMatchObject({ holds: true, action: "alerted", texts: 0 });
    expect(report.conditions.find((row) => row.condition === "sender_stalled")).toMatchObject({ holds: true, action: "alerted", texts: 0 });
    expect(await oncallTexts()).toEqual([]);
    expect((await healthEvents()).map((row) => [(row.detail as { condition: string }).condition, (row.detail as { notified: number }).notified])).toEqual([["queue_stuck", 0], ["sender_stalled", 0]]);
    const banner = await loadHealthBanner({ facts: async () => ({ active: await activeHealthConditions(app), heartbeat: await readHeartbeat(app) }), everything: false, logError: () => {} });
    expect(banner?.heading).toBe("Sending is failing");
    expect(banner?.lines).toHaveLength(4);
  });
});

describe("the Hub's banner when the sender itself fails", () => {
  // The banner leads with these two (healthBannerModel's isSender); the others mean the sender is still sending.
  const activeSenderConditions = async (executor: Db) =>
    (await activeHealthConditions(executor)).filter((row) => row.condition === "queue_stuck" || row.condition === "sender_stalled");

  it("shows while the stuck-queue or no-sender condition holds, and goes when the job records the recovery", async () => {
    await addOncall(1);
    await renewLease();
    const stuck = await queuedFor(6);
    expect(await activeSenderConditions(app)).toEqual([]);

    await reportOf("queue_stuck");
    expect((await activeSenderConditions(app)).map((row) => row.condition)).toEqual(["queue_stuck"]);

    await age(stuck, "state = 'skipped', completed_at = now()");
    await reportOf("queue_stuck");
    expect(await activeSenderConditions(app)).toEqual([]);
  });

  it("is not raised by the other conditions (an unknown text, Smart Encoding, signature failures): the sender is sending", async () => {
    await addOncall(1);
    await owner.unsafe("insert into ops_event (kind, severity, detail) values ('messaging.smart_encoding_on', 'error', '{}')");
    await reportOf("smart_encoding_on");
    expect(await stateOf("smart_encoding_on")).toMatchObject({ active: true });
    expect(await activeSenderConditions(app)).toEqual([]);
  });
});

describe("the on-call texts and the claim order", () => {
  const useOncallNumbers = () => world.useResolver({ resolver: createContactResolver({ sources: { oncall: oncallNumberSource }, log: world.log }), asked: [], gone: new Set() });

  it("are claimed after a fire alert and before every other transactional text and alert", async () => {
    await addOncall(1);
    await renewLease();
    await world.seedAlert({ types: ["power"], scope: "neighbourhood", recipients: 1 });
    await world.seedTransactional(1);
    await world.seedAlert({ types: ["power"], scope: "buildings" });
    await world.seedAlert({ types: ["fire"], scope: "neighbourhood" });
    await queuedFor(6);

    await reportOf("queue_stuck");

    const queued = await owner`select purpose, claim_rank from delivery where state = 'queued' order by claim_rank, created_at, id`;
    const order = queued.map((row) => (row.purpose === "oncall_alert" ? "oncall" : String(row.claim_rank)));
    expect(order[0]).toBe("0");
    expect(order[1]).toBe("oncall");
    expect(order.slice(2).every((rank) => rank !== "0" && rank !== "oncall")).toBe(true);
    expect(queued.find((row) => row.purpose === "oncall_alert")?.claim_rank).toBe(1);
  });

  it("are the only texts sent while texts are paused, to the number on the roster", async () => {
    const [id] = await addOncall(1);
    await renewLease();
    const fire = (await world.seedAlert({ types: ["fire"], scope: "buildings" })).ids[0];
    await queuedFor(6);
    await reportOf("queue_stuck");
    await world.setPause(true);
    useOncallNumbers();

    await world.dispatcher().run();

    expect(world.provider.calls.map((call) => [call.to, call.body])).toEqual([["+14165550123", oncallText("queue_stuck", 1)]]);
    const [text] = await oncallTexts();
    expect(text).toMatchObject({ recipient_id: id, state: "submitted" });
    expect(await world.stateOf(fire)).toBe("queued");
    await expectNoNumberStored();
  });
});

describe("two runs at once, and a condition that fails", () => {
  it("text each number once when two runs overlap (the condition's row is locked)", async () => {
    await addOncall(2);
    await renewLease();
    await queuedFor(6);

    await Promise.all([job().run(), job().run(), job().run()]);

    expect(await oncallTexts()).toHaveLength(2);
    expect((await healthEvents()).filter((row) => row.kind === "health.condition_alerted")).toHaveLength(1);
  });

  it("leaves a condition as it was when its texts cannot be queued, judges the others, and tries again at the next run", async () => {
    await addOncall(1);
    await renewLease(10);
    await owner.unsafe("insert into ops_event (kind, severity, detail) values ('messaging.smart_encoding_on', 'error', '{}')");
    await world.seedTransactional(1);
    let calls = 0;
    const queue = createDeliveryQueue();
    const flaky = job({
      enqueue: (tx, input) => {
        calls += 1;
        // The first condition to text (the stalled sender; the stuck queue holds nothing yet) fails; the next one succeeds.
        if (calls === 1) throw new TypeError("connection to 10.0.0.1 lost while queueing +14165550123");
        return queue.enqueueTransactional(tx, input);
      },
    });

    const report = await flaky.run();

    expect(report.conditions.map((row) => [row.condition, row.status])).toEqual(HEALTH_CONDITIONS.map((condition) => [condition, condition === "sender_stalled" ? "failed" : "ok"]));
    // A run that could not judge every condition records no heartbeat: from outside it is a health job that is failing.
    expect(report.heartbeat).toBe(false);
    expect(await readHeartbeat(app)).toEqual({ completedAt: null, fresh: false });
    expect(errors).toEqual([{ evt: "health.condition_failed", fields: { condition: "sender_stalled", error: "TypeError" } }]);
    expect(JSON.stringify(errors)).not.toContain("555");
    expect(await stateOf("sender_stalled")).toEqual({ active: false, has_since: false, alerted: false });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("smart_encoding_on", 1)]);

    expect(await reportOf("sender_stalled", flaky)).toMatchObject({ status: "ok", action: "alerted", texts: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------
// S09.01: the conditions E09 adds, each triggered here; the heartbeat; and the banner on every Admin and Coordinator screen.

/** An `ops_event` of a kind, `minutesAgo` minutes ago (codes only, as the writers record them). */
const event = (kind: string, detail: Record<string, unknown>, minutesAgo = 0) =>
  owner`insert into ops_event (kind, severity, at, detail) values (${kind}, 'warning', now() - ${minutesAgo} * interval '1 minute', ${owner.json(detail as never)}) returning id`;

describe("a scheduled job that failed (pg_cron, or a job's call that did not answer 2xx)", () => {
  let runid = 900_000;
  const cronRun = (status: "failed" | "succeeded", minutesAgo = 1) =>
    owner`insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
          values (1, ${(runid += 1)}, 1, 'postgres', 'postgres', 'select 1', ${status}, '', now() - ${minutesAgo} * interval '1 minute', now() - ${minutesAgo} * interval '1 minute')`;
  const httpAnswer = (id: number, status: number | null, minutesAgo = 1, extra: { timedOut?: boolean; error?: string } = {}) =>
    owner`insert into net._http_response (id, status_code, timed_out, error_msg, created) values (${id}, ${status}, ${extra.timedOut ?? false}, ${extra.error ?? null}, now() - ${minutesAgo} * interval '1 minute')`;

  it("texts every on-call number when a pg_cron run failed in the last 10 minutes, and recovers 10 minutes after the last failure", async () => {
    await addOncall(2);
    await cronRun("succeeded");
    expect(await reportOf("job_failed")).toMatchObject({ holds: false, action: "quiet" });

    await cronRun("failed", 2);
    expect(await reportOf("job_failed")).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await healthEvents()).at(-1)).toMatchObject({ kind: "health.condition_alerted", subject_id: null, detail: { condition: "job_failed", count: 1, notified: 2, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("job_failed", 1), oncallText("job_failed", 1)]);
    expect(await reportOf("job_failed")).toMatchObject({ holds: true, action: "held" });

    await owner`update cron.job_run_details set start_time = now() - interval '11 minutes', end_time = now() - interval '11 minutes'`;
    expect(await reportOf("job_failed")).toMatchObject({ holds: false, action: "recovered" });
    expect((await healthEvents()).at(-1)).toMatchObject({ kind: "health.condition_recovered", detail: { condition: "job_failed" } });
    await expectNoNumberStored();
  });

  it("counts a job's call that answered an error, timed out or could not connect, but not one that answered 2xx", async () => {
    await addOncall(1);
    await httpAnswer(1, 200);
    await httpAnswer(2, 204);
    expect(await reportOf("job_failed")).toMatchObject({ holds: false });

    await httpAnswer(3, 500);
    await httpAnswer(4, 401);
    await httpAnswer(5, null, 1, { timedOut: true });
    await httpAnswer(6, null, 1, { error: "Couldn't connect to server" });
    await httpAnswer(7, 503, 30);
    expect(await reportOf("job_failed")).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect((await healthEvents()).at(-1)).toMatchObject({ detail: { condition: "job_failed", count: 4 } });
  });

  it("gives the app a count only: the app's role cannot read pg_cron's run history (its commands name the Vault secrets)", async () => {
    await expect(appSql`select count(*) from cron.job_run_details`).rejects.toThrow(/permission denied/);
    await expect(appSql`select count(*) from cron.job`).rejects.toThrow(/permission denied/);
    await cronRun("failed");
    expect(await appSql`select health_job_failures(600000) as n`).toEqual([{ n: 1 }]);
    // The window is bounded (at most 24 hours), and a negative or missing one counts nothing.
    await cronRun("failed", 60 * 30);
    expect(await appSql`select health_job_failures(${10 * 24 * 3_600_000}::bigint) as n`).toEqual([{ n: 1 }]);
    expect(await appSql`select health_job_failures(-5) as n`).toEqual([{ n: 0 }]);
  });
});

describe("a whole language that fell back to English in an alert", () => {
  const fallback = (minutesAgo = 0) => event("alert.translation_fallback", { languages: 2 }, minutesAgo);

  it("texts the on-call Admins about each new one once, after the interval, and recovers 24 hours after the last", async () => {
    await addOncall(1);
    await fallback();
    expect(await reportOf("translation_fallback")).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("translation_fallback", 1)]);

    // The same one is never texted again.
    await backdateAlert("translation_fallback", 120);
    expect(await reportOf("translation_fallback")).toMatchObject({ holds: true, action: "held" });

    // A new one is, once the interval has passed since the last text.
    await fallback();
    await backdateAlert("translation_fallback", 10);
    expect(await reportOf("translation_fallback")).toMatchObject({ action: "held" });
    await backdateAlert("translation_fallback", 31);
    expect(await reportOf("translation_fallback")).toMatchObject({ action: "alerted", texts: 1 });
    expect((await healthEvents()).at(-1)).toMatchObject({ detail: { condition: "translation_fallback", count: 2, first: false } });

    await owner`update ops_event set at = now() - interval '25 hours' where kind = 'alert.translation_fallback'`;
    expect(await reportOf("translation_fallback")).toMatchObject({ holds: false, action: "recovered" });
  });

  it("leaves one older than 24 hours to the weekly review", async () => {
    await addOncall(1);
    await fallback(25 * 60);
    expect(await reportOf("translation_fallback")).toMatchObject({ holds: false, action: "quiet" });
  });
});

describe("a directory publish that failed", () => {
  const failed = (minutesAgo = 0) => event("directory.publish_failed", { reason: "storage_unavailable", attempts: 3 }, minutesAgo);

  it("texts the on-call Admins, holds while no publish has succeeded since, and recovers when one does", async () => {
    await addOncall(2);
    let published: Date | null = null;
    const run = job({ lastPublishedAt: async () => published });
    await failed();
    expect(await reportOf("publish_failed", run)).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("publish_failed", 1), oncallText("publish_failed", 1)]);
    await backdateAlert("publish_failed", 90);
    expect(await reportOf("publish_failed", run)).toMatchObject({ holds: true, action: "held" });

    // A publish that succeeded after the failure clears it.
    published = new Date(Date.now() + 1000);
    expect(await reportOf("publish_failed", run)).toMatchObject({ holds: false, action: "recovered" });
    expect(await oncallTexts()).toHaveLength(2);
  });

  it("does not hold for a failure before the last publish that succeeded", async () => {
    await addOncall(1);
    await failed(60);
    expect(await reportOf("publish_failed", job({ lastPublishedAt: async () => new Date(Date.now() - 30 * 60_000) }))).toMatchObject({ holds: false });
    expect(await reportOf("publish_failed", job({ lastPublishedAt: async () => null }))).toMatchObject({ holds: true });
  });

  it("reads directory's last successful publish from the database (none here, or the newest complete release)", async () => {
    const [newest] = await owner`select max(published_at) as at from directory_release where status = 'complete'`;
    expect(await lastPublishedAt(app)).toEqual(newest.at === null ? null : new Date(newest.at));
  });
});

describe("the daily ceiling on non-alert texts", () => {
  it("texts the on-call Admins once that day when more are created since midnight in Toronto than the ceiling, while texts keep sending", async () => {
    await addOncall(2);
    await world.seedTransactional(3);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 3 }))).toMatchObject({ holds: false });

    await world.seedTransactional(1);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 3 }))).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await healthEvents()).at(-1)).toMatchObject({ detail: { condition: "transactional_ceiling", count: 4, notified: 2, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("transactional_ceiling", 4), oncallText("transactional_ceiling", 4)]);
    // Texts keep sending: the job queues and holds nothing.
    expect(await owner`select count(*)::int as n from delivery where purpose <> 'oncall_alert' and state = 'queued'`).toEqual([{ n: 4 }]);

    // Not again that day, however long it holds; the on-call texts themselves are not counted.
    await backdateAlertWithinToday("transactional_ceiling", 120);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 3 }))).toMatchObject({ holds: true, action: "held" });
    expect(await oncallTexts()).toHaveLength(2);
  });

  it("clears when the day ends in Toronto, and texts again on a later day it is crossed", async () => {
    await addOncall(1);
    const ids = await world.seedTransactional(3);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 2 }))).toMatchObject({ action: "alerted" });

    const yesterday = `created_at = (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 minute'`;
    for (const id of ids) await age(id, yesterday);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 2 }))).toMatchObject({ holds: false, action: "recovered" });

    // The next day (the last text was before midnight in Toronto), crossed again.
    await owner.unsafe(`update health_condition set last_alerted_at = (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 minute' where condition = 'transactional_ceiling'`);
    await world.seedTransactional(3);
    expect(await reportOf("transactional_ceiling", job({ ceiling: 2 }))).toMatchObject({ holds: true, action: "alerted", texts: 1 });
  });
});

describe("the daily ceiling at its default (S07.09 confirms 300)", () => {
  it("does not alert at 300 non-alert texts since midnight in Toronto, and alerts once at 301, as an ops_event and a text to on-call, while texts keep sending", async () => {
    expect(DEFAULT_SMS_TRANSACTIONAL_DAILY_CEILING).toBe(300);
    await addOncall(1);
    await world.seedTransactional(300);
    const atCeiling = job({ ceiling: DEFAULT_SMS_TRANSACTIONAL_DAILY_CEILING });
    expect(await reportOf("transactional_ceiling", atCeiling)).toMatchObject({ holds: false, action: "quiet" });
    expect(await oncallTexts()).toHaveLength(0);

    await world.seedTransactional(1);
    expect(await reportOf("transactional_ceiling", atCeiling)).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect((await healthEvents()).at(-1)).toMatchObject({ kind: "health.condition_alerted", detail: { condition: "transactional_ceiling", count: 301, notified: 1, first: true } });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("transactional_ceiling", 301)]);
    expect(await owner`select count(*)::int as n from delivery where purpose <> 'oncall_alert' and state = 'queued'`).toEqual([{ n: 301 }]);

    // More texts the same day: not alerted again.
    await world.seedTransactional(5);
    await backdateAlertWithinToday("transactional_ceiling", 120);
    expect(await reportOf("transactional_ceiling", atCeiling)).toMatchObject({ holds: true, action: "held" });
    expect(await oncallTexts()).toHaveLength(1);
  });
});

describe("the Messaging Service's geo permissions and SMS pumping protection found wrong (S07.09)", () => {
  const found = (kind: "wrong" | "ok") =>
    owner.unsafe(
      `insert into ops_event (kind, severity, detail) values ('messaging.service_settings_${kind}', '${kind === "wrong" ? "error" : "info"}', '${kind === "wrong" ? '{"geo_not_canada_only": true, "pumping_protection_off": false}' : "{}"}')`,
    );

  it("texts the on-call Admins once, then holds until a later daily check finds both right, then records the recovery", async () => {
    await addOncall(2);
    await found("wrong");
    expect(await reportOf("messaging_settings")).toMatchObject({ holds: true, action: "alerted", texts: 2 });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("messaging_settings", 1), oncallText("messaging_settings", 1)]);
    expect((await healthEvents()).at(-1)).toMatchObject({ detail: { condition: "messaging_settings", count: 1, notified: 2, first: true } });

    await backdateAlert("messaging_settings", 300);
    expect(await reportOf("messaging_settings")).toMatchObject({ holds: true, action: "held" });

    await found("ok");
    expect(await reportOf("messaging_settings")).toMatchObject({ holds: false, action: "recovered" });
    expect(await reportOf("messaging_settings")).toMatchObject({ action: "quiet" });
    expect(await oncallTexts()).toHaveLength(2);
  });

  it("is quiet when the check has only ever found both right, and the Hub's banner names it for an Admin while it holds", async () => {
    await found("ok");
    expect(await reportOf("messaging_settings")).toMatchObject({ holds: false, action: "quiet" });
    await found("wrong");
    await reportOf("messaging_settings");
    expect((await activeHealthConditions(app)).map((row) => row.condition)).toEqual(["messaging_settings"]);
  });
});

describe("a spending cap overrun this month", () => {
  const overrun = (at = "now()") => owner.unsafe(`insert into ops_event (kind, severity, at, detail) values ('spend.cap_overrun', 'warning', ${at}, '{"over_cents": 1250}') returning id`);

  it("texts the on-call Admins about each new overrun once, and holds until the month ends in Toronto", async () => {
    await addOncall(1);
    await overrun();
    expect(await reportOf("cap_overrun")).toMatchObject({ holds: true, action: "alerted", texts: 1 });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("cap_overrun", 1)]);
    await backdateAlert("cap_overrun", 600);
    expect(await reportOf("cap_overrun")).toMatchObject({ holds: true, action: "held" });

    await owner.unsafe(`update ops_event set at = (date_trunc('month', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 minute' where kind = 'spend.cap_overrun'`);
    expect(await reportOf("cap_overrun")).toMatchObject({ holds: false, action: "recovered" });
  });

  it("is quiet for an overrun of an earlier month", async () => {
    await addOncall(1);
    await overrun(`(date_trunc('month', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 hour'`);
    expect(await reportOf("cap_overrun")).toMatchObject({ holds: false, action: "quiet" });
  });
});

describe("the heartbeat the outside check reads", () => {
  it("is never fresh before the first run, fresh after a run that judged every condition, and not fresh 3 minutes later", async () => {
    expect(await readHeartbeat(app)).toEqual({ completedAt: null, fresh: false });
    expect((await job().run()).heartbeat).toBe(true);
    const beat = await readHeartbeat(app);
    expect(beat.fresh).toBe(true);
    expect(beat.completedAt).toBeInstanceOf(Date);

    await owner`update health_heartbeat set completed_at = now() - interval '2 minutes 50 seconds'`;
    expect((await readHeartbeat(app)).fresh).toBe(true);
    await owner`update health_heartbeat set completed_at = now() - interval '3 minutes 1 second'`;
    expect((await readHeartbeat(app)).fresh).toBe(false);
  });

  it("is one row the app can read and stamp, and cannot add to or delete", async () => {
    await expect(appSql`insert into health_heartbeat (id) values (2)`).rejects.toThrow(/permission denied/);
    await expect(appSql`delete from health_heartbeat`).rejects.toThrow(/permission denied/);
    await expect(appSql`update health_heartbeat set id = 3`).rejects.toThrow(/permission denied/);
    await expect(appSql`insert into health_condition (condition) values ('job_failed')`).rejects.toThrow(/permission denied/);
    expect(await owner`select id from health_heartbeat`).toEqual([{ id: 1 }]);
    expect((await owner`select condition from health_condition order by condition`).map((row) => row.condition)).toEqual([...HEALTH_CONDITIONS].sort());
  });
});

describe("the banner on every Admin and Coordinator screen", () => {
  it("names every condition the health job found open, in plain words and in order, and only the sender's to everyone else", async () => {
    await addOncall(1);
    await renewLease(10);
    await queuedFor(6);
    await event("alert.translation_fallback", { languages: 1 });
    await event("spend.cap_overrun", {});
    await job().run();

    expect((await activeHealthConditions(app)).map((row) => row.condition)).toEqual(["queue_stuck", "sender_stalled", "translation_fallback", "cap_overrun"]);
    const facts = async () => ({ active: await activeHealthConditions(app), heartbeat: await readHeartbeat(app) });
    const everything = await loadHealthBanner({ facts, everything: true, logError: () => {} });
    expect(everything?.heading).toBe("Sending is failing");
    expect(everything?.lines).toHaveLength(6);
    expect(everything?.lines[2]).toContain("with a whole language in English");
    expect(everything?.lines[3]).toContain("spending cap");
    expect((await loadHealthBanner({ facts, everything: false, logError: () => {} }))?.lines).toHaveLength(4);
  });
});
