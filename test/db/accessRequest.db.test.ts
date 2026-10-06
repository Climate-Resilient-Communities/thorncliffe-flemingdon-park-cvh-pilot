// A resident's access request against a real database (S09.03, E09 "Access request"), as the app's own role (cvh_app_login), which is what
// scripts/access-request connects as:
//  - a request is two audit records with the Admin as the actor and the request as the subject, holding no number; only an active Admin can be named;
//  - the lookup shows everything held for a number (subscriber, places, groups, muted topics, consent version, retention state, prompt, S07.06's edit link
//    (never its hash); a pending sign-up; a waiting reply; the texts, never their words; the keyed hashes of the number under every scope, the inbound
//    limit's mute row and S07.05's menu limit included; where the resident is in a text menu (S07.05); the end of the pilot's question and its text
//    (S09.07); S08.05's check-in request and the check-in rows that name the subscriber), in a transaction Postgres keeps read-only, and only for an open
//    request; a column or a table added since that holds a
//    number's records, or a prompt's step it cannot read, is reported as not read, so a request is never answered as complete without it;
//  - the deletion on the resident's behalf is the full E07 deletion (the one STOP, the edit page and the end-of-pilot purge run) and closes the request in
//    the same transaction, a subscriber being asked at the end of the pilot included, their check-in rows closed into stubs by checkins' real port (S08.05);
//    a failed audit record undoes the deletion; a `checkin` table with E08's port not wired refuses it; a request is closed once, even by two runs at once;
//  - the weekly review (S09.04's `weekly_review`, and scripts/export-weekly's CSV) flags a request open longer than 25 days, a rehearsal's apart, and the
//    script's own output and the audit trail never hold the number.
// Every number is fictional (555-01xx). Nothing reaches Twilio: no text is sent.
import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runAccessRequest } from "../../scripts/subscriptions/access-request";
import { runExportWeekly } from "../../scripts/ops/export-weekly";
import { migrate } from "../../scripts/db/migrate.mjs";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { roundThreads } from "../../src/modules/alerting";
import { record, recordRefusal } from "../../src/modules/audit";
import { createCheckinRequests } from "../../src/modules/checkins";
import { createAssignments } from "../../src/modules/identity";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { readWeeklyReview } from "../../src/modules/ops";
import { floorsOfBuilding, listBuildings, neighbourhoodIds } from "../../src/modules/places";
import {
  MENU_SCOPE,
  checkinRequestStore,
  checkinRowRecords,
  createAccessRequests,
  createCampaigns,
  createInboundRouter,
  createMenus,
  createRateLimiter,
  createSignup,
  heldRecordLines,
  noCheckinsYet,
  subscriberLookup,
  type AccessRequestDeps,
  type InboundMessage,
} from "../../src/modules/subscriptions";
import { accessRequestStore } from "../../src/modules/subscriptions/adapters/accessRequestStore";
import { INBOUND_LIMIT } from "../../src/modules/subscriptions/domain/inbound";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let auditBaseline = 0;

const VERSION = "2026-10-02.1";
const RSN = "9100031";
const FLOOR_1 = "0190f000-0000-7000-8000-000000000031";
const FLOOR_2 = "0190f000-0000-7000-8000-000000000032";
const NUMBER = "+14165550131";
const TYPED = "(416) 555-0131";
const OTHER = "+14165550132";
const KEY = "a-test-key-for-the-number-hashes";

const staff: Record<"admin" | "admin2" | "coordinator" | "suspended", { id: string; username: string }> = {
  admin: { id: randomUUID(), username: `ar_admin_${randomBytes(3).toString("hex")}` },
  admin2: { id: randomUUID(), username: `ar_admin2_${randomBytes(3).toString("hex")}` },
  coordinator: { id: randomUUID(), username: `ar_coord_${randomBytes(3).toString("hex")}` },
  suspended: { id: randomUUID(), username: `ar_susp_${randomBytes(3).toString("hex")}` },
};
const checkinCalls: string[] = [];
let sid = 0;

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
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', '31 Sample Road', 43.7, -79.34, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_1}, ${RSN}, '1', 1, true), (${FLOOR_2}, ${RSN}, '2', 2, true) on conflict do nothing`;
  for (const [role, account] of Object.entries(staff)) {
    await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, status)
                values (${account.id}, ${randomUUID()}, ${account.username}, 'Test', ${role}, 'test@example.org',
                        ${role === "coordinator" ? "coordinator" : "admin"}, false, ${role === "suspended" ? "suspended" : "active"})`;
  }
});

async function resetAll() {
  await owner`delete from checkin`;
  await owner`delete from checkin_tally`;
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_reply`;
  await owner`delete from inbound_seen`;
  await owner`delete from rate_limit where scope in ('signup', 'signup_info', 'inbound', 'inbound_mute', ${MENU_SCOPE})`;
  // A campaign's texts name it, and it names the Admin who started it from a session: they go before the Admin's account.
  await owner`delete from delivery`;
  await owner`delete from campaign_purge`;
  await owner`delete from campaign`;
  await owner`delete from staff_session where staff_account_id = ${staff.admin.id}`;
  await world.reset();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  // What a test adds as a later story might (the real `checkin` table and the check-in request's columns are S08.05's and stay).
  await owner`drop table if exists checkin_request`;
  await owner`alter table subscriber drop column if exists preferred_name`;
  await owner`alter table if exists subscription_edit_token drop column if exists sent_to`;
  checkinCalls.length = 0;
}

beforeEach(resetAll);

afterAll(async () => {
  await resetAll();
  for (const account of Object.values(staff)) await owner`delete from staff_account where id = ${account.id}`;
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

/**
 * The use case as scripts/access-request composes it: checkins' real ports (S08.05, as src/app/checkins.ts composes them), the deletions they are asked for
 * recorded, and checkins' reader of the rows that name a subscriber.
 */
function requests(over: Partial<AccessRequestDeps> = {}) {
  const checkins = createCheckinRequests({
    requests: checkinRequestStore(),
    threads: roundThreads,
    coversFloor: (rsn, floorId, executor) => createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } }).coversFloor(rsn, floorId, executor),
  });
  return createAccessRequests({
    db: app,
    numberKey: () => KEY,
    checkins: {
      lockRounds: (id, tx) => checkins.lockRounds(id, tx),
      deleteForSubscriber: async (id, tx) => {
        checkinCalls.push(id);
        await checkins.deleteForSubscriber(id, tx);
      },
    },
    checkinRecords: checkinRowRecords,
    ...over,
  });
}

/** The router as src/app/inbound.ts composes it (the welcome, STOP, the sign-up link and S07.05's text menus go through it). */
function router() {
  const queue = createDeliveryQueue();
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    menus: createMenus({
      enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
      pricePerSegmentCents: () => 1.5,
      // places' real readers, the list kept to this file's building (other files' buildings may be in the database).
      places: { buildings: async (tx) => (await listBuildings(tx)).filter((building) => building.rsn === RSN), floorsOf: (tx, rsn, options) => floorsOfBuilding(tx, rsn, options) },
    }),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
  });
}

/** S09.07's campaign as the Hub starts it: an Admin at aal2 rehearses it on the drill roster, then starts it; every active subscriber is asked. */
async function campaignStarted() {
  const session = randomBytes(32).toString("hex");
  await owner`insert into staff_session (id, staff_account_id, created_at, last_seen_at, revoked_at, aal2_at) values (${session}, ${staff.admin.id}, now(), now(), null, now())`;
  await world.fx.rosterMember();
  const queue = createDeliveryQueue();
  const campaigns = createCampaigns({
    db: app,
    enqueue: (tx, input) => queue.enqueueCampaignDelivery(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    termsVersion: () => "2026-11-02.2",
    pricePerSegmentCents: () => 1.5,
    audit: { record, recordRefusal } as never,
  });
  const [{ day }] = await owner`select ((now() at time zone 'America/Toronto')::date + 30)::text as day`;
  const input = { actorStaffId: staff.admin.id, sessionId: session, deadlineSeen: day as string };
  expect(await campaigns.rehearse({ ...input, idempotencyKey: randomUUID() })).toMatchObject({ kind: "rehearsed" });
  const started = await campaigns.start({ ...input, idempotencyKey: randomUUID(), confirmed: true });
  if (started.kind !== "started") throw new Error(`start refused: ${JSON.stringify(started)}`);
  return started;
}

/** Production's environment as the script requires it (nothing connects with it: the tests give the script their own connection). */
const PRODUCTION_ENV = {
  VERCEL_ENV: "production",
  SMS_MODE: "live",
  PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
  DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};

const inbound = (body: string, from = NUMBER): InboundMessage => ({ messageSid: `SM${(++sid).toString(16).padStart(32, "0")}`, from, body, optOutType: null });

async function signUp(phone = NUMBER) {
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
  const outcome = await signup.request(
    { phone, lang: "ur" as never, neighbourhood: "TP", places: [{ rsn: RSN, floors: [FLOOR_2] }], groups: ["seniors"], consentVersion: VERSION },
    `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
  );
  expect(outcome).toEqual({ kind: "accepted" });
}

/** A subscriber made the way residents become one: the web sign-up, then YES; a muted topic and an open "reply 0 again" prompt besides. */
async function subscribed() {
  await signUp();
  await router().handle(inbound("YES"));
  const [row] = await owner`select id from subscriber where phone = ${NUMBER}`;
  await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${row!.id}, 'power')`;
  await router().handle(inbound("0"));
  return row!.id as string;
}

/** An edit link of the subscriber in S07.06's table (only its hash is kept); `minutesAgo` 31 makes one that has run out. Returns the hash. */
async function editLink(subscriberId: string, minutesAgo = 0): Promise<string> {
  const hash = randomBytes(32).toString("hex");
  await owner`insert into subscription_edit_token (id, subscriber_id, token_hash, created_at, expires_at)
              values (${randomUUID()}, ${subscriberId}, ${hash}, now() - make_interval(mins => ${minutesAgo}), now() - make_interval(mins => ${minutesAgo}) + interval '30 minutes')`;
  return hash;
}

/** S08.05's check-in request on the subscriber (by id) or on the number's pending sign-up: by a call, where the resident lives on floor 2. */
async function withCheckinRequest(table: "subscriber" | "pending_signup", key: string) {
  const request = owner`checkin_method = 'call', checkin_consent_version = ${CHECKIN_CONSENT_VERSION}, where_i_live_rsn = ${RSN}, where_i_live_floor_id = ${FLOOR_2}`;
  if (table === "subscriber") await owner`update subscriber set ${request} where id = ${key}`;
  else await owner`update pending_signup set ${request} where phone = ${key}`;
}

const auditRows = () => owner`select action, actor_staff_id, subject_type, subject_id, outcome, is_drill, meta from audit_event where id > ${auditBaseline} order by id`;

async function received(request: "access" | "correction" | "deletion" = "access", admin = staff.admin.username, rehearsal = false) {
  const result = await requests().receive({ admin, request, rehearsal });
  if (!result.ok) throw new Error(result.error);
  return result.value.id;
}

describe("a request in the audit trail", () => {
  it("is recorded with the Admin as the actor and the request as the subject, and nothing about the resident", async () => {
    const id = await received("deletion");

    expect(await auditRows()).toEqual([
      { action: "access_request.received", actor_staff_id: staff.admin.id, subject_type: "access_request", subject_id: id, outcome: "ok", is_drill: false, meta: { request: "deletion" } },
    ]);
  });

  it("finds the Admin by username as sign-in does, in any case", async () => {
    const result = await requests().receive({ admin: ` ${staff.admin.username.toUpperCase()} `, request: "access" });

    expect(result.ok).toBe(true);
    expect((await auditRows()).map((row) => row.actor_staff_id)).toEqual([staff.admin.id]);
  });

  it("counts the days open by the database's clock, not the clock of the computer IT runs it on", async () => {
    const id = await received();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 40 * 86_400_000);
      expect((await requests().open()).map((r) => [r.id, r.daysOpen, r.flagged])).toEqual([[id, 0, false]]);
      expect(await requests().close({ id, admin: staff.admin.username, outcome: "answered" })).toEqual({ ok: true, value: { daysOpen: 0 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is handled by an active Admin only, and a refusal records nothing", async () => {
    expect(await requests().receive({ admin: staff.coordinator.username, request: "access" })).toEqual({ ok: false, error: "not_admin" });
    expect(await requests().receive({ admin: staff.suspended.username, request: "access" })).toEqual({ ok: false, error: "admin_not_active" });
    expect(await requests().receive({ admin: "nobody_here", request: "access" })).toEqual({ ok: false, error: "no_such_admin" });
    expect(await auditRows()).toEqual([]);
  });

  it("is listed while open, oldest first, with the Admin's name, and leaves the list once closed", async () => {
    const first = await received("access");
    const second = await received("correction", staff.admin2.username, true);

    const open = await requests().open();
    expect(open.map((r) => [r.id, r.request, r.receivedByName, r.rehearsal, r.daysOpen, r.flagged])).toEqual([
      [first, "access", "Test admin", false, 0, false],
      [second, "correction", "Test admin2", true, 0, false],
    ]);

    expect(await requests().close({ id: first, admin: staff.admin2.username, outcome: "answered" })).toEqual({ ok: true, value: { daysOpen: 0 } });
    expect((await requests().open()).map((r) => r.id)).toEqual([second]);
    const rows = await auditRows();
    expect(rows.at(-1)).toEqual({ action: "access_request.closed", actor_staff_id: staff.admin2.id, subject_type: "access_request", subject_id: first, outcome: "ok", is_drill: false, meta: { outcome: "answered" } });
    // A rehearsal's request is closed as a rehearsal too, so the review keeps it apart.
    await requests().close({ id: second, admin: staff.admin.username, outcome: "withdrawn" });
    expect((await auditRows()).at(-1)).toMatchObject({ subject_id: second, is_drill: true, meta: { outcome: "withdrawn" } });
  });

  it("is closed once: a second close, a deletion after it and an unknown id are refused and record nothing", async () => {
    const id = await received();
    await requests().close({ id, admin: staff.admin.username, outcome: "not_verified" });
    const before = (await auditRows()).length;

    expect(await requests().close({ id, admin: staff.admin.username, outcome: "answered" })).toEqual({ ok: false, error: "closed" });
    expect(await requests().deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toEqual({ ok: false, error: "closed" });
    expect(await requests().close({ id: randomUUID(), admin: staff.admin.username, outcome: "answered" })).toEqual({ ok: false, error: "not_found" });
    expect(await requests().close({ id, admin: staff.coordinator.username, outcome: "answered" })).toEqual({ ok: false, error: "not_admin" });
    await expect(requests().close({ id, admin: staff.admin.username, outcome: "deleted" as never })).rejects.toThrow(/not an outcome/);
    expect((await auditRows()).length).toBe(before);
  });

  it("is closed exactly once when two runs close it at the same time", async () => {
    const id = await received();
    const results = await Promise.all([
      requests().close({ id, admin: staff.admin.username, outcome: "answered" }),
      requests().close({ id, admin: staff.admin2.username, outcome: "withdrawn" }),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: "closed" }]);
    expect((await auditRows()).filter((row) => row.action === "access_request.closed")).toHaveLength(1);
  });
});

describe("the lookup", () => {
  it("shows everything held for a subscriber, with no message words, for an open request", async () => {
    const id = await received();
    const subscriberId = await subscribed();
    const tokenHash = await editLink(subscriberId);
    // The inbound limit (S07.09) counted a text from the number, which leaves a keyed hash of it in rate_limit.
    const result = await requests().lookUp({ id, number: TYPED });
    if (!result.ok) throw new Error(result.error);
    const held = result.value;

    expect(held.maskedNumber).toBe("+1 ••• ••• 0131");
    expect(held.subscriber).toMatchObject({
      lang: "ur",
      neighbourhood: "Thorncliffe Park (TP)",
      groups: ["seniors"],
      consentVersion: VERSION,
      startedBy: "web",
      retentionState: "active",
      places: [{ rsn: RSN, address: "31 Sample Road", floor: "2" }],
      mutedTopics: ["power"],
      prompt: { kind: "delete_confirm" },
      editLink: { expired: false, usedAt: null },
    });
    expect(held.pending).toBeNull();
    expect(held.texts.map((t) => [t.kind, t.purpose, t.lang])).toEqual([
      ["transactional", "welcome", "ur"],
      ["transactional", "prompt_reply", "ur"],
    ]);
    expect(held.hashes.map((h) => [h.scope, h.count])).toEqual([["inbound", 1]]);
    expect(held.subscriber!.checkinRequest).toBeNull();
    expect(held.checkins).toEqual({ kind: "rows", rows: [] });
    // Every column and table that holds a subscriber's records is read, S07.06's edit links included: a story that adds one adds it to the lookup
    // (accessRequestStore's LOOKUP_COLUMNS).
    expect(held.unread).toEqual([]);
    // The confirmation went to the pending sign-up, which YES deleted: its text forgot it (AD-8), so it is not the subscriber's.
    const bodies = (await owner`select body from delivery`).map((row) => row.body as string);
    expect(bodies.length).toBeGreaterThan(0);
    const shown = JSON.stringify(held);
    for (const body of bodies) expect(shown).not.toContain(body);
    expect(shown).not.toContain("5550131");
    expect(shown).not.toContain(tokenHash);
  });

  it("shows an edit link that was used, and one that has run out and waits for the purge", async () => {
    const id = await received();
    const subscriberId = await subscribed();
    await editLink(subscriberId, 31);

    expect(await requests().lookUp({ id, number: NUMBER })).toMatchObject({ ok: true, value: { subscriber: { editLink: { expired: true, usedAt: null } }, unread: [] } });

    await owner`delete from subscription_edit_token`;
    await editLink(subscriberId);
    await owner`update subscription_edit_token set used_at = now()`;
    const used = await requests().lookUp({ id, number: NUMBER });
    expect(used).toMatchObject({ ok: true, value: { subscriber: { editLink: { expired: false, usedAt: expect.any(Date) } } } });
  });

  it("shows where the resident is in a text menu (S07.05) and the menu limit's keyed hash, and reports a step it cannot read", async () => {
    const id = await received();
    await signUp();
    await router().handle(inbound("YES"));
    // Reply 1, the building menu: the one street, then the one building on it; the floor is not chosen yet.
    for (const reply of ["1", "1", "1"]) await router().handle(inbound(reply));

    const result = await requests().lookUp({ id, number: NUMBER });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.subscriber?.prompt).toMatchObject({ kind: "menu_building", step: "choosing a floor of 31 Sample Road (register number 9100031)" });
    expect(result.value.hashes.map((h) => [h.scope, h.count]).sort()).toEqual([
      ["inbound", 4],
      [MENU_SCOPE, 1],
    ]);
    expect(result.value.unread).toEqual([]);

    // A step the lookup cannot read (a kind it does not know that keeps one, or a menu's that is not one) is not shown and is said to be not read.
    await owner`update sms_prompt set kind = 'some_new_prompt'`;
    const unknown = await requests().lookUp({ id, number: NUMBER });
    expect(unknown).toMatchObject({ ok: true, value: { subscriber: { prompt: { kind: "some_new_prompt", step: null } }, unread: ["sms_prompt.step (a step this script cannot read)"] } });
  });

  it("shows a subscriber asked at the end of the pilot (S09.07): the retention state, the question until the deadline, its text", async () => {
    const id = await received();
    const subscriberId = await subscribed();
    const started = await campaignStarted();

    const result = await requests().lookUp({ id, number: NUMBER });
    if (!result.ok) throw new Error(result.error);
    const [{ deadline }] = await owner`select deadline from campaign where id = ${started.campaign.id}`;
    expect(result.value.subscriber).toMatchObject({ retentionState: "reconsent_pending", consentVersion: VERSION, prompt: { kind: "reconsent", until: deadline, step: null } });
    expect(result.value.texts.map((t) => [t.kind, t.purpose, t.lang])).toContainEqual(["campaign", "reconsent", "ur"]);
    expect(result.value.unread).toEqual([]);
    const shown = JSON.stringify(result.value);
    for (const row of await owner`select body from delivery where recipient_id = ${subscriberId}`) expect(shown).not.toContain(row.body as string);
  });

  it("shows a pending sign-up, and a reply waiting for a number with no subscription", async () => {
    const id = await received();
    await signUp();
    await router().handle(inbound("hello", OTHER));

    const pending = await requests().lookUp({ id, number: NUMBER });
    expect(pending).toMatchObject({ ok: true, value: { subscriber: null, pending: { lang: "ur", expired: false, places: [{ rsn: RSN, floor: "2" }], consentVersion: VERSION } } });
    if (pending.ok) expect(pending.value.texts.map((t) => t.purpose)).toEqual(["confirmation"]);

    const other = await requests().lookUp({ id, number: OTHER });
    expect(other).toMatchObject({ ok: true, value: { subscriber: null, pending: null } });
    if (other.ok) {
      expect(other.value.replies).toHaveLength(1);
      expect(other.value.texts.map((t) => t.purpose)).toEqual(["signup_info"]);
      expect(other.value.hashes.map((h) => h.scope).sort()).toEqual(["inbound", "signup_info"]);
    }
  });

  it("finds the inbound limit's mute row, which holds the hash of the counted messages, as well as the counted messages", async () => {
    const id = await received();
    // More than 20 texts in an hour from a number with no subscription: the 21st mutes it for the rest of the day.
    for (let n = 0; n <= INBOUND_LIMIT.perHour; n++) await router().handle(inbound("hello", OTHER));
    expect(await owner`select 1 from rate_limit where scope = 'inbound_mute'`).toHaveLength(1);

    const result = await requests().lookUp({ id, number: OTHER });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.hashes.map((h) => [h.scope, h.count]).sort()).toEqual([
      ["inbound", INBOUND_LIMIT.perHour],
      ["inbound_mute", 1],
      ["signup_info", 1],
    ]);
    // Another number's lookup finds none of them.
    const other = await requests().lookUp({ id, number: NUMBER });
    expect(other).toMatchObject({ ok: true, value: { hashes: [] } });
  });

  it("reports a column or a table added since that holds a number's records, and never calls the record complete or empty", async () => {
    const id = await received();
    await subscribed();
    await signUp(OTHER);
    // As a later story might add them: a column on the subscriber, a table of requests that refers to the subscriber, and a column of an edit link.
    await owner`alter table subscriber add column preferred_name text`;
    await owner`create table checkin_request (id uuid primary key, subscriber_id uuid not null references subscriber (id) on delete cascade)`;
    await owner`alter table subscription_edit_token add column sent_to text`;

    const result = await requests().lookUp({ id, number: NUMBER });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.unread).toEqual(["subscriber.preferred_name", "subscription_edit_token.sent_to", "the table checkin_request (it refers to subscriber)"]);
    // A number with only a pending sign-up holds nothing in either.
    expect(await requests().lookUp({ id, number: OTHER })).toMatchObject({ ok: true, value: { unread: [] } });

    // The script says so on screen.
    const out: string[] = [];
    const code = await runAccessRequest(["show", "--id", id, "--verified-control"], {
      env: PRODUCTION_ENV,
      out: (line) => out.push(line),
      error: (line) => out.push(line),
      prompt: async () => TYPED,
      isTerminal: () => true,
      connect: () => ({ requests: requests(), close: async () => {} }),
    });
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(
      "NOT SHOWN: THE CVH HOLDS MORE FOR THIS NUMBER THAN THIS SCRIPT CAN READ YET (subscriber.preferred_name; subscription_edit_token.sent_to; the table checkin_request (it refers to subscriber))",
    );
  });

  it("finds nothing for a number the CVH does not hold, and refuses a closed or unknown request and a number that is not Canadian", async () => {
    const id = await received();
    expect(await requests().lookUp({ id, number: "+14165550199" })).toMatchObject({ ok: true, value: { subscriber: null, pending: null, replies: [], texts: [], hashes: [] } });
    expect(await requests().lookUp({ id, number: "+12025550123" })).toEqual({ ok: false, error: "not_canadian" });
    expect(await requests().lookUp({ id: randomUUID(), number: NUMBER })).toEqual({ ok: false, error: "not_found" });
    await requests().close({ id, admin: staff.admin.username, outcome: "answered" });
    expect(await requests().lookUp({ id, number: NUMBER })).toEqual({ ok: false, error: "closed" });
  });

  it("runs in a transaction Postgres keeps read-only", async () => {
    const id = await received();
    await subscribed();
    // A store that tries to write in the middle of the lookup: Postgres refuses it, and the lookup fails with nothing changed.
    const writing: typeof accessRequestStore = {
      ...accessRequestStore,
      subscriberOf: async (executor, phone) => {
        await executor.execute(sql`delete from subscriber`);
        return accessRequestStore.subscriberOf(executor, phone);
      },
    };

    const failure = (await requests({ store: writing }).lookUp({ id, number: NUMBER }).catch((error: unknown) => error)) as { cause?: { code?: string; message?: string } };
    expect(failure.cause).toMatchObject({ code: "25006", message: expect.stringMatching(/read-only transaction/) });
    expect(await owner`select id from subscriber`).toHaveLength(1);
  });

  it("reports the check-in table as unreadable where checkins' reader is not wired, so a request is never answered as complete while one goes unread", async () => {
    const id = await received();
    await subscribed();

    const result = await requests({ checkinRecords: undefined }).lookUp({ id, number: NUMBER });
    expect(result).toMatchObject({ ok: true, value: { checkins: { kind: "unreadable" } } });

    const wired = await requests().lookUp({ id, number: NUMBER });
    expect(wired).toMatchObject({ ok: true, value: { checkins: { kind: "rows", rows: [] } } });
  });

  it("shows S08.05's check-in request, on the subscriber and on a pending sign-up, and the check-in rows that name the subscriber, never a stub", async () => {
    const id = await received();
    const subscriberId = await subscribed();
    await withCheckinRequest("subscriber", subscriberId);
    const thread = (await world.fx.entry("approved", { types: ["heat"], kind: "update" })).alertId;
    const closed = (await world.fx.entry("approved", { types: ["power"], kind: "update" })).alertId;
    await owner`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${thread}, ${subscriberId}, ${RSN}, ${FLOOR_2}, 'call'),
                (${randomUUID()}, ${closed}, ${subscriberId}, ${RSN}, ${FLOOR_2}, 'call')`;
    // A row that has left its round is a stub that names no one: it is not the resident's.
    await owner`update checkin set outcome = 'withdrawn', tallied_at = now(), subscriber_id = null, method = null, closed_at = now() where alert_id = ${closed}`;
    await signUp(OTHER);
    await withCheckinRequest("pending_signup", OTHER);

    const result = await requests().lookUp({ id, number: NUMBER });
    if (!result.ok) throw new Error(result.error);
    const request = { method: "call", consentVersion: CHECKIN_CONSENT_VERSION, place: { rsn: RSN, address: "31 Sample Road", floor: "2" } };
    expect(result.value.subscriber!.checkinRequest).toEqual(request);
    expect(result.value.checkins).toEqual({
      kind: "rows",
      rows: [{ at: expect.any(Date), description: `in the check-in round of alert thread ${thread}, at 31 Sample Road (register number 9100031), floor 2, by a call: not checked on yet` }],
    });
    expect(result.value.unread).toEqual([]);
    const lines = heldRecordLines(result.value).join("\n");
    expect(lines).toContain(
      `  Check-in request (an ambassador on the floor sees the number and the floor): by a call, where I live: 31 Sample Road (register number 9100031), floor 2; check-in consent version ${CHECKIN_CONSENT_VERSION}`,
    );
    expect(lines).toContain("Check-in records (1):");

    const pending = await requests().lookUp({ id, number: OTHER });
    expect(pending).toMatchObject({ ok: true, value: { pending: { checkinRequest: request }, checkins: { kind: "rows", rows: [] }, unread: [] } });
  });
});

describe("the deletion on the resident's behalf", () => {
  it("is the full E07 deletion, and closes the request as deleted in the same transaction", async () => {
    const id = await received("deletion");
    const subscriberId = await subscribed();
    await editLink(subscriberId);
    await withCheckinRequest("subscriber", subscriberId);
    const round = (await world.fx.entry("approved", { types: ["heat"], kind: "update" })).alertId;
    await owner`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${round}, ${subscriberId}, ${RSN}, ${FLOOR_2}, 'call')`;
    await signUp(OTHER);
    // The welcome and the "reply 0 again" prompt are still queued (nothing sends in this test): the deletion stops them.
    const waiting = (await owner`select id from delivery where recipient_kind = 'subscriber' and recipient_id = ${subscriberId} and state = 'queued'`).map((row) => row.id as string);
    expect(waiting).toHaveLength(2);

    const result = await requests().deleteForResident({ id, number: NUMBER, admin: staff.admin2.username });

    expect(result).toEqual({ ok: true, value: { subscriber: true, pendingSignup: false, inboundReplies: 0, skippedTexts: 2, daysOpen: 0 } });
    expect((await owner`select state from delivery where id = any(${waiting})`).map((row) => row.state)).toEqual(["skipped", "skipped"]);
    expect(await owner`select 1 from subscriber`).toHaveLength(0);
    expect(await owner`select 1 from subscriber_place`).toHaveLength(0);
    expect(await owner`select 1 from subscriber_topic_optout`).toHaveLength(0);
    expect(await owner`select 1 from sms_prompt`).toHaveLength(0);
    expect(await owner`select 1 from subscription_edit_token`).toHaveLength(0);
    expect(checkinCalls).toEqual([subscriberId]);
    // checkins' real port closed the resident's check-in row into a stub, tallied once (S08.05).
    expect(await owner`select subscriber_id, method, outcome, closed_at is not null as closed from checkin where alert_id = ${round}`).toEqual([
      { subscriber_id: null, method: null, outcome: "withdrawn", closed: true },
    ]);
    // Every text of the subscriber forgot them (AD-8): none names the deleted id any more.
    expect(await owner`select 1 from delivery where recipient_id = ${subscriberId}`).toHaveLength(0);
    // The other number is untouched.
    expect(await owner`select 1 from pending_signup where phone = ${OTHER}`).toHaveLength(1);
    expect((await auditRows()).at(-1)).toEqual({
      action: "access_request.closed",
      actor_staff_id: staff.admin2.id,
      subject_type: "access_request",
      subject_id: id,
      outcome: "ok",
      is_drill: false,
      meta: { outcome: "deleted" },
    });
  });

  it("deletes a subscriber being asked at the end of the pilot as STOP would, and their campaign text forgets them", async () => {
    const id = await received("deletion");
    const subscriberId = await subscribed();
    await campaignStarted();
    expect(await owner`select 1 from delivery where kind = 'campaign' and recipient_id = ${subscriberId}`).toHaveLength(1);

    expect(await requests().deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toMatchObject({ ok: true, value: { subscriber: true } });
    expect(await owner`select 1 from subscriber`).toHaveLength(0);
    expect(await owner`select 1 from sms_prompt`).toHaveLength(0);
    expect(await owner`select 1 from delivery where recipient_id = ${subscriberId}`).toHaveLength(0);
    expect((await owner`select state from delivery where kind = 'campaign' and recipient_kind = 'subscriber'`).map((row) => row.state)).toEqual(["skipped"]);
  });

  it("deletes a pending sign-up and the waiting replies of a number too", async () => {
    const id = await received("deletion");
    await router().handle(inbound("hello"));
    await signUp();

    expect(await requests().deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toMatchObject({ ok: true, value: { subscriber: false, pendingSignup: true, inboundReplies: 1 } });
    expect(await owner`select 1 from pending_signup`).toHaveLength(0);
    expect(await owner`select 1 from inbound_reply`).toHaveLength(0);
  });

  it("is refused while a check-in table exists and E08's deletion port is not wired, before deleting or recording anything", async () => {
    const id = await received("deletion");
    await subscribed();
    const before = (await auditRows()).length;

    expect(await requests({ checkins: undefined }).deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toEqual({ ok: false, error: "checkins_not_wired" });
    expect(await requests({ checkins: noCheckinsYet }).deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toEqual({ ok: false, error: "checkins_not_wired" });
    expect(await owner`select 1 from subscriber`).toHaveLength(1);
    expect((await auditRows()).length).toBe(before);
    expect((await requests().open()).map((r) => r.id)).toEqual([id]);

    // With the port wired (as scripts/access-request wires it, S08.05), it runs.
    expect(await requests().deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).toMatchObject({ ok: true, value: { subscriber: true } });
    expect(checkinCalls).toHaveLength(1);
  });

  it("is undone when the request cannot be closed, and refuses a Coordinator, before deleting anything", async () => {
    const id = await received("deletion");
    await subscribed();

    expect(await requests().deleteForResident({ id, number: NUMBER, admin: staff.coordinator.username })).toEqual({ ok: false, error: "not_admin" });
    const failing = requests({ audit: { record: async () => Promise.reject(new Error("audit store down")) } });
    await expect(failing.deleteForResident({ id, number: NUMBER, admin: staff.admin.username })).rejects.toThrow("audit store down");

    expect(await owner`select 1 from subscriber`).toHaveLength(1);
    expect((await requests().open()).map((r) => r.id)).toEqual([id]);
  });
});

describe("the weekly review and the script", () => {
  /** Moves a request's records back by `days` (the trail is append-only for the app; the owner may move a test's own rows). */
  async function backdate(id: string, days: number) {
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
      await tx`update audit_event set at = at - ${days}::int * interval '1 day' where subject_type = 'access_request' and subject_id = ${id}`;
      await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    });
  }
  const thisWeek = async () => (await owner`select (date_trunc('week', now() at time zone 'America/Toronto'))::date::text as week`)[0]!.week as string;

  it("flags a request the use case recorded once it has been open for more than 25 days, a rehearsal's apart", async () => {
    const late = await received("access");
    const recent = await received("deletion");
    const rehearsal = await received("access", staff.admin.username, true);
    const answered = await received("correction");
    await backdate(late, 26);
    await backdate(recent, 10);
    await backdate(rehearsal, 27);
    await requests().close({ id: answered, admin: staff.admin.username, outcome: "answered" });
    await backdate(answered, 40);

    const rows = (await readWeeklyReview(app, await thisWeek())).filter((row) => row.section === "access_request_overdue");
    expect(rows.map((row) => [row.reason, row.isDrill])).toEqual([
      ["open", false],
      ["open", true],
    ]);
    expect((await requests().open()).filter((r) => r.flagged).map((r) => r.id).sort()).toEqual([late, rehearsal].sort());

    // scripts/export-weekly writes the same rows, with no number.
    let csv = "";
    const code = await runExportWeekly(["--week", await thisWeek()], {
      env: { DATABASE_URL: "postgres://unused" },
      now: () => new Date(),
      out: () => {},
      error: () => {},
      write: (_, content) => void (csv = content),
      connect: () => ({ db: app, close: async () => {} }),
    });
    expect(code).toBe(0);
    expect(csv.split("\r\n").filter((line) => line.includes(",access_request_overdue,"))).toHaveLength(2);
    expect(csv).not.toMatch(/555.?013/);
  });

  it("runs receive, show, delete and list through the script against the database, printing and recording no number", async () => {
    await subscribed();
    const out: string[] = [];
    // show: the number; delete: the number, the number again, DELETE.
    const answers = [TYPED, TYPED, NUMBER, "DELETE"];
    const cli = (argv: string[]) =>
      runAccessRequest(argv, {
        env: PRODUCTION_ENV,
        out: (line) => out.push(line),
        error: (line) => out.push(line),
        prompt: async () => answers.shift() ?? "",
        isTerminal: () => true,
        connect: () => ({ requests: requests(), close: async () => {} }),
      });

    expect(await cli(["receive", "--admin", staff.admin.username, "--request", "deletion"])).toBe(0);
    const id = (await requests().open())[0]!.id;
    expect(await cli(["show", "--id", id, "--verified-control"]), out.join("\n")).toBe(0);
    expect(out.join("\n")).toContain("Language: ur");
    expect(await cli(["delete", "--id", id, "--admin", staff.admin.username, "--verified-control"])).toBe(0);
    expect(await cli(["list"])).toBe(0);

    const printed = out.join("\n");
    expect(printed).toContain("For +1 ••• ••• 0131 the CVH holds a subscriber since");
    expect(printed).toContain("subscriber deleted");
    expect(printed).toContain("No access request is open.");
    expect(printed).not.toMatch(/555.?0131/);
    expect(JSON.stringify(await auditRows())).not.toMatch(/555.?0131/);
    expect(await owner`select 1 from subscriber`).toHaveLength(0);
  });
});
