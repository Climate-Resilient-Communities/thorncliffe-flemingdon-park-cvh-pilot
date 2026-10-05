// How far corrections, withdrawals and finals reached, and what each alert cost, against a real database (S07.10, FR-M4, FR-M5): the SQL views
// `correction_reach`, `alert_cost` and `cohere_alert_share`, read as the app's role.
//  - reach: attempted and confirmed reach against the original's recipients with S06.08's definitions (a recipient counted once; a cancelled or skipped text is
//    not attempted; a recipient deleted since cannot be matched), for a correction, a withdrawal and a final (the union of the thread), drills apart;
//  - cost: SMS cost per alert entry and language, the actual where the provider reported one and a labelled estimate otherwise, drills apart, the small-number
//    rule applied (a cell of fewer than 5 texts has no amount, a second cell hidden when one would be revealed);
//  - Cohere: the alerts' share of the vendor's usage, an unknown price shown as unknown;
//  - no personal data: the views' columns hold no number, recipient id or body, and the client roles cannot read them.
// Nothing reaches a provider: the dispatcher runs against a fake. Every number is fictional.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { readCorrectionReach } from "../../src/modules/messaging";
import { readAlertCost, readCohereShare, recordSmsEstimate, recordSpendEvent } from "../../src/modules/spend";
import { createDb, type Db } from "../../src/platform/db";
import { dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
/** Entries moved into another thread (a correction replaces an entry of its own thread): they go first when the fixtures are removed. */
let moved: string[] = [];
let madeNeighbourhood = false;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 4, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H')`;
    madeNeighbourhood = true;
  }
});

async function clear() {
  await owner.unsafe("delete from sms_estimate_retirement");
  await owner.unsafe("delete from sms_actual");
  await owner.unsafe("delete from sms_reconciliation");
  await owner.unsafe("delete from spend_event");
  await owner`delete from delivery`;
  if (moved.length > 0) {
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      for (const id of moved) await tx`delete from alert_entry where id = ${id}`;
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    moved = [];
  }
  await owner`delete from subscriber where phone like '+1416555%'`;
  await world.reset();
}

beforeEach(clear);
afterAll(async () => {
  await clear();
  if (madeNeighbourhood) await owner`delete from neighbourhood where id = 'TP'`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

// --- helpers --------------------------------------------------------------------------------------------------------

const dispatcher = () => world.dispatcher();
const deliver = async (id: string) => {
  await appSql`update delivery set state = 'delivered' where id = ${id}`;
};
const ids = (count: number) => Array.from({ length: count }, () => randomUUID());

/**
 * An entry of `kind` that joins the thread of `thread`: the fixtures make a thread for each entry, so the entry is moved into the other one and, for a
 * correction or a withdrawal, made to replace `thread`'s entry (or `replaces`).
 */
async function joinThread(entryId: string, thread: { alertId: string; entryId: string }, replaces: string | null = thread.entryId) {
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`update alert_entry set alert_id = ${thread.alertId}, supersedes_id = ${replaces} where id = ${entryId}`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  moved.push(entryId);
}

async function reachOf(entryId: string) {
  const report = await readCorrectionReach(app, 50);
  return [...report.real, ...report.drills].find((row) => row.entryId === entryId);
}

// --- reach ------------------------------------------------------------------------------------------------------------

describe("how far a correction, a withdrawal and a final reached", () => {
  it("reports attempted reach (original's recipients whose correction text was handed off) apart from confirmed reach (delivered), once per recipient", async () => {
    const recipients = ids(10);
    const original = await world.seedAlert({ recipients });
    await dispatcher().run();
    for (const id of original.ids) await deliver(id);
    // The correction goes to every recipient of the original and to one newcomer; one text is cancelled before it is handed off.
    const correction = await world.seedAlert({ recipients: [...recipients, randomUUID()], kind: "correction" });
    await joinThread(correction.entry.entryId, original.entry);
    await appSql`update delivery set state = 'cancelled' where id = ${correction.ids[9]}`;
    await dispatcher().run();
    for (const id of correction.ids.slice(0, 7)) await deliver(id);

    expect(await reachOf(correction.entry.entryId)).toMatchObject({
      kind: "correction",
      originalRecipients: { n: 10, shown: "10" },
      attemptedReach: { n: 9, shown: "9" },
      confirmedReach: { n: 7, shown: "7" },
      attemptedPercent: 90,
      confirmedPercent: 70,
    });
  });

  it("shows a reach of 1 to 4 as 'fewer than 5' and gives no percentage from it", async () => {
    const recipients = ids(10);
    const original = await world.seedAlert({ recipients });
    await dispatcher().run();
    const correction = await world.seedAlert({ recipients, kind: "correction" });
    await joinThread(correction.entry.entryId, original.entry);
    await dispatcher().run();
    for (const id of correction.ids.slice(0, 3)) await deliver(id);
    expect(await reachOf(correction.entry.entryId)).toMatchObject({
      originalRecipients: { n: 10, shown: "10" },
      attemptedReach: { n: 10, shown: "10" },
      confirmedReach: { n: null, shown: "fewer than 5" },
      attemptedPercent: 100,
      confirmedPercent: null,
    });
    // An original with fewer than 5 recipients hides the denominator and with it every percentage.
    const small = ids(3);
    const smallOriginal = await world.seedAlert({ recipients: small });
    const smallWithdrawal = await world.seedAlert({ recipients: small, kind: "withdrawal" });
    await joinThread(smallWithdrawal.entry.entryId, smallOriginal.entry);
    await dispatcher().run();
    expect(await reachOf(smallWithdrawal.entry.entryId)).toMatchObject({
      kind: "withdrawal",
      originalRecipients: { n: null, shown: "fewer than 5" },
      attemptedReach: { n: null, shown: "fewer than 5" },
      confirmedReach: { n: 0, shown: "0" },
      attemptedPercent: null,
      confirmedPercent: null,
    });
  });

  it("measures a withdrawal against the entry it withdraws", async () => {
    const recipients = ids(6);
    const original = await world.seedAlert({ recipients });
    await dispatcher().run();
    const withdrawal = await world.seedAlert({ recipients, kind: "withdrawal" });
    await joinThread(withdrawal.entry.entryId, original.entry);
    await dispatcher().run();
    for (const id of withdrawal.ids) await deliver(id);
    expect(await reachOf(withdrawal.entry.entryId)).toMatchObject({
      kind: "withdrawal",
      originalRecipients: { n: 6, shown: "6" },
      attemptedReach: { n: 6, shown: "6" },
      confirmedReach: { n: 6, shown: "6" },
      attemptedPercent: 100,
      confirmedPercent: 100,
    });
  });

  it("measures a final against the union of the recipients of every other entry of its thread", async () => {
    const first = ids(6);
    const second = ids(5);
    const original = await world.seedAlert({ recipients: first });
    const update = await world.seedAlert({ recipients: second, kind: "update" });
    await joinThread(update.entry.entryId, original.entry, null);
    const everyone = [...first, ...second];
    const final = await world.seedAlert({ recipients: everyone, kind: "final" });
    await joinThread(final.entry.entryId, original.entry, null);
    await dispatcher().run();
    for (const id of final.ids.slice(0, 8)) await deliver(id);
    expect(await reachOf(final.entry.entryId)).toMatchObject({
      kind: "final",
      originalRecipients: { n: 11, shown: "11" },
      attemptedReach: { n: 11, shown: "11" },
      confirmedReach: { n: 8, shown: "8" },
      attemptedPercent: 100,
      confirmedPercent: 72,
    });
    // The acknowledgement and the update are not corrections, withdrawals or finals: they are not in the view.
    expect(await reachOf(original.entry.entryId)).toBeUndefined();
    expect(await reachOf(update.entry.entryId)).toBeUndefined();
  });

  it("counts the original's recipients whatever became of their text, and leaves out a recipient deleted since", async () => {
    const gone = [randomUUID(), randomUUID()];
    for (const [index, id] of gone.entries()) {
      await owner`insert into subscriber (id, phone, lang, neighbourhood_id, consent_version, started_by) values (${id}, ${`+14165557${String(index).padStart(3, "0")}`}, 'en', 'TP', '2026-10-02.1', 'web')`;
    }
    const stays = ids(8);
    const recipients = [...stays, ...gone];
    const original = await world.seedAlert({ recipients });
    // Two of the original's texts never went out (cancelled): they are still the original's recipients.
    await appSql`update delivery set state = 'cancelled' where id = ${original.ids[0]}`;
    await appSql`update delivery set state = 'skipped' where id = ${original.ids[1]}`;
    const correction = await world.seedAlert({ recipients, kind: "correction" });
    await joinThread(correction.entry.entryId, original.entry);
    await dispatcher().run();
    for (const id of correction.ids) await deliver(id);
    // The two recipients delete themselves (STOP): their rows forget them and cannot be matched.
    await owner`delete from subscriber where id = any(${gone})`;
    const reach = await reachOf(correction.entry.entryId);
    expect(reach).toMatchObject({ originalRecipients: { n: 8, shown: "8" }, attemptedReach: { n: 8, shown: "8" } });
  });

  it("reports a drill's corrections apart from real ones and never adds them", async () => {
    const real = ids(6);
    const realOriginal = await world.seedAlert({ recipients: real });
    const realCorrection = await world.seedAlert({ recipients: real, kind: "correction" });
    await joinThread(realCorrection.entry.entryId, realOriginal.entry);
    const members = ids(2);
    const drillOriginal = await world.seedAlert({ isDrill: true, recipients: members });
    const drillCorrection = await world.seedAlert({ isDrill: true, recipients: members, kind: "correction" });
    await joinThread(drillCorrection.entry.entryId, drillOriginal.entry);
    await dispatcher().run();
    const report = await readCorrectionReach(app, 50);
    expect(report.real.map((row) => row.entryId)).toEqual([realCorrection.entry.entryId]);
    expect(report.drills.map((row) => row.entryId)).toEqual([drillCorrection.entry.entryId]);
    expect(report.real[0]).toMatchObject({ originalRecipients: { n: 6, shown: "6" } });
    expect(report.drills[0]).toMatchObject({ originalRecipients: { n: null, shown: "fewer than 5" } });
  });

  it("holds no personal data: no number, recipient id or message body, and no client role can read it", async () => {
    const recipients = ids(6);
    const original = await world.seedAlert({ recipients });
    const correction = await world.seedAlert({ recipients, kind: "correction" });
    await joinThread(correction.entry.entryId, original.entry);
    await dispatcher().run();
    const columns = (await owner`select column_name from information_schema.columns where table_name = 'correction_reach' order by ordinal_position`).map((row) => row.column_name);
    expect(columns).toEqual([
      "entry_id", "alert_id", "kind", "is_drill", "approved_at", "original_recipients", "original_recipients_shown", "attempted_reach", "attempted_reach_shown",
      "confirmed_reach", "confirmed_reach_shown", "attempted_percent", "confirmed_percent",
    ]);
    const everything = JSON.stringify(await readCorrectionReach(app, 50)) + JSON.stringify(await owner`select * from correction_reach`);
    for (const recipient of recipients) expect(everything).not.toContain(recipient);
    expect(everything).not.toContain("Reply STOP");
    expect(everything).not.toMatch(/\+1[0-9]{10}/);
    for (const view of ["correction_reach", "alert_cost", "cohere_alert_share", "subscriber_measures"]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [row] = await owner`select has_table_privilege(${role}, ${view}, 'select') as ok`;
        expect(row!.ok, `${role} on ${view}`).toBe(false);
      }
      const [app] = await owner`select has_table_privilege('cvh_app', ${view}, 'select') as ok`;
      expect(app!.ok, view).toBe(true);
    }
  });
});

// --- cost per alert -----------------------------------------------------------------------------------------------------

describe("what an alert cost", () => {
  /** `count` texts of a language for an entry, each estimated at `cents` for `segments` segments. */
  async function texts(entryId: string, lang: string, count: number, cents: number, options: { isDrill?: boolean; segments?: number } = {}) {
    const deliveryIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const deliveryId = randomUUID();
      deliveryIds.push(deliveryId);
      await recordSmsEstimate(app, { deliveryId, entryId, lang, isDrill: options.isDrill ?? false, segments: options.segments ?? 1, costCents: cents, purpose: "alert" });
    }
    return deliveryIds;
  }

  /** The provider's price of some of an entry's texts, retiring their estimates (a pending reconciliation, as the sender's reconciler would leave it). */
  async function reported(deliveryIds: string[], millicents: number) {
    await owner`insert into sms_reconciliation (id, interval_start, interval_end)
                values ('month:2026-10', (make_timestamp(2026, 10, 1, 0, 0, 0) at time zone 'America/Toronto'), (make_timestamp(2026, 11, 1, 0, 0, 0) at time zone 'America/Toronto'))
                on conflict do nothing`;
    for (const deliveryId of deliveryIds) {
      const sid = `SM${randomBytes(16).toString("hex")}`;
      await owner`insert into sms_actual (message_sid, reconciliation_id, sent_at, price_text, price_unit, rate, cad_millicents)
                  values (${sid}, 'month:2026-10', '2026-10-15T15:00:00Z', '-0.0250', 'USD', 1.4, ${millicents})`;
      await owner`insert into sms_estimate_retirement (estimate_id, message_sid) select id, ${sid} from spend_event where delivery_id = ${deliveryId}`;
    }
  }

  const seedEntry = async (options: { isDrill?: boolean } = {}) => (await world.seedAlert({ isDrill: options.isDrill, recipients: 1 })).entry.entryId;
  const entryCost = async (entryId: string, drill = false) => {
    const report = await readAlertCost(app, 50);
    return (drill ? report.drills : report.real).find((row) => row.entryId === entryId);
  };
  const languageRow = (cost: Awaited<ReturnType<typeof entryCost>>, lang: string) => cost?.languages.find((row) => row.lang === lang);

  it("shows the SMS cost by language as a labelled estimate, and the entry's total", async () => {
    const entryId = await seedEntry();
    await texts(entryId, "en", 6, 2);
    await texts(entryId, "ur", 8, 4, { segments: 2 });
    const cost = await entryCost(entryId);
    expect(cost?.total).toMatchObject({ lang: null, texts: { n: 14, shown: "14" }, basis: "estimate", estimateCents: 6 * 2 + 8 * 4, actualMillicents: 0, countedMillicents: (12 + 32) * 1000 });
    expect(languageRow(cost, "en")).toMatchObject({ texts: { n: 6 }, basis: "estimate", estimateCents: 12, countedMillicents: 12_000 });
    expect(languageRow(cost, "ur")).toMatchObject({ texts: { n: 8 }, basis: "estimate", estimateCents: 32, countedMillicents: 32_000 });
  });

  it("counts a text at the provider's actual price where it was reported, labelled, and at its estimate otherwise ('mixed' for a language with both)", async () => {
    const entryId = await seedEntry();
    const english = await texts(entryId, "en", 6, 2);
    const urdu = await texts(entryId, "ur", 7, 4, { segments: 2 });
    await reported(english, 1_750);
    await reported(urdu.slice(0, 3), 3_500);
    const cost = await entryCost(entryId);
    // English: all six at the actual (1.75 cents each); Urdu: three at 3.5 cents and four still estimates of 4 cents.
    expect(languageRow(cost, "en")).toMatchObject({ basis: "actual", actualMillicents: 6 * 1_750, estimateCents: 0, countedMillicents: 10_500 });
    expect(languageRow(cost, "ur")).toMatchObject({ basis: "mixed", actualMillicents: 3 * 3_500, estimateCents: 4 * 4, countedMillicents: 10_500 + 16_000 });
    expect(cost?.total).toMatchObject({ basis: "mixed", countedMillicents: 10_500 + 10_500 + 16_000 });
  });

  it("gives no amount for a language of fewer than 5 texts, and hides a second cell when the total would reveal it", async () => {
    const entryId = await seedEntry();
    await texts(entryId, "en", 6, 2);
    await texts(entryId, "ur", 6, 4);
    await texts(entryId, "hi", 3, 2);
    const cost = await entryCost(entryId);
    expect(languageRow(cost, "hi")).toMatchObject({ texts: { n: null, shown: "fewer than 5" }, basis: null, countedMillicents: null, actualMillicents: null, estimateCents: null });
    // hi (3) is hidden; the total (15) minus the visible cells would give it, so the smallest visible cell (en, 6; ur ties and en comes first) is hidden too.
    expect(languageRow(cost, "en")).toMatchObject({ texts: { n: null, shown: "fewer than 5" }, countedMillicents: null });
    expect(languageRow(cost, "ur")).toMatchObject({ texts: { n: 6, shown: "6" }, countedMillicents: 24_000 });
    expect(cost?.total).toMatchObject({ texts: { n: 15, shown: "15" }, countedMillicents: (12 + 24 + 6) * 1000 });
    // A whole entry of fewer than 5 texts has no total amount either.
    const tiny = await seedEntry();
    await texts(tiny, "en", 3, 2);
    expect((await entryCost(tiny))?.total).toMatchObject({ texts: { n: null, shown: "fewer than 5" }, countedMillicents: null, basis: null });
  });

  it("reports a drill's texts apart from real ones", async () => {
    const real = await seedEntry();
    await texts(real, "en", 6, 2);
    const drill = await seedEntry({ isDrill: true });
    await texts(drill, "en", 9, 2, { isDrill: true });
    const report = await readAlertCost(app, 50);
    expect(report.real.map((row) => row.entryId)).toEqual([real]);
    expect(report.drills.map((row) => row.entryId)).toEqual([drill]);
    expect(report.real[0]?.total.texts.n).toBe(6);
    expect(report.drills[0]?.total.texts.n).toBe(9);
  });

  it("holds no personal data and no delivery or recipient id", async () => {
    const entryId = await seedEntry();
    const deliveries = await texts(entryId, "en", 6, 2);
    const columns = (await owner`select column_name from information_schema.columns where table_name = 'alert_cost' order by ordinal_position`).map((row) => row.column_name);
    expect(columns).toEqual(["entry_id", "alert_id", "kind", "approved_at", "is_drill", "lang", "texts", "texts_shown", "basis", "actual_millicents", "estimate_cents", "counted_millicents"]);
    const everything = JSON.stringify(await owner`select * from alert_cost`);
    for (const deliveryId of deliveries) expect(everything).not.toContain(deliveryId);
  });
});

// --- Cohere usage -------------------------------------------------------------------------------------------------------

describe("the alerts' share of the vendor's usage", () => {
  const event = (over: Record<string, unknown>) =>
    recordSpendEvent(app, { kind: "translate", purpose: "alert", model: "command-a-translate", calls: 1, tokens: 1_000, pricePerMillionTokensCad: null, ...over } as never);

  it("gives the share of calls and tokens made for alerts, and an unknown price as unknown rather than zero", async () => {
    await event({ tokens: 1_000, calls: 2 });
    await event({ kind: "embed", purpose: "publish", model: "embed-multilingual-v3.0", tokens: 2_000, calls: 3 });
    await event({ kind: "embed", purpose: "search", model: "embed-multilingual-v3.0", tokens: 1_000, calls: 5 });
    const [month] = await readCohereShare(app, 1);
    expect(month).toMatchObject({ allCalls: 10, alertCalls: 2, allTokens: 4_000, alertTokens: 1_000, alertTokenSharePercent: 25, allCostCents: null, alertCostCents: null });
  });

  it("gives amounts once every price is known, and keeps months apart", async () => {
    await event({ tokens: 1_000_000, pricePerMillionTokensCad: 2 });
    await event({ kind: "embed", purpose: "publish", model: "embed-multilingual-v3.0", tokens: 3_000_000, pricePerMillionTokensCad: 0.5 });
    // A month ago (never the same Toronto month as now).
    await owner`insert into spend_event (at, kind, purpose, model, calls, tokens) values (now() - interval '40 days', 'embed', 'search', 'embed-multilingual-v3.0', 4, 500)`;
    const months = await readCohereShare(app, 2);
    expect(months).toHaveLength(2);
    // 1,000,000 tokens at CAD 2 per million = CAD 2.00 = 200 cents for alerts; 3,000,000 at 0.5 = 150 cents more.
    expect(months[0]).toMatchObject({ alertTokenSharePercent: 25, alertCostCents: 200, allCostCents: 350 });
    expect(months[1]).toMatchObject({ allCalls: 4, alertCalls: 0, alertTokens: 0, alertTokenSharePercent: 0 });
    expect(months[0]!.month > months[1]!.month).toBe(true);
  });
});
