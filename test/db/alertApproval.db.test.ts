// A second person approves exactly what they reviewed (S04.07), against a real database: the approval's one transaction (the recipient snapshot taken
// through `captureRecipients` after E06's marker and before the count is compared, the approved state, `web_published_at`, `feed_version` and the audit
// entry in it, or none of them), every refusal changing nothing and recorded with its reason, the count that changed, the valid-until that passed,
// the two approvers at once and the approval racing a pull-back or a new submit, Return to author with its note, Discard, what the approval view
// reads, the incidents list, and the pilot's timings with drills kept apart (FR-M2).
// The use cases run as the app's own role (cvh_app_login); the recipient port is a fake that writes a row through the approval's transaction, which
// is how these tests see that it ran inside it.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { RecipientCounts } from "../../src/contracts/alertApproval";
import type { Audience } from "../../src/contracts/audience";
import { createAlerting, type AlertActor, type AlertLifecycle, type EntryContent, type EntryRef, type FrozenContent } from "../../src/modules/alerting";
import { createAssignments } from "../../src/modules/identity";
import type { RecipientEntry, RecipientsPort } from "../../src/modules/subscriptions";
import { floorsOfBuilding } from "../../src/modules/places";
import { createDb, type Db, type DbTransaction } from "../../src/platform/db";
import { connect, serverUrl } from "./helpers";
import { submitSeams } from "./alertSubmitSeams";

const RSN = "4154246";
const floorId = (index: number) => `01900000-0000-7000-8000-0000000b${String(index).padStart(4, "0")}`;
const FLOORS = ["G", "1", "2", "3", "4", "5"];
const madeNeighbourhoods: string[] = [];

const NOW = new Date("2026-10-01T15:00:00Z");
let clock = NOW;

const sha = (tag: string) => createHash("sha256").update(tag).digest("hex");
const NONE: RecipientCounts = { total: 0, byLanguage: {} };

const buildingAudience = (types: string[] = ["power"]): Audience => ({ scope: "buildings", buildings: [{ rsn: RSN, floors: null }], groups: [], types: [...types].sort() });
const content = (over: Partial<EntryContent> = {}): EntryContent => ({
  text: "Power is out on floors 3 to 5.",
  types: ["power"],
  audience: buildingAudience(),
  phase: "problem",
  validUntil: new Date("2026-10-02T15:00:00Z"),
  ...over,
});

const frozen = (tag: string): FrozenContent => ({
  contentHash: sha(tag),
  smsBodies: { en: { body: `en ${tag}`, encoding: "gsm7", segments: 1 }, ur: { body: `ur ${tag}`, encoding: "ucs2", segments: 2 } },
  translations: [{ lang: "ur", body: `ur ${tag}`, machine: true, model: "m1", status: "translated", sourceHash: sha("source") }],
});

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
              values (${id}, ${randomUUID()}, ${`ap_${randomBytes(5).toString("hex")}`}, 'Test', ${role}, 'test@example.org', ${role}, false)`;
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

// --- the recipient port: a fake that runs inside the approval's transaction and says what it saw ---------------------------------

let snapshot: RecipientCounts = NONE;
let texting = false;
const log: string[] = [];
const seen: { markTxid?: string; captureTxid?: string; captured?: { status: string; sameNow: boolean; feedVersion: number }; entry?: RecipientEntry } = {};
let captureThrows: Error | null = null;

const rowsOf = <T,>(result: unknown) => result as unknown as T[];

const port: RecipientsPort = {
  count: async () => ({ open: texting, ...snapshot }),
  capture: async (entry, tx) => {
    log.push(`capture ${entry.entryId}`);
    seen.entry = entry;
    seen.captureTxid = rowsOf<{ id: string }>(await tx.execute(sql`select txid_current()::text as id`))[0].id;
    // What the transaction has done by now: the entry is approved by this very transaction (E06's trigger needs `approved_at = now()`) and
    // feed_version is raised (AD-18's lock order puts the delivery rows after it).
    const [state] = rowsOf<{ status: string; same_now: boolean }>(await tx.execute(sql`select status, approved_at = now() as same_now from alert_entry where id = ${entry.entryId}`));
    const [feed] = rowsOf<{ version: string }>(await tx.execute(sql`select version::text as version from feed_version`));
    seen.captured = { status: state.status, sameNow: state.same_now, feedVersion: Number(feed.version) };
    await tx.execute(sql`insert into approval_probe (entry_id, txid) values (${entry.entryId}, txid_current())`);
    if (captureThrows) throw captureThrows;
    return snapshot;
  },
};

const marker = async (tx: DbTransaction, entryId: string) => {
  log.push(`mark ${entryId}`);
  seen.markTxid = rowsOf<{ id: string }>(await tx.execute(sql`select txid_current()::text as id`))[0].id;
};

async function clear() {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where subject_type in ('alert', 'alert_entry')`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await tx.unsafe("truncate approval_probe, alert_submit_attempt, alert_entry_translation, alert_entry, alert");
  });
  await owner`update staff_account set role = ${authorA.role}::staff_role, status = 'active' where id = ${authorA.id}`;
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
  // The table the fake port writes through the approval's transaction.
  await owner.unsafe("create table if not exists approval_probe (entry_id uuid not null, txid bigint not null)");
  await owner.unsafe("grant select, insert, delete on approval_probe to cvh_app");
  await owner.unsafe("alter table approval_probe enable row level security");
  await owner.unsafe("drop policy if exists approval_probe_all on approval_probe");
  await owner.unsafe("create policy approval_probe_all on approval_probe for all to cvh_app using (true) with check (true)");
  for (const [id, name, fsa] of [["TP", "Thorncliffe Park", "M4H"], ["FP", "Flemingdon Park", "M3C"]]) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at)
              values (${RSN}, 'TP', ${`${RSN} Test Dr`}, 43.7, -79.34, '2026-10-01T12:00:00Z') on conflict do nothing`;
  for (const [index, label] of FLOORS.entries()) {
    await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${floorId(index)}, ${RSN}, ${label}, ${index}, true) on conflict do nothing`;
  }
  authorA = await account("coordinator");
  coordB = await account("coordinator");
  adminC = await account("admin");
  director = await account("director");
  ambassador = await account("ambassador");
  alerting = createAlerting({ db: app, now: () => clock, recipients: port, markApproval: marker });
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
  await owner.unsafe("drop table if exists approval_probe");
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
  snapshot = NONE;
  texting = false;
  captureThrows = null;
  log.length = 0;
  for (const key of Object.keys(seen)) delete (seen as Record<string, unknown>)[key];
  await clear();
});

// --- helpers -------------------------------------------------------------------------------------------------------------------------

async function newDraft(by: Account = authorA, over: Partial<EntryContent> = {}, isDrill = false, kind: "ack" | "update" = "ack"): Promise<EntryRef> {
  const created = await alerting.createAlert(actorOf(by), { kind, isDrill, reportedAt: new Date("2026-10-01T14:50:00Z"), content: content(over) });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  return { alertId: created.value.thread.id, entryId: created.value.entry.id };
}

async function newPending(by: Account = authorA, tag = "v1", isDrill = false): Promise<EntryRef> {
  const ref = await newDraft(by, {}, isDrill);
  const submitted = await seams.freeze(actorOf(by), ref, frozen(tag));
  if (!submitted.ok) throw new Error(`freeze refused: ${submitted.error}`);
  return ref;
}

const shownOf = (tag: string, version = 1, recipients: RecipientCounts = NONE) => ({ version, contentHash: sha(tag), recipients });
const entryRow = async (id: string) => (await owner`select * from alert_entry where id = ${id}`)[0];
const threadRow = async (id: string) => (await owner`select * from alert where id = ${id}`)[0];
const feedVersion = async () => Number((await owner`select version from feed_version`)[0].version);
const probeRows = async () => (await owner<{ entry_id: string; txid: string }[]>`select entry_id, txid::text from approval_probe`);
const translationCount = async (id: string) => (await owner`select count(*)::int as n from alert_entry_translation where entry_id = ${id}`)[0].n as number;
const auditRows = () =>
  owner<{ action: string; outcome: string; actor_staff_id: string | null; subject_id: string | null; is_drill: boolean; meta: Record<string, unknown> }[]>`
    select action, outcome, actor_staff_id, subject_id, is_drill, meta from audit_event where subject_type in ('alert', 'alert_entry') order by id`;

/** Everything an approval or a refusal of one could change, as one value: the entry, the thread, the feed version, the probe and the translations. */
async function world(ref: EntryRef) {
  return { entry: await entryRow(ref.entryId), thread: await threadRow(ref.alertId), feed: await feedVersion(), probe: await probeRows(), translations: await translationCount(ref.entryId) };
}

/** Direct SQL with the app's credentials: one transaction, the acting account set the way a use case sets it. */
async function asApp<T>(actor: string | null, run: (tx: postgres.TransactionSql) => PromiseLike<T>): Promise<T> {
  return appSql.begin(async (tx) => {
    if (actor !== null) await tx`select set_config('cvh.actor_id', ${actor}, true)`;
    return await run(tx);
  }) as Promise<T>;
}

// --- the approval's one transaction --------------------------------------------------------------------------------------------------

describe("the approval transaction", () => {
  it("captures the recipient snapshot inside the same transaction that approves, after E06's marker and after the entry is approved and feed_version raised, and audits the count", async () => {
    const ref = await newPending();
    snapshot = { total: 3, byLanguage: { en: 2, ur: 1 } };
    texting = true;
    const before = await feedVersion();

    const result = await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1", 1, snapshot));

    expect(result).toMatchObject({ ok: true, value: { entry: { status: "approved", approvedBy: coordB.id, version: 1 }, recipients: snapshot, feedVersion: before + 1 } });
    expect(log).toEqual([`mark ${ref.entryId}`, `capture ${ref.entryId}`]);
    // One transaction: the marker, the capture and the probe row it wrote share a transaction id, which is not the id of anything else.
    expect(seen.markTxid).toBeDefined();
    expect(seen.captureTxid).toBe(seen.markTxid);
    expect(await probeRows()).toEqual([{ entry_id: ref.entryId, txid: seen.markTxid }]);
    // By then the entry was approved by this transaction (approved_at = now(): what E06's delivery trigger asks) and feed_version was raised.
    expect(seen.captured).toEqual({ status: "approved", sameNow: true, feedVersion: before + 1 });
    // The port was given what the entry is: the audience and the frozen texts as stored, never from the request.
    expect(seen.entry).toMatchObject({ entryId: ref.entryId, alertId: ref.alertId, kind: "ack", isDrill: false, supersedesId: null, types: ["power"] });
    expect(seen.entry?.audience).toEqual(buildingAudience());
    expect(seen.entry?.smsBodies).toEqual({ en: { body: "en v1", encoding: "gsm7", segments: 1 }, ur: { body: "ur v1", encoding: "ucs2", segments: 2 } });
    // Everything else the approval does is in the record: published, timed by the database, audited with the version, the hash and the count.
    const row = await entryRow(ref.entryId);
    expect([row.approved_version, row.approved_hash]).toEqual([1, sha("v1")]);
    expect(row.web_published_at).toEqual(row.approved_at);
    expect(await feedVersion()).toBe(before + 1);
    expect((await auditRows()).at(-1)).toEqual({
      action: "entry.approved",
      outcome: "ok",
      actor_staff_id: coordB.id,
      subject_id: ref.entryId,
      is_drill: false,
      meta: { entry_id: ref.entryId, version: 1, content_hash: sha("v1"), recipient_count: 3 },
    });
  });

  it("refuses, and changes nothing, when the snapshot counts other people than the approver reviewed: the capture rolls back with the approval, and the refusal says from what to what", async () => {
    const ref = await newPending();
    snapshot = { total: 3, byLanguage: { en: 2, ur: 1 } };
    texting = true;
    const before = await world(ref);

    const result = await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1", 1, { total: 2, byLanguage: { en: 1, ur: 1 } }));

    expect(result).toEqual({ ok: false, error: "RECIPIENT_COUNT_CHANGED", detail: { recipients: snapshot } });
    expect(log).toEqual([`mark ${ref.entryId}`, `capture ${ref.entryId}`]);
    // The capture ran, in the approval's transaction, and everything it did is gone.
    expect(await world(ref)).toEqual(before);
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect(await probeRows()).toEqual([]);
    expect((await auditRows()).filter((row) => row.action === "entry.approved")).toEqual([
      {
        action: "entry.approved",
        outcome: "refused",
        actor_staff_id: coordB.id,
        subject_id: ref.entryId,
        is_drill: false,
        meta: { reason: "conflict", refusal: "RECIPIENT_COUNT_CHANGED", recipient_count: 3, reviewed_count: 2 },
      },
    ]);

    // The approver reviews the new number and presses Approve again: it names the new count, and it goes through.
    expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1", 1, snapshot))).toMatchObject({ ok: true, value: { recipients: snapshot } });
    expect(await probeRows()).toHaveLength(1);
  });

  it("compares every language, not only the total: the same number of people in other languages is a change too", async () => {
    const ref = await newPending();
    snapshot = { total: 3, byLanguage: { en: 1, ur: 2 } };
    texting = true;
    const result = await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1", 1, { total: 3, byLanguage: { en: 2, ur: 1 } }));
    expect(result).toEqual({ ok: false, error: "RECIPIENT_COUNT_CHANGED", detail: { recipients: snapshot } });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    expect((await auditRows()).at(-1)?.meta).toMatchObject({ reason: "conflict", refusal: "RECIPIENT_COUNT_CHANGED", recipient_count: 3, reviewed_count: 3 });
  });

  it("takes a reviewed count that is left out for 'nobody': it approves while nobody is captured (before E07) and refuses the moment anybody is", async () => {
    const ref = await newPending();
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true, value: { recipients: NONE } });
    const second = await newPending(authorA, "w1");
    snapshot = { total: 1, byLanguage: { en: 1 } };
    expect(await alerting.approveEntry(actorOf(adminC), second, { version: 1, contentHash: sha("w1") })).toMatchObject({ ok: false, error: "RECIPIENT_COUNT_CHANGED" });
  });

  it("raises no feed version for a drill (nothing the web shows changes) but still captures the drill's recipients, and the outcome says so", async () => {
    const ref = await newPending(authorA, "v1", true);
    const before = await feedVersion();
    const result = await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"));
    expect(result).toMatchObject({ ok: true, value: { feedVersion: null } });
    expect(await feedVersion()).toBe(before);
    expect(seen.entry?.isDrill).toBe(true);
    expect(log).toEqual([`mark ${ref.entryId}`, `capture ${ref.entryId}`]);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.approved", outcome: "ok", is_drill: true, meta: { recipient_count: 0 } });
  });

  it("fails the approval, with nothing changed, when the port counts people wrongly (parts that do not add up to the total)", async () => {
    const ref = await newPending();
    snapshot = { total: 5, byLanguage: { en: 2 } };
    const before = await world(ref);
    await expect(alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"))).rejects.toThrow(/adding up to its total/);
    expect(await world(ref)).toEqual(before);
  });

  it("fails the approval, with nothing changed, when the capture itself throws: the entry stays pending, the feed version is not raised, no probe row is left", async () => {
    const ref = await newPending();
    captureThrows = new Error("a subscriber row could not be locked");
    const before = await world(ref);
    await expect(alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"))).rejects.toThrow(/could not be locked/);
    expect(await world(ref)).toEqual(before);
    expect((await auditRows()).filter((row) => row.action === "entry.approved")).toEqual([]);
  });

  it("runs on the default wiring too (subscriptions' port, no marker): nobody is captured before E07, and the count audited is 0", async () => {
    const plain = createAlerting({ db: app, now: () => clock });
    const ref = await newPending();
    expect(await plain.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("v1") })).toMatchObject({ ok: true, value: { recipients: { total: 0, byLanguage: {} } } });
    expect((await auditRows()).at(-1)?.meta).toMatchObject({ recipient_count: 0 });
  });
});

// --- every refusal changes nothing and is recorded with its reason ------------------------------------------------------------------

describe("every refusal changes nothing and is recorded with its reason", () => {
  const scenarios: Array<{ name: string; error: string; reason: string; run: (ref: EntryRef) => Promise<unknown>; setup?: (ref: EntryRef) => Promise<void> }> = [
    { name: "an editor", error: "EDITOR_CANNOT_APPROVE", reason: "self_action", run: (ref) => alerting.approveEntry(actorOf(authorA), ref, shownOf("v1")) },
    { name: "a session below aal2", error: "AAL2_REQUIRED", reason: "aal_required", run: (ref) => alerting.approveEntry(actorOf(coordB, "aal1"), ref, shownOf("v1")) },
    { name: "a role that never approves", error: "NOT_ALLOWED", reason: "forbidden", run: (ref) => alerting.approveEntry(actorOf(director), ref, shownOf("v1")) },
    { name: "an Ambassador", error: "NOT_ALLOWED", reason: "forbidden", run: (ref) => alerting.approveEntry(actorOf(ambassador), ref, shownOf("v1")) },
    { name: "a hash other than the pending one", error: "ENTRY_CHANGED", reason: "conflict", run: (ref) => alerting.approveEntry(actorOf(coordB), ref, { version: 1, contentHash: sha("what was shown") }) },
    { name: "a version other than the pending one", error: "ENTRY_CHANGED", reason: "conflict", run: (ref) => alerting.approveEntry(actorOf(coordB), ref, { version: 7, contentHash: sha("v1") }) },
    {
      name: "a valid-until that passed while the entry waited",
      error: "VALID_UNTIL_PAST",
      reason: "validation",
      setup: async () => {
        clock = new Date("2026-10-02T15:00:01Z");
      },
      run: (ref) => alerting.approveEntry(actorOf(coordB), ref, shownOf("v1")),
    },
    {
      name: "an author who may no longer author it",
      error: "AUTHOR_NOT_ALLOWED",
      reason: "out_of_scope",
      setup: async () => void (await owner`update staff_account set status = 'suspended' where id = ${authorA.id}`),
      run: (ref) => alerting.approveEntry(actorOf(coordB), ref, shownOf("v1")),
    },
    {
      name: "an entry that is no longer pending (pulled back to a draft)",
      error: "ENTRY_NOT_PENDING",
      reason: "conflict",
      setup: async (ref) => void (await alerting.returnEntry(actorOf(authorA), ref, "edit")),
      run: (ref) => alerting.approveEntry(actorOf(coordB), ref, shownOf("v1")),
    },
    {
      name: "a thread that was closed while the approver read",
      error: "ALERT_CLOSED",
      reason: "alert_closed",
      setup: async (ref) => void (await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${ref.alertId}`),
      run: (ref) => alerting.approveEntry(actorOf(coordB), ref, shownOf("v1")),
    },
    { name: "an entry that does not exist", error: "ENTRY_NOT_FOUND", reason: "not_found", run: (ref) => alerting.approveEntry(actorOf(coordB), { alertId: ref.alertId, entryId: randomUUID() }, shownOf("v1")) },
    { name: "a thread that does not exist", error: "ALERT_NOT_FOUND", reason: "not_found", run: () => alerting.approveEntry(actorOf(coordB), { alertId: randomUUID(), entryId: randomUUID() }, shownOf("v1")) },
  ];

  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s: refused, nothing changed, and the record names the rule and the reason", async (_name, scenario) => {
    const ref = await newPending();
    await scenario.setup?.(ref);
    const before = await world(ref);
    const auditBefore = (await auditRows()).length;

    expect(await scenario.run(ref)).toEqual({ ok: false, error: scenario.error });

    expect(await world(ref), "nothing changed").toEqual(before);
    expect(log, "no recipient was captured for a refusal that came before the capture").toEqual([]);
    const written = (await auditRows()).slice(auditBefore);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ action: "entry.approved", outcome: "refused", meta: { reason: scenario.reason, refusal: scenario.error } });
    // A refusal is recorded without any text: codes only.
    expect(Object.keys(written[0].meta).sort()).toEqual(["reason", "refusal"]);
  });
});

// --- the valid-until passed ---------------------------------------------------------------------------------------------------------

describe("an entry whose valid-until passed while it waited", () => {
  it("is refused at the instant it passes, and the author returns it to draft, sets a new time and submits again, after which it can be approved", async () => {
    const ref = await newPending();
    // The valid-until is 2026-10-02T15:00:00Z: exactly then it is no longer in the future.
    clock = new Date("2026-10-02T14:59:59Z");
    expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"))).toMatchObject({ ok: true });

    const waiting = await newPending(authorA, "w1");
    clock = new Date("2026-10-02T15:00:00Z");
    expect(await alerting.approveEntry(actorOf(coordB), waiting, shownOf("w1"))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect((await entryRow(waiting.entryId)).status).toBe("pending_approval");

    // The author's way out: back to draft, a new time, submit again as version 2.
    expect(await alerting.returnEntry(actorOf(authorA), waiting, "edit")).toMatchObject({ ok: true });
    expect(await alerting.saveDraft(actorOf(authorA), waiting, content({ validUntil: new Date("2026-10-04T15:00:00Z") }))).toMatchObject({ ok: true });
    expect(await seams.freeze(actorOf(authorA), waiting, frozen("w2"))).toMatchObject({ ok: true });
    expect(await alerting.approveEntry(actorOf(coordB), waiting, shownOf("w2", 2))).toMatchObject({ ok: true, value: { entry: { version: 2 } } });
  });

  it("is refused even though the version and hash match what was shown, and the approval's refusal is the one recorded", async () => {
    const ref = await newPending();
    clock = new Date("2026-10-03T00:00:00Z");
    expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"))).toEqual({ ok: false, error: "VALID_UNTIL_PAST" });
    expect((await auditRows()).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "validation", refusal: "VALID_UNTIL_PAST" } });
  });
});

// --- two approvers at once, and approval racing others ------------------------------------------------------------------------------

describe("concurrency", () => {
  it("lets exactly one of two approvers at once win: one approval, one capture, one feed version, one ok record and one refusal", async () => {
    const ref = await newPending();
    const before = await feedVersion();
    const shown = shownOf("v1");

    const results = await Promise.all([alerting.approveEntry(actorOf(coordB), ref, shown), alerting.approveEntry(actorOf(adminC), ref, shown)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "ENTRY_NOT_PENDING" }]);
    expect(await feedVersion()).toBe(before + 1);
    expect(await probeRows()).toHaveLength(1);
    expect(log.filter((line) => line.startsWith("capture"))).toHaveLength(1);
    const records = (await auditRows()).filter((row) => row.action === "entry.approved");
    expect(records.map((row) => row.outcome).sort()).toEqual(["ok", "refused"]);
    expect(records.find((row) => row.outcome === "refused")?.meta).toMatchObject({ reason: "conflict", refusal: "ENTRY_NOT_PENDING" });
    const winner = results.find((result) => result.ok) as { value: { entry: { approvedBy: string } } };
    expect((await entryRow(ref.entryId)).approved_by).toBe(winner.value.entry.approvedBy);
  });

  it("lets exactly one of five approvers at once win", async () => {
    const approvers = await Promise.all([account("coordinator"), account("coordinator"), account("admin"), account("coordinator"), account("admin")]);
    const ref = await newPending();
    const results = await Promise.all(approvers.map((who) => alerting.approveEntry(actorOf(who), ref, shownOf("v1"))));
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).every((result) => !result.ok && result.error === "ENTRY_NOT_PENDING")).toBe(true);
    expect(await probeRows()).toHaveLength(1);
  });

  it("never approves what was not shown when an approval races a pull-back: either it wins and the pull-back is refused, or the pull-back wins and the approval is refused", async () => {
    let approvedFirst = 0;
    let pulledFirst = 0;
    for (let round = 0; round < 8; round += 1) {
      const ref = await newPending(authorA, `r${round}`);
      const [approval, pullBack] = await Promise.all([alerting.approveEntry(actorOf(coordB), ref, shownOf(`r${round}`)), alerting.returnEntry(actorOf(authorA), ref, "edit")]);
      const row = await entryRow(ref.entryId);
      if (approval.ok) {
        approvedFirst += 1;
        expect(pullBack, `round ${round}`).toMatchObject({ ok: false });
        expect(row).toMatchObject({ status: "approved", approved_hash: sha(`r${round}`), content_hash: sha(`r${round}`) });
      } else {
        pulledFirst += 1;
        expect(approval, `round ${round}`).toEqual({ ok: false, error: "ENTRY_NOT_PENDING" });
        expect(pullBack, `round ${round}`).toMatchObject({ ok: true });
        expect(row).toMatchObject({ status: "draft", approved_by: null, content_hash: null });
      }
    }
    expect(approvedFirst + pulledFirst).toBe(8);
  });

  it("refuses with a hash mismatch when an approval of the version the approver read races a pull-back and a new submit: it never approves the new version under the old hash", async () => {
    for (let round = 0; round < 8; round += 1) {
      const ref = await newPending(authorA, `s${round}a`);
      const shown = shownOf(`s${round}a`);
      const resubmit = async () => {
        const pulled = await alerting.returnEntry(actorOf(authorA), ref, "edit");
        return pulled.ok ? await seams.freeze(actorOf(authorA), ref, frozen(`s${round}b`)) : pulled;
      };
      const [approval, chain] = await Promise.all([alerting.approveEntry(actorOf(coordB), ref, shown), resubmit()]);
      const row = await entryRow(ref.entryId);
      if (approval.ok) {
        expect(row, `round ${round}`).toMatchObject({ status: "approved", version: 1, approved_hash: sha(`s${round}a`) });
        expect(chain.ok, `round ${round}`).toBe(false);
      } else {
        // The approver's version is gone: whichever moment they came in, they were refused and nothing was approved.
        expect(["ENTRY_NOT_PENDING", "ENTRY_CHANGED"], `round ${round}: ${JSON.stringify(approval)}`).toContain((approval as { error: string }).error);
        expect(row.approved_by, `round ${round}`).toBeNull();
        expect(row.status, `round ${round}`).not.toBe("approved");
      }
    }
  });

  it("refuses a hash mismatch after the author pulled back and submitted again: nothing is approved under the old hash, and the new version can then be approved", async () => {
    const ref = await newPending(authorA, "t1");
    expect(await alerting.returnEntry(actorOf(authorA), ref, "edit")).toMatchObject({ ok: true });
    expect(await seams.freeze(actorOf(authorA), ref, frozen("t2"))).toMatchObject({ ok: true });
    const before = await world(ref);
    expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("t1", 1))).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.approveEntry(actorOf(coordB), ref, { version: 2, contentHash: sha("t1") })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await world(ref)).toEqual(before);
    expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("t2", 2))).toMatchObject({ ok: true });
  });

  it("waits behind a held thread lock, then approves", async () => {
    const ref = await newPending();
    let settled = false;
    let approval!: Promise<unknown>;
    await appSql.begin(async (tx) => {
      await tx`select id from alert where id = ${ref.alertId} for update`;
      approval = alerting.approveEntry(actorOf(coordB), ref, shownOf("v1")).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
    });
    expect(await approval).toMatchObject({ ok: true });
  });
});

// --- Return to author with a note, and Discard ---------------------------------------------------------------------------------------

describe("Return to author with a note", () => {
  it("returns the entry to a draft that keeps its text, with the note for its author; the approver does not become an editor; the translations and the approval binding are gone", async () => {
    const ref = await newPending();
    const result = await alerting.returnEntry(actorOf(coordB), ref, "return", { shown: shownOf("v1"), note: "  Please say which floors.\nThen submit again.  " });

    expect(result).toMatchObject({
      ok: true,
      value: { status: "draft", version: 1, contentHash: null, returnedFor: "return", returnedNote: "Please say which floors.\nThen submit again.", editorIds: [authorA.id], content: { text: "Power is out on floors 3 to 5." } },
    });
    const row = await entryRow(ref.entryId);
    expect([row.content_hash, row.sms_bodies, row.submitted_at, row.approved_by]).toEqual([null, null, null, null]);
    expect(row.editor_ids).toEqual([authorA.id]);
    expect(await translationCount(ref.entryId)).toBe(0);
    // Audited without the note: a flag that there was one.
    expect((await auditRows()).at(-1)).toEqual({
      action: "entry.returned",
      outcome: "ok",
      actor_staff_id: coordB.id,
      subject_id: ref.entryId,
      is_drill: false,
      meta: { entry_id: ref.entryId, version: 1, returned_for: "return", with_note: true },
    });
    expect(JSON.stringify(await auditRows())).not.toContain("Please say which floors");
  });

  it("shows the author the note on their incidents list, and the approver no longer has it waiting", async () => {
    const ref = await newPending();
    await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Say which floors." });
    const author = await alerting.incidents({ staffId: authorA.id });
    expect(author.mine).toMatchObject([{ entryId: ref.entryId, alertId: ref.alertId, status: "draft", returnedNote: "Say which floors.", submittedAt: null }]);
    expect(author.waiting).toEqual([]);
    expect((await alerting.incidents({ staffId: coordB.id })).waiting).toEqual([]);
    expect((await alerting.getEntry(ref))?.returnedNote).toBe("Say which floors.");
  });

  it("clears the note when the author submits again, with the return it belonged to", async () => {
    const ref = await newPending();
    await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Say which floors." });
    expect(await seams.freeze(actorOf(authorA), ref, frozen("v2"))).toMatchObject({ ok: true, value: { version: 2, returnedFor: null, returnedNote: null } });
    expect((await entryRow(ref.entryId)).returned_note).toBeNull();
    expect((await alerting.incidents({ staffId: authorA.id })).mine).toMatchObject([{ status: "pending_approval", returnedNote: null }]);
  });

  it("keeps the note while the author edits the draft, and drops it when the entry is pulled back for another reason", async () => {
    const ref = await newPending();
    await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Say which floors." });
    expect(await alerting.saveDraft(actorOf(authorA), ref, content({ text: "Power is out on floors 3 to 4." }))).toMatchObject({ ok: true, value: { returnedNote: "Say which floors." } });
    await seams.freeze(actorOf(authorA), ref, frozen("v2"));
    expect(await alerting.returnEntry(actorOf(authorA), ref, "edit")).toMatchObject({ ok: true, value: { returnedFor: "edit", returnedNote: null } });
  });

  it.each([
    ["no note", undefined, "NOTE_REQUIRED"],
    ["an empty note", "", "NOTE_REQUIRED"],
    ["a note of spaces and control characters only", "  \u0000\u0007\n\t ", "NOTE_REQUIRED"],
    ["a note over 500 characters", "x".repeat(501), "NOTE_TOO_LONG"],
  ])("refuses %s, changes nothing and records the refusal", async (_name, note, error) => {
    const ref = await newPending();
    const before = await world(ref);
    expect(await alerting.returnEntry(actorOf(coordB), ref, "return", { note })).toEqual({ ok: false, error });
    expect(await world(ref)).toEqual(before);
    expect((await auditRows()).at(-1)).toMatchObject({ action: "entry.returned", outcome: "refused", meta: { reason: "validation", refusal: error } });
  });

  it("takes a note of exactly 500 characters, counted as the database counts them (an emoji is one), and takes the control characters out of a longer one", async () => {
    const ref = await newPending();
    const note = "\u{1F6D7}".repeat(500);
    expect(await alerting.returnEntry(actorOf(coordB), ref, "return", { note })).toMatchObject({ ok: true, value: { returnedNote: note } });
    const other = await newPending(authorA, "o1");
    expect(await alerting.returnEntry(actorOf(coordB), other, "return", { note: "a\u0000b\u0007c" })).toMatchObject({ ok: true, value: { returnedNote: "abc" } });
  });

  it("is refused for what the approver was not shown (a changed entry) and for an entry that is no longer pending, before anything is written", async () => {
    const ref = await newPending();
    expect(await alerting.returnEntry(actorOf(coordB), ref, "return", { shown: { version: 1, contentHash: sha("other") }, note: "x" })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
    await alerting.returnEntry(actorOf(authorA), ref, "edit");
    expect(await alerting.returnEntry(actorOf(coordB), ref, "return", { shown: shownOf("v1"), note: "x" })).toEqual({ ok: false, error: "ENTRY_NOT_PENDING" });
  });

  it("is an approver's act only: an editor, a session below aal2 and a role that never approves are refused, whatever the note", async () => {
    const ref = await newPending();
    expect(await alerting.returnEntry(actorOf(authorA), ref, "return", { note: "x" })).toEqual({ ok: false, error: "EDITOR_CANNOT_APPROVE" });
    expect(await alerting.returnEntry(actorOf(coordB, "aal1"), ref, "return", { note: "x" })).toEqual({ ok: false, error: "AAL2_REQUIRED" });
    expect(await alerting.returnEntry(actorOf(director), ref, "return", { note: "x" })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect((await entryRow(ref.entryId)).status).toBe("pending_approval");
  });

  it("is held by the database, not only by the use case: a return to the author without a note, a note on any other return, a changed or blank note are all refused to the app's own credentials", async () => {
    const ref = await newPending();
    const row = await entryRow(ref.entryId);
    const toDraft = (extra: string) =>
      asApp(coordB.id, (tx) => tx.unsafe(`update alert_entry set status = 'draft', content_hash = null, sms_bodies = null, submitted_at = null, ${extra} where id = '${ref.entryId}'`));
    await expect(toDraft("returned_for = 'return'")).rejects.toThrow(/carries a note|alert_entry_return_has_note/);
    await expect(toDraft("returned_for = 'return', returned_note = '   '")).rejects.toThrow(/carries a note|alert_entry_returned_note_valid/);
    await expect(toDraft(`returned_for = 'return', returned_note = '${"x".repeat(501)}'`)).rejects.toThrow(/alert_entry_returned_note_valid/);
    await expect(toDraft("returned_for = 'edit', returned_note = 'hello'")).rejects.toThrow(/only an approver's return carries a note|alert_entry_return_has_note/);
    await expect(toDraft("returned_for = 'retranslate', returned_note = 'hello'")).rejects.toThrow(/only an approver's return carries a note|alert_entry_return_has_note/);
    expect(await entryRow(ref.entryId)).toEqual(row);

    // A draft's note is not the app's to rewrite by saving it, and a submit cannot carry it forward.
    await alerting.returnEntry(actorOf(coordB), ref, "return", { note: "Say which floors." });
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set returned_note = 'something else' where id = ${ref.entryId}`)).rejects.toThrow(/frozen fields|alert_entry_return_has_note/);
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set returned_note = null where id = ${ref.entryId}`)).rejects.toThrow(/frozen fields|alert_entry_return_has_note/);
    await expect(asApp(authorA.id, (tx) => tx`update alert_entry set status = 'discarded', returned_note = null, returned_for = null where id = ${ref.entryId}`)).rejects.toThrow(/discarding changes nothing else/);
    expect((await entryRow(ref.entryId)).returned_note).toBe("Say which floors.");
  });
});

describe("Discard", () => {
  it("discards a pending entry for an approver who is not an editor, audits it from pending_approval, and keeps what the entry said", async () => {
    const ref = await newPending();
    const result = await alerting.discardEntry(actorOf(coordB), ref, { shown: shownOf("v1") });
    expect(result).toMatchObject({ ok: true, value: { status: "discarded", version: 1, content: { text: "Power is out on floors 3 to 5." } } });
    expect((await auditRows()).at(-1)).toEqual({
      action: "entry.discarded",
      outcome: "ok",
      actor_staff_id: coordB.id,
      subject_id: ref.entryId,
      is_drill: false,
      meta: { entry_id: ref.entryId, version: 1, from: "pending_approval" },
    });
    expect((await alerting.incidents({ staffId: authorA.id })).mine).toEqual([]);
    // Nothing is published and the feed is untouched.
    expect((await entryRow(ref.entryId)).web_published_at).toBeNull();
  });

  it("is refused for what the approver was not shown, a session below aal2, an editor who is not an approver's act, and a web-published entry", async () => {
    const ref = await newPending();
    const before = await world(ref);
    expect(await alerting.discardEntry(actorOf(coordB), ref, { shown: { version: 1, contentHash: sha("other") } })).toEqual({ ok: false, error: "ENTRY_CHANGED" });
    expect(await alerting.discardEntry(actorOf(coordB, "aal1"), ref, { shown: shownOf("v1") })).toEqual({ ok: false, error: "AAL2_REQUIRED" });
    expect(await alerting.discardEntry(actorOf(director), ref, { shown: shownOf("v1") })).toEqual({ ok: false, error: "NOT_ALLOWED" });
    expect(await world(ref)).toEqual(before);
    expect((await auditRows()).filter((row) => row.action === "entry.discarded" && row.outcome === "refused").map((row) => row.meta.refusal)).toEqual(["ENTRY_CHANGED", "AAL2_REQUIRED", "NOT_ALLOWED"]);
    await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"));
    // Approved, it is published: it can only be corrected or withdrawn (E05), never discarded.
    expect(await alerting.discardEntry(actorOf(adminC), ref, { shown: shownOf("v1") })).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect(await alerting.discardEntry(actorOf(adminC), ref)).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
    expect((await entryRow(ref.entryId)).status).toBe("approved");
  });
});

// --- what the approval view reads and the incidents list ----------------------------------------------------------------------------

describe("what the approval view reads", () => {
  it("is the entry as stored, its frozen texts and text messages, the author's role now, and the count of people the text reaches right now", async () => {
    const ref = await newPending();
    snapshot = { total: 4, byLanguage: { en: 3, ur: 1 } };
    texting = true;
    const review = await alerting.review(ref);
    expect(review).toMatchObject({
      thread: { id: ref.alertId, isDrill: false, status: "open" },
      entry: { id: ref.entryId, status: "pending_approval", version: 1, contentHash: sha("v1"), authorId: authorA.id },
      authorRole: "coordinator",
      recipients: { open: true, total: 4, byLanguage: { en: 3, ur: 1 } },
      duplicate: null,
    });
    expect(review?.texts).toEqual([{ lang: "ur", body: "ur v1", status: "translated", machine: true, model: "m1" }]);
    expect(review?.sms).toEqual({ en: { body: "en v1", encoding: "gsm7", segments: 1 }, ur: { body: "ur v1", encoding: "ucs2", segments: 2 } });
  });

  it("says an Ambassador's post is one: the author's role is read from the database (O-07)", async () => {
    try {
      const assignments = createAssignments({ db: app, floors: { floorsOf: floorsOfBuilding } });
      expect(await assignments.assign(adminC.id, { staffId: ambassador.id, rsn: RSN, floorIds: null })).toMatchObject({ ok: true });
      const ref = await newDraft(ambassador);
      expect(await seams.freeze(actorOf(ambassador), ref, frozen("a1"))).toMatchObject({ ok: true });
      expect((await alerting.review(ref))?.authorRole).toBe("ambassador");
      // The approval of it works like any other: a Coordinator who is not an editor approves it.
      expect(await alerting.approveEntry(actorOf(coordB), ref, shownOf("a1"))).toMatchObject({ ok: true });
    } finally {
      await owner`delete from ambassador_assignment where staff_id = ${ambassador.id}`;
    }
  });

  it("has no texts, no text messages and nobody counted for a draft, and none counted once approved", async () => {
    const draft = await newDraft();
    texting = true;
    snapshot = { total: 2, byLanguage: { en: 2 } };
    expect(await alerting.review(draft)).toMatchObject({ texts: [], sms: {}, recipients: { open: false, total: 0 } });
    const pending = await newPending(authorA, "p1");
    await alerting.approveEntry(actorOf(coordB), pending, shownOf("p1", 1, snapshot));
    expect(await alerting.review(pending)).toMatchObject({ entry: { status: "approved" }, recipients: { open: false, total: 0 } });
  });

  it("names the possible duplicate and the entry to open, and is null for something that is not there", async () => {
    const other = await newPending(authorA, "d0");
    const ref = await newPending(authorA, "d1");
    await owner.begin(async (tx) => {
      await tx`select set_config('cvh.actor_id', ${authorA.id}, true)`;
      await tx.unsafe(`alter table alert_entry disable trigger alert_entry_guard`);
      await tx`update alert_entry set possible_duplicate_of = ${other.alertId} where id = ${ref.entryId}`;
      await tx.unsafe(`alter table alert_entry enable trigger alert_entry_guard`);
    });
    expect((await alerting.review(ref))?.duplicate).toEqual({ alertId: other.alertId, entryId: other.entryId });
    expect(await alerting.review({ alertId: randomUUID(), entryId: randomUUID() })).toBeNull();
    expect(await alerting.review({ alertId: "nope", entryId: ref.entryId })).toBeNull();
  });
});

describe("the incidents list", () => {
  it("waits for a Coordinator or an Admin on every pending entry they did not edit, longest waiting first, and not for a Director or an Ambassador", async () => {
    const first = await newPending(authorA, "i1");
    clock = new Date("2026-10-01T16:00:00Z");
    const second = await newPending(authorA, "i2");
    const mine = await newPending(coordB, "i3");
    const forB = await alerting.incidents({ staffId: coordB.id });
    expect(forB.waiting.map((row) => row.entryId)).toEqual([first.entryId, second.entryId]);
    expect(forB.mine.map((row) => row.entryId)).toEqual([mine.entryId]);
    const forAdmin = await alerting.incidents({ staffId: adminC.id });
    expect(forAdmin.waiting).toHaveLength(3);
    expect(forAdmin.mine).toEqual([]);
    for (const who of [director, ambassador]) expect((await alerting.incidents({ staffId: who.id })).waiting).toEqual([]);
  });

  it("lists the author's drafts and pending entries, drills flagged, and leaves out what is closed, discarded or approved", async () => {
    const draft = await newDraft(authorA);
    const drill = await newPending(authorA, "x1", true);
    const approved = await newPending(authorA, "x2");
    await alerting.approveEntry(actorOf(coordB), approved, shownOf("x2"));
    const discarded = await newPending(authorA, "x3");
    await alerting.discardEntry(actorOf(authorA), discarded);
    const closed = await newPending(authorA, "x4");
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${closed.alertId}`;
    const mine = (await alerting.incidents({ staffId: authorA.id })).mine;
    expect(mine.map((row) => [row.entryId, row.status, row.isDrill]).sort()).toEqual(
      [
        [draft.entryId, "draft", false],
        [drill.entryId, "pending_approval", true],
      ].sort(),
    );
  });

  it("is empty for an account that does not exist, one that is not active, and an id that is not one", async () => {
    await newPending();
    expect(await alerting.incidents({ staffId: randomUUID() })).toEqual({ waiting: [], mine: [] });
    expect(await alerting.incidents({ staffId: "nope" })).toEqual({ waiting: [], mine: [] });
    await owner`update staff_account set status = 'suspended' where id = ${coordB.id}`;
    expect(await alerting.incidents({ staffId: coordB.id })).toEqual({ waiting: [], mine: [] });
    await owner`update staff_account set status = 'active' where id = ${coordB.id}`;
  });
});

// --- the pilot's timings, drills apart (FR-M2) ----------------------------------------------------------------------------------------

describe("the timings (FR-M2)", () => {
  const T0 = new Date("2026-09-20T10:00:00Z");
  const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

  /** A thread and entries written directly with the times a test names (the guards stand aside for the statements, in this transaction only). */
  async function seed(thread: { isDrill: boolean; reportedAt: Date }, entries: Array<{ kind: string; createdAt: Date; approvedAt: Date | null }>) {
    const alertId = randomUUID();
    const ids: string[] = [];
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_insert_guard");
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx`insert into alert (id, is_drill, reported_at, created_by, created_at, slug) values (${alertId}, ${thread.isDrill}, ${thread.reportedAt}, ${authorA.id}, ${thread.reportedAt}, ${alertId.slice(-10)})`;
      for (const entry of entries) {
        const id = randomUUID();
        ids.push(id);
        const approved = entry.approvedAt !== null;
        await tx`
          insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at,
                                   approved_by, approved_at, approved_version, approved_hash, web_published_at, created_at, updated_at)
          values (${id}, ${alertId}, ${entry.kind}, ${approved ? "approved" : "discarded"}, ${authorA.id}, ${[authorA.id]}, 'Power is out.', ${["power"]},
                  ${tx.json({ scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] })}, 'problem', ${at(60 * 24 * 10)}, 1, ${sha(id)}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, ${entry.createdAt},
                  ${approved ? coordB.id : null}, ${entry.approvedAt}, ${approved ? 1 : null}, ${approved ? sha(id) : null}, ${entry.approvedAt}, ${entry.createdAt}, ${entry.createdAt})`;
      }
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      await tx.unsafe("alter table alert enable trigger alert_insert_guard");
    });
    return { alertId, ids };
  }

  const timing = async (entryId: string) => (await owner`select * from alert_approval_timing where entry_id = ${entryId}`)[0];
  const summary = async () => Object.fromEntries((await owner`select * from alert_approval_timing_summary`).map((row) => [String(row.is_drill), row]));
  const minutes = (ms: unknown) => Number(ms) / 60_000;

  it("records, for every approved entry, the time from the author's first save to its approval, and for the first approved acknowledgement the time from the first report as well", async () => {
    const thread = await seed({ isDrill: false, reportedAt: T0 }, [
      { kind: "ack", createdAt: at(2), approvedAt: at(9) },
      { kind: "update", createdAt: at(12), approvedAt: at(20) },
      { kind: "ack", createdAt: at(21), approvedAt: at(30) },
    ]);
    const [first, update, secondAck] = await Promise.all(thread.ids.map(timing));
    expect(minutes(first.first_save_to_approval_ms)).toBe(7);
    expect(minutes(first.reported_to_first_ack_ms)).toBe(9);
    expect(first).toMatchObject({ is_drill: false, kind: "ack", alert_id: thread.alertId });
    // An update is not an acknowledgement, and a later acknowledgement is not the first one.
    expect(minutes(update.first_save_to_approval_ms)).toBe(8);
    expect(update.reported_to_first_ack_ms).toBeNull();
    expect(minutes(secondAck.first_save_to_approval_ms)).toBe(9);
    expect(secondAck.reported_to_first_ack_ms).toBeNull();
  });

  it("counts an acknowledgement as the first approved one when the thread's earlier acknowledgement was never approved", async () => {
    const thread = await seed({ isDrill: false, reportedAt: T0 }, [
      { kind: "ack", createdAt: at(1), approvedAt: null },
      { kind: "ack", createdAt: at(4), approvedAt: at(15) },
    ]);
    expect(await owner`select * from alert_approval_timing where entry_id = ${thread.ids[0]}`).toHaveLength(0);
    expect(minutes((await timing(thread.ids[1])).reported_to_first_ack_ms)).toBe(15);
  });

  it("keeps drills apart: every row says whether its thread is a drill, and the summary has one row for the real threads and one for the drills, so a rehearsal never counts as a real response", async () => {
    await seed({ isDrill: false, reportedAt: T0 }, [{ kind: "ack", createdAt: at(1), approvedAt: at(11) }]);
    await seed({ isDrill: false, reportedAt: T0 }, [{ kind: "ack", createdAt: at(3), approvedAt: at(33) }]);
    await seed({ isDrill: true, reportedAt: T0 }, [{ kind: "ack", createdAt: at(1), approvedAt: at(2) }]);
    const rows = await summary();
    expect(Object.keys(rows).sort()).toEqual(["false", "true"]);
    // Real: first acks 11 and 33 minutes after the first report (median 22); first save to approval 10 and 30 (median 20).
    expect(rows.false).toMatchObject({ entries_approved: 2, first_acks: 2 });
    expect(minutes(rows.false.median_reported_to_first_ack_ms)).toBe(22);
    expect(minutes(rows.false.median_first_save_to_approval_ms)).toBe(20);
    // The drill: one minute from its first save, two from its first report; none of it in the real numbers.
    expect(rows.true).toMatchObject({ entries_approved: 1, first_acks: 1 });
    expect(minutes(rows.true.median_reported_to_first_ack_ms)).toBe(2);
    expect(minutes(rows.true.median_first_save_to_approval_ms)).toBe(1);
  });

  it("has a row for an approval made by the use case, timed by the database's clock: positive, and equal to approved_at minus the draft's creation", async () => {
    const ref = await newPending();
    await alerting.approveEntry(actorOf(coordB), ref, shownOf("v1"));
    const row = await timing(ref.entryId);
    const [{ expected }] = await owner`select round(extract(epoch from (approved_at - created_at)) * 1000)::bigint::text as expected from alert_entry where id = ${ref.entryId}`;
    expect(String(row.first_save_to_approval_ms)).toBe(expected);
    expect(Number(row.first_save_to_approval_ms)).toBeGreaterThan(0);
    expect(row.reported_to_first_ack_ms).not.toBeNull();
    expect(row.is_drill).toBe(false);
    // A pending entry has no row: nothing is timed before it is approved.
    const pending = await newPending(authorA, "q1");
    expect(await owner`select * from alert_approval_timing where entry_id = ${pending.entryId}`).toHaveLength(0);
  });

  it("is readable by the app's role only, not by anon, authenticated or service_role", async () => {
    for (const view of ["alert_approval_timing", "alert_approval_timing_summary"]) {
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        const [privilege] = await owner.unsafe(`select has_table_privilege('${role}', 'public.${view}', 'select') as ok`);
        expect(privilege.ok, `${role} on ${view}`).toBe(false);
      }
      const [app] = await owner.unsafe(`select has_table_privilege('cvh_app', 'public.${view}', 'select') as ok`);
      expect(app.ok, view).toBe(true);
    }
  });
});

describe("the return note column", () => {
  it("is the one new column of alert_entry, writable by the app only as the lifecycle writes it, with its two checks not yet validated on the existing rows", async () => {
    const [column] = await owner`select data_type, is_nullable from information_schema.columns where table_name = 'alert_entry' and column_name = 'returned_note'`;
    expect(column).toEqual({ data_type: "text", is_nullable: "YES" });
    const [grant] = await owner`select has_column_privilege('cvh_app', 'public.alert_entry', 'returned_note', 'update') as ok`;
    expect(grant.ok).toBe(true);
    const checks = await owner`select conname, convalidated from pg_constraint where conrelid = 'public.alert_entry'::regclass and conname in ('alert_entry_returned_note_valid', 'alert_entry_return_has_note') order by conname`;
    expect(checks.map((check) => [check.conname, check.convalidated])).toEqual([
      ["alert_entry_return_has_note", false],
      ["alert_entry_returned_note_valid", false],
    ]);
  });
});
