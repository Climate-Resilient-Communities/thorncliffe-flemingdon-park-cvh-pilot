// The health job against a real database (S06.07): each of the five conditions (a text queued and due for more than 5 minutes outside a pause, a
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
import { activeSenderConditions, createHealthJob, createOncallRoster, oncallNumberSource, oncallText, type HealthCondition, type HealthJob, type OncallRoster } from "../../src/modules/ops";
import { loadSenderBanner } from "../../src/app/staff/senderBanner";
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

function job(over: { enqueue?: Parameters<typeof createHealthJob>[0]["enqueue"] } = {}): HealthJob {
  const queue = createDeliveryQueue();
  return createHealthJob({
    db: app,
    sender: createSenderHealth(),
    enqueue: over.enqueue ?? ((tx, input) => queue.enqueueTransactional(tx, input)),
    pricePerSegmentCents: () => PRICE,
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
  it("judges all five conditions, texts nobody and records nothing", async () => {
    await addOncall();
    await renewLease();
    const report = await job().run();

    expect(report.conditions.map((row) => [row.condition, row.status, row.holds, row.action])).toEqual([
      ["queue_stuck", "ok", false, "quiet"],
      ["delivery_unknown", "ok", false, "quiet"],
      ["sender_stalled", "ok", false, "quiet"],
      ["smart_encoding_on", "ok", false, "quiet"],
      ["signature_failures", "ok", false, "quiet"],
    ]);
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
    const banner = await loadSenderBanner({ active: () => activeSenderConditions(app), logError: () => {} });
    expect(banner?.heading).toBe("Sending is failing");
    expect(banner?.lines).toHaveLength(4);
  });
});

describe("the Hub's banner when the sender itself fails", () => {
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

    expect(report.conditions.map((row) => [row.condition, row.status])).toEqual([
      ["queue_stuck", "ok"],
      ["delivery_unknown", "ok"],
      ["sender_stalled", "failed"],
      ["smart_encoding_on", "ok"],
      ["signature_failures", "ok"],
    ]);
    expect(errors).toEqual([{ evt: "health.condition_failed", fields: { condition: "sender_stalled", error: "TypeError" } }]);
    expect(JSON.stringify(errors)).not.toContain("555");
    expect(await stateOf("sender_stalled")).toEqual({ active: false, has_since: false, alerted: false });
    expect((await oncallTexts()).map((row) => row.body)).toEqual([oncallText("smart_encoding_on", 1)]);

    expect(await reportOf("sender_stalled", flaky)).toMatchObject({ status: "ok", action: "alerted", texts: 1 });
  });
});
