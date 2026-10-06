// The monthly cap on text message spending, against a real database as the app's own role (cvh_app_login) (S07.08, FR-G6, NFR-N9, FR-M5, AR-12): the one `spend_cap`
// row and who may change it; setting it, audited in the same transaction; the Toronto month boundary; the real approval path at, just under and just over the cap
// (the cap warns and never blocks: the approval commits, the texts are queued, the overrun is audited and recorded as the ops event the health job texts about);
// the texts still waiting counting towards the month; a retried text counted once; the month's report and the pilot's against the budget; and the sender never
// held back by the cap (an on-call text and a reply to STOP go out with the month far past it). The lifecycle, the recipient port and the outbox are the real ones;
// the provider is a fake and every number is fictitious (the 555 exchange). Nothing here reaches Twilio.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import type { Audience } from "../../src/contracts/audience";
import { createAlerting, freezeContent, type AlertActor, type AlertLifecycle, type EntryContent, type EntryRef, type FrozenContent } from "../../src/modules/alerting";
import { record, recordRefusal } from "../../src/modules/audit";
import { createDeliveryQueue, createSenderHealth, createSmsSpend, queuedCostCents } from "../../src/modules/messaging";
import { createHealthJob, createOncallRoster, oncallText } from "../../src/modules/ops";
import { createSpendCap, monthSpentCents, readSpendCap, readSpendOverview, recordSmsEstimate, smsMonthReport } from "../../src/modules/spend";
import { lastPublishedAt } from "../../src/modules/directory";
import { createDb, type Db } from "../../src/platform/db";
import { submitSeams } from "./alertSubmitSeams";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

const BASE_URL = "https://cvh.example";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const RSN = "9300001";
const FLOOR = "01900000-0000-7000-8000-930000010001";
const PRICE = 1.5;
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let alerting: AlertLifecycle;
let seams: ReturnType<typeof submitSeams>;
let auditBaseline = 0;
let NOW = new Date();
let madeNeighbourhood = false;

let author: { id: string };
let approver: { id: string };
let admin: { id: string };

const actor = (who: { id: string }): AlertActor => ({ staffId: who.id, aal: "aal2" });
const auditTrail = { record: (tx: Parameters<typeof record>[0], event: Parameters<typeof record>[1]) => record(tx, event), recordRefusal: (db: Db, event: Parameters<typeof recordRefusal>[1]) => recordRefusal(db, event) };
const caps = () => createSpendCap({ db: app, audit: auditTrail as never });

// The estimate of each text is counted by the real hooks, at the instant a test chooses.
let spendNow: Date = NOW;
const hooks = createSmsSpend({ pricePerSegmentCents: PRICE, now: () => spendNow, log: { error: () => {} } });
const spendSeams = { afterOutcome: hooks.afterOutcome, afterProviderId: hooks.afterProviderId };

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
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Fixture TP', 'M4H')`;
    madeNeighbourhood = true;
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', ${`${RSN} Test Dr`}, 43.7, -79.34, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR}, ${RSN}, '1', 1, true) on conflict do nothing`;
});

async function clearSpend() {
  await owner.unsafe("delete from sms_estimate_retirement");
  await owner.unsafe("delete from sms_actual");
  await owner.unsafe("delete from sms_reconciliation");
  await owner.unsafe("delete from spend_event");
}

async function resetAll() {
  await owner`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await owner.begin(async (tx) => {
    await tx.unsafe("truncate checkin_tally, checkin, alert_submit_attempt, delivery, alert_entry_translation, alert_entry, alert");
  });
  await owner`delete from oncall_roster`;
  await owner`delete from subscriber`;
  await owner`delete from ops_event`;
  await owner`update health_condition set active = false, since = null, last_alerted_at = null, last_event_id = null, checked_at = null`;
  await world.reset();
  await clearSpend();
}

afterAll(async () => {
  await resetAll();
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  if (madeNeighbourhood) await owner`delete from neighbourhood where id = 'TP'`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await resetAll();
  NOW = new Date();
  spendNow = NOW;
  // The approval reads "now" from the lifecycle, so the month the cap judges is the month the estimates below are made in, even across a month's last minute.
  alerting = createAlerting({ db: app, pricePerSegmentCents: () => PRICE, now: () => NOW });
  seams = submitSeams(owner, alerting);
  author = await world.fx.staff("coordinator");
  approver = await world.fx.staff("coordinator");
  admin = await world.fx.staff("admin");
});

// --- fixtures ---------------------------------------------------------------------------------------------------------------------------------------

let phoneCounter = 0;
const audience: Audience = { scope: "buildings", buildings: [{ rsn: RSN, floors: [FLOOR] }], groups: [], types: ["power"] };

/** A confirmed subscriber in the building, in English. */
async function subscribers(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const id = randomUUID();
    phoneCounter += 1;
    await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
      values (${id}, ${`+1416555${String(phoneCounter).padStart(4, "0")}`}, 'en', 'TP', ${[]}, '2026-10-01.1', 'web', 'active')`;
    await owner`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${RSN}, ${FLOOR})`;
  }
}

const contentOf = (): EntryContent => ({ text: "Power is out in the building. We are finding out more.", types: ["power"], audience, phase: "problem", validUntil: inDays(1) });

/** A first entry, submitted and waiting for approval (frozen as a real submit freezes it). Returns the entry and the cost of ONE English text in cents. */
async function pendingAck(): Promise<{ ref: EntryRef; frozen: FrozenContent; textCents: number }> {
  const created = await alerting.createAlert(actor(author), { kind: "ack", isDrill: false, reportedAt: new Date(NOW.getTime() - 60_000), content: contentOf() });
  if (!created.ok) throw new Error(`createAlert refused: ${created.error}`);
  const ref = { alertId: created.value.thread.id, entryId: created.value.entry.id };
  const entry = await alerting.getEntry(ref);
  const thread = await alerting.getThread(ref.alertId);
  if (!entry || !thread) throw new Error("no such entry");
  const frozen = freezeContent({
    alertId: ref.alertId,
    kind: "ack",
    supersedesId: null,
    isDrill: false,
    channels: ["sms", "web"],
    content: entry.content,
    translations: [
      { lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "m1", status: "translated", sourceHash: sha(entry.content.text) },
      { lang: "es", body: "Sin luz.", machine: true, model: "m1", status: "translated", sourceHash: sha(entry.content.text) },
      ...["ps", "ta", "fr", "hi", "pa"].map((lang) => ({ lang, body: entry.content.text, machine: false, model: null, status: "fallback_en" as const, sourceHash: sha(entry.content.text) })),
    ],
    verified: true,
    attribution: { role: "hub" },
    slug: thread.slug,
    publicBaseUrl: BASE_URL,
  });
  if (!frozen.ok) throw new Error(`freeze refused: ${frozen.error}`);
  const submitted = await seams.freeze(actor(author), ref, frozen.value);
  if (!submitted.ok) throw new Error(`submit refused: ${submitted.error}`);
  return { ref, frozen: frozen.value, textCents: Math.ceil(frozen.value.smsBodies.en.segments * PRICE) };
}

/** What the approver is shown, then approves (exactly what the screen does). */
async function approve(ref: EntryRef) {
  const review = await alerting.review(ref);
  if (!review) throw new Error("nothing to review");
  const [row] = await owner<{ version: number; content_hash: string }[]>`select version, content_hash from alert_entry where id = ${ref.entryId}`;
  return alerting.approveEntry(actor(approver), ref, { version: row!.version, contentHash: row!.content_hash, recipients: { total: review.recipients.total, byLanguage: review.recipients.byLanguage } });
}

/** `cents` of text message spending already made this month (one estimate at `NOW`). */
async function spendAlready(cents: number, at: Date = NOW) {
  await recordSmsEstimate(app, { deliveryId: randomUUID(), entryId: null, lang: "en", isDrill: false, segments: 1, costCents: cents, purpose: "transactional", at });
}

const setCap = (cents: number | null) =>
  cents === null
    ? owner`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`
    : owner`update spend_cap set monthly_cents = ${cents}, set_by = ${admin.id}, set_at = now() where id = 1`;

const auditOf = (action: string) => owner<{ actor_staff_id: string | null; subject_type: string; subject_id: string; outcome: string; meta: Record<string, unknown> }[]>`
  select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = ${action} order by id`;
const opsOf = () => owner<{ kind: string; severity: string; subject_type: string | null; subject_id: string | null; detail: Record<string, unknown> }[]>`
  select kind, severity, subject_type, subject_id, detail from ops_event where kind = 'spend.cap_overrun' order by id`;
const queuedFor = async (entryId: string) => (await owner<{ state: string; cost: number }[]>`select state, cost_estimate_cents as cost from delivery where entry_id = ${entryId}`);

// --- the table --------------------------------------------------------------------------------------------------------------------------------------

describe("the spend_cap row", () => {
  it("is one row, made by the migration, with no cap set", async () => {
    expect(await owner`select id, monthly_cents, set_by, set_at from spend_cap`).toEqual([{ id: 1, monthly_cents: null, set_by: null, set_at: null }]);
    expect(await readSpendCap(app)).toEqual({ monthlyCents: null, setBy: null, setAt: null });
  });

  it("can be read and changed by the app's role in its three columns, and cannot be added to, deleted, re-numbered or opened to anon and authenticated", async () => {
    await expect(appSql`select monthly_cents from spend_cap`).resolves.toHaveLength(1);
    await expect(appSql`update spend_cap set monthly_cents = 5000, set_by = ${admin.id}, set_at = now() where id = 1`).resolves.toBeDefined();
    await expect(appSql`insert into spend_cap (id) values (2)`).rejects.toThrow(/permission denied/);
    await expect(appSql`delete from spend_cap`).rejects.toThrow(/permission denied/);
    await expect(appSql`update spend_cap set id = 2`).rejects.toThrow(/permission denied/);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [grants] = await owner`select has_table_privilege(${role}, 'spend_cap', 'select') as read, has_table_privilege(${role}, 'spend_cap', 'update') as write`;
      expect(grants, role).toEqual({ read: false, write: false });
    }
    expect((await owner`select relrowsecurity from pg_class where relname = 'spend_cap'`)[0]?.relrowsecurity).toBe(true);
    const policies = await owner`select policyname, roles::text as roles from pg_policies where tablename = 'spend_cap' order by policyname`;
    expect(policies).toEqual([
      { policyname: "spend_cap_app_select", roles: "{cvh_app}" },
      { policyname: "spend_cap_app_update", roles: "{cvh_app}" },
    ]);
  });

  it("refuses a cap that is not between one cent and CAD 100,000, and one that does not say who set it and when", async () => {
    await expect(owner`update spend_cap set monthly_cents = 0, set_by = ${admin.id}, set_at = now()`).rejects.toThrow(/spend_cap_amount_valid/);
    await expect(owner`update spend_cap set monthly_cents = 10000001, set_by = ${admin.id}, set_at = now()`).rejects.toThrow(/spend_cap_amount_valid/);
    await expect(owner`update spend_cap set monthly_cents = 5000`).rejects.toThrow(/spend_cap_stated/);
    await expect(owner`update spend_cap set set_by = ${admin.id}`).rejects.toThrow(/spend_cap_stated/);
    await expect(owner`update spend_cap set monthly_cents = 5000, set_by = ${randomUUID()}, set_at = now()`).rejects.toThrow(/spend_cap_set_by_fkey/);
    await owner`update spend_cap set monthly_cents = 1, set_by = ${admin.id}, set_at = now()`;
    await owner`update spend_cap set monthly_cents = 10000000, set_by = ${admin.id}, set_at = now()`;
  });
});

// --- setting the cap --------------------------------------------------------------------------------------------------------------------------------

describe("an Admin sets the monthly cap", () => {
  it("saves it with who set it and when, and audits it in the same transaction with the cap afterwards", async () => {
    const outcome = await caps().set({ actorStaffId: admin.id, amount: "250.50" });
    expect(outcome).toEqual({ kind: "set", capCents: 25_050, previousCents: null });
    const row = await readSpendCap(app);
    expect(row).toMatchObject({ monthlyCents: 25_050, setBy: admin.id });
    expect(row.setAt).toBeInstanceOf(Date);
    expect(await auditOf("spend.cap_set")).toEqual([{ actor_staff_id: admin.id, subject_type: "spend_cap", subject_id: "1", outcome: "ok", meta: { cap_cents: 25_050 } }]);
  });

  it("audits a change with the cap it replaced, and is read at once by the next approval", async () => {
    await caps().set({ actorStaffId: admin.id, amount: "100" });
    const other = await world.fx.staff("admin");
    expect(await caps().set({ actorStaffId: other.id, amount: "$1,000" })).toEqual({ kind: "set", capCents: 100_000, previousCents: 10_000 });
    expect(await readSpendCap(app)).toMatchObject({ monthlyCents: 100_000, setBy: other.id });
    expect((await auditOf("spend.cap_set")).map((row) => [row.actor_staff_id, row.meta])).toEqual([
      [admin.id, { cap_cents: 10_000 }],
      [other.id, { cap_cents: 100_000, previous_cents: 10_000 }],
    ]);
  });

  it.each([
    ["", "missing"],
    ["lots", "not_a_number"],
    ["0", "too_small"],
    ["100000.01", "too_large"],
  ])("refuses %j (%s), audits the refusal with its reason only, and changes nothing", async (amount, problem) => {
    await caps().set({ actorStaffId: admin.id, amount: "100" });
    expect(await caps().set({ actorStaffId: admin.id, amount })).toEqual({ kind: "refused", problem });
    expect((await readSpendCap(app)).monthlyCents).toBe(10_000);
    expect((await auditOf("spend.cap_set")).at(-1)).toMatchObject({ outcome: "refused", meta: { reason: "validation" } });
  });

  it("does not set a cap that cannot be audited: the audit write fails, the transaction rolls back, and the cap is as it was", async () => {
    const failing = createSpendCap({
      db: app,
      audit: {
        record: async () => {
          throw new Error("the audit write failed");
        },
        recordRefusal: async () => {},
      },
    });
    await expect(failing.set({ actorStaffId: admin.id, amount: "500" })).rejects.toThrow("the audit write failed");
    expect(await readSpendCap(app)).toEqual({ monthlyCents: null, setBy: null, setAt: null });
  });

  it("refuses an actor that is not a staff account (the foreign key) and audits nothing as ok", async () => {
    await expect(caps().set({ actorStaffId: randomUUID(), amount: "500" })).rejects.toThrow();
    expect(await readSpendCap(app)).toEqual({ monthlyCents: null, setBy: null, setAt: null });
    expect(await auditOf("spend.cap_set")).toEqual([]);
  });

  it("serialises two Admins who press at once: both are applied one after the other and the second names the first as the one it replaced", async () => {
    const other = await world.fx.staff("admin");
    const results = await Promise.all([caps().set({ actorStaffId: admin.id, amount: "100" }), caps().set({ actorStaffId: other.id, amount: "200" })]);
    expect(results.every((result) => result.kind === "set")).toBe(true);
    const audits = await auditOf("spend.cap_set");
    expect(audits).toHaveLength(2);
    const [first, second] = audits;
    expect(first.meta).not.toHaveProperty("previous_cents");
    expect(second.meta.previous_cents).toBe(first.meta.cap_cents);
    expect((await readSpendCap(app)).monthlyCents).toBe(second.meta.cap_cents);
  });
});

// --- the month in Toronto ---------------------------------------------------------------------------------------------------------------------------

describe("the month boundary in America/Toronto", () => {
  // A text counted at 23:59 on a month's last day and one at 00:01 on its first day fall in different months, in daylight time, in standard time, and across the changes of clock.
  it.each([
    ["31 October to 1 November 2026, the night clocks go back", "2026-11-01T03:59:00Z", "2026-11-01T04:01:00Z", "2026-10", "2026-11"],
    ["31 January to 1 February 2027, standard time", "2027-02-01T04:59:00Z", "2027-02-01T05:01:00Z", "2027-01", "2027-02"],
    ["31 March to 1 April 2027, after clocks went forward", "2027-04-01T03:59:00Z", "2027-04-01T04:01:00Z", "2027-03", "2027-04"],
    ["30 June to 1 July 2027, daylight time", "2027-07-01T03:59:00Z", "2027-07-01T04:01:00Z", "2027-06", "2027-07"],
    ["31 December 2026 to 1 January 2027, the year's turn", "2027-01-01T04:59:00Z", "2027-01-01T05:01:00Z", "2026-12", "2027-01"],
  ])("%s", async (_name, before, after, earlier, later) => {
    await spendAlready(300, new Date(before));
    await spendAlready(7, new Date(after));
    // "Now" is mid-month in each month: the month's total is only the text that fell in it.
    expect(await monthSpentCents(app, new Date(`${earlier}-15T17:00:00Z`))).toBe(300);
    expect(await monthSpentCents(app, new Date(`${later}-15T17:00:00Z`))).toBe(7);
    expect((await smsMonthReport(app, earlier)).countedCents).toBe(300);
    expect((await smsMonthReport(app, later)).countedCents).toBe(7);
  });

  it("counts the very first and the very last instant of the month in that month", async () => {
    await spendAlready(5, new Date("2026-10-01T04:00:00Z"));
    await spendAlready(11, new Date("2026-11-01T03:59:59.999Z"));
    await spendAlready(1_000, new Date("2026-11-01T04:00:00Z"));
    await spendAlready(2_000, new Date("2026-10-01T03:59:59.999Z"));
    expect(await monthSpentCents(app, new Date("2026-10-20T12:00:00Z"))).toBe(16);
    expect(await monthSpentCents(app, new Date("2026-11-20T12:00:00Z"))).toBe(1_000);
  });
});

// --- the real approval path -------------------------------------------------------------------------------------------------------------------------

describe("approving an alert near the cap", () => {
  const SUBSCRIBERS = 3;

  it.each([
    ["exactly at the cap", 0],
    ["just under the cap", 1],
  ])("is within the cap when the month ends %s: nothing is audited or recorded", async (_name, slack) => {
    await subscribers(SUBSCRIBERS);
    const { ref, textCents } = await pendingAck();
    const entryCents = SUBSCRIBERS * textCents;
    await spendAlready(5_000);
    await setCap(5_000 + entryCents + slack);
    const approved = await approve(ref);
    expect(approved.ok).toBe(true);
    expect(await queuedFor(ref.entryId)).toHaveLength(SUBSCRIBERS);
    expect(await auditOf("spend.cap_overrun")).toEqual([]);
    expect(await opsOf()).toEqual([]);
  });

  it("is approved all the same when the month ends just over the cap, with the overrun audited and recorded for the health job, the shortfall exact", async () => {
    await subscribers(SUBSCRIBERS);
    const { ref, textCents } = await pendingAck();
    const entryCents = SUBSCRIBERS * textCents;
    await spendAlready(5_000);
    await setCap(5_000 + entryCents - 1);

    const approved = await approve(ref);

    // Never blocked: the entry is approved and every subscriber's text is queued.
    expect(approved.ok).toBe(true);
    expect((await owner`select status from alert_entry where id = ${ref.entryId}`)[0]?.status).toBe("approved");
    const texts = await queuedFor(ref.entryId);
    expect(texts).toHaveLength(SUBSCRIBERS);
    expect(texts.reduce((sum, text) => sum + text.cost, 0)).toBe(entryCents);
    expect(texts.every((text) => text.state === "queued")).toBe(true);
    // Audited as an overrun by the approver, on the entry, with the amounts and nothing else.
    expect(await auditOf("spend.cap_overrun")).toEqual([
      { actor_staff_id: approver.id, subject_type: "alert_entry", subject_id: ref.entryId, outcome: "ok", meta: { over_cents: 1, cap_cents: 5_000 + entryCents - 1, entry_cents: entryCents } },
    ]);
    // ... and the ops event the health job reads.
    expect(await opsOf()).toEqual([{ kind: "spend.cap_overrun", severity: "warning", subject_type: "alert_entry", subject_id: ref.entryId, detail: { over_cents: 1 } }]);
  });

  it("judges a withdrawal's approval too, with the cap still the last row taken: the thread closes withdrawn and the overrun is audited", async () => {
    await subscribers(SUBSCRIBERS);
    const { ref } = await pendingAck();
    expect((await approve(ref)).ok).toBe(true);
    const made = await alerting.withdrawEntry(actor(author), { alertId: ref.alertId, targetId: ref.entryId }, { entryId: randomUUID(), reason: "other", text: "Sent for the wrong building." });
    if (!made.ok) throw new Error(`withdrawEntry refused: ${made.error}`);
    const withdrawal = { alertId: ref.alertId, entryId: made.value.entry.id };
    const entry = await alerting.getEntry(withdrawal);
    const thread = await alerting.getThread(ref.alertId);
    if (!entry || !thread) throw new Error("no such entry");
    const frozen = freezeContent({
      alertId: ref.alertId,
      kind: "withdrawal",
      supersedesId: ref.entryId,
      isDrill: false,
      channels: ["sms", "web"],
      content: entry.content,
      translations: ["ur", "es", "ps", "ta", "fr", "hi", "pa"].map((lang) => ({ lang, body: entry.content.text, machine: false, model: null, status: "fallback_en" as const, sourceHash: sha(entry.content.text) })),
      verified: true,
      attribution: { role: "hub" },
      slug: thread.slug,
      publicBaseUrl: BASE_URL,
    });
    if (!frozen.ok) throw new Error(`freeze refused: ${frozen.error}`);
    const submitted = await seams.freeze(actor(author), withdrawal, frozen.value);
    if (!submitted.ok) throw new Error(`submit refused: ${submitted.error}`);
    await setCap(1);

    expect((await approve(withdrawal)).ok).toBe(true);

    expect((await owner`select status, closed_reason from alert where id = ${ref.alertId}`)[0]).toMatchObject({ closed_reason: "withdrawn" });
    expect((await auditOf("spend.cap_overrun")).map((row) => row.subject_id)).toEqual([withdrawal.entryId]);
  });

  it("states a larger shortfall as the whole amount over the cap", async () => {
    await subscribers(SUBSCRIBERS);
    const { ref, textCents } = await pendingAck();
    await spendAlready(9_000);
    await setCap(5_000);
    expect((await approve(ref)).ok).toBe(true);
    expect((await auditOf("spend.cap_overrun"))[0]?.meta).toEqual({ over_cents: 9_000 + SUBSCRIBERS * textCents - 5_000, cap_cents: 5_000, entry_cents: SUBSCRIBERS * textCents });
  });

  it("asks nothing and records nothing while no cap is set, however much the month has spent", async () => {
    await subscribers(SUBSCRIBERS);
    const { ref } = await pendingAck();
    await spendAlready(5_000_000);
    expect((await approve(ref)).ok).toBe(true);
    expect(await auditOf("spend.cap_overrun")).toEqual([]);
    expect(await opsOf()).toEqual([]);
  });

  it("counts only this Toronto month's spending: a month past the cap that has ended does not count", async () => {
    await subscribers(SUBSCRIBERS);
    const { ref, textCents } = await pendingAck();
    const lastMonth = new Date(NOW.getTime() - 40 * 86_400_000);
    await spendAlready(1_000_000, lastMonth);
    await setCap(SUBSCRIBERS * textCents);
    expect((await approve(ref)).ok).toBe(true);
    expect(await auditOf("spend.cap_overrun")).toEqual([]);
  });

  it("counts the texts still waiting to be sent, so a second approval before the first has gone out is judged against both", async () => {
    await subscribers(SUBSCRIBERS);
    const first = await pendingAck();
    const second = await pendingAck();
    const each = SUBSCRIBERS * first.textCents;
    await setCap(2 * each);
    expect((await approve(first.ref)).ok).toBe(true);
    // Nothing has been sent yet: the first entry's texts are queued and not in the month's spending.
    expect(await monthSpentCents(app, NOW)).toBe(0);
    expect(await queuedCostCents(app)).toBe(each);
    expect(await queuedCostCents(app, { exceptEntryId: first.ref.entryId })).toBe(0);
    expect((await approve(second.ref)).ok).toBe(true);
    expect(await auditOf("spend.cap_overrun")).toEqual([]);

    // A third one takes the month past what the two queued entries already use.
    const third = await pendingAck();
    expect((await approve(third.ref)).ok).toBe(true);
    expect((await auditOf("spend.cap_overrun")).map((row) => row.meta)).toEqual([{ over_cents: each, cap_cents: 2 * each, entry_cents: each }]);
  });

  it("does not count a text twice once it has gone out: queued, then sent, the month is the same", async () => {
    await subscribers(SUBSCRIBERS);
    const first = await pendingAck();
    const each = SUBSCRIBERS * first.textCents;
    expect((await approve(first.ref)).ok).toBe(true);
    const beforeSending = (await monthSpentCents(app, NOW)) + (await queuedCostCents(app));
    // The sender hands the texts over and counts them when the provider accepts them.
    for (let run = 0; run < 10 && (await queuedCostCents(app)) > 0; run += 1) await world.dispatcher({ ...spendSeams }).run();
    expect(await queuedCostCents(app)).toBe(0);
    expect(await monthSpentCents(app, NOW)).toBe(beforeSending);
    expect(beforeSending).toBe(each);
  });

  it("takes the cap's lock last: two approvals at once are judged one after the other, so exactly one of them passes a cap only one fits under", async () => {
    await subscribers(SUBSCRIBERS);
    const first = await pendingAck();
    const second = await pendingAck();
    const each = SUBSCRIBERS * first.textCents;
    await setCap(each);
    const results = await Promise.all([approve(first.ref), approve(second.ref)]);
    expect(results.every((result) => result.ok)).toBe(true);
    const overruns = await auditOf("spend.cap_overrun");
    expect(overruns).toHaveLength(1);
    expect(overruns[0]?.meta).toEqual({ over_cents: each, cap_cents: each, entry_cents: each });
    expect(await opsOf()).toHaveLength(1);
  });

  it("does not warn for an entry nobody is texted for, and does not make an approval wait on the cap", async () => {
    const { ref } = await pendingAck();
    await spendAlready(9_999_999);
    await setCap(1);
    expect((await approve(ref)).ok).toBe(true);
    expect(await queuedFor(ref.entryId)).toEqual([]);
    expect(await auditOf("spend.cap_overrun")).toEqual([]);
  });
});

// --- the health job texts the on-call Admins ---------------------------------------------------------------------------------------------------------

describe("an overrun reaches the on-call Admins as a transactional text", () => {
  it("is texted once by the health job to every on-call number, and the approval's own text queue is not held", async () => {
    await subscribers(2);
    const roster = createOncallRoster({
      db: app,
      audit: auditTrail as never,
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
    });
    await roster.add({ actorStaffId: admin.id, label: "IT lead", number: "416-555-0123" });
    await owner`update dispatcher_lease set renewed_at = now() where id = 1`;
    const queue = createDeliveryQueue();
    const job = createHealthJob({
      db: app,
      sender: createSenderHealth(),
      enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
      pricePerSegmentCents: () => PRICE,
      transactionalDailyCeiling: () => 1000,
      lastPublishedAt: (executor) => lastPublishedAt(executor),
      logError: () => {},
    });

    const { ref } = await pendingAck();
    await setCap(1);
    expect((await approve(ref)).ok).toBe(true);
    await job.run();

    const texts = await owner<{ kind: string; purpose: string | null; recipient_kind: string; body: string }[]>`
      select kind, purpose, recipient_kind, body from delivery where recipient_kind = 'oncall'`;
    expect(texts).toEqual([{ kind: "transactional", purpose: "oncall_alert", recipient_kind: "oncall", body: oncallText("cap_overrun", 1) }]);
    // A second run for the same overrun texts nobody again.
    await job.run();
    expect(await owner`select 1 from delivery where recipient_kind = 'oncall'`).toHaveLength(1);
  });
});

// --- a text counted once ----------------------------------------------------------------------------------------------------------------------------

describe("a retried text is counted once in the month", () => {
  const dispatcher = () => world.dispatcher({ ...spendSeams });
  const answerTooMany = { kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too Many Requests" } as const;

  it("429 and then accepted: nothing is counted for the try that was turned away, and the text is counted once when the provider accepts it", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer((_submission, call) => (call === 1 ? answerTooMany : { kind: "accepted", httpStatus: 201, status: "queued", messageId: `SM${String(call).padStart(32, "0")}` }));
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("queued");
    expect(await monthSpentCents(app, NOW)).toBe(0);
    // It is still waiting, and the cap still counts it as waiting.
    expect(await queuedCostCents(app)).toBe(2);
    world.clock.advance(31_000);
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("submitted");
    expect(world.provider.calls).toHaveLength(2);
    expect(await monthSpentCents(app, NOW)).toBe(2);
    expect(await queuedCostCents(app)).toBe(0);
    // A later run, and a sweep, count it no more.
    world.clock.advance(6 * 60_000);
    await dispatcher().run();
    expect(await monthSpentCents(app, NOW)).toBe(2);
  });

  it("429 three times and then failed: it was never accepted, so it is never counted, and it stops being waiting", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(answerTooMany);
    for (const waitMs of [0, 31_000, 121_000, 601_000]) {
      world.clock.advance(waitMs);
      await dispatcher().run();
    }
    expect(await world.stateOf(id)).toBe("failed");
    expect(world.provider.calls).toHaveLength(4);
    expect(await monthSpentCents(app, NOW)).toBe(0);
    expect(await queuedCostCents(app)).toBe(0);
    expect(await owner`select 1 from spend_event where kind = 'sms'`).toHaveLength(0);
  });

  it("an outcome of unknown is counted once (the text may have been charged), and a sweep that finds it again counts it no more", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer({ kind: "no_answer", reason: "timeout" });
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    expect(await monthSpentCents(app, NOW)).toBe(2);
    world.clock.advance(25 * 3_600_000);
    await dispatcher().run();
    expect(await monthSpentCents(app, NOW)).toBe(2);
  });
});

// --- the sender is never held back by the cap -------------------------------------------------------------------------------------------------------

describe("the cap never holds back a text", () => {
  // A STOP is answered by Twilio's own opt-out reply and the app deletes what it holds for the number (test/db/inbound.db.test.ts: "nothing sent"); the cap is read in
  // exactly one place, the approval's transaction, so neither can be held by it. What the app does send is held by nothing but the pause.
  it("hands over an on-call text and a reply to a resident with the month far past the cap", async () => {
    await setCap(1);
    await spendAlready(1_000_000);
    const [oncall] = await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    const [reply] = await world.seedTransactional(1, { purpose: "menu_reply" });
    await world.dispatcher({ ...spendSeams }).run();
    expect(await world.stateOf(oncall)).toBe("submitted");
    expect(await world.stateOf(reply)).toBe("submitted");
    expect(world.provider.calls).toHaveLength(2);
  });

  it("hands over the texts of an alert approved over the cap", async () => {
    await subscribers(2);
    const { ref } = await pendingAck();
    await setCap(1);
    expect((await approve(ref)).ok).toBe(true);
    expect(await auditOf("spend.cap_overrun")).toHaveLength(1);
    for (let run = 0; run < 10 && (await queuedCostCents(app)) > 0; run += 1) await world.dispatcher({ ...spendSeams }).run();
    expect((await queuedFor(ref.entryId)).map((text) => text.state)).toEqual(["submitted", "submitted"]);
  });
});

// --- the view ---------------------------------------------------------------------------------------------------------------------------------------

describe("the spend view's figures", () => {
  it("sets the month and the pilot against the budget, with a month that is not reconciled labelled and its estimates counted", async () => {
    const lastMonth = new Date(NOW.getTime() - 40 * 86_400_000);
    await spendAlready(400, lastMonth);
    await spendAlready(250, NOW);
    await setCap(1_000);
    const overview = await readSpendOverview(app, { now: NOW, budgetCents: 100_000, cohereEstimateCadPerMillionTokens: null });
    expect(overview.thisMonth.sms.countedCents).toBe(250);
    expect(overview.pilot.sms.countedCents).toBe(650);
    expect(overview.pilot.sms.pendingMonths.map((month) => month.estimatedCents).sort()).toEqual([250, 400]);
    expect(overview).toMatchObject({ budgetCents: 100_000, remainingCents: 100_000 - 650, capCents: 1_000, capUsedPercent: 25 });
  });

  it("shows Cohere usage without a price as unknown with its units, and at an estimate only when a rate is configured, never as zero", async () => {
    await owner`insert into spend_event (at, kind, purpose, model, calls, tokens, tokens_estimated) values (${NOW}, 'embed', 'search', 'embed-v4.0', 3, 1200000, true)`;
    await owner`insert into spend_event (at, kind, purpose, model, calls, tokens, price_per_million_tokens_cad) values (${NOW}, 'translate', 'alert', 'command-a', 1, 2000000, 0.5)`;
    const unknown = await readSpendOverview(app, { now: NOW, budgetCents: 100_000, cohereEstimateCadPerMillionTokens: null });
    expect(unknown.thisMonth.cohere).toMatchObject({
      calls: 4,
      tokensEstimated: true,
      priced: { calls: 1, cents: 100 },
      unpriced: { calls: 3, tokens: 1_200_000, estimateCents: null, label: "price unknown" },
    });
    expect(unknown.thisMonth).toMatchObject({ totalCents: 100, incomplete: true });
    const estimated = await readSpendOverview(app, { now: NOW, budgetCents: 100_000, cohereEstimateCadPerMillionTokens: 1 });
    expect(estimated.thisMonth.cohere.unpriced).toMatchObject({ estimateCents: 120, label: "estimate" });
    expect(estimated.thisMonth).toMatchObject({ totalCents: 220, incomplete: false });
  });
});
