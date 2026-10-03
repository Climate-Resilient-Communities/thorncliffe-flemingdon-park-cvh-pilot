// The provider's status callbacks against a real database (S06.04): the signature before any work, a callback for a delivery under the
// row lock, the race with the dispatcher's own outcome write in both orders (really concurrent, on separate connections), an `unknown`
// text resolved by a late callback, repeats and out-of-order statuses, a callback about nothing, and that the database is the second line
// (the app's role cannot write what the transition table forbids, whatever the rules above say). Every callback is signed the way
// Twilio's own library signs it, for the URL the dispatcher gave the fake provider; nothing calls Twilio, and every number is fake.
import { randomBytes, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  CALLBACK_TARGETS,
  DELIVERY_STATES,
  TERMINAL_STATES,
  canTransition,
  createStatusCallbacks,
  drizzleCallbackStore,
  statusCallbackUrl,
  type CallbackRequest,
  type CallbackResult,
  type DeliveryState,
  type StatusCallbackDeps,
} from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { opsRecorder } from "../../src/app/dispatch";
import { FAKE_NUMBER, FAKE_SID } from "./deliveryFixtures";
import { BASE_URL, SERVICE_SID, dispatcherWorld, deferred, sidOf, type DispatcherWorld, type Row } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
const scratchTables: string[] = [];

const TOKEN = "fake-auth-token-for-tests";
const OTHER_SID = `SM${"f".repeat(32)}`;
const SECRET_TEXT = "Power is out in Building 12, a secret resident text";
const FAKE_FROM = "+16475550100";

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 8, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  // Open the pool's connections now, so concurrent statements really overlap.
  await Promise.all(Array.from({ length: 8 }, () => app.$client`select pg_sleep(0.1)`));
});

afterAll(async () => {
  await world.reset();
  for (const table of scratchTables) await owner.unsafe(`drop table if exists ${table}`);
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await world.reset();
});

// --- helpers -----------------------------------------------------------------------------------------------

/** The status callbacks on the real tables, the app's own role and the real ops recorder (any part can be replaced). */
function callbacks(over: Partial<StatusCallbackDeps> = {}) {
  return createStatusCallbacks({ db: app, ops: opsRecorder, log: world.log, authToken: TOKEN, publicBaseUrl: BASE_URL, store: drizzleCallbackStore, ...over });
}

/** The form Twilio posts for a status, with the personal parts a stored row or a log line must never hold. */
const form = (sid: string, status: string, extra: Record<string, string> = {}): Record<string, string> => ({
  MessageSid: sid,
  SmsSid: sid,
  AccountSid: `AC${"0".repeat(32)}`,
  MessagingServiceSid: SERVICE_SID,
  MessageStatus: status,
  SmsStatus: status,
  To: FAKE_NUMBER,
  From: FAKE_FROM,
  Body: SECRET_TEXT,
  ...extra,
});

/** A request as Twilio makes it to `url`, signed with the official library's helper. */
function signed(url: string, fields: Record<string, string>, token = TOKEN): CallbackRequest {
  return { signature: getExpectedTwilioSignature(token, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
}

const refOf = async (id: string) => (await world.rowOf(id)).callback_ref as string;

/** The signed callback for a delivery: the URL is the one the dispatcher gives Twilio (`statusCallbackUrl`). */
async function callbackFor(id: string, status: string, options: { sid?: string; extra?: Record<string, string> } = {}): Promise<CallbackRequest> {
  return signed(statusCallbackUrl(BASE_URL, await refOf(id)), form(options.sid ?? FAKE_SID, status, options.extra));
}

/** A text the provider was handed and has not answered: claimed under a lease token, its hand-off recorded (as the app's role does both). */
async function handedOff(over: Row = {}): Promise<string> {
  return seedIn("claimed", { handedOff: true, over });
}

interface Shape {
  handedOff?: boolean;
  providerId?: string | null;
  over?: Row;
}

/** A delivery in `state`, reached only by legal transitions through the app's role. */
async function seedIn(state: DeliveryState, shape: Shape = {}): Promise<string> {
  const [id] = await world.seedTransactional(1, shape.over ?? {});
  const claim = () => appSql`update delivery set state = 'claimed', claimed_by = 'old-worker', claim_token = ${randomUUID()} where id = ${id}`;
  const hand = () => appSql`update delivery set handed_off_at = now() where id = ${id}`;
  const providerId = shape.providerId ?? null;
  switch (state) {
    case "queued":
      break;
    case "claimed":
      await claim();
      if (shape.handedOff) await hand();
      break;
    case "submitted":
      await claim();
      await hand();
      await appSql`update delivery set state = 'submitted', provider_message_id = ${providerId} where id = ${id}`;
      break;
    case "unknown":
      await claim();
      await hand();
      await appSql`update delivery set state = 'unknown' where id = ${id}`;
      if (providerId) await appSql`update delivery set provider_message_id = ${providerId} where id = ${id}`;
      break;
    case "delivered":
    case "undelivered":
      await claim();
      await hand();
      await appSql`update delivery set state = ${state}, provider_message_id = ${providerId} where id = ${id}`;
      break;
    case "failed":
      await claim();
      if (providerId) {
        await hand();
        await appSql`update delivery set state = 'failed', provider_message_id = ${providerId} where id = ${id}`;
      } else {
        await appSql`update delivery set state = 'failed' where id = ${id}`;
      }
      break;
    case "cancelled":
    case "skipped":
      await appSql`update delivery set state = ${state} where id = ${id}`;
      break;
    case "skipped_env":
      await claim();
      await appSql`update delivery set state = 'skipped_env' where id = ${id}`;
      break;
  }
  return id;
}

const snapshot = async () => JSON.stringify(await owner`select * from delivery order by id`);
const eventsOf = (kind: string) => world.opsEvents(kind);
const allEvents = async () => (await owner`select kind, severity, subject_type, subject_id, detail from ops_event order by id`) as unknown as Row[];

// --- the signature, before any work -----------------------------------------------------------------------------

describe("the signature is checked first, against the full URL from PUBLIC_BASE_URL and the body", () => {
  it("accepts the signature Twilio's own helper makes for the URL the dispatcher gave the (fake) provider, with its ref", async () => {
    const [id] = await world.seedTransactional(1);
    await world.dispatcher().run();
    const call = world.provider.calls[0];
    expect(call.statusCallback).toBe(`${BASE_URL}/api/twilio/status?ref=${await refOf(id)}`);
    const request = signed(call.statusCallback, form(sidOf(1), "delivered"));
    await expect(callbacks().handle(request)).resolves.toEqual({ kind: "applied", from: "submitted", to: "delivered" });
    expect(await world.stateOf(id)).toBe("delivered");
  });

  it("refuses a request with no signature, a wrong one, one made with another token, or one made for another URL, body or reference: 403 and nothing changed", async () => {
    const id = await handedOff();
    const url = statusCallbackUrl(BASE_URL, await refOf(id));
    const fields = form(FAKE_SID, "delivered");
    const good = signed(url, fields);
    const before = await snapshot();
    const otherRef = statusCallbackUrl(BASE_URL, randomUUID());
    const tampered: [string, CallbackRequest][] = [
      ["no signature", { ...good, signature: null }],
      ["an empty signature", { ...good, signature: "" }],
      ["a wrong signature", { ...good, signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=" }],
      ["another token", signed(url, fields, "another-token")],
      ["another host", signed(`https://evil.example/api/twilio/status?ref=${await refOf(id)}`, fields)],
      ["another scheme", signed(url.replace("https", "http"), fields)],
      ["another path", signed(`${BASE_URL}/api/twilio/inbound?ref=${await refOf(id)}`, fields)],
      ["a body changed after signing", { ...good, body: good.body.replace("delivered", "failed") }],
      ["an added body field", { ...good, body: `${good.body}&Extra=1` }],
      ["an added query parameter", { ...good, search: `${good.search}&x=1` }],
      ["the ref of another delivery", { ...good, search: `?ref=${otherRef.split("ref=")[1]}` }],
    ];
    for (const [name, request] of tampered) {
      const result = await callbacks().handle(request);
      expect(result.kind, name).toBe("rejected");
    }
    expect(await snapshot()).toBe(before);
    expect(await eventsOf("webhook.signature_invalid")).toHaveLength(tampered.length);
    expect(await eventsOf("delivery.callback_ignored")).toHaveLength(0);
    // And the genuine one still works.
    await expect(callbacks().handle(good)).resolves.toMatchObject({ kind: "applied", to: "delivered" });
  });

  it("counts every refusal in ops_event with a code only, so the health job can see more than 5 in 10 minutes (S06.07)", async () => {
    const id = await handedOff();
    const url = statusCallbackUrl(BASE_URL, await refOf(id));
    for (let n = 0; n < 7; n += 1) await callbacks().handle({ ...signed(url, form(FAKE_SID, "delivered")), signature: n === 0 ? null : `wrong-${n}` });
    const [{ n }] = await owner`select count(*)::int as n from ops_event where kind = 'webhook.signature_invalid' and at > now() - interval '10 minutes'`;
    expect(n).toBe(7);
    const events = await eventsOf("webhook.signature_invalid");
    expect(events[0]).toMatchObject({ severity: "warning", subject_type: null, subject_id: null, detail: { route: "twilio_status", reason: "missing_signature" } });
    expect(events[1]).toMatchObject({ detail: { route: "twilio_status", reason: "signature_mismatch" } });
    // No address, signature, reference or body anywhere in what was kept.
    const kept = JSON.stringify(events);
    for (const secret of [FAKE_NUMBER, SECRET_TEXT, "wrong-1", await refOf(id), FAKE_SID]) expect(kept).not.toContain(secret);
  });

  it("keeps at most 50 refusals in 10 minutes, so a flood cannot grow the table, and counts again once they are older", async () => {
    await owner`insert into ops_event (kind, severity, detail) select 'webhook.signature_invalid', 'warning', '{"route":"twilio_status","reason":"signature_mismatch"}'::jsonb from generate_series(1, 50)`;
    const request: CallbackRequest = { signature: "wrong", search: "?ref=" + randomUUID(), body: "MessageSid=x" };
    for (let n = 0; n < 3; n += 1) await expect(callbacks().handle(request)).resolves.toMatchObject({ kind: "rejected" });
    expect(await eventsOf("webhook.signature_invalid")).toHaveLength(50);
    // The events of a validly signed callback are not limited: they are Twilio's own, and few.
    await callbacks().handle(signed(`${BASE_URL}/api/twilio/status`, form(FAKE_SID, "delivered")));
    expect(await eventsOf("delivery.callback_ignored")).toHaveLength(1);
    // Eleven minutes later the old ones no longer count and a refusal is kept again.
    await owner`update ops_event set at = now() - interval '11 minutes' where kind = 'webhook.signature_invalid'`;
    await callbacks().handle(request);
    expect(await eventsOf("webhook.signature_invalid")).toHaveLength(51);
  });

  it("answers a refusal even when ops_event cannot be written, and does nothing else", async () => {
    const id = await handedOff();
    const before = await snapshot();
    const failing = callbacks({
      ops: {
        record: async () => {
          throw new Error("ops_event is unavailable");
        },
      },
    });
    await expect(failing.handle({ ...(await callbackFor(id, "delivered")), signature: "wrong" })).resolves.toEqual({ kind: "rejected", reason: "signature_mismatch" });
    expect(await snapshot()).toBe(before);
    expect(world.lines.some((line) => line.evt === "callback.ops_event_failed")).toBe(true);
  });

  it("does nothing at all where no Twilio token is set, even for a request that carries a signature", async () => {
    const id = await handedOff();
    const before = await snapshot();
    await expect(callbacks({ authToken: undefined }).handle(await callbackFor(id, "delivered"))).resolves.toEqual({ kind: "not_configured" });
    expect(await snapshot()).toBe(before);
    expect(await allEvents()).toEqual([]);
  });
});

// --- a valid callback for a delivery -----------------------------------------------------------------------------

describe("a valid callback whose ref matches a delivery", () => {
  it("stores the callback's MessageSid as the provider id when the delivery has none, and applies the status by the transition table", async () => {
    const id = await handedOff();
    await expect(callbacks().handle(await callbackFor(id, "undelivered", { extra: { ErrorCode: "30003" } }))).resolves.toEqual({ kind: "applied", from: "claimed", to: "undelivered" });
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id, row.provider_error_code]).toEqual(["undelivered", FAKE_SID, 30003]);
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(await allEvents()).toEqual([]);
  });

  it("applies each status to a text that was handed off and not yet answered: a non-terminal one makes it submitted, a terminal one final", async () => {
    for (const [status, to] of [["accepted", "submitted"], ["queued", "submitted"], ["sending", "submitted"], ["sent", "submitted"], ["delivered", "delivered"], ["undelivered", "undelivered"], ["failed", "failed"]] as const) {
      const id = await handedOff();
      await callbacks().handle(await callbackFor(id, status, { sid: sidOf(Math.floor(Math.random() * 1e6)) }));
      expect(await world.stateOf(id), status).toBe(to);
    }
  });

  it("changes nothing and records the mismatch in ops_event when the delivery already has a different provider id", async () => {
    for (const state of ["submitted", "unknown", "delivered"] as const) {
      await world.reset();
      const id = await seedIn(state, { providerId: OTHER_SID });
      const before = await snapshot();
      await expect(callbacks().handle(await callbackFor(id, "delivered"))).resolves.toEqual({ kind: "mismatch" });
      expect(await snapshot(), state).toBe(before);
      expect(await eventsOf("delivery.provider_id_mismatch"), state).toEqual([
        { kind: "delivery.provider_id_mismatch", severity: "error", subject_type: "delivery", subject_id: id, detail: {} },
      ]);
      // Neither id is recorded in the event.
      expect(JSON.stringify(await allEvents())).not.toMatch(/SM[0-9a-f]{32}/);
    }
  });

  it("keeps a failure's error code only inside what the table holds, and still applies a status whose code is nonsense", async () => {
    const id = await handedOff();
    await callbacks().handle(await callbackFor(id, "failed", { extra: { ErrorCode: "9999999" } }));
    const row = await world.rowOf(id);
    expect([row.state, row.provider_error_code]).toEqual(["failed", null]);
  });

  /** What the E06 table says a signed callback may do, restated here (not taken from the code under test). */
  function expectedState(from: DeliveryState, shape: { handedOff: boolean; providerId: string | null }, target: "submitted" | "delivered" | "undelivered" | "failed"): DeliveryState {
    if (shape.providerId !== null && shape.providerId !== FAKE_SID) return from;
    if ((TERMINAL_STATES as readonly string[]).includes(from)) return from;
    if (from === "queued" || (from === "claimed" && !shape.handedOff)) return from;
    if (from === "submitted" && target === "submitted") return from;
    return target;
  }

  const COMBOS: { state: DeliveryState; handedOff?: boolean; providerId?: string }[] = [
    { state: "queued" },
    { state: "claimed", handedOff: false },
    { state: "claimed", handedOff: true },
    { state: "submitted", providerId: FAKE_SID },
    { state: "submitted", providerId: OTHER_SID },
    { state: "unknown" },
    { state: "unknown", providerId: FAKE_SID },
    { state: "unknown", providerId: OTHER_SID },
    { state: "delivered", providerId: FAKE_SID },
    { state: "delivered", providerId: OTHER_SID },
    { state: "undelivered", providerId: FAKE_SID },
    { state: "failed" },
    { state: "failed", providerId: FAKE_SID },
    { state: "cancelled" },
    { state: "skipped" },
    { state: "skipped_env" },
  ];

  it("for every state a delivery can be in and every status, ends where the transition table says, and a terminal state never changes (against the real trigger)", async () => {
    const statuses = [["queued", "submitted"], ["sending", "submitted"], ["sent", "submitted"], ["delivered", "delivered"], ["undelivered", "undelivered"], ["failed", "failed"]] as const;
    expect(new Set(COMBOS.map((combo) => combo.state))).toEqual(new Set(DELIVERY_STATES));
    let moved = 0;
    for (const combo of COMBOS) {
      for (const [status, target] of statuses) {
        const id = await seedIn(combo.state, { handedOff: combo.handedOff, providerId: combo.providerId ?? null });
        const before = await world.rowOf(id);
        const result: CallbackResult = await callbacks().handle(await callbackFor(id, status));
        const after = await world.rowOf(id);
        const label = `${combo.state}${combo.handedOff === false ? " (not handed off)" : ""}${combo.providerId ? ` (id ${combo.providerId === FAKE_SID ? "same" : "other"})` : ""} with ${status}`;
        const expected = expectedState(combo.state, { handedOff: combo.handedOff ?? true, providerId: combo.providerId ?? null }, target);
        expect(after.state, label).toBe(expected);
        if (expected === combo.state) {
          // Nothing at all changed: not the state, the id, the code, the times.
          expect(after, label).toEqual(before);
          expect(result.kind === "applied", label).toBe(false);
        } else {
          moved += 1;
          expect(canTransition(combo.state, expected), label).toBe(true);
          expect(after.provider_message_id, label).toBe(FAKE_SID);
          expect(result, label).toEqual({ kind: "applied", from: combo.state, to: expected });
        }
      }
    }
    // Out of 16 states-with-ids x 6 statuses, the table has these moves and no others: from claimed (handed off) all 6 statuses (the three
    // non-terminal ones make it submitted, the three terminal ones final), from unknown, with no id or with the same one, all 6 each, and
    // from submitted (same id) only the 3 terminal ones.
    expect(moved).toBe(6 + 2 * 6 + 3);
  });
});

// --- the race with the dispatcher's own outcome write ---------------------------------------------------------------

describe("a callback that arrives before the dispatcher has recorded Twilio's response", () => {
  const STATUSES = [
    ["delivered", "delivered"],
    ["failed", "failed"],
    ["sent", "submitted"],
  ] as const;

  it.each(STATUSES)("ends with the callback's status (%s) and the provider id, and the dispatcher's late write changes nothing (the callback completes inside the provider call)", async (status, final) => {
    const [id] = await world.seedTransactional(1);
    const service = callbacks();
    let during: CallbackResult | undefined;
    world.provider.answer(async (submission, callNumber) => {
      // The text is in flight; Twilio's status arrives before the dispatcher has the answer to its own request.
      during = await service.handle(signed(submission.statusCallback, form(sidOf(callNumber), status)));
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
    });
    const report = await world.dispatcher().run();
    expect(during).toEqual({ kind: "applied", from: "claimed", to: final });
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual([final, sidOf(1)]);
    // The dispatcher knew it had been beaten: it recorded no outcome, and logged that it did not apply.
    expect(report.submitted).toBe(0);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_not_applied" && line.fields.delivery_id === id)).toBe(true);
    expect(world.lines.some((line) => line.evt === "dispatch.provider_id_differs")).toBe(false);
    expect(world.provider.calls).toHaveLength(1);
  });

  it.each(STATUSES)("ends the same when the callback is applied after the dispatcher's write (%s): submitted first, then the callback's status", async (status, final) => {
    const [id] = await world.seedTransactional(1);
    const report = await world.dispatcher().run();
    expect(report.submitted).toBe(1);
    expect(await world.stateOf(id)).toBe("submitted");
    await callbacks().handle(await callbackFor(id, status, { sid: sidOf(1) }));
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual([final, sidOf(1)]);
  });

  it.each(STATUSES)("when both run at the same moment on separate connections, the callback holding the row first (%s): the dispatcher's write waits, then finds the row moved and changes nothing", async (status, final) => {
    const [id] = await world.seedTransactional(1);
    const insideCallback = deferred();
    const releaseCallback = deferred();
    // The spend seam is called inside the callback's transaction, after its update: a place to hold the callback with the row locked.
    const service = callbacks({
      afterOutcome: async () => {
        insideCallback.resolve();
        await releaseCallback.promise;
      },
    });
    let pending: Promise<CallbackResult> | undefined;
    world.provider.answer(async (submission, callNumber) => {
      pending = service.handle(signed(submission.statusCallback, form(sidOf(callNumber), status)));
      await insideCallback.promise;
      // The dispatcher is about to write its outcome; the callback holds the row until it is told to go on.
      void world.untilSomeoneWaitsForALock().then(() => releaseCallback.resolve());
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
    });
    const report = await world.dispatcher().run();
    expect(await pending).toEqual({ kind: "applied", from: "claimed", to: final });
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual([final, sidOf(1)]);
    expect(report.submitted).toBe(0);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_not_applied")).toBe(true);
  });

  it.each(STATUSES)("when the dispatcher holds the row first (%s): the callback waits, then applies its status to the submitted row, and the provider id is the one the dispatcher stored", async (status, final) => {
    const [id] = await world.seedTransactional(1);
    const insideOutcome = deferred();
    const releaseOutcome = deferred();
    // The spend seam of the dispatcher runs inside its outcome transaction, after the update: it holds the row.
    const dispatcher = world.dispatcher({
      afterOutcome: async () => {
        insideOutcome.resolve();
        await releaseOutcome.promise;
      },
    });
    const run = dispatcher.run();
    await insideOutcome.promise;
    expect(await world.stateOf(id)).toBe("claimed"); // the outcome is not committed yet
    const pending = callbacks().handle(await callbackFor(id, status, { sid: sidOf(1) }));
    await world.untilSomeoneWaitsForALock();
    releaseOutcome.resolve();
    const report = await run;
    expect(report.submitted).toBe(1);
    const result = await pending;
    // A non-terminal status after the dispatcher's own `submitted` adds nothing.
    expect(result).toEqual(final === "submitted" ? { kind: "ignored", reason: "no_change" } : { kind: "applied", from: "submitted", to: final });
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual([final, sidOf(1)]);
  });
});

describe("the spend seam", () => {
  it("is called once inside the transaction of the callback that moves a claimed row, and commits with it; never for any other callback", async () => {
    const table = `scratch_callback_spend_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${table} (delivery_id uuid primary key, outcome text not null)`);
    await owner.unsafe(`grant select, insert on ${table} to cvh_app`);
    scratchTables.push(table);
    const service = callbacks({
      afterOutcome: async (tx, delivery, outcome) => {
        await tx.execute(drizzleSql.raw(`insert into ${table} (delivery_id, outcome) values ('${delivery.id}', '${outcome}')`));
      },
    });
    const first = await handedOff();
    await service.handle(await callbackFor(first, "delivered"));
    await service.handle(await callbackFor(first, "delivered"));
    expect(await owner.unsafe(`select delivery_id, outcome from ${table}`)).toEqual([{ delivery_id: first, outcome: "submitted" }]);
    // An unknown row resolved, and a submitted one finished, were counted when the dispatcher wrote their outcome: not again.
    const unknown = await seedIn("unknown");
    const submitted = await seedIn("submitted", { providerId: FAKE_SID });
    await service.handle(await callbackFor(unknown, "delivered"));
    await service.handle(await callbackFor(submitted, "delivered"));
    expect(await owner.unsafe(`select count(*)::int as n from ${table}`)).toEqual([{ n: 1 }]);
  });

  it("never undoes the status when it fails: its own writes are undone, the status stays and the failure is logged by name", async () => {
    const table = `scratch_callback_spend_failing_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${table} (delivery_id uuid primary key)`);
    await owner.unsafe(`grant select, insert on ${table} to cvh_app`);
    scratchTables.push(table);
    const service = callbacks({
      afterOutcome: async (tx, delivery) => {
        await tx.execute(drizzleSql.raw(`insert into ${table} (delivery_id) values ('${delivery.id}')`));
        throw new RangeError("the estimate could not be written");
      },
    });
    const id = await handedOff();
    await expect(service.handle(await callbackFor(id, "delivered"))).resolves.toMatchObject({ kind: "applied", to: "delivered" });
    expect(await world.stateOf(id)).toBe("delivered");
    expect(await owner.unsafe(`select count(*)::int as n from ${table}`)).toEqual([{ n: 0 }]);
    expect(world.lines.find((line) => line.evt === "callback.spend_hook_failed")?.fields).toEqual({ hook: "outcome", delivery_id: id, error: "RangeError" });
  });

  it("tells S06.08 when a callback records a provider id the delivery lacked, inside the callback's transaction: for a claimed row and an unknown one with no id, never when it had the id", async () => {
    const table = `scratch_callback_ids_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${table} (delivery_id uuid primary key, message_sid text not null)`);
    await owner.unsafe(`grant select, insert on ${table} to cvh_app`);
    scratchTables.push(table);
    const service = callbacks({
      afterProviderId: async (tx, delivery) => {
        await tx.execute(drizzleSql.raw(`insert into ${table} (delivery_id, message_sid) values ('${delivery.id}', '${delivery.providerMessageId}')`));
      },
    });
    const claimed = await handedOff();
    const unknown = await seedIn("unknown");
    const known = await seedIn("unknown", { providerId: FAKE_SID });
    const submitted = await seedIn("submitted", { providerId: FAKE_SID });
    for (const id of [claimed, unknown, known, submitted]) await service.handle(await callbackFor(id, "delivered"));
    await service.handle(await callbackFor(claimed, "delivered"));
    const recorded = await owner.unsafe(`select delivery_id, message_sid from ${table} order by delivery_id`);
    expect(recorded.map((row) => [row.delivery_id, row.message_sid]).sort()).toEqual([[claimed, FAKE_SID], [unknown, FAKE_SID]].sort());
    // The hook's write is part of the callback's transaction: when the callback rolls back (its ops event cannot be written), so does the hook's.
    const resolved = await seedIn("unknown");
    const failing = callbacks({
      ops: {
        record: async () => {
          throw new Error("ops_event is unavailable");
        },
      },
      afterProviderId: async (tx, delivery) => {
        await tx.execute(drizzleSql.raw(`insert into ${table} (delivery_id, message_sid) values ('${delivery.id}', '${delivery.providerMessageId}')`));
      },
    });
    await expect(failing.handle(await callbackFor(resolved, "delivered"))).rejects.toThrow("unavailable");
    expect(await owner.unsafe(`select count(*)::int as n from ${table} where delivery_id = '${resolved}'`)).toEqual([{ n: 0 }]);
    expect(await world.stateOf(resolved)).toBe("unknown");
  });
});

// --- an ambiguous send, resolved later ----------------------------------------------------------------------------

describe("an ambiguous send that never recorded a response", () => {
  it("moves from unknown to the callback's status when a callback with its ref arrives later, and the unknown is marked resolved in ops_event", async () => {
    for (const [status, to] of [["delivered", "delivered"], ["undelivered", "undelivered"], ["failed", "failed"], ["sent", "submitted"]] as const) {
      await world.reset();
      const [id] = await world.seedTransactional(1);
      // The provider call times out after the request may have been sent: the row is unknown, with no provider id.
      world.provider.answer({ kind: "no_answer", reason: "timeout" });
      const report = await world.dispatcher().run();
      expect(report.unknown).toBe(1);
      expect(await world.stateOf(id)).toBe("unknown");
      expect((await world.rowOf(id)).provider_message_id).toBeNull();
      expect(await eventsOf("delivery.unknown")).toHaveLength(1);

      const request = signed(world.provider.calls[0].statusCallback, form(sidOf(77), status));
      await expect(callbacks().handle(request), status).resolves.toEqual({ kind: "applied", from: "unknown", to });
      const row = await world.rowOf(id);
      expect([row.state, row.provider_message_id], status).toEqual([to, sidOf(77)]);
      expect(await eventsOf("delivery.unknown_resolved"), status).toEqual([
        { kind: "delivery.unknown_resolved", severity: "info", subject_type: "delivery", subject_id: id, detail: { status: to } },
      ]);
      // The same callback again resolves nothing twice.
      await callbacks().handle(request);
      expect(await eventsOf("delivery.unknown_resolved"), status).toHaveLength(1);
    }
  });

  it("is resolved the same way when the sweep made it unknown (a handed-off row with no outcome for 5 minutes)", async () => {
    const id = await handedOff();
    world.clock.advance(6 * 60_000);
    await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    await callbacks().handle(await callbackFor(id, "delivered"));
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["delivered", FAKE_SID]);
    expect((await eventsOf("delivery.unknown_resolved")).map((event) => event.subject_id)).toEqual([id]);
  });

  it("is resolved even for a text that aged out of `submitted` after 24 hours with no final status", async () => {
    const id = await seedIn("submitted", { providerId: FAKE_SID });
    world.clock.advance(25 * 60 * 60_000);
    await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    await callbacks().handle(await callbackFor(id, "delivered"));
    expect(await world.stateOf(id)).toBe("delivered");
    expect(await eventsOf("delivery.unknown_resolved")).toHaveLength(1);
  });

  it("is resolved by a callback that arrives just after a slow response was written onto the unknown row (the provider id was filled first)", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_submission, callNumber) => {
      // The response is slow: the row was made unknown meanwhile (a later run's sweep), and the late response only fills the id.
      await appSql`update delivery set state = 'unknown' where id = ${id}`;
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
    });
    await world.dispatcher().run();
    const filled = await world.rowOf(id);
    expect([filled.state, filled.provider_message_id]).toEqual(["unknown", sidOf(1)]);
    await callbacks().handle(await callbackFor(id, "delivered", { sid: sidOf(1) }));
    expect(await world.stateOf(id)).toBe("delivered");
    expect(await eventsOf("delivery.unknown_resolved")).toHaveLength(1);
  });

  it("is not marked resolved if the event cannot be written: the whole callback rolls back and the text stays unknown", async () => {
    const id = await seedIn("unknown");
    const failing = callbacks({
      ops: {
        record: async (executor, event) => {
          if (event.kind === "delivery.unknown_resolved") throw new Error("ops_event is unavailable");
          return opsRecorder.record(executor, event);
        },
      },
    });
    await expect(failing.handle(await callbackFor(id, "delivered"))).rejects.toThrow("unavailable");
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["unknown", null]);
    // Twilio's retry, or the next callback, then resolves it.
    await callbacks().handle(await callbackFor(id, "delivered"));
    expect(await world.stateOf(id)).toBe("delivered");
    expect(await eventsOf("delivery.unknown_resolved")).toHaveLength(1);
  });
});

// --- repeated, out of order, after a terminal state -----------------------------------------------------------------

describe("callbacks repeated, out of order, or after a terminal state", () => {
  it("never change a terminal state, change nothing for a repeat, and ignore a non-terminal status after a terminal one", async () => {
    const id = await handedOff();
    const handle = async (status: string) => callbacks().handle(await callbackFor(id, status));
    expect(await handle("queued")).toMatchObject({ kind: "applied", to: "submitted" });
    expect(await handle("sending")).toEqual({ kind: "ignored", reason: "no_change" });
    expect(await handle("sent")).toEqual({ kind: "ignored", reason: "no_change" });
    expect(await handle("delivered")).toMatchObject({ kind: "applied", to: "delivered" });
    const delivered = await world.rowOf(id);
    for (const status of ["delivered", "sent", "queued", "sending", "failed", "undelivered", "delivered"]) {
      expect(await handle(status), status).toEqual({ kind: "ignored", reason: "final" });
    }
    // Not a column of the row changed: not the state, the id, the code, the completion time or the update time.
    expect(await world.rowOf(id)).toEqual(delivered);
    expect(await allEvents()).toEqual([]);
  });

  it("applies a final status that arrives before a non-terminal one, and ignores the non-terminal one that follows", async () => {
    const id = await handedOff();
    expect(await callbacks().handle(await callbackFor(id, "delivered"))).toMatchObject({ kind: "applied", from: "claimed", to: "delivered" });
    expect(await callbacks().handle(await callbackFor(id, "sent"))).toEqual({ kind: "ignored", reason: "final" });
    expect(await world.stateOf(id)).toBe("delivered");
    // And the same on a row the dispatcher had already submitted.
    const second = await seedIn("submitted", { providerId: FAKE_SID });
    expect(await callbacks().handle(await callbackFor(second, "delivered"))).toMatchObject({ from: "submitted", to: "delivered" });
    expect(await callbacks().handle(await callbackFor(second, "queued"))).toEqual({ kind: "ignored", reason: "final" });
    expect(await world.stateOf(second)).toBe("delivered");
  });

  it("never turns delivered into failed or undelivered, or undelivered into delivered, whichever comes second", async () => {
    for (const [first, second] of [["delivered", "failed"], ["delivered", "undelivered"], ["undelivered", "delivered"], ["failed", "delivered"], ["undelivered", "failed"]] as const) {
      const id = await handedOff();
      await callbacks().handle(await callbackFor(id, first));
      await callbacks().handle(await callbackFor(id, second));
      expect(await world.stateOf(id), `${first} then ${second}`).toBe(first);
    }
  });

  it("applies two callbacks for one delivery that arrive at the same moment exactly once, whatever order the lock gives", async () => {
    const id = await handedOff();
    const requests = await Promise.all(["delivered", "delivered", "sent", "failed"].map((status) => callbackFor(id, status)));
    const results = await Promise.all(requests.map((request) => callbacks().handle(request)));
    const applied = results.filter((result) => result.kind === "applied");
    // One status moved the row out of claimed; a later `submitted`-then-final is the only second move that can happen.
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.length).toBeLessThanOrEqual(2);
    const row = await world.rowOf(id);
    expect(["delivered", "failed", "submitted"]).toContain(row.state);
    expect(row.provider_message_id).toBe(FAKE_SID);
    if (row.state === "submitted") expect(applied).toHaveLength(1);
    // Whatever happened, each move was one the table has: the trigger would have refused any other, and nothing threw.
    expect(results.every((result) => result.kind === "applied" || result.kind === "ignored")).toBe(true);
  });
});

// --- a callback about nothing -----------------------------------------------------------------------------------

describe("a valid callback with no ref, or a ref matching no delivery", () => {
  it("returns without changing anything, and counts it in ops_event", async () => {
    const id = await handedOff();
    const before = await snapshot();
    const noRef = signed(`${BASE_URL}/api/twilio/status`, form(FAKE_SID, "delivered"));
    expect(noRef.search).toBe("");
    await expect(callbacks().handle(noRef)).resolves.toEqual({ kind: "ignored", reason: "no_ref" });
    const emptyRef = signed(`${BASE_URL}/api/twilio/status?ref=`, form(FAKE_SID, "delivered"));
    await expect(callbacks().handle(emptyRef)).resolves.toEqual({ kind: "ignored", reason: "no_ref" });
    const stranger = signed(statusCallbackUrl(BASE_URL, randomUUID()), form(FAKE_SID, "delivered"));
    await expect(callbacks().handle(stranger)).resolves.toEqual({ kind: "ignored", reason: "unknown_ref" });
    const notAUuid = signed(`${BASE_URL}/api/twilio/status?ref=1%27%20or%20%271%27%3D%271`, form(FAKE_SID, "delivered"));
    await expect(callbacks().handle(notAUuid)).resolves.toEqual({ kind: "ignored", reason: "unknown_ref" });
    expect(await snapshot()).toBe(before);
    expect(await world.stateOf(id)).toBe("claimed");
    expect((await eventsOf("delivery.callback_ignored")).map((event) => event.detail)).toEqual([{ reason: "no_ref" }, { reason: "no_ref" }, { reason: "unknown_ref" }, { reason: "unknown_ref" }]);
    expect((await eventsOf("delivery.callback_ignored")).every((event) => event.severity === "warning" && event.subject_id === null)).toBe(true);
  });

  it("counts a callback without a usable MessageSid or status, and one about a text that never reached the provider, naming that delivery", async () => {
    const id = await handedOff();
    const url = statusCallbackUrl(BASE_URL, await refOf(id));
    await callbacks().handle(signed(url, { ...form(FAKE_SID, "delivered"), MessageStatus: "read" }));
    await callbacks().handle(signed(url, { ...form(FAKE_SID, "delivered"), MessageSid: "SM123" }));
    expect(await world.stateOf(id)).toBe("claimed");
    const queued = await seedIn("queued");
    await callbacks().handle(await callbackFor(queued, "delivered"));
    expect(await world.stateOf(queued)).toBe("queued");
    const events = await eventsOf("delivery.callback_ignored");
    expect(events.map((event) => [event.detail, event.subject_id])).toEqual([[{ reason: "invalid_payload" }, null], [{ reason: "invalid_payload" }, null], [{ reason: "not_in_flight" }, queued]]);
  });
});

// --- the personal data of the request ------------------------------------------------------------------------------

describe("what a callback leaves behind", () => {
  it("never stores or logs the number or the text from the request, nor its signature, whatever the callback came to", async () => {
    const applied = await handedOff();
    const resolved = await seedIn("unknown");
    const mismatched = await seedIn("submitted", { providerId: OTHER_SID });
    const queued = await seedIn("queued");
    const requests = [
      await callbackFor(applied, "delivered"),
      await callbackFor(resolved, "failed", { extra: { ErrorCode: "30008" } }),
      await callbackFor(mismatched, "delivered"),
      await callbackFor(queued, "delivered"),
      signed(`${BASE_URL}/api/twilio/status`, form(FAKE_SID, "delivered")),
      signed(statusCallbackUrl(BASE_URL, randomUUID()), form(FAKE_SID, "delivered")),
      { ...(await callbackFor(applied, "delivered")), signature: "a-wrong-signature-value" },
    ];
    for (const request of requests) await callbacks().handle(request);
    const stored = await world.everythingStored();
    const logged = JSON.stringify(world.lines);
    for (const secret of [FAKE_NUMBER, "4165550123", FAKE_FROM, "6475550100", SECRET_TEXT, "secret resident text", "a-wrong-signature-value", ...requests.map((request) => request.signature).filter((value): value is string => !!value)]) {
      expect(stored, secret).not.toContain(secret);
      expect(logged, secret).not.toContain(secret);
    }
    // The log says what happened by the delivery's id and the states, and nothing of the request.
    expect(world.lines.filter((line) => line.evt.startsWith("callback.")).length).toBeGreaterThan(0);
    expect(logged).not.toContain(await refOf(applied));
  });
});

// --- the database as the second line -----------------------------------------------------------------------------------

describe("the database refuses what the transition table forbids, whatever the callback code asks", () => {
  async function refusal(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
    }
    throw new Error("expected the database to refuse the statement");
  }

  it("refuses, to the app's own role, a callback-shaped write on a text never handed off, a queued one and a terminal one, and any change of a provider id", async () => {
    const unhanded = await seedIn("claimed", { handedOff: false });
    expect(await refusal(() => appSql`update delivery set state = 'delivered', provider_message_id = ${FAKE_SID} where id = ${unhanded}`)).toMatch(/not handed to the provider/);
    expect(await refusal(() => appSql`update delivery set state = 'submitted', provider_message_id = ${FAKE_SID} where id = ${unhanded}`)).toMatch(/not handed to the provider/);
    const queued = await seedIn("queued");
    expect(await refusal(() => appSql`update delivery set state = 'delivered', provider_message_id = ${FAKE_SID} where id = ${queued}`)).toMatch(/queued to delivered is not an allowed transition/);
    const delivered = await seedIn("delivered", { providerId: FAKE_SID });
    for (const to of ["failed", "undelivered", "submitted", "unknown", "queued"]) {
      expect(await refusal(() => appSql.unsafe(`update delivery set state = '${to}' where id = '${delivered}'`)), `delivered to ${to}`).toMatch(/never changes/);
    }
    const submitted = await seedIn("submitted", { providerId: FAKE_SID });
    expect(await refusal(() => appSql`update delivery set provider_message_id = ${OTHER_SID} where id = ${submitted}`)).toMatch(/never changes/);
    const cancelled = await seedIn("cancelled");
    expect(await refusal(() => appSql`update delivery set state = 'delivered', provider_message_id = ${FAKE_SID} where id = ${cancelled}`)).toMatch(/never changes/);
  });

  it("gives the app's role no way to change what a callback must never touch: the frozen content, the callback reference or the key; nor to delete a delivery", async () => {
    const id = await handedOff();
    for (const column of ["body", "segments", "callback_ref", "idempotency_key", "recipient_id", "lang", "cost_estimate_cents"]) {
      expect(await refusal(() => appSql.unsafe(`update delivery set ${column} = ${column} where id = '${id}'`)), column).toMatch(/permission denied/);
    }
    expect(await refusal(() => appSql`delete from delivery where id = ${id}`)).toMatch(/permission denied/);
  });

  it("is the second line behind the store: asked for a move the table lacks, the store's write changes nothing or the trigger refuses it", async () => {
    // From claimed without a hand-off the store's statement names the hand-off and matches no row.
    const unhanded = await seedIn("claimed", { handedOff: false });
    await app.transaction(async (tx) => {
      expect(await drizzleCallbackStore.applyCallback(tx, { id: unhanded, from: "claimed", to: "delivered", providerMessageId: FAKE_SID, errorCode: null })).toBeNull();
    });
    expect(await world.stateOf(unhanded)).toBe("claimed");
    // A move the table does not have, asked for anyway, is refused by the trigger (a bug above the store could not write it).
    const queued = await seedIn("queued");
    const message = await refusal(() =>
      app.transaction(async (tx) => {
        await drizzleCallbackStore.applyCallback(tx, { id: queued, from: "queued", to: "delivered", providerMessageId: FAKE_SID, errorCode: null });
      }),
    );
    expect(message).toMatch(/not an allowed transition/);
    expect(await world.stateOf(queued)).toBe("queued");
    expect(CALLBACK_TARGETS).toEqual(["submitted", "delivered", "undelivered", "failed"]);
  });
});
