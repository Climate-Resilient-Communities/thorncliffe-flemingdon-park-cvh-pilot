// The inbound router against a real database (S07.04): the subscriber tables and their lock-down, YES (the subscriber made from the pending
// sign-up, the welcome, a repeated YES), YES after the pending sign-up's 48 hours and from a number the CVH does not know (the sign-up link
// through `inbound_reply`, at most once a day), a Twilio retry (nothing at all changes), STOP and the confirmed reply 0 (everything held for
// the number deleted in one transaction, its waiting texts skipped, its past texts forgetting it, nothing sent), the `inbound_reply` row taken
// at the hand-off or gone first, digits typed in Urdu, Bengali, Gujarati and full-width, and that no number reaches a log, `audit_event` or
// `ops_event`. Nothing reaches Twilio: the provider is a fake, the webhook is signed here with a fake token, and every number is fictional
// (555-01xx).
import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { opsRecorder } from "../../src/app/dispatch";
import { ownerSources, wireContactResolver } from "../../src/app/messaging";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "../../src/modules/places";
import {
  createInboundRouter,
  createInboundWebhook,
  clientHash,
  createRateLimiter,
  createSignup,
  subscriberLookup,
  type InboundMessage,
  type InboundOutcome,
  type InboundRouter,
} from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;

const VERSION = "2026-10-02.1";
const TOKEN = "fake-auth-token-for-tests";
const RSN = "9100011";
const FLOOR_1 = "0190f000-0000-7000-8000-000000000011";
const FLOOR_2 = "0190f000-0000-7000-8000-000000000012";
const NUMBER = "+14165550123";
const OTHER = "+14165550145";
const KEY = "a-test-key-for-the-reply-limit";

const routerLines: { evt: string; fields: Record<string, unknown> }[] = [];
const checkinCalls: string[] = [];
let sid = 0;
const nextSid = () => `SM${(++sid).toString(16).padStart(32, "0")}`;

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
  world = dispatcherWorld(owner, appSql, app);
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', '11 Sample Road', 43.7, -79.34, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN}, '1', 1, true), (${FLOOR_2}, ${RSN}, '2', 2, true) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_reply`;
  await owner`delete from inbound_seen`;
  await owner`delete from inbound_keyword_count`;
  await owner`delete from rate_limit where scope in ('signup', 'signup_info', 'inbound', 'inbound_mute')`;
  await owner`delete from inbound_limited_count`;
  await owner`delete from ops_event where kind = 'webhook.signature_invalid'`;
  await world.reset();
  routerLines.length = 0;
  checkinCalls.length = 0;
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

/** The router on the real tables, as src/app/inbound.ts composes it, with a fake check-in port that records its calls. */
function routerOn(db: Db = app): InboundRouter {
  return createInboundRouter({
    db,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    checkins: { deleteForSubscriber: async (id) => void checkinCalls.push(id) },
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
    log: { info: (evt, fields) => void routerLines.push({ evt, fields }) },
  });
}

async function signUp(over: { phone?: string; lang?: string; places?: { rsn: string; floors: string[] }[]; groups?: ("seniors" | "families" | "newcomers")[] } = {}) {
  const queue = createDeliveryQueue();
  const signup = createSignup({
    db: app,
    places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    subscribers: subscriberLookup(),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: () => VERSION,
    limiter: () => createRateLimiter({ db: app, key: KEY }),
    pricePerSegmentCents: () => 1.5,
  });
  return signup.request(
    {
      phone: over.phone ?? NUMBER,
      lang: (over.lang ?? "ur") as never,
      neighbourhood: "TP",
      places: over.places ?? [{ rsn: RSN, floors: [FLOOR_2] }],
      groups: over.groups ?? ["seniors"],
      consentVersion: VERSION,
    },
    `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
  );
}

const text = (body: string, over: Partial<InboundMessage> = {}): InboundMessage => ({ messageSid: nextSid(), from: NUMBER, body, optOutType: null, ...over });
const send = (body: string, over: Partial<InboundMessage> = {}): Promise<InboundOutcome> => routerOn().handle(text(body, over));

const subscribers = () => owner`select id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state from subscriber order by created_at`;
const places = () => owner`select subscriber_id, rsn, floor_id from subscriber_place order by floor_id nulls first`;
const pendings = () => owner`select id, phone, lang from pending_signup`;
const replies = () => owner`select id, phone, expires_at from inbound_reply`;
const texts = (purpose?: string) =>
  purpose
    ? owner`select id, recipient_kind, recipient_id, purpose, lang, body, state, idempotency_key, send_by from delivery where purpose = ${purpose} order by created_at`
    : owner`select id, recipient_kind, recipient_id, purpose, lang, body, state, idempotency_key, send_by from delivery order by created_at`;
const counts = async () => Object.fromEntries((await owner`select keyword, count from inbound_keyword_count`).map((row) => [row.keyword as string, row.count as number]));
const prompt = async () => (await owner`select subscriber_id, kind from sms_prompt`)[0] ?? null;

/** Every row of the tables a number must never be in, with the logs, as one string. */
async function whereNumbersMustNeverBe(): Promise<string> {
  const audit = await owner`select * from audit_event`;
  return JSON.stringify({ audit, stored: await world.everythingStored(), router: routerLines, sender: world.lines });
}

describe("the subscriber tables", () => {
  it("are reachable by the app's role alone, with only the rights it uses, and no client role at all", async () => {
    const rights: Record<string, string> = {
      subscriber: "select,insert,delete",
      subscriber_place: "select,insert,delete",
      subscriber_topic_optout: "select,insert,delete",
      sms_prompt: "select,insert,delete",
      inbound_seen: "select,insert",
      inbound_reply: "select,insert,delete",
      inbound_keyword_count: "select,insert,update",
      inbound_limited_count: "select,insert,update",
    };
    for (const [table, expected] of Object.entries(rights)) {
      const [rls] = await owner`select relrowsecurity from pg_class where relname = ${table}`;
      expect(rls!.relrowsecurity, table).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [any] = await owner`select has_table_privilege(${role}, ${table}, 'select') or has_table_privilege(${role}, ${table}, 'insert')
                                          or has_table_privilege(${role}, ${table}, 'update') or has_table_privilege(${role}, ${table}, 'delete') as any`;
        expect(any!.any, `${role} on ${table}`).toBe(false);
      }
      const granted = [];
      for (const right of ["select", "insert", "update", "delete"]) {
        const [row] = await owner`select has_table_privilege('cvh_app', ${table}, ${right}) as ok`;
        if (row!.ok) granted.push(right);
      }
      expect(granted.join(","), table).toBe(expected);
    }
    // The deletion's row lock needs an update right on one column: only retention_state (E09's), never the number or the language.
    const [columns] = await owner`select has_column_privilege('cvh_app', 'subscriber', 'retention_state', 'update') as state,
                                         has_column_privilege('cvh_app', 'subscriber', 'phone', 'update') as phone, has_column_privilege('cvh_app', 'subscriber', 'lang', 'update') as lang`;
    expect(columns).toEqual({ state: true, phone: false, lang: false });
  });

  it("refuse what a subscriber cannot be", async () => {
    const insert = (over: Record<string, unknown> = {}) =>
      appSql`insert into subscriber ${appSql({ id: crypto.randomUUID(), phone: "+16475550199", lang: "en", neighbourhood_id: "TP", consent_version: VERSION, started_by: "web", ...over })}`;
    await insert();
    const refusal = async (run: () => Promise<unknown>) => run().then(() => "", (error: { message: string }) => error.message);
    expect(await refusal(() => insert())).toMatch(/subscriber_phone_idx/);
    expect(await refusal(() => insert({ phone: "4165550123" }))).toMatch(/subscriber_phone_format/);
    expect(await refusal(() => insert({ phone: "+16475550198", lang: "zh-Hant" }))).toMatch(/subscriber_lang_known/);
    expect(await refusal(() => insert({ phone: "+16475550197", retention_state: "gone" }))).toMatch(/subscriber_retention_state_known/);
    expect(await refusal(() => appSql`update subscriber set lang = 'fr'`)).toMatch(/permission denied/);
    expect(await refusal(() => appSql`insert into inbound_reply (id, phone, expires_at) values (${crypto.randomUUID()}, ${OTHER}, now() + interval '2 hours')`)).toMatch(/inbound_reply_expires_after_30_minutes/);
  });
});

describe("YES", () => {
  it("from a pending sign-up: the subscriber is made from it in one transaction, the pending row deleted, and the welcome queued in its language", async () => {
    await signUp({ places: [{ rsn: RSN, floors: [FLOOR_2] }], groups: ["seniors", "families"] });
    const [pendingRow] = await pendings();
    const [confirmation] = await texts("confirmation");

    expect(await send("YES")).toEqual({ kind: "handled", keyword: "yes", state: "pending", action: "confirm", replied: true });

    const [subscriber] = await subscribers();
    expect(subscriber).toMatchObject({ phone: NUMBER, lang: "ur", neighbourhood_id: "TP", groups: ["seniors", "families"], consent_version: VERSION, started_by: "web", retention_state: "active" });
    expect(await places()).toEqual([{ subscriber_id: subscriber!.id, rsn: RSN, floor_id: FLOOR_2 }]);
    expect(await pendings()).toEqual([]);
    // The confirmation, not handed off yet, is skipped and forgets the pending row.
    expect(await world.rowOf(confirmation!.id as string)).toMatchObject({ state: "skipped", recipient_id: null });
    const [welcome] = await texts("welcome");
    expect(welcome).toMatchObject({ recipient_kind: "subscriber", recipient_id: subscriber!.id, lang: "ur", state: "queued", idempotency_key: `transactional:${subscriber!.id}:welcome:yes` });
    expect(welcome!.body).toContain("STOP");
    expect(pendingRow!.id).not.toBe(subscriber!.id);
    expect(await counts()).toEqual({ yes: 1 });

    // The welcome goes to the subscriber's number through the app's own ContactResolver wiring.
    const report = await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    expect(report.submitted).toBe(1);
    expect(world.provider.calls.map((call) => call.to)).toEqual([NUMBER]);
    expect(world.provider.calls[0]!.body).toBe(welcome!.body);
  });

  it("in the pending sign-up's own language, or typed in Urdu ('ہاں') or full-width ('ＹＥＳ'), confirms too", async () => {
    await signUp({ phone: NUMBER, lang: "ur" });
    expect(await send("ہاں")).toMatchObject({ keyword: "yes", action: "confirm" });
    await signUp({ phone: OTHER, lang: "fr" });
    expect(await send("ＹＥＳ", { from: OTHER })).toMatchObject({ action: "confirm" });
    expect((await subscribers()).map((s) => s.lang).sort()).toEqual(["fr", "ur"]);
  });

  it("keeps a building whose floors were removed since the sign-up, with no floor, and drops a removed floor", async () => {
    await signUp({ places: [{ rsn: RSN, floors: [FLOOR_1, FLOOR_2] }] });
    // An Admin removes floor 1 while the sign-up waits (S01.13's removal deletes the row).
    await owner`delete from building_floor where id = ${FLOOR_1}`;
    await send("yes");
    const [subscriber] = await subscribers();
    expect(await places()).toEqual([{ subscriber_id: subscriber!.id, rsn: RSN, floor_id: FLOOR_2 }]);
    // Removing the subscriber's own floor keeps the building, with no floor recorded there.
    await owner`delete from building_floor where id = ${FLOOR_2}`;
    expect(await places()).toEqual([{ subscriber_id: subscriber!.id, rsn: RSN, floor_id: null }]);
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN}, '1', 1, true), (${FLOOR_2}, ${RSN}, '2', 2, true)`;
  });

  it("repeated, is answered 'You are already signed up' and changes nothing", async () => {
    await signUp();
    await send("YES");
    const before = await subscribers();
    expect(await send("Yes")).toMatchObject({ state: "active", action: "already_signed_up", replied: true });
    expect(await subscribers()).toEqual(before);
    const [reply] = await texts("prompt_reply");
    expect(reply).toMatchObject({ recipient_kind: "subscriber", recipient_id: before[0]!.id, lang: "ur" });
    expect(reply!.body).toContain("CVH");
  });

  it("after the pending sign-up's 48 hours (the purge has not run yet): no subscriber, the sign-up link in its language through inbound_reply, and the old row gone", async () => {
    await signUp({ lang: "fr" });
    await owner`update pending_signup set created_at = created_at - interval '49 hours', expires_at = expires_at - interval '49 hours'`;

    expect(await send("YES")).toMatchObject({ state: "none", action: "signup_info", replied: true });

    expect(await subscribers()).toEqual([]);
    expect(await pendings()).toEqual([]);
    const [reply] = await replies();
    expect(reply!.phone).toBe(NUMBER);
    const [info] = await texts("signup_info");
    expect(info).toMatchObject({ recipient_kind: "inbound_reply", recipient_id: reply!.id, lang: "fr", state: "queued" });
    expect(info!.body).toContain(`${BASE_URL}/fr/text-alerts`);
    // Sendable until the reply row expires, and no later.
    expect((info!.send_by as Date).getTime()).toBe((reply!.expires_at as Date).getTime());
  });

  it("from a number with no pending sign-up, and any other text from it: the sign-up link at most once a day, in English, kept as a keyed hash", async () => {
    expect(await send("YES")).toMatchObject({ state: "none", action: "signup_info", replied: true });
    expect(await send("hello?")).toMatchObject({ state: "none", action: "signup_info", replied: false });
    expect(await send("1")).toMatchObject({ replied: false });
    expect(await subscribers()).toEqual([]);
    const sent = await texts("signup_info");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.lang).toBe("en");
    expect(sent[0]!.body).toContain(`${BASE_URL}/en/text-alerts`);
    expect(sent[0]!.body).toContain("Reply STOP");
    expect(await replies()).toHaveLength(1);
    const limit = await owner`select client_hash from rate_limit where scope = 'signup_info'`;
    expect(limit).toHaveLength(1);
    expect(JSON.stringify(limit)).not.toContain("5550123");
    // Another number gets its own.
    expect(await send("hi", { from: OTHER })).toMatchObject({ replied: true });
  });

  it("from a number that is not Canadian: counted, nothing stored, nothing sent", async () => {
    expect(await send("YES", { from: "+447700900123" })).toEqual({ kind: "handled", keyword: "yes", state: "none", action: "none", replied: false });
    expect(await texts()).toEqual([]);
    expect(await replies()).toEqual([]);
    expect(await counts()).toEqual({ yes: 1 });
  });
});

describe("a Twilio retry (the same MessageSid)", () => {
  it("answers duplicate and changes nothing: no prompt advances, no reply, no count", async () => {
    await signUp();
    await send("YES");
    const first = text("0");
    expect(await routerOn().handle(first)).toMatchObject({ action: "ask_delete", replied: true });
    const before = { texts: await texts(), counts: await counts(), prompt: await prompt(), subscribers: await subscribers() };

    // The same message again: were it handled, this 0 would delete the subscription.
    expect(await routerOn().handle(first)).toEqual({ kind: "duplicate" });
    expect(await texts()).toEqual(before.texts);
    expect(await counts()).toEqual(before.counts);
    expect(await prompt()).toEqual(before.prompt);
    expect(await subscribers()).toEqual(before.subscribers);
    // Only a hash of the MessageSid is kept.
    const [seen] = await owner`select sid_hash from inbound_seen where sid_hash = ${createHash("sha256").update(first.messageSid).digest("hex")}`;
    expect(seen).toBeDefined();
    expect(JSON.stringify(await owner`select * from inbound_seen`)).not.toContain(first.messageSid);
  });

  it("of a YES does not make a second welcome, and the purge job forgets message ids after 48 hours", async () => {
    await signUp();
    const yes = text("YES");
    await routerOn().handle(yes);
    expect(await routerOn().handle(yes)).toEqual({ kind: "duplicate" });
    expect(await texts("welcome")).toHaveLength(1);
    expect(await texts("prompt_reply")).toHaveLength(0);

    await owner`update inbound_seen set received_at = received_at - interval '49 hours'`;
    const [job] = await owner`select command, schedule from cron.job where jobname = 'subscriptions-purge-inbound'`;
    expect(job!.schedule).toBe("*/15 * * * *");
    await owner.unsafe(job!.command as string);
    expect(await owner`select 1 from inbound_seen`).toHaveLength(0);
  });
});

describe("deletion", () => {
  /** A subscriber with places, a muted topic, an open prompt, a welcome already submitted and a reply still queued. */
  async function fullSubscriber() {
    await signUp({ places: [{ rsn: RSN, floors: [FLOOR_1, FLOOR_2] }] });
    await send("YES");
    const [subscriber] = await subscribers();
    await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${subscriber!.id}, 'water')`;
    await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    const [welcome] = await texts("welcome");
    expect(welcome!.state).toBe("submitted");
    await send("YES"); // "already signed up", queued
    const [queued] = await texts("prompt_reply");
    return { subscriber: subscriber!, welcome: welcome!, queued: queued! };
  }

  async function expectNothingLeft(subscriberId: string) {
    expect(await subscribers()).toEqual([]);
    expect(await owner`select 1 from subscriber_place where subscriber_id = ${subscriberId}`).toHaveLength(0);
    expect(await owner`select 1 from subscriber_topic_optout where subscriber_id = ${subscriberId}`).toHaveLength(0);
    expect(await owner`select 1 from sms_prompt where subscriber_id = ${subscriberId}`).toHaveLength(0);
    expect(await pendings()).toEqual([]);
    expect(await replies()).toEqual([]);
    // No delivery keeps a reference to the subscriber, and no key names it.
    expect(await owner`select 1 from delivery where recipient_id = ${subscriberId} or idempotency_key like ${`%${subscriberId}%`}`).toHaveLength(0);
  }

  it("on STOP (Twilio's OptOutType): everything held is deleted, queued texts skipped, past texts forget the subscriber, check-ins asked, nothing sent", async () => {
    const { subscriber, welcome, queued } = await fullSubscriber();
    // A pending sign-up for the same number cannot exist beside a subscriber; an inbound_reply row can (a reply the router sent before YES).
    await owner`insert into inbound_reply (id, phone) values (${crypto.randomUUID()}, ${NUMBER})`;
    const before = (await texts()).length;

    expect(await send("STOP", { optOutType: "STOP" })).toEqual({ kind: "handled", keyword: "stop", state: "active", action: "delete", replied: false });

    await expectNothingLeft(subscriber.id as string);
    expect(checkinCalls).toEqual([subscriber.id]);
    expect(await world.rowOf(queued.id as string)).toMatchObject({ state: "skipped", recipient_id: null });
    expect(await world.rowOf(welcome.id as string)).toMatchObject({ state: "submitted", recipient_id: null, idempotency_key: `detached:${welcome.id}` });
    // The app sent nothing of its own: Twilio replied to the STOP.
    expect((await texts()).length).toBe(before);
    expect(await counts()).toMatchObject({ stop: 1 });
    // After deletion nothing can reach the number: a later text is from a number with no state.
    expect(await send("hello")).toMatchObject({ state: "none" });
  });

  it("on STOP typed with no OptOutType too, and on STOP from a number with only a pending sign-up (its confirmation skipped)", async () => {
    await signUp();
    const [confirmation] = await texts("confirmation");
    expect(await send("stop")).toMatchObject({ state: "pending", action: "delete", replied: false });
    expect(await pendings()).toEqual([]);
    expect(await world.rowOf(confirmation!.id as string)).toMatchObject({ state: "skipped", recipient_id: null });
  });

  it("on reply 0: the prompt is sent while the subscriber still exists, a second 0 within 10 minutes deletes and sends nothing more", async () => {
    const { subscriber } = await fullSubscriber();
    expect(await send("0")).toMatchObject({ action: "ask_delete", replied: true });
    expect(await prompt()).toEqual({ subscriber_id: subscriber.id, kind: "delete_confirm" });
    const prompts = (await texts("prompt_reply")).filter((t) => t.body.includes("10"));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.recipient_id).toBe(subscriber.id);
    const before = (await texts()).length;

    expect(await send("0")).toMatchObject({ action: "delete", replied: false });
    await expectNothingLeft(subscriber.id as string);
    expect((await texts()).length).toBe(before);
    // The prompt, queued and never handed off, was skipped with the rest.
    expect((await world.rowOf(prompts[0]!.id as string)).state).toBe("skipped");
  });

  it("on reply 0 typed in Urdu, Bengali, Gujarati or full-width digits, the same", async () => {
    for (const [first, second] of [["۰", "۰"], ["০", "০"], ["૦", "０"]]) {
      await resetAll();
      await signUp();
      await send("YES");
      expect(await send(first!)).toMatchObject({ keyword: "0", action: "ask_delete" });
      expect(await send(second!)).toMatchObject({ keyword: "0", action: "delete" });
      expect(await subscribers(), `${first} ${second}`).toEqual([]);
    }
  });

  it("is cancelled by any other reply, and the prompt runs out after 10 minutes", async () => {
    await signUp();
    await send("YES");
    await send("0");
    expect(await send("thanks")).toMatchObject({ action: "none" });
    expect(await prompt()).toBeNull();
    expect(await send("0")).toMatchObject({ action: "ask_delete" });
    expect((await subscribers()).length).toBe(1);

    await owner`update sms_prompt set sent_at = sent_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'`;
    expect(await send("0")).toMatchObject({ action: "ask_delete" });
    expect((await subscribers()).length).toBe(1);
    // A run-out prompt is also deleted by the purge job.
    await owner`update sms_prompt set sent_at = sent_at - interval '11 minutes', expires_at = expires_at - interval '11 minutes'`;
    const [job] = await owner`select command from cron.job where jobname = 'subscriptions-purge-inbound'`;
    await owner.unsafe(job!.command as string);
    expect(await prompt()).toBeNull();
  });

  it("YES and STOP at the same moment run one after the other and leave no subscriber", async () => {
    await signUp();
    await Promise.all([send("YES"), send("STOP", { optOutType: "STOP" })]);
    expect(await subscribers()).toEqual([]);
    expect(await pendings()).toEqual([]);
  });
});

describe("the reply to a number with no subscription (inbound_reply)", () => {
  it("is sent to the number, which the hand-off takes: the row is deleted in that transaction and the text forgets it", async () => {
    await send("hello");
    const [info] = await texts("signup_info");
    const report = await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    expect(report.submitted).toBe(1);
    expect(world.provider.calls.map((call) => call.to)).toEqual([NUMBER]);
    expect(await replies()).toEqual([]);
    expect(await world.rowOf(info!.id as string)).toMatchObject({ state: "submitted", recipient_id: null });
  });

  it("is skipped at the hand-off when the number texts STOP first: no text, and the row gone", async () => {
    await send("hello");
    const [info] = await texts("signup_info");
    expect(await send("STOP", { optOutType: "STOP" })).toMatchObject({ state: "none", action: "delete" });
    expect(await replies()).toEqual([]);
    await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    expect(world.provider.calls).toEqual([]);
    expect(await world.rowOf(info!.id as string)).toMatchObject({ state: "skipped", recipient_id: null });
  });

  it("is skipped at the hand-off when its 30 minutes pass first: no text, and the purge job deletes the row", async () => {
    await send("hello");
    const [info] = await texts("signup_info");
    await owner`update inbound_reply set created_at = created_at - interval '31 minutes', expires_at = expires_at - interval '31 minutes'`;
    world.clock.advance(31 * 60_000);
    await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    expect(world.provider.calls).toEqual([]);
    expect(await world.stateOf(info!.id as string)).toBe("skipped");
    const [job] = await owner`select command from cron.job where jobname = 'subscriptions-purge-inbound'`;
    await owner.unsafe(job!.command as string);
    expect(await replies()).toEqual([]);
    expect((await world.rowOf(info!.id as string)).recipient_id).toBeNull();
  });
});

describe("the inbound limit (S07.09): more than 20 messages an hour from one number", () => {
  const hashOf = (phone: string, scope = "inbound") => clientHash(KEY, scope, phone);
  /** Puts `n` counted messages from the number `minutesAgo` minutes ago in the limit's table (as if that many had arrived). */
  const seed = (n: number, minutesAgo: number, phone = NUMBER) =>
    owner`insert into rate_limit (scope, client_hash, at) select 'inbound', ${hashOf(phone)}, now() - ${minutesAgo} * interval '1 minute' from generate_series(1, ${n})`;
  const limitedCounts = async () => (await owner`select messages, numbers from inbound_limited_count`).map((row) => ({ messages: row.messages as number, numbers: row.numbers as number }));
  const inboundRows = async (phone = NUMBER) => (await owner`select count(*)::int as n from rate_limit where scope = 'inbound' and client_hash = ${hashOf(phone)}`)[0]!.n as number;

  it("lets the 20th message in an hour through and gives the 21st no reply and no effect, counted only: twenty-one real messages from a subscriber", async () => {
    await signUp();
    await send("YES"); // the 1st: confirms, welcome queued
    for (let i = 2; i <= 20; i++) expect(await send("YES"), `message ${i}`).toMatchObject({ action: "already_signed_up", replied: true });
    expect(await texts("prompt_reply")).toHaveLength(19);
    expect(await limitedCounts()).toEqual([]);
    expect(await inboundRows()).toBe(20);

    // Just over: no reply, no change, only the day's counts.
    expect(await send("YES")).toEqual({ kind: "handled", keyword: "yes", state: "active", action: "rate_limited", replied: false });
    expect(await texts("prompt_reply")).toHaveLength(19);
    expect(await limitedCounts()).toEqual([{ messages: 1, numbers: 1 }]);
    expect(await inboundRows()).toBe(20);
    // Further ones that day: still none, whatever they say, counted; the number is counted once.
    expect(await send("hello")).toMatchObject({ action: "rate_limited", replied: false });
    expect(await send("1")).toMatchObject({ action: "rate_limited", replied: false });
    expect(await limitedCounts()).toEqual([{ messages: 3, numbers: 1 }]);
    expect(await texts("prompt_reply")).toHaveLength(19);
    // The keywords are still counted (the only trace of a body).
    expect(await counts()).toMatchObject({ yes: 21, other: 1, "1": 1 });
  });

  it("is per number: another number is not limited, and a message from a number that is not a subscriber is limited the same way", async () => {
    await seed(20, 5);
    expect(await send("hello")).toMatchObject({ action: "rate_limited", replied: false });
    expect(await send("hello", { from: OTHER })).toMatchObject({ action: "signup_info", replied: true });
    expect(await texts("signup_info")).toHaveLength(1);
    expect(await limitedCounts()).toEqual([{ messages: 1, numbers: 1 }]);
  });

  it("counts a window of an hour: 20 from 59 minutes ago still count, 20 from 61 minutes ago do not", async () => {
    await seed(20, 59);
    expect(await send("hello")).toMatchObject({ action: "rate_limited" });
    await resetAll();
    await seed(20, 61);
    expect(await send("hello")).toMatchObject({ action: "signup_info", replied: true });
    expect(await limitedCounts()).toEqual([]);
  });

  it("holds for the rest of the day (Toronto) once reached, even after the hour has passed, and lifts when the day ends", async () => {
    await seed(20, 5);
    expect(await send("hello")).toMatchObject({ action: "rate_limited" });
    // The hour passes: the number is still muted for the day.
    await owner`update rate_limit set at = at - interval '2 hours' where scope = 'inbound'`;
    expect(await send("hello")).toMatchObject({ action: "rate_limited" });
    expect(await limitedCounts()).toEqual([{ messages: 2, numbers: 1 }]);
    // The day ends: the mute row is from yesterday in Toronto and no longer binds.
    await owner`update rate_limit set at = (date_trunc('day', now() at time zone 'America/Toronto') at time zone 'America/Toronto') - interval '1 minute' where scope = 'inbound_mute'`;
    expect(await send("hello")).toMatchObject({ action: "signup_info", replied: true });
    expect(await limitedCounts()).toEqual([{ messages: 2, numbers: 1 }]);
  });

  it("is decided after deletion: STOP, the second 0 and Twilio's opt-out events are neither counted nor limited by a number over the limit", async () => {
    await signUp({ places: [{ rsn: RSN, floors: [FLOOR_1] }] });
    await send("YES");
    await send("0"); // the deletion's prompt is open
    await seed(20, 5);
    await owner`update rate_limit set at = at - interval '1 minute' where scope = 'inbound'`;
    expect(await send("hello")).toMatchObject({ action: "rate_limited" });
    const before = await inboundRows();
    // The prompt is still open (a limited message changes nothing): the second 0 deletes.
    expect(await send("0")).toMatchObject({ action: "delete", replied: false });
    expect(await subscribers()).toEqual([]);
    expect(await inboundRows()).toBe(before);

    // START and HELP (Twilio's) and STOP typed without an OptOutType are not limited either.
    await resetAll();
    await signUp();
    await send("YES");
    await seed(19, 5);
    expect(await send("hello")).toMatchObject({ action: "rate_limited" });
    expect(await send("help", { optOutType: "HELP" })).toMatchObject({ keyword: "help", action: "none" });
    expect(await send("START", { optOutType: "START" })).toMatchObject({ keyword: "start", action: "none" });
    expect(await send("STOP")).toMatchObject({ action: "delete", replied: false });
    expect(await subscribers()).toEqual([]);
    expect(await limitedCounts()).toEqual([{ messages: 1, numbers: 1 }]);
  });

  it("keeps only keyed hashes and counts: no number or message in rate_limit or inbound_limited_count", async () => {
    await seed(20, 5);
    await send("my unit is 1204 call me");
    await send("again");
    const stored = JSON.stringify({ limit: await owner`select * from rate_limit where scope like 'inbound%'`, counts: await owner`select * from inbound_limited_count` });
    for (const needle of ["5550123", "1204", "again"]) expect(stored, needle).not.toContain(needle);
    expect(stored).toContain(hashOf(NUMBER));
    expect(routerLines.map((line) => JSON.stringify(line))).toContain(JSON.stringify({ evt: "inbound.handled", fields: { keyword: "other", state: "none", action: "rate_limited", replied: false } }));
    expect(JSON.stringify(routerLines)).not.toContain("5550123");
  });
});

describe("the rate-limit hashes (job)", () => {
  it("are deleted after 24 hours by the purge job, whether or not any request comes in, and the newer ones stay", async () => {
    const hash = clientHash(KEY, "search", "203.0.113.9");
    await owner`insert into rate_limit (scope, client_hash, at) values ('search', ${hash}, now() - interval '25 hours'), ('inbound', ${hash}, now() - interval '24 hours 1 minute'),
                  ('signup', ${hash}, now() - interval '23 hours 59 minutes'), ('inbound_mute', ${hash}, now())`;
    const [job] = await owner`select command, schedule from cron.job where jobname = 'subscriptions-purge-rate-limit'`;
    expect(job!.schedule).toBe("7 * * * *");
    await owner.unsafe(job!.command as string);
    expect((await owner`select scope from rate_limit where client_hash = ${hash} order by scope`).map((row) => row.scope)).toEqual(["inbound_mute", "signup"]);
    await owner`delete from rate_limit where client_hash = ${hash}`;
  });
});

describe("the webhook's signature", () => {
  it("refused, records webhook.signature_invalid for twilio_inbound in ops_event, with no number, and handles nothing", async () => {
    const webhook = createInboundWebhook({
      authToken: TOKEN,
      publicBaseUrl: BASE_URL,
      router: routerOn(),
      recordSignatureFailure: (reason) => opsRecorder.record(app, { kind: "webhook.signature_invalid", detail: { route: "twilio_inbound", reason } }),
    });
    const form = { MessageSid: nextSid(), From: NUMBER, Body: "YES" };
    const body = new URLSearchParams(form).toString();
    expect(await webhook.handle({ signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAA=", search: "", body })).toEqual({ kind: "rejected", reason: "signature_mismatch" });
    const [event] = await owner`select kind, detail from ops_event where kind = 'webhook.signature_invalid'`;
    expect(event!.detail).toEqual({ route: "twilio_inbound", reason: "signature_mismatch" });
    expect(await counts()).toEqual({});

    const signed = getExpectedTwilioSignature(TOKEN, `${BASE_URL}/api/twilio/inbound`, form);
    expect(await webhook.handle({ signature: signed, search: "", body })).toMatchObject({ kind: "handled", keyword: "yes" });
  });
});

describe("privacy", () => {
  it("keeps no number and no message text in any log line, audit record, ops_event or delivery, through a whole life: sign-up, YES, 0, 0", async () => {
    const SECRET = "my unit is 1204 call me";
    await signUp();
    await send("YES");
    await send(SECRET);
    await send("0");
    await world.dispatcher({ resolver: wireContactResolver(ownerSources(), world.log) }).run();
    await send("0");
    await send("hello", { from: OTHER });
    await send("STOP", { optOutType: "STOP", from: OTHER });
    const everything = await whereNumbersMustNeverBe();
    for (const needle of ["5550123", "5550145", SECRET]) expect(everything, needle).not.toContain(needle);
    // The keyword counts are all that is left of the texts.
    expect(await counts()).toEqual({ yes: 1, other: 2, "0": 2, stop: 1 });
  });
});
