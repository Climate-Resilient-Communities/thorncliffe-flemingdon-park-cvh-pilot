// The daily subscriber measures against a real database (S07.10, FR-M1 subscribers): the job stores receiving subscribers by state, pending sign-ups,
// confirmations and deletions by language and neighbourhood as counts only, with no identifier; the trigger on `subscriber` counts every way a subscriber is
// made or removed (the inbound router's YES and STOP included); running the job again on the same Toronto day replaces that day's figures; and the view the Hub
// reads applies the small-number rule (1 to 4 read "fewer than 5", a second cell hidden when one would be revealed, zero shown as 0).
// Every day the job records is relative to the database's own Toronto clock, so the tests pass at any time of day: a test never starts within a minute of
// Toronto's midnight (`clearOfTorontoMidnight` waits it out), so what it seeds, the day the job records and the day it reads are one day. The view's tests use
// a fixed past day the database never compares with its clock. Every number is fictional (555 exchange).
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { createDeliveryQueue } from "../../src/modules/messaging";
import { floorsOfBuilding, neighbourhoodIds } from "../../src/modules/places";
import {
  SUBSCRIBER_LANGS,
  createInboundRouter,
  createRateLimiter,
  createSignup,
  createSubscriberMeasuresJob,
  readSubscriberMeasures,
  subscriberLookup,
  type InboundMessage,
} from "../../src/modules/subscriptions";
import { createDb, type Db } from "../../src/platform/db";
import { BASE_URL, dispatcherWorld, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
const madeNeighbourhoods: string[] = [];

const VERSION = "2026-10-02.1";
const KEY = "a-test-key-for-the-reply-limit";
const RSN = "9100071";
const FLOOR = "0190f000-0000-7000-8000-000000000071";
/** A past day the database never compares with its own clock, for the view's own tests. */
const PAST_DAY = "2026-01-05";

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
  for (const [id, name, fsa] of [
    ["TP", "Thorncliffe Park", "M4H"],
    ["FP", "Flemingdon Park", "M3C"],
  ] as const) {
    if ((await owner`select 1 from neighbourhood where id = ${id}`).length === 0) {
      await owner`insert into neighbourhood (id, name, fsa) values (${id}, ${name}, ${fsa})`;
      madeNeighbourhoods.push(id);
    }
  }
  await owner`insert into building (rsn, neighbourhood_id, address, latitude, longitude, facts_updated_at) values (${RSN}, 'TP', '71 Sample Road', 43.7, -79.34, now()) on conflict do nothing`;
  await owner`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${FLOOR}, ${RSN}, '1', 1, true) on conflict do nothing`;
});

async function clear() {
  await owner`delete from subscriber`;
  await owner`delete from pending_signup`;
  await owner`delete from inbound_seen`;
  await owner`delete from inbound_keyword_count`;
  await owner`delete from inbound_reply`;
  await owner`delete from rate_limit where scope in ('signup', 'signup_info', 'inbound', 'inbound_mute')`;
  await owner`delete from subscriber_event_count`;
  await owner`delete from subscriber_measure`;
  await world.reset();
}

/**
 * Waits until the database's Toronto clock is more than a minute away from midnight. The trigger counts a subscriber made or removed on the Toronto day of
 * the database's now(), and "today" is that clock's day when the job runs: a test that seeds at 23:59:59 and runs the job at 00:00:00 would read a day with
 * none of its seeds. Every test here takes a few seconds at most.
 */
async function clearOfTorontoMidnight() {
  const [{ left }] = await owner`select (86400 - extract(epoch from (now() at time zone 'America/Toronto')::time))::float8 as left`;
  if (Number(left) < 60) await new Promise((resolve) => setTimeout(resolve, (Number(left) + 1) * 1000));
}

beforeEach(async () => {
  await clearOfTorontoMidnight();
  await clear();
}, 90_000);
afterAll(async () => {
  await clear();
  await owner`delete from building_floor where rsn = ${RSN}`;
  await owner`delete from building where rsn = ${RSN}`;
  for (const id of madeNeighbourhoods) await owner`delete from neighbourhood where id = ${id}`;
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

// --- helpers --------------------------------------------------------------------------------------------------------

let serial = 0;
const phone = () => `+1416555${String(1000 + (serial++ % 9000)).padStart(4, "0")}`;

/** `count` subscribers of a language in a neighbourhood in a retention state, made as the owner (the trigger counts each as a confirmation). */
async function subscribers(count: number, lang: string, nbhd: string, state = "active") {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = randomUUID();
    ids.push(id);
    await owner`insert into subscriber (id, phone, lang, neighbourhood_id, consent_version, started_by, retention_state) values (${id}, ${phone()}, ${lang}, ${nbhd}, ${VERSION}, 'web', ${state})`;
  }
  return ids;
}

/** `count` unexpired pending sign-ups (or, with `expired`, ones whose 48 hours have passed). */
async function pendings(count: number, lang: string, nbhd: string, expired = false) {
  for (let i = 0; i < count; i += 1) {
    const created = expired ? new Date(Date.now() - 72 * 3600 * 1000) : new Date();
    await owner`insert into pending_signup (id, phone, lang, neighbourhood_id, consent_version, started_by, created_at, expires_at)
                values (${randomUUID()}, ${phone()}, ${lang}, ${nbhd}, ${VERSION}, 'web', ${created}, ${new Date(created.getTime() + 48 * 3600 * 1000)})`;
  }
}

const job = () => createSubscriberMeasuresJob({ db: app });
const torontoToday = async () => String((await owner`select ((now() at time zone 'America/Toronto')::date)::text as d`)[0]!.d);
const torontoYesterday = async () => String((await owner`select ((now() at time zone 'America/Toronto')::date - 1)::text as d`)[0]!.d);

type Cell = { lang: string; nbhd: string };
/** One stored figure of a day. */
async function stored(day: string, measure: string, cell: Cell): Promise<number | undefined> {
  const [row] = await owner`select n from subscriber_measure where day = ${day}::date and measure = ${measure} and lang = ${cell.lang} and nbhd = ${cell.nbhd}`;
  return row?.n as number | undefined;
}

/** The measures a day has, summed over everything. */
async function totals(day: string): Promise<Record<string, number>> {
  const rows = await owner`select measure, sum(n)::int as n from subscriber_measure where day = ${day}::date group by measure`;
  return Object.fromEntries(rows.map((row) => [row.measure as string, row.n as number]));
}

// --- the job ----------------------------------------------------------------------------------------------------------

describe("the daily measures job", () => {
  it("stores receiving subscribers by state, pending sign-ups, confirmations and deletions by language and neighbourhood", async () => {
    const today = await torontoToday();
    await subscribers(6, "en", "TP");
    await subscribers(3, "ur", "TP");
    await subscribers(5, "en", "FP", "retained");
    await subscribers(2, "en", "TP", "reconsent_pending");
    const leaving = await subscribers(2, "bn", "FP");
    await pendings(7, "hi", "FP");
    await pendings(1, "hi", "FP", true);
    await owner`delete from subscriber where id = any(${leaving})`;

    // The day the job recorded is the day the seeds were counted on (the test starts clear of Toronto's midnight).
    const report = await job().run({ day: "today" });
    expect(report.day).toBe(today);

    expect(await stored(today, "receiving_active", { lang: "en", nbhd: "TP" })).toBe(6);
    expect(await stored(today, "receiving_active", { lang: "ur", nbhd: "TP" })).toBe(3);
    expect(await stored(today, "receiving_active", { lang: "bn", nbhd: "FP" })).toBe(0);
    expect(await stored(today, "receiving_retained", { lang: "en", nbhd: "FP" })).toBe(5);
    expect(await stored(today, "receiving_reconsent_pending", { lang: "en", nbhd: "TP" })).toBe(2);
    // The pending sign-up whose 48 hours have passed is not waiting for a reply.
    expect(await stored(today, "pending_signups", { lang: "hi", nbhd: "FP" })).toBe(7);
    // Every subscriber made today was a confirmation, and the two who left were counted when they left.
    expect(await stored(today, "confirmations", { lang: "en", nbhd: "TP" })).toBe(8);
    expect(await stored(today, "confirmations", { lang: "bn", nbhd: "FP" })).toBe(2);
    expect(await stored(today, "deletions", { lang: "bn", nbhd: "FP" })).toBe(2);
    expect(await stored(today, "deletions", { lang: "en", nbhd: "TP" })).toBe(0);
    expect(await totals(today)).toEqual({
      receiving_active: 9,
      receiving_reconsent_pending: 2,
      receiving_retained: 5,
      pending_signups: 7,
      confirmations: 18,
      deletions: 2,
    });
  });

  it("stores every launch language in every neighbourhood for every measure, zero where there is none", async () => {
    await job().run({ day: "today" });
    const nbhds = Number((await owner`select count(*)::int as n from neighbourhood`)[0]!.n);
    const [{ n }] = await owner`select count(*)::int as n from subscriber_measure`;
    expect(n).toBe(SUBSCRIBER_LANGS.length * nbhds * 6);
    const [{ nonzero }] = await owner`select count(*)::int as nonzero from subscriber_measure where n <> 0`;
    expect(nonzero).toBe(0);
  });

  it("holds counts only: no identifier in the tables, in what the job stores, or in what the Hub reads", async () => {
    const [kept] = await subscribers(1, "en", "TP");
    const pendingNumber = phone();
    await owner`insert into pending_signup (id, phone, lang, neighbourhood_id, consent_version, started_by) values (${randomUUID()}, ${pendingNumber}, 'en', 'TP', ${VERSION}, 'web')`;
    await job().run({ day: "today" });
    for (const table of ["subscriber_measure", "subscriber_event_count"]) {
      const columns = (await owner`select column_name from information_schema.columns where table_name = ${table} order by ordinal_position`).map((row) => row.column_name);
      expect(columns, table).toEqual(table === "subscriber_measure" ? ["day", "measure", "lang", "nbhd", "n"] : ["day", "event", "lang", "nbhd", "n"]);
    }
    const [{ numbers }] = await owner`select (select count(*) from subscriber_measure where n < 0)::int as numbers`;
    expect(numbers).toBe(0);
    const everything = JSON.stringify({
      measure: await owner`select * from subscriber_measure`,
      events: await owner`select * from subscriber_event_count`,
      view: await owner`select * from subscriber_measures`,
      read: await readSubscriberMeasures(app),
    });
    const [subscriber] = await owner`select phone from subscriber where id = ${kept!}`;
    expect(everything).not.toContain(String(subscriber!.phone));
    expect(everything).not.toContain(pendingNumber);
    expect(everything).not.toContain(kept!);
    expect(everything).not.toMatch(/\+1[0-9]{10}/);
    const viewColumns = (await owner`select column_name from information_schema.columns where table_name = 'subscriber_measures' order by ordinal_position`).map((row) => row.column_name);
    expect(viewColumns).toEqual(["day", "measure", "split", "key", "n", "n_shown"]);
  });

  it("records the Toronto day that has just ended by default, and once for the day however often it runs", async () => {
    await subscribers(6, "en", "TP");
    const before = await torontoYesterday();
    const first = await job().run();
    // The clock may cross midnight between the run and a reading: the day is yesterday by either reading.
    expect([before, await torontoYesterday()]).toContain(first.day);
    const cells = await owner`select count(*)::int as n from subscriber_measure where day = ${first.day}::date`;
    await subscribers(1, "en", "TP");
    const second = await job().run();
    expect(second.day).toBe(first.day);
    expect((await owner`select count(*)::int as n from subscriber_measure where day = ${first.day}::date`)[0]!.n).toBe(cells[0]!.n);
    expect(await stored(first.day, "receiving_active", { lang: "en", nbhd: "TP" })).toBe(7);
    expect((await owner`select count(distinct day)::int as n from subscriber_measure`)[0]!.n).toBe(1);
  });

  it("replaces a figure that has fallen to zero instead of leaving the old one", async () => {
    await pendings(6, "fr", "FP");
    const ids = await subscribers(6, "fr", "FP");
    await job().run({ day: "today" });
    const today = await torontoToday();
    expect(await stored(today, "pending_signups", { lang: "fr", nbhd: "FP" })).toBe(6);
    await owner`delete from pending_signup`;
    await owner`delete from subscriber where id = any(${ids})`;
    await job().run({ day: "today" });
    expect(await stored(today, "pending_signups", { lang: "fr", nbhd: "FP" })).toBe(0);
    expect(await stored(today, "receiving_active", { lang: "fr", nbhd: "FP" })).toBe(0);
    expect(await stored(today, "deletions", { lang: "fr", nbhd: "FP" })).toBe(6);
  });

  it("keeps each day's events on that day: yesterday's confirmations are not today's", async () => {
    const today = await torontoToday();
    await owner`insert into subscriber_event_count (day, event, lang, nbhd, n) values (${today}::date - 1, 'confirmed', 'en', 'TP', 11), (${today}::date - 1, 'deleted', 'en', 'TP', 6)`;
    await subscribers(5, "en", "TP");
    await job().run({ day: "today" });
    expect(await stored(today, "confirmations", { lang: "en", nbhd: "TP" })).toBe(5);
    const yesterday = await torontoYesterday();
    await job().run({ day: "yesterday" });
    expect(await stored(yesterday, "confirmations", { lang: "en", nbhd: "TP" })).toBe(11);
    expect(await stored(yesterday, "deletions", { lang: "en", nbhd: "TP" })).toBe(6);
  });
});

// --- the counting of confirmations and deletions ----------------------------------------------------------------------

describe("confirmations and deletions are counted where a subscriber is made or removed", () => {
  const events = async () => {
    const rows = await owner`select event, lang, nbhd, n from subscriber_event_count order by event, lang, nbhd`;
    return rows.map((row) => `${row.event}:${row.lang}:${row.nbhd}:${row.n}`);
  };

  it("counts a subscriber made and a subscriber deleted, with only its language and neighbourhood", async () => {
    const [id] = await subscribers(1, "ps", "FP");
    expect(await events()).toEqual(["confirmed:ps:FP:1"]);
    await owner`delete from subscriber where id = ${id!}`;
    expect(await events()).toEqual(["confirmed:ps:FP:1", "deleted:ps:FP:1"]);
    await subscribers(2, "ps", "FP");
    expect(await events()).toEqual(["confirmed:ps:FP:3", "deleted:ps:FP:1"]);
  });

  it("does not count a change to a subscriber that is not a new one or a deletion", async () => {
    const [id] = await subscribers(1, "en", "TP");
    await appSql`update subscriber set retention_state = 'retained' where id = ${id!}`;
    expect(await events()).toEqual(["confirmed:en:TP:1"]);
  });

  it("counts through the inbound router: YES confirms, STOP deletes", async () => {
    const queue = createDeliveryQueue();
    const signup = createSignup({
      db: app,
      places: { neighbourhoodIds: (executor) => neighbourhoodIds(executor), floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
      subscribers: subscriberLookup(),
      enqueue: (tx, input) => queue.enqueueTransactional(tx, input),
      consentVersion: () => VERSION,
      limiter: () => createRateLimiter({ db: app, key: KEY }),
      pricePerSegmentCents: () => 1.5,
    });
    const router = createInboundRouter({
      db: app,
      places: { floorIdsOf: async (executor, rsn) => (await floorsOfBuilding(executor, rsn))?.map((f) => f.id) ?? null },
      enqueue: (tx, input, now) => createDeliveryQueue(now ? { now: () => now } : {}).enqueueTransactional(tx, input),
      skipRecipientDeliveries: (tx, recipient) => createDeliveryQueue().skipRecipientDeliveries(tx, recipient),
      checkins: { deleteForSubscriber: async () => undefined },
      numberKey: () => KEY,
      publicBaseUrl: () => BASE_URL,
      pricePerSegmentCents: () => 1.5,
      log: { info: () => undefined },
    });
    const from = "+14165550123";
    let sid = 0;
    const text = (body: string, over: Partial<InboundMessage> = {}): InboundMessage => ({ messageSid: `SM${(++sid).toString(16).padStart(32, "0")}`, from, body, optOutType: null, ...over });
    await signup.request({ phone: from, lang: "ur" as never, neighbourhood: "TP", places: [{ rsn: RSN, floors: [FLOOR] }], groups: [], consentVersion: VERSION }, "203.0.113.9");
    expect(await events()).toEqual([]);
    await router.handle(text("YES"));
    expect(await events()).toEqual(["confirmed:ur:TP:1"]);
    await router.handle(text("STOP", { optOutType: "STOP" }));
    expect(await events()).toEqual(["confirmed:ur:TP:1", "deleted:ur:TP:1"]);

    await job().run({ day: "today" });
    const today = await torontoToday();
    expect(await stored(today, "confirmations", { lang: "ur", nbhd: "TP" })).toBe(1);
    expect(await stored(today, "deletions", { lang: "ur", nbhd: "TP" })).toBe(1);
    expect(await stored(today, "receiving_active", { lang: "ur", nbhd: "TP" })).toBe(0);
  });

  it("is written by the trigger alone: the app's role can read the counts and change nothing", async () => {
    for (const table of ["subscriber_event_count", "subscriber_measure"]) {
      const [rls] = await owner`select relrowsecurity from pg_class where relname = ${table}`;
      expect(rls!.relrowsecurity, table).toBe(true);
      for (const role of ["anon", "authenticated", "service_role"]) {
        const [any] = await owner`select has_table_privilege(${role}, ${table}, 'select') or has_table_privilege(${role}, ${table}, 'insert')
                                          or has_table_privilege(${role}, ${table}, 'update') or has_table_privilege(${role}, ${table}, 'delete') as any`;
        expect(any!.any, `${role} on ${table}`).toBe(false);
      }
    }
    const granted = async (table: string) => {
      const rights = [];
      for (const right of ["select", "insert", "update", "delete"]) {
        const [row] = await owner`select has_table_privilege('cvh_app', ${table}, ${right}) as ok`;
        if (row!.ok) rights.push(right);
      }
      return rights.join(",");
    };
    expect(await granted("subscriber_event_count")).toBe("select");
    expect(await granted("subscriber_measure")).toBe("select,insert");
    // The measure's only updatable column is its count.
    const [columns] = await owner`select has_column_privilege('cvh_app', 'subscriber_measure', 'n', 'update') as n, has_column_privilege('cvh_app', 'subscriber_measure', 'lang', 'update') as lang`;
    expect(columns).toEqual({ n: true, lang: false });
    await expect(appSql`insert into subscriber_event_count (day, event, lang, nbhd) values (current_date, 'confirmed', 'en', 'TP')`).rejects.toThrow(/permission denied|row-level security/);
    await expect(appSql`delete from subscriber_measure`).rejects.toThrow(/permission denied/);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [row] = await owner`select has_table_privilege(${role}, 'subscriber_measures', 'select') as ok`;
      expect(row!.ok, role).toBe(false);
    }
  });
});

// --- the view: the small-number rule ------------------------------------------------------------------------------------

describe("the small-number rule in what the Hub reads", () => {
  /** Stores a measure's cells for the fixed past day: `cells` is language, neighbourhood and count. */
  async function put(measure: string, cells: [string, string, number][]) {
    for (const [lang, nbhd, n] of cells) {
      await owner`insert into subscriber_measure (day, measure, lang, nbhd, n) values (${PAST_DAY}::date, ${measure}, ${lang}, ${nbhd}, ${n})`;
    }
  }
  const shown = async (measure: string, split: string) => {
    const rows = await owner`select key, n, n_shown from subscriber_measures where day = ${PAST_DAY}::date and measure = ${measure} and split = ${split} order by key nulls first`;
    return Object.fromEntries(rows.map((row) => [(row.key as string | null) ?? "total", row.n_shown as string]));
  };

  it("shows a count of 1 to 4 as 'fewer than 5' and no number, 0 as 0 and 5 and more as they are", async () => {
    await put("receiving_active", [
      ["en", "TP", 40],
      ["ur", "TP", 3],
      ["ur", "FP", 1],
      ["hi", "FP", 0],
      ["bn", "FP", 12],
    ]);
    // By language: ur is 4 (3 + 1) and so hidden; hi is zero; the total (56) is shown, so the smallest visible cell of 5 or more (bn, 12) is hidden with it.
    expect(await shown("receiving_active", "language")).toEqual({ total: "56", en: "40", ur: "fewer than 5", hi: "0", bn: "not shown" });
    const hidden = await owner`select n from subscriber_measures where day = ${PAST_DAY}::date and measure = 'receiving_active' and split = 'language' and key = 'ur'`;
    expect(hidden[0]!.n).toBeNull();
    // By neighbourhood: TP is 43 and FP 13, both shown.
    expect(await shown("receiving_active", "neighbourhood")).toEqual({ total: "56", TP: "43", FP: "13" });
  });

  it("hides the smallest visible cell as well when a total and the visible cells would reveal the one hidden cell", async () => {
    await put("confirmations", [
      ["en", "TP", 20],
      ["ur", "TP", 3],
      ["hi", "TP", 7],
    ]);
    // 30 - 20 - 7 would give ur's 3: hi (7), the smallest visible cell, is hidden too and reads "not shown", as it may be 5 or more. en stays.
    expect(await shown("confirmations", "language")).toEqual({ total: "30", en: "20", ur: "fewer than 5", hi: "not shown" });
  });

  it("hides no other cell when two cells are hidden already, and hides a total of 1 to 4", async () => {
    await put("deletions", [
      ["en", "TP", 20],
      ["ur", "TP", 2],
      ["hi", "TP", 3],
    ]);
    expect(await shown("deletions", "language")).toEqual({ total: "25", en: "20", ur: "fewer than 5", hi: "fewer than 5" });
    await put("pending_signups", [
      ["en", "TP", 0],
      ["ur", "TP", 3],
    ]);
    expect(await shown("pending_signups", "language")).toEqual({ total: "fewer than 5", en: "0", ur: "fewer than 5" });
  });

  it("never hides a zero for the sake of a small cell: the smallest visible cell of 5 or more goes instead", async () => {
    await put("receiving_retained", [
      ["en", "TP", 9],
      ["ur", "TP", 2],
      ["hi", "TP", 0],
      ["bn", "TP", 0],
    ]);
    expect(await shown("receiving_retained", "language")).toEqual({ total: "11", en: "not shown", ur: "fewer than 5", hi: "0", bn: "0" });
  });

  it("gives the Hub the latest recorded day, split and ordered, with the rule applied", async () => {
    await put("receiving_active", [
      ["ur", "TP", 30],
      ["en", "TP", 30],
      ["en", "FP", 2],
    ]);
    const day = await readSubscriberMeasures(app);
    expect(day?.day).toBe(PAST_DAY);
    const [reading] = day!.measures;
    expect(reading).toMatchObject({ measure: "receiving_active", total: { n: 62, shown: "62" } });
    expect(reading!.byLanguage.map((cell) => cell.lang)).toEqual(["en", "ur"]);
    expect(reading!.byNeighbourhood).toEqual([
      { nbhd: "FP", count: { n: null, shown: "fewer than 5" } },
      { nbhd: "TP", count: { n: null, shown: "not shown" } },
    ]);
    expect(await readSubscriberMeasures(app, "2026-01-06")).toMatchObject({ day: "2026-01-06", measures: [] });
  });

  it("reads nothing before the job has run", async () => {
    expect(await readSubscriberMeasures(app)).toBeNull();
  });
});
