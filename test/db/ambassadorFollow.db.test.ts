// An ambassador follows their post and marks incidents resolved (S08.04, A-03), against a real database. The real submitter, preparer and renderer submit the
// entries, the real approval approves them; the ambassador's reads are the module's own (`createAmbassadorHome(...).status`, `.resolvable`).
//
//  - the status of their own post, in every state A-03 words: live and not yet verified, waiting for the Hub, approved, returned with the note, withdrawn, corrected;
//    never another person's post, a drill's, or one outside their current assignments; once approved, the progress of its texts;
//  - correcting or withdrawing: only their own entry that is pending and that residents already read (the policy's `own_pending_entry`, then E05's rules), through
//    the use cases and through the follow-up request (`followAndSubmit`), never anyone else's entry and never as another role;
//  - "Mark resolved": a final submitted for a second person's approval, the thread open until then, closed by that approval and by nothing else.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { AmbassadorFollowRequest } from "../../src/contracts/ambassadorFollow";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import type { Translated } from "../../src/contracts/translated";
import { followAndSubmit, followBuildings } from "../../src/app/staff/ambassador/status/followRequest";
import { statusScreen } from "../../src/app/staff/ambassador/status/view";
import {
  FROZEN_LANGS,
  createAlerting,
  createAmbassadorHome,
  createEntryPreparer,
  createSubmitter,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type AmbassadorPostInput,
  type AmbassadorScope,
  type EntryContent,
  type EntryRef,
} from "../../src/modules/alerting";
import { can } from "../../src/modules/identity";
import { sendingProgress } from "../../src/modules/messaging";
import { type AlertRecipient, type RecipientEntry, type RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const RSN = "4154471";
const OTHER_RSN = "4154472";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];
const BASE = "https://cvh.example";
const sha = (tag: string) => createHash("sha256").update(tag, "utf8").digest("hex");
const WITHDRAWN_TEXT = "This report was withdrawn. Contact the Hub for current information.";

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
let appSql: postgres.Sql;
let app: Db;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
const accounts: Account[] = [];
let ambassador: Account;
let neighbour: Account;
let coordinator: Account;
let admin: Account;
let director: Account;
let clock = new Date();

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`fw_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}

const actorOf = (who: Account): AlertActor => ({ staffId: who.id, aal: who.role === "ambassador" ? "aal1" : "aal2" });
const assign = (who: Account, rsn: string) => owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${who.id}, ${rsn}, true, ${admin.id}) on conflict do nothing`;
const scopeOf = (who: Account, rsns: string[] = [RSN]): AmbassadorScope => ({ staffId: who.id, assignedRsns: rsns, neighbourhoodOf: new Map(rsns.map((rsn) => [rsn, "TP"])) });

/** Who the approval captured texts for. A test that wants texts made names the people; otherwise nobody. */
let people: AlertRecipient[] = [];
const captured: RecipientEntry[] = [];
const port: RecipientsPort = {
  count: async () => ({ open: false, total: people.length, byLanguage: people.length === 0 ? {} : { en: people.length } }),
  capture: async (entry) => {
    captured.push(entry);
    return people;
  },
};

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
    await tx`delete from ambassador_assignment where rsn in (${RSN}, ${OTHER_RSN})`;
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
  appSql = postgres(url.href, { max: 10, onnotice: () => {} });
  app = createDb(url.href);
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  for (const [rsn, nb] of [[RSN, "TP"], [OTHER_RSN, "TP"]]) {
    await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
                values (${rsn}, ${nb}, ${`${rsn} Follow Dr`}, 43.7, -79.34, now()) on conflict do nothing`;
    for (const [index, label] of FLOORS.entries()) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${label}, ${index}, true) on conflict do nothing`;
    }
  }
  admin = await account("admin");
  ambassador = await account("ambassador");
  neighbour = await account("ambassador");
  coordinator = await account("coordinator");
  director = await account("director");
  alerting = createAlerting({ db: app, now: () => clock, recipients: port, discardWithdrawalText: () => WITHDRAWN_TEXT, pricePerSegmentCents: () => 1 });
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
  clock = new Date();
  captured.length = 0;
  people = [];
  await clear();
  await assign(ambassador, RSN);
  await assign(neighbour, RSN);
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const entryCount = async () => (await owner`select count(*)::int as n from alert_entry`)[0].n as number;
const refusals = () => owner<{ action: string; outcome: string; meta: Record<string, unknown> }[]>`select action, outcome, meta from audit_event where subject_type in ('alert', 'alert_entry') and outcome = 'refused' order by id`;

const postInput = (over: Partial<AmbassadorPostInput> = {}): AmbassadorPostInput => ({
  into: null,
  alertId: randomUUID(),
  entryId: randomUUID(),
  place: { rsn: RSN, floors: null },
  types: ["power"],
  phase: "problem",
  validUntil: new Date(clock.getTime() + 12 * 3_600_000),
  validUntilMode: "at",
  text: "The power is out on every floor. Building staff have been told.",
  ...over,
});

function submitter() {
  const real = createEntryPreparer({
    translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) },
    freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }),
  });
  return createSubmitter({ lifecycle: alerting, preparer: real, ops: { record: async () => undefined } });
}

async function post(by: Account = ambassador, over: Partial<AmbassadorPostInput> = {}): Promise<EntryRef> {
  const made = await alerting.postFromAmbassador(actorOf(by), postInput(over));
  if (!made.ok) throw new Error(`postFromAmbassador refused: ${made.error}`);
  return { alertId: made.value.thread.id, entryId: made.value.entry.id };
}

async function submit(by: Account, ref: EntryRef, key: string = randomUUID()) {
  const report = await submitter().submit(actorOf(by), ref, key);
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return report;
}

/** A D-1 post (power): on the web at its submit, "Not yet verified". */
async function livePost(over: Partial<AmbassadorPostInput> = {}, by: Account = ambassador): Promise<EntryRef> {
  const ref = await post(by, over);
  await submit(by, ref);
  return ref;
}

const approve = async (ref: EntryRef, by: Account = coordinator, recipients?: RecipientCounts) => {
  const row = await entryRow(ref.entryId);
  return alerting.approveEntry(actorOf(by), ref, { version: row.version, contentHash: row.content_hash, ...(recipients ? { recipients } : {}) });
};

/** An approved alert by the Hub about the building (or buildings): the thread an ambassador resolves. */
async function hubThread(rsns: string[] = [RSN], types: string[] = ["power"], isDrill = false): Promise<EntryRef> {
  const audience: Audience = { scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: [...types].sort() };
  const content: EntryContent = { text: "The power is out.", types, audience, phase: "problem", validUntil: new Date(clock.getTime() + 24 * 3_600_000), validUntilMode: "at" };
  const [author, approver] = isDrill ? [admin, coordinator] : [coordinator, admin];
  const created = await alerting.createAlert(actorOf(author), { kind: "ack", isDrill, reportedAt: new Date(clock.getTime() - 600_000), content });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const frozen = await seams.freeze(actorOf(author), ref, {
    contentHash: sha("hub"),
    smsBodies: { en: { body: "en hub", encoding: "gsm7", segments: 1 } },
    translations: [{ lang: "ur", body: "ur hub", machine: true, model: "m1", status: "translated", sourceHash: sha("source") }],
  });
  if (!frozen.ok) throw new Error(`freeze refused: ${frozen.error}`);
  const approved = await alerting.approveEntry(actorOf(approver), ref, { version: 1, contentHash: sha("hub") });
  if (!approved.ok) throw new Error(`approve refused: ${approved.error}`);
  return ref;
}

const home = () => createAmbassadorHome(app);
const statusOf = (entryId: string, who: Account = ambassador, rsns: string[] = [RSN]) => home().status(scopeOf(who, rsns), entryId);

const correctInput = (over: Partial<Parameters<AlertLifecycle["correctEntry"]>[2]> = {}) => ({
  entryId: randomUUID(),
  text: "Power is out on floors 1 to 3 only.",
  phase: "problem" as const,
  validUntil: new Date(clock.getTime() + 6 * 3_600_000),
  validUntilMode: "at" as const,
  ...over,
});
const withdrawInput = (over: Partial<Parameters<AlertLifecycle["withdrawEntry"]>[2]> = {}) => ({ entryId: randomUUID(), reason: "wrong_place", text: "This alert named the wrong place. It has been withdrawn.", ...over });

// --- where the post stands (A-03) ---------------------------------------------------------------------------------------------------

describe("the status of an ambassador's own post (A-03)", () => {
  it("is 'Live. Not yet verified' for a D-1 post residents already read, with what can be done about it", async () => {
    const ref = await livePost();
    const status = await statusOf(ref.entryId);
    expect(status).toMatchObject({ entryId: ref.entryId, alertId: ref.alertId, state: "live", note: null, threadOpen: true, buildings: [{ rsn: RSN, floors: null }], can: { replace: true, resolve: true } });
    expect(statusScreen({ status: status!, addresses: new Map([[RSN, `${RSN} Follow Dr`]]), floorLabels: new Map(), counts: null, ids: { correct: randomUUID(), withdraw: randomUUID(), resolve: randomUUID() } }).state.title).toBe("Live. Not yet verified");
  });

  it("is 'Waiting for the Hub' for a post nobody reads yet (fire), which can neither be corrected nor withdrawn, only resolved with the alert", async () => {
    const ref = await livePost({ types: ["fire"] });
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "waiting", can: { replace: false, resolve: false } });
  });

  it("is 'Approved' once approved, and 'Verified' (shown as approved) for one that was live before", async () => {
    const live = await livePost();
    expect((await approve(live)).ok).toBe(true);
    expect(await statusOf(live.entryId)).toMatchObject({ state: "verified", can: { replace: false } });
    const fire = await livePost({ types: ["fire"] });
    expect((await approve(fire)).ok).toBe(true);
    expect(await statusOf(fire.entryId)).toMatchObject({ state: "approved" });
  });

  it("is 'Returned to you' with the approver's note", async () => {
    const ref = await livePost({ types: ["fire"] });
    const row = await entryRow(ref.entryId);
    const returned = await alerting.returnEntry(actorOf(coordinator), ref, "return", { note: "Add which floors.", shown: { version: row.version, contentHash: row.content_hash } });
    expect(returned.ok).toBe(true);
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "returned", note: "Add which floors.", can: { replace: false } });
  });

  it("shows only their own post: another ambassador's, a Hub person's, a drill's and one that does not exist read as nothing", async () => {
    const mine = await livePost();
    expect(await statusOf(mine.entryId, neighbour)).toBeNull();
    expect(await statusOf(randomUUID())).toBeNull();
    expect(await statusOf("not-an-id")).toBeNull();
    const hub = await hubThread();
    expect(await statusOf(hub.entryId)).toBeNull();
    // A Hub person has no assignments, so nothing is read for them whatever they wrote.
    expect(await statusOf(hub.entryId, coordinator, [])).toBeNull();
    // A practice post in a drill is the Hub's to see, never on the status page.
    const drill = await hubThread([RSN], ["power"], true);
    const practice = await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: drill.alertId }));
    expect(practice.ok).toBe(true);
    if (practice.ok) {
      await submit(ambassador, { alertId: drill.alertId, entryId: practice.value.entry.id });
      expect(await statusOf(practice.value.entry.id)).toBeNull();
    }
  });

  it("reads the person's current assignments: a post for a building no longer theirs is gone from the status, and nothing is read for a person with none", async () => {
    const ref = await livePost();
    expect(await statusOf(ref.entryId, ambassador, [])).toBeNull();
    expect(await statusOf(ref.entryId, ambassador, [OTHER_RSN])).toBeNull();
    await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    const scope = await owner<{ rsn: string }[]>`select rsn from ambassador_assignment where staff_id = ${ambassador.id}`;
    expect(await statusOf(ref.entryId, ambassador, scope.map((row) => row.rsn))).toBeNull();
  });

  it("tells what residents read instead after an approved correction (corrected), after an approved withdrawal (withdrawn), and what waits for the Hub meanwhile", async () => {
    const ref = await livePost();
    const correction = await alerting.correctEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, correctInput({ text: "Power is out on floors 1 to 3." }));
    if (!correction.ok) throw new Error(correction.error);
    const correctionRef = { alertId: ref.alertId, entryId: correction.value.entry.id };
    await submit(ambassador, correctionRef);
    // Waiting: the original still stands, with a correction waiting; it cannot be corrected again meanwhile.
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "live", waitingReplacement: { entryId: correctionRef.entryId, kind: "correction" }, can: { replace: false } });
    expect((await approve(correctionRef)).ok).toBe(true);
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "corrected", replacedWith: { kind: "correction", text: "Power is out on floors 1 to 3." }, waitingReplacement: null, can: { replace: false } });
    // The correction is itself a post of theirs, now approved.
    expect(await statusOf(correctionRef.entryId)).toMatchObject({ state: "verified" });
  });
});

// --- correcting and withdrawing their own pending entry (E05's rules) ---------------------------------------------------------------------------

describe("an ambassador corrects their own pending post", () => {
  it("makes a draft correction of it that is web-published at its submit, replaces the original only when a second person approves it, and keeps the post's building and types", async () => {
    const ref = await livePost();
    const made = await alerting.correctEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, correctInput());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const correctionRef = { alertId: ref.alertId, entryId: made.value.entry.id };
    expect(made.value.entry).toMatchObject({ kind: "correction", status: "draft", authorId: ambassador.id, supersedesId: ref.entryId });
    expect(made.value.entry.content.types).toEqual(["power"]);
    expect(made.value.entry.content.audience).toMatchObject({ scope: "buildings", buildings: [{ rsn: RSN, floors: null }] });
    // The same press again changes nothing.
    const again = await alerting.correctEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, correctInput({ entryId: made.value.entry.id }));
    expect(again.ok && again.value.entry.id).toBe(made.value.entry.id);
    const before = await entryCount();
    await submit(ambassador, correctionRef);
    // Residents read the correction at once, "Not yet verified"; the original is not replaced by a submit.
    expect(await entryRow(correctionRef.entryId)).toMatchObject({ status: "pending_approval", attributed_rsn: RSN });
    expect((await entryRow(correctionRef.entryId)).web_published_at).not.toBeNull();
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect(await entryCount()).toBe(before);
    // The author cannot approve their own; a second person's approval replaces the original.
    expect((await approve(correctionRef, ambassador)).ok).toBe(false);
    expect((await approve(correctionRef)).ok).toBe(true);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "superseded" });
    expect(await entryRow(correctionRef.entryId)).toMatchObject({ status: "approved" });
  });

  it("cannot correct or withdraw another ambassador's entry, even in a building they are both assigned to: out of scope, nothing made, the refusal audited", async () => {
    const theirs = await livePost({}, neighbour);
    const before = await entryCount();
    const correct = await alerting.correctEntry(actorOf(ambassador), { alertId: theirs.alertId, targetId: theirs.entryId }, correctInput());
    expect(correct).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    const withdraw = await alerting.withdrawEntry(actorOf(ambassador), { alertId: theirs.alertId, targetId: theirs.entryId }, withdrawInput());
    expect(withdraw).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await entryCount()).toBe(before);
    expect(await entryRow(theirs.entryId)).toMatchObject({ status: "pending_approval" });
    const refused = await refusals();
    expect(refused.map((row) => row.action)).toEqual(["entry.created", "entry.created"]);
    expect(refused.every((row) => row.meta.reason === "out_of_scope")).toBe(true);
  });

  it("cannot correct or withdraw an entry of the Hub's, nor their own that is already approved, nor one that is not pending approval or not in this alert", async () => {
    const hub = await hubThread();
    const into = await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: hub.alertId }));
    if (!into.ok) throw new Error(into.error);
    const mineRef = { alertId: hub.alertId, entryId: into.value.entry.id };
    // The Hub's approved entry.
    for (const target of [hub.entryId, mineRef.entryId]) {
      expect(await alerting.correctEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: target }, correctInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
      expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: target }, withdrawInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    }
    // Their own, approved: no longer pending.
    await submit(ambassador, mineRef);
    expect((await approve(mineRef)).ok).toBe(true);
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: mineRef.entryId }, correctInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    // An entry that is not in this alert, an id that is not one.
    const other = await livePost({}, neighbour);
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: other.entryId }, correctInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: randomUUID() }, withdrawInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: hub.alertId, targetId: "nope" }, withdrawInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
  });

  it("cannot correct or withdraw their own post that residents do not read yet (E05: nothing to correct), only after it is approved by the Hub", async () => {
    const waiting = await livePost({ types: ["fire"] });
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: waiting.alertId, targetId: waiting.entryId }, correctInput())).toMatchObject({ ok: false, error: "TARGET_NOT_PUBLISHED" });
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: waiting.alertId, targetId: waiting.entryId }, withdrawInput())).toMatchObject({ ok: false, error: "TARGET_NOT_PUBLISHED" });
  });

  it("cannot, once the post is corrected or withdrawn already, or after their assignment to the building is removed, or when the alert is closed", async () => {
    const replaced = await livePost();
    const first = await alerting.correctEntry(actorOf(ambassador), { alertId: replaced.alertId, targetId: replaced.entryId }, correctInput());
    if (!first.ok) throw new Error(first.error);
    await submit(ambassador, { alertId: replaced.alertId, entryId: first.value.entry.id });
    expect((await approve({ alertId: replaced.alertId, entryId: first.value.entry.id })).ok).toBe(true);
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: replaced.alertId, targetId: replaced.entryId }, correctInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    // The correction itself, still pending? approved above; a fresh post, then the assignment goes.
    const gone = await livePost();
    await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: gone.alertId, targetId: gone.entryId }, correctInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: gone.alertId, targetId: gone.entryId }, withdrawInput())).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    await assign(ambassador, RSN);
    // A closed alert offers nothing.
    await owner`update alert set status = 'closed', closed_at = now(), closed_reason = 'expired' where id = ${gone.alertId}`;
    expect(await alerting.correctEntry(actorOf(ambassador), { alertId: gone.alertId, targetId: gone.entryId }, correctInput())).toMatchObject({ ok: false, error: "ALERT_CLOSED" });
  });

  it("is refused as a Director never may, and a Coordinator still corrects any valid entry (E05, unchanged)", async () => {
    const ref = await livePost();
    expect(await alerting.correctEntry(actorOf(director), { alertId: ref.alertId, targetId: ref.entryId }, correctInput())).toMatchObject({ ok: false, error: "NOT_ALLOWED" });
    expect((await alerting.correctEntry(actorOf(coordinator), { alertId: ref.alertId, targetId: ref.entryId }, correctInput())).ok).toBe(true);
  });
});

describe("an ambassador withdraws their own pending post", () => {
  it("makes a draft withdrawal that waits for a second person: residents keep reading the post until it is approved, then the post is withdrawn and the alert closes", async () => {
    const ref = await livePost();
    const made = await alerting.withdrawEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput());
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const withdrawalRef = { alertId: ref.alertId, entryId: made.value.entry.id };
    expect(made.value.entry).toMatchObject({ kind: "withdrawal", status: "draft", supersedesId: ref.entryId, withdrawalReason: "wrong_place" });
    await submit(ambassador, withdrawalRef);
    // Nothing is withdrawn by the submit: a withdrawal is not a D-1 entry, so it is not on the web, and the post still stands.
    expect((await entryRow(withdrawalRef.entryId)).web_published_at).toBeNull();
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect((await entryRow(ref.entryId)).web_published_at).not.toBeNull();
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open" });
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "live", waitingReplacement: { kind: "withdrawal" }, can: { replace: false } });
    // They cannot approve their own; the Hub's approval withdraws the post and, with nothing left that residents read, closes the alert.
    expect((await approve(withdrawalRef, ambassador)).ok).toBe(false);
    expect((await approve(withdrawalRef)).ok).toBe(true);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "superseded" });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "closed", closed_reason: "withdrawn" });
    expect(await statusOf(ref.entryId)).toMatchObject({ state: "withdrawn", replacedWith: { kind: "withdrawal" }, threadOpen: false, can: { replace: false, resolve: false } });
  });

  it("needs a reason of the catalog, and words of their own for Other", async () => {
    const ref = await livePost();
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason: "boring" }))).toMatchObject({ ok: false, error: "WITHDRAWAL_REASON_INVALID" });
    expect(await alerting.withdrawEntry(actorOf(ambassador), { alertId: ref.alertId, targetId: ref.entryId }, withdrawInput({ reason: "other", text: "" }))).toMatchObject({ ok: false, error: "TEXT_EMPTY" });
  });
});

// --- the follow-up request, as the route runs it --------------------------------------------------------------------------------------

describe("the follow-up request (POST /api/staff/ambassador/follow)", () => {
  const real = () => ({ alerting: () => alerting, submitter, now: () => clock, afterSubmit: () => undefined });
  const body = <T extends AmbassadorFollowRequest["action"]>(action: T, over: Record<string, unknown>) => ({ v: 1, action, alert_id: randomUUID(), entry_id: randomUUID(), key: randomUUID(), ...over }) as unknown as AmbassadorFollowRequest;
  const sessionOf = (who: Account) => ({ staffId: who.id, aal: actorOf(who).aal, role: who.role });

  it("corrects, withdraws and resolves through the real submit, each ending pending approval and replacing or closing nothing", async () => {
    const ref = await livePost();
    const thread = await threadRow(ref.alertId);
    const corrected = await followAndSubmit(real(), sessionOf(ambassador), body("correct", { alert_id: ref.alertId, target: ref.entryId, phase: "in_progress", valid: { mode: "resolved" }, text: "Power is back on floors 4 to 5." }));
    expect(corrected).toMatchObject({ state: "committed", entry_state: { entry: { kind: "correction", status: "pending_approval", web_published: true } } });
    const withdrawn = await followAndSubmit(real(), sessionOf(ambassador), body("withdraw", { alert_id: ref.alertId, target: ref.entryId, reason: "duplicate", text: "" }));
    expect(withdrawn).toMatchObject({ state: "committed", entry_state: { entry: { kind: "withdrawal", status: "pending_approval", web_published: false } } });
    const resolved = await followAndSubmit(real(), sessionOf(ambassador), body("resolve", { alert_id: ref.alertId, text: "The power is back on every floor." }));
    expect(resolved).toMatchObject({ state: "committed", entry_state: { entry: { kind: "final", status: "pending_approval", web_published: false } } });
    // Nothing was replaced or closed by any of the three.
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open", closed_at: thread.closed_at });
    // The withdrawal's words are the catalog's for the reason (English).
    const row = (await owner`select original_text from alert_entry where kind = 'withdrawal'`)[0];
    expect(row.original_text).toBe("This alert repeated another alert. It has been withdrawn.");
  });

  it("answers the same request sent twice with one entry and one pending version", async () => {
    const ref = await livePost();
    const request = body("correct", { alert_id: ref.alertId, target: ref.entryId, phase: "problem", valid: { mode: "resolved" }, text: "Power is out on floors 1 to 3." });
    const first = await followAndSubmit(real(), sessionOf(ambassador), request);
    const second = await followAndSubmit(real(), sessionOf(ambassador), request);
    expect(first.state).toBe("committed");
    expect(second.state).toBe("committed");
    expect((await owner`select count(*)::int as n from alert_entry where kind = 'correction'`)[0].n).toBe(1);
  });

  it("refuses another ambassador's entry as out of scope after the guard has let a person assigned to the same building through", async () => {
    const theirs = await livePost({}, neighbour);
    const request = body("correct", { alert_id: theirs.alertId, target: theirs.entryId, phase: "problem", valid: { mode: "resolved" }, text: "Changed by someone else." });
    // The guard's facts are the entry's building, read from the database: assigned, so the guard allows; the use case refuses.
    const targets = await followBuildings(alerting, request);
    expect(targets).toEqual([RSN]);
    expect(can("ambassador", "alert.author", { assignments: [{ rsn: RSN, floorIds: null }], targets })).toBe(true);
    const before = await entryCount();
    expect(await followAndSubmit(real(), sessionOf(ambassador), request)).toMatchObject({ state: "refused", outcome: "OUT_OF_SCOPE", entry_state: null });
    expect(await entryCount()).toBe(before);
  });

  it("names the buildings of what the request is about, from the database: another building's entry or alert fails the guard, a missing or neighbourhood-wide one names none", async () => {
    const elsewhere = await livePost({ place: { rsn: OTHER_RSN, floors: null } }, await (async () => { const stranger = await account("ambassador"); await assign(stranger, OTHER_RSN); return stranger; })());
    const toCorrect = body("correct", { alert_id: elsewhere.alertId, target: elsewhere.entryId, phase: "problem", valid: { mode: "resolved" }, text: "x" });
    const targets = await followBuildings(alerting, toCorrect);
    expect(targets).toEqual([OTHER_RSN]);
    expect(can("ambassador", "alert.author", { assignments: [{ rsn: RSN, floorIds: null }], targets })).toBe(false);
    expect(await followBuildings(alerting, body("resolve", { alert_id: elsewhere.alertId, text: "x" }))).toEqual([OTHER_RSN]);
    expect(await followBuildings(alerting, body("resolve", { alert_id: randomUUID(), text: "x" }))).toEqual([]);
    expect(await followBuildings(alerting, body("withdraw", { alert_id: elsewhere.alertId, target: randomUUID(), reason: "duplicate", text: "" }))).toEqual([]);
    expect(can("ambassador", "alert.author", { assignments: [{ rsn: RSN, floorIds: null }], targets: [] })).toBe(false);
  });

  it("is for an Ambassador only: a Coordinator, an Admin or a Director who sends it changes nothing", async () => {
    const ref = await livePost();
    const before = await entryCount();
    for (const who of [coordinator, admin, director]) {
      for (const request of [
        body("correct", { alert_id: ref.alertId, target: ref.entryId, phase: "problem", valid: { mode: "resolved" }, text: "x" }),
        body("withdraw", { alert_id: ref.alertId, target: ref.entryId, reason: "duplicate", text: "" }),
        body("resolve", { alert_id: ref.alertId, text: "x" }),
      ]) {
        expect(await followAndSubmit(real(), sessionOf(who), request)).toMatchObject({ state: "refused", outcome: "NOT_ALLOWED" });
      }
    }
    expect(await entryCount()).toBe(before);
  });
});

// --- "Mark resolved" ---------------------------------------------------------------------------------------------------------------------

describe("an ambassador marks an alert about their building resolved", () => {
  it("submits a final for a second person's approval and never closes the thread on its own; the approval closes it as resolved", async () => {
    const hub = await hubThread();
    const resolvable = await home().resolvable(scopeOf(ambassador), hub.alertId);
    expect(resolvable).toEqual({ headline: "The power is out.", waitingFinal: false });
    const made = await alerting.startFinal(actorOf(ambassador), { alertId: hub.alertId }, { entryId: randomUUID(), text: "The power is back on every floor." });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const finalRef = { alertId: hub.alertId, entryId: made.value.entry.id };
    expect(made.value.entry).toMatchObject({ kind: "final", status: "draft", authorId: ambassador.id });
    await submit(ambassador, finalRef);
    expect(await entryRow(finalRef.entryId)).toMatchObject({ status: "pending_approval", kind: "final", attributed_rsn: RSN });
    expect((await entryRow(finalRef.entryId)).web_published_at).toBeNull();
    // Nothing closed it: the thread is open, and only a Coordinator or an Admin who did not write it can approve.
    expect(await threadRow(hub.alertId)).toMatchObject({ status: "open", closed_at: null, closed_reason: null });
    expect((await approve(finalRef, ambassador)).ok).toBe(false);
    expect(await threadRow(hub.alertId)).toMatchObject({ status: "open" });
    expect(await home().resolvable(scopeOf(ambassador), hub.alertId)).toEqual({ headline: "The power is out.", waitingFinal: true });
    expect((await approve(finalRef)).ok).toBe(true);
    expect(await threadRow(hub.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved" });
    expect(await entryRow(finalRef.entryId)).toMatchObject({ status: "approved" });
    expect(await home().resolvable(scopeOf(ambassador), hub.alertId)).toBeNull();
  });

  it("writes the final of an alert someone else started too, and appears as the building's ambassador", async () => {
    const live = await livePost({}, neighbour);
    expect(await home().resolvable(scopeOf(ambassador), live.alertId)).toMatchObject({ waitingFinal: false });
    const made = await alerting.startFinal(actorOf(ambassador), { alertId: live.alertId }, { entryId: randomUUID(), text: "Fixed." });
    expect(made.ok).toBe(true);
  });

  it("is refused for an alert about a building they are not assigned to, a neighbourhood-wide one, one about more than one building, a closed one and one with nothing residents read", async () => {
    const elsewhere = await hubThread([OTHER_RSN]);
    expect(await alerting.startFinal(actorOf(ambassador), { alertId: elsewhere.alertId }, { entryId: randomUUID(), text: "Fixed." })).toMatchObject({ ok: false, error: "OUT_OF_SCOPE" });
    expect(await home().resolvable(scopeOf(ambassador), elsewhere.alertId)).toBeNull();

    // Two buildings, both theirs: the final is attributed to one building, so the submit refuses it.
    await assign(ambassador, OTHER_RSN);
    const both = await hubThread([RSN, OTHER_RSN]);
    expect(await home().resolvable(scopeOf(ambassador, [RSN, OTHER_RSN]), both.alertId)).toBeNull();
    const made = await alerting.startFinal(actorOf(ambassador), { alertId: both.alertId }, { entryId: randomUUID(), text: "Fixed." });
    expect(made.ok).toBe(true);
    if (made.ok) {
      const report = await submitter().submit(actorOf(ambassador), { alertId: both.alertId, entryId: made.value.entry.id }, randomUUID());
      expect(report).toMatchObject({ state: "refused", refusal: "ONE_BUILDING_ONLY" });
    }

    // A thread of a neighbourhood-wide type (heat) is the Hub's.
    const audience: Audience = { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["heat"] };
    const heat = await alerting.createAlert(actorOf(coordinator), {
      kind: "ack",
      isDrill: false,
      reportedAt: new Date(clock.getTime() - 60_000),
      content: { text: "Heat warning.", types: ["heat"], audience, phase: "problem", validUntil: new Date(clock.getTime() + 6 * 3_600_000), validUntilMode: "at" },
    });
    if (!heat.ok) throw new Error(heat.error);
    expect(await alerting.startFinal(actorOf(ambassador), { alertId: heat.value.thread.id }, { entryId: randomUUID(), text: "Over." })).toMatchObject({ ok: false });
    expect(await home().resolvable(scopeOf(ambassador), heat.value.thread.id)).toBeNull();

    // Nothing residents read yet.
    const unpublished = await alerting.createAlert(actorOf(coordinator), {
      kind: "ack",
      isDrill: false,
      reportedAt: new Date(clock.getTime() - 60_000),
      content: { text: "Elevator out.", types: ["elevator"], audience: { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: ["elevator"] }, phase: "problem", validUntil: new Date(clock.getTime() + 6 * 3_600_000), validUntilMode: "at" },
    });
    if (!unpublished.ok) throw new Error(unpublished.error);
    expect(await alerting.startFinal(actorOf(ambassador), { alertId: unpublished.value.thread.id }, { entryId: randomUUID(), text: "Over." })).toMatchObject({ ok: false, error: "NO_PUBLISHED_ENTRY" });

    // A closed one.
    const closing = await hubThread();
    await owner`update alert set status = 'closed', closed_at = now(), closed_reason = 'expired' where id = ${closing.alertId}`;
    expect(await alerting.startFinal(actorOf(ambassador), { alertId: closing.alertId }, { entryId: randomUUID(), text: "Over." })).toMatchObject({ ok: false, error: "ALERT_CLOSED" });
    expect(await home().resolvable(scopeOf(ambassador), closing.alertId)).toBeNull();
  });

  it("is not offered for a drill, and the open alerts on the home say which are theirs to resolve", async () => {
    const drill = await hubThread([RSN], ["power"], true);
    expect(await home().resolvable(scopeOf(ambassador), drill.alertId)).toBeNull();
    const single = await hubThread();
    const view = await home().read(scopeOf(ambassador));
    expect(view.alerts.find((alert) => alert.alertId === single.alertId)).toMatchObject({ canResolve: true });
  });
});

// --- the texts' progress once approved -----------------------------------------------------------------------------------------------

describe("the progress of an approved post's texts", () => {
  it("counts the texts the approval queued, by what became of them, for the ambassador's own post only", async () => {
    const ref = await livePost({ types: ["fire"] });
    people = [
      { kind: "subscriber", id: randomUUID(), lang: "en" },
      { kind: "subscriber", id: randomUUID(), lang: "en" },
      { kind: "subscriber", id: randomUUID(), lang: "en" },
    ] as AlertRecipient[];
    const approved = await approve(ref, coordinator, { total: 3, byLanguage: { en: 3 } });
    expect(approved.ok).toBe(true);
    const progress = await sendingProgress.forEntry(app, ref.entryId);
    expect(progress.total).toMatchObject({ waiting: 3, inFlight: 0, delivered: 0 });
    const status = await statusOf(ref.entryId);
    const screen = statusScreen({ status: status!, addresses: new Map([[RSN, `${RSN} Follow Dr`]]), floorLabels: new Map(), counts: progress.total, ids: { correct: randomUUID(), withdraw: randomUUID(), resolve: randomUUID() } });
    expect(screen.state.title).toBe("Approved");
    expect(screen.progress?.lines.map((line) => line.text)).toEqual(["3 waiting to be sent", "0 on their way", "0 delivered", "0 not delivered"]);
    // Another person's status is nothing, so their texts' progress is not asked for.
    expect(await statusOf(ref.entryId, neighbour)).toBeNull();
  });
});
