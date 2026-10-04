// Hub staff post updates to a running alert (S05.01), against a real database: an update is a new draft of kind `update` that starts from the thread (its audience
// and types carried over from the entry that covers it, the phase and the valid-until the author's), and from there submit, translation, freezing and the
// second person's approval are the other entries' exactly (the real submitter, the real preparer and renderer, the real approval); an update supersedes nothing
// (the earlier entries are untouched, nothing is cancelled); a widened or narrowed audience is stored on the update and is what the approval view compares with
// what the thread has now; the thread reads newest first with each entry's time and phase and a valid-until that is the latest entry's; and a thread that was
// closed while an update was being written or waited for approval refuses it (ALERT_CLOSED) at submit and at approval, and is not offered "Add an update".
// The use cases run as the app's own role (cvh_app_login).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import { FeedThreadSchema, FeedV1, entriesNewestFirst } from "../../src/contracts/feed";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  createAlerting,
  createEntryPreparer,
  createFeed,
  createResidentAlerts,
  createSubmitter,
  freezeContent,
  freezeTranslations,
  newestFirst,
  threadValidUntil,
  type AddUpdateInput,
  type AlertActor,
  type AlertLifecycle,
  type EntryContent,
  type EntryPreparer,
  type EntryRef,
  type FrozenContent,
  type PrepareContext,
  type ThreadEntrySummary,
} from "../../src/modules/alerting";
import type { RecipientEntry, RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const RSN = "4154246";
const OTHER_RSN = "4154247";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];
const BASE = "https://cvh.example";

const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;

const sha = (tag: string) => createHash("sha256").update(tag, "utf8").digest("hex");
const NONE: RecipientCounts = { total: 0, byLanguage: {} };

const audienceOf = (rsn: string, floors: string[] | null = null, types: string[] = ["power"], groups: string[] = []): Audience => ({
  scope: "buildings",
  buildings: [{ rsn, floors }],
  groups: groups as Audience["groups"],
  types: [...types].sort(),
});
const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out on floors 3 to 5. We are finding out more. More information to come.",
  types: ["power"],
  audience: audienceOf(RSN),
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  validUntilMode: "at",
  ...over,
});

const frozen = (tag: string): FrozenContent => ({
  contentHash: sha(tag),
  smsBodies: { en: { body: `en ${tag}`, encoding: "gsm7", segments: 1 }, ur: { body: `ur ${tag}`, encoding: "ucs2", segments: 2 } },
  translations: [{ lang: "ur", body: `ur ${tag}`, machine: true, model: "m1", status: "translated", sourceHash: sha("source") }],
});

/** A whole set of translations for an English text, as the translation stub returns it. */
function wholeSet(english: string): Translated[] {
  const source = sha(english);
  const zh = `${english} (zh)`;
  return FROZEN_LANGS.map((lang): Translated => {
    if (lang === "zh-Hant") {
      return { lang, body: `${english} (zh-Hant)`, machine: true, model: "opencc-js 1.4.2", status: "script_converted", source_hash: source, conversion: { from: "zh", from_text_hash: sha(zh), opencc_version: "1.4.2", config: "test" } };
    }
    return { lang, body: lang === "zh" ? zh : `${english} (${lang})`, machine: true, model: "m1", status: "ok", source_hash: source };
  });
}

type Role = "ambassador" | "coordinator" | "director" | "admin";
interface Account {
  id: string;
  role: Role;
}

let owner: ReturnType<typeof connect>;
let appUrl: string;
let appSql: postgres.Sql;
let app: Db;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
const accounts: Account[] = [];

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`up_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}

let authorA: Account;
let coordB: Account;
let adminC: Account;
let director: Account;
let ambassador: Account;

const actorOf = (who: Account, aal: AlertActor["aal"] = who.role === "ambassador" ? "aal1" : "aal2"): AlertActor => ({ staffId: who.id, aal });

// The recipient port: counts nobody (before E07) and says what it was given.
const captured: RecipientEntry[] = [];
const port: RecipientsPort = {
  count: async () => ({ open: false, ...NONE }),
  capture: async (entry) => {
    captured.push(entry);
    return [];
  },
};

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
}

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  appSql = postgres(appUrl, { max: 10, onnotice: () => {} });
  app = createDb(appUrl);
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nb] of [[RSN, "TP"], [OTHER_RSN, "FP"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
                values (${rsn}, ${nb}, ${`${rsn} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
    for (const [index, label] of FLOORS.entries()) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${label}, ${index}, true) on conflict do nothing`;
    }
  }
  authorA = await account("coordinator");
  coordB = await account("coordinator");
  adminC = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => clock, recipients: port });
  seams = submitSeams(owner, alerting);
});

afterAll(async () => {
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from staff_account where id = ${id}`;
  });
  for (const rsn of [RSN, OTHER_RSN]) {
    await owner`delete from building_floor where rsn = ${rsn}`;
    await owner`delete from building where rsn = ${rsn}`;
  }
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  clock = NOW;
  captured.length = 0;
  await clear();
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const entryRows = async (alertId: string) => await owner`select * from alert_entry where alert_id = ${alertId} order by created_at, id`;
const feedVersion = async () => Number((await owner`select version from feed_version`)[0].version);
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;
const closeThread = (alertId: string, reason = "resolved") =>
  owner`update alert set status = 'closed', closed_reason = ${reason}, closed_at = now() where id = ${alertId}`;

/** An approved acknowledgement (or alert) of the building: the thread an update is added to. */
async function approvedThread(over: Partial<EntryContent> = {}, kind: "ack" | "update" = "ack", isDrill = false): Promise<{ ref: EntryRef; slug: string }> {
  // An Admin starts a drill: only an Admin at aal2 may (S06.05).
  const author = isDrill ? adminC : authorA;
  const created = await alerting.createAlert(actorOf(author), { kind, isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const submitted = await seams.freeze(actorOf(author), ref, frozen("ack"));
  if (!submitted.ok) throw new Error(`freeze refused: ${submitted.error}`);
  const approved = await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("ack") });
  if (!approved.ok) throw new Error(`approve refused: ${approved.error}`);
  return { ref, slug: created.value.thread.slug };
}

const updateInput = (over: Partial<AddUpdateInput> = {}): AddUpdateInput => ({
  entryId: randomUUID(),
  text: "Toronto Hydro is on site. Power may be back after 11 pm.",
  phase: "in_progress",
  validUntil: new Date("2026-10-02T09:00:00Z"),
  validUntilMode: "at",
  ...over,
});

async function newUpdate(alertId: string, by: Account = authorA, over: Partial<AddUpdateInput> = {}): Promise<EntryRef> {
  const input = updateInput(over);
  // Entries are ordered by their creation time (the id only breaks a tie), so each update is made a second after the one before it, as in life.
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.addUpdate(actorOf(by), { alertId }, input);
  if (!made.ok) throw new Error(`addUpdate refused: ${made.error}`);
  return { alertId, entryId: made.value.entry.id };
}

/** Submits an update through the real submitter, preparer and renderer, with a translator stub that returns whole sets. */
function submitterFor(contexts: PrepareContext[] = []) {
  const real = createEntryPreparer({
    translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) },
    freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }),
  });
  const preparer: EntryPreparer = {
    prepare: (entryContent, context, hooks) => {
      contexts.push(context);
      return real.prepare(entryContent, context, hooks);
    },
  };
  return createSubmitter({ lifecycle: alerting, preparer, ops: { record: async () => undefined } });
}

async function pendingUpdate(alertId: string, by: Account = authorA, over: Partial<AddUpdateInput> = {}): Promise<EntryRef> {
  const ref = await newUpdate(alertId, by, over);
  const report = await submitterFor().submit(actorOf(by), ref, randomUUID());
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return ref;
}

const shownOfRow = async (ref: EntryRef) => {
  const row = await entryRow(ref.entryId);
  return { version: row.version as number, contentHash: row.content_hash as string };
};

// --- starting an update --------------------------------------------------------------------------------------------------------------

describe("adding an update to a running thread", () => {
  it("makes a draft of kind update that carries the thread's audience and types over from the entry that covers it, with the phase and valid-until the author chose and the author as its editor", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 3), floorId(RSN, 4)], ["power"], ["seniors"]) });

    const made = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput({ entryId: "01900000-0000-7000-8000-00000000d0d1", validUntilMode: "resolved", validUntil: new Date("2026-10-02T15:00:00Z") }));

    expect(made).toMatchObject({ ok: true, value: { thread: { id: ref.alertId, status: "open" }, entry: { id: "01900000-0000-7000-8000-00000000d0d1", alertId: ref.alertId, kind: "update", status: "draft", version: 0, authorId: authorA.id, editorIds: [authorA.id] } } });
    const row = await entryRow("01900000-0000-7000-8000-00000000d0d1");
    // Carried over: the audience (place, floors and groups) and the types, exactly as the covering entry has them.
    expect(row.audience).toEqual(audienceOf(RSN, [floorId(RSN, 3), floorId(RSN, 4)], ["power"], ["seniors"]));
    expect(row.types).toEqual(["power"]);
    // The author's: the text, where things stand, the valid-until and how it was chosen.
    expect(row.original_text).toBe("Toronto Hydro is on site. Power may be back after 11 pm.");
    expect(row.phase).toBe("in_progress");
    expect(row.valid_until_mode).toBe("resolved");
    expect(new Date(row.valid_until)).toEqual(new Date("2026-10-02T15:00:00Z"));
    expect(row.content_hash).toBeNull();
    expect(row.web_published_at).toBeNull();
    // The thread did not change, and neither did what residents read.
    expect((await threadRow(ref.alertId)).status).toBe("open");
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("audits the creation as entry.created, with the entry, its kind and the thread's types and no text", async () => {
    const { ref } = await approvedThread({ types: ["elevator", "power"], audience: audienceOf(RSN, null, ["elevator", "power"]) });
    const update = await newUpdate(ref.alertId);
    expect((await auditRows()).at(-1)).toEqual({
      action: "entry.created",
      outcome: "ok",
      actor_staff_id: authorA.id,
      subject_id: update.entryId,
      is_drill: false,
      meta: { entry_id: update.entryId, kind: "update", types: ["elevator", "power"] },
    });
  });

  it("starts from the latest covering entry: once an update that changed who it is for is approved, that audience is what the next update starts from", async () => {
    const { ref } = await approvedThread();
    const first = await newUpdate(ref.alertId, authorA);
    const wider: Audience = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }, { rsn: OTHER_RSN, floors: null }], groups: [], types: ["power"] };
    expect(await alerting.chooseAudiencePlace(actorOf(authorA), first, { scope: "buildings", buildings: [{ rsn: RSN, floors: null }, { rsn: OTHER_RSN, floors: null }] })).toMatchObject({ ok: true });
    expect(await submitterFor().submit(actorOf(authorA), first, randomUUID())).toMatchObject({ state: "committed" });
    expect(await alerting.approveEntry(actorOf(coordB), first, await shownOfRow(first))).toMatchObject({ ok: true });
    const summary = await alerting.threadSummary(ref.alertId);
    expect(summary?.covering?.id).toBe(first.entryId);
    expect(summary?.covering?.audience).toEqual(wider);

    const next = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput({ phase: "problem" }));
    expect(next).toMatchObject({ ok: true });
    if (next.ok) expect(next.value.entry.content.audience).toEqual(wider);
  });

  it("can be started again by a request that sends the same entry id: it returns the update that was made and changes nothing, even when two arrive at once", async () => {
    const { ref } = await approvedThread();
    const input = updateInput();
    const results = await Promise.all([alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, input), alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, input)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(results.map((result) => (result.ok ? result.value.entry.id : null))).toEqual([input.entryId, input.entryId]);
    expect((await entryRows(ref.alertId)).filter((row) => row.kind === "update")).toHaveLength(1);
    expect((await auditRows()).filter((row) => row.action === "entry.created")).toHaveLength(1);

    // Later still, with other words: the draft that was made is returned as it is, not rewritten.
    const again = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, { ...input, text: "Something else entirely." });
    expect(again).toMatchObject({ ok: true, value: { entry: { id: input.entryId, content: { text: input.text } } } });
  });

  it("refuses an entry id that is another person's entry, or another thread's, or is not an id", async () => {
    const { ref } = await approvedThread();
    const mine = await newUpdate(ref.alertId, authorA);
    expect(await alerting.addUpdate(actorOf(adminC), { alertId: ref.alertId }, updateInput({ entryId: mine.entryId }))).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput({ entryId: ref.entryId }))).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
    const other = await approvedThread();
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: other.ref.alertId }, updateInput({ entryId: mine.entryId }))).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput({ entryId: "not-an-id" }))).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
  });

  it("needs the phase: an update with none, or one that is not one of the two, is refused and nothing is made", async () => {
    const { ref } = await approvedThread();
    for (const phase of ["", "resolved", "PROBLEM"]) {
      expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput({ phase: phase as AddUpdateInput["phase"] }))).toEqual({ ok: false, error: "PHASE_INVALID" });
    }
    expect(await entryRows(ref.alertId)).toHaveLength(1);
  });

  const refusals: Array<{ name: string; error: string; reason: string; input?: Partial<AddUpdateInput>; actor?: () => Account; setup?: (alertId: string) => Promise<unknown> }> = [
    { name: "no text", error: "TEXT_EMPTY", reason: "validation", input: { text: "   " } },
    { name: "a text over the limit", error: "TEXT_TOO_LONG", reason: "validation", input: { text: "x".repeat(601) } },
    { name: "a valid-until in the past", error: "VALID_UNTIL_PAST", reason: "validation", input: { validUntil: new Date("2026-10-01T14:00:00Z") } },
    { name: "a valid-until more than 7 days ahead", error: "VALID_UNTIL_TOO_FAR", reason: "validation", input: { validUntil: new Date("2026-10-20T14:00:00Z") } },
    { name: "a Director", error: "NOT_ALLOWED", reason: "forbidden", actor: () => director },
    { name: "an Ambassador who is not assigned to the building", error: "OUT_OF_SCOPE", reason: "out_of_scope", actor: () => ambassador },
    { name: "a thread that is closed", error: "ALERT_CLOSED", reason: "alert_closed", setup: (alertId) => closeThread(alertId) },
  ];
  it.each(refusals.map((scenario) => [scenario.name, scenario] as const))("refuses %s, makes nothing and records the refusal with its reason", async (_name, scenario) => {
    const { ref } = await approvedThread();
    await scenario.setup?.(ref.alertId);
    const before = await entryRows(ref.alertId);
    const auditBefore = (await auditRows()).length;
    const input = updateInput(scenario.input);

    expect(await alerting.addUpdate(actorOf(scenario.actor?.() ?? authorA), { alertId: ref.alertId }, input)).toEqual({ ok: false, error: scenario.error });

    expect(await entryRows(ref.alertId), "nothing was made").toEqual(before);
    const written = (await auditRows()).slice(auditBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ action: "entry.created", outcome: "refused", subject_id: input.entryId, meta: { reason: scenario.reason, refusal: scenario.error } });
    expect(Object.keys(written[0].meta).sort()).toEqual(["reason", "refusal"]);
  });

  it("refuses a thread that does not exist, and a thread with nothing published yet (its acknowledgement waits for approval: there is nothing to add to)", async () => {
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: randomUUID() }, updateInput())).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: "not-an-id" }, updateInput())).toEqual({ ok: false, error: "ALERT_NOT_FOUND" });

    const created = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!created.ok) throw new Error("createAlert refused");
    const alertId = created.value.thread.id;
    // A draft, then pending: neither is something residents read.
    expect(await alerting.addUpdate(actorOf(authorA), { alertId }, updateInput())).toEqual({ ok: false, error: "NO_PUBLISHED_ENTRY" });
    expect(await seams.freeze(actorOf(authorA), { alertId, entryId: created.value.entry.id }, frozen("ack"))).toMatchObject({ ok: true });
    expect(await alerting.addUpdate(actorOf(authorA), { alertId }, updateInput())).toEqual({ ok: false, error: "NO_PUBLISHED_ENTRY" });
    expect((await entryRows(alertId)).filter((row) => row.kind === "update")).toHaveLength(0);
  });

  it("does not stop an author whose carried-over audience names a floor that is gone: the draft is made, and the picker is the way to choose another place", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 5)]) });
    await owner`delete from building_floor where id = ${floorId(RSN, 5)}`;
    try {
      const update = await newUpdate(ref.alertId);
      expect(await alerting.chooseAudiencePlace(actorOf(authorA), { alertId: ref.alertId, entryId: update.entryId }, { scope: "buildings", buildings: [{ rsn: RSN, floors: null }] })).toMatchObject({ ok: true });
    } finally {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(RSN, 5)}, ${RSN}, '5', 5, true)`;
    }
  });

  it("keeps the thread's types: a save that changes them is refused for an update that follows other entries, and allowed for a thread's first entry", async () => {
    const { ref } = await approvedThread();
    const update = await newUpdate(ref.alertId);
    const current = (await alerting.getEntry(update))!.content;
    expect(await alerting.saveDraft(actorOf(authorA), update, { ...current, types: ["water"], audience: { ...current.audience, types: ["water"] } })).toEqual({ ok: false, error: "TYPES_CHANGED" });
    expect((await entryRow(update.entryId)).types).toEqual(["power"]);
    // The same save with the types as they are goes through (the author is the one who made it), changing the text and the phase.
    expect(await alerting.saveDraft(actorOf(authorA), update, { ...current, text: "A new text.", phase: "problem" })).toMatchObject({ ok: true, value: { content: { text: "A new text.", phase: "problem" } } });

    // A full alert written as a thread's first entry (O-02) may still change its types: there is nothing for them to be carried over from.
    const first = await alerting.createAlert(actorOf(authorA), { kind: "update", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!first.ok) throw new Error("createAlert refused");
    const firstRef = { alertId: first.value.thread.id, entryId: first.value.entry.id };
    expect(await alerting.saveDraft(actorOf(authorA), firstRef, content({ types: ["water"], audience: audienceOf(RSN, null, ["water"]) }))).toMatchObject({ ok: true });
  });
});

// --- submit, translation, freezing and approval are E04's, exactly --------------------------------------------------------------------

describe("an update goes through submit, approval, translation and freezing exactly like the other entries", () => {
  it("is translated into every language and rendered and hashed by the one renderer as an update of its own thread, with no entry it replaces, and is frozen as version 1", async () => {
    const { ref, slug } = await approvedThread();
    const contexts: PrepareContext[] = [];
    const update = await newUpdate(ref.alertId, authorA, { text: "Power is back on floors 1 to 4.", phase: "in_progress" });

    const report = await submitterFor(contexts).submit(actorOf(authorA), update, randomUUID());

    expect(report).toMatchObject({ state: "committed", outcome: null });
    // What the preparer was told: this is an update, of this thread, replacing nothing, with the Hub's attribution and the thread's public link.
    expect(contexts).toEqual([
      { alertId: ref.alertId, entryId: update.entryId, isDrill: false, kind: "update", supersedesId: null, channels: ["sms", "web"], slug, verified: true, attribution: { role: "hub" } },
    ]);
    const row = await entryRow(update.entryId);
    expect(row).toMatchObject({ status: "pending_approval", version: 1, kind: "update", phase: "in_progress" });
    expect(row.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${update.entryId}`)[0].n).toBe(FROZEN_LANGS.length);
    expect(row.sms_bodies.en.body).toContain("Power is back on floors 1 to 4.");
    expect(row.sms_bodies.en.body).toContain(`${BASE}/a/${slug}`);
    // The hash is the one the pure function makes of exactly what was frozen: kind update, the update's own phase, audience and valid-until.
    const frozenAgain = freezeContent({
      alertId: ref.alertId,
      kind: "update",
      supersedesId: null,
      isDrill: false,
      channels: ["sms", "web"],
      content: (await alerting.getEntry(update))!.content,
      translations: freezeTranslations(wholeSet("Power is back on floors 1 to 4."), "Power is back on floors 1 to 4."),
      verified: true,
      attribution: { role: "hub" },
      slug,
      publicBaseUrl: BASE,
    });
    expect(frozenAgain).toMatchObject({ ok: true, value: { contentHash: row.content_hash } });
  });

  it("is submitted once whatever number of times the same key is pressed (idempotent submit): the first attempt's result, one version, one attempt", async () => {
    const { ref } = await approvedThread();
    const update = await newUpdate(ref.alertId);
    const key = randomUUID();
    const submitter = submitterFor();
    const first = await submitter.submit(actorOf(authorA), update, key);
    const second = await submitter.submit(actorOf(authorA), update, key);
    expect(first).toMatchObject({ state: "committed" });
    expect(second).toMatchObject({ state: "committed", key });
    expect((await entryRow(update.entryId)).version).toBe(1);
    expect(await owner`select key, state from alert_submit_attempt where entry_id = ${update.entryId}`).toEqual([{ key, state: "committed" }]);
  });

  it("is approved by a second person bound to the version and the hash they were shown, and not by the person who wrote it or changed it", async () => {
    const { ref } = await approvedThread();
    const update = await pendingUpdate(ref.alertId, authorA);
    const shown = await shownOfRow(update);

    expect(await alerting.approveEntry(actorOf(authorA), update, shown)).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.approveEntry(actorOf(coordB), update, { ...shown, contentHash: sha("something else") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.approveEntry(actorOf(coordB), update, { ...shown, version: 9 })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect((await entryRow(update.entryId)).status).toBe("pending_approval");

    const before = await feedVersion();
    const approved = await alerting.approveEntry(actorOf(coordB), update, shown);
    expect(approved).toMatchObject({ ok: true, value: { entry: { id: update.entryId, kind: "update", status: "approved", approvedBy: coordB.id }, feedVersion: before + 1 } });
    const row = await entryRow(update.entryId);
    expect(row.web_published_at).toEqual(row.approved_at);
    expect([row.approved_version, row.approved_hash]).toEqual([shown.version, shown.contentHash]);
    expect(await feedVersion()).toBe(before + 1);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", outcome: "ok", actor_staff_id: coordB.id, subject_id: update.entryId, meta: { entry_id: update.entryId, version: 1, content_hash: shown.contentHash, recipient_count: 0 } });
  });

  it("captures the update's recipients from its own audience, as any entry: nothing it replaces is named (it supersedes nothing)", async () => {
    const { ref } = await approvedThread();
    captured.length = 0;
    const update = await pendingUpdate(ref.alertId);
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ entryId: update.entryId, alertId: ref.alertId, kind: "update", supersedesId: null, isDrill: false });
    expect(captured[0].audience).toEqual(audienceOf(RSN));
  });

  it("supersedes nothing and cancels nothing: the earlier entries are exactly as they were, still approved and published, and no entry names another it replaces", async () => {
    const { ref } = await approvedThread();
    const before = await entryRow(ref.entryId);
    const update = await pendingUpdate(ref.alertId);
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });

    const after = await entryRow(ref.entryId);
    // Every column of the earlier entry, updated_at included, is what it was: the update never touched its row.
    expect(after).toEqual(before);
    expect(after.status).toBe("approved");
    expect((await entryRows(ref.alertId)).map((row) => [row.kind, row.status])).toEqual([["ack", "approved"], ["update", "approved"]]);
    expect(await owner`select count(*)::int as n from alert_entry where status = 'superseded'`).toEqual([{ n: 0 }]);
    // The thread is the same open thread.
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_reason: null });
  });

  it("raises no feed version for a drill's update, as for any entry of a drill", async () => {
    const { ref } = await approvedThread({}, "ack", true);
    const update = await pendingUpdate(ref.alertId);
    const before = await feedVersion();
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true, value: { feedVersion: null } });
    expect(await feedVersion()).toBe(before);
  });
});

// --- widening and narrowing the audience ---------------------------------------------------------------------------------------------

describe("an update that changes who the thread is for", () => {
  it("stores the new audience on the update and leaves the thread's earlier entries as they were: the approval view compares it with the audience the thread has now", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 3)]) });
    const update = await newUpdate(ref.alertId);
    const wider = await alerting.chooseAudiencePlace(actorOf(authorA), update, { scope: "buildings", buildings: [{ rsn: RSN, floors: null }, { rsn: OTHER_RSN, floors: null }] });
    expect(wider).toMatchObject({ ok: true });
    expect(await alerting.chooseAudienceGroups(actorOf(authorA), update, ["seniors"])).toMatchObject({ ok: true });

    // Stored on the update, whole.
    expect((await entryRow(update.entryId)).audience).toEqual({
      scope: "buildings",
      buildings: [{ rsn: RSN, floors: null }, { rsn: OTHER_RSN, floors: null }],
      groups: ["seniors"],
      types: ["power"],
    });
    // The earlier entry still has its own.
    expect((await entryRow(ref.entryId)).audience).toEqual(audienceOf(RSN, [floorId(RSN, 3)]));

    // What the approver is shown it against: the audience of the entry that covers the thread now.
    expect(await submitterFor().submit(actorOf(authorA), update, randomUUID())).toMatchObject({ state: "committed" });
    const review = await alerting.review(update);
    expect(review?.threadAudience).toEqual(audienceOf(RSN, [floorId(RSN, 3)]));
    expect(review?.entry.content.audience).toEqual((await entryRow(update.entryId)).audience);
  });

  it("stores a narrowing the same way, and approves it: the thread's audience is then the narrower one", async () => {
    const { ref } = await approvedThread({ audience: { scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"], groups: [], types: ["power"] } });
    const update = await newUpdate(ref.alertId);
    expect(await alerting.chooseAudiencePlace(actorOf(authorA), update, { scope: "buildings", buildings: [{ rsn: RSN, floors: null }] })).toMatchObject({ ok: true });
    expect(await submitterFor().submit(actorOf(authorA), update, randomUUID())).toMatchObject({ state: "committed" });
    const review = await alerting.review(update);
    expect(review?.threadAudience).toEqual({ scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"].sort(), groups: [], types: ["power"] });
    expect(review?.entry.content.audience).toEqual(audienceOf(RSN));

    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    expect((await alerting.threadSummary(ref.alertId))?.covering?.audience).toEqual(audienceOf(RSN));
    // What the ack was for is on the ack still: a narrowing does not rewrite what residents were told.
    expect((await entryRow(ref.entryId)).audience).toEqual({ scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"].sort(), groups: [], types: ["power"] });
  });

  it("binds the approval to the entry the \"Now also for\" line was read against: another update approved meanwhile makes the press ENTRY_CHANGED, and reading again then approves", async () => {
    const { ref } = await approvedThread();
    const first = await pendingUpdate(ref.alertId);
    const second = await pendingUpdate(ref.alertId, authorA, { text: "Crews are on the way." });
    const read = await alerting.review(second);
    expect(read?.threadCoveringId).toBe(ref.entryId);
    expect(await alerting.approveEntry(actorOf(coordB), first, await shownOfRow(first))).toMatchObject({ ok: true });
    const shown = await shownOfRow(second);
    expect(await alerting.approveEntry(actorOf(coordB), second, { ...shown, covering: ref.entryId })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect((await entryRow(second.entryId)).status).toBe("pending_approval");
    const again = await alerting.review(second);
    expect(again?.threadCoveringId).toBe(first.entryId);
    expect(await alerting.approveEntry(actorOf(coordB), second, { ...shown, covering: first.entryId })).toMatchObject({ ok: true });
  });

  it("shows no audience to compare with for a thread's first entry, or once the entry is not waiting any more", async () => {
    const created = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!created.ok) throw new Error("createAlert refused");
    const first = { alertId: created.value.thread.id, entryId: created.value.entry.id };
    expect((await alerting.review(first))?.threadAudience).toBeNull();
    expect((await alerting.review(first))?.threadCoveringId).toBeNull();

    const { ref } = await approvedThread();
    const update = await pendingUpdate(ref.alertId);
    expect((await alerting.review(update))?.threadAudience).toEqual(audienceOf(RSN));
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    expect((await alerting.review(update))?.threadAudience).toBeNull();
  });
});

// --- the thread as residents read it -------------------------------------------------------------------------------------------------

describe("the thread as residents read it", () => {
  it("lists the entries newest first with each one's time and phase, keeps the earlier ones, and gives the thread the valid-until of the latest entry", async () => {
    const { ref } = await approvedThread({ phase: "problem", validUntil: new Date("2026-10-02T10:00:00Z") });
    const first = await pendingUpdate(ref.alertId, authorA, { text: "Toronto Hydro is on site.", phase: "problem", validUntil: new Date("2026-10-02T12:00:00Z") });
    expect(await alerting.approveEntry(actorOf(coordB), first, await shownOfRow(first))).toMatchObject({ ok: true });
    const second = await pendingUpdate(ref.alertId, authorA, { text: "Power is back on floors 1 to 4.", phase: "in_progress", validUntil: new Date("2026-10-02T09:00:00Z") });
    expect(await alerting.approveEntry(actorOf(adminC), second, await shownOfRow(second))).toMatchObject({ ok: true });

    const summary = await alerting.threadSummary(ref.alertId);
    expect(summary?.entries.map((entry) => [entry.kind, entry.phase, entry.text])).toEqual([
      ["update", "in_progress", "Power is back on floors 1 to 4."],
      ["update", "problem", "Toronto Hydro is on site."],
      ["ack", "problem", content().text],
    ]);
    // Each entry has the time it was published (the database's clock at approval), and they run from the latest back.
    const times = summary!.entries.map((entry) => entry.webPublishedAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set(times).size).toBe(3);
    // Earlier entries remain readable and still approved: an update replaces none of them.
    expect(summary?.entries.map((entry) => entry.status)).toEqual(["approved", "approved", "approved"]);
    // The thread's valid-until is the latest entry's, not the earliest or the longest.
    expect(summary?.covering?.id).toBe(second.entryId);
    expect(summary?.validUntil).toEqual(new Date("2026-10-02T09:00:00Z"));
    expect(threadValidUntil(summary!.entries)).toEqual(new Date("2026-10-02T09:00:00Z"));
    expect(summary?.ackOnly).toBe(false);
  });

  it("is read by the feed's own contract in either order, and a reader turns it newest first", async () => {
    const { ref, slug } = await approvedThread();
    const update = await pendingUpdate(ref.alertId);
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    const summary = (await alerting.threadSummary(ref.alertId))!;
    const entryOf = (entry: ThreadEntrySummary) => ({
      id: entry.id,
      kind: entry.kind,
      phase: entry.phase,
      verified: true,
      attribution: { role: "hub" },
      published_at: entry.webPublishedAt.toISOString(),
      text: { lang: "ur", body: "x", machine: true, model: "m", status: "ok" as const, source_hash: "h" },
      original: { lang: "en" as const, body: entry.text },
    });
    const thread = (entries: ThreadEntrySummary[]) => ({
      id: ref.alertId,
      slug,
      types: [...summary.covering!.types],
      audience: summary.covering!.audience,
      state: "open" as const,
      valid_until: summary.validUntil!.toISOString(),
      entries: entries.map(entryOf),
    });
    expect(FeedThreadSchema.safeParse(thread(summary.entries)).success).toBe(true);
    // The feed does not fail over the order (an ordering slip must not take every alert away from residents); R-07 turns it newest first.
    const oldestFirst = FeedThreadSchema.parse(thread([...summary.entries].reverse()));
    expect(entriesNewestFirst(oldestFirst.entries).map((entry) => entry.id)).toEqual(summary.entries.map((entry) => entry.id));
    // The rule the Hub's read model applies is the module's: newest first, whatever order the rows come in.
    expect(newestFirst([...summary.entries].reverse()).map((entry) => entry.id)).toEqual(summary.entries.map((entry) => entry.id));
  });

  it("is what residents read once an acknowledgement and an update are approved: the resident read path (createResidentAlerts and the feed's own FeedV1) lists both, oldest first, with each one's published_at, phase and the thread's valid_until", async () => {
    const { ref, slug } = await approvedThread();
    const update = await pendingUpdate(ref.alertId, authorA, { text: "Toronto Hydro is on site.", phase: "in_progress", validUntil: new Date("2026-10-02T09:00:00Z") });
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    const ack = await entryRow(ref.entryId);
    const upd = await entryRow(update.entryId);
    const wantedValidUntil = new Date("2026-10-02T09:00:00Z").toISOString();

    // What the module hands the page (createResidentAlerts, as the feed route's source wires it), read as the app's own role.
    const read = await createResidentAlerts(app).read("en");
    expect(read.threads).toHaveLength(1);
    // And what /api/feed answers (the route validates with FeedV1 and sends it as it is).
    const answer = await createFeed({ db: app, alertsEnabled: true, now: () => NOW }).read("en");
    const parsed = FeedV1.parse(answer);
    expect(parsed.threads).toEqual(read.threads);

    const thread = parsed.threads[0];
    expect(thread).toMatchObject({ id: ref.alertId, slug, state: "open", valid_until: wantedValidUntil });
    // The feed carries the entries oldest first (S04.08); nothing about the order is refused by the contract.
    expect(thread.entries.map((entry) => [entry.id, entry.kind, entry.phase])).toEqual([
      [ref.entryId, "ack", "problem"],
      [update.entryId, "update", "in_progress"],
    ]);
    // Each entry's time is the one the database stamped at its approval, to the millisecond, and the later approval is later.
    expect(thread.entries.map((entry) => entry.published_at)).toEqual([new Date(ack.web_published_at).toISOString(), new Date(upd.web_published_at).toISOString()]);
    expect(Date.parse(thread.entries[1].published_at)).toBeGreaterThan(Date.parse(thread.entries[0].published_at));
    expect(thread.entries[1].original.body).toBe("Toronto Hydro is on site.");
    // R-07 turns the same list newest first, and the thread's valid_until is the update's, not the acknowledgement's.
    expect(entriesNewestFirst(thread.entries).map((entry) => entry.id)).toEqual([update.entryId, ref.entryId]);
    expect(thread.valid_until).not.toBe(new Date(ack.valid_until).toISOString());
  });

  it("does not list an entry that waits for approval, a draft or a discarded one: residents read only what was approved", async () => {
    const { ref } = await approvedThread();
    await pendingUpdate(ref.alertId);
    await newUpdate(ref.alertId, adminC);
    const discarded = await newUpdate(ref.alertId, authorA);
    expect(await alerting.discardEntry(actorOf(authorA), discarded)).toMatchObject({ ok: true });
    const summary = await alerting.threadSummary(ref.alertId);
    expect(summary?.entries.map((entry) => entry.kind)).toEqual(["ack"]);
    expect(summary?.ackOnly).toBe(true);
  });

  it("says a thread is still only an acknowledgement until its first update is approved, and lists it as running with the one next step", async () => {
    const { ref } = await approvedThread({ types: ["elevator"], audience: audienceOf(RSN, null, ["elevator"]) });
    let running = await alerting.runningThreads();
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ alertId: ref.alertId, isDrill: false, types: ["elevator"], phase: "problem", coveringKind: "ack", ackOnly: true, entries: 1 });
    expect(running[0].validUntil).toEqual(new Date("2026-10-02T15:00:00Z"));

    const update = await pendingUpdate(ref.alertId);
    running = await alerting.runningThreads();
    expect(running[0]).toMatchObject({ coveringKind: "ack", ackOnly: true, entries: 1 });
    expect(await alerting.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toMatchObject({ ok: true });
    running = await alerting.runningThreads();
    expect(running[0]).toMatchObject({ coveringKind: "update", ackOnly: false, entries: 2, phase: "in_progress" });
  });

  it("lists the open threads newest news first, drills included and marked, a thread with nothing published not at all, and a closed thread never", async () => {
    const older = await approvedThread();
    const newer = await approvedThread();
    const drill = await approvedThread({}, "ack", true);
    const unpublished = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!unpublished.ok) throw new Error("createAlert refused");
    const closed = await approvedThread();
    await closeThread(closed.ref.alertId);

    const running = await alerting.runningThreads();
    expect(running.map((thread) => thread.alertId)).toEqual([drill.ref.alertId, newer.ref.alertId, older.ref.alertId]);
    expect(running.map((thread) => thread.isDrill)).toEqual([true, false, false]);
    expect(running.map((thread) => thread.alertId)).not.toContain(closed.ref.alertId);
    expect(running.map((thread) => thread.alertId)).not.toContain(unpublished.value.thread.id);
  });

  it("is read through the same summary for a closed thread, which says it is closed (the Hub offers no update on it)", async () => {
    const { ref } = await approvedThread();
    await closeThread(ref.alertId, "expired");
    expect((await alerting.threadSummary(ref.alertId))?.thread.status).toBe("closed");
    expect(await alerting.threadSummary(randomUUID())).toBeNull();
    expect(await alerting.threadSummary("not-an-id")).toBeNull();
  });

  it("tells the composer an update follows other entries, and the incidents list to open it on the update composer", async () => {
    const { ref } = await approvedThread();
    const update = await newUpdate(ref.alertId, authorA);
    expect((await alerting.entryState(ref))?.priorKinds).toEqual([]);
    expect((await alerting.entryState(update))?.priorKinds).toEqual(["ack"]);
    const mine = (await alerting.incidents({ staffId: authorA.id })).mine;
    expect(mine.map((row) => [row.kind, row.followUp])).toEqual([["update", true]]);
    // A thread's first entry, whether an acknowledgement or a full alert, follows nothing.
    const first = await alerting.createAlert(actorOf(authorA), { kind: "update", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!first.ok) throw new Error("createAlert refused");
    expect((await alerting.entryState({ alertId: first.value.thread.id, entryId: first.value.entry.id }))?.priorKinds).toEqual([]);
    expect((await alerting.incidents({ staffId: authorA.id })).mine.find((row) => row.entryId === first.value.entry.id)?.followUp).toBe(false);
  });

  it("counts only what residents can read: an update started and discarded does not turn a second first-update into an 'Add an update'", async () => {
    const { ref } = await approvedThread();
    const discarded = await newUpdate(ref.alertId, authorA);
    expect(await alerting.discardEntry(actorOf(authorA), discarded)).toMatchObject({ ok: true });
    const second = await newUpdate(ref.alertId, authorA);
    expect((await alerting.entryState(second))?.priorKinds).toEqual(["ack"]);
    expect((await alerting.incidents({ staffId: authorA.id })).mine.find((row) => row.entryId === second.entryId)?.followUp).toBe(true);
  });
});

// --- a thread that was closed while the update was written or waited -------------------------------------------------------------------

describe("a thread that was closed while the update was being written or waited for approval", () => {
  it("refuses the submit of a draft update with ALERT_CLOSED, freezes nothing, ends the attempt as failed with that reason, and records the refusal", async () => {
    const { ref } = await approvedThread();
    const update = await newUpdate(ref.alertId);
    await closeThread(ref.alertId);
    const auditBefore = (await auditRows()).length;

    const report = await submitterFor().submit(actorOf(authorA), update, randomUUID());

    expect(report).toEqual({ state: "refused", refusal: "ALERT_CLOSED" });
    expect(await entryRow(update.entryId)).toMatchObject({ status: "draft", version: 0, content_hash: null });
    expect((await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${update.entryId}`)[0].n).toBe(0);
    expect((await auditRows()).slice(auditBefore)).toEqual([
      expect.objectContaining({ action: "entry.submitted", outcome: "refused", subject_id: update.entryId, meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } }),
    ]);
  });

  it("refuses the approval of a pending update with ALERT_CLOSED: nothing is approved or published, no feed version is raised, and the refusal is recorded", async () => {
    const { ref } = await approvedThread();
    const update = await pendingUpdate(ref.alertId);
    const shown = await shownOfRow(update);
    await closeThread(ref.alertId);
    const before = { entry: await entryRow(update.entryId), feed: await feedVersion() };
    captured.length = 0;

    expect(await alerting.approveEntry(actorOf(coordB), update, shown)).toEqual({ ok: false, error: "ALERT_CLOSED" });

    expect(await entryRow(update.entryId)).toEqual(before.entry);
    expect((await entryRow(update.entryId)).status).toBe("pending_approval");
    expect(await feedVersion()).toBe(before.feed);
    expect(captured).toEqual([]);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", outcome: "refused", subject_id: update.entryId, meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });
  });

  it("refuses to save, return or discard what was being written, and to add another update, all as ALERT_CLOSED", async () => {
    const { ref } = await approvedThread();
    const draft = await newUpdate(ref.alertId, authorA);
    const pending = await pendingUpdate(ref.alertId, authorA);
    await closeThread(ref.alertId);
    const current = (await alerting.getEntry(draft))!.content;
    expect(await alerting.saveDraft(actorOf(authorA), draft, { ...current, text: "Changed." })).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect(await alerting.returnEntry(actorOf(authorA), pending, "edit")).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput())).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await entryRows(ref.alertId)).filter((row) => row.kind === "update")).toHaveLength(2);
  });

  it("is refused by the database too: a trigger will not add an entry to a closed thread, whoever asks", async () => {
    const { ref } = await approvedThread();
    await closeThread(ref.alertId);
    await expect(
      appSql.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${authorA.id}, true)`;
        await tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until)
                 values (${randomUUID()}, ${ref.alertId}, 'update', ${authorA.id}, ${[authorA.id]}, 'Late.', ${["power"]}, ${JSON.stringify(audienceOf(RSN))}::jsonb, 'problem', '2026-10-02T15:00:00Z')`;
      }),
    ).rejects.toThrow(/ALERT_CLOSED/);
  });

  it("serialises an approval and a close that run at the same moment: whichever takes the thread's lock first wins, and an approval after the close is refused", async () => {
    const { ref } = await approvedThread();
    const update = await pendingUpdate(ref.alertId);
    const shown = await shownOfRow(update);
    // The close takes the thread's lock first and holds it while the approval is started: the approval waits for it, and then finds the thread closed.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const closing = owner.begin(async (tx) => {
      await tx`select id from alert where id = ${ref.alertId} for update`;
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
      await held;
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    const approving = alerting.approveEntry(actorOf(coordB), update, shown);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await closing;
    expect(await approving).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await entryRow(update.entryId)).status).toBe("pending_approval");
  });
});
