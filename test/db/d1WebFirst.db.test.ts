// Lower-risk ambassador posts appear on the web at once as "Not yet verified" (S08.03, AD-5 "Web publication", "D-1 eligibility" and "System entries"), against a
// real database. The real submitter, preparer and renderer submit the posts, the real approval approves them; residents' side is read as the app's own role
// (cvh_app_login) from the resident views, through the feed, the archive and the status, which is what the alert page and the share link read.
//
//  - a D-1 post (an Ambassador's `ack|update|correction`, not in a drill, every type direct) is web-published at its submit, raises `feed_version`, and its texts
//    are made by the approval only; an approval keeps the time residents first read it;
//  - fire alarm or evacuation, "Other", mixed types, heat, a drill and a Hub author's post appear nowhere until approved (feed, detail, share link, status);
//  - a web-published post that is discarded is superseded by a system withdrawal in the same transaction, never returns to draft, and the thread closes when
//    nothing else stands; the trigger refuses every other way to do it;
//  - a correction of a pending web-published post replaces it when the correction is approved;
//  - no check-in round is made by a publication.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import type { FeedThread } from "../../src/contracts/feed";
import type { Translated } from "../../src/contracts/translated";
import {
  FROZEN_LANGS,
  createAlerting,
  createArchive,
  createEntryPreparer,
  createFeed,
  createResidentAlerts,
  createSubmitter,
  freezeContent,
  type AlertActor,
  type AlertLifecycle,
  type AmbassadorPostInput,
  type EntryContent,
  type EntryRef,
} from "../../src/modules/alerting";
import { type RecipientEntry, type RecipientsPort } from "../../src/modules/subscriptions";
import { originOf } from "../../src/ui/alert/alert-view";
import { translatorFor } from "../../src/ui/alert/alert-test-helpers";
import { createDb, type Db } from "../../src/platform/db";
import { connect, inDays, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const RSN = "4154461";
const OTHER_RSN = "4154462";
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];
const BASE = "https://cvh.example";
const sha = (tag: string) => createHash("sha256").update(tag, "utf8").digest("hex");
const NONE: RecipientCounts = { total: 0, byLanguage: {} };
const t = translatorFor("en");
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
let coordinator: Account;
let admin: Account;
let clock = new Date();

async function account(role: Role): Promise<Account> {
  const id = randomUUID();
  await owner`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
              values (${id}, ${randomUUID()}, ${`d1_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
  const created = { id, role };
  accounts.push(created);
  return created;
}

const actorOf = (who: Account): AlertActor => ({ staffId: who.id, aal: who.role === "ambassador" ? "aal1" : "aal2" });
const assign = (who: Account, rsn: string) => owner`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${who.id}, ${rsn}, true, ${admin.id}) on conflict do nothing`;

/** Who the approval captured texts for: only an approval asks (AD-7), so a publication at submit queues and captures nothing. */
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
    await tx.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
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
                values (${rsn}, ${nb}, ${`${rsn} Post Dr`}, 43.7, -79.34, now()) on conflict do nothing`;
    for (const [index, label] of FLOORS.entries()) {
      await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(rsn, index)}, ${rsn}, ${label}, ${index}, true) on conflict do nothing`;
    }
  }
  admin = await account("admin");
  ambassador = await account("ambassador");
  coordinator = await account("coordinator");
  alerting = createAlerting({ db: app, now: () => clock, recipients: port, discardWithdrawalText: () => WITHDRAWN_TEXT });
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
  await clear();
  await owner`update staff_account set role = 'ambassador' where id = ${ambassador.id}`;
  await assign(ambassador, RSN);
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------

const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const feedVersion = async () => Number((await owner`select version from feed_version where id = 1`)[0].version);
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_id: string | null; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_id, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;
const deliveries = async () => (await owner`select count(*)::int as n from delivery`)[0].n as number;

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

async function submit(by: Account, ref: EntryRef) {
  const report = await submitter().submit(actorOf(by), ref, randomUUID());
  if (report.state !== "committed") throw new Error(`submit did not commit: ${JSON.stringify(report)}`);
  return report;
}

async function submitted(over: Partial<AmbassadorPostInput> = {}, by: Account = ambassador): Promise<EntryRef> {
  const ref = await post(by, over);
  await submit(by, ref);
  return ref;
}

const approve = async (ref: EntryRef, by: Account = coordinator) => {
  const row = await entryRow(ref.entryId);
  return alerting.approveEntry(actorOf(by), ref, { version: row.version, contentHash: row.content_hash });
};

/** An approved alert by the Hub about the building: the thread an ambassador's update goes in. */
async function hubThread(types: string[] = ["power"], isDrill = false): Promise<EntryRef> {
  const audience: Audience = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: [...types].sort() };
  const content: EntryContent = { text: "The power is out.", types, audience, phase: "problem", validUntil: new Date(clock.getTime() + 24 * 3_600_000), validUntilMode: "at" };
  // Only an Admin at aal2 starts a drill (S06.05); the other Hub person approves it.
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

// What residents read: the feed (home, and the alert page and the share link, which read the feed's thread by its slug), the archive and the status.
const feed = () => createFeed({ db: app, alertsEnabled: true, now: () => clock }).read("en");
const archive = () => createArchive({ db: app, alertsEnabled: true, now: () => clock }).read("en", 1);
const slugOf = async (alertId: string) => (await threadRow(alertId)).slug as string;
/** The alert page and the share link find a thread by its slug in the feed, else among the closed ones (`loadAlert`). */
async function detail(alertId: string): Promise<FeedThread | null> {
  const slug = await slugOf(alertId);
  const current = (await feed()).threads.find((thread) => thread.slug === slug);
  if (current) return current;
  return (await createResidentAlerts(app).readClosed?.("en", slug)) ?? null;
}
const buildingStatus = async (rsn = RSN) => (await feed()).places.buildings.find((place) => place.rsn === rsn);

/** The facts a resident reads on the alert: "Not yet verified" or "Verified by the Hub", and who it is from. */
const originOfEntry = (entry: FeedThread["entries"][number]) => originOf(entry, t);

// --- a D-1 post is on the web at its submit ----------------------------------------------------------------------------------------

describe("a D-1 post (an Ambassador's lower-risk post)", () => {
  it.each([["power"], ["water"], ["elevator"], ["flood"], ["elevator", "water"]])("%s is web-published at submit: web_published_at is set, feed_version goes up, residents see 'Not yet verified'", async (...types) => {
    const before = await feedVersion();
    const ref = await post(ambassador, { types });
    expect(await feedVersion()).toBe(before);
    expect((await entryRow(ref.entryId)).web_published_at).toBeNull();
    const report = await submit(ambassador, ref);
    expect(report).toEqual({ state: "committed", key: expect.any(String), outcome: null, webPublished: true });

    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "pending_approval", approved_by: null, approved_at: null, attributed_rsn: RSN });
    expect(row.web_published_at).not.toBeNull();
    // The database's clock times it.
    expect(Math.abs(new Date(row.web_published_at).getTime() - Date.now())).toBeLessThan(60_000);
    expect(await feedVersion()).toBe(before + 1);

    const thread = (await feed()).threads.find((candidate) => candidate.id === ref.alertId);
    expect(thread?.entries).toHaveLength(1);
    expect(thread?.entries[0]).toMatchObject({ id: ref.entryId, verified: false, attribution: { role: "ambassador", rsn: RSN }, published_at: new Date(row.web_published_at).toISOString() });
    expect(originOfEntry(thread!.entries[0])).toMatchObject({ verified: false, verification: "Not yet verified" });
    expect(await auditRows()).toContainEqual(expect.objectContaining({ action: "entry.submitted", subject_id: ref.entryId, outcome: "ok", meta: expect.objectContaining({ web_published: true }) }));
  });

  it("makes its texts only at approval: nothing is queued or captured when it is published, and the approval captures them", async () => {
    const ref = await submitted();
    expect(captured).toEqual([]);
    expect(await deliveries()).toBe(0);
    expect(await approve(ref)).toMatchObject({ ok: true });
    expect(captured).toEqual([expect.objectContaining({ entryId: ref.entryId, isDrill: false })]);
  });

  it("sets the status of the building it is about, marked not verified, at once", async () => {
    expect(await buildingStatus()).toMatchObject({ status: "none", verified: true });
    await submitted();
    expect(await buildingStatus()).toMatchObject({ status: "active", verified: false });
    expect(await buildingStatus(OTHER_RSN)).toMatchObject({ status: "none" });
  });

  it("is on the alert page, the share link's thread and the feed: one state", async () => {
    const ref = await submitted();
    const thread = await detail(ref.alertId);
    expect(thread).toMatchObject({ id: ref.alertId, state: "open" });
    expect(thread?.entries.map((entry) => entry.verified)).toEqual([false]);
    expect(await slugOf(ref.alertId)).toMatch(/^[a-z0-9]{6,16}$/);
  });

  it("is an update in a thread the Hub started: the Hub's entry stays verified, the post is not", async () => {
    const hub = await hubThread();
    clock = new Date(clock.getTime() + 60_000);
    const ref = await submitted({ into: hub.alertId });
    const thread = await detail(hub.alertId);
    expect(thread?.entries.map((entry) => [entry.id, entry.verified])).toEqual([
      [hub.entryId, true],
      [ref.entryId, false],
    ]);
  });
});

describe("a post that is not D-1 appears nowhere until it is approved", () => {
  const nowhere = async (ref: EntryRef, rsn = RSN) => {
    expect((await entryRow(ref.entryId)).web_published_at).toBeNull();
    // The feed (home), the alert page and the share link (they read the thread from the feed), the archive and the status.
    expect((await feed()).threads).toEqual([]);
    expect(await detail(ref.alertId)).toBeNull();
    expect((await archive()).threads).toEqual([]);
    expect(await buildingStatus(rsn)).toMatchObject({ status: "none", verified: true });
    expect(await createResidentAlerts(app).readClosed?.("en", await slugOf(ref.alertId))).toBeNull();
  };

  it.each([
    ["fire alarm or evacuation", ["fire"], "There is a fire alarm and people are leaving the building."],
    ["Other", ["other"], "The front door does not lock."],
    ["power with fire: every type must be direct", ["power", "fire"], "Power is out and the fire alarm is ringing."],
    ["water with Other", ["water", "other"], "No water and a strange smell."],
  ])("%s", async (_name, types, text) => {
    const before = await feedVersion();
    const ref = await post(ambassador, { types, text });
    const report = await submit(ambassador, ref);
    expect(report).not.toHaveProperty("webPublished");
    expect(await feedVersion()).toBe(before);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    await nowhere(ref);
  });

  it("appears at its approval, as 'Verified by the Hub', and not before", async () => {
    const ref = await submitted({ types: ["fire"], text: "There is a fire alarm." });
    await nowhere(ref);
    const before = await feedVersion();
    expect(await approve(ref)).toMatchObject({ ok: true });
    expect(await feedVersion()).toBe(before + 1);
    const thread = await detail(ref.alertId);
    expect(thread?.entries[0]).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: RSN } });
    expect(originOfEntry(thread!.entries[0])).toMatchObject({ verification: "Verified by the Hub" });
    expect(await buildingStatus()).toMatchObject({ status: "active", verified: true });
  });

  it("is never published at submit for a Hub author's post of a direct type, or an ambassador's in a drill", async () => {
    // A Hub author: the Hub's own acknowledgement of power waits for approval as always.
    const audience: Audience = { scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: ["power"] };
    const created = await alerting.createAlert(actorOf(coordinator), { kind: "ack", isDrill: false, reportedAt: new Date(clock.getTime() - 60_000), content: { text: "Power is out.", types: ["power"], audience, phase: "problem", validUntil: new Date(clock.getTime() + 3_600_000), validUntilMode: "at" } });
    if (!created.ok) throw new Error(created.error);
    const hubRef = { alertId: created.value.thread.id, entryId: created.value.entry.id };
    await submit(coordinator, hubRef);
    await nowhere(hubRef);

    // A drill: an Admin starts it; an ambassador posts a practice update in it; residents never read it.
    const drill = await hubThread(["power"], true);
    const before = await feedVersion();
    const practice = await submitted({ into: drill.alertId });
    expect((await entryRow(practice.entryId)).web_published_at).toBeNull();
    expect(await feedVersion()).toBe(before);
    expect((await feed()).threads).toEqual([]);
  });
});

// --- the database holds the rule too ----------------------------------------------------------------------------------------------

describe("the entry trigger refuses a publication at submit that is not D-1, whatever the use case did", () => {
  /** A draft the use case made and froze by hand, so the submit's update can be tried directly. */
  const frozenDraft = (_by: Account, types: string[], text = "The power is out.") => post(ambassador, { types, text });

  const trySubmit = async (entryId: string, actorId: string, extra: string | null = "now()") => {
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${actorId}, true)`;
      await tx.unsafe(`insert into alert_entry_translation (entry_id, lang, body, machine, model, status, source_hash) values ('${entryId}', 'ur', 'x', true, 'm1', 'translated', '${sha("x")}') on conflict do nothing`);
      await tx.unsafe(
        `update alert_entry set status = 'pending_approval', version = 1, content_hash = '${sha("c")}', sms_bodies = '{"en":{"body":"x","encoding":"gsm7","segments":1}}'::jsonb, submitted_at = now()${extra === null ? "" : `, web_published_at = ${extra}`} where id = '${entryId}'`,
      );
    });
  };

  it("lets an ambassador's power post publish at submit, and times it with the database's clock whatever was sent", async () => {
    const ref = await frozenDraft(ambassador, ["power"]);
    await trySubmit(ref.entryId, ambassador.id, "'2020-01-01T00:00:00Z'");
    const row = await entryRow(ref.entryId);
    expect(Math.abs(new Date(row.web_published_at).getTime() - Date.now())).toBeLessThan(60_000);
  });

  it.each([
    ["fire", ["fire"]],
    ["Other", ["other"]],
    ["power with fire", ["power", "fire"]],
  ])("%s", async (_name, types) => {
    const ref = await frozenDraft(ambassador, types);
    await expect(trySubmit(ref.entryId, ambassador.id)).rejects.toThrow(/only an Ambassador's post of direct types/);
    expect((await entryRow(ref.entryId)).status).toBe("draft");
    // Without the publication the same submit is fine: only the web publication is refused.
    await trySubmit(ref.entryId, ambassador.id, null);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval", web_published_at: null });
  });

  it("refuses it when the author is not an Ambassador by the time it is submitted (a Hub author's post waits for approval)", async () => {
    const ref = await frozenDraft(ambassador, ["power"]);
    await owner`update staff_account set role = 'coordinator' where id = ${ambassador.id}`;
    await expect(trySubmit(ref.entryId, ambassador.id)).rejects.toThrow(/only an Ambassador's post/);
  });

  it("refuses a kind that is not an acknowledgement, an update or a correction: an ambassador's final is not D-1", async () => {
    const hub = await hubThread();
    const made = await alerting.startFinal(actorOf(ambassador), { alertId: hub.alertId }, { entryId: randomUUID(), text: "The power is back on." });
    if (!made.ok) throw new Error(`startFinal refused: ${made.error}`);
    const ref = { alertId: hub.alertId, entryId: made.value.entry.id };
    await expect(trySubmit(ref.entryId, ambassador.id)).rejects.toThrow(/only an Ambassador's post/);
    // The use case does not publish it either: a final closes a thread and waits for a second person.
    await submit(ambassador, ref);
    expect(await entryRow(ref.entryId)).toMatchObject({ kind: "final", status: "pending_approval", web_published_at: null });
  });

  it("will not let a draft carry a publication time: the guard says so, and so does the table's own check with the guard off", async () => {
    const ref = await frozenDraft(ambassador, ["power"]);
    await expect(
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${ambassador.id}, true)`;
        await tx`update alert_entry set web_published_at = now() where id = ${ref.entryId}`;
      }),
    ).rejects.toThrow(/draft's frozen fields, approval and publication do not change/);
    await expect(
      owner.begin(async (tx) => {
        await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
        await tx`update alert_entry set web_published_at = now() where id = ${ref.entryId}`;
      }),
    ).rejects.toThrow(/alert_entry_draft_unpublished/);
    expect((await entryRow(ref.entryId)).web_published_at).toBeNull();
  });
});

// --- approval ---------------------------------------------------------------------------------------------------------------------

describe("the approval of a D-1 post", () => {
  it("shows 'Verified by the Hub' everywhere, keeps the time residents first read it, and makes the texts", async () => {
    const hub = await hubThread();
    clock = new Date(clock.getTime() + 60_000);
    const ref = await submitted({ into: hub.alertId });
    const published = (await entryRow(ref.entryId)).web_published_at as Date;
    // The post covers the thread while it is pending: the status rests on an unverified entry.
    expect(await buildingStatus()).toMatchObject({ status: "active", verified: false });
    // A later Hub update goes in between the post and its approval: the approval must not move the post past it.
    const later = await alerting.addUpdate(actorOf(coordinator), { alertId: hub.alertId }, { entryId: randomUUID(), text: "Hydro is on its way.", phase: "problem", validUntil: new Date(clock.getTime() + 6 * 3_600_000), validUntilMode: "at" });
    if (!later.ok) throw new Error(`addUpdate refused: ${later.error}`);
    const laterRef = { alertId: hub.alertId, entryId: later.value.entry.id };
    await submit(coordinator, laterRef);
    await approve(laterRef, admin);
    const before = await feedVersion();
    captured.length = 0;

    expect(await approve(ref, admin)).toMatchObject({ ok: true, value: { feedVersion: before + 1 } });
    const row = await entryRow(ref.entryId);
    expect(row).toMatchObject({ status: "approved", approved_by: admin.id });
    expect(new Date(row.web_published_at).getTime()).toBe(new Date(published).getTime());
    expect(new Date(row.approved_at).getTime()).toBeGreaterThanOrEqual(new Date(published).getTime());
    expect(captured).toEqual([expect.objectContaining({ entryId: ref.entryId })]);

    const thread = await detail(hub.alertId);
    expect(thread?.entries.map((entry) => entry.id)).toEqual([hub.entryId, ref.entryId, laterRef.entryId]);
    const mine = thread!.entries.find((entry) => entry.id === ref.entryId)!;
    expect(mine).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: RSN } });
    expect(originOfEntry(mine)).toMatchObject({ verification: "Verified by the Hub" });
  });

  it("makes any status resting on it verified", async () => {
    const ref = await submitted();
    expect(await buildingStatus()).toMatchObject({ status: "active", verified: false });
    expect(await approve(ref)).toMatchObject({ ok: true });
    expect(await buildingStatus()).toMatchObject({ status: "active", verified: true });
  });

  it("cannot be approved by its author, and is refused to be returned to draft by an approver, an author's edit or 'Try translation again': it is on the web", async () => {
    const ref = await submitted();
    const row = await entryRow(ref.entryId);
    const shown = { version: row.version, contentHash: row.content_hash };
    expect(await alerting.approveEntry(actorOf(ambassador), ref, shown)).toMatchObject({ ok: false });
    expect(await alerting.returnEntry(actorOf(coordinator), ref, "return", { shown, note: "Which floors?" })).toMatchObject({ ok: false, error: "WEB_PUBLISHED" });
    expect(await alerting.returnEntry(actorOf(ambassador), ref, "edit")).toMatchObject({ ok: false, error: "WEB_PUBLISHED" });
    const retry = await submitter().retranslate(actorOf(ambassador), ref, randomUUID(), shown);
    expect(retry).toMatchObject({ state: "refused", refusal: "WEB_PUBLISHED" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval", content_hash: row.content_hash });
    expect(new Date((await entryRow(ref.entryId)).web_published_at).getTime()).toBe(new Date(row.web_published_at).getTime());
  });

  it("is refused when the ambassador's assignment was removed since it went live, and stays on the web until the Hub discards it", async () => {
    const ref = await submitted();
    await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    expect(await approve(ref)).toMatchObject({ ok: false, error: "AUTHOR_NOT_ALLOWED" });
    expect((await detail(ref.alertId))?.entries).toHaveLength(1);
  });
});

// --- discard ----------------------------------------------------------------------------------------------------------------------

describe("the discard of a web-published post", () => {
  const shownOf = async (ref: EntryRef) => {
    const row = await entryRow(ref.entryId);
    return { version: row.version, contentHash: row.content_hash };
  };

  it.each([
    ["the Hub declining it", "hub"],
    ["its author taking it back", "author"],
  ])("by %s makes a system withdrawal that supersedes it in the same transaction, and residents see 'Withdrawn' in its place", async (_name, who) => {
    const hub = await hubThread();
    clock = new Date(clock.getTime() + 60_000);
    const ref = await submitted({ into: hub.alertId });
    const before = await feedVersion();
    const by = who === "hub" ? coordinator : ambassador;

    const result = await alerting.discardEntry(actorOf(by), ref, { shown: await shownOf(ref) });
    expect(result).toMatchObject({ ok: true, value: { id: ref.entryId, status: "superseded" } });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "superseded", approved_by: null });
    const [withdrawal] = await owner`select * from alert_entry where supersedes_id = ${ref.entryId}`;
    expect(withdrawal).toMatchObject({ kind: "withdrawal", status: "published_system", withdrawal_reason: "other", alert_id: ref.alertId, author_id: ambassador.id });
    expect(withdrawal.web_published_at).not.toBeNull();
    expect(withdrawal.original_text).toBe(WITHDRAWN_TEXT);
    expect(withdrawal).toMatchObject({ approved_by: null, content_hash: null, sms_bodies: null });
    // One feed version for the whole change; no text for the withdrawal; the thread stays open on the Hub's own entry.
    expect(await feedVersion()).toBe(before + 1);
    expect(await deliveries()).toBe(0);
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open" });

    const thread = await detail(ref.alertId);
    expect(thread?.entries.map((entry) => [entry.id, entry.kind])).toEqual([
      [hub.entryId, "ack"],
      [ref.entryId, "update"],
      [withdrawal.id, "withdrawal"],
    ]);
    expect(thread?.entries[2]).toMatchObject({ supersedes_id: ref.entryId, verified: false });

    const trail = await auditRows();
    expect(trail).toContainEqual(expect.objectContaining({ action: "entry.discarded", subject_id: ref.entryId, actor_staff_id: by.id, meta: expect.objectContaining({ discard_reason: who === "hub" ? "declined" : "by_author", withdrawn_by: withdrawal.id }) }));
    expect(trail).toContainEqual(expect.objectContaining({ action: "entry.superseded", subject_id: ref.entryId, meta: expect.objectContaining({ by: withdrawal.id, by_kind: "withdrawal", system: true }) }));
  });

  it("closes the thread as withdrawn when nothing else stands, and the archive shows the withdrawal", async () => {
    const ref = await submitted();
    expect(await alerting.discardEntry(actorOf(coordinator), ref, { shown: await shownOf(ref) })).toMatchObject({ ok: true });
    const closed = await threadRow(ref.alertId);
    expect(closed).toMatchObject({ status: "closed", closed_reason: "withdrawn" });
    const [withdrawal] = await owner`select id from alert_entry where supersedes_id = ${ref.entryId}`;
    expect(closed.closing_entry_id).toBe(withdrawal.id);
    expect((await feed()).threads).toEqual([]);
    expect((await buildingStatusOf())).toMatchObject({ status: "none" });
    const page = await archive();
    expect(page.threads.map((thread) => [thread.id, thread.close_reason])).toEqual([[ref.alertId, "withdrawn"]]);
    expect(page.threads[0].entries.map((entry) => entry.kind)).toEqual(["update", "withdrawal"]);
    expect(await auditRows()).toContainEqual(expect.objectContaining({ action: "alert.closed", meta: expect.objectContaining({ closed_as: "withdrawn", kept_entry_id: withdrawal.id }) }));
  });

  async function buildingStatusOf() {
    return buildingStatus();
  }

  it("never returns to draft and is never 'discarded': the trigger refuses every other way", async () => {
    const ref = await submitted();
    const asActor = (statement: (tx: postgres.TransactionSql) => Promise<unknown>, system?: string) =>
      owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${coordinator.id}, true)`;
        if (system) await tx`select set_config('cvh.system_actor', ${system}, true)`;
        await statement(tx);
      });
    // Back to draft.
    await expect(asActor((tx) => tx`update alert_entry set status = 'draft', returned_for = 'return', returned_note = 'x', content_hash = null, sms_bodies = null, submitted_at = null where id = ${ref.entryId}`)).rejects.toThrow(/web-published entry never returns to draft/);
    // Discarded.
    await expect(asActor((tx) => tx`update alert_entry set status = 'discarded', discard_reason = 'declined' where id = ${ref.entryId}`)).rejects.toThrow(/withdrawn, not discarded/);
    // Superseded with no withdrawal beside it, and with the session variable alone.
    await expect(asActor((tx) => tx`update alert_entry set status = 'superseded' where id = ${ref.entryId}`)).rejects.toThrow(/superseded only by/);
    await expect(asActor((tx) => tx`update alert_entry set status = 'superseded' where id = ${ref.entryId}`, "discard")).rejects.toThrow(/superseded only by/);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
  });

  it("makes the system withdrawal only for the discard: not without the session variable, an acting account, or a pending web-published entry of the same open thread", async () => {
    const ref = await submitted();
    const unpublished = await submitted({ types: ["fire"], text: "There is a fire alarm." });
    const other = await submitted();
    const insert = (supersedes: string, alertId: string, over: { system?: string | null; actor?: string | null; reason?: string; kind?: string; author?: string } = {}) =>
      owner.begin(async (tx) => {
        if (over.actor !== null) await tx`select set_config('cvh.actor_id', ${over.actor ?? coordinator.id}, true)`;
        if (over.system !== null) await tx`select set_config('cvh.system_actor', ${over.system ?? "discard"}, true)`;
        await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, valid_until_mode, supersedes_id, withdrawal_reason)
                 select ${randomUUID()}, ${alertId}, ${over.kind ?? "withdrawal"}, 'published_system', ${over.author ?? ambassador.id}, ${[over.author ?? ambassador.id]}, 'Withdrawn.', types, audience, phase, valid_until, 'resolved', ${supersedes}, ${over.reason ?? "other"}
                 from alert_entry where id = ${supersedes}`;
      });
    await expect(insert(ref.entryId, ref.alertId, { system: null })).rejects.toThrow(/new entry starts as a draft/);
    await expect(insert(ref.entryId, ref.alertId, { system: "expire" })).rejects.toThrow(/final|new entry starts/);
    await expect(insert(ref.entryId, ref.alertId, { actor: null })).rejects.toThrow(/acting account/);
    await expect(insert(ref.entryId, ref.alertId, { reason: "duplicate" })).rejects.toThrow(/reason other/);
    await expect(insert(ref.entryId, ref.alertId, { kind: "update" })).rejects.toThrow(/makes a withdrawal/);
    await expect(insert(ref.entryId, ref.alertId, { author: coordinator.id })).rejects.toThrow(/author of the entry it replaces/);
    await expect(insert(unpublished.entryId, unpublished.alertId)).rejects.toThrow(/only a pending entry that is web-published/);
    await expect(insert(other.entryId, ref.alertId)).rejects.toThrow(/entry of the same alert/);
    // Everything else right, but the entry it replaces is not superseded in the same transaction: the commit is refused and the post stays as it was.
    await expect(insert(ref.entryId, ref.alertId)).rejects.toThrow(/supersedes the entry it replaces in the same transaction/);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect((await owner`select count(*)::int as n from alert_entry where kind = 'withdrawal'`)[0].n).toBe(0);
  });

  it("is not discarded when its thread closes first: residents read it, so it stays as they saw it, in the archive", async () => {
    const hub = await hubThread();
    clock = new Date(clock.getTime() + 60_000);
    const waiting = await submitted({ into: hub.alertId });
    clock = new Date(clock.getTime() + 60_000);
    const final = await alerting.startFinal(actorOf(coordinator), { alertId: hub.alertId }, { entryId: randomUUID(), text: "The power is back on." });
    if (!final.ok) throw new Error(`startFinal refused: ${final.error}`);
    const finalRef = { alertId: hub.alertId, entryId: final.value.entry.id };
    await submit(coordinator, finalRef);
    expect(await approve(finalRef, admin)).toMatchObject({ ok: true });
    expect(await threadRow(hub.alertId)).toMatchObject({ status: "closed", closed_reason: "resolved" });
    expect(await entryRow(waiting.entryId)).toMatchObject({ status: "pending_approval", discard_reason: null });
    const closed = (await archive()).threads.find((thread) => thread.id === hub.alertId);
    expect(closed?.entries.map((entry) => [entry.id, entry.verified])).toEqual([
      [hub.entryId, true],
      [waiting.entryId, false],
      [finalRef.entryId, true],
    ]);
  });

  it("leaves the entry as it was when the discard is refused: the version and hash shown must be the pending ones", async () => {
    const ref = await submitted();
    const row = await entryRow(ref.entryId);
    expect(await alerting.discardEntry(actorOf(coordinator), ref, { shown: { version: row.version, contentHash: sha("another") } })).toMatchObject({ ok: false, error: "ENTRY_CHANGED" });
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect((await owner`select count(*)::int as n from alert_entry where kind = 'withdrawal'`)[0].n).toBe(0);
    expect(await threadRow(ref.alertId)).toMatchObject({ status: "open" });
  });
});

// --- corrections ------------------------------------------------------------------------------------------------------------------

describe("a correction of a pending, web-published post", () => {
  async function corrected(target: EntryRef) {
    const made = await alerting.correctEntry(actorOf(coordinator), { alertId: target.alertId, targetId: target.entryId }, {
      entryId: randomUUID(),
      text: "The power is out on floors 2 to 4 only.",
      phase: "in_progress",
      validUntil: new Date(clock.getTime() + 8 * 3_600_000),
      validUntilMode: "at",
    });
    if (!made.ok) throw new Error(`correctEntry refused: ${made.error}`);
    return { alertId: target.alertId, entryId: made.value.entry.id };
  }

  it("is a valid target while pending: the original stays visible, unsuperseded, until the correction is published", async () => {
    const original = await submitted();
    const correction = await corrected(original);
    await submit(coordinator, correction);
    expect(await entryRow(original.entryId)).toMatchObject({ status: "pending_approval" });
    const thread = await detail(original.alertId);
    expect(thread?.entries.map((entry) => entry.id)).toEqual([original.entryId]);
  });

  it("when approved makes the original superseded and shows the correction above it", async () => {
    const original = await submitted();
    const before = await feedVersion();
    const correction = await corrected(original);
    await submit(coordinator, correction);
    expect(await approve(correction, admin)).toMatchObject({ ok: true });
    expect(await feedVersion()).toBe(before + 1);
    expect(await entryRow(original.entryId)).toMatchObject({ status: "superseded", approved_by: null });
    const thread = await detail(original.alertId);
    expect(thread?.entries.map((entry) => [entry.id, entry.kind, entry.verified])).toEqual([
      [original.entryId, "update", false],
      [correction.entryId, "correction", true],
    ]);
    expect(thread?.entries[1].supersedes_id).toBe(original.entryId);
    const { entriesNewestFirst } = await import("../../src/contracts/feed");
    expect(entriesNewestFirst(thread!.entries).map((entry) => entry.id)).toEqual([correction.entryId, original.entryId]);
    // The covering entry, and so the status, is the correction's, verified.
    expect(await buildingStatus()).toMatchObject({ status: "in_progress", verified: true });
  });

  it("is refused for a pending entry nobody has read (fire waits for approval): TARGET_NOT_PUBLISHED", async () => {
    const waiting = await submitted({ types: ["fire"], text: "There is a fire alarm." });
    expect(await alerting.correctEntry(actorOf(coordinator), { alertId: waiting.alertId, targetId: waiting.entryId }, { entryId: randomUUID(), text: "x", phase: "problem", validUntil: new Date(clock.getTime() + 3_600_000), validUntilMode: "at" })).toMatchObject({ ok: false, error: "TARGET_NOT_PUBLISHED" });
  });
});

// --- rounds -----------------------------------------------------------------------------------------------------------------------

describe("a D-1 post in a thread of a round type", () => {
  it("creates no round when it is published: only an approval does", async () => {
    // Power is a round type (`disruption_type.checkin`, S08.05 pilot: heat and power). The check-in tables come with S08.05; where they exist, a publication leaves them empty.
    const tables = await owner<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('checkin', 'checkin_tally')`;
    const ref = await submitted({ types: ["power"] });
    for (const { table_name } of tables) expect((await owner.unsafe(`select count(*)::int as n from ${table_name}`))[0].n).toBe(0);
    expect(captured).toEqual([]);
    expect(await deliveries()).toBe(0);
    expect(await entryRow(ref.entryId)).toMatchObject({ status: "pending_approval" });
    expect(inDays(1).getTime()).toBeGreaterThan(Date.now());
  });
});
