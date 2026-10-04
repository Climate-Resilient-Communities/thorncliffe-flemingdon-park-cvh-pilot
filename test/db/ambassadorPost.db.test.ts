// An ambassador posts an update or incident for their floors (S08.02), against a real database: the post is made as a draft and submitted exactly as E04 submits
// every entry (the real submitter, preparer and renderer, the page's key), attributed to its building in its frozen texts and in `attributed_rsn`, checked
// against the ambassador's current assignments at submit and again at approval, and approved by a second person; a drill takes a practice post that residents
// never read; and every discard says why (`discard_reason`): the author's own, the Hub declining it, or the alert's close, so an ambassador's post reads "Not
// sent by the Hub" only when the Hub declined it. The use cases run as the app's own role (cvh_app_login); the checks are hit directly with SQL.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  createAlerting,
  createAmbassadorHome,
  createEntryPreparer,
  createResidentAlerts,
  createSubmitter,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type AmbassadorPostInput,
  type EntryContent,
  type EntryRef,
  type PrepareContext,
} from "../../src/modules/alerting";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { createDrillRoster, recipientsPort, type RecipientEntry, type RecipientsPort } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const RSN = "4154446";
const OTHER_RSN = "4154447";
const ADDRESS = "4154446 Post Dr";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];
const BASE = "https://cvh.example";
const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;

const sha = (tag: string) => createHash("sha256").update(tag, "utf8").digest("hex");
const NONE: RecipientCounts = { total: 0, byLanguage: {} };

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
let other: Account;
let coordinator: Account;
let admin: Account;

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`ap_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}

const actorOf = (who: Account): AlertActor => ({ staffId: who.id, aal: who.role === "ambassador" ? "aal1" : "aal2" });
const assign = (who: Account, rsn: string) => owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${who.id}, ${rsn}, true, ${admin.id}) on conflict do nothing`;
const unassign = (who: Account, rsn: string) => owner`delete from ambassador_assignment where staff_id = ${who.id} and rsn = ${rsn}`;

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
                values (${rsn}, ${nb}, ${`${rsn} Post Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
    for (const [index, label] of FLOORS.entries()) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${label}, ${index}, true) on conflict do nothing`;
    }
  }
  admin = await account("admin");
  ambassador = await account("ambassador");
  other = await account("ambassador");
  coordinator = await account("coordinator");
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
  await owner`update staff_account set role = 'ambassador' where id in (${ambassador.id}, ${other.id})`;
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;

const postInput = (over: Partial<AmbassadorPostInput> = {}): AmbassadorPostInput => ({
  into: null,
  alertId: randomUUID(),
  entryId: randomUUID(),
  place: { rsn: RSN, floors: { ids: [], ranges: [{ from: floorId(RSN, 2), to: floorId(RSN, 4) }] } },
  types: ["elevator", "water"],
  phase: "problem",
  validUntil: new Date("2026-10-02T03:00:00Z"),
  validUntilMode: "at",
  text: "The elevator is out and there is no water on floors 2 to 4. Building staff have been told.",
  ...over,
});

function submitterFor(contexts: PrepareContext[] = []) {
  const real = createEntryPreparer({
    translator: { translate: async ({ english }) => ({ translations: wholeSet(english) }) },
    freeze: (input) => freezeContent({ ...input, publicBaseUrl: BASE }),
  });
  return createSubmitter({
    lifecycle: alerting,
    preparer: { prepare: (entryContent, context, hooks) => (contexts.push(context), real.prepare(entryContent, context, hooks)) },
    ops: { record: async () => undefined },
  });
}

async function post(by: Account = ambassador, over: Partial<AmbassadorPostInput> = {}): Promise<EntryRef> {
  const made = await alerting.postFromAmbassador(actorOf(by), postInput(over));
  if (!made.ok) throw new Error(`postFromAmbassador refused: ${made.error}`);
  return { alertId: made.value.thread.id, entryId: made.value.entry.id };
}

async function submitted(by: Account = ambassador, over: Partial<AmbassadorPostInput> = {}): Promise<EntryRef> {
  const ref = await post(by, over);
  const report = await submitterFor().submit(actorOf(by), ref, randomUUID());
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return ref;
}

const approve = async (ref: EntryRef, by: Account = coordinator) => {
  const row = await entryRow(ref.entryId);
  return alerting.approveEntry(actorOf(by), ref, { version: row.version, contentHash: row.content_hash });
};

/** An approved alert by the Hub about the building: the thread an ambassador's update goes in. */
async function hubThread(isDrill = false, types: string[] = ["elevator"], about?: Audience): Promise<EntryRef> {
  const audience: Audience = about ?? { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: [...types].sort() };
  const content: EntryContent = { text: "The elevator is out of service.", types, audience, phase: "problem", validUntil: new Date("2026-10-02T15:00:00Z"), validUntilMode: "at" };
  // Only an Admin at aal2 starts a drill (S06.05); the other Hub person approves it.
  const [author, approver] = isDrill ? [admin, coordinator] : [coordinator, admin];
  const created = await alerting.createAlert(actorOf(author), { kind: "ack", isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content });
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

// --- posting -------------------------------------------------------------------------------------------------------------------------

describe("an ambassador's post (A-02)", () => {
  it("makes a new thread's first entry, an update for one building and the floors chosen, audited as alert.created", async () => {
    await assign(ambassador, RSN);
    const input = postInput();
    const made = await alerting.postFromAmbassador(actorOf(ambassador), input);
    expect(made).toMatchObject({ ok: true, value: { thread: { id: input.alertId, isDrill: false }, entry: { id: input.entryId, kind: "update", status: "draft" } } });
    const row = await entryRow(input.entryId);
    expect(row.audience).toEqual({ scope: "buildings", buildings: [{ rsn: RSN, floors: [floorId(RSN, 2), floorId(RSN, 3), floorId(RSN, 4)].sort() }], groups: [], types: ["elevator", "water"] });
    expect(row).toMatchObject({ author_id: ambassador.id, phase: "problem", attributed_rsn: null, discard_reason: null });
    expect(await auditRows()).toEqual([expect.objectContaining({ action: "alert.created", outcome: "ok", actor_staff_id: ambassador.id, subject_id: input.alertId })]);
  });

  it("takes the whole building, or floors listed one by one", async () => {
    await assign(ambassador, RSN);
    const whole = await post(ambassador, { place: { rsn: RSN, floors: null } });
    expect((await entryRow(whole.entryId)).audience.buildings).toEqual([{ rsn: RSN, floors: null }]);
    const listed = await post(ambassador, { place: { rsn: RSN, floors: { ids: [floorId(RSN, 5), floorId(RSN, 1)], ranges: [] } } });
    expect((await entryRow(listed.entryId)).audience.buildings).toEqual([{ rsn: RSN, floors: [floorId(RSN, 1), floorId(RSN, 5)].sort() }]);
  });

  it("makes one thread and one entry when the same post is sent twice, even at once, and a re-sent draft takes what was sent now", async () => {
    await assign(ambassador, RSN);
    const input = postInput();
    const [first, second] = await Promise.all([alerting.postFromAmbassador(actorOf(ambassador), input), alerting.postFromAmbassador(actorOf(ambassador), input)]);
    expect(first.ok && second.ok).toBe(true);
    expect((await owner`select count(*)::int as n from alert where id = ${input.alertId}`)[0].n).toBe(1);
    expect((await owner`select count(*)::int as n from alert_entry where alert_id = ${input.alertId}`)[0].n).toBe(1);
    const again = await alerting.postFromAmbassador(actorOf(ambassador), { ...input, text: "The elevator is out on every floor." });
    expect(again).toMatchObject({ ok: true, value: { entry: { id: input.entryId, status: "draft", content: { text: "The elevator is out on every floor." } } } });
  });

  it("refuses ids that are someone else's or another thread's, and an update to a thread that is not there", async () => {
    await assign(ambassador, RSN);
    await assign(other, RSN);
    const mine = postInput();
    await alerting.postFromAmbassador(actorOf(ambassador), mine);
    expect(await alerting.postFromAmbassador(actorOf(other), mine)).toMatchObject({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ entryId: mine.entryId }))).toMatchObject({ ok: false, error: "ENTRY_ID_INVALID" });
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: randomUUID() }))).toMatchObject({ ok: false, error: "ALERT_NOT_FOUND" });
  });

  it("refuses a building the ambassador is not assigned to now, heat and smoke, Hub staff, and what any draft must satisfy, each with its reason", async () => {
    await assign(ambassador, RSN);
    const cases: [string, Account, Partial<AmbassadorPostInput>, string][] = [
      ["a building not assigned", ambassador, { place: { rsn: OTHER_RSN, floors: null } }, "OUT_OF_SCOPE"],
      ["heat, a neighbourhood-wide type", ambassador, { types: ["heat"] }, "NOT_ALLOWED"],
      ["a Coordinator: the Hub writes on its own screens", coordinator, {}, "NOT_ALLOWED"],
      ["no type", ambassador, { types: [] }, "TYPES_EMPTY"],
      ["a reversed range", ambassador, { place: { rsn: RSN, floors: { ids: [], ranges: [{ from: floorId(RSN, 4), to: floorId(RSN, 2) }] } } }, "FLOOR_RANGE_REVERSED"],
      ["a floor of another building", ambassador, { place: { rsn: RSN, floors: { ids: [floorId(OTHER_RSN, 1)], ranges: [] } } }, "FLOOR_NOT_IN_BUILDING"],
      ["Other with no line of text", ambassador, { types: ["other"], text: "   " }, "TEXT_EMPTY"],
      ["a valid-until past", ambassador, { validUntil: new Date("2026-10-01T14:00:00Z") }, "VALID_UNTIL_PAST"],
      ["a valid-until over 7 days ahead", ambassador, { validUntil: new Date("2026-10-09T15:00:00Z") }, "VALID_UNTIL_TOO_FAR"],
    ];
    for (const [name, who, over, error] of cases) {
      expect(await alerting.postFromAmbassador(actorOf(who), postInput(over)), name).toMatchObject({ ok: false, error });
    }
    expect((await owner`select count(*)::int as n from alert_entry`)[0].n).toBe(0);
    // Every refusal is recorded, with its reason.
    expect((await auditRows()).filter((row) => row.outcome === "refused").map((row) => row.meta.refusal)).toEqual(cases.map(([, , , error]) => error));
  });
});

describe("the submit of a post (E04 exactly, attributed to its building)", () => {
  it("freezes texts that say 'Building ambassador, {building}' and 'Verified by the Hub', stores the building, and the same key never makes a second version", async () => {
    await assign(ambassador, RSN);
    const ref = await post();
    const contexts: PrepareContext[] = [];
    const key = randomUUID();
    const report = await submitterFor(contexts).submit(actorOf(ambassador), ref, key);
    expect(report).toEqual({ state: "committed", key, outcome: null });
    expect(contexts[0].attribution).toEqual({ role: "ambassador", building: ADDRESS });
    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "pending_approval", version: 1, attributed_rsn: RSN, web_published_at: null });
    expect(row.sms_bodies.en.body).toContain(`Building ambassador, ${ADDRESS}`);
    expect(row.sms_bodies.en.body).toContain("Verified by the Hub");
    expect(row.sms_bodies.en.body).not.toMatch(/From the Hub/);
    // The same press again: the first attempt's result, nothing frozen twice.
    expect(await submitterFor().submit(actorOf(ambassador), ref, key)).toEqual({ state: "committed", key, outcome: null });
    expect((await entryRow(ref.entryId)).version).toBe(1);
    expect((await owner`select count(*)::int as n from alert_submit_attempt where entry_id = ${ref.entryId}`)[0].n).toBe(1);
  });

  it("puts the 911 line first for Other, as for fire", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted(ambassador, { types: ["other"], text: "The front door does not lock." });
    const lines = (await entryRow(ref.entryId)).sms_bodies.en.body.split("\n");
    expect(lines[0]).toMatch(/911/);
  });

  it("is refused at submit, with the reason, when the assignment was removed after the post was written, and nothing is frozen", async () => {
    await assign(ambassador, RSN);
    const ref = await post();
    await unassign(ambassador, RSN);
    const report = await submitterFor().submit(actorOf(ambassador), ref, randomUUID());
    expect(report).toEqual({ state: "refused", refusal: "OUT_OF_SCOPE" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "draft", version: 0, attributed_rsn: null });
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.submitted", outcome: "refused", meta: { reason: "out_of_scope", refusal: "OUT_OF_SCOPE" } });
  });

  it("is refused at approval, with the reason, when the assignment was removed after the submit, and nothing is approved", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted();
    await unassign(ambassador, RSN);
    expect(await approve(ref)).toMatchObject({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", outcome: "refused", meta: { refusal: "AUTHOR_NOT_ALLOWED" } });
  });

  it("freezes nothing when the person's role changed between the start of the submit and the freeze: the texts would name the wrong sender", async () => {
    await assign(ambassador, RSN);
    const ref = await post();
    const key = randomUUID();
    const started = await alerting.beginSubmit(actorOf(ambassador), ref, key, { kind: "submit" });
    if (!started.ok || started.value.kind !== "started") throw new Error("beginSubmit did not start");
    expect(started.value.attribution).toEqual({ role: "ambassador", rsn: RSN });
    await owner`update staff_account set role = 'coordinator' where id = ${ambassador.id}`;
    const frozen = { contentHash: sha("x"), smsBodies: { en: { body: "en", encoding: "gsm7" as const, segments: 1 } }, translations: [{ lang: "ur", body: "ur", machine: true, model: "m1", status: "translated" as const, sourceHash: sha("s") }] };
    expect(await alerting.completeSubmit(actorOf(ambassador), ref, key, frozen, started.value.expected, null, started.value.attribution)).toMatchObject({ ok: false, error: "DRAFT_CHANGED" });
    expect((await entryRow(ref.entryId)).status).toBe("draft");
  });

  it("refuses an ambassador's entry for several buildings at submit: a post is attributed to one", async () => {
    await assign(ambassador, RSN);
    await assign(ambassador, OTHER_RSN);
    const ref = await post();
    const both: Audience = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }, { rsn: OTHER_RSN, floors: null }], groups: [], types: ["elevator", "water"] };
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${ambassador.id}, true)`;
      await tx`update alert_entry set audience = ${tx.json(both as never)} where id = ${ref.entryId}`;
    });
    expect(await submitterFor().submit(actorOf(ambassador), ref, randomUUID())).toEqual({ state: "refused", refusal: "ONE_BUILDING_ONLY" });
  });
});

describe("an approved post, as the approver and residents read it", () => {
  it("is O-07 by what was frozen, even after the author's role changed, and residents read it as the building's ambassador's, verified", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted();
    await owner`update staff_account set role = 'coordinator' where id = ${ambassador.id}`;
    const review = await alerting.review(ref);
    expect(review).toMatchObject({ authorRole: "coordinator", attribution: { role: "ambassador", rsn: RSN } });
    expect(await approve(ref, admin)).toMatchObject({ ok: true });
    const threads = await createResidentAlerts(app).read("en");
    const entry = threads.threads.find((thread) => thread.id === ref.alertId)?.entries[0];
    expect(entry).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: RSN } });
    expect(captured.at(-1)).toMatchObject({ entryId: ref.entryId, isDrill: false });
  });

  it("clears the building with the other frozen fields when it is returned to its author, and a draft can never hold one", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted();
    const row = await entryRow(ref.entryId);
    expect(await alerting.returnEntry(actorOf(coordinator), ref, "return", { shown: { version: row.version, contentHash: row.content_hash }, note: "Which floors exactly?" })).toMatchObject({ ok: true });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "draft", attributed_rsn: null, content_hash: null });
    expect((await alerting.review(ref))?.attribution).toBeNull();
    await expect(
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${ambassador.id}, true)`;
        await tx`update alert_entry set attributed_rsn = ${RSN} where id = ${ref.entryId}`;
      }),
    ).rejects.toThrow(/alert_entry_attributed_rsn_frozen/);
  });

  it("a Hub entry stays the Hub's: no building is stored and residents read it from the Hub", async () => {
    const ref = await hubThread();
    expect((await entryRow(ref.entryId)).attributed_rsn).toBeNull();
    const threads = await createResidentAlerts(app).read("en");
    expect(threads.threads.find((thread) => thread.id === ref.alertId)?.entries[0].attribution).toEqual({ role: "hub" });
  });
});

describe("an update in an open thread, and a practice post in a drill", () => {
  it("is an update to the thread, keeping its types whatever is sent, for the ambassador's building and floors, audited as entry.created", async () => {
    await assign(ambassador, RSN);
    const thread = await hubThread();
    clock = new Date(NOW.getTime() + 60_000);
    const input = postInput({ into: thread.alertId, types: ["fire"] });
    const made = await alerting.postFromAmbassador(actorOf(ambassador), input);
    expect(made).toMatchObject({ ok: true, value: { thread: { id: thread.alertId }, entry: { id: input.entryId, kind: "update", content: { types: ["elevator"] } } } });
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.created", outcome: "ok", subject_id: input.entryId, meta: { kind: "update", types: ["elevator"] } });
  });

  it("in a drill, is a practice post: its texts carry the exercise marker, its approval texts only the roster, and residents never read it", async () => {
    await assign(ambassador, RSN);
    const drill = await hubThread(true);
    clock = new Date(NOW.getTime() + 60_000);
    const ref = await submitted(ambassador, { into: drill.alertId });
    const row = await entryRow(ref.entryId);
    expect(row.sms_bodies.en.body.split("\n")[0]).toBe("Exercise. Practice only.");
    expect(await approve(ref)).toMatchObject({ ok: true, value: { feedVersion: null } });
    // Who is texted is asked as a drill: the drill roster only (S06.05), never residents.
    expect(captured.at(-1)).toMatchObject({ entryId: ref.entryId, isDrill: true });
    expect((await createResidentAlerts(app).read("en")).threads.map((thread) => thread.id)).not.toContain(drill.alertId);
    expect(await owner`select id from nondrill_alert_entry_v3 where alert_id = ${drill.alertId}`).toEqual([]);
    expect((await auditRows()).filter((audit) => audit.subject_id === ref.entryId).every((audit) => audit.is_drill)).toBe(true);
  });

  it("is refused in a closed thread", async () => {
    await assign(ambassador, RSN);
    const thread = await hubThread();
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${thread.alertId}`;
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: thread.alertId }))).toMatchObject({ ok: false, error: "ALERT_CLOSED" });
  });

  it("is refused, and nothing is written, in an open thread about a building the post is not for: the server holds to the threads the page offers", async () => {
    // Assigned to both buildings, the post for the other one, into the alert about this one: OUT_OF_SCOPE, however the request was made.
    await assign(ambassador, RSN);
    await assign(ambassador, OTHER_RSN);
    const thread = await hubThread();
    clock = new Date(NOW.getTime() + 60_000);
    const elsewhere = { rsn: OTHER_RSN, floors: null };
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: thread.alertId, place: elsewhere }))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    // Assigned only to the other building: the same.
    await unassign(ambassador, RSN);
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: thread.alertId, place: elsewhere }))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    // A drill about this building is the same.
    const drill = await hubThread(true);
    expect(await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: drill.alertId, place: elsewhere }))).toEqual({ ok: false, error: "OUT_OF_SCOPE" });
    expect(Number((await owner`select count(*)::int as n from alert_entry where author_id = ${ambassador.id}`)[0].n)).toBe(0);
    expect((await auditRows()).filter((row) => row.action === "entry.created" && row.actor_staff_id === ambassador.id).map((row) => row.outcome)).toEqual(["refused", "refused", "refused"]);
  });

  it("goes in an alert about the whole neighbourhood of the building it is for", async () => {
    await assign(ambassador, OTHER_RSN);
    const thread = await hubThread(false, ["power"], { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] });
    clock = new Date(NOW.getTime() + 60_000);
    const made = await alerting.postFromAmbassador(actorOf(ambassador), postInput({ into: thread.alertId, place: { rsn: OTHER_RSN, floors: null } }));
    expect(made).toMatchObject({ ok: true, value: { thread: { id: thread.alertId }, entry: { kind: "update", content: { types: ["power"] } } } });
  });
});

describe("a post's approval with S06's rules", () => {
  /** The lifecycle as the app wires it: the real recipients port (subscribers, or for a drill the drill roster) and the on-call rule on or off. */
  const wired = (oncallRequired: boolean) =>
    createAlerting({ db: app, now: () => clock, recipients: recipientsPort, pricePerSegmentCents: () => 1.5, oncall: { required: () => oncallRequired } });
  const approveWith = async (lifecycle: AlertLifecycle, ref: EntryRef, by: Account = coordinator) => {
    const row = await entryRow(ref.entryId);
    const reviewed = (await lifecycle.review(ref))?.recipients;
    return lifecycle.approveEntry(actorOf(by), ref, { version: row.version, contentHash: row.content_hash, ...(reviewed ? { recipients: { total: reviewed.total, byLanguage: reviewed.byLanguage } } : {}) });
  };

  it("refuses a post's approval with ONCALL_REQUIRED while texting is live and nobody is on call, and approves it once a number is on the roster", async () => {
    await owner`delete from oncall_roster`;
    await assign(ambassador, RSN);
    const ref = await submitted();

    expect(await approveWith(wired(true), ref)).toEqual({ ok: false, error: "ONCALL_REQUIRED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect((await auditRows()).filter((row) => row.action === "entry.approved").at(-1)).toMatchObject({ outcome: "refused", meta: { refusal: "ONCALL_REQUIRED" } });

    await owner`insert into oncall_roster (id, label, phone, added_by) values (${randomUUID()}, 'IT lead', '+14165550123', ${admin.id})`;
    try {
      expect(await approveWith(wired(true), ref)).toMatchObject({ ok: true, value: { entry: { status: "approved" } } });
    } finally {
      await owner`delete from oncall_roster`;
    }
  });

  it("approves a practice post in a drill with nobody on call, and texts it to the drill roster only, each text with the exercise marker first", async () => {
    await owner`delete from oncall_roster`;
    const roster = createDrillRoster({
      db: app,
      audit: { record: (tx, event) => record(tx, event), recordRefusal: (db, event) => recordRefusal(db, event) },
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    });
    const members: string[] = [];
    for (const [index, number] of ["416-555-0111", "647-555-0122"].entries()) {
      const added = await roster.add({ actorStaffId: admin.id, label: `Drill phone ${index}`, number, lang: "en" });
      if (added.kind !== "added") throw new Error(`not added: ${added.problem}`);
      members.push(added.id);
    }
    try {
      await assign(ambassador, RSN);
      const drill = await hubThread(true);
      clock = new Date(NOW.getTime() + 60_000);
      const ref = await submitted(ambassador, { into: drill.alertId });

      expect(await approveWith(wired(true), ref)).toMatchObject({ ok: true, value: { feedVersion: null, recipients: { total: 2 } } });
      const rows = await owner<{ recipient_kind: string; recipient_id: string; body: string }[]>`select recipient_kind, recipient_id, body from delivery where entry_id = ${ref.entryId}`;
      expect(rows.map((row) => row.recipient_kind)).toEqual(["roster", "roster"]);
      expect(rows.map((row) => row.recipient_id).sort()).toEqual([...members].sort());
      expect(rows.every((row) => row.body.startsWith("Exercise. Practice only."))).toBe(true);
    } finally {
      await owner`truncate delivery`;
      for (const id of members) await owner`delete from drill_roster where id = ${id}`;
    }
  });
});

// --- why an entry was discarded (the decision S08.01 handed over) -----------------------------------------------------------------------

describe("every discard says why", () => {
  const home = (who: Account) => createAmbassadorHome(app).read({ staffId: who.id, assignedRsns: [RSN], neighbourhoodOf: new Map([[RSN, "TP"]]) });

  it("is by_author when the author takes back their own post, which then is not shown as declined", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted();
    expect(await alerting.discardEntry(actorOf(ambassador), ref)).toMatchObject({ ok: true, value: { status: "discarded", discardReason: "by_author" } });
    expect((await entryRow(ref.entryId)).discard_reason).toBe("by_author");
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.discarded", meta: { discard_reason: "by_author", from: "pending_approval" } });
    expect((await home(ambassador)).posts).toEqual([]);
  });

  it("is declined when the Hub discards it, and only then is the post 'Not sent by the Hub'", async () => {
    await assign(ambassador, RSN);
    const ref = await submitted();
    const row = await entryRow(ref.entryId);
    expect(await alerting.discardEntry(actorOf(coordinator), ref, { shown: { version: row.version, contentHash: row.content_hash } })).toMatchObject({ ok: true });
    expect((await entryRow(ref.entryId)).discard_reason).toBe("declined");
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.discarded", actor_staff_id: coordinator.id, meta: { discard_reason: "declined" } });
    expect((await home(ambassador)).posts).toMatchObject([{ entryId: ref.entryId, state: "declined" }]);
  });

  it("is by_close when the alert closes with the post unread (a final's approval), which reads as ended, never declined", async () => {
    await assign(ambassador, RSN);
    const thread = await hubThread();
    clock = new Date(NOW.getTime() + 60_000);
    const waiting = await submitted(ambassador, { into: thread.alertId });
    clock = new Date(NOW.getTime() + 120_000);
    const final = await alerting.startFinal(actorOf(coordinator), { alertId: thread.alertId }, { entryId: randomUUID(), text: "The elevator works again." });
    if (!final.ok) throw new Error(`startFinal refused: ${final.error}`);
    const finalRef = { alertId: thread.alertId, entryId: final.value.entry.id };
    const report = await submitterFor().submit(actorOf(coordinator), finalRef, randomUUID());
    expect(report.state).toBe("committed");
    expect(await approve(finalRef, admin)).toMatchObject({ ok: true });
    expect(await entryRow(waiting.entryId)).toMatchObject({ status: "discarded", discard_reason: "by_close" });
    expect((await auditRows()).find((row) => row.action === "entry.discarded" && row.subject_id === waiting.entryId)).toMatchObject({ meta: { by_close: true, discard_reason: "by_close" } });
    expect((await home(ambassador)).posts.find((item) => item.entryId === waiting.entryId)).toMatchObject({ state: "ended" });
  });

  it("is required by the database for every new discard, from the catalog only, and never on an entry that is not discarded", async () => {
    await assign(ambassador, RSN);
    const ref = await post();
    const asAuthor = (statement: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${ambassador.id}, true)`;
        await statement(tx);
      });
    await expect(asAuthor((tx) => tx`update alert_entry set status = 'discarded' where id = ${ref.entryId}`)).rejects.toThrow(/alert_entry_discard_reason_status/);
    await expect(asAuthor((tx) => tx`update alert_entry set status = 'discarded', discard_reason = 'because' where id = ${ref.entryId}`)).rejects.toThrow(/alert_entry_discard_reason_valid/);
    await expect(asAuthor((tx) => tx`update alert_entry set discard_reason = 'declined' where id = ${ref.entryId}`)).rejects.toThrow(/alert_entry_discard_reason_status/);
    await asAuthor((tx) => tx`update alert_entry set status = 'discarded', discard_reason = 'by_author' where id = ${ref.entryId}`);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "discarded", discard_reason: "by_author" });
    // A discarded entry never changes again, its reason included (the entry guard).
    await expect(asAuthor((tx) => tx`update alert_entry set discard_reason = 'declined' where id = ${ref.entryId}`)).rejects.toThrow(/cannot be changed/);
  });
});
