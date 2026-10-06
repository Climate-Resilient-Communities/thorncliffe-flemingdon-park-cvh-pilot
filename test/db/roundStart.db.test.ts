// Heat and power alerts start a check-in round (S08.06, E08 "Round types", "Round", "Request lock order", AD-12, AD-18), against a real database as
// the app's own role (cvh_app_login). The lifecycle is the real one, composed as src/app/staff/alerts.ts composes it: its approval calls checkins'
// `ensureRound` (composed as src/app/checkins.ts composes it, with identity's `coversFloor`) with subscriptions' requesters in the buildings the
// audience covers. The texts go to the real outbox and are never sent; every number is fictional (555-01xx).
//  - an approved acknowledgement, update or correction of a round type in an open, non-drill thread gives one row to each receiving requester whose
//    "where I live" place matches the entry's audience (a neighbourhood audience covers every building of it), on a covered floor; muted topics and
//    groups play no part; a type that is not a round type, a drill, a final and a D-1 publication make none; the drill trigger refuses a direct insert;
//  - a later approval in the thread adds the requesters without a row and leaves the rows already made, and their marks, as they are;
//  - an Admin's change of the round types is audited with the types before and after, and applies from the next approval only;
//  - a withdrawal or a deletion racing the approval that creates the round, in both orders: never a live row for a withdrawn requester or a deleted
//    subscriber; a request activated while that approval runs, in both orders, ends in the round; and the end-of-pilot campaign's start, which locks
//    every active subscriber in id order, waits for the approval (its requesters are locked with its recipients, in one id order) and never deadlocks;
//  - a requester who no longer receives texts (the campaign's deadline passed without her YES) gets no row.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { record, recordRefusal, type AuditEvent } from "../../src/modules/audit";
import type { Audience } from "../../src/contracts/audience";
import { CHECKIN_CONSENT_VERSION } from "../../src/contracts/checkin";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  createAlerting,
  createEntryPreparer,
  createSubmitter,
  freezeContent,
  roundThreads,
  type AlertActor,
  type AlertLifecycle,
  type AlertingWiring,
  type EntryContent,
  type EntryRef,
} from "../../src/modules/alerting";
import { createCheckinRequests, type CheckinRequests, type RequestStore } from "../../src/modules/checkins";
import { createAssignments } from "../../src/modules/identity";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { createRoundTypes, floorsOfBuilding } from "../../src/modules/places";
import { checkinRequestStore, createNumberDeletion } from "../../src/modules/subscriptions";
import { campaignStore } from "../../src/modules/subscriptions/adapters/campaignStore";
import { createDb, type Db } from "../../src/platform/db";
import { submitSeams } from "./alertSubmitSeams";
import { deliveryFixtures } from "./deliveryFixtures";
import { deferred } from "./dispatcherSupport";
import { connect, inDays, serverUrl } from "./helpers";

const BASE_URL = "https://cvh.example";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
// Round Street (Thorncliffe Park) has 1, with floors 1 to 3, covered on every floor, and 3, with floors 1 and 2, covered on floor 1 only; Far Court
// is in Flemingdon Park, covered.
const RSN_A = "9806001";
const RSN_B = "9806002";
const RSN_C = "9806003";
const RSNS = [RSN_A, RSN_B, RSN_C];
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const [A1, A2, A3] = [1, 2, 3].map((i) => floorId(RSN_A, i)) as [string, string, string];
const [B1, B2] = [1, 2].map((i) => floorId(RSN_B, i)) as [string, string];
const C1 = floorId(RSN_C, 1);

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let fixtures: ReturnType<typeof deliveryFixtures>;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
let auditBaseline = 0;
const madeNeighbourhoods: string[] = [];

let author: { id: string };
let approver: { id: string };
let admin: { id: string };
let ambassador: { id: string };

const actor = (who: { id: string }, aal: "aal1" | "aal2" = "aal2"): AlertActor => ({ staffId: who.id, aal });
const coverage = () => createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
const audit = { record: (tx: Parameters<typeof record>[0], event: unknown) => record(tx, event as AuditEvent), recordRefusal: (db: Db, event: unknown) => recordRefusal(db, event as AuditEvent) };

/** checkins' requests as src/app/checkins.ts composes them; the request store can be wrapped (a seam that holds a transaction). */
function checkinsOn(requests: RequestStore = checkinRequestStore()): CheckinRequests {
  return createCheckinRequests({ requests, threads: roundThreads, coversFloor: (rsn, floor, executor) => coverage().coversFloor(rsn, floor, executor) });
}

/** The lifecycle as src/app/staff/alerts.ts composes it (no on-call rule: texting is not live here), with what a test changes. */
const alertingWith = (over: Partial<AlertingWiring> = {}) => createAlerting({ db: app, pricePerSegmentCents: () => 1.5, checkins: checkinsOn(), ...over });

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
  fixtures = deliveryFixtures(owner);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  for (const [id, fsa] of [["TP", "M4H"], ["FP", "M3C"]] as const) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${`Fixture ${id}`}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nbhd, address, floors] of [[RSN_A, "TP", "1 Round Street", 3], [RSN_B, "TP", "3 Round Street", 2], [RSN_C, "FP", "5 Far Court", 1]] as const) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${nbhd}, ${address}, 43.7, -79.34, now()) on conflict do nothing`;
    for (let index = 1; index <= floors; index += 1) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${String(index)}, ${index}, true) on conflict do nothing`;
    }
  }
  alerting = alertingWith();
  seams = submitSeams(owner, alerting);
});

async function resetAll() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  await owner`delete from pending_signup`;
  await owner`delete from subscriber`;
  // A campaign names the Admin who started it: it goes before the Admin's account.
  await owner`delete from campaign`;
  await owner`delete from ambassador_assignment where rsn in ${owner(RSNS)}`;
  await owner`update disruption_type set checkin = (id in ('heat', 'power'))`;
  await fixtures.cleanup();
}

afterAll(async () => {
  await resetAll();
  for (const rsn of RSNS) {
    await owner`delete from building_floor where rsn = ${rsn}`;
    await owner`delete from building where rsn = ${rsn}`;
  }
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

let phoneCounter = 0;
beforeEach(async () => {
  await resetAll();
  phoneCounter = 0;
  author = await fixtures.staff("coordinator");
  approver = await fixtures.staff("coordinator");
  admin = await fixtures.staff("admin");
  ambassador = await fixtures.staff("ambassador");
  await owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${ambassador.id}, ${RSN_A}, true, ${admin.id}), (${ambassador.id}, ${RSN_C}, true, ${admin.id})`;
  // Floor 1 of 3 Round Street only: the assignment and its floor in one transaction (an assignment of some floors names at least one).
  await owner.begin(async (tx) => {
    await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${ambassador.id}, ${RSN_B}, false, ${admin.id})`;
    await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) values (${ambassador.id}, ${RSN_B}, ${B1})`;
  });
});

// --- fixtures ---------------------------------------------------------------------------------------------------------------------------------------

const phoneOf = (index: number) => `+1416555${String(100 + index).padStart(4, "0")}`;

interface SubscriberSpec {
  /** The subscriber's id (a race that needs an id order); a random one by default. */
  id?: string;
  places?: { rsn: string; floor: string | null }[];
  request?: { rsn: string; floor: string; method?: "call" | "text" };
  muted?: string[];
  groups?: string[];
  neighbourhood?: string;
  /** S09.07's retention state: `active` by default. */
  state?: "active" | "reconsent_pending" | "retained";
}

/**
 * A confirmed subscriber (YES is S08.05's) with places, muted topics and groups, and, optionally, a check-in request on one of its places (`request`):
 * the "where I live" building and floor and the method. Its neighbourhood is the one given (the building's, unless a test says otherwise).
 */
async function subscriber(spec: SubscriberSpec = {}): Promise<string> {
  const id = spec.id ?? randomUUID();
  phoneCounter += 1;
  const request = spec.request;
  const places = spec.places ?? (request ? [{ rsn: request.rsn, floor: request.floor }] : []);
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
    values (${id}, ${phoneOf(phoneCounter)}, 'en', ${spec.neighbourhood ?? "TP"}, ${spec.groups ?? []}, '2026-10-01.1', 'web', ${spec.state ?? "active"}, ${request ? (request.method ?? "call") : null},
            ${request ? CHECKIN_CONSENT_VERSION : null}, ${request?.rsn ?? null}, ${request?.floor ?? null})`;
  for (const place of places) await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${place.rsn}, ${place.floor})`;
  for (const topic of spec.muted ?? []) await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${id}, ${topic})`;
  return id;
}

/**
 * The real end-of-pilot campaign (S09.07), started by the Admin, as the owner writes it with its guard switched off (its rehearsal, texts and session are
 * campaign.db.test.ts's), its deadline 30 days on. `pastDeadline` moves the deadline before the database's clock, as if the days had gone by.
 */
async function realCampaign(): Promise<string> {
  const id = randomUUID();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table campaign disable trigger campaign_guard");
    await tx`insert into campaign (id, rehearsal, deadline_date, deadline, terms_version, texts, started_by, started_session, started_aal, idempotency_key)
      values (${id}, false, (now() at time zone 'America/Toronto')::date + 30, now() + interval '30 days', '2026-10-01.1', '{}'::jsonb, ${admin.id},
              ${randomBytes(32).toString("hex")}, 'aal2', ${randomUUID()})`;
    await tx.unsafe("alter table campaign enable trigger campaign_guard");
  });
  return id;
}

async function pastDeadline(campaignId: string): Promise<void> {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table campaign disable trigger campaign_guard");
    await tx`update campaign set deadline_date = deadline_date - 31, deadline = now() - interval '1 day' where id = ${campaignId}`;
    await tx.unsafe("alter table campaign enable trigger campaign_guard");
  });
}

const neighbourhood = (types: string[], ids: string[] = ["TP"]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: [...types].sort() });
const buildings = (list: { rsn: string; floors: string[] | null }[], types: string[]): Audience => ({
  scope: "buildings",
  buildings: [...list].sort((a, b) => (a.rsn < b.rsn ? -1 : 1)),
  groups: [],
  types: [...types].sort(),
});

const contentOf = (audience: Audience): EntryContent => ({
  text: "It is dangerously hot today. Cooling rooms are open.",
  types: [...audience.types],
  audience,
  phase: "problem",
  validUntil: inDays(1),
  validUntilMode: "at",
});

/** Freezes the entry as a real submit freezes it (the one renderer) and submits it. */
async function freeze(ref: EntryRef, kind: "ack" | "update" | "correction" | "final", supersedesId: string | null, by: { id: string } = author, isDrill = false) {
  const entry = await alerting.getEntry(ref);
  const thread = await alerting.getThread(ref.alertId);
  if (!entry || !thread) throw new Error("no such entry");
  const frozen = freezeContent({
    alertId: ref.alertId,
    kind,
    supersedesId,
    isDrill,
    channels: ["sms", "web"],
    content: entry.content,
    translations: [{ lang: "ur", body: `ur ${entry.content.text.length}`, machine: true, model: "m1", status: "translated", sourceHash: sha(entry.content.text) }],
    verified: true,
    attribution: { role: "hub" },
    slug: thread.slug,
    publicBaseUrl: BASE_URL,
  });
  if (!frozen.ok) throw new Error(`freeze refused: ${frozen.error}`);
  const submitted = await seams.freeze(actor(by), ref, frozen.value);
  if (!submitted.ok) throw new Error(`submit refused: ${submitted.error}`);
}

/** A thread's first entry (an acknowledgement), submitted and waiting for approval: a drill is an Admin's. */
async function pendingAck(audience: Audience, isDrill = false): Promise<EntryRef> {
  const by = isDrill ? admin : author;
  const created = await alerting.createAlert(actor(by), { kind: "ack", isDrill, reportedAt: new Date(Date.now() - 60_000), content: contentOf(audience) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  await freeze(ref, "ack", null, by, isDrill);
  return ref;
}

/** What the approver is shown, then approves (exactly what the screen does): the reviewed count is the port's count. */
async function approve(ref: EntryRef, lifecycle: AlertLifecycle = alerting) {
  const review = await lifecycle.review(ref);
  if (!review) throw new Error("nothing to review");
  const [row] = await owner<{ version: number; content_hash: string }[]>`select version, content_hash from alert_entry where id = ${ref.entryId}`;
  const result = await lifecycle.approveEntry(actor(approver), ref, { version: row!.version, contentHash: row!.content_hash, recipients: { total: review.recipients.total, byLanguage: review.recipients.byLanguage } });
  if (!result.ok) throw new Error(`approve refused: ${result.error}`);
  return result.value;
}

/** An update of the thread, with the audience given (else the covering entry's), submitted and waiting for approval. */
async function pendingUpdate(alertId: string, audience?: Audience): Promise<EntryRef> {
  const made = await alerting.addUpdate(actor(author), { alertId }, { entryId: randomUUID(), text: "Still hot. Cooling rooms stay open late.", phase: "in_progress", validUntil: inDays(1), validUntilMode: "at" });
  if (!made.ok) throw new Error(`addUpdate refused: ${made.error}`);
  const ref = { alertId, entryId: made.value.entry.id };
  if (audience) {
    const current = (await alerting.getEntry(ref))!;
    const saved = await alerting.saveDraft(actor(author), ref, { ...current.content, audience });
    if (!saved.ok) throw new Error(`saveDraft refused: ${saved.error}`);
  }
  await freeze(ref, "update", null);
  return ref;
}

const rowsOf = (alertId: string) =>
  owner<{ subscriber_id: string | null; rsn: string; floor_id: string; method: string | null; status: string; tallied: boolean; closed: boolean; outcome: string | null; round_ref: string; created_at: Date }[]>`
    select subscriber_id, rsn, floor_id, method, status, outcome, tallied_at is not null as tallied, closed_at is not null as closed, round_ref, created_at
    from checkin where alert_id = ${alertId} order by created_at, id`;
const subscribersIn = async (alertId: string) => (await rowsOf(alertId)).map((row) => row.subscriber_id).sort();
/** The thread's tally by place and status. */
const tallyOf = async (alertId: string) =>
  Object.fromEntries((await owner`select rsn, floor_id, status, n from checkin_tally where alert_id = ${alertId}`).map((row) => [`${row.rsn}/${row.floor_id}/${row.status}`, row.n as number]));
const liveRowsOf = (subscriberId: string) => owner`select 1 from checkin where subscriber_id = ${subscriberId} and closed_at is null and tallied_at is null`;
const sorted = (ids: string[]) => [...ids].sort();

/** Waits until some session of the app's role waits for a lock (the race's second transaction is blocked behind the first). */
async function untilWaiting(): Promise<void> {
  for (let i = 0; i < 200; i += 1) {
    const waiting = await owner`select 1 from pg_stat_activity where usename = 'cvh_app_login' and wait_event_type = 'Lock'`;
    if (waiting.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("no session waited for a lock");
}

// --- the approval starts the round -------------------------------------------------------------------------------------------------------------

describe("an approved acknowledgement, update or correction of a round type starts the round (E08 'Round')", () => {
  it("for the whole of Thorncliffe Park: one row per requester living in its buildings on a covered floor, whatever they muted or chose", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 }, muted: ["heat"], groups: ["seniors"] });
    const onA2 = await subscriber({ request: { rsn: RSN_A, floor: A2, method: "text" }, places: [{ rsn: RSN_A, floor: A2 }, { rsn: RSN_C, floor: C1 }] });
    const onB1 = await subscriber({ request: { rsn: RSN_B, floor: B1 }, neighbourhood: "FP" });
    const uncovered = await subscriber({ request: { rsn: RSN_B, floor: B2 } });
    const elsewhere = await subscriber({ request: { rsn: RSN_C, floor: C1 }, neighbourhood: "FP" });
    const noRequest = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    // A sign-up that has not replied YES asks for a check-in on a covered floor: it is no requester yet.
    await owner`insert into pending_signup (id, phone, lang, neighbourhood_id, places, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
                values (${randomUUID()}, ${phoneOf(90)}, 'en', 'TP', ${owner.json([{ rsn: RSN_A, floors: [A1] }])}, '{}', '2026-10-01.1', 'web', 'call', ${CHECKIN_CONSENT_VERSION}, ${RSN_A}, ${A1})`;

    const ref = await pendingAck(neighbourhood(["heat"]));
    expect(await rowsOf(ref.alertId)).toEqual([]);
    await approve(ref);

    const rows = await rowsOf(ref.alertId);
    expect(sorted(rows.map((row) => row.subscriber_id!))).toEqual(sorted([onA1, onA2, onB1]));
    for (const id of [uncovered, elsewhere, noRequest]) expect(rows.map((row) => row.subscriber_id)).not.toContain(id);
    expect(rows.find((row) => row.subscriber_id === onA2)).toMatchObject({ rsn: RSN_A, floor_id: A2, method: "text", status: "pending", tallied: false, closed: false });
    // Each row's round_ref is its own random (version 4) UUID; the table has no column for a number.
    expect(new Set(rows.map((row) => row.round_ref)).size).toBe(3);
    for (const row of rows) expect(row.round_ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await owner`select column_name from information_schema.columns where table_name = 'checkin'`).map((row) => row.column_name)).not.toContain("phone");
    expect(await tallyOf(ref.alertId)).toEqual({ [`${RSN_A}/${A1}/requested`]: 1, [`${RSN_A}/${A2}/requested`]: 1, [`${RSN_B}/${B1}/requested`]: 1 });
  });

  it("for some floors of a building: only the requesters on those floors of it", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    await subscriber({ request: { rsn: RSN_A, floor: A2 } });
    await subscriber({ request: { rsn: RSN_B, floor: B1 } });
    const ref = await pendingAck(buildings([{ rsn: RSN_A, floors: [A1, A3] }], ["power"]));
    await approve(ref);
    expect(await subscribersIn(ref.alertId)).toEqual([onA1]);
  });

  it("only for receiving subscribers: a requester the end-of-pilot campaign asked is in no new round once its deadline has passed (S09.07's receivingSql)", async () => {
    const asked = await subscriber({ request: { rsn: RSN_A, floor: A1 }, state: "reconsent_pending" });
    const retained = await subscriber({ request: { rsn: RSN_A, floor: A2 }, state: "retained" });
    const campaignId = await realCampaign();
    // Before the deadline, the subscriber asked to stay still receives texts: both are in the round.
    const before = await pendingAck(neighbourhood(["heat"]));
    await approve(before);
    expect(await subscribersIn(before.alertId)).toEqual(sorted([asked, retained]));

    // After it, without her YES, she receives nothing (S09.08's purge deletes her later): a new round leaves her out. Her row in the round she is in
    // stays as it was, and the next approval there adds only a newcomer.
    await pastDeadline(campaignId);
    const after = await pendingAck(neighbourhood(["heat"]));
    await approve(after);
    expect(await subscribersIn(after.alertId)).toEqual([retained]);
    const newcomer = await subscriber({ request: { rsn: RSN_A, floor: A3 } });
    await approve(await pendingUpdate(before.alertId));
    expect(await subscribersIn(before.alertId)).toEqual(sorted([asked, retained, newcomer]));
  });

  it("makes no row for a type that is not a round type, a drill, a final, or a thread whose round type an alert of several types shares", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const water = await pendingAck(neighbourhood(["water"]));
    await approve(water);
    expect(await rowsOf(water.alertId)).toEqual([]);

    // One round type among the entry's types is enough.
    const mixed = await pendingAck(neighbourhood(["power", "water"]));
    await approve(mixed);
    expect(await subscribersIn(mixed.alertId)).toEqual([onA1]);

    const drill = await pendingAck(neighbourhood(["heat"]), true);
    await approve(drill);
    expect(await rowsOf(drill.alertId)).toEqual([]);

    // A final closes the thread and starts nothing: a requester who asked since gets no row in it.
    const heat = await pendingAck(neighbourhood(["heat"]));
    await approve(heat);
    const since = await subscriber({ request: { rsn: RSN_A, floor: A2 } });
    const made = await alerting.startFinal(actor(author), { alertId: heat.alertId }, { entryId: randomUUID(), text: "The heat warning is over." });
    if (!made.ok) throw new Error(`startFinal refused: ${made.error}`);
    const finalRef = { alertId: heat.alertId, entryId: made.value.entry.id };
    await freeze(finalRef, "final", null);
    await approve(finalRef);
    expect((await owner`select status from alert where id = ${heat.alertId}`)[0]).toEqual({ status: "closed" });
    // S08.08: the close tallies the round in the final's approval: the one row it had (unmarked) is now a closed stub, and none was added.
    expect(await rowsOf(heat.alertId)).toMatchObject([{ subscriber_id: null }]);
    expect(await tallyOf(heat.alertId)).toEqual({ [`${RSN_A}/${A1}/requested`]: 1, [`${RSN_A}/${A1}/unmarked`]: 1 });
    expect(await liveRowsOf(since)).toHaveLength(0);
  });

  it("ends a final's round after the final's capture: the recipients' rows are locked before the round's (AD-18, S08.08)", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const heat = await pendingAck(neighbourhood(["heat"]));
    await approve(heat);
    const made = await alerting.startFinal(actor(author), { alertId: heat.alertId }, { entryId: randomUUID(), text: "The heat warning is over." });
    if (!made.ok) throw new Error(`startFinal refused: ${made.error}`);
    const finalRef = { alertId: heat.alertId, entryId: made.value.entry.id };
    await freeze(finalRef, "final", null);
    // A mark holds the round's row (it locks that row only, S08.07).
    const reached = deferred();
    const hold = deferred();
    const marking = appSql.begin(async (tx) => {
      await tx`select 1 from checkin where alert_id = ${heat.alertId} for update`;
      reached.resolve();
      await hold.promise;
    });
    await reached.promise;
    const approving = approve(finalRef);
    await untilWaiting();
    // The approval waits for the round's row holding its recipient's row already (FOR SHARE, the capture's): it was captured first.
    const recipientHeld = await owner`select 1 from subscriber where id = ${onA1} for update nowait`.then(
      () => false,
      (error: unknown) => /could not obtain lock/.test(String(error)),
    );
    hold.resolve();
    await marking;
    await approving;
    expect(recipientHeld).toBe(true);
    expect(await rowsOf(heat.alertId)).toMatchObject([{ subscriber_id: null, outcome: "unmarked", closed: true }]);
  });

  it("refuses any check-in row for a drill thread, whoever inserts it (the trigger, direct SQL)", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const drill = await pendingAck(neighbourhood(["heat"]), true);
    await approve(drill);
    const insert = (sql: postgres.Sql) =>
      sql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${drill.alertId}, ${onA1}, ${RSN_A}, ${A1}, 'call')`;
    await expect(insert(appSql)).rejects.toThrow(/a drill thread has no check-in round/);
    await expect(insert(owner)).rejects.toThrow(/a drill thread has no check-in round/);
    expect(await rowsOf(drill.alertId)).toEqual([]);
  });

  it("a D-1 post's publication at submit starts no round; its approval does", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const posted = await alerting.postFromAmbassador(actor(ambassador, "aal1"), {
      into: null,
      alertId: randomUUID(),
      entryId: randomUUID(),
      place: { rsn: RSN_A, floors: null },
      types: ["power"],
      phase: "problem",
      validUntil: inDays(0.5),
      validUntilMode: "at",
      text: "The power is out on every floor. Building staff have been told.",
    });
    if (!posted.ok) throw new Error(`postFromAmbassador refused: ${posted.error}`);
    const ref = { alertId: posted.value.thread.id, entryId: posted.value.entry.id };
    const wholeSet = (english: string): Translated[] =>
      FROZEN_LANGS.map((lang): Translated =>
        lang === "zh-Hant"
          ? { lang, body: `${english} (zh-Hant)`, machine: true, model: "opencc-js 1.4.2", status: "script_converted", source_hash: sha(english), conversion: { from: "zh", from_text_hash: sha(`${english} (zh)`), opencc_version: "1.4.2", config: "test" } }
          : { lang, body: `${english} (${lang})`, machine: true, model: "m1", status: "ok", source_hash: sha(english) },
      );
    const preparer = createEntryPreparer({ translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) }, freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE_URL }) });
    const report = await createSubmitter({ lifecycle: alerting, preparer, ops: { record: async () => undefined } }).submit(actor(ambassador, "aal1"), ref, randomUUID());
    expect(report.state).toBe("committed");
    // Residents read it at once, "Not yet verified" (S08.03); nobody is in a round for it yet.
    expect((await owner`select web_published_at is not null as published, status from alert_entry where id = ${ref.entryId}`)[0]).toEqual({ published: true, status: "pending_approval" });
    expect(await rowsOf(ref.alertId)).toEqual([]);

    await approve(ref);
    expect(await subscribersIn(ref.alertId)).toEqual([onA1]);
  });
});

describe("a later approval in the same thread", () => {
  it("adds the matching requesters without a row and leaves the rows already made, and their marks, as they are", async () => {
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const onA2 = await subscriber({ request: { rsn: RSN_A, floor: A2 } });
    const ack = await pendingAck(buildings([{ rsn: RSN_A, floors: null }], ["power"]));
    await approve(ack);
    expect(await subscribersIn(ack.alertId)).toEqual(sorted([onA1, onA2]));
    // The ambassador marked the first; a resident asked since without joining (made directly, as no activation ran).
    await appSql`update checkin set status = 'done' where subscriber_id = ${onA1}`;
    const before = (await rowsOf(ack.alertId)).find((row) => row.subscriber_id === onA1)!;
    const onA3 = await subscriber({ request: { rsn: RSN_A, floor: A3 } });
    const onB1 = await subscriber({ request: { rsn: RSN_B, floor: B1 } });

    // An update that widens the alert to the whole of Thorncliffe Park.
    const update = await pendingUpdate(ack.alertId, neighbourhood(["power"]));
    await approve(update);
    expect(await subscribersIn(ack.alertId)).toEqual(sorted([onA1, onA2, onA3, onB1]));
    const after = (await rowsOf(ack.alertId)).find((row) => row.subscriber_id === onA1)!;
    expect(after).toEqual(before);
    expect(after.status).toBe("done");

    // A correction of the update: the one newcomer since is added, and no one gets a second row.
    const newcomer = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const made = await alerting.correctEntry(actor(author), { alertId: ack.alertId, targetId: update.entryId }, { entryId: randomUUID(), text: "Still hot: cooling rooms open until 10 pm.", phase: "in_progress", validUntil: inDays(1), validUntilMode: "at" });
    if (!made.ok) throw new Error(`correctEntry refused: ${made.error}`);
    const correction = { alertId: ack.alertId, entryId: made.value.entry.id };
    await freeze(correction, "correction", update.entryId);
    await approve(correction);
    const rows = await rowsOf(ack.alertId);
    expect(sorted(rows.map((row) => row.subscriber_id!))).toEqual(sorted([onA1, onA2, onA3, onB1, newcomer]));
    expect(rows.find((row) => row.subscriber_id === onA1)).toEqual(before);
    // `requested` counts each row once, when it was made.
    expect(await tallyOf(ack.alertId)).toEqual({ [`${RSN_A}/${A1}/requested`]: 2, [`${RSN_A}/${A2}/requested`]: 1, [`${RSN_A}/${A3}/requested`]: 1, [`${RSN_B}/${B1}/requested`]: 1 });
  });
});

// --- the Admin's round types --------------------------------------------------------------------------------------------------------------------

describe("an Admin changes which types are round types (E08 'Round types')", () => {
  const roundTypes = () => createRoundTypes({ db: app, audit });
  const auditRows = () =>
    owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_type: string; subject_id: string | null; meta: Record<string, unknown> }[]>`
      select action, outcome, actor_staff_id, subject_type, subject_id, meta from audit_event where id > ${auditBaseline} and action = 'round_types.changed' order by id`;

  it("is audited with the types before and after, and applies from the next approval only: the rows already made stay", async () => {
    expect((await roundTypes().list()).filter((choice) => choice.round).map((choice) => choice.id)).toEqual(["heat", "power"]);
    const onA1 = await subscriber({ request: { rsn: RSN_A, floor: A1 } });
    const power = await pendingAck(buildings([{ rsn: RSN_A, floors: null }], ["power"]));
    await approve(power);
    expect(await subscribersIn(power.alertId)).toEqual([onA1]);

    expect(await roundTypes().set(admin.id, ["heat"])).toEqual({ ok: true, value: { roundTypes: ["heat"], previous: ["heat", "power"] } });
    expect(await auditRows()).toEqual([
      { action: "round_types.changed", outcome: "ok", actor_staff_id: admin.id, subject_type: "disruption_type", subject_id: null, meta: { round_types: ["heat"], previous: ["heat", "power"] } },
    ]);
    // The power round already started keeps its row; the next approval in it adds no one, and a new power alert starts no round.
    const onA2 = await subscriber({ request: { rsn: RSN_A, floor: A2 } });
    await approve(await pendingUpdate(power.alertId));
    expect(await subscribersIn(power.alertId)).toEqual([onA1]);
    expect(await liveRowsOf(onA1)).toHaveLength(1);
    const another = await pendingAck(buildings([{ rsn: RSN_A, floors: null }], ["power"]));
    await approve(another);
    expect(await rowsOf(another.alertId)).toEqual([]);

    // Power again: the next approval in the thread adds the requester who had none.
    expect(await roundTypes().set(admin.id, ["power", "heat", "power"])).toEqual({ ok: true, value: { roundTypes: ["heat", "power"], previous: ["heat"] } });
    await approve(await pendingUpdate(power.alertId));
    expect(await subscribersIn(power.alertId)).toEqual(sorted([onA1, onA2]));

    // None at all is allowed: no alert then starts a round.
    expect(await roundTypes().set(admin.id, [])).toEqual({ ok: true, value: { roundTypes: [], previous: ["heat", "power"] } });
    const heat = await pendingAck(neighbourhood(["heat"]));
    await approve(heat);
    expect(await rowsOf(heat.alertId)).toEqual([]);
  });

  it("refuses what is not a type of disruption and a change that changes nothing, audited as refused with the reason only", async () => {
    expect(await roundTypes().set(admin.id, ["heat", "power"])).toEqual({ ok: false, error: "no_change" });
    expect(await roundTypes().set(admin.id, ["heat", "tornado"])).toEqual({ ok: false, error: "unknown_type" });
    expect(await roundTypes().set(admin.id, ["Heat"])).toEqual({ ok: false, error: "unknown_type" });
    expect(await roundTypes().set(admin.id, [42])).toEqual({ ok: false, error: "unknown_type" });
    expect((await auditRows()).map((row) => [row.outcome, row.meta])).toEqual([
      ["refused", { reason: "conflict" }],
      ["refused", { reason: "validation" }],
      ["refused", { reason: "validation" }],
      ["refused", { reason: "validation" }],
    ]);
    expect((await owner`select id from disruption_type where checkin order by id`).map((row) => row.id)).toEqual(["heat", "power"]);
  });

  it("lets the app change that one column of the types and nothing else", async () => {
    await expect(appSql`update disruption_type set direct = false where id = 'power'`).rejects.toThrow(/permission denied/);
    await expect(appSql`insert into disruption_type (id, direct, checkin) values ('tornado', null, true)`).rejects.toThrow(/permission denied/);
    await expect(appSql`delete from disruption_type where id = 'winter'`).rejects.toThrow(/permission denied/);
    await appSql`update disruption_type set checkin = true where id = 'winter'`;
    expect((await owner`select checkin from disruption_type where id = 'winter'`)[0]).toEqual({ checkin: true });
  });
});

// --- races --------------------------------------------------------------------------------------------------------------------------------------

describe("a requester withdraws or is deleted while an approval is creating the round (E08 'Request lock order')", () => {
  // The requester muted heat, so she is no recipient of the approval's texts: the race is the round's own (the capture locks her row FOR SHARE as a
  // requester, with the recipients', and `ensureRound` reads her request under that lock).
  const requester = () => subscriber({ request: { rsn: RSN_A, floor: A1 }, muted: ["heat"] });

  /** The approval, held open after its round's rows are made (it holds the thread, the requesters FOR SHARE and the new rows). */
  function heldApproval(ref: EntryRef) {
    const reached = deferred();
    const hold = deferred();
    const real = checkinsOn();
    const lifecycle = alertingWith({
      checkins: {
        ensureRound: async (tx, thread, ids) => {
          const added = await real.ensureRound(tx, thread, ids);
          reached.resolve();
          await hold.promise;
          return added;
        },
      },
    });
    return { done: approve(ref, lifecycle), reached: reached.promise, release: hold.resolve };
  }

  /** checkins' requests whose edit lock (`lockForEdit`) is held once taken: a withdrawal stopped after it locked the subscriber's row. */
  function heldEdit() {
    const reached = deferred();
    const hold = deferred();
    const store: RequestStore = {
      ...checkinRequestStore(),
      lockForEdit: async (tx, subscriberId) => {
        const locked = await checkinRequestStore().lockForEdit(tx, subscriberId);
        reached.resolve();
        await hold.promise;
        return locked;
      },
    };
    return { checkins: checkinsOn(store), reached: reached.promise, release: hold.resolve };
  }

  /** E07's deletion of everything held for the number (STOP, a confirmed 0), as the router runs it, with checkins' real port (or one given). */
  const deletion = (checkins: { lockRounds(id: string, tx: Parameters<CheckinRequests["lockRounds"]>[1]): Promise<void>; deleteForSubscriber: CheckinRequests["deleteForSubscriber"] } = checkinsOn()) =>
    createNumberDeletion({ skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient), checkins });
  const phoneOfSubscriber = async (id: string) => (await owner`select phone from subscriber where id = ${id}`)[0]!.phone as string;

  it("the approval first: the withdrawal waits for the subscriber's row, then turns the row it made into a stub tallied withdrawn", async () => {
    const id = await requester();
    const ref = await pendingAck(neighbourhood(["heat"]));
    const approval = heldApproval(ref);
    await approval.reached;
    const withdrawal = app.transaction((tx) => checkinsOn().withdrawRequest(id, tx));
    await untilWaiting();
    approval.release();
    await approval.done;
    expect(await withdrawal).toBe("withdrawn");
    expect(await liveRowsOf(id)).toHaveLength(0);
    expect(await rowsOf(ref.alertId)).toMatchObject([{ subscriber_id: null, method: null, outcome: "withdrawn", tallied: true, closed: true }]);
    expect(await tallyOf(ref.alertId)).toEqual({ [`${RSN_A}/${A1}/requested`]: 1, [`${RSN_A}/${A1}/withdrawn`]: 1 });
  });

  it("the withdrawal first: the approval waits for the subscriber's row, then makes no row", async () => {
    const id = await requester();
    const ref = await pendingAck(neighbourhood(["heat"]));
    const edit = heldEdit();
    const withdrawal = app.transaction((tx) => edit.checkins.withdrawRequest(id, tx));
    await edit.reached;
    const approval = approve(ref);
    await untilWaiting();
    edit.release();
    expect(await withdrawal).toBe("withdrawn");
    await approval;
    expect(await rowsOf(ref.alertId)).toEqual([]);
    expect((await owner`select checkin_method from subscriber where id = ${id}`)[0]).toEqual({ checkin_method: null });
  });

  it("the approval first: the deletion waits for the subscriber's row, then closes the row it made before deleting the subscriber", async () => {
    const id = await requester();
    const phone = await phoneOfSubscriber(id);
    const ref = await pendingAck(neighbourhood(["heat"]));
    const approval = heldApproval(ref);
    await approval.reached;
    const deleting = app.transaction((tx) => deletion().deleteNumber(tx, phone));
    await untilWaiting();
    approval.release();
    await approval.done;
    expect(await deleting).toMatchObject({ subscriber: true });
    expect(await owner`select 1 from subscriber where id = ${id}`).toHaveLength(0);
    expect(await rowsOf(ref.alertId)).toMatchObject([{ subscriber_id: null, method: null, outcome: "withdrawn", tallied: true, closed: true }]);
  });

  it("the deletion first: the approval waits for the subscriber's row, finds it gone and makes no row", async () => {
    const id = await requester();
    const phone = await phoneOfSubscriber(id);
    const ref = await pendingAck(neighbourhood(["heat"]));
    const reached = deferred();
    const hold = deferred();
    const real = checkinsOn();
    const deleting = app.transaction((tx) =>
      deletion({
        lockRounds: (subscriberId, inner) => real.lockRounds(subscriberId, inner),
        deleteForSubscriber: async (subscriberId, inner) => {
          await real.deleteForSubscriber(subscriberId, inner);
          reached.resolve();
          await hold.promise;
        },
      }).deleteNumber(tx, phone),
    );
    await reached.promise;
    const approval = approve(ref);
    await untilWaiting();
    hold.resolve();
    await deleting;
    await approval;
    expect(await rowsOf(ref.alertId)).toEqual([]);
    expect(await owner`select 1 from subscriber where id = ${id}`).toHaveLength(0);
  });
});

describe("a request activated while the approval that starts the round runs (S08.06: the approval waiting is among the request's candidate threads)", () => {
  const request = { method: "call" as const, rsn: RSN_A, floorId: A1, consentVersion: CHECKIN_CONSENT_VERSION };

  it("the approval first (held after it looked for requesters): the request waits for the thread, then joins the round the approval made", async () => {
    // Someone to text, so the approval reaches its spend cap's check, after its round, and is held there.
    await subscriber({ places: [{ rsn: RSN_A, floor: A2 }] });
    const id = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }], muted: ["heat"] });
    const ref = await pendingAck(neighbourhood(["heat"]));
    const reached = deferred();
    const hold = deferred();
    const lifecycle = alertingWith({
      spendCap: async () => {
        reached.resolve();
        await hold.promise;
        return null;
      },
    });
    const approval = approve(ref, lifecycle);
    await reached.promise;
    expect(await rowsOf(ref.alertId)).toEqual([]);
    const activation = app.transaction((tx) => checkinsOn().activate(id, request, tx));
    await untilWaiting();
    hold.resolve();
    await approval;
    expect(await activation).toBe("requested");
    expect(await rowsOf(ref.alertId)).toMatchObject([{ subscriber_id: id, rsn: RSN_A, floor_id: A1, method: "call", closed: false }]);
  });

  it("the request first (held after it locked the subscriber's row): the approval waits for the thread, then finds the requester", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }], muted: ["heat"] });
    const ref = await pendingAck(neighbourhood(["heat"]));
    const edit = heldEdit();
    const activation = app.transaction((tx) => edit.checkins.activate(id, request, tx));
    await edit.reached;
    const approval = approve(ref);
    await untilWaiting();
    edit.release();
    expect(await activation).toBe("requested");
    await approval;
    expect(await rowsOf(ref.alertId)).toMatchObject([{ subscriber_id: id, rsn: RSN_A, floor_id: A1, method: "call", closed: false }]);
  });

  /** checkins' requests whose edit lock is held once taken. */
  function heldEdit() {
    const reached = deferred();
    const hold = deferred();
    const store: RequestStore = {
      ...checkinRequestStore(),
      lockForEdit: async (tx, subscriberId) => {
        const locked = await checkinRequestStore().lockForEdit(tx, subscriberId);
        reached.resolve();
        await hold.promise;
        return locked;
      },
    };
    return { checkins: checkinsOn(store), reached: reached.promise, release: hold.resolve };
  }
});

describe("the end-of-pilot campaign starts while an approval is creating the round (AD-18: one id order for every subscriber row)", () => {
  it("a requester who is not texted, her id below a recipient's: the campaign's lock of every active subscriber waits for the approval, and both go through", async () => {
    // She muted heat, so she is a requester and no recipient; he is texted. Her id comes first: locked in a second pass, after his, she could be
    // held by the campaign while it waits for him.
    const requester = await subscriber({ id: "00000000-0000-4000-8000-000000000001", request: { rsn: RSN_A, floor: A1 }, muted: ["heat"] });
    const recipient = await subscriber({ id: "ffffffff-ffff-4fff-bfff-ffffffffffff", places: [{ rsn: RSN_A, floor: A2 }] });
    const ref = await pendingAck(neighbourhood(["heat"]));
    // The approval, held where its round's rows are about to be made: its recipients are captured and its texts queued.
    const reached = deferred();
    const hold = deferred();
    const real = checkinsOn();
    const lifecycle = alertingWith({
      checkins: {
        ensureRound: async (tx, thread, ids) => {
          reached.resolve();
          await hold.promise;
          return real.ensureRound(tx, thread, ids);
        },
      },
    });
    const approval = approve(ref, lifecycle);
    await reached.promise;
    // The campaign start's own statement (S09.07's `lockActive`): every active subscriber locked FOR NO KEY UPDATE in id order, as the app's role.
    const campaign = app.transaction((tx) => campaignStore.lockActive(tx));
    await untilWaiting();
    hold.resolve();
    // In two passes, Postgres would abort one of them as a deadlock (40P01).
    const [approved, locked] = await Promise.all([approval, campaign]);
    expect(approved).toMatchObject({ recipients: { total: 1 } });
    expect(locked.map((row) => row.id)).toEqual([requester, recipient]);
    expect(await subscribersIn(ref.alertId)).toEqual([requester]);
  });
});
