// The sender against a real database (S06.02): the sender lease and the pause switch and their lock-down, the claim order, the claim,
// a run from claim to outcome with a fake provider and a fake clock (frozen body byte for byte, the burst with a fire alert in it, the
// shared pace across three runs started at once), every provider outcome, the late response after a callback, the sweep, SMS_MODE=log, that
// a phone number is never stored or logged, and what the hand-off re-reads. The races of the hand-off with a cancellation, a close, a
// recipient deletion, a pause and a replacement lease holder are in dispatcherRaces.db.test.ts. The provider is never called for real:
// a fake records every call, and the Twilio adapter is tested against a fake `fetch`.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  CLAIM_RANKS,
  FIRST_ALERT_TYPES,
  LEASE_TTL_MS,
  RECIPIENT_KINDS,
  claimRank,
  createContactResolver,
  drizzleDispatchStore,
  twilioMessageSubmitter,
  type RecipientNumberSource,
} from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { sql as drizzleSql } from "drizzle-orm";
import { FAKE_NUMBER, FAKE_SID } from "./deliveryFixtures";
import { BASE_URL, SERVICE_SID, dispatcherWorld, fakeProvider, fakeResolver, numberOf, sidOf, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appUrl: string;
let appSql: postgres.Sql;
let app: Db;
let world: DispatcherWorld;
const scratchTables: string[] = [];

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  appSql = postgres(appUrl, { max: 6, onnotice: () => {} });
  app = createDb(appUrl);
  world = dispatcherWorld(owner, appSql, app);
  // Open the pool's connections now, so concurrent statements really overlap.
  await Promise.all(Array.from({ length: 6 }, () => app.$client`select pg_sleep(0.1)`));
});

afterAll(async () => {
  await world.reset();
  for (const table of scratchTables) await owner.unsafe(`drop table if exists ${table}`);
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await world.reset();
});

const store = drizzleDispatchStore;

/** Acquires the lease as a run would, for tests of the store on its own. */
async function lease(holder = "test-worker", skewMs = 0) {
  const taken = await store.acquireLease(app, { holder, ttlMs: LEASE_TTL_MS, skewMs });
  if (!taken) throw new Error("the lease was not free");
  return taken;
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}` : String(error);
  }
  throw new Error("expected the database to refuse the statement");
}

// --- the tables ---------------------------------------------------------------------------------------------

describe("the sender's tables", () => {
  it("hold one lease row and one pause row from the start, and nothing in them can be added or taken away by the app", async () => {
    expect(await owner`select id, holder from dispatcher_lease`).toEqual([{ id: 1, holder: "none" }]);
    expect(await owner`select id, paused from messaging_control`).toEqual([{ id: 1, paused: false }]);
    expect(await refusal(() => owner.unsafe("insert into dispatcher_lease (id, token, holder, expires_at, renewed_at, paced_until) values (2, gen_random_uuid(), 'x', now(), now(), now())"))).toMatch(/dispatcher_lease_single_row|duplicate key|violates/);
    expect(await refusal(() => owner.unsafe("insert into messaging_control (id) values (2)"))).toMatch(/messaging_control_single_row/);
    for (const [table, statement] of [
      ["dispatcher_lease", "delete from dispatcher_lease"],
      ["dispatcher_lease", "insert into dispatcher_lease (id, token, holder, expires_at, renewed_at, paced_until) values (1, gen_random_uuid(), 'x', now(), now(), now())"],
      ["dispatcher_lease", "truncate dispatcher_lease"],
      ["messaging_control", "update messaging_control set paused = true"],
      ["messaging_control", "delete from messaging_control"],
      ["messaging_control", "insert into messaging_control (id) values (1)"],
    ]) {
      expect(await refusal(() => appSql.unsafe(statement)), `${table}: ${statement}`).toMatch(/permission denied/);
    }
  });

  it("have row level security on, nothing for anon, authenticated, service_role or PUBLIC, and give the app only what it needs", async () => {
    for (const table of ["dispatcher_lease", "messaging_control"]) {
      const [info] = await owner.unsafe(`select relrowsecurity as rls from pg_class where oid = 'public.${table}'::regclass`);
      expect(info.rls, table).toBe(true);
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        const [privilege] = await owner.unsafe(`select has_table_privilege('${role}', 'public.${table}', 'select, insert, update, delete, truncate, references, trigger') as any_privilege`);
        expect(privilege.any_privilege, `${table} ${role}`).toBe(false);
      }
      const policies = await owner.unsafe(`select roles::text[] as roles from pg_policies where schemaname = 'public' and tablename = '${table}'`);
      for (const policy of policies) expect(policy.roles, table).toEqual(["cvh_app"]);
    }
    const changeable = async (table: string) => {
      const columns = await owner.unsafe(`select column_name from information_schema.columns where table_schema = 'public' and table_name = '${table}' order by column_name`);
      const names: string[] = [];
      for (const { column_name: name } of columns) {
        const [privilege] = await owner.unsafe(`select has_column_privilege('cvh_app', 'public.${table}', '${name}', 'update') as ok`);
        if (privilege.ok) names.push(name);
      }
      return names;
    };
    // The lease: the five columns a run changes, and not the row's id. The pause: nothing yet (S06.06 adds its own grant).
    expect(await changeable("dispatcher_lease")).toEqual(["expires_at", "holder", "paced_until", "renewed_at", "token"]);
    expect(await changeable("messaging_control")).toEqual([]);
    const [select] = await owner`select has_table_privilege('cvh_app', 'public.messaging_control', 'select') as ok`;
    expect(select.ok).toBe(true);
  });

  it("make a pause say who paused, when and why", async () => {
    expect(await refusal(() => owner.unsafe("update messaging_control set paused = true"))).toMatch(/messaging_control_pause_stated/);
    expect(await refusal(() => owner.unsafe("update messaging_control set reason = '   '"))).toMatch(/messaging_control_reason_length/);
    await world.setPause(true);
    expect(await owner`select paused, paused_by is not null as who, paused_at is not null as at, reason from messaging_control`).toEqual([{ paused: true, who: true, at: true, reason: "test pause" }]);
  });

  it("give every delivery its claim rank from the database, whatever the caller says, and agree with the domain's claimRank for every case", async () => {
    // The caller cannot choose: a transactional text to a subscriber is rank 2 even when a row says 0.
    const id = await world.transactionalRow({ claim_rank: 0 });
    expect((await world.rowOf(id)).claim_rank).toBe(CLAIM_RANKS.transactional);
    const oncall = await world.transactionalRow({ recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    expect((await world.rowOf(oncall)).claim_rank).toBe(CLAIM_RANKS.oncall);
    const fire = await world.seedAlert({ types: ["fire"], scope: "buildings" });
    const building = await world.seedAlert({ types: ["power"], scope: "buildings" });
    const neighbourhood = await world.seedAlert({ types: ["power"], scope: "neighbourhood" });
    expect((await world.rowOf(fire.ids[0])).claim_rank).toBe(CLAIM_RANKS.fireOrEvacuationAlert);
    expect((await world.rowOf(building.ids[0])).claim_rank).toBe(CLAIM_RANKS.buildingAlert);
    expect((await world.rowOf(neighbourhood.ids[0])).claim_rank).toBe(CLAIM_RANKS.neighbourhoodAlert);

    // The SQL function is the domain function: every kind, recipient kind, type list and scope.
    const kinds = ["alert", "transactional", "campaign"] as const;
    const typeLists: (string[] | null)[] = [null, [], ["power"], ["fire"], ["power", "evacuation"], ["flood", "fire", "smoke"]];
    const scopes: (string | null)[] = [null, "neighbourhood", "buildings"];
    let compared = 0;
    for (const kind of kinds) {
      for (const recipientKind of RECIPIENT_KINDS) {
        for (const types of typeLists) {
          for (const scope of scopes) {
            const [fromSql] = await owner`select delivery_claim_rank(${kind}, ${recipientKind}, ${types}, ${scope})::int as rank`;
            expect(fromSql.rank, `${kind} ${recipientKind} ${JSON.stringify(types)} ${scope}`).toBe(claimRank({ kind, recipientKind, entryTypes: types, audienceScope: scope }));
            compared += 1;
          }
        }
      }
    }
    expect(compared).toBe(3 * RECIPIENT_KINDS.length * typeLists.length * scopes.length);
    expect(FIRST_ALERT_TYPES).toEqual(["fire", "evacuation"]);
  });

  it("keep the rest of the insert trigger S06.01 made (an alert outside its approval is still refused)", async () => {
    const entry = await world.fx.entry("pending_approval");
    const recipient = randomUUID();
    const insert = () =>
      appSql.begin((tx) =>
        tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
           values (${randomUUID()}, 'alert', 'subscriber', ${recipient}, ${entry.entryId}, 'alerting', 'en', ${entry.bodies.en.body}, ${entry.bodies.en.segments}, 4, ${`${entry.entryId}:${recipient}:sms`})`,
      );
    expect(await refusal(insert)).toMatch(/only inside the approval transaction of its entry/);
  });
});

// --- the sender lease -------------------------------------------------------------------------------------

describe("the sender lease", () => {
  it("is taken by one of any number of acquisitions at once, with a new random token and an expiry 60 seconds ahead", async () => {
    const attempts = await Promise.all([1, 2, 3, 4].map((n) => store.acquireLease(app, { holder: `worker-${n}`, ttlMs: LEASE_TTL_MS, skewMs: 0 })));
    const taken = attempts.filter((result) => result !== null);
    expect(taken).toHaveLength(1);
    const [row] = await owner`select token, holder, extract(epoch from (expires_at - now()))::int as ahead from dispatcher_lease`;
    expect(row.token).toBe(taken[0]!.token);
    expect(row.holder).toMatch(/^worker-[1-4]$/);
    expect(row.ahead).toBeGreaterThan(55);
    expect(row.ahead).toBeLessThanOrEqual(60);
    // Another acquisition while it is held takes nothing and changes nothing.
    expect(await store.acquireLease(app, { holder: "late", ttlMs: LEASE_TTL_MS, skewMs: 0 })).toBeNull();
    expect((await owner`select token from dispatcher_lease`)[0].token).toBe(taken[0]!.token);
  });

  it("is renewed only by its own token, and only while unexpired", async () => {
    const mine = await lease();
    expect(await store.renewLease(app, { token: mine.token, ttlMs: LEASE_TTL_MS, skewMs: 0, paceDebtMs: 0 })).toBe(true);
    expect(await store.renewLease(app, { token: randomUUID(), ttlMs: LEASE_TTL_MS, skewMs: 0, paceDebtMs: 0 })).toBe(false);
    // A renewal that arrives after the expiry (the fake clock 61 seconds later) changes nothing.
    expect(await store.renewLease(app, { token: mine.token, ttlMs: LEASE_TTL_MS, skewMs: 61_000, paceDebtMs: 0 })).toBe(false);
  });

  it("is taken from a holder that stalled past 60 seconds, by a new token, and the old token can then neither renew nor hold", async () => {
    const old = await lease("old");
    expect(await store.acquireLease(app, { holder: "new", ttlMs: LEASE_TTL_MS, skewMs: 59_000 })).toBeNull();
    const replacement = await store.acquireLease(app, { holder: "new", ttlMs: LEASE_TTL_MS, skewMs: 61_000 });
    expect(replacement).not.toBeNull();
    expect(replacement!.token).not.toBe(old.token);
    expect(await store.renewLease(app, { token: old.token, ttlMs: LEASE_TTL_MS, skewMs: 61_000, paceDebtMs: 0 })).toBe(false);
    expect(await app.transaction((tx) => store.leaseHeld(tx, old.token, 61_000))).toBe(false);
    expect(await app.transaction((tx) => store.leaseHeld(tx, replacement!.token, 61_000))).toBe(true);
  });

  it("is given up at the end of a run, so the next run (or an approval's) takes it at once, and hands the pace on", async () => {
    const mine = await lease();
    await store.releaseLease(app, { token: mine.token, skewMs: 0, paceDebtMs: 1500 });
    const next = await store.acquireLease(app, { holder: "next", ttlMs: LEASE_TTL_MS, skewMs: 0 });
    expect(next).not.toBeNull();
    expect(next!.paceBarrierMs).toBeGreaterThan(1000);
    expect(next!.paceBarrierMs).toBeLessThanOrEqual(1500);
    // A token that is no longer the lease's cannot give it up from under its holder.
    await store.releaseLease(app, { token: mine.token, skewMs: 0, paceDebtMs: 0 });
    expect(await store.acquireLease(app, { holder: "third", ttlMs: LEASE_TTL_MS, skewMs: 0 })).toBeNull();
  });
});

// --- the claim -------------------------------------------------------------------------------------------

describe("the claim", () => {
  const claim = (token: string, over: Partial<Parameters<typeof store.claim>[1]> = {}) =>
    store.claim(app, { token, workerId: "worker-a", skewMs: 0, maxRows: 100, maxSegments: 10_000, ...over });

  async function claimedRows(token: string, over: Partial<Parameters<typeof store.claim>[1]> = {}) {
    const result = await claim(token, over);
    if (result.kind !== "claimed") throw new Error("the lease was lost");
    return result.rows;
  }

  it("takes fire and evacuation alerts first, then on-call and other transactional texts, then building before neighbourhood alerts, then oldest first", async () => {
    const labels = new Map<string, string>();
    const label = (ids: string[], name: string) => ids.forEach((id) => labels.set(id, name));
    // Created in the worst order for the claim: the lowest priority first.
    label((await world.seedAlert({ types: ["power"], scope: "neighbourhood", recipients: 2 })).ids, "neighbourhood");
    label(await world.seedTransactional(2), "transactional");
    label((await world.seedAlert({ types: ["power"], scope: "buildings" })).ids, "building");
    label(await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" }), "oncall");
    label((await world.seedAlert({ types: ["evacuation"], scope: "buildings" })).ids, "evacuation");
    label((await world.seedAlert({ types: ["fire"], scope: "neighbourhood" })).ids, "fire");

    const mine = await lease();
    const rows = await claimedRows(mine.token);
    expect(rows.map((row) => labels.get(row.id))).toEqual(["evacuation", "fire", "oncall", "transactional", "transactional", "building", "neighbourhood", "neighbourhood"]);
  });

  it("takes the oldest first among equals", async () => {
    const ids = await world.seedTransactional(6);
    const mine = await lease();
    expect((await claimedRows(mine.token)).map((row) => row.id)).toEqual(ids);
  });

  it("commits claimed with the worker and the lease token, times the claim by the database, and returns the rows in claim order", async () => {
    const [id] = await world.seedTransactional(1);
    const mine = await lease();
    const [row] = await claimedRows(mine.token, { maxRows: 1 });
    expect(row.id).toBe(id);
    expect(row.state).toBe("claimed");
    expect(row.claimedBy).toBe("worker-a");
    expect(row.claimToken).toBe(mine.token);
    expect(Math.abs(row.claimedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await world.stateOf(id)).toBe("claimed");
  });

  it("takes no more rows than asked for and no more segments than it can send, never skipping over a row that does not fit", async () => {
    const ids = await world.seedTransactional(4, (index) => ({ segments: [2, 1, 5, 1][index] }));
    const mine = await lease();
    expect((await claimedRows(mine.token, { maxSegments: 3 })).map((row) => row.id)).toEqual([ids[0], ids[1]]);
    // The rows left in the queue (the 5-segment text and the one behind it) are untouched.
    expect(await world.statesOf([ids[2], ids[3]])).toEqual({ [ids[2]]: "queued", [ids[3]]: "queued" });
    expect(await claimedRows(mine.token, { maxSegments: 4 })).toEqual([]);
    expect((await claimedRows(mine.token, { maxSegments: 6 })).map((row) => row.id)).toEqual([ids[2], ids[3]]);
    const many = await world.seedTransactional(5);
    expect((await claimedRows(mine.token, { maxRows: 2 })).map((row) => row.id)).toEqual([many[0], many[1]]);
  });

  it("leaves a row due later in the queue (a backoff), and takes it once it is due", async () => {
    const [soon, later] = await world.seedTransactional(2);
    await appSql`update delivery set due_at = now() + interval '30 seconds' where id = ${later}`;
    const mine = await lease();
    expect((await claimedRows(mine.token)).map((row) => row.id)).toEqual([soon]);
    // The fake clock 31 seconds on: the database's `now()` plus the skew has passed the row's due_at.
    const second = await claim(mine.token, { skewMs: 31_000 });
    expect(second.kind === "claimed" && second.rows.map((row) => row.id)).toEqual([later]);
  });

  it("skips a row another transaction holds, without waiting (FOR UPDATE SKIP LOCKED)", async () => {
    const [held, free] = await world.seedTransactional(2);
    const mine = await lease();
    const holder = appSql.begin(async (tx) => {
      await tx`select id from delivery where id = ${held} for update`;
      const rows = await claimedRows(mine.token);
      expect(rows.map((row) => row.id)).toEqual([free]);
    });
    await holder;
    expect(await world.statesOf([held, free])).toEqual({ [held]: "queued", [free]: "claimed" });
  });

  it("claims nothing for a lease that is not the token's, or has expired", async () => {
    const ids = await world.seedTransactional(2);
    const mine = await lease();
    expect(await claim(randomUUID())).toEqual({ kind: "lease_lost" });
    expect(await claim(mine.token, { skewMs: 61_000 })).toEqual({ kind: "lease_lost" });
    expect(await world.statesOf(ids)).toEqual({ [ids[0]]: "queued", [ids[1]]: "queued" });
  });

  it("claims only the texts the pause does not apply to while paused: those to on-call numbers", async () => {
    await world.seedTransactional(2);
    await world.seedAlert({ types: ["fire"] });
    const [oncall] = await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    await world.setPause(true);
    const mine = await lease();
    expect((await claimedRows(mine.token)).map((row) => row.id)).toEqual([oncall]);
    await world.setPause(false);
    expect(await claimedRows(mine.token)).toHaveLength(3);
  });

  it("puts back the rows an earlier lease holder claimed and never handed off, and leaves the ones it handed off", async () => {
    const [unhanded, handedOff, queued] = await world.seedTransactional(3);
    const old = await lease("old");
    await claimedRows(old.token, { maxRows: 2 });
    await appSql`update delivery set handed_off_at = now() where id = ${handedOff}`;
    const replacement = await store.acquireLease(app, { holder: "new", ttlMs: LEASE_TTL_MS, skewMs: 61_000 });
    expect(await store.requeueOrphans(app, { token: replacement!.token })).toBe(1);
    const back = await world.rowOf(unhanded);
    expect([back.state, back.attempts, back.claimed_by, back.claim_token, back.handed_off_at]).toEqual(["queued", 0, null, null, null]);
    expect(await world.statesOf([handedOff, queued])).toEqual({ [handedOff]: "claimed", [queued]: "queued" });
    // Nothing of the current holder's own is touched.
    const mine = await claimedRows(replacement!.token, { skewMs: 61_000, maxRows: 1 });
    expect(await store.requeueOrphans(app, { token: replacement!.token })).toBe(0);
    expect(mine).toHaveLength(1);
  });

  it("puts back what a run claimed and did not hand off, by its token alone", async () => {
    const [mineId, handed] = await world.seedTransactional(2);
    const other = await world.seedTransactional(1);
    const token = (await lease()).token;
    await claimedRows(token, { maxRows: 2 });
    await appSql`update delivery set handed_off_at = now() where id = ${handed}`;
    const stranger = randomUUID();
    await appSql`update delivery set state = 'claimed', claimed_by = 'other', claim_token = ${stranger} where id = ${other[0]}`;
    expect(await store.releaseClaims(app, { token })).toBe(1);
    expect(await world.statesOf([mineId, handed, other[0]])).toEqual({ [mineId]: "queued", [handed]: "claimed", [other[0]]: "claimed" });
  });
});

// --- a run, from the claim to the outcome ------------------------------------------------------------------------

describe("a run", () => {
  it("sends each queued text once, in claim order, and records the provider's id; a second run finds nothing to send", async () => {
    const ids = await world.seedTransactional(5);
    const report = await world.dispatcher().run();

    expect(report).toMatchObject({ status: "ok", claimed: 5, handedOff: 5, submitted: 5, requeued: 0, failed: 0, unknown: 0, segments: 5 });
    expect(world.provider.calls.map((call) => call.body)).toEqual((await Promise.all(ids.map(world.rowOf))).map((row) => row.body));
    for (const [index, id] of ids.entries()) {
      const row = await world.rowOf(id);
      expect(row.state).toBe("submitted");
      expect(row.provider_message_id).toBe(sidOf(index + 1));
      expect(row.submitted_at).toBeInstanceOf(Date);
      expect(row.handed_off_at).toBeInstanceOf(Date);
      expect(row.attempts).toBe(0);
    }
    const again = await world.dispatcher().run();
    expect(again).toMatchObject({ status: "ok", claimed: 0, handedOff: 0 });
    expect(world.provider.calls).toHaveLength(5);
  });

  it("releases the lease and any claim at the end, so the next run (or an approval's) is not kept waiting", async () => {
    await world.seedTransactional(2);
    await world.dispatcher().run();
    const [lease] = await owner`select expires_at <= now() as free from dispatcher_lease`;
    expect(lease.free).toBe(true);
    expect(await owner`select 1 from delivery where state = 'claimed'`).toHaveLength(0);
  });

  it("sends the frozen body byte for byte through the Messaging Service, with SmartEncoded=false and the status callback URL, through the real adapter", async () => {
    const urdu = "عمارت 12 میں بجلی بند ہے۔ Reply STOP";
    const english = "Power is out in Building 12 — “elevators” don’t work.  Reply STOP";
    const [ur] = await world.seedTransactional(1, { lang: "ur", body: urdu, segments: 2 });
    const [en] = await world.seedTransactional(1, { body: english });
    const requests: { url: string; init: RequestInit }[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ sid: sidOf(requests.length), status: "queued" }), { status: 201 });
    });
    const submitter = twilioMessageSubmitter({ accountSid: `AC${"0".repeat(32)}`, authToken: "fake-token", baseUrl: "https://twilio.invalid", fetch: fetchMock as unknown as typeof fetch });

    const report = await world.dispatcher({ config: { mode: "live", submitter, messagingServiceSid: SERVICE_SID, publicBaseUrl: BASE_URL } }).run();

    expect(report.submitted).toBe(2);
    expect(requests).toHaveLength(2);
    for (const [index, id] of [ur, en].entries()) {
      const form = Object.fromEntries(new URLSearchParams(requests[index].init.body as string));
      const row = await world.rowOf(id);
      expect(form.Body).toBe(row.body);
      expect(form.SmartEncoded).toBe("false");
      expect(form.MessagingServiceSid).toBe(SERVICE_SID);
      expect(form.StatusCallback).toBe(`${BASE_URL}/api/twilio/status?ref=${row.callback_ref}`);
      expect(form.To).toBe(numberOf(row.recipient_id as string));
      expect(form).not.toHaveProperty("From");
    }
    // Byte for byte, whatever the characters are: the typographic quotes, the dash and the double space stay.
    expect(new URLSearchParams(requests[1].init.body as string).get("Body")).toBe(english);
    expect(new URLSearchParams(requests[0].init.body as string).get("Body")).toBe(urdu);
  });

  it("gives the resolver what the recipient's source needs to judge eligibility: the delivery's kind and purpose", async () => {
    await world.seedTransactional(1, { purpose: "menu_reply" });
    await world.dispatcher().run();
    expect(world.resolver.asked).toHaveLength(1);
    expect(world.resolver.asked[0]).toMatchObject({ kind: "subscriber", deliveryKind: "transactional", purpose: "menu_reply" });
  });

  describe("a burst of 300 queued texts with a fire alert approved during it", () => {
    it("claims the fire alert's rows before the remaining lower-priority rows, and the next run picks up where the last stopped, with no text sent twice", async () => {
      const burst = await world.seedTransactional(300, (index) => ({ body: `Burst ${String(index).padStart(3, "0")}. Reply STOP` }));
      let fire: Awaited<ReturnType<DispatcherWorld["seedAlert"]>> | undefined;
      world.provider.answer(async (submission, callNumber) => {
        // The fire alert is approved while the fifth text of the first batch is with the provider.
        if (callNumber === 5) fire = await world.seedAlert({ types: ["fire"], recipients: 4, bodies: { en: { body: "FIRE in your building. Call 911. Reply STOP", encoding: "gsm7", segments: 1 } } });
        return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
      });

      const first = await world.dispatcher().run();

      expect(first.status).toBe("ok");
      // Fewer than all 300: a run plans to send for 50 seconds at 3 segments a second (150), and stops there.
      expect(first.submitted).toBeGreaterThan(100);
      expect(first.submitted).toBeLessThan(160);
      const bodies = world.provider.calls.map((call) => call.body);
      const fireAt = bodies.map((body, index) => (body.startsWith("FIRE") ? index : -1)).filter((index) => index >= 0);
      // The first batch (10 rows) was claimed before the alert was approved; the next claim takes the fire alert's four rows first.
      expect(fireAt).toEqual([10, 11, 12, 13]);
      // Everything else went in creation order, and the burst's rows were not reordered by the alert.
      const burstSent = bodies.filter((body) => body.startsWith("Burst"));
      expect(burstSent).toEqual(burst.slice(0, burstSent.length).map((_, index) => `Burst ${String(index).padStart(3, "0")}. Reply STOP`));

      // Run until the queue is empty: each run picks up where the last stopped.
      for (let runs = 0; runs < 4; runs += 1) {
        const next = await world.dispatcher().run();
        if (next.claimed === 0) break;
      }
      const all = world.provider.calls.map((call) => call.body);
      expect(all).toHaveLength(304);
      // Each row was sent once: the status callback URL carries the row's own reference, so 304 calls are 304 different rows.
      expect(new Set(world.provider.calls.map((call) => call.statusCallback)).size).toBe(304);
      const burstAll = all.filter((body) => body.startsWith("Burst"));
      expect(burstAll).toEqual(burst.map((_, index) => `Burst ${String(index).padStart(3, "0")}. Reply STOP`));
      expect(fire).toBeDefined();
      expect(await owner`select count(*)::int as n from delivery where state <> 'submitted'`).toEqual([{ n: 0 }]);
      expect(await owner`select count(*)::int as n from delivery where provider_message_id is null`).toEqual([{ n: 0 }]);
    }, 120_000);
  });

  describe("the shared pace, with three runs started at once and a fake clock", () => {
    it("results in one sender, and never more than 3 segments in any second over a minute", async () => {
      await world.seedTransactional(200, (index) => ({ segments: 1 + (index % 3 === 0 ? 1 : 0) }));
      const start = world.clock.ms();
      const finished: unknown[] = [];
      // The sender is held at its first provider call until the other two runs have come and gone: the three really overlap.
      world.provider.answer(async (_submission, callNumber) => {
        if (callNumber === 1) await world.until(() => finished.length >= 2, "the other two runs to finish");
        return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
      });
      const track = (run: Promise<unknown>) => run.then((report) => (finished.push(report), report));
      const reports = (await Promise.all([track(world.dispatcher().run()), track(world.dispatcher().run()), track(world.dispatcher().run())])) as Awaited<ReturnType<ReturnType<typeof world.dispatcher>["run"]>>[];

      const senders = reports.filter((report) => report.claimed > 0);
      const bystanders = reports.filter((report) => report.status === "lease_held");
      expect(senders).toHaveLength(1);
      expect(bystanders).toHaveLength(2);
      for (const report of bystanders) expect(report).toMatchObject({ claimed: 0, handedOff: 0, submitted: 0 });
      // One worker, one lease token on every row that was claimed.
      expect(await owner`select count(distinct claim_token)::int as tokens, count(distinct claimed_by)::int as workers from delivery where claim_token is not null`).toEqual([{ tokens: 1, workers: 1 }]);

      const calls = world.provider.calls;
      expect(calls.length).toBeGreaterThan(50);
      const rows = await owner`select body, segments from delivery`;
      const segmentsByBody = new Map(rows.map((row) => [row.body as string, row.segments as number]));
      const weight = (call: (typeof calls)[number]) => segmentsByBody.get(call.body) ?? 1;
      for (const call of calls) {
        const inWindow = calls.filter((other) => other.at > call.at - 1000 && other.at <= call.at).reduce((sum, other) => sum + weight(other), 0);
        expect(inWindow, `the second ending at ${call.at - start} ms`).toBeLessThanOrEqual(3);
      }
      const inTheMinute = calls.filter((call) => call.at - start < 60_000).reduce((sum, call) => sum + weight(call), 0);
      expect(inTheMinute).toBeLessThanOrEqual(180);
    }, 120_000);

    it("keeps the pace between one run and the next: the lease holder hands on what the provider was last given", async () => {
      await world.seedTransactional(8);
      const first = await world.dispatcher({ runLimitMs: 12_000, marginMs: 10_000 }).run();
      expect(first.submitted).toBeGreaterThan(0);
      expect(first.submitted).toBeLessThan(8);
      // The next run starts at the very instant the last one ended, and still keeps to 3 a second across the two.
      await world.dispatcher().run();
      const calls = world.provider.calls;
      expect(calls).toHaveLength(8);
      for (const call of calls) expect(calls.filter((other) => other.at > call.at - 1000 && other.at <= call.at).length).toBeLessThanOrEqual(3);
    });
  });
});

// --- every provider outcome ----------------------------------------------------------------------------------

describe("each provider outcome", () => {
  async function one(answer: Parameters<typeof world.provider.answer>[0]) {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(answer);
    const report = await world.dispatcher().run();
    return { id, report, row: await world.rowOf(id) };
  }

  it("acceptance gives submitted with the provider's id, counted once", async () => {
    const { row, report } = await one({ kind: "accepted", httpStatus: 201, status: "queued", messageId: FAKE_SID });
    expect([row.state, row.provider_message_id, row.attempts]).toEqual(["submitted", FAKE_SID, 0]);
    expect(report.submitted).toBe(1);
  });

  it("HTTP 429 with an error body re-queues with a 30 second backoff and counts an attempt", async () => {
    const { id, row, report } = await one({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" });
    expect([row.state, row.attempts, row.claimed_by, row.claim_token, row.handed_off_at, row.provider_message_id]).toEqual(["queued", 1, null, null, null, null]);
    expect(report).toMatchObject({ requeued: 1, submitted: 0, failed: 0, unknown: 0 });
    expect(Math.abs((row.due_at as Date).getTime() - (world.clock.ms() + 30_000))).toBeLessThan(5_000);
    // Not due yet: the next run sends nothing. Once it is due, the same row is sent again (it was never accepted).
    const idle = await world.dispatcher().run();
    expect(idle.claimed).toBe(0);
    expect(world.provider.calls).toHaveLength(1);
    world.clock.advance(31_000);
    world.provider.answer(undefined);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(2);
    expect((await world.rowOf(id)).state).toBe("submitted");
  });

  it("a connection refused before sending re-queues the same way", async () => {
    const { row } = await one({ kind: "not_sent", reason: "connection_refused" });
    expect([row.state, row.attempts, row.handed_off_at]).toEqual(["queued", 1, null]);
  });

  it("backs off 30 seconds, 2 minutes and 10 minutes, and the next text the provider does not accept fails the row for good", async () => {
    // A confirmation may wait 48 hours, so the retries are not cut short by its send_by.
    const [id] = await world.seedTransactional(1, { purpose: "confirmation", recipient_kind: "pending_signup", send_by: new Date(Date.now() + 40 * 3_600_000) });
    world.provider.answer({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" });
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      world.clock.advance(11 * 60_000);
      await world.dispatcher().run();
      const row = await world.rowOf(id);
      expect([row.state, row.attempts]).toEqual(["queued", attempt]);
      delays.push(Math.round(((row.due_at as Date).getTime() - world.clock.ms()) / 1000));
    }
    expect(delays.map((seconds) => Math.round(seconds / 10) * 10)).toEqual([30, 120, 600]);
    world.clock.advance(11 * 60_000);
    const last = await world.dispatcher().run();
    const failed = await world.rowOf(id);
    expect([failed.state, failed.attempts, failed.provider_error_code]).toEqual(["failed", 3, 20429]);
    expect(last.failed).toBe(1);
    expect(world.provider.calls).toHaveLength(4);
    // A failed row is never sent again.
    world.clock.advance(60 * 60_000);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(4);
  });

  it("a 400 invalid number gives failed with the provider's code, and is never retried", async () => {
    const { id, row, report } = await one({ kind: "rejected", httpStatus: 400, errorCode: 21211, message: "invalid number" });
    expect([row.state, row.provider_error_code, row.attempts]).toEqual(["failed", 21211, 0]);
    expect(report.failed).toBe(1);
    world.clock.advance(60 * 60_000);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.stateOf(id)).toBe("failed");
  });

  it.each([
    ["a 500", { kind: "rejected", httpStatus: 500, errorCode: null, message: null } as const, "server_error", 500],
    ["a timeout after the request was sent", { kind: "no_answer", reason: "timeout" } as const, "timeout", undefined],
    ["an acceptance followed by a dropped connection", { kind: "no_answer", reason: "accepted_then_dropped" } as const, "accepted_then_dropped", undefined],
    ["an acceptance followed by an error", { kind: "no_answer", reason: "accepted_then_error" } as const, "accepted_then_error", undefined],
    ["a dropped connection", { kind: "no_answer", reason: "connection_lost" } as const, "connection_lost", undefined],
  ])("%s gives unknown, recorded in ops_event, and the text is never sent again", async (_name, answer, cause, httpStatus) => {
    const { id, row, report } = await one(answer);
    expect([row.state, row.attempts, row.provider_message_id]).toEqual(["unknown", 0, null]);
    expect(row.handed_off_at).toBeInstanceOf(Date);
    expect(report).toMatchObject({ unknown: 1, submitted: 0, requeued: 0, failed: 0 });
    const events = await world.opsEvents("delivery.unknown");
    expect(events).toEqual([{ kind: "delivery.unknown", severity: "error", subject_type: "delivery", subject_id: id, detail: httpStatus === undefined ? { cause } : { cause, http_status: httpStatus } }]);
    // However long it waits, nothing sends an unknown row again.
    for (let run = 0; run < 3; run += 1) {
      world.clock.advance(60 * 60_000);
      await world.dispatcher().run();
    }
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.stateOf(id)).toBe("unknown");
  });

  it("a provider that throws after the request may have been sent gives unknown, never a retry", async () => {
    const { row } = await one(() => {
      throw new Error("socket hang up");
    });
    expect(row.state).toBe("unknown");
    expect((await world.opsEvents("delivery.unknown"))[0].detail).toEqual({ cause: "provider_threw" });
    expect(world.lines.some((line) => line.evt === "dispatch.provider_threw")).toBe(true);
  });

  it("a 429 with no error body is not 'not accepted': the row is unknown", async () => {
    const { row } = await one({ kind: "rejected", httpStatus: 429, errorCode: null, message: null });
    expect(row.state).toBe("unknown");
    expect((await world.opsEvents("delivery.unknown"))[0].detail).toEqual({ cause: "rate_limited_without_error_body", http_status: 429 });
  });

  it("stops the run after repeated 401s (the credentials are wrong), putting the rest back instead of failing the whole queue", async () => {
    const ids = await world.seedTransactional(10);
    world.provider.answer({ kind: "rejected", httpStatus: 401, errorCode: 20003, message: "Authenticate" });
    const report = await world.dispatcher().run();
    expect(report.status).toBe("provider_auth_failed");
    expect(world.provider.calls).toHaveLength(3);
    const states = Object.values(await world.statesOf(ids));
    expect(states.filter((state) => state === "failed")).toHaveLength(3);
    expect(states.filter((state) => state === "queued")).toHaveLength(7);
    expect((await world.opsEvents("dispatch.provider_auth_failed"))[0]).toMatchObject({ severity: "error", detail: { http_status: 401 } });
  });

  it("does not let a 401 followed by good answers stop the run", async () => {
    await world.seedTransactional(6);
    world.provider.answer((_s, n) => (n === 2 || n === 4 ? { kind: "rejected", httpStatus: 401, errorCode: 20003, message: "x" } : { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(n) }));
    const report = await world.dispatcher().run();
    expect(report.status).toBe("ok");
    expect(world.provider.calls).toHaveLength(6);
  });

  it("runs the spend seam in the outcome's own transaction: it sees the row's new state, and when it fails the outcome is not written either", async () => {
    const [seen] = await world.seedTransactional(1);
    const states: string[] = [];
    await world
      .dispatcher({
        afterOutcome: async (tx, delivery, outcome) => {
          const [row] = await tx.execute<{ state: string }>(drizzleSql`select state from delivery where id = ${delivery.id}`);
          states.push(`${outcome}:${row.state}`);
        },
      })
      .run();
    expect(states).toEqual(["submitted:submitted"]);
    expect(await world.stateOf(seen)).toBe("submitted");

    await world.reset();
    const [lost] = await world.seedTransactional(1);
    await world
      .dispatcher({
        afterOutcome: async () => {
          throw new Error("the spend_event insert failed");
        },
      })
      .run();
    // The estimate and the outcome commit together or not at all: the row is still handed off with no outcome (the sweep makes it unknown).
    const row = await world.rowOf(lost);
    expect([row.state, row.provider_message_id, row.handed_off_at instanceof Date]).toEqual(["claimed", null, true]);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_unrecorded")).toBe(true);
  });

  it("keeps a handed-off row handed off, and unknown by the sweep, when the answer cannot be written (it is never queued again)", async () => {
    const [id] = await world.seedTransactional(1);
    const failing = {
      ...drizzleDispatchStore,
      recordOutcome: async () => {
        throw new Error("the database went away");
      },
    };
    const report = await world.dispatcher({ store: failing }).run();
    expect(report.submitted).toBe(0);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_unrecorded")).toBe(true);
    const stuck = await world.rowOf(id);
    expect([stuck.state, stuck.handed_off_at instanceof Date]).toEqual(["claimed", true]);
    // The run's end put back nothing handed off, and the sweep makes it unknown after 5 minutes.
    world.clock.advance(6 * 60_000);
    await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("unknown");
    expect(world.provider.calls).toHaveLength(1);
  });
});

// --- a response that arrives after a callback ---------------------------------------------------------------------

describe("an outcome written after a callback already moved the row on", () => {
  it("does not overwrite a callback's terminal state: the write applies only while the row is still claimed", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_submission, callNumber) => {
      // The signed callback (S06.04) arrives before the dispatcher has recorded Twilio's response: delivered, with the provider's id.
      await appSql`update delivery set state = 'delivered', provider_message_id = ${sidOf(callNumber)} where id = ${id}`;
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
    });
    const report = await world.dispatcher().run();
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["delivered", sidOf(1)]);
    expect(row.completed_at).toBeInstanceOf(Date);
    expect(report.submitted).toBe(0);
    expect(world.lines.some((line) => line.evt === "dispatch.outcome_not_applied")).toBe(true);
  });

  it("does not overwrite a callback's non-terminal state either, and a late failure or unknown changes nothing", async () => {
    for (const answer of [{ kind: "no_answer", reason: "timeout" } as const, { kind: "rejected", httpStatus: 500, errorCode: null, message: null } as const, { kind: "rejected", httpStatus: 400, errorCode: 21211, message: null } as const]) {
      await world.reset();
      const [id] = await world.seedTransactional(1);
      world.provider.answer(async (_s, n) => {
        await appSql`update delivery set state = 'submitted', provider_message_id = ${sidOf(100 + n)} where id = ${id}`;
        return answer;
      });
      await world.dispatcher().run();
      const row = await world.rowOf(id);
      expect([row.state, row.provider_message_id], JSON.stringify(answer)).toEqual(["submitted", sidOf(101)]);
      expect(await world.opsEvents("delivery.unknown")).toHaveLength(0);
    }
  });

  it("only fills a missing provider id on a row the sweep already made unknown, and leaves its state", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_s, n) => {
      // The response is slow: the sweep (a later run's) has already made the handed-off row unknown.
      await appSql`update delivery set state = 'unknown' where id = ${id}`;
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(n) };
    });
    await world.dispatcher().run();
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["unknown", sidOf(1)]);
  });

  it("never replaces a provider id that is there, and says so in the log", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_s, n) => {
      await appSql`update delivery set state = 'submitted', provider_message_id = ${sidOf(500)} where id = ${id}`;
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(n) };
    });
    await world.dispatcher().run();
    expect((await world.rowOf(id)).provider_message_id).toBe(sidOf(500));
    expect(world.lines.some((line) => line.evt === "dispatch.provider_id_differs" && line.fields.delivery_id === id)).toBe(true);
  });

  it("leaves a terminal row without an id alone (a callback failed it): nothing can change it", async () => {
    const [id] = await world.seedTransactional(1);
    world.provider.answer(async (_s, n) => {
      await appSql`update delivery set state = 'failed' where id = ${id}`;
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(n) };
    });
    await world.dispatcher().run();
    const row = await world.rowOf(id);
    expect([row.state, row.provider_message_id]).toEqual(["failed", null]);
  });
});

// --- the sweep --------------------------------------------------------------------------------------------

describe("the sweep", () => {
  async function stateAfterSweep(ids: string[]) {
    const unknown: { id: string; cause: string }[] = [];
    const result = await store.sweep(app, {
      skewMs: world.clock.skewMs(),
      recordUnknown: async (_tx, id, cause) => void unknown.push({ id, cause }),
    });
    return { result, unknown, states: await world.statesOf(ids) };
  }

  /** A row claimed (and optionally handed off) by a run, set up as the app's role does. */
  async function claimed(handedOff: boolean) {
    const [id] = await world.seedTransactional(1);
    await appSql`update delivery set state = 'claimed', claimed_by = 'old-worker', claim_token = ${randomUUID()} where id = ${id}`;
    if (handedOff) await appSql`update delivery set handed_off_at = now() where id = ${id}`;
    return id;
  }

  it("returns a row claimed for more than 5 minutes without a hand-off to the queue, with no attempt counted", async () => {
    const stale = await claimed(false);
    const fresh = await claimed(false);
    world.clock.advance(4 * 60_000);
    expect((await stateAfterSweep([stale, fresh])).states).toEqual({ [stale]: "claimed", [fresh]: "claimed" });
    world.clock.advance(2 * 60_000);
    const { result, states } = await stateAfterSweep([stale, fresh]);
    expect(states).toEqual({ [stale]: "queued", [fresh]: "queued" });
    expect(result).toEqual({ requeued: 2, unknown: [] });
    expect((await world.rowOf(stale)).attempts).toBe(0);
  });

  it("makes a row handed off with no recorded outcome for 5 minutes unknown, never queued", async () => {
    const handedOff = await claimed(true);
    world.clock.advance(4 * 60_000);
    expect((await stateAfterSweep([handedOff])).states[handedOff]).toBe("claimed");
    world.clock.advance(2 * 60_000);
    const { unknown, states } = await stateAfterSweep([handedOff]);
    expect(states[handedOff]).toBe("unknown");
    expect(unknown).toEqual([{ id: handedOff, cause: "no_outcome_after_hand_off" }]);
  });

  it("makes a submitted row with no terminal status after 24 hours unknown, and leaves a younger one", async () => {
    const [young, old] = await world.seedTransactional(2);
    for (const id of [young, old]) {
      await appSql`update delivery set state = 'claimed', claimed_by = 'w', claim_token = ${randomUUID()} where id = ${id}`;
      await appSql`update delivery set handed_off_at = now() where id = ${id}`;
      await appSql`update delivery set state = 'submitted', provider_message_id = ${id === young ? sidOf(1) : sidOf(2)} where id = ${id}`;
    }
    world.clock.advance(23 * 3_600_000);
    expect((await stateAfterSweep([young, old])).states).toEqual({ [young]: "submitted", [old]: "submitted" });
    world.clock.advance(2 * 3_600_000);
    const { unknown, states } = await stateAfterSweep([old]);
    expect(states[old]).toBe("unknown");
    expect(unknown.map((row) => row.cause)).toEqual(["no_terminal_status", "no_terminal_status"]);
  });

  it("records each unknown in ops_event in the same transaction, and sends nothing, in a run", async () => {
    const handedOff = await claimed(true);
    const [submitted] = await world.seedTransactional(1);
    await appSql`update delivery set state = 'claimed', claimed_by = 'w', claim_token = ${randomUUID()} where id = ${submitted}`;
    await appSql`update delivery set handed_off_at = now() where id = ${submitted}`;
    await appSql`update delivery set state = 'submitted', provider_message_id = ${sidOf(9)} where id = ${submitted}`;
    world.clock.advance(25 * 3_600_000);

    const report = await world.dispatcher().run();

    expect(report.sweep).toEqual({ requeued: 0, unknown: 2 });
    expect(world.provider.calls).toHaveLength(0);
    expect(await world.statesOf([handedOff, submitted])).toEqual({ [handedOff]: "unknown", [submitted]: "unknown" });
    const events = await world.opsEvents("delivery.unknown");
    expect(events.map((event) => [event.subject_id, (event.detail as { cause: string }).cause]).sort()).toEqual(
      [
        [handedOff, "no_outcome_after_hand_off"],
        [submitted, "no_terminal_status"],
      ].sort(),
    );
    expect(events.every((event) => event.severity === "error" && event.subject_type === "delivery")).toBe(true);
  });

  it("rolls the whole sweep back when an event cannot be recorded, so no unknown goes unseen", async () => {
    const handedOff = await claimed(true);
    world.clock.advance(6 * 60_000);
    await expect(
      store.sweep(app, {
        skewMs: world.clock.skewMs(),
        recordUnknown: async () => {
          throw new Error("ops_event is unavailable");
        },
      }),
    ).rejects.toThrow(/unavailable/);
    expect(await world.stateOf(handedOff)).toBe("claimed");
  });

  it("makes a requeued unhanded row sendable again, once, and never sends the handed-off one", async () => {
    const unhanded = await claimed(false);
    const handedOff = await claimed(true);
    world.clock.advance(6 * 60_000);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(1);
    expect(await world.statesOf([unhanded, handedOff])).toEqual({ [unhanded]: "submitted", [handedOff]: "unknown" });
  });
});

// --- SMS_MODE=log ---------------------------------------------------------------------------------------------

describe("SMS_MODE=log", () => {
  it("makes each sendable row skipped_env with its body length and segments logged, calls no provider and asks for no number", async () => {
    const ids = await world.seedTransactional(3, (index) => ({ body: `Hello ${index}. Reply STOP`, segments: index + 1 }));
    const unusedProvider = fakeProvider(world.clock);
    const report = await world.dispatcher({ config: { mode: "log" } }).run();

    expect(report).toMatchObject({ status: "ok", claimed: 3, skippedEnv: 3, handedOff: 0, submitted: 0 });
    expect(Object.values(await world.statesOf(ids))).toEqual(["skipped_env", "skipped_env", "skipped_env"]);
    for (const id of ids) {
      const row = await world.rowOf(id);
      expect(row.completed_at).toBeInstanceOf(Date);
      expect(row.handed_off_at).toBeNull();
    }
    expect(unusedProvider.calls).toHaveLength(0);
    expect(world.provider.calls).toHaveLength(0);
    // The number is never asked for: no source is read, and `inbound_reply` rows are not consumed.
    expect(world.resolver.asked).toHaveLength(0);
    const logged = world.lines.filter((line) => line.evt === "dispatch.skipped_env");
    expect(logged.map((line) => [line.fields.body_length, line.fields.segments]).sort()).toEqual([[19, 1], [19, 2], [19, 3]].sort());
    expect(logged.every((line) => typeof line.fields.delivery_id === "string")).toBe(true);
  });

  it("does not sleep for the pace (nothing is sent), and still decides sendability as live does", async () => {
    const [past] = await world.seedTransactional(1);
    const [ok] = await world.seedTransactional(1);
    await appSql`update delivery set due_at = now() where id = ${past}`;
    world.clock.advance(60_000);
    const report = await world.dispatcher({ config: { mode: "log" } }).run();
    expect(world.clock.sleeps).toEqual([]);
    expect(report.skippedEnv).toBe(2);
    expect(await world.statesOf([past, ok])).toEqual({ [past]: "skipped_env", [ok]: "skipped_env" });
  });

  it("skips past the `send_by` as live does: a text too late is skipped, not skipped_env", async () => {
    const [late] = await world.seedTransactional(1, { purpose: "menu_reply" });
    world.clock.advance(31 * 60_000);
    await world.dispatcher({ config: { mode: "log" } }).run();
    expect(await world.stateOf(late)).toBe("skipped");
  });
});

// --- phone numbers are never stored or logged ---------------------------------------------------------------------

describe("a phone number in the sender", () => {
  it("is never stored in any table, logged, or written to ops_event, whatever the outcome", async () => {
    const recipient = randomUUID();
    const resolver = fakeResolver();
    // One fixed recipient number the test can search for.
    const fixed = { resolver: { resolve: async (_tx: unknown, r: { id: string | null }) => (r.id === recipient ? ({ found: true, number: FAKE_NUMBER } as const) : resolver.resolver.resolve(_tx as never, r as never)) } };
    const answers = [
      { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(1) },
      { kind: "rejected", httpStatus: 400, errorCode: 21211, message: `The 'To' number ${FAKE_NUMBER} is not a valid phone number.` },
      { kind: "rejected", httpStatus: 429, errorCode: 20429, message: `Too many requests for ${FAKE_NUMBER}` },
      { kind: "rejected", httpStatus: 500, errorCode: null, message: FAKE_NUMBER },
      { kind: "no_answer", reason: "timeout" },
    ] as const;
    for (const answer of answers) {
      await world.reset();
      await world.seedTransactional(1, { recipient_id: recipient });
      world.provider.answer(answer);
      await world.dispatcher({ resolver: fixed.resolver as never }).run();
      const stored = await world.everythingStored();
      const logged = JSON.stringify(world.lines);
      for (const text of [stored, logged]) {
        expect(text, JSON.stringify(answer)).not.toContain(FAKE_NUMBER);
        expect(text, JSON.stringify(answer)).not.toContain(FAKE_NUMBER.slice(1));
        expect(text, JSON.stringify(answer)).not.toContain("4165550123");
      }
    }
    // The provider was handed the whole number, once per attempt, and nothing else saw it.
    expect(world.provider.calls.every((call) => call.to === FAKE_NUMBER)).toBe(true);
  });

  async function inboundReplyTable() {
    const name = `scratch_dispatch_inbound_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${name} (id uuid primary key, number text not null, expires_at timestamptz not null)`);
    await owner.unsafe(`grant select, insert, delete on ${name} to cvh_app`);
    await owner.unsafe(`grant update on ${name} to cvh_app`);
    await owner.unsafe(`create trigger ${name}_forget_deliveries after delete on ${name} for each row execute function delivery_forget_recipient('inbound_reply')`);
    scratchTables.push(name);
    return name;
  }

  const sourceOver = (table: string): RecipientNumberSource => ({
    async numberOf(tx, recipientId, { consume }) {
      const rows = await tx.execute<{ number: string }>(drizzleSql.raw(`select number from ${table} where id = '${recipientId}' for update`));
      const found = rows[0]?.number ?? null;
      if (found !== null && consume) await tx.execute(drizzleSql.raw(`delete from ${table} where id = '${recipientId}'`));
      return found;
    },
  });

  it("is taken from an inbound_reply row in the hand-off transaction and exists only in the sender's memory until the provider call", async () => {
    const table = await inboundReplyTable();
    const replyId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${replyId}', '${FAKE_NUMBER}', now() + interval '30 minutes')`);
    const [id] = await world.seedTransactional(1, { recipient_kind: "inbound_reply", recipient_id: replyId, purpose: "signup_info", body: "Sign up at https://example.org/join. Reply STOP", send_by: new Date(Date.now() + 25 * 60_000) });
    const originalKey = (await world.rowOf(id)).idempotency_key;
    const resolver = createContactResolver({ sources: { inbound_reply: sourceOver(table) }, log: world.log });
    // At the provider call the row is already gone: the number is nowhere but in this call.
    world.provider.answer(async () => {
      expect(await owner.unsafe(`select 1 from ${table} where id = '${replyId}'`)).toHaveLength(0);
      expect((await world.rowOf(id)).handed_off_at).toBeInstanceOf(Date);
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(1) };
    });

    await world.dispatcher({ resolver }).run();

    expect(world.provider.calls.map((call) => call.to)).toEqual([FAKE_NUMBER]);
    const row = await world.rowOf(id);
    expect([row.state, row.recipient_id, row.idempotency_key]).toEqual(["submitted", null, `detached:${id}`]);
    expect(originalKey).not.toBe(row.idempotency_key);
    expect(await world.everythingStored()).not.toContain(FAKE_NUMBER.slice(1));
    expect(JSON.stringify(world.lines)).not.toContain(FAKE_NUMBER.slice(1));
  });

  it("never retries a signup_info text whose number was taken: a 429 requeues it and the next hand-off skips it as recipient gone", async () => {
    const table = await inboundReplyTable();
    const replyId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${replyId}', '${FAKE_NUMBER}', now() + interval '30 minutes')`);
    const [id] = await world.seedTransactional(1, { recipient_kind: "inbound_reply", recipient_id: replyId, purpose: "signup_info", body: "Sign up. Reply STOP", send_by: new Date(Date.now() + 25 * 60_000) });
    const resolver = createContactResolver({ sources: { inbound_reply: sourceOver(table) }, log: world.log });
    world.provider.answer({ kind: "rejected", httpStatus: 429, errorCode: 20429, message: "Too many requests" });

    await world.dispatcher({ resolver }).run();
    expect(await world.stateOf(id)).toBe("queued");
    world.clock.advance(31_000);
    await world.dispatcher({ resolver }).run();

    expect(await world.stateOf(id)).toBe("skipped");
    expect(world.provider.calls).toHaveLength(1);
  });

  it("stops at a number that is not a number (the source gave something else): the row fails, nothing is sent", async () => {
    const table = await inboundReplyTable();
    const memberId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${memberId}', 'not-a-number', now() + interval '1 day')`);
    const [id] = await world.seedTransactional(1, { recipient_id: memberId });
    const resolver = createContactResolver({ sources: { subscriber: sourceOver(table) }, log: world.log });
    await world.dispatcher({ resolver }).run();
    expect(await world.stateOf(id)).toBe("failed");
    expect(world.provider.calls).toHaveLength(0);
  });
});

// --- what the hand-off re-reads ------------------------------------------------------------------------------------

describe("the hand-off point re-reads whether the row is still sendable", () => {
  it("skips a text whose send_by has passed, without calling the provider", async () => {
    const [id] = await world.seedTransactional(1);
    world.clock.advance(21 * 60_000);
    const report = await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("skipped");
    expect(report).toMatchObject({ stopped: 1, handedOff: 0 });
    expect(world.provider.calls).toHaveLength(0);
  });

  it("skips a text whose recipient is gone, and a recipient that is gone is never asked for a number twice", async () => {
    const recipient = randomUUID();
    const [id] = await world.seedTransactional(1, { recipient_id: recipient });
    world.resolver.gone.add(recipient);
    await world.dispatcher().run();
    expect(await world.stateOf(id)).toBe("skipped");
    expect(world.provider.calls).toHaveLength(0);
  });

  it("cancels the alert text of an entry that was superseded or discarded, whether or not the cancellation reached the row", async () => {
    for (const status of ["superseded", "discarded"] as const) {
      await world.reset();
      const { entry, ids } = await world.seedAlert({ recipients: 2 });
      await owner.begin(async (tx) => {
        await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
        // A discarded entry holds no approval (the table's check); a superseded one keeps the approval it had.
        if (status === "discarded") await tx`update alert_entry set status = 'discarded', approved_by = null, approved_at = null, approved_version = null, approved_hash = null where id = ${entry.entryId}`;
        else await tx`update alert_entry set status = ${status} where id = ${entry.entryId}`;
        await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
      });
      const report = await world.dispatcher().run();
      expect(Object.values(await world.statesOf(ids)), status).toEqual(["cancelled", "cancelled"]);
      expect(report.stopped, status).toBe(2);
      expect(world.provider.calls, status).toHaveLength(0);
    }
  });

  it("cancels the alert text of a closed thread, except the closing entry's, which is sent after the close", async () => {
    const closing = await world.seedAlert({ kind: "final", closes: true, validUntil: new Date(Date.now() - 3_600_000) });
    const other = await world.seedAlert({ kind: "update" });
    await owner`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${other.entry.alertId}`;
    await world.dispatcher().run();
    expect(await world.statesOf([...closing.ids, ...other.ids])).toEqual({ [closing.ids[0]]: "submitted", [other.ids[0]]: "cancelled" });
    expect(world.provider.calls).toHaveLength(1);
  });

  it("skips an ack, update or correction past its valid-until, and sends a final or a withdrawal past it", async () => {
    const past = new Date(Date.now() - 60_000);
    const results: Record<string, string> = {};
    for (const kind of ["ack", "update", "correction", "final", "withdrawal"] as const) {
      await world.reset();
      const { ids } = await world.seedAlert({ kind, validUntil: past });
      await world.dispatcher().run();
      results[kind] = await world.stateOf(ids[0]);
    }
    expect(results).toEqual({ ack: "skipped", update: "skipped", correction: "skipped", final: "submitted", withdrawal: "submitted" });
  });

  it("sends a drill entry only to the drill roster, and never a real entry to it", async () => {
    const drillToRoster = await world.seedAlert({ isDrill: true });
    await world.dispatcher().run();
    expect(await world.stateOf(drillToRoster.ids[0])).toBe("submitted");

    await world.reset();
    const mismatched = [
      await world.seedAlert({ isDrill: true, recipientKind: "subscriber" }).catch(() => undefined),
      await world.seedAlert({ isDrill: false, recipientKind: "roster" }).catch(() => undefined),
    ].filter((seeded) => seeded !== undefined);
    // S06.05's trigger refuses these at insert; until it exists the hand-off is the second defence.
    await world.dispatcher().run();
    for (const seeded of mismatched) expect(await world.stateOf(seeded.ids[0])).toBe("skipped");
    expect(world.provider.calls).toHaveLength(0);
  });

  it("leaves the row claimed (no provider call) when the hand-off cannot be completed, and puts it back at the end of the run", async () => {
    const ids = await world.seedTransactional(2);
    const broken = fakeResolver();
    broken.resolver.resolve = async (_tx, recipient) => {
      if (recipient.deliveryId === ids[0]) throw new Error("no source is wired");
      return { found: true, number: numberOf(recipient.id ?? "") };
    };
    const report = await world.dispatcher({ resolver: broken.resolver }).run();
    expect(world.provider.calls).toHaveLength(1);
    expect(report.submitted).toBe(1);
    expect(await world.statesOf(ids)).toEqual({ [ids[0]]: "queued", [ids[1]]: "submitted" });
    expect(world.lines.some((line) => line.evt === "dispatch.hand_off_failed" && line.fields.delivery_id === ids[0])).toBe(true);
    // The failing row was not claimed again and again in the same run.
    expect(world.lines.filter((line) => line.evt === "dispatch.hand_off_failed")).toHaveLength(1);
  });
});
