// Drills reach only the drill roster (S06.05, AD-6, AR-10, FR-A17, FR-M4), against a real database as the app's own role (cvh_app_login). The lifecycle is the
// real one with the real recipient port (subscriptions' `captureRecipients`) and the real outbox; the dispatcher has a fake provider and a fake clock, and the
// numbers are fictitious (the 555 exchange). Nothing here reaches Twilio.
//  - starting a drill: an Admin at aal2 only, and `is_drill` never changes;
//  - a drill approved by a second person: `captureRecipients` returns the roster and nobody else, and the approval's texts are the entry's frozen body for
//    each member's language with the exercise marker first;
//  - the delivery trigger, by direct SQL: a drill text to a non-roster recipient and a real text to a roster member are refused, whoever asks;
//  - the sender: a drill goes to the roster's numbers, and no number is in a delivery row, a log line or an audit record;
//  - a drill's share link and the resident readers: nothing is found;
//  - the drill view's counts: per member and language, apart from every real alert.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { Audience } from "../../src/contracts/audience";
import { createAlerting, freezeContent, type AlertActor, type AlertLifecycle, type EntryContent, type EntryRef, type FrozenContent } from "../../src/modules/alerting";
import { readClosedSlugs, readClosedThread, readOpenEntries, readStatusThreads } from "../../src/modules/alerting/adapters/resident/readThreads";
import { record, recordRefusal } from "../../src/modules/audit";
import { createContactResolver, createDeliveryQueue, drillResults, type MessagingLog } from "../../src/modules/messaging";
import { smsStrings } from "../../src/i18n/smsStrings";
import { createDrillRoster, drillNumberSource, recipientsPort, type DrillRoster } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { transitionStatement, type SeededEntry } from "./deliveryFixtures";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { submitSeams } from "./alertSubmitSeams";
import { connect, serverUrl } from "./helpers";

const BASE_URL = "https://cvh.example";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const E164 = (formatted: string) => `+1${formatted.replace(/\D/g, "").slice(-10)}`;
const DIGITS = (formatted: string) => formatted.replace(/\D/g, "").slice(-10);
const NUMBERS = ["416-555-0111", "647-555-0122", "905-555-0133", "437-555-0144", "289-555-0155"];

const audience: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] };
const TEXT = "Power is out on floors 3 to 5.";
const content = (): EntryContent => ({ text: TEXT, types: ["power"], audience, phase: "problem", validUntil: new Date(Date.now() + 6 * 3_600_000) });

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
let roster: DrillRoster;
let auditBaseline = 0;
let madeNeighbourhood = false;

let admin: { id: string };
let secondAdmin: { id: string };
let coordinator: { id: string };
let ambassador: { id: string };

const actor = (who: { id: string }, aal: AlertActor["aal"] = "aal2"): AlertActor => ({ staffId: who.id, aal });

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
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhood = true;
  }
  alerting = createAlerting({ db: app, pricePerSegmentCents: () => 1.5 });
  seams = submitSeams(owner, alerting);
  roster = createDrillRoster({
    db: app,
    audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
    skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
  });
});

/** Everything this file wrote: the audit records name the accounts the fixtures delete, so they go first. */
async function resetAll() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner`truncate approval_probe`.catch(() => undefined);
  await owner.begin(async (tx) => {
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
  await world.reset();
}

afterAll(async () => {
  await resetAll();
  if (madeNeighbourhood) await owner`delete from neighbourhood where id = 'TP'`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetAll();
  admin = await world.fx.staff("admin");
  secondAdmin = await world.fx.staff("admin");
  coordinator = await world.fx.staff("coordinator");
  ambassador = await world.fx.staff("ambassador");
});

const audits = () => owner`select action, actor_staff_id, subject_type, subject_id, outcome, is_drill, meta from audit_event where id > ${auditBaseline} order by id`;

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
  }
  return "";
}

/** A roster member added the way an Admin adds one (audited, number checked); returns the id. */
async function addMember(index: number, lang: string): Promise<string> {
  const added = await roster.add({ actorStaffId: admin.id, label: `Member ${index}`, number: NUMBERS[index], lang });
  if (added.kind !== "added") throw new Error(`not added: ${added.problem}`);
  return added.id;
}

/** A drill thread (by an Admin at aal2) with its first entry submitted, frozen as a real submit freezes it (the one renderer, every launch language). */
async function pendingDrill(isDrill = true, author: { id: string } = admin): Promise<{ ref: EntryRef; frozen: FrozenContent; slug: string }> {
  const created = await alerting.createAlert(actor(author), { kind: "ack", isDrill, reportedAt: new Date(Date.now() - 60_000), content: content() });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const slug = created.value.thread.slug;
  const freezing = freezeContent({
    alertId: ref.alertId,
    kind: "ack",
    supersedesId: null,
    isDrill,
    channels: ["sms", "web"],
    content: content(),
    translations: [{ lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "m1", status: "translated", sourceHash: sha(TEXT) }],
    verified: true,
    attribution: { role: "hub" },
    slug,
    publicBaseUrl: BASE_URL,
  });
  if (!freezing.ok) throw new Error(`freeze refused: ${freezing.error}`);
  const submitted = await seams.freeze(actor(author), ref, freezing.value);
  if (!submitted.ok) throw new Error(`submit refused: ${submitted.error}`);
  return { ref, frozen: freezing.value, slug };
}

const deliveriesOf = (entryId: string) =>
  owner<{ recipient_kind: string; recipient_id: string | null; lang: string; body: string; segments: number; kind: string; state: string }[]>`
    select recipient_kind, recipient_id, lang, body, segments, kind, state from delivery where entry_id = ${entryId} order by recipient_id`;

describe("starting a drill (an Admin at aal2)", () => {
  it("makes a thread whose is_drill is true, audited as a drill", async () => {
    const created = await alerting.createAlert(actor(admin), { kind: "ack", isDrill: true, reportedAt: new Date(Date.now() - 60_000), content: content() });
    expect(created).toMatchObject({ ok: true, value: { thread: { isDrill: true, status: "open" } } });
    if (!created.ok) return;
    expect(await owner`select is_drill from alert where id = ${created.value.thread.id}`).toEqual([{ is_drill: true }]);
    expect((await audits()).at(-1)).toMatchObject({ action: "alert.created", outcome: "ok", is_drill: true, actor_staff_id: admin.id });
  });

  it("is refused to a Coordinator, an Ambassador and an Admin below aal2, and nothing is made", async () => {
    const attempts: [string, { id: string }, AlertActor["aal"]][] = [
      ["a Coordinator", coordinator, "aal2"],
      ["an Ambassador", ambassador, "aal1"],
    ];
    for (const [who, person, aal] of attempts) {
      const result = await alerting.createAlert(actor(person, aal), { kind: "ack", isDrill: true, reportedAt: new Date(Date.now() - 60_000), content: content() });
      expect(result, who).toMatchObject({ ok: false, error: "NOT_ALLOWED" });
    }
    expect(await alerting.createAlert(actor(admin, "aal1"), { kind: "ack", isDrill: true, reportedAt: new Date(Date.now() - 60_000), content: content() })).toMatchObject({ ok: false, error: "AAL2_REQUIRED" });
    expect(await owner`select count(*)::int as n from alert`).toEqual([{ n: 0 }]);
    // "Log a disruption" starts a thread the same way, so it is guarded the same.
    const logged = await alerting.logDisruption(actor(coordinator), {
      kind: "ack",
      isDrill: true,
      reportedAt: new Date(Date.now() - 60_000),
      types: ["power"],
      place: { scope: "neighbourhood", neighbourhoodIds: ["TP"] },
      textFor: () => "x",
    });
    expect(logged).toMatchObject({ ok: false, error: "NOT_ALLOWED" });
    expect(await owner`select count(*)::int as n from alert`).toEqual([{ n: 0 }]);
  });

  it("leaves a real thread real, for the same Admin", async () => {
    const created = await alerting.createAlert(actor(admin), { kind: "ack", isDrill: false, reportedAt: new Date(Date.now() - 60_000), content: content() });
    expect(created).toMatchObject({ ok: true, value: { thread: { isDrill: false } } });
  });

  it("never changes is_drill afterwards, for the app's role or the owner, in either direction", async () => {
    const drill = await alerting.createAlert(actor(admin), { kind: "ack", isDrill: true, reportedAt: new Date(Date.now() - 60_000), content: content() });
    const real = await alerting.createAlert(actor(admin), { kind: "ack", isDrill: false, reportedAt: new Date(Date.now() - 60_000), content: content() });
    if (!drill.ok || !real.ok) throw new Error("not created");
    expect(await refusal(() => appSql`update alert set is_drill = false where id = ${drill.value.thread.id}`)).toMatch(/permission denied|is_drill/);
    expect(await refusal(() => owner`update alert set is_drill = false where id = ${drill.value.thread.id}`)).toMatch(/is_drill/);
    expect(await refusal(() => owner`update alert set is_drill = true where id = ${real.value.thread.id}`)).toMatch(/is_drill/);
    expect(await owner`select id, is_drill from alert where id in (${drill.value.thread.id}, ${real.value.thread.id}) order by is_drill`).toEqual(
      expect.arrayContaining([
        { id: drill.value.thread.id, is_drill: true },
        { id: real.value.thread.id, is_drill: false },
      ]),
    );
  });
});

describe("a drill approved by a second person", () => {
  it("captures only the drill roster, and queues each member's text in the entry's frozen body for their language, with the exercise marker first", async () => {
    const members = [await addMember(0, "en"), await addMember(1, "ur"), await addMember(2, "es"), await addMember(3, "zh-Hant")];
    const { ref, frozen } = await pendingDrill();

    // What the approval view reads: the roster counted under the language of the text each member gets (zh-Hant has no text message of its own: English).
    const review = await alerting.review(ref);
    expect(review?.recipients).toEqual({ open: true, total: 4, byLanguage: { en: 2, ur: 1, es: 1 } });

    const approved = await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 4, byLanguage: { en: 2, ur: 1, es: 1 } } });
    expect(approved).toMatchObject({ ok: true, value: { feedVersion: null, recipients: { total: 4, byLanguage: { en: 2, ur: 1, es: 1 } } } });

    const rows = await deliveriesOf(ref.entryId);
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.kind === "alert" && row.recipient_kind === "roster")).toBe(true);
    expect(rows.map((row) => row.recipient_id).sort()).toEqual([...members].sort());
    const memberLang: Record<string, string> = { [members[0]]: "en", [members[1]]: "ur", [members[2]]: "es", [members[3]]: "zh-Hant" };
    for (const row of rows) {
      const own = memberLang[row.recipient_id as string];
      const bodyLang = frozen.smsBodies[own] ? own : "en";
      expect(row.lang, own).toBe(bodyLang);
      expect(row.body, own).toBe(frozen.smsBodies[bodyLang].body);
      expect(row.segments, own).toBe(frozen.smsBodies[bodyLang].segments);
      // The exercise marker is the first line of the text, in the language of the text.
      expect(row.body.startsWith(smsStrings(bodyLang as "en").exercise), own).toBe(true);
    }
    // The audit holds the count of people and the drill flag, never a number, a label or a language of a person.
    const record = (await audits()).filter((row) => row.action === "entry.approved").at(-1);
    expect(record).toMatchObject({ outcome: "ok", is_drill: true, meta: { recipient_count: 4 } });
    const everything = JSON.stringify(await audits());
    for (const number of NUMBERS) expect(everything).not.toContain(DIGITS(number));
    expect(everything).not.toContain("Member 0");
  });

  it("returns only roster members from captureRecipients, for a drill, and nobody for a real entry, with the same roster", async () => {
    const members = [await addMember(0, "en"), await addMember(1, "ur")];
    const drill = await pendingDrill(true);
    const real = await pendingDrill(false);
    const entryOf = async (ref: EntryRef) => {
      const thread = await alerting.getThread(ref.alertId);
      return { entryId: ref.entryId, alertId: ref.alertId, kind: "ack", isDrill: thread?.isDrill ?? false, supersedesId: null, audience, types: ["power"], smsBodies: {} };
    };
    const forDrill = await app.transaction(async (tx) => recipientsPort.capture(await entryOf(drill.ref), tx));
    expect(forDrill.map((person) => [person.kind, person.id, person.lang]).sort()).toEqual(
      [
        ["roster", members[0], "en"],
        ["roster", members[1], "ur"],
      ].sort(),
    );
    expect(await app.transaction(async (tx) => recipientsPort.capture(await entryOf(real.ref), tx))).toEqual([]);
    expect(await recipientsPort.count(await entryOf(real.ref), app)).toEqual({ open: false, total: 0, byLanguage: {} });
  });

  it("queues nothing for a real entry, whatever is on the roster, and approves it as it always did", async () => {
    await addMember(0, "en");
    const { ref, frozen } = await pendingDrill(false);
    const approved = await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash });
    expect(approved).toMatchObject({ ok: true, value: { recipients: { total: 0 } } });
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
  });

  it("refuses the approval when the roster changed after the approver read the count, and queues nothing", async () => {
    await addMember(0, "en");
    const { ref, frozen } = await pendingDrill();
    const reviewed = (await alerting.review(ref))?.recipients;
    expect(reviewed).toMatchObject({ total: 1 });
    await addMember(1, "ur");
    const approved = await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 1, byLanguage: { en: 1 } } });
    expect(approved).toMatchObject({ ok: false, error: "RECIPIENT_COUNT_CHANGED", detail: { recipients: { total: 2 } } });
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
    expect(await owner`select status from alert_entry where id = ${ref.entryId}`).toEqual([{ status: "pending_approval" }]);
  });

  it("approves a drill with an empty roster, which reaches nobody (count 0)", async () => {
    const { ref, frozen } = await pendingDrill();
    expect((await alerting.review(ref))?.recipients).toEqual({ open: true, total: 0, byLanguage: {} });
    expect(await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 0, byLanguage: {} } })).toMatchObject({ ok: true, value: { recipients: { total: 0 } } });
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
  });

  it("waits for a member being removed meanwhile (the capture locks the roster rows), then the member's text is cancelled by the removal's own skip, never sent to a deleted member", async () => {
    const member = await addMember(0, "en");
    const { ref, frozen } = await pendingDrill();
    await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 1, byLanguage: { en: 1 } } });
    expect(await roster.remove({ actorStaffId: admin.id, id: member })).toMatchObject({ kind: "removed", skippedTexts: 1 });
    expect(await deliveriesOf(ref.entryId)).toEqual([expect.objectContaining({ state: "skipped", recipient_id: null })]);
  });
});

describe("the delivery trigger, by direct SQL (the app's role and the owner)", () => {
  /** One alert text for an entry, as the approval's transaction writes it (the marker set), by the app's role. */
  async function insertAs(connection: "app" | "owner", entry: SeededEntry, recipient: { kind: string; id: string }) {
    const sql = connection === "app" ? appSql : owner;
    await sql.begin(async (tx) => {
      await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
      await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
               values (${randomUUID()}, 'alert', ${recipient.kind}, ${recipient.id}, ${entry.entryId}, 'alerting', 'en', ${entry.bodies.en.body}, ${entry.bodies.en.segments}, 2, ${`${entry.entryId}:${recipient.id}:sms`})`;
    });
  }

  it("refuses a drill text to a subscriber, to an id that is not on the roster, and to a member who was removed", async () => {
    const drill = await world.fx.entry("pending_approval", { isDrill: true });
    const member = await world.fx.rosterMember();
    const removed = await world.fx.rosterMember();
    await owner`delete from drill_roster where id = ${removed}`;
    for (const connection of ["app", "owner"] as const) {
      expect(await refusal(() => insertAs(connection, drill, { kind: "subscriber", id: randomUUID() })), `${connection}: a subscriber`).toMatch(/a drill is texted only to a member of the drill roster/);
      expect(await refusal(() => insertAs(connection, drill, { kind: "roster", id: randomUUID() })), `${connection}: an unknown id`).toMatch(/a drill is texted only to a member of the drill roster/);
      expect(await refusal(() => insertAs(connection, drill, { kind: "roster", id: removed })), `${connection}: a removed member`).toMatch(/a drill is texted only to a member of the drill roster/);
      for (const kind of ["staff", "oncall", "pending_signup", "inbound_reply"]) {
        expect(await refusal(() => insertAs(connection, drill, { kind, id: randomUUID() })), `${connection}: ${kind}`).toMatch(/delivery_kind_shape|drill is texted only/);
      }
    }
    expect(await owner`select count(*)::int as n from delivery`).toEqual([{ n: 0 }]);
    // The control: a member of the roster is accepted.
    await insertAs("app", drill, { kind: "roster", id: member });
    expect(await owner`select recipient_kind from delivery`).toEqual([{ recipient_kind: "roster" }]);
  });

  it("refuses a text of an entry that is not a drill to a roster member, even a real one", async () => {
    const real = await world.fx.entry("pending_approval", { isDrill: false });
    const member = await world.fx.rosterMember();
    for (const connection of ["app", "owner"] as const) {
      expect(await refusal(() => insertAs(connection, real, { kind: "roster", id: member })), connection).toMatch(/is never texted to the drill roster/);
    }
    expect(await refusal(() => insertAs("app", real, { kind: "roster", id: randomUUID() }))).toMatch(/is never texted to the drill roster/);
    expect(await owner`select count(*)::int as n from delivery`).toEqual([{ n: 0 }]);
    // The control: a subscriber is accepted for a real entry.
    await insertAs("app", real, { kind: "subscriber", id: randomUUID() });
    expect(await owner`select recipient_kind from delivery`).toEqual([{ recipient_kind: "subscriber" }]);
  });

  it("refuses a transactional or campaign text to a roster member: the roster is texted a drill alert and nothing else", async () => {
    const member = await world.fx.rosterMember();
    const transactional = () =>
      appSql`insert into delivery (id, kind, recipient_kind, recipient_id, created_by_module, purpose, lang, body, segments, cost_estimate_cents, idempotency_key, send_by)
             values (${randomUUID()}, 'transactional', 'roster', ${member}, 'subscriptions', 'menu_reply', 'en', 'Hello', 1, 2, ${`transactional:${randomUUID()}:menu_reply:${randomUUID()}`}, now() + interval '10 minutes')`;
    expect(await refusal(transactional)).toMatch(/is never texted to a roster recipient/);
    const campaign = () =>
      appSql`insert into delivery (id, kind, recipient_kind, recipient_id, campaign_id, created_by_module, purpose, lang, body, segments, cost_estimate_cents, idempotency_key)
             values (${randomUUID()}, 'campaign', 'roster', ${member}, ${randomUUID()}, 'subscriptions', 'reconsent', 'en', 'Hello', 1, 2, ${`campaign:${randomUUID()}:reconsent:${randomUUID()}`})`;
    expect(await refusal(campaign)).toMatch(/delivery_kind_shape|campaign/);
  });

  it("is refused for a drill by the lifecycle's own path as well: no drill text to anyone but the roster, however the port is wired", async () => {
    const stranger = randomUUID();
    const wired = createAlerting({
      db: app,
      pricePerSegmentCents: () => 1.5,
      recipients: { count: async () => ({ open: true, total: 1, byLanguage: { en: 1 } }), capture: async () => [{ kind: "subscriber", id: stranger, lang: "en" }] },
    });
    const { ref, frozen } = await pendingDrill();
    const approved = await wired.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 1, byLanguage: { en: 1 } } }).then(
      (result) => result,
      (error: Error) => error,
    );
    expect(approved instanceof Error ? `${approved.message} ${(approved as { cause?: Error }).cause?.message ?? ""}` : "").toMatch(/a drill is texted only to a member of the drill roster/);
    expect(await deliveriesOf(ref.entryId)).toEqual([]);
    expect(await owner`select status from alert_entry where id = ${ref.entryId}`).toEqual([{ status: "pending_approval" }]);
  });
});

describe("sending a drill", () => {
  const sources = { roster: drillNumberSource };

  it("hands the provider only the roster's numbers, resolved at the hand-off, and writes a number nowhere", async () => {
    const [a, b] = [await addMember(0, "en"), await addMember(1, "ur")];
    const drill = await world.seedAlert({ isDrill: true, recipients: [a, b] });
    const lines: string[] = [];
    const log: MessagingLog = { info: (evt, fields) => void lines.push(JSON.stringify({ evt, fields })), error: (evt, fields) => void lines.push(JSON.stringify({ evt, fields })) };
    world.useResolver({ resolver: createContactResolver({ sources, log }), asked: [], gone: new Set() });

    await world.dispatcher({ log }).run();

    expect(world.provider.calls.map((call) => call.to).sort()).toEqual([E164(NUMBERS[0]), E164(NUMBERS[1])].sort());
    expect(await world.statesOf(drill.ids)).toEqual(Object.fromEntries(drill.ids.map((id) => [id, "submitted"])));
    const everything = `${await world.everythingStored()}${JSON.stringify(await audits())}${lines.join("\n")}${JSON.stringify(world.lines)}`;
    for (const number of NUMBERS.slice(0, 2)) expect(everything).not.toContain(DIGITS(number));
    expect(lines.join("\n")).toContain("contact.resolved");
  });

  it("skips the text of a member removed before the hand-off, and sends the others", async () => {
    const [kept, gone] = [await addMember(0, "en"), await addMember(1, "en")];
    const drill = await world.seedAlert({ isDrill: true, recipients: [kept, gone] });
    // The roster's own removal skips the waiting text first (the same transaction as the delete).
    expect(await roster.remove({ actorStaffId: admin.id, id: gone })).toMatchObject({ kind: "removed", skippedTexts: 1 });
    world.useResolver({ resolver: createContactResolver({ sources, log: world.log }), asked: [], gone: new Set() });
    await world.dispatcher().run();
    expect(world.provider.calls.map((call) => call.to)).toEqual([E164(NUMBERS[0])]);
    expect(await world.stateOf(drill.ids[0])).toBe("submitted");
    expect(await world.stateOf(drill.ids[1])).toBe("skipped");
  });

  it("answers a roster number only for an alert text", async () => {
    const member = await addMember(0, "en");
    expect(await app.transaction((tx) => drillNumberSource.numberOf(tx, member, { consume: false, deliveryKind: "alert" }))).toBe(E164(NUMBERS[0]));
    expect(await app.transaction((tx) => drillNumberSource.numberOf(tx, member, { consume: false, deliveryKind: "transactional" }))).toBeNull();
    expect(await app.transaction((tx) => drillNumberSource.numberOf(tx, member, { consume: false }))).toBeNull();
    expect(await app.transaction((tx) => drillNumberSource.numberOf(tx, randomUUID(), { consume: false, deliveryKind: "alert" }))).toBeNull();
  });
});

describe("a drill's share link and the resident readers", () => {
  it("finds nothing of a drill approved with its entry web-published, open or closed, and nothing at its address", async () => {
    const { ref, frozen, slug } = await pendingDrill();
    expect(await alerting.approveEntry(actor(secondAdmin), ref, { version: 1, contentHash: frozen.contentHash, recipients: { total: 0, byLanguage: {} } })).toMatchObject({ ok: true });
    // The entry is approved and web-published, and the thread is a drill: the resident views leave it out.
    expect(await owner`select web_published_at is not null as published from alert_entry where id = ${ref.entryId}`).toEqual([{ published: true }]);
    expect(JSON.stringify(await readOpenEntries(app, "en"))).not.toContain(slug);
    expect(JSON.stringify(await readStatusThreads(app, new Date()))).not.toContain(slug);
    expect(await readClosedThread(app, "en", slug)).toBeNull();
    expect(await appSql`select count(*)::int as n from nondrill_alert_entry_v2 where slug = ${slug}`).toEqual([{ n: 0 }]);
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });
    expect(await readClosedThread(app, "en", slug)).toBeNull();
    expect(await readClosedSlugs(app)).not.toContain(slug);
  });
});

describe("the drill view's counts", () => {
  it("counts per roster member and language what was handed off, delivered, undelivered, failed and unknown, apart from every real alert", async () => {
    const members = [await addMember(0, "en"), await addMember(1, "ur"), await addMember(2, "en"), await addMember(3, "ur")];
    const drill = await world.seedAlert({ isDrill: true, recipients: members, bodies: undefined });
    const real = await world.seedAlert({ isDrill: false, recipients: 2 });
    // The states a drill's texts reach, by the dispatcher's and the callbacks' own steps (as the app's role): the first is delivered, the second undelivered, the
    // third failed (the provider refused the number), the fourth is still waiting.
    const handOff = async (id: string, to: "delivered" | "undelivered" | "unknown" | "submitted") =>
      appSql.begin(async (tx) => {
        await transitionStatement(tx, id, "claimed");
        await tx`update delivery set handed_off_at = now() where id = ${id}`;
        await transitionStatement(tx, id, to);
      });
    const [d0, d1, d2] = drill.ids;
    await handOff(d0, "delivered");
    await handOff(d1, "undelivered");
    await appSql.begin(async (tx) => {
      await transitionStatement(tx, d2, "claimed");
      await transitionStatement(tx, d2, "failed");
    });
    for (const id of real.ids) await handOff(id, "delivered");

    const results = await drillResults.forAlert(app, drill.entry.alertId);
    const byMember = Object.fromEntries(results.map((row) => [row.recipientId, row]));
    expect(Object.keys(byMember).sort()).toEqual([...members].sort());
    expect(byMember[members[0]]).toMatchObject({ lang: "en", waiting: 0, handedOff: 1, delivered: 1, undelivered: 0, failed: 0, unknown: 0, notSent: 0 });
    expect(byMember[members[1]]).toMatchObject({ lang: "en", waiting: 0, handedOff: 1, delivered: 0, undelivered: 1, failed: 0, unknown: 0 });
    expect(byMember[members[2]]).toMatchObject({ lang: "en", waiting: 0, handedOff: 0, delivered: 0, undelivered: 0, failed: 1, unknown: 0 });
    expect(byMember[members[3]]).toMatchObject({ lang: "en", waiting: 1, handedOff: 0, delivered: 0, undelivered: 0, failed: 0, unknown: 0 });
    // A real alert has no row in the drill view, and its counts are not in a drill's.
    expect(await drillResults.forAlert(app, real.entry.alertId)).toEqual([]);
    expect(await owner`select count(*)::int as n from drill_delivery_result where alert_id = ${real.entry.alertId}`).toEqual([{ n: 0 }]);
    expect(results.reduce((sum, row) => sum + row.delivered, 0)).toBe(1);
    // The view holds no number and no body.
    expect(JSON.stringify(results)).not.toMatch(/\+1416|555/);
    expect(await owner`select column_name from information_schema.columns where table_name = 'drill_delivery_result' order by ordinal_position`).toEqual(
      ["alert_id", "entry_id", "recipient_id", "lang", "waiting", "handed_off", "delivered", "undelivered", "failed", "unknown", "not_sent"].map((column_name) => ({ column_name })),
    );
  });

  it("counts an unknown text, and a member removed from the roster as one row with no id", async () => {
    const [a, b] = [await addMember(0, "en"), await addMember(1, "en")];
    const drill = await world.seedAlert({ isDrill: true, recipients: [a, b] });
    await appSql.begin(async (tx) => {
      await transitionStatement(tx, drill.ids[0], "claimed");
      await tx`update delivery set handed_off_at = now() where id = ${drill.ids[0]}`;
      await transitionStatement(tx, drill.ids[0], "unknown");
    });
    await roster.remove({ actorStaffId: admin.id, id: b });
    const results = await drillResults.forAlert(app, drill.entry.alertId);
    expect(results.find((row) => row.recipientId === a)).toMatchObject({ handedOff: 1, unknown: 1 });
    expect(results.find((row) => row.recipientId === null)).toMatchObject({ notSent: 1, handedOff: 0 });
  });
});
