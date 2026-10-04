// The web sign-up against a real database (S07.02): the `pending_signup` table and its lock-down (the app may add and delete a row and never
// change one; no client role reaches it), the use case with the real outbox, limiter and places (one pending sign-up and one confirmation per
// new number, nothing for a number already pending or subscribed, the same answer and the same statements for all three), the per-client
// limit, two sign-ups for one number at once, the refusal of a confirmation because the number texted STOP (Twilio 21610) by the sender and
// by a later callback, and an expired sign-up (skipped at the hand-off, no number for the resolver, deleted by the purge job). Nothing reaches
// Twilio: the provider is a fake, the callbacks are signed here with a fake token, and every number is fictional (555).
import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { signupResponse } from "../../src/app/api/signup/handler";
import { opsRecorder } from "../../src/app/dispatch";
import { wireContactResolver } from "../../src/app/messaging";
import { checkSignupRequest, type SignupRequest } from "../../src/contracts/signup";
import { createContactResolver, createDeliveryQueue, createStatusCallbacks, drizzleCallbackStore, statusCallbackUrl, type CallbackRequest } from "../../src/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "../../src/modules/places";
import {
  SIGNUP_RATE_LIMIT,
  createRateLimiter,
  createSignup,
  forgetOptedOutSignup,
  pendingSignupNumberSource,
  type Signup,
  type SubscriberLookup,
} from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, SERVICE_SID, dispatcherWorld, sidOf, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let logged: Db;
let world: DispatcherWorld;
const statements: string[] = [];

const VERSION = "2026-10-02.1";
const TOKEN = "fake-auth-token-for-tests";
const RSN_TP = "9100001";
const RSN_FP = "9100002";
const FLOOR_1 = "0190f000-0000-7000-8000-000000000001";
const FLOOR_2 = "0190f000-0000-7000-8000-000000000002";
const NUMBER = "+14165550123";
const subscribedNumbers = new Set<string>();
const subscribers: SubscriberLookup = { isSubscribed: async (_tx, phone) => subscribedNumbers.has(phone) };

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
  // The same role through a client that writes down every statement it sends (to compare the work of three sign-ups).
  logged = drizzle({ client: postgres(url.href, { prepare: false, max: 4, onnotice: () => {} }), logger: { logQuery: (query) => void statements.push(query) } }) as Db;
  world = dispatcherWorld(owner, appSql, app);
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
              values (${RSN_TP}, 'TP', '1 Sample Road', 43.7, -79.34, now()), (${RSN_FP}, 'FP', '2 Sample Road', 43.72, -79.33, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN_TP}, '1', 1, true), (${FLOOR_2}, ${RSN_TP}, '2', 2, true) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from pending_signup`;
  await owner`delete from rate_limit where scope = ${SIGNUP_RATE_LIMIT.scope}`;
  await world.reset();
  subscribedNumbers.clear();
  statements.length = 0;
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn in (${RSN_TP}, ${RSN_FP})`;
  await owner`delete from building where rsn in (${RSN_TP}, ${RSN_FP})`;
  await app.$client.end({ timeout: 5 });
  await logged.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

/** The sign-up use case on the real tables, as the app composes it (src/app/signup.ts), with the subscriber lookup this file controls. */
function signupOn(db: Db): Signup {
  const queue = createDeliveryQueue();
  return createSignup({
    db,
    places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    subscribers,
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: () => VERSION,
    limiter: () => createRateLimiter({ db, key: "a-test-key-for-the-rate-limiter" }),
    pricePerSegmentCents: () => 1.5,
  });
}

const request = (patch: Partial<SignupRequest> = {}): SignupRequest => ({
  phone: NUMBER,
  lang: "ur",
  neighbourhood: "TP",
  places: [{ rsn: RSN_TP, floors: [FLOOR_2] }],
  groups: ["seniors", "families"],
  consentVersion: VERSION,
  ...patch,
});

const pendingRows = () => owner`select id, phone, lang, neighbourhood_id, places, groups, topics, consent_version, started_by, created_at, expires_at from pending_signup order by created_at`;
const confirmations = () =>
  owner`select id, kind, recipient_kind, recipient_id, created_by_module, purpose, lang, body, segments, send_by, state, idempotency_key from delivery where purpose = 'confirmation' order by created_at`;

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    const e = error as { message?: string; code?: string };
    return `${e.code ?? ""} ${e.message ?? String(error)}`;
  }
  return "";
}

describe("the pending_signup table", () => {
  it("is reachable by the app's role alone: select, insert and delete, never update, and no client role at all", async () => {
    const [table] = await owner`select relrowsecurity from pg_class where relname = 'pending_signup'`;
    expect(table!.relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [privileges] = await owner`select has_table_privilege(${role}, 'pending_signup', 'select') or has_table_privilege(${role}, 'pending_signup', 'insert')
                                          or has_table_privilege(${role}, 'pending_signup', 'update') or has_table_privilege(${role}, 'pending_signup', 'delete') as any`;
      expect(privileges!.any, role).toBe(false);
    }
    const [mine] = await owner`select has_table_privilege('cvh_app', 'pending_signup', 'select') as s, has_table_privilege('cvh_app', 'pending_signup', 'insert') as i,
                                      has_table_privilege('cvh_app', 'pending_signup', 'delete') as d, has_table_privilege('cvh_app', 'pending_signup', 'update') as u`;
    expect(mine).toEqual({ s: true, i: true, d: true, u: false });

    await signupOn(app).request(request(), "203.0.113.1");
    expect(await refusal(() => appSql`update pending_signup set lang = 'fr'`)).toMatch(/permission denied/);
  });

  it("holds one pending sign-up per number, expiring exactly 48 hours after it was made, and checks every column", async () => {
    const insert = (over: Record<string, unknown> = {}) => {
      const row = { id: crypto.randomUUID(), phone: "+16475550199", lang: "en", neighbourhood_id: "TP", consent_version: VERSION, started_by: "web", ...over };
      return appSql`insert into pending_signup ${appSql(row)}`;
    };
    await insert();
    const [row] = await owner`select extract(epoch from expires_at - created_at)::int as seconds from pending_signup`;
    expect(row!.seconds).toBe(48 * 3600);

    expect(await refusal(() => insert())).toMatch(/pending_signup_phone_idx/);
    expect(await refusal(() => insert({ phone: "4165550123" }))).toMatch(/pending_signup_phone_format/);
    expect(await refusal(() => insert({ phone: "+14161550123" }))).toMatch(/pending_signup_phone_format/);
    expect(await refusal(() => insert({ phone: "+16475550100", lang: "zh-Hant" }))).toMatch(/pending_signup_lang_known/);
    expect(await refusal(() => insert({ phone: "+16475550101", neighbourhood_id: "XX" }))).toMatch(/foreign key/);
    expect(await refusal(() => insert({ phone: "+16475550102", groups: ["vip"] }))).toMatch(/pending_signup_groups_known/);
    expect(await refusal(() => insert({ phone: "+16475550103", topics: ["Not A Topic"] }))).toMatch(/pending_signup_topics_format/);
    expect(await refusal(() => insert({ phone: "+16475550104", consent_version: "v1" }))).toMatch(/pending_signup_consent_version_format/);
    expect(await refusal(() => insert({ phone: "+16475550105", started_by: "import" }))).toMatch(/pending_signup_started_by_known/);
    expect(await refusal(() => insert({ phone: "+16475550106", places: appSql.json({ rsn: "1" }) }))).toMatch(/pending_signup_places_array/);
    expect(await refusal(() => insert({ phone: "+16475550107", expires_at: new Date(Date.now() + 72 * 3_600_000) }))).toMatch(/pending_signup_expires_after_48_hours/);
  });
});

describe("a sign-up", () => {
  it("creates the pending sign-up and queues one confirmation in the chosen language, sendable until the sign-up expires", async () => {
    expect(await signupOn(app).request(request(), "203.0.113.1")).toEqual({ kind: "accepted" });

    const [row] = await pendingRows();
    expect(row).toMatchObject({
      phone: NUMBER,
      lang: "ur",
      neighbourhood_id: "TP",
      places: [{ rsn: RSN_TP, floors: [FLOOR_2] }],
      groups: ["seniors", "families"],
      topics: [],
      consent_version: VERSION,
      started_by: "web",
    });
    const [text] = await confirmations();
    expect(text).toMatchObject({
      kind: "transactional",
      recipient_kind: "pending_signup",
      recipient_id: row!.id,
      created_by_module: "subscriptions",
      purpose: "confirmation",
      lang: "ur",
      state: "queued",
      idempotency_key: `transactional:${row!.id}:confirmation:web`,
    });
    expect(text!.body).toContain("YES");
    // send_by is the purpose's 48 hours from the database's clock in the same transaction: the sign-up's own expires_at.
    expect((text!.send_by as Date).getTime()).toBe((row!.expires_at as Date).getTime());
    // The delivery never holds the number.
    expect(await world.everythingStored()).not.toContain("5550123");
  });

  it("answers a new number, a pending number and a subscribed number with the same bytes, after the same statements, and texts only the new one", async () => {
    const service = signupOn(logged);
    const PENDING = "+14165550124";
    const SUBSCRIBED = "+14165550125";
    await service.request(request({ phone: PENDING, lang: "fr" }), "198.51.100.9");
    subscribedNumbers.add(SUBSCRIBED);
    const before = { pending: (await pendingRows()).length, texts: (await confirmations()).length };

    const answer = async (phone: string, client: string) => {
      statements.length = 0;
      const body = { v: 1, phone, lang: "ur", neighbourhood: "TP", places: [{ rsn: RSN_TP, floors: [FLOOR_2] }], groups: ["seniors"], consent_version: VERSION, terms_agreed: true, age_confirmed: true };
      const response = await signupResponse({ signup: () => service, client: () => client }, new Request(`${BASE_URL}/api/signup`, { method: "POST", body: JSON.stringify(body) }));
      const bytes = Buffer.from(await response.arrayBuffer()).toString("hex");
      return { status: response.status, headers: [...response.headers.entries()].sort(), bytes, statements: [...statements] };
    };
    const fresh = await answer(NUMBER, "203.0.113.1");
    const pending = await answer(PENDING, "203.0.113.2");
    const subscribed = await answer(SUBSCRIBED, "203.0.113.3");

    expect(fresh.status).toBe(202);
    expect(Buffer.from(fresh.bytes, "hex").toString()).toBe('{"v":1,"status":"accepted"}');
    for (const other of [pending, subscribed]) {
      expect(other.status).toBe(fresh.status);
      expect(other.headers).toEqual(fresh.headers);
      expect(other.bytes).toBe(fresh.bytes);
    }
    // The same statements in the same order; only the end of the savepoint differs (kept for the new number, rolled back for the others).
    const shape = (list: string[]) => list.map((q) => q.replace(/^(release|rollback to) savepoint/i, "end savepoint"));
    expect(fresh.statements.length).toBeGreaterThan(5);
    expect(shape(pending.statements)).toEqual(shape(fresh.statements));
    expect(shape(subscribed.statements)).toEqual(shape(fresh.statements));

    // Only the new number got a pending sign-up and a text.
    const rows = await pendingRows();
    expect(rows.length).toBe(before.pending + 1);
    expect(rows.map((r) => r.phone).sort()).toEqual([NUMBER, PENDING]);
    expect(rows.find((r) => r.phone === PENDING)!.lang).toBe("fr");
    expect((await confirmations()).length).toBe(before.texts + 1);
  });

  it("stores a number typed in Urdu or full-width digits as the same E.164 number", async () => {
    const service = signupOn(app);
    const post = (phone: string, client: string) =>
      signupResponse(
        { signup: () => service, client: () => client },
        new Request(`${BASE_URL}/api/signup`, {
          method: "POST",
          body: JSON.stringify({ v: 1, phone, lang: "ur", neighbourhood: "TP", places: [], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true }),
        }),
      );
    expect((await post("۴۱۶ ۵۵۵ ۰۱۲۳", "203.0.113.60")).status).toBe(202);
    expect((await post("４１６ ５５５ ０１２６", "203.0.113.61")).status).toBe(202);
    expect((await pendingRows()).map((r) => r.phone).sort()).toEqual([NUMBER, "+14165550126"]);
  });

  it("does not count a refused building against the client's 5 sign-ups an hour", async () => {
    const service = signupOn(app);
    const send = (n: number, rsn: string) =>
      signupResponse(
        { signup: () => service, client: () => "203.0.113.70" },
        new Request(`${BASE_URL}/api/signup`, {
          method: "POST",
          body: JSON.stringify({ v: 1, phone: `+1416555${String(300 + n).padStart(4, "0")}`, lang: "en", neighbourhood: "TP", places: [{ rsn, floors: [] }], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true }),
        }),
      );
    for (let n = 1; n <= 6; n += 1) expect((await send(n, "9199999")).status).toBe(400);
    expect(await owner`select 1 from rate_limit where scope = 'signup'`).toHaveLength(0);
    for (let n = 1; n <= 5; n += 1) expect((await send(n, RSN_TP)).status).toBe(202);
    expect((await send(6, RSN_TP)).status).toBe(429);
    expect((await pendingRows()).length).toBe(5);
  });

  it("refuses the sixth sign-up in an hour from one client with 429, storing nothing", async () => {
    const service = signupOn(app);
    const send = (n: number) =>
      signupResponse(
        { signup: () => service, client: () => "203.0.113.50" },
        new Request(`${BASE_URL}/api/signup`, {
          method: "POST",
          body: JSON.stringify({ v: 1, phone: `+1416555${String(200 + n).padStart(4, "0")}`, lang: "en", neighbourhood: "FP", places: [], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true }),
        }),
      );
    for (let n = 1; n <= 5; n += 1) expect((await send(n)).status).toBe(202);

    const sixth = await send(6);
    expect(sixth.status).toBe(429);
    expect((await sixth.json()).error.code).toBe("rate_limited");
    expect(Number(sixth.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await pendingRows()).length).toBe(5);
    expect((await confirmations()).length).toBe(5);
    // The client is kept as a salted hash, never as its address.
    expect(JSON.stringify(await owner`select * from rate_limit where scope = 'signup'`)).not.toContain("203.0.113.50");
  });

  it("refuses what the form got wrong with the reason, storing nothing and counting nothing", async () => {
    const service = signupOn(app);
    const cases: [Record<string, unknown>, number, string][] = [
      [{ phone: "212 555 0123" }, 400, "phone_not_canadian"],
      [{ neighbourhood: null }, 400, "neighbourhood_missing"],
      [{ terms_agreed: false }, 400, "terms_not_agreed"],
      [{ places: [{ rsn: "9199999", floors: [] }] }, 400, "place_unknown"],
      [{ places: [{ rsn: RSN_FP, floors: [FLOOR_1] }] }, 400, "place_unknown"],
      [{ consent_version: "2026-09-01.1" }, 409, "terms_changed"],
    ];
    for (const [patch, status, code] of cases) {
      const body = { v: 1, phone: NUMBER, lang: "en", neighbourhood: "TP", places: [], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true, ...patch };
      const response = await signupResponse({ signup: () => service, client: () => "203.0.113.60" }, new Request(`${BASE_URL}/api/signup`, { method: "POST", body: JSON.stringify(body) }));
      expect(response.status, code).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
    expect(await pendingRows()).toEqual([]);
    expect(await confirmations()).toEqual([]);
  });

  it("makes one pending sign-up and one text when two sign-ups for one number arrive at once", async () => {
    const service = signupOn(app);
    const outcomes = await Promise.all([service.request(request({ lang: "en" }), "203.0.113.70"), service.request(request({ lang: "fr" }), "203.0.113.71")]);

    expect(outcomes).toEqual([{ kind: "accepted" }, { kind: "accepted" }]);
    expect((await pendingRows()).length).toBe(1);
    expect((await confirmations()).length).toBe(1);
  });

  it("checks the request with the contract the form uses (a sanity check of the shape this file sends)", () => {
    expect(checkSignupRequest({ v: 1, phone: "416 555 0123", lang: "en", neighbourhood: "TP", places: [], groups: [], consent_version: VERSION, terms_agreed: true, age_confirmed: true }).ok).toBe(true);
  });
});

describe("the confirmation at the sender", () => {
  const resolver = () => createContactResolver({ sources: { pending_signup: pendingSignupNumberSource() }, log: world.log });
  const forget = forgetOptedOutSignup({ skipRecipientDeliveries: (tx, r) => createDeliveryQueue().skipRecipientDeliveries(tx, r) });

  it("is sent to the pending sign-up's number, which the app's composition resolves", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    // The composition root's own wiring answers for pending sign-ups.
    const wired = wireContactResolver({ subscriptions: { pending_signup: pendingSignupNumberSource() } }, world.log);
    const resolved = await app.transaction((tx) => wired.resolve(tx, { deliveryId: text!.id as string, kind: "pending_signup", id: text!.recipient_id as string, deliveryKind: "transactional", purpose: "confirmation" }));
    expect(resolved).toEqual({ found: true, number: NUMBER });

    const report = await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();
    expect(report.submitted).toBe(1);
    expect(world.provider.calls.map((call) => call.to)).toEqual([NUMBER]);
    expect(world.provider.calls[0]!.body).toBe(text!.body);
    expect(JSON.stringify(world.lines)).not.toContain("5550123");
  });

  it("refused at once because the number texted STOP (21610): the text fails and the pending sign-up is deleted with it", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    world.provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 21_610, message: "Attempt to send to unsubscribed recipient" });

    await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();

    const row = await world.rowOf(text!.id as string);
    expect(row).toMatchObject({ state: "failed", provider_error_code: 21_610, recipient_id: null });
    expect(await pendingRows()).toEqual([]);
    // A new sign-up for the number (after the resident texted START) starts afresh.
    expect(await signupOn(app).request(request(), "203.0.113.2")).toEqual({ kind: "accepted" });
    expect((await pendingRows()).length).toBe(1);
  });

  it("a failure hook that throws loses only its own writes: the refusal is still recorded, and the sender says so", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    world.provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 21_610, message: "Attempt to send to unsubscribed recipient" });
    const failing = async (...args: Parameters<typeof forget>) => {
      await forget(...args);
      throw new Error("the hook broke after its writes");
    };

    await world.dispatcher({ resolver: resolver(), afterFailure: failing }).run();

    expect(await world.stateOf(text!.id as string)).toBe("failed");
    expect((await pendingRows()).length).toBe(1);
    expect(world.lines.some((line) => line.evt === "dispatch.failure_hook_failed")).toBe(true);
  });

  it("refused for another reason: the text fails and the pending sign-up stays", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    world.provider.answer({ kind: "rejected", httpStatus: 400, errorCode: 21_211, message: "Invalid 'To' Phone Number" });

    await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();

    expect((await confirmations())[0]).toMatchObject({ state: "failed" });
    expect((await pendingRows()).length).toBe(1);
  });

  it("refused later, by a signed callback with 21610: the status is recorded and the pending sign-up is deleted", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();
    expect(await world.stateOf(text!.id as string)).toBe("submitted");

    const ref = (await world.rowOf(text!.id as string)).callback_ref as string;
    const url = statusCallbackUrl(BASE_URL, ref).split("#")[0]!;
    const fields = { MessageSid: sidOf(1), MessagingServiceSid: SERVICE_SID, MessageStatus: "undelivered", ErrorCode: "21610" };
    const callback: CallbackRequest = { signature: getExpectedTwilioSignature(TOKEN, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
    const result = await createStatusCallbacks({ db: app, ops: opsRecorder, log: world.log, authToken: TOKEN, publicBaseUrl: BASE_URL, store: drizzleCallbackStore, afterFailure: forget }).handle(callback);

    expect(result).toMatchObject({ kind: "applied", to: "undelivered" });
    expect(await world.rowOf(text!.id as string)).toMatchObject({ state: "undelivered", provider_error_code: 21_610, recipient_id: null });
    expect(await pendingRows()).toEqual([]);
  });

  it("refused later, with a failure hook that throws: the callback's outcome is still recorded and only the hook's writes are undone", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();

    const ref = (await world.rowOf(text!.id as string)).callback_ref as string;
    const url = statusCallbackUrl(BASE_URL, ref).split("#")[0]!;
    const fields = { MessageSid: sidOf(1), MessagingServiceSid: SERVICE_SID, MessageStatus: "undelivered", ErrorCode: "21610" };
    const callback: CallbackRequest = { signature: getExpectedTwilioSignature(TOKEN, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
    const failing = async (...args: Parameters<typeof forget>) => {
      await forget(...args);
      throw new Error("the hook broke after its writes");
    };
    const result = await createStatusCallbacks({ db: app, ops: opsRecorder, log: world.log, authToken: TOKEN, publicBaseUrl: BASE_URL, store: drizzleCallbackStore, afterFailure: failing }).handle(callback);

    expect(result).toMatchObject({ kind: "applied", to: "undelivered" });
    expect(await world.rowOf(text!.id as string)).toMatchObject({ state: "undelivered", provider_error_code: 21_610 });
    expect((await pendingRows()).length).toBe(1);
    expect(world.lines.some((line) => line.evt === "callback.failure_hook_failed")).toBe(true);
  });

  it("past its 48 hours: skipped at the hand-off, no number for the resolver, and the row deleted by the purge job", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [text] = await confirmations();
    await owner`update pending_signup set created_at = created_at - interval '49 hours', expires_at = expires_at - interval '49 hours'`;
    world.clock.advance(49 * 3_600_000);

    await world.dispatcher({ resolver: resolver(), afterFailure: forget }).run();
    expect(await world.stateOf(text!.id as string)).toBe("skipped");
    expect(world.provider.calls).toEqual([]);
    const [row] = await pendingRows();
    expect(await app.transaction((tx) => pendingSignupNumberSource().numberOf(tx, row!.id as string, { consume: false, purpose: "confirmation" }))).toBeNull();

    // The purge job, as pg_cron runs it (its own command, as the table's owner).
    const [job] = await owner`select command, schedule from cron.job where jobname = 'subscriptions-purge-pending-signup'`;
    expect(job!.schedule).toBe("*/15 * * * *");
    await owner.unsafe(job!.command as string);
    expect(await pendingRows()).toEqual([]);
    expect((await world.rowOf(text!.id as string)).recipient_id).toBeNull();
  });

  it("the purge job leaves a sign-up that has not expired", async () => {
    await signupOn(app).request(request(), "203.0.113.1");
    const [job] = await owner`select command from cron.job where jobname = 'subscriptions-purge-pending-signup'`;
    await owner.unsafe(job!.command as string);
    expect((await pendingRows()).length).toBe(1);
  });
});
