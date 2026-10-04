// Hub staff close an alert once, with a final word (S05.03), against a real database. "Mark resolved" makes a draft `final` that goes through submit, translation,
// freezing and a second person's approval like any entry; its approval, under the thread's lock and in one transaction, closes the thread `resolved` through the one
// close path (`closeAlert`: it discards the drafts and the entries waiting for approval, stops the queued texts of every other entry, raises `feed_version` and audits
// `alert.closed`) and then captures the final's recipients; the final's own texts stay queued. The database refuses any other close with the app's credentials; every
// later change in a closed thread is refused with ALERT_CLOSED and the refusal is recorded; concurrent actions on one thread end as if they ran one after the other in
// lock order; and a resident opens the closed thread by its address, with how it closed, the final message and every earlier entry.
// The use cases run as the app's own role (cvh_app_login).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import { FeedThreadSchema } from "../../src/contracts/feed";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  alertStandingReader,
  createAlerting,
  createEntryPreparer,
  createResidentAlerts,
  createSubmitter,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type EntryContent,
  type EntryRef,
  type FrozenContent,
} from "../../src/modules/alerting";
import { createCloseAlert } from "../../src/modules/alerting/application/closeAlert";
import * as audit from "../../src/modules/audit";
import { createAssignments } from "../../src/modules/identity";
import { floorsOfBuilding } from "../../src/modules/places";
import type { AlertRecipient, RecipientEntry, RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db, type DbTransaction } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";
import { deferred, dispatcherWorld, fakeResolver, type DispatcherWorld } from "./dispatcherSupport";
import { drizzleDispatchStore } from "../../src/modules/messaging";

const RSN = "4154346";
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
              values (${id}, ${randomUUID()}, ${`cl_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
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

// The recipient port: who gets a text is whoever the test says, and what it was asked is remembered, in order with the other seam's calls.
const events: string[] = [];
const captured: RecipientEntry[] = [];
let recipientIds: string[] = [];
const port: RecipientsPort = {
  count: async () => ({ open: true, total: recipientIds.length, byLanguage: recipientIds.length > 0 ? { en: recipientIds.length } : {} }),
  capture: async (entry) => {
    events.push("capture");
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
  events.length = 0;
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
const stateCounts = async (entryId: string) => {
  const counts: Record<string, number> = {};
  for (const { state } of await owner<{ state: string }[]>`select state from delivery where entry_id = ${entryId}`) counts[state] = (counts[state] ?? 0) + 1;
  return counts;
};
const shownOfRow = async (ref: EntryRef) => {
  const row = await entryRow(ref.entryId);
  return { version: row.version as number, contentHash: row.content_hash as string, recipients: reviewed() };
};

function submitterFor() {
  return createSubmitter({
    lifecycle: alerting,
    preparer: createEntryPreparer({
      translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) },
      freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }),
    }),
    ops: { record: async () => undefined },
  });
}

async function submitted(ref: EntryRef, by: Account = authorA): Promise<EntryRef> {
  const report = await submitterFor().submit(actorOf(by), ref, randomUUID());
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return ref;
}

/** An approved acknowledgement of the building, texted to `texts` people: the thread that is resolved. */
async function approvedThread(over: Partial<EntryContent> = {}, texts = 0, isDrill = false): Promise<{ ref: EntryRef; slug: string }> {
  recipientIds = Array.from({ length: texts }, () => randomUUID());
  // An Admin starts a drill: only an Admin at aal2 may (S06.05).
  const author = isDrill ? adminC : authorA;
  const created = await alerting.createAlert(actorOf(author), { kind: "ack", isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const done = await seams.freeze(actorOf(author), ref, frozen(`first ${ref.entryId}`));
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

async function newUpdate(alertId: string, text?: string): Promise<EntryRef> {
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.addUpdate(actorOf(authorA), { alertId }, updateInput(text ? { text } : {}));
  if (!made.ok) throw new Error(`addUpdate refused: ${made.error}`);
  return { alertId, entryId: made.value.entry.id };
}

/** An approved update of the thread, texted to `texts` people (their texts stay queued). */
async function approvedUpdate(alertId: string, texts = 0): Promise<EntryRef> {
  const ref = await submitted(await newUpdate(alertId));
  recipientIds = Array.from({ length: texts }, () => randomUUID());
  const approved = await alerting.approveEntry(actorOf(coordB), ref, await shownOfRow(ref));
  recipientIds = [];
  if (!approved.ok) throw new Error(`approve refused: ${approved.error}`);
  return ref;
}

const FINAL_TEXT = "Power is back on all floors. If your power is still out, call Toronto Hydro.";

async function newFinal(alertId: string, by: Account = authorA, text = FINAL_TEXT): Promise<EntryRef> {
  clock = new Date(clock.getTime() + 1000);
  const made = await alerting.startFinal(actorOf(by), { alertId }, { entryId: randomUUID(), text });
  if (!made.ok) throw new Error(`startFinal refused: ${made.error}`);
  return { alertId, entryId: made.value.entry.id };
}
const pendingFinal = async (alertId: string, by: Account = authorA, text?: string) => submitted(await newFinal(alertId, by, text), by);

// --- making a final ---------------------------------------------------------------------------------------------------------------------

describe("making a final (Mark resolved)", () => {
  it("is a draft of kind final that starts from what covers the thread, with the author as its editor, and an 'until resolved' valid-until a day ahead", async () => {
    const { ref } = await approvedThread({ audience: audienceOf(RSN, [floorId(RSN, 1), floorId(RSN, 2)]), phase: "in_progress" });
    const id = "01900000-0000-7000-8000-00000000f1a1";

    const made = await alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, { entryId: id, text: FINAL_TEXT });

    expect(made).toMatchObject({ ok: true, value: { entry: { id, alertId: ref.alertId, kind: "final", status: "draft", version: 0, authorId: authorA.id, editorIds: [authorA.id], supersedesId: null } } });
    const row = await entryRow(id);
    expect(row.audience).toEqual(audienceOf(RSN, [floorId(RSN, 1), floorId(RSN, 2)]));
    expect(row.phase).toBe("in_progress");
    expect(row.valid_until_mode).toBe("resolved");
    expect(new Date(row.valid_until)).toEqual(new Date(NOW.getTime() + 24 * 3600 * 1000));
    // Nothing is closed, and nothing is sent, until the final is approved.
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_reason: null, closing_entry_id: null });
    expect((await auditRows()).at(-1)).toEqual({ action: "entry.created", outcome: "ok", actor_staff_id: authorA.id, subject_id: id, is_drill: false, meta: { entry_id: id, kind: "final", types: ["power"] } });
  });

  it("returns the draft that was made when the same entry id is sent again, even by two requests at once, and refuses an id that is somebody else's", async () => {
    const { ref } = await approvedThread();
    const input = { entryId: randomUUID(), text: FINAL_TEXT };
    const results = await Promise.all([alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, input), alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, input)]);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect((await entryRows(ref.alertId)).filter((row) => row.kind === "final")).toHaveLength(1);
    expect(await alerting.startFinal(actorOf(adminC), { alertId: ref.alertId }, input)).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, { entryId: "nope", text: FINAL_TEXT })).toEqual({ ok: false, error: "ENTRY_ID_INVALID" });
  });

  it("is refused for a thread with nothing residents can read yet, for empty words, and for a role that may not author", async () => {
    const created = await alerting.createAlert(actorOf(authorA), { kind: "ack", isDrill: false, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content() });
    if (!created.ok) throw new Error("createAlert refused");
    expect(await alerting.startFinal(actorOf(authorA), { alertId: created.value.thread.id }, { entryId: randomUUID(), text: FINAL_TEXT })).toEqual({ ok: false, error: "NO_PUBLISHED_ENTRY" });
    const { ref } = await approvedThread();
    expect(await alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, { entryId: randomUUID(), text: "   " })).toEqual({ ok: false, error: "TEXT_EMPTY" });
    expect(await alerting.startFinal(actorOf(director), { alertId: ref.alertId }, { entryId: randomUUID(), text: FINAL_TEXT })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    // An Ambassador writes only for the buildings they are assigned to (their own screen is E08's): without an assignment the building is out of scope.
    expect(await alerting.startFinal(actorOf(ambassador), { alertId: ref.alertId }, { entryId: randomUUID(), text: FINAL_TEXT })).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect((await entryRows(ref.alertId)).filter((row) => row.kind === "final")).toHaveLength(0);
  });

  it("lets an Ambassador assigned to the building start a final of its alert (the policy is an update's), which only a second person can approve", async () => {
    const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
    expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
    try {
      const { ref } = await approvedThread();
      const made = await alerting.startFinal(actorOf(ambassador), { alertId: ref.alertId }, { entryId: randomUUID(), text: FINAL_TEXT });
      expect(made).toMatchObject({ ok: true, value: { entry: { kind: "final", authorId: ambassador.id } } });
    } finally {
      await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    }
  });

  it("saves the author's words and keeps its valid-until 'until resolved', renewed by each save and by the submit, so a final drafted a day ago is not stuck", async () => {
    const { ref } = await approvedThread();
    const final = await newFinal(ref.alertId);
    clock = new Date(clock.getTime() + 25 * 3600 * 1000);
    const current = (await alerting.getEntry(final))!.content;
    const saved = await alerting.saveDraft(actorOf(authorA), final, { ...current, text: "Resolved: the power is back.", validUntil: new Date("2026-10-01T16:00:00Z"), validUntilMode: "at" });
    expect(saved.ok).toBe(true);
    expect((await entryRow(final.entryId)).valid_until.getTime()).toBe(clock.getTime() + 24 * 3600 * 1000);
    clock = new Date(clock.getTime() + 23 * 3600 * 1000);
    await submitted(final);
    expect((await entryRow(final.entryId)).valid_until.getTime()).toBe(clock.getTime() + 24 * 3600 * 1000);
    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });
  });

  it("keeps the thread's types: a final that names other types is refused", async () => {
    const { ref } = await approvedThread();
    const final = await newFinal(ref.alertId);
    const current = (await alerting.getEntry(final))!.content;
    expect(await alerting.saveDraft(actorOf(authorA), final, { ...current, types: ["flood"], audience: { ...current.audience, types: ["flood"] } })).toEqual({ ok: false, error: "TYPES_CHANGED" });
  });

  it("shows the approver that approving it closes the alert", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    expect((await alerting.review(final))?.closesThread).toBe(true);
    const update = await submitted(await newUpdate(ref.alertId));
    expect((await alerting.review(update))?.closesThread).toBe(false);
  });
});

// --- approving a final closes the thread ---------------------------------------------------------------------------------------------------

describe("approving a final", () => {
  it("closes the thread resolved in the same transaction: the final is approved and recorded as the entry that closed it, and the texts of the final stay queued while the update's are cancelled", async () => {
    const { ref } = await approvedThread({}, 2);
    const update = await approvedUpdate(ref.alertId, 3);
    const final = await pendingFinal(ref.alertId);
    recipientIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const before = await feedVersion();

    const approved = await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final));

    expect(approved).toMatchObject({ ok: true, value: { feedVersion: before + 1, entry: { id: final.entryId, status: "approved" } } });
    const thread = await threadRow(ref.alertId);
    expect(thread).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
    // One transaction, one now(): the final's approval and the close are the same instant.
    expect(thread.closed_at.getTime()).toBe((await entryRow(final.entryId)).approved_at.getTime());
    expect(await feedVersion()).toBe(before + 1);
    // The earlier entries' queued texts are cancelled; the final's own texts are created and stay queued.
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 2 });
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 3 });
    expect(await stateCounts(final.entryId)).toEqual({ queued: 4 });
    // The earlier entries stay readable as they were.
    expect((await entryRow(update.entryId)).status).toBe("approved");
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });

  it("approves a final with nobody on call when texting is live, and closes the thread, while an update is still refused ONCALL_REQUIRED (staff engineer's decision: closing an alert residents are reading is never blocked)", async () => {
    const live = createAlerting({ db: app, now: () => clock, recipients: port, pricePerSegmentCents: () => 5, oncall: { required: () => true } });
    const { ref } = await approvedThread({}, 1);
    await owner`delete from oncall_roster`;

    const update = await submitted(await newUpdate(ref.alertId));
    expect(await live.approveEntry(actorOf(coordB), update, await shownOfRow(update))).toEqual({ ok: false, error: "ONCALL_REQUIRED" });
    expect((await entryRow(update.entryId)).status).toBe("pending_approval");
    expect((await threadRow(ref.alertId)).status).toBe("open");

    const final = await pendingFinal(ref.alertId);
    expect(await live.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true, value: { entry: { id: final.entryId, status: "approved" } } });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
  });

  it("discards every draft and every entry waiting for approval but the final, audits alert.closed with what it kept, and audits each discard as made by the close", async () => {
    const { ref } = await approvedThread();
    const draft = await newUpdate(ref.alertId);
    const waiting = await submitted(await newUpdate(ref.alertId));
    const final = await pendingFinal(ref.alertId);
    const auditBefore = (await auditRows()).length;

    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });

    expect((await entryRow(draft.entryId)).status).toBe("discarded");
    expect((await entryRow(waiting.entryId)).status).toBe("discarded");
    const written = (await auditRows()).slice(auditBefore);
    expect(written.map((row) => row.action).sort()).toEqual(["alert.closed", "entry.approved", "entry.discarded", "entry.discarded"]);
    expect(written.find((row) => row.action === "alert.closed")).toMatchObject({ outcome: "ok", subject_id: ref.alertId, actor_staff_id: coordB.id, meta: { closed_as: "resolved", discarded: 2, kept_entry_id: final.entryId } });
    expect(written.filter((row) => row.action === "entry.discarded").map((row) => row.meta.by_close)).toEqual([true, true]);
  });

  it("calls cancelQueued for every entry but the final, then captureRecipients for the final (kind final, no target), all inside the one transaction (fakes recording the calls)", async () => {
    const calls: { entryIds: string[]; inTransaction: boolean }[] = [];
    const recording = createAlerting({
      db: app,
      now: () => clock,
      recipients: port,
      cancelQueued: async (tx, entryIds) => {
        events.push("cancel");
        calls.push({ entryIds: [...entryIds].sort(), inTransaction: typeof tx.execute === "function" });
      },
    });
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId);
    const waiting = await submitted(await newUpdate(ref.alertId));
    const final = await pendingFinal(ref.alertId);
    events.length = 0;
    captured.length = 0;

    expect(await recording.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });

    expect(calls).toEqual([{ entryIds: [ref.entryId, update.entryId, waiting.entryId].sort(), inTransaction: true }]);
    expect(events).toEqual(["cancel", "capture"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ entryId: final.entryId, alertId: ref.alertId, kind: "final", supersedesId: null, isDrill: false });
    expect(captured[0].audience).toEqual(audienceOf(RSN));
  });

  it("rolls back the close with the approval when the recipient count changed since the approver reviewed it", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    const shown = await shownOfRow(final);
    recipientIds = [randomUUID()];

    const refused = await alerting.approveEntry(actorOf(coordB), final, shown);

    expect(refused).toMatchObject({ ok: false, error: "RECIPIENT_COUNT_CHANGED" });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_reason: null, closing_entry_id: null });
    expect((await entryRow(final.entryId)).status).toBe("pending_approval");
    expect(await stateCounts(final.entryId)).toEqual({});
  });

  it("does not let the author approve their own final, and refuses a final whose author may no longer write for its audience, changing nothing", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    expect(await alerting.approveEntry(actorOf(authorA), final, await shownOfRow(final))).toMatchObject({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    await owner`update staff_account set status = 'suspended' where id = ${authorA.id}`;
    try {
      expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toEqual({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
    } finally {
      await owner`update staff_account set status = 'active' where id = ${authorA.id}`;
    }
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open" });
  });

  it("raises no feed version for a drill's final, still closes, and says so", async () => {
    const { ref } = await approvedThread({}, 0, true);
    const final = await pendingFinal(ref.alertId);
    const before = await feedVersion();

    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true, value: { feedVersion: null } });

    expect(await feedVersion()).toBe(before);
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
  });

  it("is told apart by the sender as the closing entry: only the approved final, never the entries before it", async () => {
    const { ref } = await approvedThread({}, 1);
    const final = await pendingFinal(ref.alertId);
    recipientIds = [randomUUID()];
    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });

    const standing = (entryId: string) => app.transaction((tx) => alertStandingReader.standingOf(tx, entryId, 0));
    expect(await standing(final.entryId)).toMatchObject({ threadOpen: false, isClosingEntry: true, entryKind: "final" });
    expect(await standing(ref.entryId)).toMatchObject({ threadOpen: false, isClosingEntry: false });
  });
});

// --- the one close path -------------------------------------------------------------------------------------------------------------------

describe("closeAlert", () => {
  const closeAlertFor = (cancelled: string[][] = []) =>
    createCloseAlert({
      audit: { record: (tx, event) => audit.record(tx, event), recordRefusal: (db, event) => audit.recordRefusal(db, event) },
      cancelQueued: async (_tx, ids) => void cancelled.push([...ids]),
    });
  const asActor = (run: (tx: DbTransaction) => Promise<unknown>) =>
    app.transaction(async (tx) => {
      await tx.execute(sql`select set_config('cvh.actor_id', ${coordB.id}, true)`);
      return run(tx);
    });

  it("refuses to keep an entry of another thread, one that is not there, and one that is not the entry that closes the thread (a caller's mistake rolls everything back)", async () => {
    const one = await approvedThread();
    const two = await approvedThread();
    const finalTwo = await pendingFinal(two.ref.alertId);
    await alerting.approveEntry(actorOf(coordB), finalTwo, await shownOfRow(finalTwo));
    const closeAlert = closeAlertFor();

    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "resolved", keepEntryId: finalTwo.entryId }))).rejects.toMatchObject({ refusal: "ENTRY_NOT_FOUND" });
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "resolved", keepEntryId: randomUUID() }))).rejects.toMatchObject({ refusal: "ENTRY_NOT_FOUND" });
    // The acknowledgement is an approved entry of this thread, but it is not a final.
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "resolved", keepEntryId: one.ref.entryId }))).rejects.toThrow(/closed by an approved final/);
    // Closing, whatever the reason, names the entry that closes the thread.
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "resolved" } as never))).rejects.toThrow(/always names the entry that closes the thread/);
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "withdrawn" } as never))).rejects.toThrow(/always names the entry that closes the thread/);
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: one.ref.alertId, reason: "expired" } as never))).rejects.toThrow(/always names the entry that closes the thread/);
    expect(await threadRow(one.ref.alertId)).toMatchObject({ status: "open" });
  });

  it("refuses a thread that is closed already, once, with ALERT_CLOSED", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final));
    const closeAlert = closeAlertFor();
    await expect(asActor((tx) => closeAlert(tx, { staffId: coordB.id }, { alertId: ref.alertId, reason: "resolved", keepEntryId: final.entryId }))).rejects.toMatchObject({ refusal: "ALERT_CLOSED" });
  });

  it("locks the entries before the delivery rows and waits behind a delivery row the dispatcher holds, instead of deadlocking with it", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId, 2);
    const final = await pendingFinal(ref.alertId);
    let approval!: Promise<unknown>;
    const shown = await shownOfRow(final);
    // A transaction that holds the update's delivery rows, as the dispatcher's hand-off does while it claims them.
    await owner.begin(async (tx) => {
      await tx`select id from delivery where entry_id = ${update.entryId} for update`;
      approval = alerting.approveEntry(actorOf(coordB), final, shown);
      await new Promise((resolve) => setTimeout(resolve, 400));
      // The approval has locked the thread and every entry of it, and is now waiting for the delivery rows: no entry row is free for anyone else, so what is
      // behind the held delivery rows is only the delivery rows (the entries were locked first: AD-18's order, which cannot deadlock with a hand-off).
      expect(await tx`select id from alert_entry where alert_id = ${ref.alertId} for update skip locked`).toHaveLength(0);
    });
    expect(await approval).toMatchObject({ ok: true });
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 2 });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved" });
  });
});

// --- a closed thread refuses everything -----------------------------------------------------------------------------------------------------

describe("a closed thread", () => {
  async function closedThread() {
    const { ref, slug } = await approvedThread({}, 1);
    const update = await approvedUpdate(ref.alertId);
    const waiting = await submitted(await newUpdate(ref.alertId));
    const final = await pendingFinal(ref.alertId);
    recipientIds = [randomUUID()];
    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });
    recipientIds = [];
    return { ref, slug, update, waiting, final };
  }

  it("refuses to submit, approve, correct, withdraw, update, resolve or save in it with ALERT_CLOSED, and records each refusal", async () => {
    const { ref, update, waiting, final } = await closedThread();
    const auditBefore = (await auditRows()).length;
    const closed = { ok: false, error: "ALERT_CLOSED" };

    // Submit: the entry waiting for approval was discarded by the close; an entry written before it cannot be frozen either.
    expect(await seams.freeze(actorOf(authorA), waiting, frozen("late"))).toEqual(closed);
    expect(await alerting.beginSubmit(actorOf(authorA), waiting, randomUUID(), { kind: "submit" })).toEqual(closed);
    expect(await alerting.approveEntry(actorOf(adminC), waiting, { version: 1, contentHash: sha("x") })).toEqual(closed);
    expect(await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: update.entryId }, { entryId: randomUUID(), text: "Corrected.", phase: "problem", validUntil: new Date("2026-10-02T15:00:00Z"), validUntilMode: "at" })).toEqual(closed);
    expect(await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: final.entryId }, { entryId: randomUUID(), reason: "duplicate", text: "Withdrawn." })).toEqual(closed);
    expect(await alerting.addUpdate(actorOf(authorA), { alertId: ref.alertId }, updateInput())).toEqual(closed);
    expect(await alerting.startFinal(actorOf(authorA), { alertId: ref.alertId }, { entryId: randomUUID(), text: FINAL_TEXT })).toEqual(closed);
    expect(await alerting.saveDraft(actorOf(authorA), waiting, content())).toEqual(closed);

    const refusals = (await auditRows()).slice(auditBefore);
    expect(refusals.length).toBeGreaterThanOrEqual(7);
    for (const row of refusals) expect(row, row.action).toMatchObject({ outcome: "refused", meta: { reason: "alert_closed", refusal: "ALERT_CLOSED" } });
    expect(refusals.map((row) => row.action)).toEqual(expect.arrayContaining(["entry.submitted", "entry.approved", "entry.created"]));
  });

  it("refuses an approval of an entry that was written before the close and is still waiting in no thread: the final's own entry is approved once and never again", async () => {
    const { final } = await closedThread();
    expect(await alerting.approveEntry(actorOf(adminC), final, { version: 1, contentHash: sha("x") })).toEqual({ ok: false, error: "ALERT_CLOSED" });
  });

  it("is no longer a running alert on the Hub, and is listed as recently closed with how it closed and its final message", async () => {
    const { ref, final } = await closedThread();
    expect((await alerting.runningThreads()).map((thread) => thread.alertId)).not.toContain(ref.alertId);
    const closed = await alerting.closedThreads(new Date(NOW.getTime() - 7 * 24 * 3600 * 1000));
    expect(closed).toEqual([expect.objectContaining({ alertId: ref.alertId, reason: "resolved", isDrill: false, types: ["power"], closingText: FINAL_TEXT })]);
    expect(closed[0].closedAt.getTime()).toBe((await entryRow(final.entryId)).approved_at.getTime());
    // Nothing older than the window is listed.
    expect(await alerting.closedThreads(new Date(Date.now() + 24 * 3600 * 1000))).toEqual([]);
  });

  it("lists a thread closed withdrawn with the withdrawal's words, and a drill as a drill", async () => {
    const { ref } = await approvedThread();
    const made = await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, { entryId: randomUUID(), reason: "other", text: "Sent for the wrong building." });
    if (!made.ok) throw new Error("withdrawEntry refused");
    const withdrawal = await submitted({ alertId: ref.alertId, entryId: made.value.entry.id });
    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });
    const drill = await approvedThread({}, 0, true);
    const drillFinal = await pendingFinal(drill.ref.alertId);
    expect(await alerting.approveEntry(actorOf(coordB), drillFinal, await shownOfRow(drillFinal))).toMatchObject({ ok: true });

    const closed = await alerting.closedThreads(new Date(NOW.getTime() - 24 * 3600 * 1000));

    expect(closed.map((thread) => [thread.alertId, thread.reason, thread.isDrill, thread.closingText])).toEqual(
      expect.arrayContaining([
        [ref.alertId, "withdrawn", false, "Sent for the wrong building."],
        [drill.ref.alertId, "resolved", true, FINAL_TEXT],
      ]),
    );
  });
});

// --- only the close path closes ---------------------------------------------------------------------------------------------------------------

describe("the thread trigger, against direct SQL with the app's credentials", () => {
  async function asApp<T>(actor: Account, run: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return (await appSql.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${actor.id}, true)`;
      return run(tx);
    })) as T;
  }

  it("refuses to close a thread with no entry that closes it, whatever the reason, and leaves the thread open", async () => {
    const { ref } = await approvedThread();
    for (const reason of ["resolved", "withdrawn", "expired"]) {
      await expect(asApp(coordB, (tx) => tx`update alert set status = 'closed', closed_reason = ${reason}, closed_at = now() where id = ${ref.alertId}`), reason).rejects.toThrow(/closed beside the entry that closes it/);
    }
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_reason: null, closed_at: null, closing_entry_id: null });
  });

  it("refuses a close beside an entry that is not the closing entry: an approved acknowledgement, a pending final, a final of another thread, or the wrong reason for the entry", async () => {
    const one = await approvedThread();
    const two = await approvedThread();
    const pending = await pendingFinal(one.ref.alertId);
    const otherFinal = await pendingFinal(two.ref.alertId);
    await alerting.approveEntry(actorOf(coordB), otherFinal, await shownOfRow(otherFinal));
    const close = (reason: string, entryId: string) => asApp(coordB, (tx) => tx`update alert set status = 'closed', closed_reason = ${reason}, closed_at = now(), closing_entry_id = ${entryId} where id = ${one.ref.alertId}`);

    await expect(close("resolved", one.ref.entryId)).rejects.toThrow(/closes only beside an approved final/);
    await expect(close("resolved", pending.entryId)).rejects.toThrow(/closes only beside an approved final/);
    await expect(close("resolved", otherFinal.entryId)).rejects.toThrow(/closes only beside an approved final/);
    await expect(close("withdrawn", pending.entryId)).rejects.toThrow(/closes only beside an approved final/);
    await expect(close("expired", pending.entryId)).rejects.toThrow(/closes only beside an approved final/);
    expect(await threadRow(one.ref.alertId)).toMatchObject({ status: "open" });
  });

  it("refuses a close beside an approved final that was approved in another transaction, and a closing entry on a thread that stays open", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    // Approved by direct SQL in one transaction, closed in the next: the evidence must be made in the same transaction as the close.
    const row = await entryRow(final.entryId);
    await asApp(coordB, (tx) =>
      tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_version = ${row.version}, approved_hash = ${row.content_hash} where id = ${final.entryId}`,
    );
    await expect(asApp(coordB, (tx) => tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now(), closing_entry_id = ${final.entryId} where id = ${ref.alertId}`)).rejects.toThrow(
      /closes only beside an approved final/,
    );
    await expect(asApp(coordB, (tx) => tx`update alert set closing_entry_id = ${final.entryId} where id = ${ref.alertId}`)).rejects.toThrow(/only a closed thread has a closing entry/);
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closing_entry_id: null });
  });

  it("closes beside an approved final made in the same transaction, times the close by the database's clock, and then never changes", async () => {
    const { ref } = await approvedThread();
    const final = await pendingFinal(ref.alertId);
    const row = await entryRow(final.entryId);

    const [closed] = await asApp(coordB, async (tx) => {
      await tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_version = ${row.version}, approved_hash = ${row.content_hash} where id = ${final.entryId}`;
      return tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = '2000-01-01T00:00:00Z', closing_entry_id = ${final.entryId} where id = ${ref.alertId} returning closed_at, now() as db_now`;
    });

    expect(closed.closed_at.getTime()).toBe(closed.db_now.getTime());
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
    await expect(asApp(coordB, (tx) => tx`update alert set closing_entry_id = null where id = ${ref.alertId}`)).rejects.toThrow(/ALERT_CLOSED/);
    await expect(asApp(coordB, (tx) => tx`update alert set closed_reason = 'expired' where id = ${ref.alertId}`)).rejects.toThrow(/ALERT_CLOSED/);
  });

  it("lets only one final of a thread be approved or published, so two finals cannot both close it", async () => {
    const { ref } = await approvedThread();
    const first = await pendingFinal(ref.alertId);
    const second = await pendingFinal(ref.alertId);
    const [rowOne, rowTwo] = [await entryRow(first.entryId), await entryRow(second.entryId)];
    const approve = (row: Record<string, unknown>) =>
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${coordB.id}, true)`;
        await tx`update alert_entry set status = 'approved', approved_by = ${coordB.id}, approved_version = ${row.version as number}, approved_hash = ${row.content_hash as string} where id = ${row.id as string}`;
      });
    await approve(rowOne);
    await expect(approve(rowTwo)).rejects.toThrow(/alert_entry_one_final/);
  });

  it("creates a final as a draft like the other entries, and refuses a final that names an entry it replaces", async () => {
    const { ref } = await approvedThread();
    const insert = (supersedes: string | null) =>
      asApp(authorA, (tx) =>
        tx`insert into alert_entry (id, alert_id, kind, author_id, editor_ids, original_text, types, audience, phase, valid_until, supersedes_id)
           values (${randomUUID()}, ${ref.alertId}, 'final', ${authorA.id}, ${[authorA.id]}, 'x', ${["power"]}, ${tx.json(audienceOf(RSN))}, 'problem', ${new Date("2026-10-02T15:00:00Z")}, ${supersedes})`,
      );
    await expect(insert(ref.entryId)).rejects.toThrow();
    await expect(insert(null)).resolves.toBeDefined();
  });
});

// --- concurrency ---------------------------------------------------------------------------------------------------------------------------

describe("concurrent actions on one thread", () => {
  /**
   * Runs the actions on one thread in a fixed order, deterministically: a separate owner transaction holds the thread's lock, each action is started in turn and
   * waits (a lock wait is seen in pg_stat_activity) before the next starts, then the lock is released. Waiters are served in the order they queued, so the first
   * action takes the thread first, whatever the timing.
   */
  // The test's `owner` connection is a single one: the lock holder and the monitor have their own, so neither waits behind the actions.
  let holderSql: ReturnType<typeof connect>;
  let monitorSql: ReturnType<typeof connect>;
  beforeAll(() => {
    holderSql = connect(serverUrl());
    monitorSql = connect(serverUrl());
  });
  afterAll(async () => {
    await holderSql.end({ timeout: 5 });
    await monitorSql.end({ timeout: 5 });
  });
  const lockWaiters = async (): Promise<number> =>
    (await monitorSql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)[0].n as number;
  async function inOrder<T>(alertId: string, actions: ReadonlyArray<() => Promise<T>>): Promise<T[]> {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const gotLock = new Promise<void>((resolve) => (locked = resolve));
    const holder = holderSql.begin(async (tx) => {
      await tx`select id from alert where id = ${alertId} for update`;
      locked();
      await held;
    });
    await gotLock;
    const running: Promise<T>[] = [];
    try {
      for (const action of actions) {
        const before = await lockWaiters();
        running.push(action());
        const deadline = Date.now() + 15000;
        while ((await lockWaiters()) <= before) {
          if (Date.now() > deadline) throw new Error("an action did not queue on the thread's lock");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    } finally {
      release();
      await holder;
    }
    return Promise.all(running);
  }

  const approveOf = async (actor: ReturnType<typeof actorOf>, ref: Awaited<ReturnType<typeof pendingFinal>>) => {
    const shown = await shownOfRow(ref);
    return () => alerting.approveEntry(actor, ref, shown);
  };

  it("an update's approval then a final's: the update is approved and the final closes over it", async () => {
    const { ref } = await approvedThread({}, 0);
    const update = await submitted(await newUpdate(ref.alertId));
    const final = await pendingFinal(ref.alertId);
    const [updateResult, finalResult] = await inOrder(ref.alertId, [await approveOf(actorOf(coordB), update), await approveOf(actorOf(adminC), final)]);
    expect(updateResult).toMatchObject({ ok: true });
    expect(finalResult).toMatchObject({ ok: true });
    expect((await entryRow(update.entryId)).status).toBe("approved");
    expect((await entryRow(update.entryId)).approved_at.getTime()).toBeLessThanOrEqual((await threadRow(ref.alertId)).closed_at.getTime());
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
  });

  it("a final's approval then an update's: the thread is closed and the update is refused ALERT_CLOSED, discarded with the close, never approved", async () => {
    const { ref } = await approvedThread({}, 0);
    const update = await submitted(await newUpdate(ref.alertId));
    const final = await pendingFinal(ref.alertId);
    const [finalResult, updateResult] = await inOrder(ref.alertId, [await approveOf(actorOf(adminC), final), await approveOf(actorOf(coordB), update)]);
    expect(finalResult).toMatchObject({ ok: true });
    expect(updateResult).toEqual({ ok: false, error: "ALERT_CLOSED" });
    const row = await entryRow(update.entryId);
    expect(row.status).toBe("discarded");
    expect(row.approved_at).toBeNull();
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved", closing_entry_id: final.entryId });
  });

  it.each([
    ["one", "two"],
    ["two", "one"],
  ] as const)("two finals, %s approved first: that one closes the thread, the other is refused ALERT_CLOSED and discarded with the close", async (first, second) => {
    const { ref } = await approvedThread();
    const finals = { one: await pendingFinal(ref.alertId), two: await pendingFinal(ref.alertId) };
    const results = await inOrder(ref.alertId, [await approveOf(actorOf(coordB), finals[first]), await approveOf(actorOf(adminC), finals[second])]);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toEqual({ ok: false, error: "ALERT_CLOSED" });
    expect((await entryRow(finals[first].entryId)).status).toBe("approved");
    expect((await entryRow(finals[second].entryId)).status).toBe("discarded");
    expect((await threadRow(ref.alertId)).closing_entry_id).toBe(finals[first].entryId);
    expect((await auditRows()).filter((row) => row.action === "alert.closed" && row.outcome === "ok")).toHaveLength(1);
  });

  describe("a correction's approval and the expire job's close (stood in for by a transaction that locks the thread, as S05.04's job must)", () => {
    const expire = (alertId: string) => async (): Promise<unknown> =>
      owner.begin(async (tx) => {
        await tx`select id from alert where id = ${alertId} for update`;
        const [row] = await tx`select status from alert where id = ${alertId}`;
        if (row.status === "open") await tx`update alert set status = 'closed', closed_reason = 'expired', closed_at = now() where id = ${alertId}`;
      });
    const pendingCorrection = async () => {
      const { ref } = await approvedThread();
      clock = new Date(clock.getTime() + 1000);
      const made = await alerting.correctEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, { entryId: randomUUID(), text: "Corrected wording.", phase: "problem", validUntil: new Date("2026-10-02T15:00:00Z"), validUntilMode: "at" });
      if (!made.ok) throw new Error("correctEntry refused");
      return { ref, correction: await submitted({ alertId: ref.alertId, entryId: made.value.entry.id }) };
    };

    it("the approval first: the target is superseded, then the thread expires", async () => {
      const { ref, correction } = await pendingCorrection();
      const [approval] = await inOrder<unknown>(ref.alertId, [await approveOf(actorOf(coordB), correction), expire(ref.alertId)]);
      expect(approval).toMatchObject({ ok: true });
      expect((await entryRow(ref.entryId)).status).toBe("superseded");
      expect((await entryRow(correction.entryId)).status).toBe("approved");
      expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
    });

    it("the close first: the approval is refused ALERT_CLOSED and nothing changes", async () => {
      const { ref, correction } = await pendingCorrection();
      const [, approval] = await inOrder<unknown>(ref.alertId, [expire(ref.alertId), await approveOf(actorOf(coordB), correction)]);
      expect(approval).toEqual({ ok: false, error: "ALERT_CLOSED" });
      expect((await entryRow(correction.entryId)).status).toBe("pending_approval");
      expect((await entryRow(ref.entryId)).status).toBe("approved");
      expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "expired" });
    });
  });
});

// --- what a resident reads of a closed thread ------------------------------------------------------------------------------------------------

describe("what a resident reads of a thread that closed", () => {
  it("is the closed thread at its address: how it closed, the final message last and every earlier entry, and it is not in the live feed", async () => {
    const { ref, slug } = await approvedThread();
    await approvedUpdate(ref.alertId);
    const final = await pendingFinal(ref.alertId);
    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });
    const residents = createResidentAlerts(app);

    const thread = await residents.readClosed!("en", slug);

    expect(FeedThreadSchema.safeParse(thread).success).toBe(true);
    expect(thread).toMatchObject({ slug, state: "closed", close_reason: "resolved" });
    expect(thread!.entries.map((entry) => entry.kind)).toEqual(["ack", "update", "final"]);
    expect(thread!.entries.at(-1)!.text.body).toBe(FINAL_TEXT);
    expect((await residents.read("en")).threads.map((live) => live.slug)).not.toContain(slug);
    // An open thread, an unknown address and a drill are not found there.
    const open = await approvedThread();
    expect(await residents.readClosed!("en", open.slug)).toBeNull();
    // The slugs the app gates the address on: the closed thread's, not the open one's.
    const slugs = await residents.readClosedSlugs!();
    expect(slugs).toContain(slug);
    expect(slugs).not.toContain(open.slug);
    expect(await residents.readClosed!("en", "zzzzzzzz")).toBeNull();
    const drill = await approvedThread({}, 0, true);
    const drillFinal = await pendingFinal(drill.ref.alertId);
    await alerting.approveEntry(actorOf(coordB), drillFinal, await shownOfRow(drillFinal));
    expect(await residents.readClosed!("en", drill.slug)).toBeNull();
  });

  it("is the same for a thread closed withdrawn, with the withdrawal notice among its entries and the entry it withdrew marked", async () => {
    const { ref, slug } = await approvedThread();
    const made = await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, { entryId: randomUUID(), reason: "other", text: "Sent for the wrong building." });
    if (!made.ok) throw new Error("withdrawEntry refused");
    const withdrawal = await submitted({ alertId: ref.alertId, entryId: made.value.entry.id });
    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });

    const thread = await createResidentAlerts(app).readClosed!("en", slug);

    expect(thread).toMatchObject({ state: "closed", close_reason: "withdrawn" });
    expect(thread!.entries.map((entry) => [entry.kind, entry.supersedes_id])).toEqual([
      ["ack", undefined],
      ["withdrawal", ref.entryId],
    ]);
  });
});

// --- the sender after a close (S06.03) ---------------------------------------------------------------------------------------------------------
// The real approval, the real `cancelQueued` and the real sender (the provider and the numbers are fakes): the texts a close stops never go, and the text that
// closes the thread still does, whether texting is paused or not.

const bodyOfEntry = async (entryId: string) => (await owner<{ body: string }[]>`select body from delivery where entry_id = ${entryId} limit 1`)[0].body;

describe("a close and the sender (S06.03)", () => {
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

  it("a final approved over an update whose texts are queued, while texts are paused: the update's rows are cancelled, the final's stay queued through the pause and are sent after the resume though the thread is closed", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId, 3);
    const final = await pendingFinal(ref.alertId);
    await world.setPause(true);
    recipientIds = [randomUUID(), randomUUID()];

    expect(await alerting.approveEntry(actorOf(coordB), final, await shownOfRow(final))).toMatchObject({ ok: true });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closing_entry_id: final.entryId });
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 3 });
    expect(await stateCounts(final.entryId)).toEqual({ queued: 2 });

    // Paused: the sender claims nothing and sends nothing.
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(0);
    expect(await stateCounts(final.entryId)).toEqual({ queued: 2 });

    // Resumed: the final goes to its two recipients although its thread is closed, and not one of the update's texts goes.
    await world.setPause(false);
    const report = await world.dispatcher().run();
    expect(report).toMatchObject({ submitted: 2 });
    expect(await stateCounts(final.entryId)).toEqual({ submitted: 2 });
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 3 });
    const finalBody = await bodyOfEntry(final.entryId);
    expect(world.provider.calls.map((call) => call.body)).toEqual([finalBody, finalBody]);
  });

  it("a withdrawal that closes its thread: its rows are created and sent after the close, and the withdrawn entry's queued rows are cancelled and never sent", async () => {
    const { ref } = await approvedThread({}, 2);
    clock = new Date(clock.getTime() + 1000);
    const made = await alerting.withdrawEntry(actorOf(authorA), { alertId: ref.alertId, targetId: ref.entryId }, { entryId: randomUUID(), reason: "duplicate", text: "This alert was withdrawn because it was a duplicate." });
    if (!made.ok) throw new Error(`withdrawEntry refused: ${made.error}`);
    const withdrawal = await submitted({ alertId: ref.alertId, entryId: made.value.entry.id });
    recipientIds = [randomUUID(), randomUUID()];

    expect(await alerting.approveEntry(actorOf(coordB), withdrawal, await shownOfRow(withdrawal))).toMatchObject({ ok: true });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "withdrawn", closing_entry_id: withdrawal.entryId });
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 2 });

    const report = await world.dispatcher().run();
    expect(report).toMatchObject({ submitted: 2 });
    expect(await stateCounts(withdrawal.entryId)).toEqual({ submitted: 2 });
    expect(await stateCounts(ref.entryId)).toEqual({ cancelled: 2 });
    const body = await bodyOfEntry(withdrawal.entryId);
    expect(world.provider.calls.map((call) => call.body)).toEqual([body, body]);
  });

  it("a final's approval that commits between the sender's claim and its hand-off: the update's row is cancelled, the hand-off commits nothing and the provider is not called for it", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId, 1);
    const final = await pendingFinal(ref.alertId);
    recipientIds = [randomUUID()];
    const shown = await shownOfRow(final);
    let approved: unknown;
    const store = {
      ...drizzleDispatchStore,
      async claim(...args: Parameters<typeof drizzleDispatchStore.claim>) {
        const result = await drizzleDispatchStore.claim(...args);
        // The row is claimed and committed; the close now commits in full (on its own connections) before the hand-off asks for the row.
        if (result.kind === "claimed" && approved === undefined) approved = await alerting.approveEntry(actorOf(coordB), final, shown);
        return result;
      },
    };

    await world.dispatcher({ store }).run();

    expect(approved).toMatchObject({ ok: true });
    expect(await stateCounts(update.entryId)).toEqual({ cancelled: 1 });
    // Only the final's own text went, after the close.
    expect(world.provider.calls.map((call) => call.body)).toEqual([await bodyOfEntry(final.entryId)]);
  });

  it("a final's approval that starts while a hand-off holds the update's row: the approval waits, finds the text handed off, leaves it, and the final still closes the thread and goes out", async () => {
    const { ref } = await approvedThread();
    const update = await approvedUpdate(ref.alertId, 1);
    const final = await pendingFinal(ref.alertId);
    recipientIds = [randomUUID()];
    const shown = await shownOfRow(final);
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
    const approving = alerting.approveEntry(actorOf(coordB), final, shown);
    await world.untilSomeoneWaitsForALock();
    proceed.resolve();
    const [, approved] = await Promise.all([run, approving]);

    expect(approved).toMatchObject({ ok: true });
    // The update's text was already in flight, so it went; the close stopped nothing of it.
    expect(await stateCounts(update.entryId)).toEqual({ submitted: 1 });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed" });
    // The final's own row is sent by a run, though the thread is closed.
    await world.dispatcher().run();
    expect(await stateCounts(final.entryId)).toEqual({ submitted: 1 });
    expect(world.provider.calls.map((call) => call.body)).toEqual([await bodyOfEntry(update.entryId), await bodyOfEntry(final.entryId)]);
  });
});
