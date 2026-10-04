// Approved alerts reach exactly the matching subscribers (S07.07, FR-A1 SMS, FR-A2, FR-A16 SMS, AR-11, FR-A3 recipients per language), against a real database as the app's
// own role (cvh_app_login). The lifecycle is the real one with the real recipient port (subscriptions' `captureRecipients` and `countRecipients`), the real outbox and, where
// a text is sent, the real sender with the real ContactResolver on the subscriber table; the provider is a fake and the numbers are fictitious (the 555 exchange). Nothing
// here reaches Twilio.
//  - the matching rule on the real approval path: confirmed subscribers whose building and floor match get one text in their language; unconfirmed (a pending sign-up),
//    stopped (deleted), muted and non-matching never do; the reviewed count per language equals the texts written;
//  - exactly once: a subscriber with several places in the audience, a second approval and a second run of the sender never make a second text;
//  - a fallback language gets the English text with `translation.unavailable` in its own language, and the approver saw how many;
//  - a correction of an SMS alert to 120 reaches the same 120 by text, in their current language, marked as a correction, the original's queued texts stopped, and the web
//    shows the correction above the original; a withdrawal and a final reach the target's / the thread's recipients plus their own audience; a deleted recipient gets nothing;
//  - a subscriber who signs up, changes places or unsubscribes during the approval is wholly in or wholly out;
//  - a drill never reaches a subscriber, and a paused sender hands nothing over.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { Audience } from "../../src/contracts/audience";
import { entriesNewestFirst } from "../../src/contracts/feed";
import { smsStrings } from "../../src/i18n/smsStrings";
import { createAlerting, createResidentAlerts, freezeContent, type AlertActor, type AlertLifecycle, type EntryContent, type EntryRef, type FrozenContent } from "../../src/modules/alerting";
import { createContactResolver, createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding } from "../../src/modules/places";
import { captureRecipients, countRecipients, createInboundRouter, recipientsPort, subscriberNumberSource, type RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { submitSeams } from "./alertSubmitSeams";
import { deferred, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

const BASE_URL = "https://cvh.example";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const RSN_A = "9200001";
const RSN_B = "9200002";
const RSN_C = "9200003";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const [A1, A2, A3, A4] = [1, 2, 3, 4].map((i) => floorId(RSN_A, i)) as [string, string, string, string];
const [B1, B2] = [1, 2].map((i) => floorId(RSN_B, i)) as [string, string];

const buildingAudience = (buildings: { rsn: string; floors: string[] | null }[], types: string[] = ["power"], groups: Audience["groups"] = []): Audience => ({
  scope: "buildings",
  buildings: [...buildings].sort((a, b) => (a.rsn < b.rsn ? -1 : 1)),
  groups,
  types: [...types].sort(),
});
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
let auditBaseline = 0;
const madeNeighbourhoods: string[] = [];

let author: { id: string };
let approver: { id: string };
let admin: { id: string };
let secondAdmin: { id: string };

const actor = (who: { id: string }): AlertActor => ({ staffId: who.id, aal: "aal2" });
const alertingWith = (recipients: RecipientsPort) => createAlerting({ db: app, recipients, pricePerSegmentCents: () => 1.5 });

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
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  for (const [id, fsa] of [["TP", "M4H"], ["FP", "M3C"]] as const) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${`Fixture ${id}`}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nbhd, floors] of [[RSN_A, "TP", 4], [RSN_B, "TP", 2], [RSN_C, "FP", 2]] as const) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${rsn}, ${nbhd}, ${`${rsn} Test Dr`}, 43.7, -79.34, now()) on conflict do nothing`;
    for (let index = 1; index <= floors; index += 1) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${String(index)}, ${index}, true) on conflict do nothing`;
    }
  }
  alerting = createAlerting({ db: app, pricePerSegmentCents: () => 1.5 });
  seams = submitSeams(owner, alerting);
});

async function resetAll() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner.begin(async (tx) => {
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
  await owner`delete from pending_signup`;
  await owner`delete from subscriber`;
  await world.reset();
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn in (${RSN_A}, ${RSN_B}, ${RSN_C})`;
  await owner`delete from building where rsn in (${RSN_A}, ${RSN_B}, ${RSN_C})`;
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
  author = await world.fx.staff("coordinator");
  approver = await world.fx.staff("coordinator");
  admin = await world.fx.staff("admin");
  secondAdmin = await world.fx.staff("admin");
});

// --- fixtures ---------------------------------------------------------------------------------------------------------------------------------------

interface SubscriberSpec {
  lang?: string;
  neighbourhood?: string;
  groups?: string[];
  places?: { rsn: string; floor?: string | null }[];
  muted?: string[];
  state?: "active" | "reconsent_pending" | "retained";
}

const phoneOf = (index: number) => `+1416555${String(index).padStart(4, "0")}`;

/** A confirmed subscriber (a row of `subscriber`) with the places and the muted topics given; returns its id. */
async function subscriber(spec: SubscriberSpec = {}): Promise<string> {
  const id = randomUUID();
  phoneCounter += 1;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
    values (${id}, ${phoneOf(phoneCounter)}, ${spec.lang ?? "en"}, ${spec.neighbourhood ?? "TP"}, ${spec.groups ?? []}, '2026-10-01.1', 'web', ${spec.state ?? "active"})`;
  for (const place of spec.places ?? []) await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${place.rsn}, ${place.floor ?? null})`;
  for (const topic of spec.muted ?? []) await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${id}, ${topic})`;
  return id;
}

/** A sign-up that has not replied YES (a `pending_signup`): it matches everything a subscriber would and must never be texted. */
async function pendingSignup(spec: SubscriberSpec = {}): Promise<string> {
  const id = randomUUID();
  phoneCounter += 1;
  await owner`insert into pending_signup (id, phone, lang, neighbourhood_id, places, groups, consent_version, started_by)
    values (${id}, ${phoneOf(phoneCounter)}, ${spec.lang ?? "en"}, ${spec.neighbourhood ?? "TP"}, ${owner.json((spec.places ?? []).map((place) => ({ rsn: place.rsn, floors: place.floor ? [place.floor] : [] })))}, ${spec.groups ?? []}, '2026-10-01.1', 'web')`;
  return id;
}

const contentOf = (audience: Audience, over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out in the building. We are finding out more.",
  types: [...audience.types],
  audience,
  phase: "problem",
  validUntil: inDays(1),
  ...over,
});

/** Freezes an entry of `ref` as a real submit freezes it (the one renderer, every launch language) and submits it. */
async function freeze(ref: EntryRef, kind: string, supersedesId: string | null, by: { id: string } = author, isDrill = false): Promise<FrozenContent> {
  const entry = await alerting.getEntry(ref);
  const thread = await alerting.getThread(ref.alertId);
  if (!entry || !thread) throw new Error("no such entry");
  const text = entry.content.text;
  const frozen = freezeContent({
    alertId: ref.alertId,
    kind: kind as "ack",
    supersedesId,
    isDrill,
    channels: ["sms", "web"],
    content: entry.content,
    translations: [
      { lang: "ur", body: `بجلی بند ہے۔ ${text.length}`, machine: true, model: "m1", status: "translated", sourceHash: sha(text) },
      { lang: "es", body: `Sin luz. ${text.length}`, machine: true, model: "m1", status: "translated", sourceHash: sha(text) },
      // Every route failed for these: the English text, which the text message labels `translation.unavailable` in the reader's language.
      ...["ps", "ta", "fr", "hi", "pa"].map((lang) => ({ lang, body: text, machine: false, model: null, status: "fallback_en" as const, sourceHash: sha(text) })),
    ],
    verified: true,
    attribution: { role: "hub" },
    slug: thread.slug,
    publicBaseUrl: BASE_URL,
  });
  if (!frozen.ok) throw new Error(`freeze refused: ${frozen.error}`);
  const submitted = await seams.freeze(actor(by), ref, frozen.value);
  if (!submitted.ok) throw new Error(`submit refused: ${submitted.error}`);
  return frozen.value;
}

/** A thread's first entry, submitted and waiting for approval. */
async function pendingAck(audience: Audience, over: Partial<EntryContent> = {}, isDrill = false): Promise<{ ref: EntryRef; frozen: FrozenContent }> {
  const by = isDrill ? admin : author; // a drill is an Admin's
  const created = await alerting.createAlert(actor(by), { kind: "ack", isDrill, reportedAt: new Date(Date.now() - 60_000), content: contentOf(audience, over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  return { ref, frozen: await freeze(ref, "ack", null, by, isDrill) };
}

/** What the approver is shown, then approves (exactly what the screen does): the reviewed count is the port's count. */
async function approve(ref: EntryRef, by: { id: string } = approver, lifecycle: AlertLifecycle = alerting) {
  const review = await lifecycle.review(ref);
  if (!review) throw new Error("nothing to review");
  const [row] = await owner<{ version: number; content_hash: string }[]>`select version, content_hash from alert_entry where id = ${ref.entryId}`;
  const result = await lifecycle.approveEntry(actor(by), ref, { version: row!.version, contentHash: row!.content_hash, recipients: { total: review.recipients.total, byLanguage: review.recipients.byLanguage } });
  return { result, review };
}

async function approved(ref: EntryRef, by?: { id: string }) {
  const { result } = await approve(ref, by);
  if (!result.ok) throw new Error(`approve refused: ${result.error}`);
  return result.value;
}

const deliveriesOf = (entryId: string) =>
  owner<{ recipient_kind: string; recipient_id: string | null; lang: string; body: string; segments: number; kind: string; state: string }[]>`
    select recipient_kind, recipient_id, lang, body, segments, kind, state from delivery where entry_id = ${entryId} order by recipient_id`;
const recipientsOf = async (entryId: string) => (await deliveriesOf(entryId)).map((row) => row.recipient_id).sort();

const sorted = (ids: (string | null)[]) => [...ids].sort();

/** Runs the sender until it has nothing more to hand over (it paces itself, so one run does not take a whole queue). */
async function drain() {
  let idle = 0;
  for (let run = 0; run < 60 && idle < 2; run += 1) {
    const before = world.provider.calls.length;
    await world.dispatcher().run();
    idle = world.provider.calls.length === before ? idle + 1 : 0;
  }
}

// --- the matching rule on the real approval path ----------------------------------------------------------------------------------------------

describe("an approved alert reaches exactly the matching subscribers", () => {
  it("texts the confirmed subscribers whose building and floor match, each once in their language, and nobody else", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: [A2, A3] }]);
    const wanted = [
      await subscriber({ lang: "en", places: [{ rsn: RSN_A, floor: A2 }] }),
      await subscriber({ lang: "ur", places: [{ rsn: RSN_A, floor: A3 }] }),
      await subscriber({ lang: "es", places: [{ rsn: RSN_A, floor: null }] }), // no floor recorded in the building: reached by any floor of it
      await subscriber({ lang: "ta", places: [{ rsn: RSN_A, floor: A2 }, { rsn: RSN_B, floor: B1 }] }), // several places, one match
      await subscriber({ lang: "fr", places: [{ rsn: RSN_C, floor: null }, { rsn: RSN_A, floor: A3 }], state: "retained" }),
      await subscriber({ lang: "ur", places: [{ rsn: RSN_A, floor: A3 }], state: "reconsent_pending" }),
    ];
    const notWanted = [
      await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] }), // another floor
      await subscriber({ places: [{ rsn: RSN_A, floor: A4 }, { rsn: RSN_A, floor: A1 }] }), // floors recorded, none of them the audience's
      await subscriber({ places: [{ rsn: RSN_B, floor: B1 }] }), // another building
      await subscriber({ places: [] }), // no building recorded: neighbourhood alerts only
      await subscriber({ places: [{ rsn: RSN_A, floor: A2 }], muted: ["power"] }), // muted the only topic
    ];
    // Nobody confirmed: a pending sign-up that matches in every way, and a subscriber who texted STOP (deleted).
    const pending = await pendingSignup({ places: [{ rsn: RSN_A, floor: A2 }] });
    const stopped = await subscriber({ places: [{ rsn: RSN_A, floor: A2 }] });
    await owner`delete from subscriber where id = ${stopped}`;

    const { ref, frozen } = await pendingAck(audience);
    const review = await alerting.review(ref);
    // The reviewed count: the matching, receiving subscribers per language of the text each gets.
    expect(review?.recipients).toEqual({ open: true, total: 6, byLanguage: { en: 1, ur: 2, es: 1, ta: 1, fr: 1 } });
    const done = await approved(ref);
    expect(done.recipients).toEqual({ total: 6, byLanguage: { en: 1, ur: 2, es: 1, ta: 1, fr: 1 } });

    const rows = await deliveriesOf(ref.entryId);
    expect(rows.every((row) => row.kind === "alert" && row.recipient_kind === "subscriber")).toBe(true);
    expect(sorted(rows.map((row) => row.recipient_id))).toEqual(sorted(wanted));
    for (const id of [...notWanted, pending, stopped]) expect(rows.map((row) => row.recipient_id)).not.toContain(id);
    // Each text is the entry's frozen body for the language of the subscriber, byte for byte.
    const langOf = new Map((await owner<{ id: string; lang: string }[]>`select id, lang from subscriber`).map((row) => [row.id, row.lang]));
    for (const row of rows) {
      const own = langOf.get(row.recipient_id as string)!;
      expect(row.lang, own).toBe(own);
      expect(row.body, own).toBe(frozen.smsBodies[own].body);
      expect(row.segments, own).toBe(frozen.smsBodies[own].segments);
    }
    // The audit holds the count of people, never who.
    const record = (await owner`select meta from audit_event where id > ${auditBaseline} and action = 'entry.approved' order by id desc limit 1`)[0];
    expect(record?.meta).toMatchObject({ recipient_count: 6 });
  });

  it("gives a fallback language the English text with translation.unavailable in that language, and the approver saw how many", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: null }]);
    const [ps1, ps2, ur1] = [
      await subscriber({ lang: "ps", places: [{ rsn: RSN_A }] }),
      await subscriber({ lang: "ps", places: [{ rsn: RSN_A }] }),
      await subscriber({ lang: "ur", places: [{ rsn: RSN_A }] }),
    ];
    const { ref, frozen } = await pendingAck(audience);
    const review = await alerting.review(ref);
    expect(review?.texts.find((text) => text.lang === "ps")?.status).toBe("fallback_en");
    expect(review?.texts.find((text) => text.lang === "ur")?.status).toBe("translated");
    // The approver's count has them under Pashto, the language of the text they get.
    expect(review?.recipients).toEqual({ open: true, total: 3, byLanguage: { ps: 2, ur: 1 } });
    await approved(ref);
    const rows = new Map((await deliveriesOf(ref.entryId)).map((row) => [row.recipient_id, row]));
    for (const id of [ps1, ps2]) {
      const row = rows.get(id)!;
      expect(row.lang).toBe("ps");
      expect(row.body).toBe(frozen.smsBodies.ps.body);
      // The English words, and `translation.unavailable` in the subscriber's own language.
      expect(row.body).toContain("Power is out in the building.");
      expect(row.body).toContain(smsStrings("ps").unavailable);
    }
    expect(rows.get(ur1)!.body).not.toContain(smsStrings("ur").unavailable);
  });

  it("applies the topic opt-outs and the fire and evacuation override", async () => {
    const power = buildingAudience([{ rsn: RSN_A, floors: null }], ["power"]);
    const fire = buildingAudience([{ rsn: RSN_A, floors: null }], ["fire"]);
    const both = buildingAudience([{ rsn: RSN_A, floors: null }], ["power", "water"]);
    const muter = await subscriber({ places: [{ rsn: RSN_A }], muted: ["power", "fire"] });
    const partial = await subscriber({ places: [{ rsn: RSN_A }], muted: ["power"] });
    const plain = await subscriber({ places: [{ rsn: RSN_A }] });

    const a = await pendingAck(power);
    await approved(a.ref);
    expect(await recipientsOf(a.ref.entryId)).toEqual(sorted([plain]));

    const b = await pendingAck(fire);
    await approved(b.ref);
    expect(await recipientsOf(b.ref.entryId)).toEqual(sorted([muter, partial, plain]));

    // An alert on several types still reaches someone who muted only some of them.
    const c = await pendingAck(both);
    await approved(c.ref);
    expect(await recipientsOf(c.ref.entryId)).toEqual(sorted([muter, partial, plain]));
  });

  it("narrows by groups, and a neighbourhood alert reaches everyone in the neighbourhood, the no-building subscriber included", async () => {
    const seniors = await subscriber({ neighbourhood: "TP", groups: ["seniors"], places: [{ rsn: RSN_A }] });
    const families = await subscriber({ neighbourhood: "TP", groups: ["families"] });
    const noBuilding = await subscriber({ neighbourhood: "TP" });
    const elsewhere = await subscriber({ neighbourhood: "FP", places: [{ rsn: RSN_C }] });

    const whole: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
    const a = await pendingAck(whole);
    await approved(a.ref);
    expect(await recipientsOf(a.ref.entryId)).toEqual(sorted([seniors, families, noBuilding]));
    expect(await recipientsOf(a.ref.entryId)).not.toContain(elsewhere);

    const narrowed: Audience = { ...whole, groups: ["seniors"] };
    const b = await pendingAck(narrowed);
    await approved(b.ref);
    expect(await recipientsOf(b.ref.entryId)).toEqual(sorted([seniors]));
  });

  it("makes exactly one text per subscriber: a second approval, a subscriber with many places in the audience and a second run of the sender add none", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: null }, { rsn: RSN_B, floors: null }]);
    const ids = [
      await subscriber({ places: [{ rsn: RSN_A, floor: A1 }, { rsn: RSN_A, floor: A2 }, { rsn: RSN_B, floor: B1 }] }),
      await subscriber({ places: [{ rsn: RSN_B, floor: B2 }] }),
    ];
    const { ref } = await pendingAck(audience);
    await approved(ref);
    expect((await deliveriesOf(ref.entryId)).length).toBe(2);
    // The same approval again is refused (the entry is no longer waiting) and writes nothing more.
    const again = await alerting.approveEntry(actor(approver), ref, { version: 1, contentHash: (await owner`select content_hash from alert_entry where id = ${ref.entryId}`)[0]!.content_hash, recipients: { total: 2, byLanguage: { en: 2 } } });
    expect(again).toMatchObject({ ok: false });
    expect(await owner`select count(*)::int as n, count(distinct recipient_id)::int as d from delivery where entry_id = ${ref.entryId}`).toEqual([{ n: 2, d: 2 }]);
    // The sender, twice: one text per subscriber, to the number of that subscriber, and nothing the second time.
    world.useResolver({ resolver: createContactResolver({ sources: { subscriber: subscriberNumberSource() }, log: world.log }), asked: [], gone: new Set() });
    await drain();
    await drain();
    expect(world.provider.calls.map((call) => call.to).sort()).toEqual([phoneOf(1), phoneOf(2)]);
    expect(await owner`select count(*)::int as n from delivery where entry_id = ${ref.entryId} and state = 'submitted'`).toEqual([{ n: 2 }]);
    expect(ids).toHaveLength(2);
  });

  it("reaches no subscriber with a drill, whoever matches, and a drill's count is its roster's", async () => {
    await subscriber({ places: [{ rsn: RSN_A }] });
    const { ref } = await pendingAck(buildingAudience([{ rsn: RSN_A, floors: null }]), {}, true);
    const review = await alerting.review(ref);
    expect(review?.recipients).toEqual({ open: true, total: 0, byLanguage: {} });
    const done = await approved(ref, secondAdmin);
    expect(done.recipients.total).toBe(0);
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
  });

  it("queues the texts but hands none to the provider while texting is paused, and sends them once it resumes", async () => {
    const id = await subscriber({ places: [{ rsn: RSN_A }] });
    const { ref } = await pendingAck(buildingAudience([{ rsn: RSN_A, floors: null }]));
    await approved(ref);
    world.useResolver({ resolver: createContactResolver({ sources: { subscriber: subscriberNumberSource() }, log: world.log }), asked: [], gone: new Set() });
    await world.setPause(true);
    await world.dispatcher().run();
    expect(world.provider.calls).toEqual([]);
    expect(await recipientsOf(ref.entryId)).toEqual([id]);
    expect((await deliveriesOf(ref.entryId))[0]?.state).toBe("queued");
    await world.setPause(false);
    await world.dispatcher().run();
    expect(world.provider.calls.map((call) => call.to)).toEqual([phoneOf(1)]);
  });
});

// --- corrections, withdrawals and finals -------------------------------------------------------------------------------------------------------

async function correctionOf(target: EntryRef, text = "Power is out on floors 1 to 8, not floors 1 to 6."): Promise<{ ref: EntryRef; frozen: FrozenContent }> {
  const made = await alerting.correctEntry(actor(author), { alertId: target.alertId, targetId: target.entryId }, { entryId: randomUUID(), text, phase: "problem", validUntil: inDays(1), validUntilMode: "at" });
  if (!made.ok) throw new Error(`correctEntry refused: ${made.error}`);
  const ref = { alertId: target.alertId, entryId: made.value.entry.id };
  return { ref, frozen: await freeze(ref, "correction", target.entryId) };
}

describe("a correction reaches the people the original was texted to (FR-A16)", () => {
  it("sends the same 120 the correction by text, each in their current language, marked as a correction, and stops what was queued for the original", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: null }]);
    const langs = ["en", "ur", "es", "fr", "ta", "hi"];
    const ids: string[] = [];
    for (let i = 0; i < 120; i += 1) ids.push(await subscriber({ lang: langs[i % langs.length], places: [{ rsn: RSN_A, floor: i % 2 === 0 ? A1 : null }] }));
    const original = await pendingAck(audience);
    await approved(original.ref);
    expect(await recipientsOf(original.ref.entryId)).toEqual(sorted(ids));

    // Meanwhile some of them change language: the correction goes out in the language they have now.
    const changed = ids.slice(0, 10);
    await owner`update subscriber set lang = 'pa' where id = any(${changed})`;

    const correction = await correctionOf(original.ref);
    const review = await alerting.review(correction.ref);
    expect(review?.recipients.total).toBe(120);
    expect(review?.recipients.byLanguage.pa).toBe(10);
    const done = await approved(correction.ref);
    expect(done.recipients.total).toBe(120);

    const rows = await deliveriesOf(correction.ref.entryId);
    expect(sorted(rows.map((row) => row.recipient_id))).toEqual(sorted(ids));
    const langNow = new Map((await owner<{ id: string; lang: string }[]>`select id, lang from subscriber`).map((row) => [row.id, row.lang]));
    for (const row of rows) {
      const own = langNow.get(row.recipient_id as string)!;
      expect(row.lang, own).toBe(own);
      expect(row.body, own).toBe(correction.frozen.smsBodies[own].body);
      // Marked as a correction: its second line is "Correction" in the recipient's language.
      expect(row.body, own).toContain(smsStrings(own as "en").correction);
    }
    // The original's queued texts were stopped by the approval, so only the correction goes out.
    expect(await owner`select state, count(*)::int as n from delivery where entry_id = ${original.ref.entryId} group by state`).toEqual([{ state: "cancelled", n: 120 }]);
    world.useResolver({ resolver: createContactResolver({ sources: { subscriber: subscriberNumberSource() }, log: world.log }), asked: [], gone: new Set() });
    await drain();
    expect(world.provider.calls).toHaveLength(120);
    expect(new Set(world.provider.calls.map((call) => call.body))).not.toContain(original.frozen.smsBodies.en.body);
    // The web shows the correction above the original.
    const [thread] = (await createResidentAlerts(app).read("en")).threads;
    const order = entriesNewestFirst(thread!.entries).map((entry) => entry.id);
    expect(order.indexOf(correction.ref.entryId)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(correction.ref.entryId)).toBeLessThan(order.indexOf(original.ref.entryId));
  }, 120_000);

  it("adds the original's recipients to the correction's own audience, whatever they muted or wherever they live now, and gives a deleted one nothing", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: [A1] }]);
    const stays = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const muted = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const moved = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const stops = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const original = await pendingAck(audience);
    await approved(original.ref);
    expect(await recipientsOf(original.ref.entryId)).toEqual(sorted([stays, muted, moved, stops]));

    // Since then: one muted the topic, one moved to another building, one texted STOP, and two new people signed up (one in the audience, one not).
    await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${muted}, 'power')`;
    await owner`delete from subscriber_place where subscriber_id = ${moved}`;
    await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${moved}, ${RSN_B}, ${B1})`;
    await owner`delete from subscriber where id = ${stops}`;
    const newcomer = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const outsider = await subscriber({ places: [{ rsn: RSN_B, floor: B1 }] });

    const correction = await correctionOf(original.ref);
    await approved(correction.ref);
    // The original's recipients (opt-outs and moves never removing them) plus the correction's own audience; the one who texted STOP gets nothing.
    expect(await recipientsOf(correction.ref.entryId)).toEqual(sorted([stays, muted, moved, newcomer]));
    expect(await recipientsOf(correction.ref.entryId)).not.toContain(stops);
    expect(await recipientsOf(correction.ref.entryId)).not.toContain(outsider);
    // The deleted subscriber's old text records nobody.
    expect((await deliveriesOf(original.ref.entryId)).filter((row) => row.recipient_id === null)).toHaveLength(1);
  });

  it("sends a correction of a correction to everyone the first correction was queued to", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: null }]);
    const first = await subscriber({ places: [{ rsn: RSN_A }] });
    const original = await pendingAck(audience);
    await approved(original.ref);
    const late = await subscriber({ places: [{ rsn: RSN_A }] });
    const one = await correctionOf(original.ref);
    await approved(one.ref);
    expect(await recipientsOf(one.ref.entryId)).toEqual(sorted([first, late]));
    await owner`delete from subscriber_place where subscriber_id = ${late}`;
    const two = await correctionOf(one.ref, "Power is out on floors 1 to 9.");
    await approved(two.ref);
    expect(await recipientsOf(two.ref.entryId)).toEqual(sorted([first, late]));
  });

  it("sends a withdrawal to the target's recipients plus its own audience, deduplicated", async () => {
    const audience = buildingAudience([{ rsn: RSN_A, floors: null }]);
    const reached = await subscriber({ places: [{ rsn: RSN_A }] });
    const muted = await subscriber({ places: [{ rsn: RSN_A }] });
    const gone = await subscriber({ places: [{ rsn: RSN_A }] });
    const original = await pendingAck(audience);
    await approved(original.ref);
    await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${muted}, 'power')`;
    await owner`delete from subscriber where id = ${gone}`;
    const newcomer = await subscriber({ places: [{ rsn: RSN_A }] });

    const made = await alerting.withdrawEntry(actor(author), { alertId: original.ref.alertId, targetId: original.ref.entryId }, { entryId: randomUUID(), reason: "wrong_information", text: "This alert was withdrawn because it gave wrong information." });
    if (!made.ok) throw new Error(`withdrawEntry refused: ${made.error}`);
    const ref = { alertId: original.ref.alertId, entryId: made.value.entry.id };
    await freeze(ref, "withdrawal", original.ref.entryId);
    await approved(ref);
    expect(await recipientsOf(ref.entryId)).toEqual(sorted([reached, muted, newcomer]));
  });

  it("sends a final to the union of every entry's recipients in the thread plus its own audience, once each", async () => {
    const first = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const both = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }, { rsn: RSN_B, floor: B1 }] });
    const widened = await subscriber({ places: [{ rsn: RSN_B, floor: B1 }] });
    const moved = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const muted = await subscriber({ places: [{ rsn: RSN_B, floor: B2 }] });
    const stops = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const ack = await pendingAck(buildingAudience([{ rsn: RSN_A, floors: [A1] }]));
    await approved(ack.ref);
    expect(await recipientsOf(ack.ref.entryId)).toEqual(sorted([first, both, moved, stops]));

    // An update widens the alert to building B (where `widened` and `muted` live); an update's own audience is what the thread now covers.
    const update = await alerting.addUpdate(actor(author), { alertId: ack.ref.alertId }, { entryId: randomUUID(), text: "Power is also out in the next building.", phase: "in_progress", validUntil: inDays(1), validUntilMode: "at" });
    if (!update.ok) throw new Error(`addUpdate refused: ${update.error}`);
    const updateRef = { alertId: ack.ref.alertId, entryId: update.value.entry.id };
    const current = (await alerting.getEntry(updateRef))!;
    const widenedAudience = buildingAudience([{ rsn: RSN_A, floors: [A1] }, { rsn: RSN_B, floors: null }]);
    const saved = await alerting.saveDraft(actor(author), updateRef, { ...current.content, audience: widenedAudience });
    if (!saved.ok) throw new Error(`saveDraft refused: ${saved.error}`);
    await freeze(updateRef, "update", null);
    await approved(updateRef);
    expect(await recipientsOf(updateRef.entryId)).toEqual(sorted([first, both, moved, stops, widened, muted]));

    // Since then: `moved` left the building, `muted` muted the topic, `stops` texted STOP and a newcomer signed up in the final's audience.
    await owner`delete from subscriber_place where subscriber_id = ${moved}`;
    await owner`insert into subscriber_topic_optout (subscriber_id, topic) values (${muted}, 'power')`;
    await owner`delete from subscriber where id = ${stops}`;
    const newcomer = await subscriber({ places: [{ rsn: RSN_B, floor: B1 }] });
    const outsider = await subscriber({ places: [{ rsn: RSN_C }] });

    const made = await alerting.startFinal(actor(author), { alertId: ack.ref.alertId }, { entryId: randomUUID(), text: "The power is back." });
    if (!made.ok) throw new Error(`startFinal refused: ${made.error}`);
    const finalRef = { alertId: ack.ref.alertId, entryId: made.value.entry.id };
    await freeze(finalRef, "final", null);
    const review = await alerting.review(finalRef);
    await approved(finalRef);
    // The ack's, the update's and the final's own audience, once each; opt-outs and moves never remove anyone, a deleted subscriber is not there.
    const expected = sorted([first, both, moved, widened, muted, newcomer]);
    expect(await recipientsOf(finalRef.entryId)).toEqual(expected);
    expect(review?.recipients.total).toBe(expected.length);
    expect(await recipientsOf(finalRef.entryId)).not.toContain(stops);
    expect(await recipientsOf(finalRef.entryId)).not.toContain(outsider);
    expect(await owner`select count(*)::int as n, count(distinct recipient_id)::int as d from delivery where entry_id = ${finalRef.entryId}`).toEqual([{ n: expected.length, d: expected.length }]);
    // The close stopped the thread's other queued texts, and the final's own are kept.
    expect(await owner`select distinct state from delivery where entry_id = ${finalRef.entryId}`).toEqual([{ state: "queued" }]);
  });
});

// --- concurrency ------------------------------------------------------------------------------------------------------------------------------

/** A recipient port that takes the real capture, then waits on `gate` with the locks held, so a test can act while the approval is open. */
function gatedPort(gate: Promise<void>, captured: { ids: string[] }, reached: { resolve: () => void }): RecipientsPort {
  return {
    count: countRecipients,
    capture: async (entry, tx) => {
      const people = await captureRecipients(entry, tx);
      captured.ids = people.map((person) => person.id);
      reached.resolve();
      await gate;
      return people;
    },
  };
}

describe("a subscriber who changes during the approval is wholly in or wholly out", () => {
  const audience = buildingAudience([{ rsn: RSN_A, floors: [A1] }]);

  async function approvalHeld() {
    const gate = deferred();
    const reached = deferred();
    const captured = { ids: [] as string[] };
    const gated = alertingWith(gatedPort(gate.promise, captured, { resolve: () => reached.resolve() }));
    return { gate, reached, captured, gated };
  }

  it("keeps a subscriber who unsubscribes during the approval in it (the delete waits for the commit), with their text forgotten afterwards", async () => {
    const stays = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const leaves = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const { ref } = await pendingAck(audience);
    const held = await approvalHeld();
    const running = approve(ref, approver, held.gated);
    await held.reached.promise;
    const deleting = appSql`delete from subscriber where id = ${leaves}`.then(() => "deleted");
    await world.untilSomeoneWaitsForALock();
    held.gate.resolve();
    const { result } = await running;
    expect(result).toMatchObject({ ok: true, value: { recipients: { total: 2 } } });
    await deleting;
    // Included in the approval, then deleted: the text was queued and forgets its recipient.
    expect((await deliveriesOf(ref.entryId)).map((row) => row.recipient_id).sort()).toEqual(sorted([stays, null]));
  });

  it("makes a real STOP wait for a correction's approval (deliveries first, then the subscriber), and both commit without a deadlock", async () => {
    const stays = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const leaves = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const original = await pendingAck(audience);
    await approved(original.ref);
    const correction = await correctionOf(original.ref);
    const [{ phone }] = await owner<{ phone: string }[]>`select phone from subscriber where id = ${leaves}`;
    const router = createInboundRouter({
      db: app,
      places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
      enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
      checkins: { deleteForSubscriber: async () => {} },
      numberKey: () => "a-test-key-for-the-reply-limit",
      publicBaseUrl: () => BASE_URL,
      pricePerSegmentCents: () => 1.5,
      log: { info: () => {} },
    });
    const held = await approvalHeld();
    const running = approve(correction.ref, approver, held.gated);
    await held.reached.promise;
    // The approval has stopped the original's queued texts and holds the subscribers FOR SHARE: the STOP queues behind it.
    const stopping = router.handle({ messageSid: `SM${randomUUID().replace(/-/g, "")}`, from: phone, body: "STOP", optOutType: "STOP" });
    await world.untilSomeoneWaitsForALock();
    held.gate.resolve();
    expect((await running).result).toMatchObject({ ok: true, value: { recipients: { total: 2 } } });
    expect(await stopping).toMatchObject({ kind: "handled", keyword: "stop", action: "delete" });
    expect(await owner`select 1 from subscriber where id = ${leaves}`).toHaveLength(0);
    // The correction was queued to both, then the STOP skipped the leaver's text and made it forget them.
    const rows = await owner<{ recipient_id: string | null; state: string }[]>`select recipient_id, state from delivery where entry_id = ${correction.ref.entryId}`;
    expect(rows.map((row) => row.recipient_id).sort()).toEqual(sorted([stays, null]));
    expect(rows.find((row) => row.recipient_id === null)?.state).toBe("skipped");
    expect(rows.find((row) => row.recipient_id === stays)?.state).toBe("queued");
  }, 60_000);

  it("keeps a subscriber who changes places during the approval as they were (the change waits for the commit)", async () => {
    const mover = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const { ref } = await pendingAck(audience);
    const held = await approvalHeld();
    const running = approve(ref, approver, held.gated);
    await held.reached.promise;
    // A change of places locks the subscriber first, like every use case that edits one.
    const changing = appSql.begin(async (tx) => {
      await tx`select id from subscriber where id = ${mover} for update`;
      await tx`delete from subscriber_place where subscriber_id = ${mover}`;
      await tx`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${mover}, ${RSN_B}, ${B1})`;
    });
    await world.untilSomeoneWaitsForALock();
    held.gate.resolve();
    expect((await running).result).toMatchObject({ ok: true, value: { recipients: { total: 1 } } });
    await changing;
    expect(await recipientsOf(ref.entryId)).toEqual([mover]);
  });

  it("leaves out a subscriber who changed places before the approval read, and one who changes after the lock was taken is not read half-changed", async () => {
    const mover = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const stays = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    // A change is open (holding the subscriber's row) when the approval's capture starts: it finds `mover` a candidate, waits for the lock, and then applies the rule again.
    const open = deferred();
    const release = deferred();
    const changing = appSql.begin(async (tx) => {
      await tx`select id from subscriber where id = ${mover} for update`;
      await tx`delete from subscriber_place where subscriber_id = ${mover}`;
      await tx`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${mover}, ${RSN_B}, ${B1})`;
      open.resolve();
      await release.promise;
    });
    await open.promise;
    const capturing = app.transaction((tx) => captureRecipients({ entryId: randomUUID(), alertId: randomUUID(), kind: "ack", isDrill: false, supersedesId: null, audience, types: ["power"], smsBodies: {} }, tx));
    await world.untilSomeoneWaitsForALock();
    release.resolve();
    await changing;
    const people = await capturing;
    expect(people.map((person) => person.id)).toEqual([stays]);
  });

  it("leaves out a subscriber who signs up after the approval read, and includes one who signed up before", async () => {
    const before = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const { ref } = await pendingAck(audience);
    const held = await approvalHeld();
    const running = approve(ref, approver, held.gated);
    await held.reached.promise;
    const late = await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    held.gate.resolve();
    expect((await running).result).toMatchObject({ ok: true, value: { recipients: { total: 1 } } });
    expect(await recipientsOf(ref.entryId)).toEqual([before]);
    expect(await recipientsOf(ref.entryId)).not.toContain(late);
    // The next entry reaches the latecomer.
    const next = await pendingAck(audience);
    await approved(next.ref);
    expect(await recipientsOf(next.ref.entryId)).toEqual(sorted([before, late]));
  });

  it("refuses the approval, and writes nothing, when a subscriber signed up between the review and the approval (the reviewed count changed)", async () => {
    await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const { ref } = await pendingAck(audience);
    const review = await alerting.review(ref);
    await subscriber({ places: [{ rsn: RSN_A, floor: A1 }] });
    const [row] = await owner<{ version: number; content_hash: string }[]>`select version, content_hash from alert_entry where id = ${ref.entryId}`;
    const result = await alerting.approveEntry(actor(approver), ref, { version: row!.version, contentHash: row!.content_hash, recipients: { total: review!.recipients.total, byLanguage: review!.recipients.byLanguage } });
    expect(result).toMatchObject({ ok: false, error: "RECIPIENT_COUNT_CHANGED" });
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
    expect(await owner`select status from alert_entry where id = ${ref.entryId}`).toEqual([{ status: "pending_approval" }]);
  });
});

describe("the port as the module offers it", () => {
  it("is the real capture and count", () => {
    expect(recipientsPort.capture).toBe(captureRecipients);
    expect(recipientsPort.count).toBe(countRecipients);
  });
});
