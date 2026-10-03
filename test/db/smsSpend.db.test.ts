// What each text costs, against a real database (S06.08): the estimate written with the outcome and once, the tables' constraints, the
// reconciliation of the provider's prices (exact interval, every page, each MessageSid once, the matching rule that retires at most one
// estimate per actual, pending against complete, idempotent re-runs), the month boundary in both orders, the report, and the pilot's
// delivery measures. Twilio is never called: the provider is a fake that records every call, the listing is a fake that serves pages from a
// list, and every callback is signed the way Twilio's own library signs it. Every number is obviously fake.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { opsRecorder } from "../../src/app/dispatch";
import {
  createDeliveryMeasures,
  createSmsSpend,
  createStatusCallbacks,
  deliveryProviderIds,
  drizzleCallbackStore,
  drizzleDispatchStore,
  statusCallbackUrl,
  type CallbackRequest,
  type StatusCallbackDeps,
} from "../../src/modules/messaging";
import {
  createSmsReconciler,
  monthInterval,
  recordSmsEstimate,
  smsMonthReport,
  type MessagePage,
  type ProviderMessage,
  type SmsMessageLister,
  type SmsReconciler,
  type SmsReconcilerDeps,
} from "../../src/modules/spend";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, sidOf, type Answerer, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;

const TOKEN = "fake-auth-token-for-tests";
/** The configured price per segment (cents CAD) and the exchange rate (CAD per USD) the tests run with. */
const PRICE = 1.5;
const RATE = 1.4;
/** The instant the estimates are made at unless a test says otherwise: the middle of October 2026 in Toronto. */
const OCTOBER = new Date("2026-10-15T15:00:00Z");

let spendAt: Date | undefined = OCTOBER;
const hooks = createSmsSpend({ pricePerSegmentCents: PRICE, now: () => spendAt ?? new Date() });
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
  await clearSpend();
  // Open the pool's connections now, so concurrent statements really overlap.
  await Promise.all(Array.from({ length: 8 }, () => app.$client`select pg_sleep(0.1)`));
});

afterAll(async () => {
  await world.reset();
  await clearSpend();
  await owner.unsafe("drop trigger if exists scratch_refuse_estimate on spend_event");
  await owner.unsafe("drop function if exists scratch_refuse_estimate()");
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await world.reset();
  await clearSpend();
  spendAt = OCTOBER;
});

async function clearSpend() {
  await owner.unsafe("delete from sms_estimate_retirement");
  await owner.unsafe("delete from sms_actual");
  await owner.unsafe("delete from sms_reconciliation");
  await owner.unsafe("delete from spend_event where kind = 'sms'");
}

// --- helpers --------------------------------------------------------------------------------------------------------

type Row = Record<string, unknown>;
const dispatcher = (over: Parameters<DispatcherWorld["dispatcher"]>[0] = {}) => world.dispatcher({ ...spendSeams, ...over });
const estimates = async () =>
  (await owner`select id, kind, purpose, model, delivery_id, lang, entry_id, is_drill, segments, cost_estimate_cents, at from spend_event where kind = 'sms' order by id`) as unknown as Row[];
const estimateOf = async (deliveryId: string) => (await estimates()).filter((row) => row.delivery_id === deliveryId);
const retirements = async () => (await owner`select estimate_id, message_sid from sms_estimate_retirement order by estimate_id`) as unknown as Row[];
const actuals = async () => (await owner`select message_sid, reconciliation_id, sent_at, price_text, price_unit, rate, cad_millicents from sms_actual order by message_sid`) as unknown as Row[];
const reconciliationRow = async (id: string) => ((await owner`select * from sms_reconciliation where id = ${id}`)[0] ?? null) as Row | null;
const retiredBy = async (deliveryId: string) => {
  const [row] = await owner`select r.message_sid from sms_estimate_retirement r join spend_event e on e.id = r.estimate_id where e.delivery_id = ${deliveryId}`;
  return (row?.message_sid ?? null) as string | null;
};

/** A text the provider accepts (with message id `sid`, or the fake's next one) or answers as told; returns its delivery id. */
async function sendOne(over: Row = {}, answer?: Answerer): Promise<string> {
  const [id] = await world.seedTransactional(1, over);
  if (answer !== undefined) world.provider.answer(answer);
  await dispatcher().run();
  return id;
}

/** What the hooks read of a delivery, from its row (the hooks take the row as the dispatcher and the callbacks give it). */
const viewOf = (row: Row) => ({ id: row.id, kind: row.kind, recipientKind: row.recipient_kind, entryId: row.entry_id, lang: row.lang, segments: row.segments }) as never;

/** Counts a text the way the dispatcher does when it records an outcome, for a row a test moved by hand. */
async function countText(id: string, state: "submitted" | "unknown" = "submitted") {
  await app.transaction(async (tx) => hooks.afterOutcome(tx, viewOf(await world.rowOf(id)), state));
}

const accepted = (sid: string) => ({ kind: "accepted", httpStatus: 201, status: "queued", messageId: sid }) as const;

/** The signed callback for a delivery, for the URL the dispatcher gives Twilio (`statusCallbackUrl`). */
async function callbackFor(id: string, status: string, sid: string): Promise<CallbackRequest> {
  const url = statusCallbackUrl(BASE_URL, (await world.rowOf(id)).callback_ref as string);
  const fields = { MessageSid: sid, MessageStatus: status };
  return { signature: getExpectedTwilioSignature(TOKEN, url, fields), search: new URL(url).search, body: new URLSearchParams(fields).toString() };
}

function callbacks(over: Partial<StatusCallbackDeps> = {}) {
  return createStatusCallbacks({ db: app, ops: opsRecorder, log: world.log, authToken: TOKEN, publicBaseUrl: BASE_URL, store: drizzleCallbackStore, ...spendSeams, ...over });
}

/** A handed-off row nobody settled (its outcome write failed): the provider was called, and nothing was recorded. */
async function handedOffUnsettled(over: Row = {}): Promise<string> {
  const [id] = await world.seedTransactional(1, over);
  const failing = {
    ...drizzleDispatchStore,
    recordOutcome: async () => {
      throw new Error("the database went away");
    },
  };
  await dispatcher({ store: failing }).run();
  expect(await world.stateOf(id)).toBe("claimed");
  return id;
}

/** From now on the database refuses to write the estimate of this delivery (a scratch trigger): the real hook then fails for it alone. */
async function refuseEstimateFor(deliveryId: string) {
  await owner.unsafe(`create or replace function scratch_refuse_estimate() returns trigger language plpgsql as $$
    begin
      if new.delivery_id = '${deliveryId}'::uuid then raise exception 'scratch: the spend_event insert is refused'; end if;
      return new;
    end $$`);
  await owner.unsafe("drop trigger if exists scratch_refuse_estimate on spend_event");
  await owner.unsafe("create trigger scratch_refuse_estimate before insert on spend_event for each row execute function scratch_refuse_estimate()");
  return async () => {
    await owner.unsafe("drop trigger if exists scratch_refuse_estimate on spend_event");
  };
}

// --- the provider's listing, as a fake ------------------------------------------------------------------------------

const message = (sid: string, over: Partial<ProviderMessage> = {}): ProviderMessage => ({
  sid,
  direction: "outbound-api",
  dateSent: new Date("2026-10-15T15:00:05Z"),
  price: "-0.00790",
  priceUnit: "USD",
  ...over,
});

/**
 * Twilio's Messages API as a fake: every message of the account, served the way the adapter asks (the messages sent within a second of the
 * range, in pages, each page naming the next). It records every request and can fail on a page. It never touches a network.
 */
function fakeTwilio(initial: ProviderMessage[], options: { pageSize?: number } = {}) {
  const state = { messages: initial, pageSize: options.pageSize ?? 1000, failOnPage: null as number | null, requests: [] as string[] };
  let served: ProviderMessage[] = [];
  const pageAt = (n: number): MessagePage => {
    if (state.failOnPage === n) throw new Error("twilio unavailable");
    return { messages: served.slice((n - 1) * state.pageSize, n * state.pageSize), nextPageUri: n * state.pageSize < served.length ? `/fake/Messages.json?page=${n + 1}` : null };
  };
  const lister: SmsMessageLister = {
    async first({ startUtc, endUtc }) {
      state.requests.push(`first ${startUtc.toISOString()} ${endUtc.toISOString()}`);
      served = state.messages.filter((m) => m.dateSent === null || (m.dateSent.getTime() >= startUtc.getTime() - 1000 && m.dateSent.getTime() <= endUtc.getTime() + 1000));
      return pageAt(1);
    },
    async next(uri) {
      state.requests.push(`next ${uri}`);
      return pageAt(Number(new URL(uri, "https://twilio.invalid").searchParams.get("page")));
    },
  };
  return { state, lister };
}

const spendLines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
const spendLog = {
  info: (evt: string, fields: Record<string, unknown>) => void spendLines.push({ level: "info", evt, fields }),
  error: (evt: string, fields: Record<string, unknown>) => void spendLines.push({ level: "error", evt, fields }),
};

let reconcilerNow = new Date("2026-11-02T12:00:00Z");
function reconciler(twilio: ReturnType<typeof fakeTwilio>, over: Partial<SmsReconcilerDeps> = {}): SmsReconciler {
  return createSmsReconciler({ db: app, lister: twilio.lister, providerIds: deliveryProviderIds, usdToCadRate: RATE, now: () => reconcilerNow, log: spendLog, ...over });
}

beforeEach(() => {
  spendLines.length = 0;
  reconcilerNow = new Date("2026-11-02T12:00:00Z");
});

const OCT = "month:2026-10";
const NOV = "month:2026-11";

// --- the tables ------------------------------------------------------------------------------------------------------

describe("the tables of text message spend", () => {
  const delivery = "01900000-0000-7000-8000-0000000d0001";
  const entry = "01900000-0000-7000-8000-0000000e0001";
  const estimate = { deliveryId: delivery, entryId: entry, lang: "en", isDrill: false, segments: 1, costCents: 2, purpose: "alert" } as const;

  it("takes an estimate from the app's role, once per delivery, and keeps spend_event insert-only", async () => {
    await expect(recordSmsEstimate(app, estimate)).resolves.toEqual({ recorded: true });
    await expect(recordSmsEstimate(app, { ...estimate, costCents: 99 })).resolves.toEqual({ recorded: false });
    expect(await estimates()).toMatchObject([{ kind: "sms", purpose: "alert", model: "twilio", delivery_id: delivery, lang: "en", entry_id: entry, is_drill: false, segments: 1, cost_estimate_cents: 2 }]);
    await expect(appSql.unsafe("update spend_event set cost_estimate_cents = 0")).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe("delete from spend_event")).rejects.toThrow(/permission denied/);
  });

  it("refuses an sms row that lacks what an estimate holds, and a row of another kind that carries it", async () => {
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model) values ('sms', 'alert', 'twilio')`)).rejects.toThrow(/spend_event_sms_shape/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id, lang, is_drill, segments, cost_estimate_cents) values ('sms', 'alert', 'twilio', '${delivery}', 'en', false, 1, 2)`)).rejects.toThrow(/spend_event_sms_shape/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id, lang, entry_id, is_drill, segments, cost_estimate_cents) values ('sms', 'transactional', 'twilio', '${delivery}', 'en', '${entry}', false, 1, 2)`)).rejects.toThrow(/spend_event_sms_shape/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id, lang, is_drill, segments, cost_estimate_cents) values ('sms', 'marketing', 'twilio', '${delivery}', 'en', false, 1, 2)`)).rejects.toThrow(/spend_event_sms_shape/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id, lang, is_drill, segments, cost_estimate_cents) values ('sms', 'transactional', 'twilio', '${delivery}', 'en', false, 25, 2)`)).rejects.toThrow(/spend_event_sms_shape/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id, lang, is_drill, segments, cost_estimate_cents) values ('sms', 'transactional', 'twilio', '${delivery}', 'English!', false, 1, 2)`)).rejects.toThrow(/spend_event_lang_format/);
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, delivery_id) values ('embed', 'publish', 'embed-v4.0', '${delivery}')`)).rejects.toThrow(/spend_event_sms_shape/);
    // The rows of the other kinds (Cohere's) are as they were: none of the new columns.
    await expect(appSql.unsafe(`insert into spend_event (kind, purpose, model, tokens) values ('embed', 'publish', 'embed-v4.0', 10)`)).resolves.toBeDefined();
    await owner.unsafe("delete from spend_event where kind = 'embed' and tokens = 10");
  });

  it("has row level security, and nothing for the client roles or PUBLIC", async () => {
    for (const table of ["sms_reconciliation", "sms_actual", "sms_estimate_retirement"]) {
      expect((await owner`select relrowsecurity as rls from pg_class where relname = ${table}`)[0].rls, table).toBe(true);
      const clients = await owner.unsafe(
        `select r.rolname from pg_roles r, pg_class c
         where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname = '${table}'
           and has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')`,
      );
      expect(clients, table).toEqual([]);
    }
  });

  it("accepts a reconciliation only with the exact interval of the month its id names, in UTC", async () => {
    const insert = (id: string, start: string, end: string) =>
      appSql.unsafe(`insert into sms_reconciliation (id, interval_start, interval_end) values ('${id}', '${start}', '${end}')`);
    await expect(insert(OCT, "2026-10-01T04:00:00Z", "2026-11-01T04:00:00Z")).resolves.toBeDefined();
    // Off by a second, in the wrong zone, or for another month: refused.
    await expect(insert("month:2026-09", "2026-09-01T04:00:01Z", "2026-10-01T04:00:00Z")).rejects.toThrow(/sms_reconciliation_interval_exact/);
    await expect(insert("month:2026-09", "2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z")).rejects.toThrow(/sms_reconciliation_interval_exact/);
    await expect(insert("month:2026-09", "2026-10-01T04:00:00Z", "2026-11-01T04:00:00Z")).rejects.toThrow(/sms_reconciliation_interval_exact/);
    // The month after the clocks go back is an hour longer; the table knows.
    await expect(insert(NOV, "2026-11-01T04:00:00Z", "2026-12-01T04:00:00Z")).rejects.toThrow(/sms_reconciliation_interval_exact/);
    await expect(insert(NOV, "2026-11-01T04:00:00Z", "2026-12-01T05:00:00Z")).resolves.toBeDefined();
    // An id that is not a month is refused.
    for (const id of ["month:2026-13", "2026-10", "week:2026-10", "month:2026-1"]) await expect(insert(id, "2026-10-01T04:00:00Z", "2026-11-01T04:00:00Z"), id).rejects.toThrow();
  });

  it("agrees with the code about every month's interval (the table recomputes it with Postgres' own time zone rules)", async () => {
    for (const month of ["2026-03", "2026-04", "2026-10", "2026-11", "2026-12", "2027-01", "2027-03", "2028-02"]) {
      const { id, startUtc, endUtc } = monthInterval(month);
      await appSql`insert into sms_reconciliation (id, interval_start, interval_end) values (${id}, ${startUtc}, ${endUtc})`;
    }
    expect(await owner`select count(*)::int as n from sms_reconciliation`).toEqual([{ n: 8 }]);
  });

  it("starts a reconciliation pending, completes it once and never lets it change again, nor its id or interval", async () => {
    await expect(appSql`insert into sms_reconciliation (id, interval_start, interval_end, state, completed_at, messages, imported, usd_to_cad_rate)
                        values (${OCT}, '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z', 'complete', now(), 0, 0, 1.4)`).rejects.toThrow(/starts pending/);
    await appSql`insert into sms_reconciliation (id, interval_start, interval_end) values (${OCT}, '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z')`;
    await expect(appSql.unsafe(`update sms_reconciliation set interval_end = '2026-11-02T04:00:00Z' where id = '${OCT}'`)).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe(`update sms_reconciliation set id = 'month:2026-09' where id = '${OCT}'`)).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe(`delete from sms_reconciliation where id = '${OCT}'`)).rejects.toThrow(/permission denied/);
    // A complete reconciliation must say what it did; a pending one must not claim to have.
    await expect(appSql.unsafe(`update sms_reconciliation set state = 'complete' where id = '${OCT}'`)).rejects.toThrow(/sms_reconciliation_coherent/);
    await appSql.unsafe(`update sms_reconciliation set state = 'complete', completed_at = now(), messages = 3, imported = 2, usd_to_cad_rate = 1.4 where id = '${OCT}'`);
    await expect(appSql.unsafe(`update sms_reconciliation set attempts = 9 where id = '${OCT}'`)).rejects.toThrow(/never changes/);
    await expect(appSql.unsafe(`update sms_reconciliation set state = 'pending' where id = '${OCT}'`)).rejects.toThrow();
    // `imported` can never be more than `messages`.
    await owner.unsafe(`delete from sms_reconciliation`);
    await appSql`insert into sms_reconciliation (id, interval_start, interval_end) values (${OCT}, '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z')`;
    await expect(appSql.unsafe(`update sms_reconciliation set state = 'complete', completed_at = now(), messages = 1, imported = 2, usd_to_cad_rate = 1.4 where id = '${OCT}'`)).rejects.toThrow(/sms_reconciliation_counts/);
  });

  it("takes an actual only while its reconciliation is pending and only from inside its interval, one per MessageSid, insert-only", async () => {
    await appSql`insert into sms_reconciliation (id, interval_start, interval_end) values (${OCT}, '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z')`;
    const insert = (sid: string, sentAt: string, price = "-0.0079") =>
      appSql.unsafe(`insert into sms_actual (message_sid, reconciliation_id, sent_at, price_text, price_unit, rate, cad_millicents) values ('${sid}', '${OCT}', '${sentAt}', '${price}', 'USD', 1.4, 1106)`);
    await expect(insert(sidOf(1), "2026-10-15T15:00:00Z")).resolves.toBeDefined();
    await expect(insert(sidOf(1), "2026-10-16T15:00:00Z")).rejects.toThrow(/duplicate key|sms_actual_pkey/);
    await expect(insert(sidOf(2), "2026-10-01T03:59:59Z")).rejects.toThrow(/outside the reconciliation/);
    await expect(insert(sidOf(2), "2026-11-01T04:00:00Z")).rejects.toThrow(/outside the reconciliation/);
    await expect(insert(sidOf(2), "2026-10-01T04:00:00Z")).resolves.toBeDefined();
    await expect(insert(sidOf(3), "2026-11-01T03:59:59Z")).resolves.toBeDefined();
    await expect(insert("SM123", "2026-10-15T15:00:00Z")).rejects.toThrow(/sms_actual_sid_format/);
    await expect(insert(sidOf(4), "2026-10-15T15:00:00Z", "cheap")).rejects.toThrow(/sms_actual_price_format/);
    await expect(appSql.unsafe(`update sms_actual set cad_millicents = 0`)).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe(`delete from sms_actual`)).rejects.toThrow(/permission denied/);
    // Once complete, a reconciliation takes no more actuals.
    await appSql.unsafe(`update sms_reconciliation set state = 'complete', completed_at = now(), messages = 3, imported = 3, usd_to_cad_rate = 1.4 where id = '${OCT}'`);
    await expect(insert(sidOf(5), "2026-10-15T15:00:00Z")).rejects.toThrow(/pending reconciliation/);
    await expect(appSql.unsafe(`insert into sms_actual (message_sid, reconciliation_id, sent_at, price_text, price_unit, rate, cad_millicents) values ('${sidOf(6)}', 'month:2026-09', now(), '-0.0079', 'USD', 1.4, 1)`)).rejects.toThrow(/foreign key|pending reconciliation/);
  });

  it("retires an estimate at most once, lets an actual retire at most one estimate, only for a text message's estimate, and never changes a retirement", async () => {
    await recordSmsEstimate(app, estimate);
    await recordSmsEstimate(app, { ...estimate, deliveryId: "01900000-0000-7000-8000-0000000d0002" });
    await owner`insert into spend_event (kind, purpose, model, tokens) values ('embed', 'publish', 'embed-v4.0', 1)`;
    await appSql`insert into sms_reconciliation (id, interval_start, interval_end) values (${OCT}, '2026-10-01T04:00:00Z', '2026-11-01T04:00:00Z')`;
    for (const sid of [sidOf(1), sidOf(2)]) {
      await appSql`insert into sms_actual (message_sid, reconciliation_id, sent_at, price_text, price_unit, rate, cad_millicents) values (${sid}, ${OCT}, '2026-10-15T15:00:00Z', '-0.0079', 'USD', 1.4, 1106)`;
    }
    const [first, second] = (await estimates()).map((row) => row.id as number);
    const [embed] = await owner`select id from spend_event where kind = 'embed' order by id desc limit 1`;
    await expect(appSql`insert into sms_estimate_retirement (estimate_id, message_sid) values (${first}, ${sidOf(1)})`).resolves.toBeDefined();
    // The same estimate by another actual, and the same actual for another estimate: refused.
    await expect(appSql`insert into sms_estimate_retirement (estimate_id, message_sid) values (${first}, ${sidOf(2)})`).rejects.toThrow(/duplicate key|pkey/);
    await expect(appSql`insert into sms_estimate_retirement (estimate_id, message_sid) values (${second}, ${sidOf(1)})`).rejects.toThrow(/duplicate key|message_sid/);
    await expect(appSql`insert into sms_estimate_retirement (estimate_id, message_sid) values (${embed.id}, ${sidOf(2)})`).rejects.toThrow(/only the estimate of a text message/);
    await expect(appSql.unsafe(`update sms_estimate_retirement set message_sid = '${sidOf(2)}'`)).rejects.toThrow(/permission denied/);
    await expect(appSql.unsafe(`delete from sms_estimate_retirement`)).rejects.toThrow(/permission denied/);
    await owner.unsafe("delete from sms_estimate_retirement");
    await owner.unsafe("delete from spend_event where kind = 'embed' and tokens = 1");
  });
});

// --- the estimate, written with the outcome -------------------------------------------------------------------------------

describe("the estimate of a text (S06.08)", () => {
  it("is written once, in the transaction of the outcome, when the provider accepts the text: segments x the configured price, in whole cents, with kind sms, the language, the entry and is_drill", async () => {
    const { ids, entry } = await world.seedAlert({ recipients: 2 });
    const report = await dispatcher().run();
    expect(report.submitted).toBe(2);
    // The delivery rows carry a cost of their own (4 cents), and the estimate is not that: it is segments x the configured price per segment.
    expect((await world.rowOf(ids[0])).cost_estimate_cents).toBe(4);
    expect(await estimates()).toMatchObject([
      { kind: "sms", purpose: "alert", model: "twilio", delivery_id: ids[0], lang: "en", entry_id: entry.entryId, is_drill: false, segments: 1, cost_estimate_cents: 2, at: OCTOBER },
      { kind: "sms", purpose: "alert", model: "twilio", delivery_id: ids[1], lang: "en", entry_id: entry.entryId, is_drill: false, segments: 1, cost_estimate_cents: 2, at: OCTOBER },
    ]);
  });

  it("rounds a text's estimate up to whole cents and takes its language and purpose from the delivery, with no entry for a transactional text", async () => {
    const id = await sendOne({ segments: 3, lang: "ur" });
    expect(await estimateOf(id)).toMatchObject([{ purpose: "transactional", lang: "ur", entry_id: null, is_drill: false, segments: 3, cost_estimate_cents: 5 }]);
  });

  it("marks the text of a drill, which went to the drill roster, apart from a real alert's", async () => {
    const drill = await world.seedAlert({ isDrill: true, recipients: 1 });
    const real = await world.seedAlert({ recipients: 1 });
    await dispatcher().run();
    expect(await estimateOf(drill.ids[0])).toMatchObject([{ is_drill: true, purpose: "alert" }]);
    expect(await estimateOf(real.ids[0])).toMatchObject([{ is_drill: false, purpose: "alert" }]);
  });

  it("is written for an outcome of unknown too (the text may have been charged), with no provider id, and in the transaction that records the unknown", async () => {
    const id = await sendOne({}, { kind: "no_answer", reason: "timeout" });
    expect(await world.stateOf(id)).toBe("unknown");
    expect(await estimateOf(id)).toMatchObject([{ cost_estimate_cents: 2, segments: 1 }]);
    expect(await world.opsEvents("delivery.unknown")).toHaveLength(1);
    expect((await world.rowOf(id)).provider_message_id).toBeNull();
  });

  it("is not written for a text that goes back to the queue, so a retried text is counted once, when it is finally accepted (429, then accepted)", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer((_s, n) => (n === 1 ? { kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too Many Requests" } : accepted(sidOf(n))));
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("queued");
    expect(await estimates()).toEqual([]);
    world.clock.advance(31_000);
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("submitted");
    expect(world.provider.calls).toHaveLength(2);
    expect(await estimateOf(id)).toHaveLength(1);
  });

  it("is not written for a text that is never accepted (429 three times, then failed), nor for one the provider refuses for good", async () => {
    const [retried] = await world.seedTransactional(1);
    world.provider.answer({ kind: "not_sent", reason: "connection_refused" });
    for (const waitMs of [0, 31_000, 121_000, 601_000]) {
      world.clock.advance(waitMs);
      await dispatcher().run();
    }
    expect(await world.stateOf(retried)).toBe("failed");
    expect(world.provider.calls).toHaveLength(4);
    const refused = await sendOne({}, { kind: "rejected", httpStatus: 400, errorCode: 21211, message: "invalid number" });
    expect(await world.stateOf(refused)).toBe("failed");
    expect(await estimates()).toEqual([]);
  });

  it("is written by the sweep for a text handed off that has no outcome after 5 minutes (it may have been charged), once, and not again when a submitted text ages into unknown after 24 hours", async () => {
    const stale = await handedOffUnsettled();
    const submitted = await sendOne();
    expect(await estimateOf(stale)).toEqual([]);
    expect(await estimateOf(submitted)).toHaveLength(1);
    world.clock.advance(6 * 60_000);
    await dispatcher().run();
    expect(await world.stateOf(stale)).toBe("unknown");
    expect(await estimateOf(stale)).toMatchObject([{ cost_estimate_cents: 2 }]);
    world.clock.advance(25 * 3_600_000);
    await dispatcher().run();
    expect(await world.stateOf(submitted)).toBe("unknown");
    // Counted when it was submitted: the sweep that ages it into unknown adds nothing, and a replay of the stale row adds nothing either.
    expect(await estimateOf(submitted)).toHaveLength(1);
    expect(await estimateOf(stale)).toHaveLength(1);
    expect(await estimates()).toHaveLength(2);
  });

  it("is never written twice for one delivery, whatever calls the hook again", async () => {
    const id = await sendOne();
    await countText(id, "submitted");
    await countText(id, "unknown");
    expect(await estimateOf(id)).toHaveLength(1);
    expect(await estimates()).toHaveLength(1);
  });

  it("takes the database's clock for the moment of the estimate when no clock is given", async () => {
    const plain = createSmsSpend({ pricePerSegmentCents: PRICE });
    const id = await sendOne();
    await owner`delete from spend_event where delivery_id = ${id}`;
    const before = Date.now();
    await app.transaction(async (tx) => plain.afterOutcome(tx, viewOf(await world.rowOf(id)), "submitted"));
    const [row] = await estimates();
    expect(Math.abs((row.at as Date).getTime() - before)).toBeLessThan(30_000);
  });
});

describe("a failing hook (S06.08, with the real hook)", () => {
  it("in a run's own outcome write rolls the outcome back with it: the row stays handed off with no outcome, nothing is counted, and the sweep makes it unknown", async () => {
    const [id] = await world.seedTransactional(1);
    const restore = await refuseEstimateFor(id);
    try {
      await dispatcher().run();
    } finally {
      await restore();
    }
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id, row.handed_off_at instanceof Date]).toEqual(["claimed", null, true]);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_unrecorded")).toBe(true);
    expect(await estimateOf(id)).toEqual([]);
    world.clock.advance(6 * 60_000);
    await dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    expect(await estimateOf(id)).toHaveLength(1);
  });

  it("never stops the sending that follows it: the stale row still becomes unknown with its event, the failure is logged by id and error name, and the fire alert is submitted and counted", async () => {
    const stale = await handedOffUnsettled();
    world.clock.advance(6 * 60_000);
    const fire = await world.seedAlert({ types: ["fire"], recipients: 2 });
    const restore = await refuseEstimateFor(stale);
    try {
      for (let run = 0; run < 3; run += 1) {
        await dispatcher().run();
        world.clock.advance(60_000);
      }
    } finally {
      await restore();
    }
    expect(await world.stateOf(stale)).toBe("unknown");
    expect((await world.opsEvents("delivery.unknown")).filter((event) => event.subject_id === stale)).toHaveLength(1);
    expect(world.lines.filter((line) => line.evt === "dispatch.sweep_spend_hook_failed").map((line) => line.fields.delivery_id)).toEqual([stale]);
    expect(await world.statesOf(fire.ids)).toEqual({ [fire.ids[0]]: "submitted", [fire.ids[1]]: "submitted" });
    expect(await estimateOf(stale)).toEqual([]);
    expect((await estimates()).map((row) => row.delivery_id).sort()).toEqual([...fire.ids].sort());
  });

  it("leaves that unknown text's cost to the reconciliation, which counts the message at its actual price as an unmatched actual, so it is not dropped", async () => {
    const stale = await handedOffUnsettled();
    world.clock.advance(6 * 60_000);
    const restore = await refuseEstimateFor(stale);
    try {
      await dispatcher().run();
    } finally {
      await restore();
    }
    expect(await world.stateOf(stale)).toBe("unknown");
    // The provider was called for it, so Twilio billed a message that the app has no estimate for and no id of.
    const twilio = fakeTwilio([message(sidOf(1))]);
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toMatchObject({ status: "complete", messages: 1, retired: 0 });
    const report = await smsMonthReport(app, "2026-10");
    expect(report).toMatchObject({ status: "complete", actual: { count: 1, cents: 1.106 }, unmatchedActuals: { count: 1, cents: 1.106 }, unresolvedEstimates: { count: 0 } });
  });

  it("never undoes the status of a callback when the hook fails: the status stays, nothing is counted, and the failure is logged by hook and error name", async () => {
    const id = await world.seedTransactional(1).then(async ([only]) => {
      await appSql`update delivery set state = 'claimed', claimed_by = 'old-worker', claim_token = ${randomUUID()} where id = ${only}`;
      await appSql`update delivery set handed_off_at = now() where id = ${only}`;
      return only;
    });
    const restore = await refuseEstimateFor(id);
    try {
      await expect(callbacks().handle(await callbackFor(id, "delivered", sidOf(7)))).resolves.toMatchObject({ kind: "applied", from: "claimed", to: "delivered" });
    } finally {
      await restore();
    }
    expect(await world.stateOf(id)).toBe("delivered");
    expect(await estimateOf(id)).toEqual([]);
    expect(world.lines.find((line) => line.evt === "callback.spend_hook_failed")?.fields).toMatchObject({ hook: "outcome", delivery_id: id });
  });
});

// --- the callback that moves a claimed row -------------------------------------------------------------------------------

describe("the estimate when a callback arrives first (S06.08)", () => {
  async function claimedAndHandedOff(): Promise<string> {
    const [id] = await world.seedTransactional(1);
    await appSql`update delivery set state = 'claimed', claimed_by = 'old-worker', claim_token = ${randomUUID()} where id = ${id}`;
    await appSql`update delivery set handed_off_at = now() where id = ${id}`;
    return id;
  }

  it("writes the estimate once, with the callback's status, for the callback that moves a claimed row; a repeat adds nothing", async () => {
    const id = await claimedAndHandedOff();
    const service = callbacks();
    await expect(service.handle(await callbackFor(id, "delivered", sidOf(1)))).resolves.toMatchObject({ kind: "applied", from: "claimed", to: "delivered" });
    await expect(service.handle(await callbackFor(id, "delivered", sidOf(1)))).resolves.toMatchObject({ kind: "ignored" });
    expect(await estimateOf(id)).toMatchObject([{ cost_estimate_cents: 2 }]);
    // The dispatcher's late answer for the same row changes nothing and counts nothing again.
    expect(await estimates()).toHaveLength(1);
  });

  it("counts a text once when the dispatcher's own answer comes after the callback, in either order", async () => {
    const [first] = await world.seedTransactional(1);
    world.provider.answer(async (_s, n) => {
      // The signed callback arrives before the dispatcher has recorded Twilio's response.
      await callbacks().handle(await callbackFor(first, "delivered", sidOf(n)));
      return accepted(sidOf(n));
    });
    await dispatcher().run();
    expect(await world.stateOf(first)).toBe("delivered");
    expect(await estimateOf(first)).toHaveLength(1);

    const [second] = await world.seedTransactional(1);
    world.provider.answer(accepted(sidOf(50)));
    await dispatcher().run();
    await callbacks().handle(await callbackFor(second, "delivered", sidOf(50)));
    expect(await estimateOf(second)).toHaveLength(1);
    expect(await estimates()).toHaveLength(2);
  });

  it("does not count again a callback that resolves an unknown (its estimate was written when it became unknown) or finishes a submitted text", async () => {
    const unknown = await sendOne({}, { kind: "no_answer", reason: "timeout" });
    const submitted = await sendOne({}, accepted(sidOf(60)));
    expect(await estimates()).toHaveLength(2);
    const service = callbacks();
    await service.handle(await callbackFor(unknown, "delivered", sidOf(61)));
    await service.handle(await callbackFor(submitted, "delivered", sidOf(60)));
    expect(await world.stateOf(unknown)).toBe("delivered");
    expect(await estimates()).toHaveLength(2);
  });
});

// --- the reconciliation -------------------------------------------------------------------------------------------------

describe("a reconciliation (S06.08)", () => {
  it("lists exactly the month's interval in UTC under the stable id, follows next_page_uri to the last page, and records each message's price once, converted and labelled", async () => {
    const twilio = fakeTwilio([1, 2, 3, 4, 5].map((n) => message(sidOf(n), { dateSent: new Date(`2026-10-1${n}T15:00:00Z`) })), { pageSize: 2 });
    const result = await reconciler(twilio).reconcile(OCT);
    expect(result).toEqual({ status: "complete", messages: 5, imported: 5, alreadyImported: 0, outsideInterval: 0, rematched: 0, retired: 0 });
    // The interval is exact and in UTC: October in Toronto is [04:00Z on the 1st, 04:00Z on 1 November).
    expect(twilio.state.requests).toEqual(["first 2026-10-01T04:00:00.000Z 2026-11-01T04:00:00.000Z", "next /fake/Messages.json?page=2", "next /fake/Messages.json?page=3"]);
    expect(await reconciliationRow(OCT)).toMatchObject({
      id: OCT,
      interval_start: new Date("2026-10-01T04:00:00Z"),
      interval_end: new Date("2026-11-01T04:00:00Z"),
      state: "complete",
      pending_reason: null,
      attempts: 1,
      usd_to_cad_rate: "1.4",
      messages: 5,
      imported: 5,
    });
    expect(await actuals()).toHaveLength(5);
    // Converted at the configured rate (0.0079 USD x 1.4 = 1.106 cents), as the provider reported it, labelled with the rate and the currency.
    expect((await actuals())[0]).toMatchObject({ message_sid: sidOf(1), reconciliation_id: OCT, price_text: "-0.00790", price_unit: "USD", rate: "1.4", cad_millicents: "1106" });
  });

  it("keeps only the messages of the exact interval, and only outbound ones: the first instant is in, the first instant of the next month is out, an inbound message is no cost of the app's", async () => {
    const twilio = fakeTwilio([
      message(sidOf(1), { dateSent: new Date("2026-10-01T03:59:59Z") }),
      message(sidOf(2), { dateSent: new Date("2026-10-01T04:00:00Z") }),
      message(sidOf(3), { dateSent: new Date("2026-11-01T03:59:59Z") }),
      message(sidOf(4), { dateSent: new Date("2026-11-01T04:00:00Z") }),
      message(sidOf(5), { direction: "inbound", price: null }),
    ]);
    const result = await reconciler(twilio).reconcile(OCT);
    expect(result).toMatchObject({ status: "complete", messages: 2, imported: 2, outsideInterval: 2 });
    expect((await actuals()).map((row) => row.message_sid)).toEqual([sidOf(2), sidOf(3)]);
  });

  it("changes nothing when the same reconciliation runs again: it is not listed again, no actual is added and no further estimate retired", async () => {
    const d1 = await sendOne({}, accepted(sidOf(1)));
    const twilio = fakeTwilio([message(sidOf(1)), message(sidOf(2))]);
    await reconciler(twilio).reconcile(OCT);
    const before = JSON.stringify([await actuals(), await retirements(), await reconciliationRow(OCT), await estimates()]);
    twilio.state.requests.length = 0;
    // Even with a listing that would now say more, a complete reconciliation is final.
    twilio.state.messages = [message(sidOf(1)), message(sidOf(2)), message(sidOf(3))];
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "already_complete" });
    expect(twilio.state.requests).toEqual([]);
    expect(JSON.stringify([await actuals(), await retirements(), await reconciliationRow(OCT), await estimates()])).toBe(before);
    expect(await retiredBy(d1)).toBe(sidOf(1));
  });

  it("imports a message another reconciliation already imported not at all: its actual stays where it is, with its price, and the second reconciliation still completes", async () => {
    const twilio = fakeTwilio([message(sidOf(1), { dateSent: new Date("2026-10-31T20:00:00Z") })]);
    await reconciler(twilio).reconcile(OCT);
    // The provider now reports the same message (its date moved into November, say): the MessageSid is unique across reconciliations.
    reconcilerNow = new Date("2026-12-02T12:00:00Z");
    twilio.state.messages = [message(sidOf(1), { dateSent: new Date("2026-11-02T20:00:00Z"), price: "-0.5" }), message(sidOf(2), { dateSent: new Date("2026-11-03T20:00:00Z") })];
    await expect(reconciler(twilio).reconcile(NOV)).resolves.toMatchObject({ status: "complete", messages: 2, imported: 1, alreadyImported: 1 });
    expect(await actuals()).toMatchObject([
      { message_sid: sidOf(1), reconciliation_id: OCT, price_text: "-0.00790", cad_millicents: "1106" },
      { message_sid: sidOf(2), reconciliation_id: NOV },
    ]);
  });

  it("is not run for a month that has not ended: nothing is listed and nothing is recorded", async () => {
    reconcilerNow = new Date("2026-10-31T23:59:59Z");
    const twilio = fakeTwilio([message(sidOf(1))]);
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "not_ended", endsAt: "2026-11-01T04:00:00.000Z" });
    expect(twilio.state.requests).toEqual([]);
    expect(await reconciliationRow(OCT)).toBeNull();
    expect(await actuals()).toEqual([]);
    reconcilerNow = new Date("2026-11-01T04:00:00Z");
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toMatchObject({ status: "complete" });
  });

  it("refuses an id that is not a month, and an empty month is a complete reconciliation of nothing", async () => {
    const twilio = fakeTwilio([]);
    await expect(reconciler(twilio).reconcile("month:2026-13")).resolves.toEqual({ status: "refused", reason: "id_invalid" });
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "complete", messages: 0, imported: 0, alreadyImported: 0, outsideInterval: 0, rematched: 0, retired: 0 });
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "complete", messages: 0, imported: 0 });
  });

  it("does the work of two runs started at once only once: the second finds the first complete and changes nothing", async () => {
    const twilio = fakeTwilio([message(sidOf(1)), message(sidOf(2))]);
    const results = await Promise.all([reconciler(twilio).reconcile(OCT), reconciler(twilio).reconcile(OCT)]);
    expect(results.map((result) => result.status).sort()).toEqual(["already_complete", "complete"]);
    expect(await actuals()).toHaveLength(2);
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "complete", attempts: 1, imported: 2 });
  });

  it("reconciles what is due: the month before this one and every month still pending, oldest first, and one month's failure never stops the others", async () => {
    // September is pending (never completed), October is the month before this one.
    await appSql`insert into sms_reconciliation (id, interval_start, interval_end, pending_reason, attempts) values ('month:2026-09', '2026-09-01T04:00:00Z', '2026-10-01T04:00:00Z', 'listing_failed', 1)`;
    const twilio = fakeTwilio([message(sidOf(1), { dateSent: new Date("2026-09-15T15:00:00Z") }), message(sidOf(2))]);
    const results = await reconciler(twilio).reconcileDue();
    expect(results.map((entry) => [entry.id, entry.result.status])).toEqual([
      ["month:2026-09", "complete"],
      [OCT, "complete"],
    ]);
    expect((await actuals()).map((row) => [row.message_sid, row.reconciliation_id])).toEqual([
      [sidOf(1), "month:2026-09"],
      [sidOf(2), OCT],
    ]);
    // A second call has nothing left to do but says so.
    expect((await reconciler(twilio).reconcileDue()).map((entry) => entry.result.status)).toEqual(["already_complete"]);
    // A month that fails (here, a database that errors) is reported and the next is still tried.
    const broken = createSmsReconciler({
      db: app,
      lister: twilio.lister,
      providerIds: {
        ofDeliveries: async (_tx, ids) => {
          if (ids.length > 0) throw new Error("boom");
          return [];
        },
      },
      usdToCadRate: RATE,
      now: () => reconcilerNow,
      log: spendLog,
    });
    await sendOne({}, accepted(sidOf(90)));
    expect((await broken.reconcileDue(["2026-08", "2026-07"])).map((entry) => entry.result.status)).toEqual(["failed", "failed"]);
    expect(spendLines.filter((line) => line.evt === "reconcile.failed")).toHaveLength(2);
  });
});

describe("a pending reconciliation (S06.08)", () => {
  /** A month with three accepted texts, estimated at 2 cents each, and a listing the test spoils in some way. */
  async function threeTexts() {
    const ids = [await sendOne({}, accepted(sidOf(1))), await sendOne({}, accepted(sidOf(2))), await sendOne({}, accepted(sidOf(3)))];
    return { ids, good: [message(sidOf(1)), message(sidOf(2)), message(sidOf(3))] };
  }

  async function expectPending(twilio: ReturnType<typeof fakeTwilio>, reason: string, attempts = 1) {
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "pending", reason });
    // Nothing from the listing was recorded, not even the messages that were fine, and no estimate was retired.
    expect(await actuals()).toEqual([]);
    expect(await retirements()).toEqual([]);
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "pending", pending_reason: reason, attempts, completed_at: null, messages: null, imported: null });
    // The interval is shown as pending, with its estimates still counted, never zero.
    const report = await smsMonthReport(app, "2026-10");
    expect(report).toMatchObject({ status: "pending", statusLabel: "pending reconciliation", pending: { reason, attempts }, actual: null, unresolvedEstimates: { count: 3, cents: 6, label: "unresolved estimate" }, countedCents: 6 });
  }

  it("when the listing fails on the first page: nothing recorded, pending, estimates counted", async () => {
    await threeTexts();
    const twilio = fakeTwilio([]);
    twilio.state.failOnPage = 1;
    await expectPending(twilio, "listing_failed");
    expect(spendLines.some((line) => line.evt === "reconcile.listing_failed" && line.fields.page === 1)).toBe(true);
  });

  it("when the listing fails on a later page: what the first pages gave is not recorded", async () => {
    const { good } = await threeTexts();
    const twilio = fakeTwilio(good, { pageSize: 1 });
    twilio.state.failOnPage = 3;
    await expectPending(twilio, "listing_failed");
  });

  it("when the listing is cut short (the page limit or the time limit) while the provider names a next page", async () => {
    const { good } = await threeTexts();
    await expect(reconciler(fakeTwilio(good, { pageSize: 1 }), { limits: { maxPages: 2 } }).reconcile(OCT)).resolves.toEqual({ status: "pending", reason: "cut_short" });
    expect(await actuals()).toEqual([]);
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "pending", pending_reason: "cut_short", attempts: 1 });
    // The time limit: the clock jumps 45 seconds while the first page is read.
    let at = new Date("2026-11-02T12:00:00Z").getTime();
    const slow = fakeTwilio(good, { pageSize: 1 });
    const first = slow.lister.first;
    slow.lister.first = async (range) => {
      const page = await first(range);
      at += 45_000;
      return page;
    };
    await expect(reconciler(slow, { now: () => new Date(at) }).reconcile(OCT)).resolves.toEqual({ status: "pending", reason: "cut_short" });
    expect(await reconciliationRow(OCT)).toMatchObject({ pending_reason: "cut_short", attempts: 2 });
    expect(await actuals()).toEqual([]);
  });

  it("when a message in the interval has no price yet", async () => {
    const { good } = await threeTexts();
    await expectPending(fakeTwilio([good[0], { ...good[1], price: null }, good[2]]), "message_without_price");
  });

  it("when a message has a price this app cannot convert, or lacks an id or a send time", async () => {
    const { good } = await threeTexts();
    await expectPending(fakeTwilio([good[0], { ...good[1], priceUnit: "EUR" }, good[2]]), "price_unusable");
    await owner`delete from sms_reconciliation`;
    await expectPending(fakeTwilio([good[0], { ...good[1], sid: "SM-not-an-id" }, good[2]]), "message_malformed");
  });

  it("is retried later, from the start, and then completes: the attempts are counted, the pending reason goes, and only then is anything recorded and retired", async () => {
    const { ids, good } = await threeTexts();
    const twilio = fakeTwilio([good[0], { ...good[1], price: null }, good[2]]);
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "pending", reason: "message_without_price" });
    await expect(reconciler(twilio).reconcile(OCT)).resolves.toEqual({ status: "pending", reason: "message_without_price" });
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "pending", attempts: 2 });
    // Twilio has now priced the last message.
    twilio.state.messages = good;
    const result = await reconciler(twilio).reconcile(OCT);
    expect(result).toMatchObject({ status: "complete", messages: 3, imported: 3, retired: 3 });
    expect(await reconciliationRow(OCT)).toMatchObject({ state: "complete", pending_reason: null, attempts: 3, messages: 3, imported: 3 });
    expect(await Promise.all(ids.map(retiredBy))).toEqual([sidOf(1), sidOf(2), sidOf(3)]);
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ status: "complete", unresolvedEstimates: { count: 0, cents: 0 } });
  });

  it("is shown as pending with no estimate for a month that was never reconciled, and the estimates of a month with none are zero only because there are none", async () => {
    await threeTexts();
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ status: "pending", pending: { reason: "not_run", attempts: 0 }, unresolvedEstimates: { count: 3, cents: 6 }, countedCents: 6 });
    expect(await smsMonthReport(app, "2026-09")).toMatchObject({ status: "pending", unresolvedEstimates: { count: 0, cents: 0 }, countedCents: 0 });
  });
});

describe("the matching rule (S06.08)", () => {
  it("retires the estimate whose delivery's provider id equals an imported actual's MessageSid, marks it with that MessageSid, and no longer counts it", async () => {
    const id = await sendOne({}, accepted(sidOf(1)));
    await reconciler(fakeTwilio([message(sidOf(1))])).reconcile(OCT);
    expect(await retirements()).toMatchObject([{ message_sid: sidOf(1) }]);
    expect(await retiredBy(id)).toBe(sidOf(1));
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ unresolvedEstimates: { count: 0 }, retiredEstimates: { count: 1, cents: 2 } });
  });

  it("leaves an estimate whose delivery has no provider id counted as an unresolved estimate, and counts an actual no estimate answers for as an unmatched actual, side by side", async () => {
    await sendOne({}, { kind: "no_answer", reason: "timeout" });
    const twilio = fakeTwilio([message(sidOf(9))]);
    await reconciler(twilio).reconcile(OCT);
    const report = await smsMonthReport(app, "2026-10");
    expect(report).toMatchObject({
      status: "complete",
      actual: { cents: 1.106, count: 1, usdToCadRate: 1.4, label: "actual" },
      retiredEstimates: { cents: 0, count: 0, differenceCents: 0 },
      unmatchedActuals: { cents: 1.106, count: 1, label: "unmatched actual" },
      unresolvedEstimates: { cents: 2, count: 1, label: "unresolved estimate" },
      sideBySide: { unresolvedEstimateCents: 2, unmatchedActualCents: 1.106, mayOverlap: true },
      countedCents: 3.106,
    });
    expect(await retirements()).toEqual([]);
  });

  it("reports the actual total, the estimates its actuals retired and the difference, the unmatched actuals and the unresolved estimates of a complete month", async () => {
    // Three accepted texts (estimates 2, 2 and 3 cents), one text whose outcome is unknown with no id (2 cents), and five billed messages.
    await sendOne({}, accepted(sidOf(1)));
    await sendOne({}, accepted(sidOf(2)));
    await sendOne({ segments: 2, lang: "ur" }, accepted(sidOf(3)));
    await sendOne({}, { kind: "no_answer", reason: "timeout" });
    const twilio = fakeTwilio([message(sidOf(1)), message(sidOf(2)), message(sidOf(3), { price: "-0.0158" }), message(sidOf(9)), message(sidOf(10))]);
    await reconciler(twilio).reconcile(OCT);
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({
      month: "2026-10",
      interval: { id: OCT, startUtc: "2026-10-01T04:00:00.000Z", endUtc: "2026-11-01T04:00:00.000Z" },
      status: "complete",
      actual: { cents: 6.636, count: 5 },
      retiredEstimates: { cents: 7, count: 3, differenceCents: -2.576 },
      unmatchedActuals: { cents: 2.212, count: 2 },
      unresolvedEstimates: { cents: 2, count: 1 },
      sideBySide: { unresolvedEstimateCents: 2, unmatchedActualCents: 2.212, mayOverlap: true },
      countedCents: 8.636,
    });
  });

  it("retires an estimate at most once and lets an actual retire at most one: two deliveries that carry one MessageSid are one retirement, and a repeat retires no more", async () => {
    const first = await sendOne({}, accepted(sidOf(1)));
    // A second delivery that (by a fault upstream) carries the same provider id, and is counted as the dispatcher counts a text.
    const [second] = await world.seedTransactional(1);
    await appSql`update delivery set state = 'claimed', claimed_by = 'old-worker', claim_token = ${randomUUID()} where id = ${second}`;
    await appSql`update delivery set handed_off_at = now() where id = ${second}`;
    await appSql`update delivery set state = 'submitted', provider_message_id = ${sidOf(1)} where id = ${second}`;
    await countText(second);
    expect(await estimates()).toHaveLength(2);
    await reconciler(fakeTwilio([message(sidOf(1))])).reconcile(OCT);
    const retired = await retirements();
    expect(retired).toHaveLength(1);
    expect(await Promise.all([retiredBy(first), retiredBy(second)])).toContain(sidOf(1));
    expect([await retiredBy(first), await retiredBy(second)].filter((sid) => sid !== null)).toEqual([sidOf(1)]);
    // Another reconciliation re-runs the matching over every unretired estimate: the actual has retired its one, so the other stays unresolved.
    reconcilerNow = new Date("2026-12-02T12:00:00Z");
    await reconciler(fakeTwilio([])).reconcile(NOV);
    expect(await retirements()).toHaveLength(1);
    expect((await estimates()).length).toBe(2);
  });

  it("retires an estimate found only after its actual was imported: every reconciliation first re-runs the matching over all unretired estimates", async () => {
    // The actual is imported first, and no delivery yet carries its id.
    await reconciler(fakeTwilio([message(sidOf(5))])).reconcile(OCT);
    expect(await retirements()).toEqual([]);
    // The estimate turns up later, written by a path that never ran the hook: a delivery with the id and its estimate.
    const id = await sendOne({}, accepted(sidOf(5)));
    await owner`delete from sms_estimate_retirement`;
    expect(await retiredBy(id)).toBeNull();
    reconcilerNow = new Date("2026-12-02T12:00:00Z");
    await expect(reconciler(fakeTwilio([])).reconcile(NOV)).resolves.toMatchObject({ status: "complete", rematched: 1 });
    expect(await retiredBy(id)).toBe(sidOf(5));
  });

  it("retires an estimate at once when its text is accepted after its actual was imported (a reconciliation can run before the first callback)", async () => {
    await reconciler(fakeTwilio([message(sidOf(5))])).reconcile(OCT);
    const id = await sendOne({}, accepted(sidOf(5)));
    expect(await retiredBy(id)).toBe(sidOf(5));
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ unmatchedActuals: { count: 0 }, unresolvedEstimates: { count: 0 }, retiredEstimates: { count: 1 } });
  });

  it("retires the estimate the moment its delivery's provider id is recorded later, by a late callback, when the actual is already imported", async () => {
    // An ambiguous send: unknown, no provider id. Twilio billed it, and the reconciliation imported the actual as an unmatched one.
    const id = await sendOne({}, { kind: "no_answer", reason: "timeout" });
    await reconciler(fakeTwilio([message(sidOf(7))])).reconcile(OCT);
    expect(await retiredBy(id)).toBeNull();
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ unmatchedActuals: { count: 1 }, unresolvedEstimates: { count: 1 } });
    // Its late callback records the id, and the matching rule runs in that transaction.
    await callbacks().handle(await callbackFor(id, "delivered", sidOf(7)));
    expect((await world.rowOf(id)).provider_message_id).toBe(sidOf(7));
    expect(await retiredBy(id)).toBe(sidOf(7));
    // The unknown's estimate was written once and is retired once; the month now has neither an unresolved estimate nor an unmatched actual.
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ unmatchedActuals: { count: 0 }, unresolvedEstimates: { count: 0 }, retiredEstimates: { count: 1, cents: 2 } });
  });

  it("retires the estimate when the dispatcher's own slow response fills the provider id of a row the sweep made unknown, and the actual is already imported", async () => {
    const [id] = await world.seedTransactional(1);
    await reconciler(fakeTwilio([message(sidOf(1))])).reconcile(OCT);
    world.provider.answer(async (_s, n) => {
      // The response is slow: a sweep has already made the handed-off row unknown (and counted it), with no id.
      world.clock.advance(6 * 60_000);
      await drizzleDispatchStore.sweep(app, {
        skewMs: world.clock.skewMs(),
        maxRows: 10,
        recordUnknown: async (tx, row, cause) => opsRecorder.record(tx, { kind: "delivery.unknown", deliveryId: row.id, detail: { cause } }),
        afterUnknown: async (tx, row, cause) => {
          if (cause === "no_outcome_after_hand_off") await hooks.afterOutcome(tx, row, "unknown");
        },
      });
      return accepted(sidOf(n));
    });
    await dispatcher().run();
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["unknown", sidOf(1)]);
    expect(await estimateOf(id)).toHaveLength(1);
    expect(await retiredBy(id)).toBe(sidOf(1));
  });

  it("never lets a failing matching hook undo the id a slow response filled: its own writes are undone and the failure is logged", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_s, n) => {
      await appSql`update delivery set state = 'unknown' where id = ${id}`;
      return accepted(sidOf(n));
    });
    await dispatcher({
      afterProviderId: async () => {
        throw new RangeError("the matching failed");
      },
    }).run();
    expect((await world.rowOf(id)).provider_message_id).toBe(sidOf(1));
    expect(world.lines.find((line) => line.evt === "dispatch.spend_hook_failed")?.fields).toEqual({ hook: "provider_id", delivery_id: id, error: "RangeError" });
  });
});

// --- the month boundary ------------------------------------------------------------------------------------------------------

describe("the month boundary (S06.08)", () => {
  /** Twilio records the message at 23:59:59 on 31 October in Toronto; the app records its acceptance at 00:00:01 on 1 November. */
  const SENT_BY_TWILIO = new Date("2026-11-01T03:59:59Z");
  const ACCEPTED_BY_APP = new Date("2026-11-01T04:00:01Z");

  async function aTextAcceptedAfterMidnight() {
    spendAt = ACCEPTED_BY_APP;
    const id = await sendOne({}, accepted(sidOf(1)));
    expect(await estimateOf(id)).toMatchObject([{ at: ACCEPTED_BY_APP }]);
    return id;
  }

  const twilio = () => fakeTwilio([message(sidOf(1), { dateSent: SENT_BY_TWILIO })]);

  it("with the earlier month reconciled first: its actual retires the estimate recorded in the next month", async () => {
    const id = await aTextAcceptedAfterMidnight();
    const provider = twilio();
    reconcilerNow = new Date("2026-11-02T12:00:00Z");
    await expect(reconciler(provider).reconcile(OCT)).resolves.toMatchObject({ status: "complete", messages: 1, imported: 1, retired: 1 });
    expect(await retiredBy(id)).toBe(sidOf(1));
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ actual: { count: 1, cents: 1.106 }, retiredEstimates: { count: 1, cents: 2 }, unmatchedActuals: { count: 0 }, unresolvedEstimates: { count: 0 } });
    // November, reconciled afterwards, lists nothing of this message (it is October's) and has no unresolved estimate left: it is not counted twice.
    reconcilerNow = new Date("2026-12-02T12:00:00Z");
    await expect(reconciler(provider).reconcile(NOV)).resolves.toMatchObject({ status: "complete", messages: 0, outsideInterval: 1, rematched: 0 });
    expect(await smsMonthReport(app, "2026-11")).toMatchObject({ status: "complete", actual: { count: 0, cents: 0 }, unresolvedEstimates: { count: 0, cents: 0 }, countedCents: 0 });
  });

  it("with the later month reconciled first: the estimate stays unresolved until the earlier month's import retires it", async () => {
    const id = await aTextAcceptedAfterMidnight();
    const provider = twilio();
    reconcilerNow = new Date("2026-12-02T12:00:00Z");
    await expect(reconciler(provider).reconcile(NOV)).resolves.toMatchObject({ status: "complete", messages: 0, outsideInterval: 1, retired: 0 });
    // Twilio put the message in October, so November's actuals are empty and the estimate (recorded in November) is still unresolved and counted.
    expect(await retiredBy(id)).toBeNull();
    expect(await smsMonthReport(app, "2026-11")).toMatchObject({ status: "complete", actual: { count: 0 }, unresolvedEstimates: { count: 1, cents: 2, label: "unresolved estimate" }, countedCents: 2 });
    // The earlier month is reconciled afterwards: its import retires the estimate found in the next month.
    reconcilerNow = new Date("2026-12-03T12:00:00Z");
    await expect(reconciler(provider).reconcile(OCT)).resolves.toMatchObject({ status: "complete", messages: 1, imported: 1, retired: 1 });
    expect(await retiredBy(id)).toBe(sidOf(1));
    expect(await smsMonthReport(app, "2026-11")).toMatchObject({ unresolvedEstimates: { count: 0, cents: 0 }, countedCents: 0 });
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ actual: { count: 1 }, retiredEstimates: { count: 1 }, unmatchedActuals: { count: 0 } });
  });

  it("puts a send at 23:59 and one at 00:01 Toronto time in different months, the month being the exact interval and not a calendar date in UTC", async () => {
    spendAt = new Date("2026-11-01T03:59:30Z");
    const late = await sendOne({}, accepted(sidOf(1)));
    spendAt = new Date("2026-11-01T04:00:30Z");
    const early = await sendOne({}, accepted(sidOf(2)));
    expect(await smsMonthReport(app, "2026-10")).toMatchObject({ unresolvedEstimates: { count: 1 } });
    expect(await smsMonthReport(app, "2026-11")).toMatchObject({ unresolvedEstimates: { count: 1 } });
    expect(await estimateOf(late)).toHaveLength(1);
    expect(await estimateOf(early)).toHaveLength(1);
  });
});

// --- the pilot's delivery measures --------------------------------------------------------------------------------------------

describe("the delivery measures (S06.08, FR-M2, FR-M4)", () => {
  const measures = createDeliveryMeasures();
  const approvedAtOf = async (entryId: string) => (await owner`select approved_at from alert_entry where id = ${entryId}`)[0].approved_at as Date;
  /** The delivery callback, as far as the row goes: a submitted row becomes delivered and the database stamps `completed_at`. */
  const deliver = async (id: string) => {
    await appSql`update delivery set state = 'delivered' where id = ${id}`;
  };

  it("reads the rows of an entry from the database: first hand-off and the 90% mark after approval, over the rows handed off", async () => {
    const { entry, ids } = await world.seedAlert({ recipients: 10 });
    await dispatcher().run();
    for (const id of ids.slice(0, 9)) await deliver(id);
    const approvedAt = await approvedAtOf(entry.entryId);
    const timings = await measures.entryTimings(app, { entryId: entry.entryId, approvedAt });
    expect(timings.drill).toBe(false);
    expect(timings.languages).toHaveLength(1);
    const [english] = timings.languages;
    expect(english).toMatchObject({ lang: "en", handedOff: 10, delivered: 9 });
    expect(english.firstHandOffAfterMs).toBeGreaterThanOrEqual(0);
    expect(english.ninetyPercentDelivered.reached).toBe(true);
    if (english.ninetyPercentDelivered.reached) expect(english.ninetyPercentDelivered.afterApprovalMs).toBeGreaterThanOrEqual(english.firstHandOffAfterMs);
  });

  it("says 'not reached' with the final delivered share when 90% is never reached", async () => {
    const { entry, ids } = await world.seedAlert({ recipients: 4 });
    await dispatcher().run();
    for (const id of ids.slice(0, 3)) await deliver(id);
    const timings = await measures.entryTimings(app, { entryId: entry.entryId, approvedAt: await approvedAtOf(entry.entryId) });
    expect(timings.languages[0]).toMatchObject({ handedOff: 4, delivered: 3, ninetyPercentDelivered: { reached: false, deliveredShare: 0.75 } });
  });

  it("leaves the cancelled, skipped and skipped_env rows out of the denominator", async () => {
    const { entry, ids } = await world.seedAlert({ recipients: 5 });
    await appSql`update delivery set state = 'cancelled' where id = ${ids[0]}`;
    await appSql`update delivery set state = 'skipped' where id = ${ids[1]}`;
    await dispatcher().run();
    expect(await world.statesOf(ids)).toMatchObject({ [ids[0]]: "cancelled", [ids[1]]: "skipped", [ids[2]]: "submitted" });
    const timings = await measures.entryTimings(app, { entryId: entry.entryId, approvedAt: await approvedAtOf(entry.entryId) });
    expect(timings.languages[0]).toMatchObject({ handedOff: 3, delivered: 0 });

    // Under SMS_MODE=log every sendable row becomes skipped_env: nothing was handed off, so there is nothing to measure.
    const logged = await world.seedAlert({ recipients: 3 });
    await dispatcher({ config: { mode: "log" } }).run();
    expect(Object.values(await world.statesOf(logged.ids))).toEqual(["skipped_env", "skipped_env", "skipped_env"]);
    const none = await measures.entryTimings(app, { entryId: logged.entry.entryId, approvedAt: await approvedAtOf(logged.entry.entryId) });
    expect(none.languages).toEqual([]);
  });

  it("reports a drill apart: its texts went to the drill roster", async () => {
    const drill = await world.seedAlert({ isDrill: true, recipients: 2 });
    const real = await world.seedAlert({ recipients: 2 });
    await dispatcher().run();
    const timingsOf = async (entry: { entryId: string }) => measures.entryTimings(app, { entryId: entry.entryId, approvedAt: await approvedAtOf(entry.entryId) });
    expect(await timingsOf(drill.entry)).toMatchObject({ drill: true, languages: [{ handedOff: 2 }] });
    expect(await timingsOf(real.entry)).toMatchObject({ drill: false, languages: [{ handedOff: 2 }] });
  });

  it("reports a correction's attempted reach (the original's recipients, and the correction rows handed off to them) apart from its confirmed reach (correction rows delivered)", async () => {
    const recipients = Array.from({ length: 5 }, () => randomUUID());
    const original = await world.seedAlert({ recipients });
    await dispatcher().run();
    for (const id of original.ids.slice(0, 3)) await deliver(id);
    // The correction goes to every recipient of the original; one of its texts is cancelled (never handed off) and one recipient is new.
    const newcomer = randomUUID();
    const correction = await world.seedAlert({ recipients: [...recipients, newcomer], kind: "correction" });
    await appSql`update delivery set state = 'cancelled' where id = ${correction.ids[4]}`;
    await dispatcher().run();
    for (const id of correction.ids.slice(0, 2)) await deliver(id);
    const reach = await measures.correctionReach(app, { originalEntryId: original.entry.entryId, correctionEntryId: correction.entry.entryId });
    expect(reach).toEqual({ drill: false, originalRecipients: 5, attemptedReach: 4, confirmedReach: 2, attemptedShare: 0.8, confirmedShare: 0.4 });
  });

  it("reports the reach of a drill's correction apart", async () => {
    const recipients = [randomUUID(), randomUUID()];
    const original = await world.seedAlert({ isDrill: true, recipients });
    const correction = await world.seedAlert({ isDrill: true, recipients, kind: "correction" });
    await dispatcher().run();
    const reach = await measures.correctionReach(app, { originalEntryId: original.entry.entryId, correctionEntryId: correction.entry.entryId });
    expect(reach).toMatchObject({ drill: true, originalRecipients: 2, attemptedReach: 2, confirmedReach: 0 });
  });
});
