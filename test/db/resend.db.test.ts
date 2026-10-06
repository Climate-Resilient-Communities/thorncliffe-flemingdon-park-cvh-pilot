// An Admin resends texts that failed, against a real database as the app's own role (cvh_app_login) with the real sender (the dispatcher) and a fake provider (S09.02,
// AR-21 resend, AR-12, FR-G6, E09 definitions "Resend"): a resend is a new delivery copying the chain's root with `resend_of`, `resend_n` and the key `resend:{root}:{n}`;
// a chain has at most two resends whichever row is resent; two Admins at once never make more or the same number twice (really concurrent, on separate connections);
// an `unknown` text needs the Admin's confirmation, is never in a "resend all", and is refused with the new status if a late callback resolved it; a number that cannot
// receive texts, a deleted resident and an alert that no longer sends are refused with the reason; the new text follows E06's rules at the hand-off (a pause, a cancellation);
// it is counted in spend once and against the cap like an approval (a warning, never a refusal); `delivery.resent` is audited with counts and never a number; and the
// database refuses a bad resend whoever asks. The providers are fakes and every number is fictitious (the 555 exchange). Nothing here reaches Twilio.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { opsRecorder } from "../../src/app/dispatch";
import { resendSpendCap } from "../../src/app/staff/resendSeam";
import { alertStandingReader } from "../../src/modules/alerting";
import { record, recordRefusal } from "../../src/modules/audit";
import {
  createDeliveryQueue,
  createResend,
  createSmsSpend,
  createStatusCallbacks,
  drizzleCallbackStore,
  sendingProgress,
  statusCallbackUrl,
  type CallbackRequest,
  type Resend,
  type ResendInput,
  type ResendOutcome,
} from "../../src/modules/messaging";
import { readWeeklyReview } from "../../src/modules/ops";
import { monthSpentCents } from "../../src/modules/spend";
import { subscriberReceives } from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { uuidv7 } from "../../src/platform/ids";
import type { SeededEntry } from "./deliveryFixtures";
import { BASE_URL, SERVICE_SID, dispatcherWorld, numberOf, sidOf, type Answerer, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

type Tx = postgres.TransactionSql;
type Row = Record<string, unknown>;

const TOKEN = "fake-auth-token-for-tests";
const PRICE = 1.5;

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
let admin: { id: string };
let auditBaseline = 0;
let madeNeighbourhood = false;
let phoneCounter = 0;

const auditTrail = { record: (tx: Parameters<typeof record>[0], event: Parameters<typeof record>[1]) => record(tx, event), recordRefusal: (db: Db, event: Parameters<typeof recordRefusal>[1]) => recordRefusal(db, event) };
const hooks = createSmsSpend({ pricePerSegmentCents: PRICE, now: () => new Date(), log: { error: (evt, fields) => world.log.error(evt, fields) } });
const spendSeams = { afterOutcome: hooks.afterOutcome, afterProviderId: hooks.afterProviderId };

function resendService(over: { receives?: (tx: never, recipient: { kind: string; id: string }) => Promise<boolean>; cap?: boolean } = {}): Resend {
  return createResend({
    db: app,
    recipients: { receives: (tx, recipient) => (over.receives ? over.receives(tx as never, recipient) : recipient.kind === "subscriber" ? subscriberReceives(tx, recipient.id) : Promise.resolve(false)) },
    standing: { standingOf: (tx, entryId) => alertStandingReader.standingOf(tx, entryId, 0) },
    spendCap: over.cap === false ? undefined : resendSpendCap,
    audit: auditTrail as never,
  });
}
let service: Resend;

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appSql = postgres(url.href, { max: 12, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  [{ max: auditBaseline }] = await owner`select coalesce(max(id), 0)::int as max from audit_event`;
  if ((await owner`select 1 from neighbourhood where id = 'TP'`).length === 0) {
    await owner`insert into neighbourhood (id, name, fsa) values ('TP', 'Fixture TP', 'M4H')`;
    madeNeighbourhood = true;
  }
  // Open the pool's connections now, so concurrent statements really overlap.
  await Promise.all(Array.from({ length: 12 }, () => app.$client`select pg_sleep(0.1)`));
});

async function resetAll() {
  await owner`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`;
  await owner.begin(async (tx) => {
    await tx.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await tx`delete from audit_event where id > ${auditBaseline}`;
    await tx.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
  });
  await world.reset();
  await owner`delete from subscriber`;
  await owner`delete from ops_event where kind = 'spend.cap_overrun'`;
  await owner.unsafe("delete from sms_estimate_retirement");
  await owner.unsafe("delete from sms_actual");
  await owner.unsafe("delete from sms_reconciliation");
  await owner.unsafe("delete from spend_event where kind = 'sms'");
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
  service = resendService();
  admin = await world.fx.staff("admin");
});

// --- fixtures ------------------------------------------------------------------------------------------------------------------------------------------

interface Text {
  id: string;
  recipient: string;
  lang: "en" | "ur";
}
interface Seeded {
  entry: SeededEntry;
  texts: Text[];
}

/** An approved entry with one text per language given, each to its own subscriber (who exists and receives alerts), written by the approval's shape. */
async function seed(langs: ("en" | "ur")[]): Promise<Seeded> {
  const entry = await world.fx.entry("pending_approval");
  const texts: Text[] = [];
  await appSql.begin(async (tx: Tx) => {
    await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
    for (const lang of langs) {
      const id = uuidv7();
      const recipient = randomUUID();
      const frozen = entry.bodies[lang];
      await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
               values (${id}, 'alert', 'subscriber', ${recipient}, ${entry.entryId}, 'alerting', ${lang}, ${frozen.body}, ${frozen.segments}, 4, ${`${entry.entryId}:${recipient}:sms`})`;
      texts.push({ id, recipient, lang });
    }
    await world.fx.approve(tx, entry);
  });
  for (const text of texts) await subscriber(text.recipient, text.lang);
  return { entry, texts };
}

async function subscriber(id: string, lang: string = "en") {
  phoneCounter += 1;
  await owner`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, retention_state)
    values (${id}, ${`+1416555${String(phoneCounter).padStart(4, "0")}`}, ${lang}, 'TP', ${[]}, '2026-10-01.1', 'web', 'active')`;
}

const accepted = { kind: "accepted", httpStatus: 201, status: "queued", messageId: "" } as const;
/** The provider's refusal for good (a 4xx with an error code): the text becomes `failed` with the code. */
const refusal = (errorCode: number): Answerer => ({ kind: "rejected", httpStatus: 400, errorCode, message: "refused" });
/** An answer that leaves the outcome unknown. */
const silence: Answerer = { kind: "no_answer", reason: "timeout" };

/** One dispatcher run, with each recipient's text answered as told (keyed by recipient; anyone else is accepted). */
async function send(answers: Record<string, Answerer> = {}) {
  world.provider.answer((submission, callNumber) => {
    const mine = Object.entries(answers).find(([recipient]) => numberOf(recipient) === submission.to);
    if (!mine) return { ...accepted, messageId: sidOf(callNumber + 1000) };
    const answer = mine[1];
    return typeof answer === "function" ? answer(submission, callNumber) : answer;
  });
  return world.dispatcher(spendSeams).run();
}

/** Every text of the seeded entry that the provider refuses for good with the code, then run the sender. */
async function failAll(seeded: Seeded, errorCode = 21999) {
  await send(Object.fromEntries(seeded.texts.map((text) => [text.recipient, refusal(errorCode)])));
}

const rowOf = async (id: string): Promise<Row> => (await owner`select * from delivery where id = ${id}`)[0] as Row;
const chainOf = async (rootId: string) =>
  (await owner`select id, state, resend_of, resend_n, idempotency_key from delivery where id = ${rootId} or resend_of = ${rootId} order by resend_n nulls first`) as unknown as Row[];
const resendsOf = async (entryId: string) =>
  (await owner`select id, state, resend_of, resend_n, idempotency_key, recipient_id, lang, body from delivery where entry_id = ${entryId} and resend_of is not null order by resend_of, resend_n`) as unknown as Row[];

const one = (entryId: string, deliveryId: string, seen: string | null, confirmedUnknown = false): ResendInput => ({ actorStaffId: admin.id, entryId, scope: "one", deliveryId, seen, confirmedUnknown });
const all = (entryId: string, lang: string): ResendInput => ({ actorStaffId: admin.id, entryId, scope: "language", lang });
const resent = (outcome: ResendOutcome) => {
  if (outcome.kind !== "resent") throw new Error(`expected a resend, got a refusal: ${outcome.reason}`);
  return outcome;
};

const auditOf = (action: string) =>
  owner<{ actor_staff_id: string | null; subject_type: string; subject_id: string | null; outcome: string; meta: Record<string, unknown> }[]>`
    select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditBaseline} and action = ${action} order by id`;
const estimatesOf = async (deliveryId: string) => (await owner`select id from spend_event where kind = 'sms' and delivery_id = ${deliveryId}`).length;

/** A signed status callback for a delivery, the way Twilio signs it, for the URL the dispatcher gave the provider. */
async function callback(id: string, status: string, extra: Record<string, string> = {}): Promise<CallbackRequest> {
  const row = await rowOf(id);
  const sid = (row.provider_message_id as string | null) ?? sidOf(77);
  const fields: Record<string, string> = { MessageSid: sid, SmsSid: sid, AccountSid: `AC${"0".repeat(32)}`, MessagingServiceSid: SERVICE_SID, MessageStatus: status, SmsStatus: status, To: "+14165550123", From: "+16475550100", ...extra };
  const url = statusCallbackUrl(BASE_URL, row.callback_ref as string);
  return { signature: getExpectedTwilioSignature(TOKEN, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
}
const callbacks = () => createStatusCallbacks({ db: app, ops: opsRecorder, log: world.log, authToken: TOKEN, publicBaseUrl: BASE_URL, store: drizzleCallbackStore });

// --- one resend ---------------------------------------------------------------------------------------------------------------------------------------

describe("an Admin resends one text that failed", () => {
  it("creates a new queued delivery that copies the original, keyed resend:{root}:1, and leaves the original as it was", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    const [text] = seeded.texts;
    const before = await rowOf(text.id);
    expect(before.state).toBe("failed");

    const outcome = resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    expect(outcome).toMatchObject({ resent: 1, notResent: [], more: false, overrun: null, resendN: 1, costCents: 4 });

    const made = await resendsOf(seeded.entry.entryId);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ state: "queued", resend_of: text.id, resend_n: 1, idempotency_key: `resend:${text.id}:1`, recipient_id: text.recipient, lang: "en", body: before.body });
    const copy = await rowOf(made[0].id as string);
    expect(copy).toMatchObject({ kind: "alert", recipient_kind: "subscriber", entry_id: seeded.entry.entryId, segments: before.segments, cost_estimate_cents: before.cost_estimate_cents, attempts: 0, handed_off_at: null, provider_message_id: null });
    expect(copy.callback_ref).not.toBe(before.callback_ref);
    // No row of the chain ever changes.
    expect(await rowOf(text.id)).toEqual(before);
  });

  it("audits delivery.resent with counts and the actor, and never a number, a recipient or a body", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed"));
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { scope: "one", resent: 1, not_resent: 0, resend_n: 1 } },
    ]);
    const stored = JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`);
    expect(stored).not.toContain("+1416");
    expect(stored).not.toContain(seeded.texts[0].recipient);
    expect(stored).not.toContain(seeded.entry.bodies.en.body);
  });

  it("is handed to the provider once by the sender, like any alert text, and counted in spend once, when the provider accepts it", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    const [text] = seeded.texts;
    expect(await estimatesOf(text.id)).toBe(0);
    const { resent: n } = resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    expect(n).toBe(1);
    const [copy] = await resendsOf(seeded.entry.entryId);
    const calls = world.provider.calls.length;
    const spentBefore = await monthSpentCents(app, new Date());

    // Not counted while it waits.
    expect(await estimatesOf(copy.id as string)).toBe(0);
    await send();
    await send();
    expect(world.provider.calls.length).toBe(calls + 1);
    expect(world.provider.calls.at(-1)).toMatchObject({ to: numberOf(text.recipient), body: seeded.entry.bodies.en.body });
    expect((await rowOf(copy.id as string)).state).toBe("submitted");
    expect(await estimatesOf(copy.id as string)).toBe(1);
    expect(await estimatesOf(text.id)).toBe(0);
    expect((await monthSpentCents(app, new Date())) - spentBefore).toBe(Math.ceil(seeded.entry.bodies.en.segments * PRICE));
  });

  it("refuses a text that arrived, one that is still on its way, and one that was cancelled", async () => {
    const seeded = await seed(["en"]);
    const gone = await seed(["en"]);
    await app.transaction((tx) => createDeliveryQueue().cancelQueued([gone.entry.entryId], tx));
    await send();
    await callbacks().handle(await callback(seeded.texts[0].id, "delivered"));
    // This one has not been sent yet.
    const queued = await seed(["en"]);
    expect((await rowOf(seeded.texts[0].id)).state).toBe("delivered");
    expect((await rowOf(gone.texts[0].id)).state).toBe("cancelled");
    expect((await rowOf(queued.texts[0].id)).state).toBe("queued");

    expect(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "delivered"))).toMatchObject({ kind: "refused", reason: "not_resendable", status: "delivered" });
    expect(await service.resend(one(queued.entry.entryId, queued.texts[0].id, "queued"))).toMatchObject({ kind: "refused", reason: "not_resendable", status: "queued" });
    expect(await service.resend(one(gone.entry.entryId, gone.texts[0].id, "cancelled"))).toMatchObject({ kind: "refused", reason: "not_resendable", status: "cancelled" });
    for (const entry of [seeded, queued, gone]) expect(await resendsOf(entry.entry.entryId)).toEqual([]);
    expect((await auditOf("delivery.resent")).every((row) => row.outcome === "refused")).toBe(true);
  });

  it("refuses a text of another entry or one that is not there, as not found", async () => {
    const seeded = await seed(["en"]);
    const other = await seed(["en"]);
    await failAll(seeded);
    expect(await service.resend(one(other.entry.entryId, seeded.texts[0].id, "failed"))).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await service.resend(one(seeded.entry.entryId, randomUUID(), "failed"))).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await service.resend(one(seeded.entry.entryId, "not-an-id", "failed"))).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await service.resend(one(randomUUID(), seeded.texts[0].id, "failed"))).toMatchObject({ kind: "refused", reason: "not_found" });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
  });

  it("records a refusal with its reason only", async () => {
    const seeded = await seed(["en"]);
    await send();
    await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "submitted"));
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "refused", meta: { reason: "not_resendable" } },
    ]);
  });
});

// --- the chain's limit ----------------------------------------------------------------------------------------------------------------------------------

describe("a chain has at most two resends, whichever row is resent", () => {
  it("allows a resend of a resend, numbers it 2 against the root, and refuses a third", async () => {
    const seeded = await seed(["en"]);
    const [root] = seeded.texts;
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, root.id, "failed")));
    await failAll(seeded);
    const [first] = await resendsOf(seeded.entry.entryId);
    expect(first.state).toBe("failed");

    // A resend of the root, now that a newer text exists for it, would send the same text twice: refused.
    expect(await service.resend(one(seeded.entry.entryId, root.id, "failed"))).toMatchObject({ kind: "refused", reason: "already_resent" });
    // A resend of the resend: the second of the chain, still against the root.
    const second = resent(await service.resend(one(seeded.entry.entryId, first.id as string, "failed")));
    expect(second.resendN).toBe(2);
    expect((await chainOf(root.id)).map((row) => [row.resend_n, row.resend_of, row.idempotency_key])).toEqual([
      [null, null, expect.stringContaining(":")],
      [1, root.id, `resend:${root.id}:1`],
      [2, root.id, `resend:${root.id}:2`],
    ]);

    await send(Object.fromEntries(seeded.texts.map((text) => [text.recipient, refusal(21999)])));
    const last = (await chainOf(root.id)).at(-1)!;
    expect(last.state).toBe("failed");
    // The chain has two resends: refused, whichever row is resent.
    for (const id of (await chainOf(root.id)).map((row) => row.id as string)) {
      expect(await service.resend(one(seeded.entry.entryId, id, "failed")), id).toMatchObject({ kind: "refused", reason: expect.stringMatching(/^(resend_limit|already_resent)$/) });
    }
    expect(await service.resend(one(seeded.entry.entryId, last.id as string, "failed"))).toMatchObject({ kind: "refused", reason: "resend_limit" });
    expect(await chainOf(root.id)).toHaveLength(3);
  });

  it("is two Admins pressing at once: the chain never has more than two resends or two rows of one number (separate connections)", async () => {
    const seeded = await seed(["en"]);
    const [root] = seeded.texts;
    await failAll(seeded);
    // Two Admins resend the same failed text at the same moment: one resend is made.
    const first = await Promise.all([service.resend(one(seeded.entry.entryId, root.id, "failed")), service.resend({ ...one(seeded.entry.entryId, root.id, "failed"), actorStaffId: (await world.fx.staff("admin")).id })]);
    expect(first.filter((outcome) => outcome.kind === "resent" && outcome.resent === 1)).toHaveLength(1);
    expect(first.filter((outcome) => outcome.kind === "refused").map((outcome) => outcome.kind === "refused" && outcome.reason)).toEqual(["already_resent"]);
    expect(await chainOf(root.id)).toHaveLength(2);

    await failAll(seeded);
    // Six presses on the chain's latest text, and on the root, all at once: exactly one more is made, and the numbers are 1 and 2.
    const [latest] = (await chainOf(root.id)).slice(-1);
    const presses = await Promise.all(
      Array.from({ length: 6 }, (_, index) => service.resend(one(seeded.entry.entryId, index % 2 === 0 ? (latest.id as string) : root.id, null))),
    );
    expect(presses.filter((outcome) => outcome.kind === "resent")).toHaveLength(1);
    const chain = await chainOf(root.id);
    expect(chain.map((row) => row.resend_n)).toEqual([null, 1, 2]);
    expect(new Set(chain.map((row) => row.idempotency_key)).size).toBe(3);
    await failAll(seeded);
    const again = await Promise.all(Array.from({ length: 4 }, () => service.resend(one(seeded.entry.entryId, (chain.at(-1) as Row).id as string, null))));
    expect(again.filter((outcome) => outcome.kind === "resent")).toHaveLength(0);
    expect(await chainOf(root.id)).toHaveLength(3);
  });

  it("is enforced by the database whoever inserts: the same number twice, a third resend, a chain that was not left behind", async () => {
    const seeded = await seed(["en"]);
    const [root] = seeded.texts;
    await failAll(seeded);
    const rootRow = await rowOf(root.id);
    const insert = (tx: postgres.Sql | Tx, over: Row = {}) => {
      const row: Row = {
        id: uuidv7(), kind: "alert", recipient_kind: "subscriber", recipient_id: root.recipient, entry_id: seeded.entry.entryId, created_by_module: "alerting", lang: "en",
        body: rootRow.body, segments: rootRow.segments, cost_estimate_cents: rootRow.cost_estimate_cents, resend_of: root.id, resend_n: 1, ...over,
      };
      row.idempotency_key ??= `resend:${row.resend_of}:${row.resend_n}`;
      return tx`insert into delivery ${tx(row as never, "id", "kind", "recipient_kind", "recipient_id", "entry_id", "created_by_module", "lang", "body", "segments", "cost_estimate_cents", "resend_of", "resend_n", "idempotency_key")}`;
    };

    // Two inserts of resend 1 at the same moment: the root's lock makes one wait, and it is then refused as not the next number.
    const racing = await Promise.allSettled([appSql.begin((tx) => insert(tx)), appSql.begin((tx) => insert(tx))]);
    expect(racing.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(await chainOf(root.id)).toHaveLength(2);
    await failAll(seeded);

    await expect(insert(appSql, { resend_n: 1 })).rejects.toThrow(/next number|delivery_resend_unique|idempotency_key/);
    // (The trigger names the next number before the table's own check of 1 and 2 is reached; either way a third resend is refused.)
    await expect(insert(appSql, { resend_n: 3 })).rejects.toThrow(/next number|delivery_resend_shape/);
    await expect(insert(appSql, { resend_n: 2, idempotency_key: `resend:${root.id}:1` })).rejects.toThrow(/key/);
    await insert(appSql, { resend_n: 2 });
    await expect(insert(appSql, { resend_n: 2 })).rejects.toThrow();
    expect(await chainOf(root.id)).toHaveLength(3);
  });

  it("refuses at the database a resend of a text that arrived or is on its way, of something that is not a root, a different text and another kind", async () => {
    const seeded = await seed(["en", "en", "en"]);
    const [failed, delivered, waiting] = seeded.texts;
    await send({ [failed.recipient]: refusal(21999), [waiting.recipient]: refusal(21999) });
    await callbacks().handle(await callback(delivered.id, "delivered"));
    // `waiting` is resent by the app, so its chain's latest text is queued.
    resent(await service.resend(one(seeded.entry.entryId, waiting.id, "failed")));
    const base = async (of: Text, over: Row = {}) => {
      const source = await rowOf(of.id);
      const row: Row = {
        id: uuidv7(), kind: "alert", recipient_kind: "subscriber", recipient_id: of.recipient, entry_id: seeded.entry.entryId, created_by_module: "alerting", lang: "en",
        body: source.body, segments: source.segments, cost_estimate_cents: source.cost_estimate_cents, resend_of: of.id, resend_n: 1, ...over,
      };
      row.idempotency_key ??= `resend:${row.resend_of}:${row.resend_n}`;
      return row;
    };
    const put = (row: Row) => appSql`insert into delivery ${appSql(row as never, "id", "kind", "recipient_kind", "recipient_id", "entry_id", "created_by_module", "lang", "body", "segments", "cost_estimate_cents", "resend_of", "resend_n", "idempotency_key")}`;

    await expect(put(await base(delivered))).rejects.toThrow(/only a text that failed, was undelivered or is unknown/);
    await expect(put(await base(waiting, { resend_n: 2 }))).rejects.toThrow(/only a text that failed, was undelivered or is unknown/);
    const [made] = await resendsOf(seeded.entry.entryId);
    await expect(put(await base(failed, { resend_of: made.id, resend_n: 1 }))).rejects.toThrow(/first delivery of the chain/);
    await expect(put(await base(failed, { body: "A different text. Reply STOP" }))).rejects.toThrow(/copy of the first delivery/);
    await expect(put(await base(failed, { recipient_id: randomUUID() }))).rejects.toThrow(/copy of the first delivery/);
    await expect(put(await base(failed, { kind: "transactional", entry_id: null, purpose: "menu_reply" }))).rejects.toThrow();
    await expect(put(await base(failed, { resend_of: randomUUID() }))).rejects.toThrow(/first delivery of the chain|resend_of/);
    // A resend cannot change afterwards what it is.
    await expect(appSql`update delivery set resend_n = 2 where id = ${made.id as string}`).rejects.toThrow();
    await expect(appSql`update delivery set resend_of = null where id = ${made.id as string}`).rejects.toThrow();
    // ... and the one that is allowed is made.
    await put(await base(failed));
  });
});

// --- unknown --------------------------------------------------------------------------------------------------------------------------------------------

describe("a text with an unknown outcome", () => {
  it("is resent only with the Admin's confirmation, which names the status they saw", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await send({ [text.recipient]: silence });
    expect((await rowOf(text.id)).state).toBe("unknown");

    expect(await service.resend(one(seeded.entry.entryId, text.id, "unknown", false))).toMatchObject({ kind: "refused", reason: "confirm_needed", status: "unknown" });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
    const done = resent(await service.resend(one(seeded.entry.entryId, text.id, "unknown", true)));
    expect(done.resendN).toBe(1);
    const [copy] = await resendsOf(seeded.entry.entryId);
    expect(copy).toMatchObject({ resend_of: text.id, resend_n: 1, state: "queued" });
    // The unknown row is not changed: only a late callback resolves it.
    expect((await rowOf(text.id)).state).toBe("unknown");
  });

  it("is never in a resend of all the failed and undelivered texts of an entry and language", async () => {
    const seeded = await seed(["en", "en", "en"]);
    const [failed, unknown, undelivered] = seeded.texts;
    await send({ [failed.recipient]: refusal(21999), [unknown.recipient]: silence });
    await callbacks().handle(await callback(undelivered.id, "undelivered", { ErrorCode: "30003" }));
    expect(await Promise.all(seeded.texts.map(async (text) => (await rowOf(text.id)).state))).toEqual(["failed", "unknown", "undelivered"]);

    const outcome = resent(await service.resend(all(seeded.entry.entryId, "en")));
    expect(outcome.resent).toBe(2);
    expect((await resendsOf(seeded.entry.entryId)).map((row) => row.resend_of).sort()).toEqual([failed.id, undelivered.id].sort());
    expect((await rowOf(unknown.id)).state).toBe("unknown");
  });

  it("is refused with its new status if a late callback resolved it after the Admin saw it", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await send({ [text.recipient]: silence });
    expect((await rowOf(text.id)).state).toBe("unknown");

    // The Admin saw `unknown`; before they confirm, the carrier's callback says it was delivered.
    await app.$client`update delivery set provider_message_id = ${sidOf(5)} where id = ${text.id}`;
    await callbacks().handle(await callback(text.id, "delivered"));
    expect((await rowOf(text.id)).state).toBe("delivered");

    const outcome = await service.resend(one(seeded.entry.entryId, text.id, "unknown", true));
    expect(outcome).toMatchObject({ kind: "refused", reason: "status_changed", status: "delivered" });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "refused", meta: { reason: "status_changed" } },
    ]);
  });

  it("is refused with the new status when the callback comes while the Admin's press is waiting (really concurrent)", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await send({ [text.recipient]: silence });
    await app.$client`update delivery set provider_message_id = ${sidOf(6)} where id = ${text.id}`;
    const request = await callback(text.id, "delivered");

    // The callback holds the text's row while the press asks for it; the press waits for the lock, then judges what the row became.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const lock = appSql.begin(async (tx) => {
      await tx`select 1 from delivery where id = ${text.id} for update`;
      await tx`update delivery set state = 'delivered' where id = ${text.id}`;
      await held;
    });
    await world.until(async () => (await owner`select 1 from pg_locks where locktype = 'transactionid' and granted`).length > 0, "the lock");
    const press = service.resend(one(seeded.entry.entryId, text.id, "unknown", true));
    await world.untilSomeoneWaitsForALock();
    release();
    await lock;
    expect(await press).toMatchObject({ kind: "refused", reason: "status_changed", status: "delivered" });
    expect(request).toBeDefined();
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
  });
});

// --- a number that cannot receive texts, a resident who is gone ---------------------------------------------------------------------------------

describe("a text is not resent to a number that cannot receive texts, or to someone who is gone", () => {
  it.each([
    [21211, "invalid_number"],
    [30005, "not_in_service"],
    [30006, "landline"],
    [21610, "opted_out"],
  ])("refuses a text that failed with error %i with the reason (%s)", async (code, meaning) => {
    const seeded = await seed(["en"]);
    await failAll(seeded, code);
    expect(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed"))).toMatchObject({ kind: "refused", reason: "cannot_receive", meaning });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
  });

  it("refuses a text the carrier could not deliver to a landline, and still resends one the phone being off failed", async () => {
    const seeded = await seed(["en", "en"]);
    const [landline, phoneOff] = seeded.texts;
    await send();
    await callbacks().handle(await callback(landline.id, "undelivered", { ErrorCode: "30006" }));
    await callbacks().handle(await callback(phoneOff.id, "undelivered", { ErrorCode: "30003" }));
    expect(await service.resend(one(seeded.entry.entryId, landline.id, "undelivered"))).toMatchObject({ kind: "refused", reason: "cannot_receive", meaning: "landline" });
    resent(await service.resend(one(seeded.entry.entryId, phoneOff.id, "undelivered")));
  });

  it("leaves those chains out of a resend of all and says how many", async () => {
    const seeded = await seed(["en", "en", "en"]);
    const [ok, invalid, optedOut] = seeded.texts;
    await send({ [ok.recipient]: refusal(21999), [invalid.recipient]: refusal(21211), [optedOut.recipient]: refusal(21610) });
    const outcome = resent(await service.resend(all(seeded.entry.entryId, "en")));
    expect(outcome).toMatchObject({ resent: 1, notResent: [{ reason: "cannot_receive", n: 2 }] });
    expect((await resendsOf(seeded.entry.entryId)).map((row) => row.resend_of)).toEqual([ok.id]);
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { scope: "language", lang: "en", resent: 1, not_resent: 2 } },
    ]);
  });

  it("never resends to a deleted or opted-out subscriber (their row is gone, and their old texts no longer name them)", async () => {
    const seeded = await seed(["en", "en"]);
    const [stopped, there] = seeded.texts;
    await failAll(seeded);
    // STOP deletes the subscriber (E07): the delivery forgets its recipient.
    await owner`delete from subscriber where id = ${stopped.recipient}`;
    expect((await rowOf(stopped.id)).recipient_id).toBeNull();
    expect(await service.resend(one(seeded.entry.entryId, stopped.id, "failed"))).toMatchObject({ kind: "refused", reason: "recipient_gone" });
    const outcome = resent(await service.resend(all(seeded.entry.entryId, "en")));
    expect(outcome).toMatchObject({ resent: 1, notResent: [{ reason: "recipient_gone", n: 1 }] });
    expect((await resendsOf(seeded.entry.entryId)).map((row) => row.resend_of)).toEqual([there.id]);
  });

  it("refuses a resident who no longer receives alerts", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    service = resendService({ receives: async () => false });
    expect(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed"))).toMatchObject({ kind: "refused", reason: "recipient_not_receiving" });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
  });

  it("does not wait for a deletion that is running: the resident is leaving, so the press is refused at once and the deletion finishes (a STOP and a resend at once)", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const deleting = appSql.begin(async (tx) => {
      await tx`select 1 from subscriber where id = ${text.recipient} for update`;
      await held;
      await tx`delete from subscriber where id = ${text.recipient}`;
    });
    await world.until(async () => (await owner`select 1 from pg_locks where locktype = 'transactionid' and granted`).length > 0, "the deletion's lock");
    expect(await service.resend(one(seeded.entry.entryId, text.id, "failed"))).toMatchObject({ kind: "refused", reason: "recipient_not_receiving" });
    release();
    await deleting;
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
    expect((await rowOf(text.id)).recipient_id).toBeNull();
  });

  it("is not refused by an ordinary update of the resident's row that is running (only a deletion reads as leaving)", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const updating = appSql.begin(async (tx) => {
      await tx`select 1 from subscriber where id = ${text.recipient} for no key update`;
      await held;
    });
    await world.until(async () => (await owner`select 1 from pg_locks where locktype = 'transactionid' and granted`).length > 0, "the update's lock");
    expect(await service.resend(one(seeded.entry.entryId, text.id, "failed"))).toMatchObject({ kind: "resent", resent: 1 });
    release();
    await updating;
    expect(await resendsOf(seeded.entry.entryId)).toHaveLength(1);
  });

  it("is skipped, not sent, by a STOP that comes after the resend committed (the deletion skips the waiting texts of the resident, E07)", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    const [copy] = await resendsOf(seeded.entry.entryId);
    await app.transaction(async (tx) => {
      expect(await createDeliveryQueue().skipRecipientDeliveries(tx, { kind: "subscriber", id: text.recipient })).toMatchObject({ skipped: 1 });
    });
    await owner`delete from subscriber where id = ${text.recipient}`;
    const calls = world.provider.calls.length;
    await send();
    expect(world.provider.calls.length).toBe(calls);
    expect((await rowOf(copy.id as string)).state).toBe("skipped");
  });

  it("is skipped by the sender if the resident is deleted after the resend was queued, and nothing is sent", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    const [copy] = await resendsOf(seeded.entry.entryId);
    await owner`delete from subscriber where id = ${text.recipient}`;
    expect((await rowOf(copy.id as string)).recipient_id).toBeNull();
    const calls = world.provider.calls.length;
    await send();
    expect(world.provider.calls.length).toBe(calls);
    expect((await rowOf(copy.id as string)).state).toBe("skipped");
  });
});

// --- E06's rules ---------------------------------------------------------------------------------------------------------------------------------------

describe("a resend follows E06's rules like any alert text", () => {
  it("is refused for an alert that no longer sends it: an entry that was replaced, one that is past its valid-until, a closed thread", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    const text = seeded.texts[0];
    const setEntry = async (changes: string) => {
      await owner.begin(async (tx) => {
        await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
        await tx.unsafe(`update alert_entry set ${changes} where id = '${seeded.entry.entryId}'`);
        await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      });
    };

    await setEntry(`valid_until = now() - interval '1 hour'`);
    expect(await service.resend(one(seeded.entry.entryId, text.id, "failed"))).toMatchObject({ kind: "refused", reason: "not_sendable", cause: "valid_until_passed" });
    await setEntry(`valid_until = now() + interval '30 days', status = 'superseded'`);
    expect(await service.resend(one(seeded.entry.entryId, text.id, "failed"))).toMatchObject({ kind: "refused", reason: "not_sendable", cause: "entry_superseded" });
    expect(await service.resend(all(seeded.entry.entryId, "en"))).toMatchObject({ kind: "refused", reason: "not_sendable" });
    expect(await resendsOf(seeded.entry.entryId)).toEqual([]);
  });

  it("never sends a stale text: a correction or a withdrawal that replaces the entry cancels the resend that waits, and the provider is not called", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    const [copy] = await resendsOf(seeded.entry.entryId);
    // The approval of a correction, a withdrawal, a discard or a close stops the entry's waiting texts (S06.03).
    await app.transaction((tx) => createDeliveryQueue().cancelQueued([seeded.entry.entryId], tx));
    expect((await rowOf(copy.id as string)).state).toBe("cancelled");
    const calls = world.provider.calls.length;
    await send();
    expect(world.provider.calls.length).toBe(calls);
  });

  it("cancels at the hand-off a resend of an entry that was replaced after it was queued", async () => {
    const seeded = await seed(["en"]);
    const [text] = seeded.texts;
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    const [copy] = await resendsOf(seeded.entry.entryId);
    await owner.begin(async (tx) => {
      await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
      await tx.unsafe(`update alert_entry set status = 'superseded' where id = '${seeded.entry.entryId}'`);
      await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    });
    const calls = world.provider.calls.length;
    await send();
    expect(world.provider.calls.length).toBe(calls);
    expect((await rowOf(copy.id as string)).state).toBe("cancelled");
  });

  it("waits while texts are paused and goes out when they are resumed", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed")));
    const [copy] = await resendsOf(seeded.entry.entryId);
    await world.setPause(true);
    const calls = world.provider.calls.length;
    await send();
    expect(world.provider.calls.length).toBe(calls);
    expect((await rowOf(copy.id as string)).state).toBe("queued");
    await world.setPause(false);
    await send();
    expect(world.provider.calls.length).toBe(calls + 1);
    expect((await rowOf(copy.id as string)).state).toBe("submitted");
  });
});

// --- resend all ----------------------------------------------------------------------------------------------------------------------------------------

describe("an Admin resends all the failed and undelivered texts of an entry in a language", () => {
  it("takes the failed and undelivered texts of that language only, in one transaction with one audit record", async () => {
    const seeded = await seed(["en", "en", "en", "en", "ur", "ur"]);
    const [failed1, failed2, undelivered, delivered, urFailed1, urFailed2] = seeded.texts;
    await send({
      [failed1.recipient]: refusal(21999),
      [failed2.recipient]: refusal(21999),
      [urFailed1.recipient]: refusal(21999),
      [urFailed2.recipient]: refusal(21999),
    });
    await callbacks().handle(await callback(undelivered.id, "undelivered", { ErrorCode: "30003" }));
    await callbacks().handle(await callback(delivered.id, "delivered"));

    const outcome = resent(await service.resend(all(seeded.entry.entryId, "en")));
    expect(outcome).toMatchObject({ resent: 3, notResent: [], more: false, costCents: 12 });
    const made = await resendsOf(seeded.entry.entryId);
    expect(made.map((row) => row.resend_of).sort()).toEqual([failed1.id, failed2.id, undelivered.id].sort());
    expect(made.every((row) => row.lang === "en" && row.resend_n === 1 && row.state === "queued")).toBe(true);
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { scope: "language", lang: "en", resent: 3, not_resent: 0 } },
    ]);

    // The other language is untouched until it is asked for.
    expect(resent(await service.resend(all(seeded.entry.entryId, "ur"))).resent).toBe(2);
  });

  it("makes nothing the second time while the first resends wait, and nothing again once a chain has its two", async () => {
    const seeded = await seed(["en", "en"]);
    await failAll(seeded);
    expect(resent(await service.resend(all(seeded.entry.entryId, "en"))).resent).toBe(2);
    // The latest text of each chain is queued now: nothing to resend.
    expect(resent(await service.resend(all(seeded.entry.entryId, "en")))).toMatchObject({ resent: 0, notResent: [] });
    // A press that made nothing is audited too, with its counts.
    expect(await auditOf("delivery.resent")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { scope: "language", lang: "en", resent: 2, not_resent: 0 } },
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { scope: "language", lang: "en", resent: 0, not_resent: 0 } },
    ]);

    await failAll(seeded);
    expect(resent(await service.resend(all(seeded.entry.entryId, "en"))).resent).toBe(2);
    await failAll(seeded);
    // Both chains have two resends and the last of each failed: refused, counted, and nothing is made.
    expect(resent(await service.resend(all(seeded.entry.entryId, "en")))).toMatchObject({ resent: 0, notResent: [{ reason: "resend_limit", n: 2 }] });
    expect((await resendsOf(seeded.entry.entryId)).length).toBe(4);
    expect((await auditOf("delivery.resent")).at(-1)).toMatchObject({ outcome: "ok", meta: { scope: "language", lang: "en", resent: 0, not_resent: 2 } });
  });

  it("is two Admins pressing it at once: every chain is resent once, none twice (separate connections)", async () => {
    const seeded = await seed(["en", "en", "en", "en", "en", "en"]);
    await failAll(seeded);
    const other = await world.fx.staff("admin");
    const outcomes = await Promise.all([
      service.resend(all(seeded.entry.entryId, "en")),
      service.resend({ ...all(seeded.entry.entryId, "en"), actorStaffId: other.id }),
      service.resend(all(seeded.entry.entryId, "en")),
    ]);
    expect(outcomes.reduce((sum, outcome) => sum + (outcome.kind === "resent" ? outcome.resent : 0), 0)).toBe(6);
    const made = await resendsOf(seeded.entry.entryId);
    expect(made).toHaveLength(6);
    expect(new Set(made.map((row) => row.resend_of)).size).toBe(6);
    expect(made.every((row) => row.resend_n === 1)).toBe(true);
  });

  it("stops at its limit and says there are more", async () => {
    const seeded = await seed(["en", "en", "en"]);
    await failAll(seeded);
    const bounded = await app.transaction(async (tx) => {
      // The limit is the module's constant; a smaller one is tried through the store so the test needs no thousand rows.
      const { drizzleResendStore } = await import("../../src/modules/messaging/adapters/resendStore");
      return drizzleResendStore.bulkCandidates(tx, seeded.entry.entryId, "en", ["failed"], 2);
    });
    expect(bounded.texts).toHaveLength(2);
    expect(bounded.more).toBe(true);
  });
});

// --- spend and the cap -----------------------------------------------------------------------------------------------------------------------------------

describe("a resend counts toward the month's spending and is judged against the cap like an approval", () => {
  const setCap = (cents: number | null) =>
    cents === null
      ? owner`update spend_cap set monthly_cents = null, set_by = null, set_at = null where id = 1`
      : owner`update spend_cap set monthly_cents = ${cents}, set_by = ${admin.id}, set_at = now() where id = 1`;
  const overruns = () => owner<{ subject_type: string; subject_id: string; detail: Record<string, unknown> }[]>`select subject_type, subject_id, detail from ops_event where kind = 'spend.cap_overrun' order by id`;

  it("warns and never blocks: past the cap the resend is made, the overrun is audited and recorded as the ops event the health job texts about", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    await setCap(1);
    const outcome = resent(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed")));
    expect(outcome.resent).toBe(1);
    expect(outcome.overrun).toEqual({ overCents: 3, capCents: 1 });
    expect(await resendsOf(seeded.entry.entryId)).toHaveLength(1);
    expect(await auditOf("spend.cap_overrun")).toEqual([
      { actor_staff_id: admin.id, subject_type: "alert_entry", subject_id: seeded.entry.entryId, outcome: "ok", meta: { over_cents: 3, cap_cents: 1, entry_cents: 4 } },
    ]);
    expect(await overruns()).toEqual([{ subject_type: "alert_entry", subject_id: seeded.entry.entryId, detail: { over_cents: 3 } }]);
  });

  it("says nothing when the cap is not passed, or when none is set", async () => {
    const seeded = await seed(["en", "en"]);
    await failAll(seeded);
    expect(resent(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed"))).overrun).toBeNull();
    await setCap(100_000);
    expect(resent(await service.resend(one(seeded.entry.entryId, seeded.texts[1].id, "failed"))).overrun).toBeNull();
    expect(await auditOf("spend.cap_overrun")).toEqual([]);
    expect(await overruns()).toEqual([]);
  });

  it("counts the texts already waiting: a second resend that is past the cap because of the first is told so", async () => {
    const seeded = await seed(["en", "en"]);
    await failAll(seeded);
    await setCap(6);
    expect(resent(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed"))).overrun).toBeNull();
    expect(resent(await service.resend(one(seeded.entry.entryId, seeded.texts[1].id, "failed"))).overrun).toEqual({ overCents: 2, capCents: 6 });
  });
});

// --- what the rest of E09 and E06 read ----------------------------------------------------------------------------------------------------------------

describe("what others read of a resend", () => {
  it("shows in the weekly review by the key resend:{root}:{n}, by language and number", async () => {
    const seeded = await seed(["en", "en", "en", "en", "en", "en"]);
    await failAll(seeded);
    expect(resent(await service.resend(all(seeded.entry.entryId, "en"))).resent).toBe(6);
    const [{ week }] = await owner<{ week: string }[]>`select to_char(date_trunc('week', min(created_at) at time zone 'America/Toronto'), 'YYYY-MM-DD') as week from delivery where resend_of is not null`;
    const rows = (await readWeeklyReview(app, week)).filter((row) => row.section === "resend" && !row.isDrill);
    expect(rows.map((row) => `${row.lang ?? "total"}/${row.reason}=${row.nShown}`).sort()).toEqual(["en/resend_1=6", "total/resend_1=6"]);
  });

  it("is told apart in the list of texts that did not arrive: a resend with its number, and the text it was made for as resent", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    const [text] = seeded.texts;
    resent(await service.resend(one(seeded.entry.entryId, text.id, "failed")));
    await failAll(seeded);
    const listed = await sendingProgress.problemTexts(app, seeded.entry.entryId, "failed");
    const byRef = Object.fromEntries(listed.texts.map((item) => [item.resendN ?? 0, item]));
    expect(byRef[0]).toMatchObject({ resent: true, resends: 1 });
    expect(byRef[1]).toMatchObject({ resent: false, resends: 1, resendN: 1 });
  });

  it("leaves no phone number in anything stored", async () => {
    const seeded = await seed(["en"]);
    await failAll(seeded);
    resent(await service.resend(one(seeded.entry.entryId, seeded.texts[0].id, "failed")));
    await send();
    const stored = await world.everythingStored();
    expect(stored).not.toMatch(/\+1416555\d{4}/);
    expect(JSON.stringify(await owner`select * from audit_event where id > ${auditBaseline}`)).not.toMatch(/\+1416555\d{4}/);
  });
});
