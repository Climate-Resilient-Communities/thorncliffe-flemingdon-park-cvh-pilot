// A subscribed resident's check-in request against a real database (S08.05), as src/app/checkins.ts, src/app/inbound.ts, src/app/signup.ts and
// src/app/subscriptionEdit.ts compose it: the tables' guards (a drill or closed thread gets no row, `round_ref` is random, a stub never changes,
// the tally is the trigger's alone, the request is whole); a request at sign-up (kept only for a covered floor, the answer the same for every
// number), at YES (activated only if still covered, joining the open matching rounds in the same transaction, or the welcome followed by "No
// ambassador covers your floor now"), on the edit page (asked with consent, its method changed, withdrawn, refused without consent, uncovered,
// withdrawn by a change of where the resident lives) and by text (reply 3, menu 1's move with the link's offer); E07's deletion closing the
// rows; the coverage counts; and a withdrawal or a deletion racing an approval that creates a round, in both orders: never a live row left
// for a withdrawn request or a deleted subscriber. Every number is fictional (555-01xx) and nothing reaches Twilio.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import { roundThreads } from "../../src/modules/alerting";
import { createCheckinRequests, type CheckinRequests, type RequestStore } from "../../src/modules/checkins";
import { createAssignments } from "../../src/modules/identity";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, listBuildings, neighbourhoodIds } from "../../src/modules/places";
import {
  checkinRequestCounts,
  checkinRequestStore,
  createEditLink,
  createInboundRouter,
  createMenus,
  createRateLimiter,
  createSignup,
  subscriberLookup,
  type CheckinCleanup,
  type EditLink,
  type InboundOutcome,
  type MenuPlaces,
} from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { deliveryFixtures } from "./deliveryFixtures";
import { BASE_URL, deferred } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let fixtures: ReturnType<typeof deliveryFixtures>;
let admin: string;
let ambassador: string;

const VERSION = "2026-10-02.1";
const KEY = "a-test-key-for-the-check-ins";
const NUMBER = "+14165550181";
const OTHER = "+14165550182";
// Check Street (Thorncliffe Park) has 31 with floors 1 and 2, covered by an Ambassador assigned to the whole building, and 33 with floor 1, which
// nobody covers; Far Lane is in Flemingdon Park.
const RSN_31 = "9108001";
const RSN_33 = "9108002";
const RSN_FAR = "9108003";
const RSNS = [RSN_31, RSN_33, RSN_FAR];
const FLOOR_31_1 = "0190f000-0000-7000-8000-000000810001";
const FLOOR_31_2 = "0190f000-0000-7000-8000-000000810002";
const FLOOR_33_1 = "0190f000-0000-7000-8000-000000810003";
const FLOOR_FAR = "0190f000-0000-7000-8000-000000810004";

let sid = 0;
const nextSid = () => `SM${(++sid + 0x8080).toString(16).padStart(32, "0")}`;

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
  fixtures = deliveryFixtures(owner);
  await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values
                (${RSN_31}, 'TP', '31 Check Street', 43.7, -79.34, now()), (${RSN_33}, 'TP', '33 Check Street', 43.7, -79.34, now()),
                (${RSN_FAR}, 'FP', '7 Far Lane', 43.72, -79.33, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR_31_1}, ${RSN_31}, '1', 1, true),
                (${FLOOR_31_2}, ${RSN_31}, '2', 2, true), (${FLOOR_33_1}, ${RSN_33}, '1', 1, true), (${FLOOR_FAR}, ${RSN_FAR}, '1', 1, true) on conflict do nothing`;
});

async function resetAll() {
  await owner`delete from checkin`;
  await owner`delete from checkin_tally`;
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_reply`;
  await owner`delete from inbound_seen`;
  await owner`delete from inbound_keyword_count`;
  await owner`delete from rate_limit where scope in ('signup', 'inbound', 'inbound_mute', 'sms_menu')`;
  await owner`delete from inbound_limited_count`;
  await owner`delete from ambassador_assignment where rsn in ${owner(RSNS)}`;
  await fixtures.cleanup();
  admin = (await fixtures.staff("admin")).id;
  ambassador = (await fixtures.staff("ambassador")).id;
  await owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${ambassador}, ${RSN_31}, true, ${admin})`;
}

afterAll(async () => {
  await resetAll();
  await owner`delete from ambassador_assignment where rsn in ${owner(RSNS)}`;
  await fixtures.cleanup();
  await owner`delete from building_floor where rsn in ${owner(RSNS)}`;
  await owner`delete from building where rsn in ${owner(RSNS)}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(resetAll);

const coverage = () => createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });

/** checkins' requests as src/app/checkins.ts composes them; the request store can be wrapped (a seam that holds a transaction). */
function checkinsOn(requests: RequestStore = checkinRequestStore()): CheckinRequests {
  return createCheckinRequests({ requests, threads: roundThreads, coversFloor: (rsn, floorId, executor) => coverage().coversFloor(rsn, floorId, executor) });
}

/** places' real readers for the menus, the list kept to this file's buildings. */
const menuPlaces: MenuPlaces = {
  buildings: async (tx) => (await listBuildings(tx)).filter((building) => RSNS.includes(building.rsn)),
  floorsOf: (tx, rsn, options) => floorsOfBuilding(tx, rsn, options),
};

function editLinkOn(checkins: CheckinRequests = checkinsOn()): EditLink & { tokens: string[] } {
  const queue = createDeliveryQueue();
  const tokens: string[] = [];
  const link = createEditLink({
    db: app,
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    places: {
      neighbourhoodIds: (executor) => neighbourhoodIds(executor),
      floorIdsOf: async (tx, rsn, options) => (await floorsOfBuilding(tx, rsn, options))?.map((floor) => floor.id) ?? null,
    },
    checkins,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
    newToken: () => {
      const token = randomBytes(32).toString("base64url");
      tokens.push(token);
      return token;
    },
  });
  return Object.assign(link, { tokens });
}

/** A text from the number, through the router as src/app/inbound.ts composes it (checkins' real ports, the menus, the edit link). */
function send(body: string, options: { from?: string; optOutType?: string; cleanup?: CheckinCleanup; checkins?: CheckinRequests } = {}): Promise<InboundOutcome> {
  const queue = createDeliveryQueue();
  const checkins = options.checkins ?? checkinsOn();
  return createInboundRouter({
    db: app,
    places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
    skipRecipientDeliveries: (tx, recipient) => queue.skipRecipientDeliveries(tx, recipient),
    checkins: options.cleanup ?? checkins,
    checkinActivation: checkins,
    menus: createMenus({ enqueue: (tx, input) => queue.enqueueTransactional(tx, input), pricePerSegmentCents: () => 1.5, places: menuPlaces, checkins, editLink: editLinkOn(checkins).port }),
    numberKey: () => KEY,
    publicBaseUrl: () => BASE_URL,
    pricePerSegmentCents: () => 1.5,
  }).handle({ messageSid: nextSid(), from: options.from ?? NUMBER, body, optOutType: options.optOutType ?? null });
}

/** A web sign-up as src/app/signup.ts composes it, with identity's coverage. */
function signUp(over: { phone?: string; places?: { rsn: string; floors: string[] }[]; checkin?: { rsn: string; floorId: string; method: "call" | "text" } } = {}) {
  const queue = createDeliveryQueue();
  return createSignup({
    db: app,
    places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
    subscribers: subscriberLookup(),
    coversFloor: (rsn, floorId, executor) => coverage().coversFloor(rsn, floorId, executor),
    enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
    consentVersion: () => VERSION,
    limiter: () => createRateLimiter({ db: app, key: KEY }),
    pricePerSegmentCents: () => 1.5,
  }).request(
    {
      phone: over.phone ?? NUMBER,
      lang: "en",
      neighbourhood: "TP",
      places: over.places ?? [{ rsn: RSN_31, floors: [FLOOR_31_1] }],
      groups: [],
      consentVersion: VERSION,
      ...(over.checkin ? { checkin: { ...over.checkin, consentVersion: CHECKIN_CONSENT_VERSION } } : {}),
    },
    `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
  );
}

/** A subscriber made directly (YES is tested on its own), with places and, optionally, a request on one of them. */
async function subscriber(options: { phone?: string; places?: { rsn: string; floorId: string | null }[]; request?: { rsn: string; floorId: string; method: "call" | "text" } } = {}): Promise<string> {
  const id = crypto.randomUUID();
  const request = options.request;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
              values (${id}, ${options.phone ?? NUMBER}, 'en', 'TP', '{}', ${VERSION}, 'web', ${request?.method ?? null}, ${request ? CHECKIN_CONSENT_VERSION : null},
                      ${request?.rsn ?? null}, ${request?.floorId ?? null})`;
  for (const place of options.places ?? [{ rsn: RSN_31, floorId: FLOOR_31_1 }]) {
    await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${crypto.randomUUID()}, ${id}, ${place.rsn}, ${place.floorId})`;
  }
  return id;
}

const ON_31_1 = { rsn: RSN_31, floorId: FLOOR_31_1, method: "call" as const };

/** An open, non-drill thread with an approved update of these types for the whole of Thorncliffe Park (or a building elsewhere). */
async function thread(options: { types?: string[]; scope?: "neighbourhood" | "buildings"; isDrill?: boolean } = {}): Promise<string> {
  return (await fixtures.entry("approved", { types: options.types ?? ["heat"], kind: "update", scope: options.scope, isDrill: options.isDrill })).alertId;
}

const requestOf = async (id: string) =>
  (await owner`select checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id from subscriber where id = ${id}`)[0] ?? null;
const rowsOf = (alertId: string) =>
  owner`select subscriber_id, rsn, floor_id, method, status, outcome, tallied_at is not null as tallied, closed_at is not null as closed, round_ref from checkin where alert_id = ${alertId} order by created_at, id`;
/** The thread's tally summed over its places, by status. */
const tallyOf = async (alertId: string) =>
  Object.fromEntries((await owner`select status, sum(n)::int as n from checkin_tally where alert_id = ${alertId} group by status`).map((row) => [row.status as string, row.n as number]));
const textsTo = (id: string) => owner`select purpose, body from delivery where recipient_id = ${id} order by created_at, id`;
const liveRowsOf = (subscriberId: string) => owner`select 1 from checkin where subscriber_id = ${subscriberId} and closed_at is null and tallied_at is null`;

/** Waits until some session of the app's role waits for a lock (the race's second transaction is blocked behind the first). */
async function untilWaiting(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const waiting = await owner`select 1 from pg_stat_activity where usename = 'cvh_app_login' and wait_event_type = 'Lock'`;
    if (waiting.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no session waited for a lock");
}

/** An approval that makes or adds to the round (S08.06 calls `ensureRound` so): the thread's lock first, then the requesters'; `hold` keeps it open. */
function approvalRound(alertId: string, requesterIds: string[], gate?: { reached: () => void; hold: Promise<void> }) {
  return app.transaction(async (tx) => {
    const [locked] = await roundThreads.lock(tx, [alertId]);
    const added = await checkinsOn().ensureRound(tx, locked!, requesterIds);
    gate?.reached();
    await gate?.hold;
    return added;
  });
}

describe("the tables (20261006170000_checkin_request.sql)", () => {
  it("refuse a row for a drill thread or a closed one, and a round_ref that is not random; only the trigger writes the tally", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const drill = await thread({ isDrill: true });
    const row = (alertId: string, roundRef?: string) =>
      appSql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method${roundRef ? appSql`, round_ref` : appSql``})
             values (${crypto.randomUUID()}, ${alertId}, ${id}, ${RSN_31}, ${FLOOR_31_1}, 'call'${roundRef ? appSql`, ${roundRef}` : appSql``})`;
    await expect(row(drill)).rejects.toThrow(/drill thread has no check-in round/);
    const open = await thread();
    await expect(row(open, "0190f000-0000-7000-8000-000000000001")).rejects.toThrow(/checkin_round_ref_random/);
    await row(open);
    expect(await tallyOf(open)).toEqual({ requested: 1 });
    await expect(appSql`insert into checkin_tally (alert_id, rsn, floor_id, status, n) values (${open}, ${RSN_31}, ${FLOOR_31_1}, 'done', 1)`).rejects.toThrow(/permission denied/);
    // The app may not change a row's place at all (no grant); the guard refuses it to anyone else as well.
    await expect(appSql`update checkin set rsn = ${RSN_33} where alert_id = ${open}`).rejects.toThrow(/permission denied/);
    await expect(owner`update checkin set rsn = ${RSN_33} where alert_id = ${open}`).rejects.toThrow(/never change/);
    // Into a stub, tallied once: then nothing about it changes again.
    await appSql`update checkin set outcome = 'withdrawn', tallied_at = now(), subscriber_id = null, method = null, closed_at = now() where alert_id = ${open}`;
    expect(await tallyOf(open)).toEqual({ requested: 1, withdrawn: 1 });
    await expect(appSql`update checkin set status = 'done' where alert_id = ${open}`).rejects.toThrow(/closed stub never changes/);
  });

  it("keep a request whole, and a sign-up's request on one of its places with that floor", async () => {
    const id = await subscriber();
    await expect(appSql`update subscriber set checkin_method = 'call' where id = ${id}`).rejects.toThrow(/subscriber_checkin_request_whole/);
    await expect(
      appSql`insert into pending_signup (id, phone, lang, neighbourhood_id, places, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
             values (${crypto.randomUUID()}, ${NUMBER}, 'en', 'TP', ${appSql.json([{ rsn: RSN_31, floors: [FLOOR_31_2] }])}, ${VERSION}, 'web', 'call', ${CHECKIN_CONSENT_VERSION}, ${RSN_31}, ${FLOOR_31_1})`,
    ).rejects.toThrow(/pending_signup_where_i_live_saved/);
  });
});

describe("a request made with the sign-up (E08 'Request during sign-up')", () => {
  it("is kept on the pending sign-up when the floor is covered, and activated at YES, joining the open matching round in the same transaction", async () => {
    const heat = await thread();
    const water = await thread({ types: ["water"] });
    const elsewhere = await thread({ scope: "buildings" });
    expect(await signUp({ checkin: ON_31_1 })).toEqual({ kind: "accepted", checkin: "requested" });
    expect((await owner`select checkin_method, where_i_live_rsn, where_i_live_floor_id from pending_signup`)[0]).toEqual({ checkin_method: "call", where_i_live_rsn: RSN_31, where_i_live_floor_id: FLOOR_31_1 });

    await send("YES");
    const [{ id }] = (await owner`select id from subscriber`) as unknown as [{ id: string }];
    expect(await requestOf(id)).toEqual({ checkin_method: "call", checkin_consent_version: CHECKIN_CONSENT_VERSION, where_i_live_rsn: RSN_31, where_i_live_floor_id: FLOOR_31_1 });
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: id, rsn: RSN_31, floor_id: FLOOR_31_1, method: "call", status: "pending", tallied: false, closed: false }]);
    expect(await tallyOf(heat)).toEqual({ requested: 1 });
    // A thread of another type, and one for another place, are no round of hers.
    expect(await rowsOf(water)).toEqual([]);
    expect(await rowsOf(elsewhere)).toEqual([]);
    // No phone number in a round row (the table has no column for one) and the welcome only.
    expect((await textsTo(id)).map((text) => text.purpose)).toEqual(["welcome"]);
  });

  it("is not kept for a floor nobody covers: the answer says so, the same for a new, a pending and a subscribed number, and the rest is saved", async () => {
    const uncovered = { rsn: RSN_33, floorId: FLOOR_33_1, method: "text" as const };
    const places = [{ rsn: RSN_33, floors: [FLOOR_33_1] }];
    expect(await signUp({ places, checkin: uncovered })).toEqual({ kind: "accepted", checkin: "uncovered" });
    expect((await owner`select checkin_method from pending_signup`)[0]).toEqual({ checkin_method: null });
    expect(await signUp({ places, checkin: uncovered })).toEqual({ kind: "accepted", checkin: "uncovered" });
    await subscriber({ phone: OTHER });
    expect(await signUp({ phone: OTHER, places, checkin: uncovered })).toEqual({ kind: "accepted", checkin: "uncovered" });
    expect(await signUp({ phone: OTHER })).toEqual({ kind: "accepted" });
  });

  it("is not activated at YES when the floor is no longer covered: the welcome is followed by 'No ambassador covers your floor now'", async () => {
    expect(await signUp({ checkin: ON_31_1 })).toMatchObject({ checkin: "requested" });
    await owner`delete from ambassador_assignment where staff_id = ${ambassador}`;
    await send("YES");
    const [{ id }] = (await owner`select id from subscriber`) as unknown as [{ id: string }];
    expect((await requestOf(id))!.checkin_method).toBeNull();
    const texts = await textsTo(id);
    expect(texts.map((text) => text.purpose)).toEqual(["welcome", "welcome"]);
    expect(texts[1]!.body).toBe("No ambassador covers your floor now. Call the Hub at (416) 421-8997.");
  });
});

describe("withdrawing a request (reply 3, E07's withdrawRequest port)", () => {
  it("tallies the open rows (withdrawn, or the mark), closes them into stubs, clears the request and confirms; with none, says so", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const first = await thread();
    const second = await thread({ types: ["power"] });
    await approvalRound(first, [id]);
    await approvalRound(second, [id]);
    await owner`update checkin set status = 'needs_help' where alert_id = ${second}`;

    expect(await send("3")).toMatchObject({ action: "menu", replied: true });
    expect((await requestOf(id))!.checkin_method).toBeNull();
    expect(await rowsOf(first)).toMatchObject([{ subscriber_id: null, method: null, outcome: "withdrawn", tallied: true, closed: true }]);
    expect(await rowsOf(second)).toMatchObject([{ subscriber_id: null, method: null, outcome: "needs_help", tallied: true, closed: true }]);
    expect(await tallyOf(first)).toEqual({ requested: 1, withdrawn: 1 });
    expect(await tallyOf(second)).toEqual({ requested: 1, needs_help: 1 });
    expect((await textsTo(id)).at(-1)!.body).toBe("Your check-in request is withdrawn.");

    expect(await send("3")).toMatchObject({ replied: true });
    expect((await textsTo(id)).at(-1)!.body).toBe("You have no check-in request.");
  });
});

describe("a change of where the resident lives (E08 'Changed location')", () => {
  it("by menu 1 withdraws the request and its open rows, and the confirmation offers the edit link to ask again", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    await approvalRound(heat, [id]);
    // Menu 1: street (Check Street is 1), building (33 is 2), floor (1 is 2: "Whole building" is 1).
    for (const reply of ["1", "1", "2", "2"]) await send(reply);
    expect(await owner`select rsn, floor_id from subscriber_place where subscriber_id = ${id}`).toEqual([{ rsn: RSN_33, floor_id: FLOOR_33_1 }]);
    expect((await requestOf(id))!.checkin_method).toBeNull();
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, outcome: "withdrawn", closed: true }]);
    const bodies = (await textsTo(id)).map((text) => text.body);
    expect(bodies.at(-2)).toBe("Saved. Your building is now 33 Check Street, floor 1.");
    expect(bodies.at(-1)).toBe("Your check-in request was withdrawn because your floor changed. Reply 1 for a link to ask again.");
    expect((await owner`select kind from sms_prompt where subscriber_id = ${id}`)[0]).toEqual({ kind: "edit_link_offer" });
  });

  it("by menu 1 to the same building and floor keeps the request and its rows", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    await approvalRound(heat, [id]);
    for (const reply of ["1", "1", "1", "2"]) await send(reply);
    expect((await requestOf(id))!.checkin_method).toBe("call");
    expect(await liveRowsOf(id)).toHaveLength(1);
  });
});

describe("the edit page's request (S07.06's page, S08.05)", () => {
  /** A link for the subscriber, made as the menus' offer makes it. */
  async function linkFor(id: string, link = editLinkOn()): Promise<string> {
    await app.transaction((tx) => link.port.send(tx, { id, lang: "en" }));
    return link.tokens.at(-1)!;
  }
  const change = (token: string, over: Record<string, unknown> = {}) => ({
    token,
    lang: "en" as const,
    neighbourhood: "TP",
    places: [{ rsn: RSN_31, floors: [FLOOR_31_1, FLOOR_31_2] }, { rsn: RSN_33, floors: [FLOOR_33_1] }],
    groups: [],
    mutedTopics: [],
    ...over,
  });

  it("shows the request, asks for one with the consent (joining the open round at once), changes its method alone, and withdraws it", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_31, floorId: FLOOR_31_1 }, { rsn: RSN_31, floorId: FLOOR_31_2 }, { rsn: RSN_33, floorId: FLOOR_33_1 }] });
    const heat = await thread();
    const link = editLinkOn();
    expect(await link.view(await linkFor(id, link))).toMatchObject({ subscription: { checkin: null } });

    expect(await link.change(change(await linkFor(id, link), { checkin: { rsn: RSN_31, floorId: FLOOR_31_2, method: "text", consentVersion: CHECKIN_CONSENT_VERSION } }))).toEqual({ kind: "changed", checkin: "requested" });
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: id, floor_id: FLOOR_31_2, method: "text", closed: false }]);
    expect(await link.view(await linkFor(id, link))).toMatchObject({ subscription: { checkin: { rsn: RSN_31, floor: FLOOR_31_2, method: "text" } } });

    // The same place, another method: no consent asked, the open row follows, no new row.
    expect(await link.change(change(await linkFor(id, link), { checkin: { rsn: RSN_31, floorId: FLOOR_31_2, method: "call", consentVersion: null } }))).toEqual({ kind: "changed", checkin: "method_changed" });
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: id, method: "call", closed: false }]);
    expect(await tallyOf(heat)).toEqual({ requested: 1 });

    expect(await link.change(change(await linkFor(id, link), { checkin: null }))).toEqual({ kind: "changed", checkin: "withdrawn" });
    expect((await requestOf(id))!.checkin_method).toBeNull();
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, outcome: "withdrawn", closed: true }]);
    expect(await tallyOf(heat)).toEqual({ requested: 1, withdrawn: 1 });
    const bodies = (await textsTo(id)).map((text) => text.body);
    expect(bodies.at(-1)).toBe("Your check-in request is withdrawn.");
  });

  it("refuses a request at a new place without the consent, before the link is used", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_31, floorId: FLOOR_31_1 }, { rsn: RSN_31, floorId: FLOOR_31_2 }], request: ON_31_1 });
    const link = editLinkOn();
    const token = await linkFor(id, link);
    const moved = change(token, { places: [{ rsn: RSN_31, floors: [FLOOR_31_1, FLOOR_31_2] }], checkin: { rsn: RSN_31, floorId: FLOOR_31_2, method: "call", consentVersion: null } });
    expect(await link.change(moved)).toEqual({ kind: "refused", code: "checkin_consent_missing" });
    expect((await owner`select used_at from subscription_edit_token where subscriber_id = ${id}`)[0]!.used_at).toBeNull();
    expect((await requestOf(id))!.where_i_live_floor_id).toBe(FLOOR_31_1);
  });

  it("does not save a request for a floor nobody covers, and saves the rest of the change", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_33, floorId: FLOOR_33_1 }] });
    const link = editLinkOn();
    const answer = await link.change(change(await linkFor(id, link), { lang: "fr", places: [{ rsn: RSN_33, floors: [FLOOR_33_1] }], checkin: { rsn: RSN_33, floorId: FLOOR_33_1, method: "call", consentVersion: CHECKIN_CONSENT_VERSION } }));
    expect(answer).toEqual({ kind: "changed", checkin: "uncovered" });
    expect((await requestOf(id))!.checkin_method).toBeNull();
    expect((await owner`select lang from subscriber where id = ${id}`)[0]).toEqual({ lang: "fr" });
  });

  it("withdraws the request when its place is no longer saved, whether or not the page sends one, and can ask again for the new floor", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    await approvalRound(heat, [id]);
    const link = editLinkOn();
    // A page that sends no request (S07.06's): checkins' locationChanging.
    expect(await link.change(change(await linkFor(id, link), { places: [{ rsn: RSN_31, floors: [FLOOR_31_2] }] }))).toEqual({ kind: "changed" });
    expect((await requestOf(id))!.checkin_method).toBeNull();
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, outcome: "withdrawn" }]);
    expect((await textsTo(id)).map((text) => text.body).at(-1)).toBe("Your check-in request is withdrawn.");
    // Asked again for the new floor, with the consent shown again: joins the round once more.
    expect(await link.change(change(await linkFor(id, link), { places: [{ rsn: RSN_31, floors: [FLOOR_31_2] }], checkin: { rsn: RSN_31, floorId: FLOOR_31_2, method: "call", consentVersion: CHECKIN_CONSENT_VERSION } }))).toEqual({ kind: "changed", checkin: "requested" });
    expect((await rowsOf(heat)).filter((row) => !row.closed)).toMatchObject([{ subscriber_id: id, floor_id: FLOOR_31_2 }]);
    expect(await tallyOf(heat)).toEqual({ requested: 2, withdrawn: 1 });
  });

  it("with a request moved to another saved floor withdraws the old one (its rows closed) and asks for the new one", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_31, floorId: FLOOR_31_1 }, { rsn: RSN_31, floorId: FLOOR_31_2 }], request: ON_31_1 });
    const heat = await thread();
    await approvalRound(heat, [id]);
    const link = editLinkOn();
    const answer = await link.change(change(await linkFor(id, link), { places: [{ rsn: RSN_31, floors: [FLOOR_31_1, FLOOR_31_2] }], checkin: { rsn: RSN_31, floorId: FLOOR_31_2, method: "text", consentVersion: CHECKIN_CONSENT_VERSION } }));
    expect(answer).toEqual({ kind: "changed", checkin: "requested" });
    expect(await rowsOf(heat)).toMatchObject([
      { subscriber_id: null, floor_id: FLOOR_31_1, outcome: "withdrawn", closed: true },
      { subscriber_id: id, floor_id: FLOOR_31_2, method: "text", closed: false },
    ]);
  });
});

describe("E07's deletion (checkins' deleteForSubscriber port)", () => {
  it("on STOP and on the edit page's 'Delete' closes every row that names the subscriber into a stub, tallied once", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    await approvalRound(heat, [id]);
    await send("STOP", { optOutType: "STOP" });
    expect(await owner`select 1 from subscriber where id = ${id}`).toHaveLength(0);
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, method: null, outcome: "withdrawn", tallied: true, closed: true }]);
    expect(await tallyOf(heat)).toEqual({ requested: 1, withdrawn: 1 });

    const again = await subscriber({ request: ON_31_1 });
    await approvalRound(heat, [again]);
    // A row kept after a close for the Hub's follow-up (S08.08) is already tallied: it becomes a stub and adds nothing.
    await owner`update checkin set status = 'not_reached', outcome = 'not_reached', tallied_at = now() where subscriber_id = ${again}`;
    const link = editLinkOn();
    await app.transaction((tx) => link.port.send(tx, { id: again, lang: "en" }));
    expect(await link.delete(link.tokens.at(-1)!)).toEqual({ kind: "deleted" });
    expect(await owner`select 1 from checkin where subscriber_id = ${again}`).toHaveLength(0);
    expect(await tallyOf(heat)).toEqual({ requested: 2, withdrawn: 1, not_reached: 1 });
  });
});

describe("the coverage view's counts", () => {
  it("counts the requests on each building and floor, with no one named", async () => {
    await subscriber({ request: ON_31_1 });
    await subscriber({ phone: OTHER, request: ON_31_1 });
    expect(await checkinRequestCounts(app)).toEqual([{ rsn: RSN_31, floorId: FLOOR_31_1, requests: 2 }]);
  });
});

describe("a withdrawal or a deletion racing an approval that creates a round (E08 'Request lock order')", () => {
  it("the approval first: the withdrawal waits for it, then closes the row it made", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    const hold = deferred();
    const reached = deferred();
    const approval = approvalRound(heat, [id], { reached: reached.resolve, hold: hold.promise });
    // The approval holds the subscriber's row FOR SHARE (its row made, not committed); reply 3 waits for it.
    await reached.promise;
    const withdrawal = send("3");
    await untilWaiting();
    hold.resolve();
    expect(await approval).toBe(1);
    await withdrawal;
    expect(await liveRowsOf(id)).toHaveLength(0);
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, outcome: "withdrawn", closed: true }]);
    expect(await tallyOf(heat)).toEqual({ requested: 1, withdrawn: 1 });
  });

  it("the withdrawal first: the approval waits for the subscriber's row, then makes no row", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    const hold = deferred();
    const reached = deferred();
    const holding: RequestStore = {
      ...checkinRequestStore(),
      lockForEdit: async (tx, subscriberId) => {
        const locked = await checkinRequestStore().lockForEdit(tx, subscriberId);
        reached.resolve();
        await hold.promise;
        return locked;
      },
    };
    const withdrawal = send("3", { checkins: checkinsOn(holding) });
    await reached.promise;
    const approval = approvalRound(heat, [id]);
    await untilWaiting();
    hold.resolve();
    await withdrawal;
    expect(await approval).toBe(0);
    expect(await rowsOf(heat)).toEqual([]);
    expect((await requestOf(id))!.checkin_method).toBeNull();
  });

  it("the approval first: STOP's deletion waits for it, then closes the row it made before deleting the subscriber", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    const hold = deferred();
    const reached = deferred();
    const approval = approvalRound(heat, [id], { reached: reached.resolve, hold: hold.promise });
    await reached.promise;
    const deletion = send("STOP", { optOutType: "STOP" });
    await untilWaiting();
    hold.resolve();
    expect(await approval).toBe(1);
    await deletion;
    expect(await owner`select 1 from subscriber where id = ${id}`).toHaveLength(0);
    expect(await rowsOf(heat)).toMatchObject([{ subscriber_id: null, outcome: "withdrawn", closed: true }]);
  });

  it("STOP's deletion first: the approval waits for the subscriber's row, then finds it gone and makes no row", async () => {
    const id = await subscriber({ request: ON_31_1 });
    const heat = await thread();
    const hold = deferred();
    const reached = deferred();
    const real = checkinsOn();
    const cleanup: CheckinCleanup = {
      lockRounds: (subscriberId, tx) => real.lockRounds(subscriberId, tx),
      deleteForSubscriber: async (subscriberId, tx) => {
        await real.deleteForSubscriber(subscriberId, tx);
        reached.resolve();
        await hold.promise;
      },
    };
    const deletion = send("STOP", { optOutType: "STOP", cleanup });
    await reached.promise;
    const approval = approvalRound(heat, [id]);
    await untilWaiting();
    hold.resolve();
    await deletion;
    expect(await approval).toBe(0);
    expect(await rowsOf(heat)).toEqual([]);
    expect(await owner`select 1 from subscriber where id = ${id}`).toHaveLength(0);
  });
});
