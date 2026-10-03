// An Admin can pause all sending at once (S06.06), against a real database with the app's own credentials (cvh_app_login): the pause and
// resume use cases and what they write (who, when, why, the texts already handed to the provider, the audit record in the same
// transaction), the table's grant, and what the sender does under them with a fake provider and a fake clock: nothing the pause applies to
// is claimed, a claimed text goes back at the hand-off point, texts to on-call numbers continue, texts approved or created during the
// pause queue normally, and after a resume the dispatcher continues in claim order and checks each text again at its hand-off. Nothing
// here reaches Twilio or any real provider; every phone number is obviously fake.
import { randomBytes, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import * as audit from "../../src/modules/audit";
import { createDeliveryQueue, createMessagingPause, drizzleDispatchStore, drizzlePauseStore, type DispatchStore, type MessagingPause, type PauseStore } from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { dispatcherWorld, deferred, fakeResolver, sidOf, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let pause: MessagingPause;
let auditBaseline = 0;

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
  pause = createMessagingPause({ db: app });
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  // Open the pool's connections now, so concurrent statements really overlap.
  await Promise.all(Array.from({ length: 6 }, () => app.$client`select pg_sleep(0.1)`));
});

/** The audit trail is append-only: this test's records (and so the accounts they name) are removed as the owner, with the guard off. */
async function clearAudit() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
}

async function resetAll() {
  await owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null where id = 1`;
  await clearAudit();
  await world.reset();
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
});

const admin = async () => (await world.fx.staff("admin")).id;
const control = async () => (await owner`select paused, paused_by, paused_at, reason, handed_off_at_pause from messaging_control where id = 1`)[0];
const audits = () =>
  owner<{ action: string; actor_staff_id: string | null; subject_type: string; subject_id: string | null; outcome: string; meta: Record<string, unknown> }[]>`
    select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action like 'sending.%' order by id`;

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
  }
  throw new Error("expected the database to refuse the statement");
}

/** Moves rows to the provider, as the sender does, by legal transitions as the app's role: claimed, handed off, then `to` (or left open as `claimed`). */
async function handOff(ids: string[], to: "open" | "submitted" | "delivered" = "submitted") {
  for (const [index, id] of ids.entries()) {
    await appSql.begin(async (tx) => {
      await tx`update delivery set state = 'claimed', claimed_by = 'worker-1', claim_token = ${randomUUID()} where id = ${id}`;
      await tx`update delivery set handed_off_at = now() where id = ${id}`;
      if (to === "open") return;
      await tx`update delivery set state = 'submitted', provider_message_id = ${sidOf(index + 1)} where id = ${id}`;
      if (to === "delivered") await tx`update delivery set state = 'delivered' where id = ${id}`;
    });
  }
}

/** Claims rows without handing them off, as a run that stopped before the hand-off point would leave them. */
async function claimOnly(ids: string[]) {
  for (const id of ids) await appSql`update delivery set state = 'claimed', claimed_by = 'worker-1', claim_token = ${randomUUID()} where id = ${id}`;
}

/**
 * A pause store whose first `countWaiting` stops, after the use case has locked the row and before it writes anything, until the test lets it
 * go: a second use case then really overlaps the first (it has to wait for the row lock), instead of merely running after it.
 */
function holdingStore() {
  const entered = deferred();
  const release = deferred();
  let held = false;
  const store: PauseStore = {
    ...drizzlePauseStore,
    async countWaiting(tx) {
      const counted = await drizzlePauseStore.countWaiting(tx);
      if (!held) {
        held = true;
        entered.resolve();
        await release.promise;
      }
      return counted;
    },
  };
  return { store, entered: entered.promise, release: release.resolve };
}

/** Whether a promise has settled yet (so a test can show that a call is still waiting). */
function settled(promise: Promise<unknown>) {
  const state = { done: false };
  const finish = () => {
    state.done = true;
  };
  promise.then(finish, finish);
  return state;
}

// --- the table, with the app's credentials -------------------------------------------------------------------

describe("the pause switch with the app's credentials", () => {
  it("can be changed by the app in its six pause columns, and nothing else: not its id, and not added to or taken away", async () => {
    const who = await admin();
    await appSql`update messaging_control set paused = true, paused_by = ${who}, paused_at = now(), reason = 'test', handed_off_at_pause = 2, updated_at = now() where id = 1`;
    expect(await control()).toMatchObject({ paused: true, paused_by: who, reason: "test", handed_off_at_pause: 2 });
    await appSql`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null, handed_off_at_pause = null, updated_at = now() where id = 1`;
    expect(await control()).toMatchObject({ paused: false, paused_by: null, handed_off_at_pause: null });

    for (const statement of ["update messaging_control set id = 2", "insert into messaging_control (id) values (1)", "delete from messaging_control", "truncate messaging_control"]) {
      expect(await refusal(() => appSql.unsafe(statement)), statement).toMatch(/permission denied/);
    }
  });

  it("refuses, whoever asks, a pause that does not say who, when and why, a blank or over-long reason, and a negative count", async () => {
    expect(await refusal(() => appSql`update messaging_control set paused = true where id = 1`)).toMatch(/messaging_control_pause_stated/);
    expect(await refusal(() => appSql`update messaging_control set reason = '   ' where id = 1`)).toMatch(/messaging_control_reason_length/);
    expect(await refusal(() => appSql`update messaging_control set reason = ${"a".repeat(501)} where id = 1`)).toMatch(/messaging_control_reason_length/);
    expect(await refusal(() => appSql`update messaging_control set handed_off_at_pause = -1 where id = 1`)).toMatch(/messaging_control_handed_off_valid/);
    expect(await control()).toMatchObject({ paused: false, reason: null, handed_off_at_pause: null });
  });

  it("is the switch the sender reads: the use case's pause is what makes the sender stop claiming", async () => {
    await world.seedTransactional(1);
    expect(await pause.pause({ actorStaffId: await admin(), reason: "Stop" })).toMatchObject({ kind: "paused" });
    expect(await app.transaction((tx) => drizzleDispatchStore.isPaused(tx))).toBe(true);
    await pause.resume({ actorStaffId: await admin() });
    expect(await app.transaction((tx) => drizzleDispatchStore.isPaused(tx))).toBe(false);
  });
});

// --- pausing -----------------------------------------------------------------------------------------------

describe("pausing all texts", () => {
  it("records who, when (the database's clock) and why on the switch, and audits it, without the reason, in the same transaction", async () => {
    const who = await admin();
    const [{ before }] = await owner`select now() as before`;

    const outcome = await pause.pause({ actorStaffId: who, reason: "  Wrong alert sent to Thorncliffe Park\n(building 12 only)  " });

    expect(outcome).toMatchObject({ kind: "paused", waiting: 0, handedOff: 0 });
    const row = await control();
    expect(row).toMatchObject({ paused: true, paused_by: who, reason: "Wrong alert sent to Thorncliffe Park (building 12 only)", handed_off_at_pause: 0 });
    // The database's clock stamped it: at or after the instant just before, and within seconds of now.
    expect((row.paused_at as Date).getTime()).toBeGreaterThanOrEqual((before as Date).getTime());
    expect(Date.now() - (row.paused_at as Date).getTime()).toBeLessThan(10_000);
    expect(await audits()).toEqual([{ action: "sending.paused", actor_staff_id: who, subject_type: "messaging_control", subject_id: "1", outcome: "ok", meta: { waiting: 0, handed_off: 0 } }]);
    // Free text never goes into the audit trail.
    expect(JSON.stringify(await audits())).not.toContain("Thorncliffe");
    expect(await pause.status()).toEqual({ paused: true, pausedBy: who, pausedAt: row.paused_at, reason: "Wrong alert sent to Thorncliffe Park (building 12 only)", handedOffAtPause: 0 });
  });

  it("is not made when its audit record cannot be written: the switch is as it was, nothing is audited, and the caller gets the error", async () => {
    const failing = createMessagingPause({
      db: app,
      audit: {
        record: async (tx, event) => {
          await audit.record(tx, event);
          throw new Error("the audit insert failed");
        },
        recordRefusal: audit.recordRefusal,
      },
    });

    await expect(failing.pause({ actorStaffId: await admin(), reason: "Stop" })).rejects.toThrow("the audit insert failed");

    expect(await control()).toMatchObject({ paused: false, paused_by: null, reason: null, handed_off_at_pause: null });
    expect(await audits()).toEqual([]);
  });

  it("is refused without a reason, with nothing changed and a validation refusal audited", async () => {
    const who = await admin();

    expect(await pause.pause({ actorStaffId: who, reason: "   " })).toEqual({ kind: "refused", problem: "missing" });
    expect(await pause.pause({ actorStaffId: who, reason: "a".repeat(501) })).toEqual({ kind: "refused", problem: "too_long" });

    expect(await control()).toMatchObject({ paused: false });
    expect((await audits()).map((record) => [record.action, record.outcome, record.meta])).toEqual([
      ["sending.paused", "refused", { reason: "validation" }],
      ["sending.paused", "refused", { reason: "validation" }],
    ]);
  });

  it("leaves a pause somebody else set as it is: who paused and why stay, and the second press is an audited conflict", async () => {
    const first = await admin();
    const second = await admin();
    await pause.pause({ actorStaffId: first, reason: "Provider outage" });

    const outcome = await pause.pause({ actorStaffId: second, reason: "My own reason" });

    expect(outcome).toMatchObject({ kind: "already_paused", status: { pausedBy: first, reason: "Provider outage" } });
    expect(await control()).toMatchObject({ paused_by: first, reason: "Provider outage" });
    expect((await audits()).map((record) => [record.action, record.actor_staff_id, record.outcome, record.meta])).toEqual([
      ["sending.paused", first, "ok", { waiting: 0, handed_off: 0 }],
      ["sending.paused", second, "refused", { reason: "conflict" }],
    ]);
  });

  it("is made once when two Admins press at the same moment: one pause, one audit record of it", async () => {
    const [a, b] = [await admin(), await admin()];

    const outcomes = await Promise.all([pause.pause({ actorStaffId: a, reason: "From A" }), pause.pause({ actorStaffId: b, reason: "From B" })]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(["already_paused", "paused"]);
    const winner = outcomes.find((outcome) => outcome.kind === "paused");
    if (winner?.kind !== "paused") throw new Error("no pause was made");
    expect(await control()).toMatchObject({ paused_by: winner.status.pausedBy, reason: winner.status.reason });
    const records = await audits();
    expect(records.filter((record) => record.outcome === "ok")).toHaveLength(1);
    expect(records.filter((record) => record.outcome === "refused")).toHaveLength(1);
  });

  it("makes one pause when the first press is still in its transaction: the second waits for the row lock, then finds the pause made", async () => {
    const [a, b] = [await admin(), await admin()];
    const hold = holdingStore();
    // The first press has the row locked and is held before it writes anything, so the second really overlaps it.
    const first = createMessagingPause({ db: app, store: hold.store }).pause({ actorStaffId: a, reason: "From A" });
    await hold.entered;

    const second = pause.pause({ actorStaffId: b, reason: "From B" });
    const secondState = settled(second);
    await world.untilSomeoneWaitsForALock();
    expect(secondState.done).toBe(false);
    hold.release();

    expect(await first).toMatchObject({ kind: "paused", status: { pausedBy: a, reason: "From A" } });
    expect(await second).toMatchObject({ kind: "already_paused", status: { pausedBy: a, reason: "From A" } });
    expect(await control()).toMatchObject({ paused: true, paused_by: a, reason: "From A" });
    expect((await audits()).map((record) => [record.action, record.actor_staff_id, record.outcome, record.meta])).toEqual([
      ["sending.paused", a, "ok", { waiting: 0, handed_off: 0 }],
      ["sending.paused", b, "refused", { reason: "conflict" }],
    ]);
  });

  it("makes a resume that arrives while a pause is still in its transaction wait for it, and then resume what it made", async () => {
    const [a, b] = [await admin(), await admin()];
    const hold = holdingStore();
    const first = createMessagingPause({ db: app, store: hold.store }).pause({ actorStaffId: a, reason: "Stop" });
    await hold.entered;

    const second = pause.resume({ actorStaffId: b });
    const secondState = settled(second);
    await world.untilSomeoneWaitsForALock();
    expect(secondState.done).toBe(false);
    hold.release();

    expect(await first).toMatchObject({ kind: "paused" });
    // Not "not_paused": the resume saw the pause the first press made, because it waited for the lock.
    expect(await second).toEqual({ kind: "resumed", waiting: 0 });
    expect(await control()).toMatchObject({ paused: false, paused_by: null, reason: null, handed_off_at_pause: null });
    expect((await audits()).map((record) => [record.action, record.actor_staff_id, record.outcome])).toEqual([
      ["sending.paused", a, "ok"],
      ["sending.resumed", b, "ok"],
    ]);
  });

  it("makes a pause that arrives while a resume is still in its transaction wait for it, and then pause again", async () => {
    const [a, b] = [await admin(), await admin()];
    await pause.pause({ actorStaffId: a, reason: "First" });
    const hold = holdingStore();
    const first = createMessagingPause({ db: app, store: hold.store }).resume({ actorStaffId: a });
    await hold.entered;

    const second = pause.pause({ actorStaffId: b, reason: "Second" });
    const secondState = settled(second);
    await world.untilSomeoneWaitsForALock();
    expect(secondState.done).toBe(false);
    hold.release();

    expect(await first).toEqual({ kind: "resumed", waiting: 0 });
    // Not "already_paused": the pause saw the resume, because it waited for the lock.
    expect(await second).toMatchObject({ kind: "paused", status: { pausedBy: b, reason: "Second" } });
    expect(await control()).toMatchObject({ paused: true, paused_by: b, reason: "Second" });
    expect((await audits()).map((record) => [record.action, record.actor_staff_id, record.outcome])).toEqual([
      ["sending.paused", a, "ok"],
      ["sending.resumed", a, "ok"],
      ["sending.paused", b, "ok"],
    ]);
  });

  it("counts the texts it holds and, among the alerts it is part-way through stopping, those already handed to the provider", async () => {
    // Alert A: 2 delivered or submitted, 1 delivered, 1 in an open hand-off, 1 waiting: part-way through, so its 4 handed-off texts count.
    const a = await world.seedAlert({ recipients: 5 });
    await handOff(a.ids.slice(0, 2));
    await handOff([a.ids[2]], "delivered");
    await handOff([a.ids[3]], "open");
    // Alert B: all handed off and delivered, nothing waiting: not part of what the pause holds, so none of its texts count.
    const b = await world.seedAlert({ recipients: 2 });
    await handOff(b.ids, "delivered");
    // Alert C: one claimed and not handed off (held), one submitted: its 1 handed-off text counts.
    const c = await world.seedAlert({ recipients: 2 });
    await claimOnly([c.ids[0]]);
    await handOff([c.ids[1]]);
    // Resident texts that are not alerts: one waiting (held, but no sending to be part-way through), one gone.
    const [waitingText, sentText] = await world.seedTransactional(2);
    await handOff([sentText]);
    // On-call texts are never held by the pause: neither the waiting one nor the sent one counts.
    const [oncallWaiting, oncallSent] = await world.seedTransactional(2, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    await handOff([oncallSent]);

    const outcome = await pause.pause({ actorStaffId: await admin(), reason: "Stop" });

    // Held: A's last, C's claimed one, and the waiting resident text.
    expect(outcome).toMatchObject({ kind: "paused", waiting: 3, handedOff: 5 });
    expect(await control()).toMatchObject({ handed_off_at_pause: 5 });
    expect((await audits())[0].meta).toEqual({ waiting: 3, handed_off: 5 });
    expect([waitingText, oncallWaiting]).toHaveLength(2);

    // It is a statement about the moment the pause committed: the same texts becoming delivered later does not change it.
    await owner`update delivery set state = 'delivered' where id = any(${a.ids.slice(0, 2)}) and state = 'submitted'`;
    expect(await control()).toMatchObject({ handed_off_at_pause: 5 });
    expect(await pause.status()).toMatchObject({ handedOffAtPause: 5 });
  });

  it("counts none as handed off when nothing was handed over, and holds what is waiting", async () => {
    await world.seedAlert({ recipients: 3 });
    await world.seedTransactional(2);

    expect(await pause.pause({ actorStaffId: await admin(), reason: "Stop" })).toMatchObject({ kind: "paused", waiting: 5, handedOff: 0 });
  });
});

// --- the sender under the pause ---------------------------------------------------------------------------------

describe("while texts are paused", () => {
  it("nothing the pause applies to is claimed, and the texts to on-call numbers still go out", async () => {
    const alert = await world.seedAlert({ types: ["fire"], recipients: 3 });
    const resident = await world.seedTransactional(2);
    const [oncall] = await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    await pause.pause({ actorStaffId: await admin(), reason: "Wrong alert" });

    const report = await world.dispatcher().run();

    // Only the on-call text was claimed and handed to the (fake) provider.
    expect(report).toMatchObject({ claimed: 1, handedOff: 1, submitted: 1 });
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.stateOf(oncall)).toBe("submitted");
    expect(Object.values(await world.statesOf([...alert.ids, ...resident]))).toEqual(Array(5).fill("queued"));
    // Another run, and another, change nothing: the rows wait.
    expect((await world.dispatcher().run()).claimed).toBe(0);
    expect(world.provider.calls).toHaveLength(1);
  });

  it("returns a claimed text that is not yet handed off to the queue at the hand-off point, with nothing counted, and calls no provider", async () => {
    const ids = await world.seedTransactional(3);
    const who = await admin();
    const store: DispatchStore = {
      ...drizzleDispatchStore,
      async claim(db, input) {
        const result = await drizzleDispatchStore.claim(db, input);
        // The Admin's pause commits after the rows are claimed and before the first hand-off.
        if (result.kind === "claimed" && result.rows.length > 0) await pause.pause({ actorStaffId: who, reason: "Provider problem" });
        return result;
      },
    };

    const report = await world.dispatcher({ store }).run();

    expect(world.provider.calls).toHaveLength(0);
    expect(report).toMatchObject({ handedOff: 0, submitted: 0, stopped: 1 });
    for (const id of ids) {
      const row = await world.rowOf(id);
      expect([row.state, row.attempts, row.claimed_by, row.claim_token, row.handed_off_at], id).toEqual(["queued", 0, null, null, null]);
    }
  });

  /** Starts a run whose first hand-off transaction stays open, does `during` while it is open, then lets it finish and the run end. */
  async function duringOpenHandOff<T>(during: () => Promise<T>): Promise<T> {
    const inside = deferred();
    const proceed = deferred();
    let asks = 0;
    const resolver = fakeResolver({
      onResolve: async () => {
        asks += 1;
        if (asks === 1) {
          inside.resolve();
          await proceed.promise;
        }
      },
    });
    const run = world.dispatcher({ resolver: resolver.resolver }).run();
    await inside.promise;
    const result = await during();
    proceed.resolve();
    await run;
    return result;
  }

  it("lets the one text of an open hand-off go when the pause commits (the disclosed allowance), in flight, and puts the rest back", async () => {
    const ids = await world.seedTransactional(3);

    // The pause commits while the first hand-off transaction is open: it writes no delivery row and takes no lock on one, so it does not wait for it.
    const outcome = await duringOpenHandOff(async () => pause.pause({ actorStaffId: await admin(), reason: "Stop" }));

    // The open hand-off was not "already handed off" when the pause committed, so it is not in the count; it is in flight afterwards.
    expect(outcome).toMatchObject({ kind: "paused", handedOff: 0 });
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.stateOf(ids[0])).toBe("submitted");
    expect(await world.statesOf([ids[1], ids[2]])).toEqual({ [ids[1]]: "queued", [ids[2]]: "queued" });
  });

  it("leaves the text of an open hand-off out of the count even when its alert still has texts waiting, and counts it at the next pause", async () => {
    // An alert is the case the count is about: transactional texts are never counted, so only an alert can show that the open hand-off is left out.
    const alert = await world.seedAlert({ recipients: 3 });
    const who = await admin();

    const outcome = await duringOpenHandOff(() => pause.pause({ actorStaffId: who, reason: "Stop" }));

    // At the moment the pause committed the alert had 3 texts waiting and none handed off: its open hand-off (the first text) was not in the count.
    expect(outcome).toMatchObject({ kind: "paused", waiting: 3, handedOff: 0 });
    expect(await control()).toMatchObject({ handed_off_at_pause: 0 });
    // The allowance: that one text went out, and the other two are back in the queue, so the alert is part-way through being stopped.
    expect(world.provider.calls).toHaveLength(1);
    // The three texts share a priority and their ids were made in the same millisecond, so which one is claimed first is not fixed.
    expect(Object.values(await world.statesOf(alert.ids)).sort()).toEqual(["queued", "queued", "submitted"]);

    // Once the hand-off has committed it is a text already handed to the provider: a later pause of the same alert counts it.
    await pause.resume({ actorStaffId: who });
    expect(await pause.pause({ actorStaffId: who, reason: "Stop again" })).toMatchObject({ kind: "paused", waiting: 2, handedOff: 1 });
  });

  it("queues what is approved or created during the pause as usual: the rows are queued, due and in claim order, and nothing is sent", async () => {
    await pause.pause({ actorStaffId: await admin(), reason: "Stop" });
    const queue = createDeliveryQueue();

    // An approval, through the outbox's own seam (S04.07 calls it): the marker, then the entry's texts.
    const entry = await world.fx.entry("pending_approval", { types: ["fire"], scope: "buildings" });
    const recipient = randomUUID();
    const alertRows = await app.transaction(async (tx) => {
      await queue.markApprovalTransaction(tx, entry.entryId);
      const created = await queue.enqueueAlertDeliveries(tx, entry.entryId, [{ recipient: { kind: "subscriber", id: recipient }, lang: "en", body: entry.bodies.en.body, segments: entry.bodies.en.segments, costEstimateCents: 4 }]);
      await tx.execute(drizzleSql`select set_config('cvh.actor_id', ${entry.approverId}, true)`);
      await tx.execute(drizzleSql`update alert_entry set status = 'approved', approved_by = ${entry.approverId}, approved_version = version, approved_hash = content_hash where id = ${entry.entryId}`);
      return created;
    });
    // A transactional text, through the outbox's own seam.
    const text = await app.transaction((tx) =>
      queue.enqueueTransactional(tx, {
        module: "subscriptions",
        purpose: "menu_reply",
        recipient: { kind: "subscriber", id: randomUUID() },
        subject: randomUUID(),
        nonce: "n1",
        lang: "en",
        body: "Reply 1 to change your building.",
        segments: 1,
        costEstimateCents: 2,
      }),
    );

    if (!alertRows.ok || !text.ok) throw new Error("refused");
    const ids = [alertRows.value[0].delivery.id, text.value.delivery.id];
    expect(await world.statesOf(ids)).toEqual({ [ids[0]]: "queued", [ids[1]]: "queued" });
    expect(Object.fromEntries((await owner`select id, claim_rank from delivery where id = any(${ids})`).map((row) => [row.id as string, row.claim_rank as number]))).toEqual({ [ids[0]]: 0, [ids[1]]: 2 });
    // Nothing goes out while paused, and the approver is shown the notice (src/app/staff/pauseNotice.ts, tested there).
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(0);
    expect(await world.statesOf(ids)).toEqual({ [ids[0]]: "queued", [ids[1]]: "queued" });
  });
});

// --- resuming ----------------------------------------------------------------------------------------------------

describe("resuming texts", () => {
  it("ends the pause (who, when, why and the count are cleared) and audits it in the same transaction, with the texts it lets go", async () => {
    const who = await admin();
    const other = await admin();
    await world.seedTransactional(2);
    await pause.pause({ actorStaffId: who, reason: "Stop" });

    expect(await pause.resume({ actorStaffId: other })).toEqual({ kind: "resumed", waiting: 2 });

    expect(await control()).toMatchObject({ paused: false, paused_by: null, paused_at: null, reason: null, handed_off_at_pause: null });
    expect(await pause.status()).toEqual({ paused: false });
    expect((await audits()).map((record) => [record.action, record.actor_staff_id, record.outcome, record.meta])).toEqual([
      ["sending.paused", who, "ok", { waiting: 2, handed_off: 0 }],
      ["sending.resumed", other, "ok", { waiting: 2 }],
    ]);
  });

  it("is not made when its audit record cannot be written: texts stay paused", async () => {
    await pause.pause({ actorStaffId: await admin(), reason: "Stop" });
    const failing = createMessagingPause({
      db: app,
      audit: {
        record: async (tx, event) => {
          await audit.record(tx, event);
          throw new Error("the audit insert failed");
        },
        recordRefusal: audit.recordRefusal,
      },
    });

    await expect(failing.resume({ actorStaffId: await admin() })).rejects.toThrow("the audit insert failed");

    expect(await control()).toMatchObject({ paused: true });
    expect((await audits()).map((record) => record.action)).toEqual(["sending.paused"]);
  });

  it("changes nothing when texts are not paused, and audits a conflict", async () => {
    const who = await admin();

    expect(await pause.resume({ actorStaffId: who })).toEqual({ kind: "not_paused" });

    expect((await audits()).map((record) => [record.action, record.outcome, record.meta])).toEqual([["sending.resumed", "refused", { reason: "conflict" }]]);
  });

  it("lets the dispatcher continue in claim order: fire alerts, then other texts, then building-level and neighbourhood-level alerts, oldest first", async () => {
    await pause.pause({ actorStaffId: await admin(), reason: "Stop" });
    // Made in this order during the pause, oldest first; claim order puts them: fire, transactional, building-level, neighbourhood-level.
    const neighbourhood = await world.seedAlert({ scope: "neighbourhood" });
    const building = await world.seedAlert({ scope: "buildings" });
    const [text] = await world.seedTransactional(1);
    const fire = await world.seedAlert({ types: ["fire"], scope: "buildings" });
    const named = new Map<string, string>([
      [fire.ids[0], "fire"],
      [text, "transactional"],
      [building.ids[0], "building"],
      [neighbourhood.ids[0], "neighbourhood"],
    ]);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(0);

    await pause.resume({ actorStaffId: await admin() });
    await world.dispatcher().run();

    const refs = new Map((await owner`select id, callback_ref from delivery`).map((row) => [row.callback_ref as string, row.id as string]));
    const order = world.provider.calls.map((call) => named.get(refs.get(new URL(call.statusCallback).searchParams.get("ref") ?? "") ?? ""));
    expect(order).toEqual(["fire", "transactional", "building", "neighbourhood"]);
    expect(Object.values(await world.statesOf([...named.keys()]))).toEqual(Array(4).fill("submitted"));
  });

  it("checks each text again at its hand-off: superseded, discarded, past its valid-until and closed-thread texts are cancelled or skipped, a closing entry's are sent", async () => {
    await pause.pause({ actorStaffId: await admin(), reason: "Stop" });
    const past = new Date(Date.now() - 60_000);
    const superseded = await world.seedAlert({ recipients: 2 });
    const discarded = await world.seedAlert({ recipients: 2 });
    const expired = await world.seedAlert({ kind: "update", validUntil: past });
    const inClosedThread = await world.seedAlert({ kind: "update" });
    // A final that closed its thread, whose valid-until is long past: still sent, because it is the closing entry.
    const closing = await world.seedAlert({ kind: "final", closes: true, validUntil: past });
    const fine = await world.seedAlert({ recipients: 2 });
    // Changes made while texts were paused: the entry was superseded (a correction), discarded, and a thread was closed.
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`update alert_entry set status = 'superseded' where id = ${superseded.entry.entryId}`;
      await tx`update alert_entry set status = 'discarded', approved_by = null, approved_at = null, approved_version = null, approved_hash = null where id = ${discarded.entry.entryId}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${inClosedThread.entry.alertId}`;
    });

    await pause.resume({ actorStaffId: await admin() });
    const report = await world.dispatcher().run();

    expect(await world.statesOf(superseded.ids)).toEqual({ [superseded.ids[0]]: "cancelled", [superseded.ids[1]]: "cancelled" });
    expect(await world.statesOf(discarded.ids)).toEqual({ [discarded.ids[0]]: "cancelled", [discarded.ids[1]]: "cancelled" });
    expect(await world.stateOf(expired.ids[0])).toBe("skipped");
    expect(await world.stateOf(inClosedThread.ids[0])).toBe("cancelled");
    expect(await world.stateOf(closing.ids[0])).toBe("submitted");
    expect(await world.statesOf(fine.ids)).toEqual({ [fine.ids[0]]: "submitted", [fine.ids[1]]: "submitted" });
    // Only the closing entry's text and the two fine ones reached the provider.
    expect(world.provider.calls).toHaveLength(3);
    expect(report).toMatchObject({ handedOff: 3, submitted: 3, stopped: 6 });
  });
});
