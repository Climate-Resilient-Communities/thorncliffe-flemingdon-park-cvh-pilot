// Hub staff correct or withdraw what residents saw, in the open (S05.02), against a real database. A correction or a withdrawal is a new draft that names one
// valid target of its thread and goes through submit, translation, freezing and a second person's approval exactly like any entry; the approval replaces the
// target (`superseded`), stops the target's queued texts (`cancelQueued`), raises `feed_version` and audits both changes, all in one transaction under the thread's
// lock; an invalid target is refused with its reason, at the draft, the submit and the approval; two corrections of one target approved at once give exactly one
// success; the entry trigger refuses a direct change that supersedes an entry without an approved correction or withdrawal naming it; a withdrawal that leaves no
// published, non-superseded substantive entry closes the thread `withdrawn` in the same transaction (`closeAlert`), keeping the withdrawal's own texts; and the
// resident reader shows the correction above the original marked corrected, and a withdrawn entry with the withdrawal's reason in its place.
// The use cases run as the app's own role (cvh_app_login).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import { FeedThreadSchema } from "../../src/contracts/feed";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  createAlerting,
  createEntryPreparer,
  createResidentAlerts,
  createSubmitter,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type CorrectInput,
  type EntryContent,
  type EntryRef,
  type FrozenContent,
  type WithdrawInput,
} from "../../src/modules/alerting";
import { createAssignments } from "../../src/modules/identity";
import { floorsOfBuilding } from "../../src/modules/places";
import type { AlertRecipient, RecipientEntry, RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";
import { deferred, dispatcherWorld, fakeResolver, type DispatcherWorld } from "./dispatcherSupport";
import { drizzleDispatchStore } from "../../src/modules/messaging";

const RSN = "4154246";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];
const BASE = "https://cvh.example";

const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;

const sha = (tag: string) => createHash("sha256").update(tag, "utf8").digest("hex");

const audienceOf = (rsn: string, floors: string[] | null = null, types: string[] = ["power"]): Audience => ({ scope: "buildings", buildings: [{ rsn, floors }], groups: [], types: [...types].sort() });
const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out on floors 1 to 6. We are finding out more.",
  types: ["power"],
  audience: audienceOf(RSN),
  phase: "problem",
  validUntil: liveUntil ?? new Date("2026-10-02T15:00:00Z"),
  validUntilMode: "at",
  ...over,
});

const frozen = (tag: string): FrozenContent => ({
  contentHash: sha(tag),
  smsBodies: { en: { body: `en ${tag}`, encoding: "gsm7", segments: 1 } },
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
let world: DispatcherWorld;
/** Set by the sender's tests: the sender judges a valid-until by the real database clock, so their entries must be valid until after today. */
let liveUntil: Date | undefined;
const accounts: Account[] = [];

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`co_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
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

// The recipient port: who gets a text is whoever the test says, and what it was given is remembered.
const captured: RecipientEntry[] = [];
let recipientIds: string[] = [];
const port: RecipientsPort = {
  count: async () => ({ open: true, total: recipientIds.length, byLanguage: recipientIds.length > 0 ? { en: recipientIds.length } : {} }),
  capture: async (entry) => {
    captured.push(entry);
    return recipientIds.map((id): AlertRecipient => ({ kind: "subscriber", id, lang: "en" }));
  },
};
const reviewed = (): RecipientCounts => ({ total: recipientIds.length, byLanguage: recipientIds.length > 0 ? { en: recipientIds.length } : {} });

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
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhoods.push("TP");
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
              values (${RSN}, 'TP', ${`${RSN} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
  for (const [index, label] of FLOORS.entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(RSN, index)}, ${RSN}, ${label}, ${index}, true) on conflict do nothing`;
  }
  authorA = await account("coordinator");
  coordB = await account("coordinator");
  adminC = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => clock, recipients: port, pricePerSegmentCents: () => 5 });
  seams = submitSeams(owner, alerting);
  world = dispatcherWorld(owner, appSql, app);
});

afterAll(async () => {
  await world.reset();
  await clear();
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from audit_event where actor_staff_id = ${id}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    for (const { id } of accounts) await tx`delete from staff_account where id = ${id}`;
  });
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app?.$client.end({ timeout: 5 });
  await appSql?.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  clock = NOW;
  captured.length = 0;
  recipientIds = [];
  await clear();
});

// --- helpers ---------------------------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const entryRows = async (alertId: string) => await owner`select * from alert_entry where alert_id = ${alertId} order by created_at, id`;
const feedVersion = async () => Number((await owner`select version from feed_version`)[0].version);
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;
const deliveriesOf = async (entryId: string) => await owner<{ state: string }[]>`select state from delivery where entry_id = ${entryId}`;
const stateCounts = async (entryId: string) => {
  const counts: Record<string, number> = {};
  for (const { state } of await deliveriesOf(entryId)) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
};

const shownOfRow = async (ref: EntryRef) => {
  const row = await entryRow(ref.entryId);
  return { version: row.version as number, contentHash: row.content_hash as string, recipients: reviewed() };
};

/** The real submitter, preparer and renderer, with a translator stub that returns whole sets; it records what the preparer was told. */
function submitterFor(contexts: Array<Parameters<ReturnType<typeof createEntryPreparer>["prepare"]>[1]> = []) {
  const real = createEntryPreparer({
    translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) },
    freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }),
  });
  return createSubmitter({
    lifecycle: alerting,
    preparer: {
      prepare: (entryContent, context, hooks) => {
        contexts.push(context);
        return real.prepare(entryContent, context, hooks);
      },
    },
    ops: { record: async () => undefined },
  });
}

async function submitted(ref: EntryRef, by: Account = authorA): Promise<EntryRef> {
  const report = await submitterFor().submit(actorOf(by), ref, randomUUID());
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return ref;
}

/** An approved acknowledgement (or update) of the building, texted to `texts` people: the thread a correction is made to. */
async function approvedThread(over: Partial<EntryContent> = {}, kind: "ack" | "update" = "ack", texts = 0): Promise<{ ref: EntryRef; slug: string }> {
  recipientIds = Array.from({ length: texts }, () => randomUUID());
  const created = await alerting.createAlert(actorOf(authorA), { kind, isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const done = await seams.freeze(actorOf(authorA), ref, frozen(`first ${ref.entryId}`));
  if (!done.ok) throw new Error(`freeze refused: ${done.error}`);
  const approved = await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha(`first ${ref.entryId}`), recipients: reviewed() });
  if (!approved.ok) throw new Error(`approve refused: ${approved.error}`);
  recipientIds = [];
  return { ref, slug: created.value.thread.slug };
}

const updateInput = (over: Partial<Parameters<AlertLifecycle["addUpdate"]>[2]> = {}) => ({
  entryId: randomUUID(),
  text: "Toronto Hydro is on site. Power may be back after 11 pm.",
  phase: "in_progress" as const,
  validUntil: liveUntil ?? new Date("2026-10-02T09:00:00Z"),
  validUntilMode: "at" as const,
  ...over,
});

/** An approved update of the thread, texted to `texts` people. */
async function approvedUpdate(alertId: string, texts = 0, text?: string): Promise<EntryRef> {
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.addUpdate(actorOf(authorA), { alertId }, updateInput(text ? { text } : {}));
  if (!made.ok) throw new Error(`addUpdate refused: ${made.error}`);
  const ref = { alertId, entryId: made.value.entry.id };
  await submitted(ref);
  recipientIds = Array.from({ length: texts }, () => randomUUID());
  const approved = await alerting.approveEntry(actorOf(coordB), ref, await shownOfRow(ref));
  recipientIds = [];
  if (!approved.ok) throw new Error(`approve refused: ${approved.error}`);
  return ref;
}

const correctInput = (over: Partial<CorrectInput> = {}): CorrectInput => ({
  entryId: randomUUID(),
  text: "Power is out on floors 1 to 8, not floors 1 to 6.",
  phase: "problem",
  validUntil: liveUntil ?? new Date("2026-10-02T15:00:00Z"),
  validUntilMode: "at",
  ...over,
});
const withdrawInput = (over: Partial<WithdrawInput> = {}): WithdrawInput => ({ entryId: randomUUID(), reason: "wrong_information", text: "This alert was withdrawn because it gave wrong information.", ...over });

async function newCorrection(target: EntryRef, by: Account = authorA, over: Partial<CorrectInput> = {}): Promise<EntryRef> {
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.correctEntry(actorOf(by), { alertId: target.alertId, targetId: target.entryId }, correctInput(over));
  if (!made.ok) throw new Error(`correctEntry refused: ${made.error}`);
  return { alertId: target.alertId, entryId: made.value.entry.id };
}

async function newWithdrawal(target: EntryRef, by: Account = authorA, over: Partial<WithdrawInput> = {}): Promise<EntryRef> {
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.withdrawEntry(actorOf(by), { alertId: target.alertId, targetId: target.entryId }, withdrawInput(over));
  if (!made.ok) throw new Error(`withdrawEntry refused: ${made.error}`);
  return { alertId: target.alertId, entryId: made.value.entry.id };
}

const pendingCorrection = async (target: EntryRef, by: Account = authorA, over: Partial<CorrectInput> = {}) => submitted(await newCorrection(target, by, over), by);
const pendingWithdrawal = async (target: EntryRef, by: Account = authorA, over: Partial<WithdrawInput> = {}) => submitted(await newWithdrawal(target, by, over), by);

// --- making a correction or a withdrawal -------------------------------------------------------------------------------------------------

describe("making a correction", () => {
  it("is a draft of kind correction that names the target, starts from the audience and types the thread has, and has the author as its editor", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 1), floorId(RSN, 2)]) });
    const id = "01900000-0000-7000-8000-00000000c0c1";

    const made = await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, correctInput({ entryId: id }));

    expect(made).toMatchObject({ ok: true, value: { entry: { id, alertId: ref.alertId, kind: "correction", status: "draft", version: 0, authorId: authorA.id, editorIds: [authorA.id], supersedesId: ref.entryId, withdrawalReason: null } } });
    const row = await entryRow(id);
    expect(row.supersedes_id).toBe(ref.entryId);
    expect(row.withdrawal_reason).toBeNull();
    expect(row.audience).toEqual(audienceOf(RSN, [floorId(RSN, 1), floorId(RSN, 2)]));
    expect(row.original_text).toBe("Power is out on floors 1 to 8, not floors 1 to 6.");
    // Nothing the residents read changed, and nothing is replaced until the correction is approved.
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("audits the creation as entry.created, naming the kind and no text", async () => {
    const { ref } = await approvedThread();
    const correction = await newCorrection(ref);
    expect((await auditRows()).at(-1)).toEqual({ action: "entry.created", outcome: "ok", actor_staff_id: authorA.id, subject_id: correction.entryId, is_drill: false, meta: { entry_id: correction.entryId, kind: "correction", types: ["power"] } });
  });

  it("returns the draft that was made when the same entry id is sent again, even by two requests at once, and refuses an id that is somebody else's", async () => {
    const { ref } = await approvedThread();
    const input = correctInput();
    const results = await Promise.all([
      alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, input),
      alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, input),
    ]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect((await entryRows(ref.alertId)).filter((row) => row.kind === "correction")).toHaveLength(1);
    expect(await alerting.correctEntry(actorOf(adminC), { alertId: ref.alertId, targetId: ref.entryId }, input)).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, correctInput({ entryId: "nope" }))).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
  });

  it("can correct a correction, and an update, and the acknowledgement, whichever the Hub chooses", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId);
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, correctInput())).toMatchObject({ ok: true });
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: update.entryId }, correctInput())).toMatchObject({ ok: true });
    // A correction of a correction: first approve one.
    const correction = await pendingCorrection(update);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: correction.entryId }, correctInput())).toMatchObject({ ok: true });
  });
});

describe("making a withdrawal", () => {
  it("is a draft of kind withdrawal with the reason, the target's audience, types and phase, and a valid-until a day ahead; it supersedes nothing yet", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 3)]), phase: "in_progress" });
    const made = await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason: "wrong_place" }));
    expect(made).toMatchObject({ ok: true, value: { entry: { kind: "withdrawal", status: "draft", supersedesId: ref.entryId, withdrawalReason: "wrong_place" } } });
    if (!made.ok) return;
    const row = await entryRow(made.value.entry.id);
    expect(row.audience).toEqual(audienceOf(RSN, [floorId(RSN, 3)]));
    expect(row.phase).toBe("in_progress");
    expect(row.valid_until_mode).toBe("resolved");
    expect(new Date(row.valid_until)).toEqual(new Date(NOW.getTime() + 24 * 3600 * 1000));
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("takes each reason of the catalog and refuses any other; \"other\" needs its words", async () => {
    const { ref } = await approvedThread();
    for (const reason of ["wrong_place", "wrong_information", "duplicate", "other"]) {
      expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason })), reason).toMatchObject({ ok: true });
    }
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason: "because" }))).toEqual({ ok: false, error: "WITHDRAWAL_REASON_INVALID" });
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason: "other", text: "   " }))).toEqual({ ok: false, error: "TEXT_EMPTY" });
  });

  it("renews a withdrawal's valid-until on each save and each submit, so one drafted a day ago is submitted and approved with its texts queued", async () => {
    const { ref } = await approvedThread({ validUntil: new Date("2026-10-05T15:00:00Z") }, "ack", 2);
    const withdrawal = await newWithdrawal(ref);
    // 25 hours later the first valid-until has passed; a save renews it, and so does the submit.
    clock = new Date(clock.getTime() + 25 * 3600 * 1000);
    const current = (await alerting.getEntry(withdrawal))!.content;
    const saved = await alerting.saveDraft(actorOf(authorA), withdrawal, { ...current, text: "Withdrawn: it gave wrong information." });
    expect(saved.ok).toBe(true);
    expect((await entryRow(withdrawal.entryId)).valid_until.getTime()).toBe(clock.getTime() + 24 * 3600 * 1000);
    clock = new Date(clock.getTime() + 23 * 3600 * 1000);
    await submitted(withdrawal);
    expect((await entryRow(withdrawal.entryId)).valid_until.getTime()).toBe(clock.getTime() + 24 * 3600 * 1000);
    recipientIds = [randomUUID(), randomUUID()];
    const approved = await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal));
    expect(approved.ok).toBe(true);
    expect(await stateCounts(withdrawal.entryId)).toEqual({ queued: 2 });
  });

  it("keeps only the notice's words changeable: saving a withdrawal's draft changes its text and nothing about who it is for", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 3)]) });
    const withdrawal = await newWithdrawal(ref);
    const current = (await alerting.getEntry(withdrawal))!.content;
    const saved = await alerting.saveDraft(actorOf(authorA), withdrawal, { ...current, text: "Withdrawn: it was a duplicate.", audience: audienceOf(RSN), phase: "problem" });
    expect(saved).toMatchObject({ ok: true, value: { content: { text: "Withdrawn: it was a duplicate.", phase: "problem" } } });
    expect((await entryRow(withdrawal.entryId)).audience).toEqual(audienceOf(RSN, [floorId(RSN, 3)]));
  });
});

// --- who may, and which targets are valid ------------------------------------------------------------------------------------------------

describe("who may correct or withdraw, and what", () => {
  it.each([
    ["a Director", () => director, "NOT_ALLOWED", "forbidden"],
    ["an Ambassador (their own pending entries are E08's)", () => ambassador, "OUT_OF_SCOPE", "out_of_scope"],
  ] as const)("refuses %s, makes nothing and audits the refusal with its reason", async (_name, who, error, reason) => {
    const { ref } = await approvedThread();
    for (const make of [
      (input: { entryId: string }) => alerting.correctEntry(actorOf(who()), { alertId: ref.alertId, targetId: ref.entryId }, correctInput(input)),
      (input: { entryId: string }) => alerting.withdrawEntry(actorOf(who()), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput(input)),
    ]) {
      const input = { entryId: randomUUID() };
      expect(await make(input)).toEqual({ ok: false, error });
      expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.created", outcome: "refused", subject_id: input.entryId, meta: { reason, refusal: error } });
    }
    expect(await entryRows(ref.alertId)).toHaveLength(1);
  });

  it("refuses an Ambassador whatever the target: even an entry they wrote themselves (their own pending entries are E08's, so nothing is theirs to correct yet)", async () => {
    try {
      const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
      expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
      const created = await alerting.createAlert(actorOf(ambassador), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
      if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
      const mine = { alertId: created.value.thread.id, entryId: created.value.entry.id };
      // Their own draft, then their own submitted entry (frozen the way a submit would).
      expect(await alerting.correctEntry(actorOf(ambassador), { alertId: mine.alertId, targetId: mine.entryId }, correctInput())).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
      expect(await seams.freeze(actorOf(ambassador), mine, frozen("a1"))).toMatchObject({ ok: true });
      expect(await alerting.correctEntry(actorOf(ambassador), { alertId: mine.alertId, targetId: mine.entryId }, correctInput())).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
      expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: mine.alertId, targetId: mine.entryId }, withdrawInput())).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    } finally {
      await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    }
  });

  it("lets a Coordinator and an Admin correct or withdraw any valid target, whoever wrote it", async () => {
    const { ref } = await approvedThread();
    expect(await alerting.correctEntry(actorOf(coordB), { alertId: ref.alertId, targetId: ref.entryId }, correctInput())).toMatchObject({ ok: true });
    expect(await alerting.withdrawEntry(actorOf(adminC), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput())).toMatchObject({ ok: true });
  });

  it("refuses a target that is not valid, with the reason, and a thread that is closed", async () => {
    const { ref } = await approvedThread();
    const draftUpdate = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!draftUpdate.ok) throw new Error("addUpdate refused");
    const other = await approvedThread();
    const discarded = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!discarded.ok) throw new Error("addUpdate refused");
    expect(await alerting.discardEntry(actorOf(authorA), { alertId: ref.alertId, entryId: discarded.value.entry.id })).toMatchObject({ ok: true });
    const pendingUpdate = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!pendingUpdate.ok) throw new Error("addUpdate refused");
    await submitted({ alertId: ref.alertId, entryId: pendingUpdate.value.entry.id });

    const asked = (targetId: string, alertId = ref.alertId) => alerting.correctEntry(actorOf(authorA), { alertId, targetId }, correctInput());
    // A draft, a discarded entry, and an entry waiting for approval with nothing published: residents have read nothing of them.
    expect(await asked(draftUpdate.value.entry.id)).toEqual({ ok: false, error: "TARGET_NOT_PUBLISHED" });
    expect(await asked(discarded.value.entry.id)).toEqual({ ok: false, error: "TARGET_NOT_PUBLISHED" });
    expect(await asked(pendingUpdate.value.entry.id)).toEqual({ ok: false, error: "TARGET_NOT_PUBLISHED" });
    // An entry of another thread, one that does not exist, and something that is not an id.
    expect(await asked(other.ref.entryId)).toEqual({ ok: false, error: "TARGET_NOT_VALID" });
    expect(await asked(randomUUID())).toEqual({ ok: false, error: "TARGET_NOT_VALID" });
    expect(await asked("not-an-id")).toEqual({ ok: false, error: "TARGET_NOT_VALID" });
    // The same for a withdrawal.
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: draftUpdate.value.entry.id }, withdrawInput())).toEqual({ ok: false, error: "TARGET_NOT_PUBLISHED" });
    expect((await auditRows()).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "conflict", refusal: "TARGET_NOT_PUBLISHED" } });

    // Closed thread.
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
    expect(await asked(ref.entryId)).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput())).toEqual({ ok: false, error: "ALERT_CLOSED" });
  });

  it("refuses a target that was corrected or withdrawn already, and a withdrawal notice", async () => {
    const { ref } = await approvedThread();
    const withdrawalOfUpdate = await approvedUpdate(ref.alertId);
    const correction = await pendingCorrection(ref);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, correctInput())).toEqual({ ok: false, error: "TARGET_SUPERSEDED" });
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput())).toEqual({ ok: false, error: "TARGET_SUPERSEDED" });

    const withdrawal = await pendingWithdrawal(withdrawalOfUpdate);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: withdrawal.entryId }, correctInput())).toEqual({ ok: false, error: "TARGET_NOT_VALID" });
  });

  it("refuses at the submit a target that was replaced after the correction was written, before anything is frozen", async () => {
    const { ref } = await approvedThread();
    await approvedUpdate(ref.alertId);
    const first = await newCorrection(ref);
    const second = await newCorrection(ref, coordB);
    await submitted(first);
    expect(await alerting.approveEntry(actorOf(coordB), first, await shownOfRow(first))).toMatchObject({ ok: true });

    const report = await submitterFor().submit(actorOf(coordB), second, randomUUID());
    expect(report).toMatchObject({ state: "refused", refusal: "TARGET_SUPERSEDED" });
    expect((await entryRow(second.entryId)).status).toBe("draft");
    expect(await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${second.entryId}`).toEqual([{ n: 0 }]);
  });
});

// --- the approval ------------------------------------------------------------------------------------------------------------------------

describe("approving a correction", () => {
  it("is translated, rendered and hashed as a correction that names its target, and the hash covers the target", async () => {
    const { ref, slug } = await approvedThread();
    const contexts: Array<Parameters<ReturnType<typeof createEntryPreparer>["prepare"]>[1]> = [];
    const correction = await newCorrection(ref);
    await submitterFor(contexts).submit(actorOf(authorA), correction, randomUUID());
    expect(contexts).toEqual([
      { alertId: ref.alertId, entryId: correction.entryId, isDrill: false, kind: "correction", supersedesId: ref.entryId, channels: ["sms", "web"], slug, verified: true, attribution: { role: "hub" } },
    ]);
    const row = await entryRow(correction.entryId);
    expect(row).toMatchObject({ status: "pending_approval", version: 1 });
    expect(row.sms_bodies.en.body).toContain("Power is out on floors 1 to 8, not floors 1 to 6.");
    // The original is untouched until the approval: still approved, still published.
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("supersedes the target, raises feed_version once, cancels the target's queued texts and audits both changes, in one transaction", async () => {
    const { ref } = await approvedThread({}, "ack", 3);
    const other = await approvedUpdate(ref.alertId, 2);
    expect(await stateCounts(ref.entryId)).toEqual({ queued: 3 });
    expect(await stateCounts(other.entryId)).toEqual({ queued: 2 });
    const correction = await pendingCorrection(ref);
    recipientIds = Array.from({ length: 4 }, () => randomUUID());
    const before = await feedVersion();
    const auditBefore = (await auditRows()).length;

    const approved = await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction));

    expect(approved).toMatchObject({ ok: true, value: { entry: { id: correction.entryId, kind: "correction", status: "approved", supersedesId: ref.entryId }, feedVersion: before + 1 } });
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
    expect((await entryRow(correction.entryId)).status).toBe("approved");
    expect(await feedVersion()).toBe(before + 1);
    // The target's texts that were queued are cancelled; the other entry's are untouched; the correction's own are queued for the people captured.
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 3 });
    expect(await stateCounts(other.entryId)).toEqual({ queued: 2 });
    expect(await stateCounts(correction.entryId)).toEqual({ queued: 4 });
    // E07's hand-off: the capture was asked for the correction with the target it replaces and its own audience.
    expect(captured.at(-1)).toMatchObject({ entryId: correction.entryId, kind: "correction", supersedesId: ref.entryId });
    expect(captured.at(-1)?.audience).toEqual(audienceOf(RSN));
    // Both changes are audited, in the one transaction: the approval and the supersession.
    const written = (await auditRows()).slice(auditBefore);
    expect(written.map((row) => [row.action, row.outcome, row.subject_id])).toEqual([
      ["entry.superseded", "ok", ref.entryId],
      ["entry.approved", "ok", correction.entryId],
    ]);
    expect(written[0].meta).toEqual({ entry_id: ref.entryId, by: correction.entryId, by_kind: "correction" });
    // The thread stays open: a correction is substantive.
    expect((await threadRow(ref.alertId)).status).toBe("open");
  });

  it("changes nothing at all when the approval fails after the target was replaced: the target, the texts, the feed version and the audit roll back together", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    const correction = await pendingCorrection(ref);
    recipientIds = [randomUUID()];
    const before = await feedVersion();
    const auditBefore = (await auditRows()).length;

    // The reviewed count is not what the snapshot counts: the approval is refused after everything else was done in its transaction.
    const refused = await alerting.approveEntry(actorOf(coordB), correction, { ...(await shownOfRow(correction)), recipients: { total: 7, byLanguage: { en: 7 } } });

    expect(refused).toMatchObject({ ok: false, error: "RECIPIENT_COUNT_CHANGED" });
    expect((await entryRow(ref.entryId)).status).toBe("approved");
    expect((await entryRow(correction.entryId)).status).toBe("pending_approval");
    expect(await feedVersion()).toBe(before);
    expect(await stateCounts(ref.entryId)).toEqual({ queued: 2 });
    expect((await auditRows()).slice(auditBefore).map((row) => [row.action, row.outcome])).toEqual([["entry.approved", "refused"]]);
  });

  it("leaves a text that was already handed to the provider alone: it is in flight and cannot be stopped", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    const [first] = await owner<{ id: string }[]>`select id from delivery where entry_id = ${ref.entryId} order by id limit 1`;
    // Claimed, then handed to the provider (the hand-off is recorded first), then accepted by it.
    await owner`update delivery set state = 'claimed', claimed_by = 'worker-1', claim_token = ${randomUUID()} where id = ${first.id}`;
    await owner`update delivery set handed_off_at = now() where id = ${first.id}`;
    await owner`update delivery set state = 'submitted', provider_message_id = ${`SM${"a".repeat(32)}`} where id = ${first.id}`;
    const correction = await pendingCorrection(ref);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    expect(await stateCounts(ref.entryId)).toEqual({ submitted: 1, cancelled: 1 });
  });

  it("refuses the approval of a correction whose target was corrected by another correction first, with the reason, and approves exactly one of two at the same time", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    await approvedUpdate(ref.alertId);
    const first = await newCorrection(ref, authorA);
    const second = await newCorrection(ref, coordB);
    await submitted(first, authorA);
    await submitted(second, coordB);
    const before = await feedVersion();

    // Approved by a third person for each (the author of one is the approver of the other); both press Approve at the same moment.
    const results = await Promise.all([
      alerting.approveEntry(actorOf(adminC), first, await shownOfRow(first)),
      alerting.approveEntry(actorOf(adminC), second, await shownOfRow(second)),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const lost = results.find((result) => !result.ok);
    expect(lost).toEqual({ ok: false, error: "TARGET_SUPERSEDED" });
    const rows = await entryRows(ref.alertId);
    expect(rows.filter((row) => row.kind === "correction" && row.status === "approved")).toHaveLength(1);
    expect(rows.filter((row) => row.kind === "correction" && row.status === "pending_approval")).toHaveLength(1);
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
    expect(await feedVersion()).toBe(before + 1);
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 2 });
    expect((await auditRows()).filter((row) => row.action === "entry.superseded")).toHaveLength(1);
    expect((await auditRows()).filter((row) => row.action === "entry.approved" && row.outcome === "refused")).toHaveLength(1);
  });

  it("replaces a pending entry that residents already read (the D-1 case, E08) when a correction of it is approved, and a pending one with nothing published is not a target", async () => {
    const { ref } = await approvedThread();
    const hash = sha("d1");
    const seedPending = async (published: boolean) => {
      const id = randomUUID();
      await owner.begin(async (tx) => {
        await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
        await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at, web_published_at, created_at)
                 values (${id}, ${ref.alertId}, 'update', 'pending_approval', ${authorA.id}, ${[authorA.id]}, 'Posted before approval.', ${["power"]}, ${tx.json(audienceOf(RSN))}, 'problem', ${new Date("2026-10-02T15:00:00Z")},
                         1, ${hash}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now(), ${published ? new Date() : null}, ${new Date(NOW.getTime() + 500)})`;
        await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      });
      return { alertId: ref.alertId, entryId: id };
    };
    const unpublished = await seedPending(false);
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: unpublished.entryId }, correctInput())).toEqual({ ok: false, error: "TARGET_NOT_PUBLISHED" });

    const read = await seedPending(true);
    const correction = await pendingCorrection(read);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    expect((await entryRow(read.entryId)).status).toBe("superseded");
    expect((await entryRow(unpublished.entryId)).status).toBe("pending_approval");
  });

  it("refuses to approve a correction of an entry in a thread that closed since", async () => {
    const { ref } = await approvedThread();
    await approvedUpdate(ref.alertId);
    const correction = await pendingCorrection(ref);
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`;
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("raises no feed version for a drill's correction, still supersedes, and the outcome says so", async () => {
    const created = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: true, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!created.ok) throw new Error("createAlert refused");
    const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
    await seams.freeze(actorOf(authorA), ref, frozen("drill"));
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("drill") })).toMatchObject({ ok: true });
    const correction = await pendingCorrection(ref);
    const before = await feedVersion();
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true, value: { feedVersion: null } });
    expect(await feedVersion()).toBe(before);
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
  });

  it("shows the approver the entry it replaces, as residents read it now", async () => {
    const { ref } = await approvedThread();
    const correction = await pendingCorrection(ref);
    const review = await alerting.review(correction);
    expect(review?.target).toMatchObject({ id: ref.entryId, kind: "ack", status: "approved", valid: true, text: "Power is out on floors 1 to 6. We are finding out more." });
    const other = await alerting.correctEntry(actorOf(coordB), { alertId: ref.alertId, targetId: ref.entryId }, correctInput());
    if (!other.ok) throw new Error("correctEntry refused");
    await alerting.approveEntry(actorOf(adminC), correction, await shownOfRow(correction));
    expect((await alerting.review(correction))?.target).toMatchObject({ valid: false, status: "superseded" });
    expect((await alerting.review(ref))?.target ?? null).toBeNull();
  });
});

// --- the trigger -------------------------------------------------------------------------------------------------------------------------

describe("the on-call rule and corrections (S06.07, staff engineer's decision)", () => {
  // Texting is live and the roster is empty: a real update or alert is refused ONCALL_REQUIRED, a correction or a withdrawal is not, because staff must
  // always be able to fix or take back wrong information residents are reading.
  const live = () => createAlerting({ db: app, now: () => clock, recipients: port, pricePerSegmentCents: () => 5, oncall: { required: () => true } });
  const emptyRoster = async () => {
    await owner`delete from oncall_roster`;
  };

  it("approves a correction and a withdrawal with nobody on call, and refuses an update and a new thread's first entry with ONCALL_REQUIRED", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    const update = await approvedUpdate(ref.alertId, 1);
    await emptyRoster();

    const correction = await pendingCorrection(update);
    expect(await live().approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true, value: { entry: { kind: "correction", status: "approved" } } });
    expect((await entryRow(update.entryId)).status).toBe("superseded");

    const withdrawal = await pendingWithdrawal(correction);
    expect(await live().approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true, value: { entry: { kind: "withdrawal", status: "approved" } } });

    // An update of the same thread (not a correction) is still refused, and nothing changes.
    clock = new Date(clock.getTime() + 1000);
    const made = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!made.ok) throw new Error(`addUpdate refused: ${made.error}`);
    const pendingUpdate = await submitted({ alertId: ref.alertId, entryId: made.value.entry.id });
    expect(await live().approveEntry(actorOf(coordB), pendingUpdate, await shownOfRow(pendingUpdate))).toEqual({ ok: false, error: "ONCALL_REQUIRED" });
    expect((await entryRow(pendingUpdate.entryId)).status).toBe("pending_approval");

    // So is a new thread whose first entry is an update.
    const created = await alerting.createAlert(actorOf(authorA), { kind: "update", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
    const fresh = { alertId: created.value.thread.id, entryId: created.value.entry.id };
    const done = await seams.freeze(actorOf(authorA), fresh, frozen(`fresh ${fresh.entryId}`));
    if (!done.ok) throw new Error(`freeze refused: ${done.error}`);
    expect(await live().approveEntry(actorOf(coordB), fresh, { version: 1, contentHash: sha(`fresh ${fresh.entryId}`), recipients: reviewed() })).toEqual({ ok: false, error: "ONCALL_REQUIRED" });
  });

  it("reports a correction's or a withdrawal's target problem as itself, never as ONCALL_REQUIRED", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    await approvedUpdate(ref.alertId);
    const first = await newCorrection(ref, authorA);
    const second = await newCorrection(ref, coordB);
    const lateWithdrawal = await newWithdrawal(ref, authorA);
    await submitted(first, authorA);
    await submitted(second, coordB);
    await submitted(lateWithdrawal, authorA);
    await emptyRoster();

    expect(await live().approveEntry(actorOf(adminC), first, await shownOfRow(first))).toMatchObject({ ok: true });
    expect(await live().approveEntry(actorOf(adminC), second, await shownOfRow(second))).toEqual({ ok: false, error: "TARGET_SUPERSEDED" });
    expect(await live().approveEntry(actorOf(adminC), lateWithdrawal, await shownOfRow(lateWithdrawal))).toEqual({ ok: false, error: "TARGET_SUPERSEDED" });
  });
});

describe("the entry trigger", () => {
  /** A statement as the app's own role, in a transaction that names the acting account, as every use case does. */
  async function asApp<T>(actor: Account, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await appSql.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${actor.id}, true)`;
      return run(tx);
    })) as T;
  }

  it("refuses a direct change that marks an approved entry superseded with no approved correction or withdrawal naming it", async () => {
    const { ref } = await approvedThread();
    await expect(asApp(coordB, (tx) => tx`update alert_entry set status = 'superseded' where id = ${ref.entryId}`)).rejects.toMatchObject({ message: expect.stringContaining("superseded only by an approved correction or withdrawal") });
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("refuses it while a correction of the entry is only pending, and after one was approved earlier (not in this transaction)", async () => {
    const { ref } = await approvedThread();
    const first = await pendingCorrection(ref);
    await expect(asApp(coordB, (tx) => tx`update alert_entry set status = 'superseded' where id = ${ref.entryId}`)).rejects.toMatchObject({ message: expect.stringContaining("superseded only by an approved") });
    // The correction is approved through the use case; the entry is superseded with it. A second, separate attempt on another approved entry that a
    // correction approved in an earlier transaction named is refused: the approval has to be this very transaction's.
    const second = await approvedUpdate(ref.alertId);
    const pending = await pendingCorrection(second, authorA);
    expect(await alerting.approveEntry(actorOf(coordB), pending, await shownOfRow(pending))).toMatchObject({ ok: true });
    await owner`alter table alert_entry disable trigger alert_entry_guard`;
    try {
      await owner`update alert_entry set status = 'approved' where id = ${second.entryId}`;
    } finally {
      await owner`alter table alert_entry enable trigger alert_entry_guard`;
    }
    await expect(asApp(coordB, (tx) => tx`update alert_entry set status = 'superseded' where id = ${second.entryId}`)).rejects.toMatchObject({ message: expect.stringContaining("superseded only by an approved") });
    expect((await entryRow(first.entryId)).status).toBe("pending_approval");
  });

  it("refuses a draft, a discarded entry and a superseded one as a source of supersession, and a superseded entry never changes again", async () => {
    const { ref } = await approvedThread();
    const correction = await pendingCorrection(ref);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    for (const to of ["approved", "draft", "pending_approval", "discarded", "published_system"]) {
      await expect(asApp(coordB, (tx) => tx.unsafe(`update alert_entry set status = '${to}' where id = '${ref.entryId}'`)), to).rejects.toMatchObject({ message: expect.stringContaining("not an allowed transition") });
    }
    await expect(asApp(coordB, (tx) => tx`update alert_entry set original_text = 'quietly different' where id = ${ref.entryId}`)).rejects.toMatchObject({ message: expect.stringContaining("cannot be changed") });
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
  });

  it("refuses to approve a correction or withdrawal whose target is no longer a valid target, whatever the use case did", async () => {
    const { ref } = await approvedThread();
    await approvedUpdate(ref.alertId);
    const first = await pendingCorrection(ref);
    const second = await pendingCorrection(ref, coordB);
    expect(await alerting.approveEntry(actorOf(adminC), first, await shownOfRow(first))).toMatchObject({ ok: true });
    const row = await entryRow(second.entryId);
    await expect(
      asApp(adminC, (tx) => tx`update alert_entry set status = 'approved', approved_by = ${adminC.id}, approved_version = ${row.version}, approved_hash = ${row.content_hash} where id = ${second.entryId}`),
    ).rejects.toMatchObject({ message: expect.stringContaining("TARGET_NOT_VALID") });
    expect((await entryRow(second.entryId)).status).toBe("pending_approval");
  });

  it("refuses a correction or withdrawal that names nothing, another thread's entry, or an entry that is not a valid target; and an ack or update that names one", async () => {
    const { ref } = await approvedThread();
    const other = await approvedThread();
    const insert = (over: Record<string, unknown>) =>
      asApp(authorA, (tx) =>
        tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until, supersedes_id, withdrawal_reason)
           values (${randomUUID()}, ${ref.alertId}, ${over.kind as string}, ${authorA.id}, ${[authorA.id]}, 'x', ${["power"]}, ${tx.json(audienceOf(RSN))}, 'problem', ${new Date("2026-10-02T15:00:00Z")},
                   ${(over.supersedes as string | null) ?? null}, ${(over.reason as string | null) ?? null})`,
      );
    await expect(insert({ kind: "correction" })).rejects.toThrow();
    await expect(insert({ kind: "correction", supersedes: other.ref.entryId })).rejects.toMatchObject({ message: expect.stringContaining("TARGET_NOT_VALID") });
    await expect(insert({ kind: "correction", supersedes: randomUUID() })).rejects.toThrow();
    await expect(insert({ kind: "withdrawal", supersedes: ref.entryId })).rejects.toThrow();
    await expect(insert({ kind: "correction", supersedes: ref.entryId, reason: "other" })).rejects.toThrow();
    await expect(insert({ kind: "update", supersedes: ref.entryId })).rejects.toThrow();
    await expect(insert({ kind: "update", reason: "other" })).rejects.toThrow();
    // A final names no entry (S05.03): one that does is refused, and one that names none is a draft like any other.
    await expect(insert({ kind: "final", supersedes: ref.entryId })).rejects.toThrow();
    await expect(insert({ kind: "final", reason: "other" })).rejects.toThrow();
    await expect(insert({ kind: "correction", supersedes: ref.entryId })).resolves.toBeDefined();
  });

  it("never lets who an entry replaces, or a withdrawal's reason, change", async () => {
    const { ref } = await approvedThread();
    const withdrawal = await newWithdrawal(ref);
    await expect(asApp(authorA, (tx) => tx`update alert_entry set withdrawal_reason = 'other' where id = ${withdrawal.entryId}`)).rejects.toThrow();
    await expect(asApp(authorA, (tx) => tx`update alert_entry set supersedes_id = null where id = ${withdrawal.entryId}`)).rejects.toThrow();
  });
});

// --- withdrawals, and closing the thread ------------------------------------------------------------------------------------------

describe("approving a withdrawal", () => {
  it("supersedes the target and keeps the thread open on what remains: a thread with an acknowledgement and one update, the update withdrawn, stays open on its acknowledgement", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    const update = await approvedUpdate(ref.alertId, 2);
    const withdrawal = await pendingWithdrawal(update, authorA, { reason: "wrong_place" });
    recipientIds = [randomUUID(), randomUUID(), randomUUID()];
    const before = await feedVersion();

    const approved = await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal));

    expect(approved).toMatchObject({ ok: true, value: { entry: { kind: "withdrawal", status: "approved", supersedesId: update.entryId, withdrawalReason: "wrong_place" }, feedVersion: before + 1 } });
    expect((await entryRow(update.entryId)).status).toBe("superseded");
    expect((await entryRow(ref.entryId)).status).toBe("approved");
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_reason: null });
    // Only the withdrawn update's texts stop; the acknowledgement's stay queued; the withdrawal's own are queued.
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 2 });
    expect(await stateCounts(ref.entryId)).toEqual({ queued: 2 });
    expect(await stateCounts(withdrawal.entryId)).toEqual({ queued: 3 });
    expect((await auditRows()).some((row) => row.action === "alert.closed")).toBe(false);
    expect((await auditRows()).find((row) => row.action === "entry.superseded")?.meta).toEqual({ entry_id: update.entryId, by: withdrawal.entryId, by_kind: "withdrawal", withdrawal_reason: "wrong_place" });
  });

  it("closes the thread withdrawn, in the same transaction, when the only substantive entry is withdrawn, and keeps the withdrawal's own texts", async () => {
    const { ref } = await approvedThread({}, "ack", 2);
    // A draft, and an entry waiting for approval: neither was read, and both go with the close.
    const draft = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!draft.ok) throw new Error("addUpdate refused");
    const waiting = await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput());
    if (!waiting.ok) throw new Error("addUpdate refused");
    await submitted({ alertId: ref.alertId, entryId: waiting.value.entry.id });
    const withdrawal = await pendingWithdrawal(ref, authorA, { reason: "duplicate", text: "This alert was withdrawn because it was a duplicate." });
    recipientIds = [randomUUID(), randomUUID()];
    const before = await feedVersion();
    const auditBefore = (await auditRows()).length;

    const approved = await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal));

    expect(approved).toMatchObject({ ok: true, value: { feedVersion: before + 1 } });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "withdrawn" });
    expect((await threadRow(ref.alertId)).closed_at).not.toBeNull();
    expect((await entryRow(ref.entryId)).status).toBe("superseded");
    expect((await entryRow(withdrawal.entryId)).status).toBe("approved");
    expect((await entryRow(draft.value.entry.id)).status).toBe("discarded");
    expect((await entryRow(waiting.value.entry.id)).status).toBe("discarded");
    // The target's texts were cancelled with it; the withdrawal's own are kept and still sendable after the close.
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 2 });
    expect(await stateCounts(withdrawal.entryId)).toEqual({ queued: 2 });
    expect(await feedVersion()).toBe(before + 1);
    const written = (await auditRows()).slice(auditBefore);
    expect(written.map((row) => row.action).sort()).toEqual(["alert.closed", "entry.approved", "entry.discarded", "entry.discarded", "entry.superseded"]);
    expect(written.find((row) => row.action === "alert.closed")).toMatchObject({ subject_id: ref.alertId, meta: { closed_as: "withdrawn", discarded: 2, kept_entry_id: withdrawal.entryId } });
    expect(written.filter((row) => row.action === "entry.discarded").map((row) => row.meta.by_close)).toEqual([true, true]);
    // Every later change is refused.
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput())).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: withdrawal.entryId }, correctInput())).toEqual({ ok: false, error: "ALERT_CLOSED" });
  });

  it("closes the thread when every substantive entry is withdrawn one after another, but not while a correction stands in the place of one withdrawn entry", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId);
    // The acknowledgement is corrected: the correction stands in its place, so withdrawing the update leaves a substantive entry.
    const correction = await pendingCorrection(ref);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });
    const withdrawUpdate = await pendingWithdrawal(update);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawUpdate, await shownOfRow(withdrawUpdate))).toMatchObject({ ok: true });
    expect((await threadRow(ref.alertId)).status).toBe("open");
    // Now the correction is withdrawn: nothing substantive remains, and the withdrawal notices never count.
    const withdrawCorrection = await pendingWithdrawal(correction);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawCorrection, await shownOfRow(withdrawCorrection))).toMatchObject({ ok: true });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "withdrawn" });
  });

  it("is the integration test of the epic: one approved acknowledgement withdrawn closes the thread withdrawn; an acknowledgement and an update with only the update withdrawn stays open on the acknowledgement", async () => {
    const onlyAck = await approvedThread();
    const withdrawAck = await pendingWithdrawal(onlyAck.ref);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawAck, await shownOfRow(withdrawAck))).toMatchObject({ ok: true });
    expect(await threadRow(onlyAck.ref.alertId)).toMatchObject({ status: "closed", closed_reason: "withdrawn" });

    const both = await approvedThread();
    const update = await approvedUpdate(both.ref.alertId);
    const withdrawUpdate = await pendingWithdrawal(update);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawUpdate, await shownOfRow(withdrawUpdate))).toMatchObject({ ok: true });
    expect(await threadRow(both.ref.alertId)).toMatchObject({ status: "open", closed_reason: null });
    expect((await entryRow(both.ref.entryId)).status).toBe("approved");
  });

  it("goes to the people the withdrawn entry went to even when a floor its audience names is gone, and the capture is asked with the target", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 5)]) });
    const withdrawal = await pendingWithdrawal(ref);
    await owner`delete from building_floor where id = ${floorId(RSN, 5)}`;
    try {
      expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });
      expect(captured.at(-1)).toMatchObject({ entryId: withdrawal.entryId, kind: "withdrawal", supersedesId: ref.entryId });
    } finally {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(RSN, 5)}, ${RSN}, '5', 5, true)`;
    }
  });
});

// --- what residents read --------------------------------------------------------------------------------------------------------

describe("what residents read", () => {
  const readFeed = async (lang: "en" | "ur" = "en") => (await createResidentAlerts(app).read(lang)).threads;

  it("lists the correction with the entry it replaces, which stays readable: the original's wording is unchanged and the thread's words are the correction's", async () => {
    const { ref, slug } = await approvedThread();
    const correction = await pendingCorrection(ref);
    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });

    const [thread] = await readFeed();
    expect(FeedThreadSchema.safeParse(thread).success).toBe(true);
    expect(thread.slug).toBe(slug);
    const byId = new Map(thread.entries.map((entry) => [entry.id, entry]));
    expect(byId.get(correction.entryId)).toMatchObject({ kind: "correction", supersedes_id: ref.entryId });
    expect(byId.get(ref.entryId)?.original.body).toBe("Power is out on floors 1 to 6. We are finding out more.");
    expect(byId.get(ref.entryId)?.supersedes_id).toBeUndefined();
    // Every language reads the same entries.
    expect((await readFeed("ur"))[0].entries.map((entry) => entry.id).sort()).toEqual(thread.entries.map((entry) => entry.id).sort());
  });

  it("lists the withdrawal with the entry it withdrew, in the language asked for, and an open thread keeps its covering entry", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId);
    const withdrawal = await pendingWithdrawal(update, authorA, { reason: "wrong_information" });
    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });

    const [thread] = await readFeed("ur");
    const notice = thread.entries.find((entry) => entry.id === withdrawal.entryId);
    expect(notice).toMatchObject({ kind: "withdrawal", supersedes_id: update.entryId });
    expect(notice?.text.lang).toBe("ur");
    expect(notice?.phase).toBeUndefined();
    // The thread's valid-until is that of the acknowledgement, the covering entry now.
    expect(new Date(thread.valid_until)).toEqual(new Date("2026-10-02T15:00:00Z"));
  });

  it("no longer lists a thread a withdrawal closed (it is read from the archive, S05.07)", async () => {
    const { ref } = await approvedThread();
    const withdrawal = await pendingWithdrawal(ref);
    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });
    expect(await readFeed()).toEqual([]);
  });
});

// --- the sender after a correction (S06.03) ----------------------------------------------------------------------------------------------------
// The real approval, the real `cancelQueued` and the real sender (the provider and the numbers are fakes).

const bodyOfEntry = async (entryId: string) => (await owner<{ body: string }[]>`select body from delivery where entry_id = ${entryId} limit 1`)[0].body;

describe("a correction and the sender (S06.03)", () => {
  beforeEach(() => {
    // The alerting clock follows the real one here, so the valid-until the sender's standing check needs (after the database's now()) stays within the 7-day limit.
    clock = new Date();
    liveUntil = new Date(clock.getTime() + 2 * 86_400_000);
  });

  afterEach(async () => {
    liveUntil = undefined;
    clock = NOW;
    await world.reset();
  });

  it("an original part-sent: the correction cancels the queued and the claimed-but-not-handed-off rows in its transaction, leaves the handed-off and submitted rows, and goes to every recipient of the original", async () => {
    const { ref } = await approvedThread({}, "ack", 4);
    const original = await owner<{ id: string; recipient_id: string }[]>`select id, recipient_id from delivery where entry_id = ${ref.entryId} order by id`;
    const recipients = original.map((row) => row.recipient_id);
    const rows = original.map((row) => row.id);
    const [submittedRow, handedOffRow, claimedRow, queuedRow] = rows;
    await owner`update delivery set state = 'claimed', claimed_by = 'w', claim_token = ${randomUUID()} where id = any(${[submittedRow, handedOffRow, claimedRow]})`;
    await owner`update delivery set handed_off_at = now() where id = any(${[submittedRow, handedOffRow]})`;
    await owner`update delivery set state = 'submitted', provider_message_id = ${`SM${"b".repeat(32)}`} where id = ${submittedRow}`;
    const correction = await pendingCorrection(ref);
    recipientIds = recipients;

    expect(await alerting.approveEntry(actorOf(coordB), correction, await shownOfRow(correction))).toMatchObject({ ok: true });

    const states = Object.fromEntries((await owner<{ id: string; state: string }[]>`select id, state from delivery where entry_id = ${ref.entryId}`).map((row) => [row.id, row.state]));
    expect(states[submittedRow]).toBe("submitted");
    expect(states[handedOffRow]).toBe("claimed");
    expect(states[claimedRow]).toBe("cancelled");
    expect(states[queuedRow]).toBe("cancelled");
    // The correction goes to every recipient of the original.
    const sentTo = (await owner<{ recipient_id: string }[]>`select recipient_id from delivery where entry_id = ${correction.entryId}`).map((row) => row.recipient_id).sort();
    expect(sentTo).toEqual([...recipients].sort());
  });

  it("a correction approved between the sender's claim and its hand-off: the original's row is cancelled and not sent, the correction's text goes", async () => {
    const { ref } = await approvedThread({}, "ack", 1);
    const correction = await pendingCorrection(ref);
    recipientIds = [randomUUID()];
    const shown = await shownOfRow(correction);
    let approved: unknown;
    const store = {
      ...drizzleDispatchStore,
      async claim(...args: Parameters<typeof drizzleDispatchStore.claim>) {
        const result = await drizzleDispatchStore.claim(...args);
        if (result.kind === "claimed" && approved === undefined) approved = await alerting.approveEntry(actorOf(coordB), correction, shown);
        return result;
      },
    };

    await world.dispatcher({ store }).run();

    expect(approved).toMatchObject({ ok: true });
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 1 });
    expect(world.provider.calls.map((call) => call.body)).toEqual([await bodyOfEntry(correction.entryId)]);
  });

  it("a correction approved while a hand-off holds the original's row: it waits, finds the text handed off and leaves it, so the original goes and the correction follows", async () => {
    const { ref } = await approvedThread({}, "ack", 1);
    const correction = await pendingCorrection(ref);
    recipientIds = [randomUUID()];
    const shown = await shownOfRow(correction);
    const inside = deferred();
    const proceed = deferred();
    let first = true;
    const resolver = fakeResolver({
      onResolve: async () => {
        if (!first) return;
        first = false;
        inside.resolve();
        await proceed.promise;
      },
    });
    const run = world.dispatcher({ resolver: resolver.resolver }).run();
    await inside.promise;
    const approving = alerting.approveEntry(actorOf(coordB), correction, shown);
    await world.untilSomeoneWaitsForALock();
    proceed.resolve();
    const [, approved] = await Promise.all([run, approving]);

    expect(approved).toMatchObject({ ok: true });
    expect(await stateCounts(ref.entryId)).toEqual({ submitted: 1 });
    await world.dispatcher().run();
    expect(await stateCounts(correction.entryId)).toEqual({ submitted: 1 });
    expect(world.provider.calls.map((call) => call.body)).toEqual([await bodyOfEntry(ref.entryId), await bodyOfEntry(correction.entryId)]);
  });
});
