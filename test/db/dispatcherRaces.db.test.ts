// The races of the sender against real concurrent database connections (S06.02): a lease holder that stalls and a replacement that takes
// the lease; a correction approval, a close and a recipient deletion that commit before a hand-off (which then sends nothing) or while
// one holds the row (which then wins, and the change reports the text as in flight); and a pause committed before, or during, a hand-off.
// Every wait is real: a second connection holds a row lock, and the test waits until the other side is waiting for it. The provider is a fake.
import { randomBytes, randomUUID } from "node:crypto";
import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { LEASE_TTL_MS, createDeliveryQueue, drizzleDispatchStore, type ClaimResult, type DispatchStore } from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { deferred, dispatcherWorld, fakeProvider, fakeResolver, sidOf, type DispatcherWorld } from "./dispatcherSupport";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
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
  appSql = postgres(url.href, { max: 8, onnotice: () => {} });
  app = createDb(url.href);
  world = dispatcherWorld(owner, appSql, app);
  await Promise.all(Array.from({ length: 8 }, () => app.$client`select pg_sleep(0.1)`));
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

const real = drizzleDispatchStore;

/** The real store with some calls replaced, to hold a run at a chosen point (a stall) or to look at what it did. */
const decorated = (over: Partial<DispatchStore>): DispatchStore => ({ ...real, ...over });

/** Waits (really) until one of the run's own statements is waiting for a lock another connection holds. */
const untilWaiting = () => world.untilSomeoneWaitsForALock();

// --- a lease holder that stalls ----------------------------------------------------------------------------

describe("a lease holder that stalls for more than 60 seconds", () => {
  it("is replaced: the replacement puts back the old worker's claimed rows, and the old worker's next renewal finds its token changed and stops without calling the provider", async () => {
    const ids = await world.seedTransactional(6);
    const providerA = fakeProvider(world.clock);
    const claimedByA = deferred();
    const resume = deferred();
    const storeA = decorated({
      async claim(db, input) {
        const result = await real.claim(db, input);
        if (result.kind === "claimed" && result.rows.length > 0) {
          claimedByA.resolve();
          await resume.promise;
        }
        return result;
      },
    });
    // A's time limit is long, so it is the lease, not the clock, that stops it.
    const runA = world.dispatcher({ store: storeA, runLimitMs: 30 * 60_000, config: { mode: "live", submitter: providerA, messagingServiceSid: "MG" + "1".repeat(32), publicBaseUrl: "https://cvh.example" } }).run();
    await claimedByA.promise;
    expect(Object.values(await world.statesOf(ids))).toEqual(Array(6).fill("claimed"));

    // The fake clock jumps 61 seconds: A's lease has expired, and a replacement takes it.
    world.clock.advance(61_000);
    const requeued: number[] = [];
    const storeB = decorated({
      async requeueOrphans(db, input) {
        const count = await real.requeueOrphans(db, input);
        requeued.push(count);
        return count;
      },
    });
    const reportB = await world.dispatcher({ store: storeB }).run();

    // The replacement requeued all six rows the old worker claimed and never handed off, then sent each of them once.
    expect(requeued[0]).toBe(6);
    expect(reportB).toMatchObject({ status: "ok", submitted: 6 });
    expect(world.provider.calls).toHaveLength(6);

    resume.resolve();
    const reportA = await runA;
    expect(reportA.status).toBe("lease_lost");
    expect(providerA.calls).toHaveLength(0);
    // No row was handed off twice: six rows, six calls in all, each row once.
    expect(world.provider.calls.length + providerA.calls.length).toBe(6);
    expect(new Set(world.provider.calls.map((call) => call.statusCallback)).size).toBe(6);
    expect(Object.values(await world.statesOf(ids))).toEqual(Array(6).fill("submitted"));
  });

  it("finds its token changed at the hand-off too, when no renewal was due, and calls nothing", async () => {
    const ids = await world.seedTransactional(3);
    const providerA = fakeProvider(world.clock);
    const claimed = deferred();
    const resume = deferred();
    const storeA = decorated({
      async claim(db, input) {
        const result = await real.claim(db, input);
        if (result.kind === "claimed" && result.rows.length > 0) {
          claimed.resolve();
          await resume.promise;
        }
        return result;
      },
    });
    const runA = world
      .dispatcher({
        store: storeA,
        runLimitMs: 30 * 60_000,
        leaseRenewAfterMs: 60 * 60_000,
        config: { mode: "live", submitter: providerA, messagingServiceSid: "MG" + "1".repeat(32), publicBaseUrl: "https://cvh.example" },
      })
      .run();
    await claimed.promise;
    // A replacement takes the lease (and, here, does nothing else).
    world.clock.advance(61_000);
    expect(await real.acquireLease(app, { holder: "replacement", ttlMs: LEASE_TTL_MS, skewMs: world.clock.skewMs() })).not.toBeNull();
    resume.resolve();

    const reportA = await runA;
    expect(reportA.status).toBe("lease_lost");
    expect(providerA.calls).toHaveLength(0);
    // It stopped before handing anything off, and on its way out put back the rows it had claimed (they were never handed off).
    const first = await world.rowOf(ids[0]);
    expect([first.state, first.handed_off_at, first.claim_token]).toEqual(["queued", null, null]);
  });

  it("finds its token changed at its next claim, and stops with what it had already sent", async () => {
    await world.seedTransactional(12);
    const providerA = fakeProvider(world.clock);
    const secondClaimReached = deferred();
    const resume = deferred();
    let claims = 0;
    const storeA = decorated({
      async claim(db, input): Promise<ClaimResult> {
        claims += 1;
        if (claims === 2) {
          secondClaimReached.resolve();
          await resume.promise;
        }
        return real.claim(db, input);
      },
    });
    const runA = world
      .dispatcher({
        store: storeA,
        batchRows: 5,
        runLimitMs: 30 * 60_000,
        leaseRenewAfterMs: 60 * 60_000,
        config: { mode: "live", submitter: providerA, messagingServiceSid: "MG" + "1".repeat(32), publicBaseUrl: "https://cvh.example" },
      })
      .run();
    await secondClaimReached.promise;
    world.clock.advance(61_000);
    expect(await real.acquireLease(app, { holder: "replacement", ttlMs: LEASE_TTL_MS, skewMs: world.clock.skewMs() })).not.toBeNull();
    resume.resolve();

    const reportA = await runA;
    expect(reportA.status).toBe("lease_lost");
    expect(providerA.calls).toHaveLength(5);
    expect(await owner`select count(*)::int as n from delivery where state = 'queued'`).toEqual([{ n: 7 }]);
  });

  it("keeps the hand-off of a row it had already handed off: the replacement leaves it, and the old worker's answer is still recorded", async () => {
    const ids = await world.seedTransactional(3);
    const providerA = fakeProvider(world.clock);
    const inCall = deferred();
    const answer = deferred();
    providerA.answer(async (_submission, callNumber) => {
      if (callNumber === 1) {
        inCall.resolve();
        await answer.promise;
      }
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(900 + callNumber) };
    });
    const runA = world.dispatcher({ runLimitMs: 30 * 60_000, config: { mode: "live", submitter: providerA, messagingServiceSid: "MG" + "1".repeat(32), publicBaseUrl: "https://cvh.example" } }).run();
    await inCall.promise;
    // A has handed the first row off and is waiting for the provider; it has claimed the other two as well.
    const handedOff = (await owner`select id from delivery where handed_off_at is not null`).map((row) => row.id as string);
    expect(handedOff).toEqual([ids[0]]);

    world.clock.advance(61_000);
    const reportB = await world.dispatcher().run();
    // The replacement put back the two unhanded rows and sent them; the handed-off row is left alone (no second submission).
    expect(reportB.submitted).toBe(2);
    expect(world.provider.calls).toHaveLength(2);
    expect(await world.stateOf(ids[0])).toBe("claimed");

    answer.resolve();
    const reportA = await runA;
    // The old worker's late answer still lands on the row it handed off: it is that worker's claim, whatever happened to the lease.
    expect((await world.rowOf(ids[0])).state).toBe("submitted");
    expect((await world.rowOf(ids[0])).provider_message_id).toBe(sidOf(901));
    expect(reportA.status).toBe("lease_lost");
    expect(providerA.calls).toHaveLength(1);
    expect(world.provider.calls.length + providerA.calls.length).toBe(3);
  });
});

// --- a hand-off and the changes that must stop it ---------------------------------------------------------

/** What a change reports: how many of its rows it stopped, and how many it found already in flight. */
interface Change {
  stopped: number;
  inFlight: number;
}

interface Scenario {
  name: string;
  /**
   * Seeds one delivery, and returns its id and the change that must stop it. The change runs in its own transaction on its own
   * connection: it makes its statements, calls `beforeCommit` (the test holds it there, with the row locked, or lets it go), and commits.
   */
  prepare(): Promise<{ id: string; change: (beforeCommit: () => Promise<void>) => Promise<Change>; stoppedAs: "cancelled" | "skipped" }>;
}

async function recipientTable() {
  const name = `scratch_race_recipient_${randomBytes(4).toString("hex")}`;
  await owner.unsafe(`create table ${name} (id uuid primary key)`);
  await owner.unsafe(`grant select, insert, delete on ${name} to cvh_app`);
  await owner.unsafe(`create trigger ${name}_forget_deliveries after delete on ${name} for each row execute function delivery_forget_recipient('subscriber')`);
  scratchTables.push(name);
  return name;
}

const scenarios: Scenario[] = [
  {
    name: "a correction approval",
    async prepare() {
      const { entry, ids } = await world.seedAlert({ recipients: 1 });
      // The correction's approval calls cancelQueued for the original entry, in the correction's own transaction.
      return {
        id: ids[0],
        change: (beforeCommit) =>
          app.transaction(async (tx) => {
            // messaging's cancelQueued (S05.02), the port the correction's approval calls in its own transaction.
            const result = await createDeliveryQueue().cancelQueued([entry.entryId], tx);
            await beforeCommit();
            return { stopped: result.cancelled, inFlight: result.inFlight };
          }),
        stoppedAs: "cancelled",
      };
    },
  },
  {
    name: "a close",
    async prepare() {
      const { entry, ids } = await world.seedAlert({ kind: "update", recipients: 1 });
      // The close calls cancelQueued for every entry but the closing one, and closes the thread, in one transaction.
      return {
        id: ids[0],
        change: (beforeCommit) =>
          app.transaction(async (tx) => {
            const result = await createDeliveryQueue().cancelQueued([entry.entryId], tx);
            await tx.execute(drizzleSql`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${entry.alertId}`);
            await beforeCommit();
            return { stopped: result.cancelled, inFlight: result.inFlight };
          }),
        stoppedAs: "cancelled",
      };
    },
  },
  {
    name: "a recipient deletion",
    async prepare() {
      const table = await recipientTable();
      const recipient = randomUUID();
      await owner.unsafe(`insert into ${table} (id) values ('${recipient}')`);
      const [id] = await world.seedTransactional(1, { recipient_id: recipient });
      const queue = createDeliveryQueue();
      return {
        id,
        // The deleting use case skips the recipient's rows first, then deletes the recipient (whose trigger forgets it on any row left).
        change: (beforeCommit) =>
          app.transaction(async (tx) => {
            const result = await queue.skipRecipientDeliveries(tx, { kind: "subscriber", id: recipient });
            await tx.execute(drizzleSql.raw(`delete from ${table} where id = '${recipient}'`));
            await beforeCommit();
            return { stopped: result.skipped, inFlight: result.inFlight };
          }),
        stoppedAs: "skipped",
      };
    },
  },
];

describe("a claimed-but-not-handed-off row, and a change that commits first on a second connection while the hand-off waits", () => {
  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s: the row is already stopped, the hand-off commits nothing, and the provider records no call", async (_name, scenario) => {
    const { id, change, stoppedAs } = await scenario.prepare();
    const statementsMade = deferred();
    const commit = deferred();
    let changing: Promise<Change> = Promise.resolve({ stopped: 0, inFlight: 0 });
    const store = decorated({
      async claim(db, input) {
        const result = await real.claim(db, input);
        if (result.kind === "claimed" && result.rows.some((row) => row.id === id)) {
          // The row is claimed (committed). Now the change runs on another connection, holds the row, and has not committed yet.
          changing = change(async () => {
            statementsMade.resolve();
            await commit.promise;
          });
          await statementsMade.promise;
        }
        return result;
      },
    });

    const run = world.dispatcher({ store }).run();
    // The hand-off asks for the row and waits for the change; only then does the change commit.
    await untilWaiting();
    commit.resolve();
    const report = await run;
    const outcome = await changing;

    expect(outcome.stopped).toBe(1);
    const row = await world.rowOf(id);
    expect(row.state).toBe(stoppedAs);
    // The hand-off committed nothing: no hand-off, no claim of its own left, and nothing for the provider.
    expect(row.handed_off_at).toBeNull();
    expect(world.provider.calls).toHaveLength(0);
    expect(report).toMatchObject({ handedOff: 0, submitted: 0 });
    expect(world.resolver.asked).toHaveLength(0);
  });
});

describe("the same changes starting while a hand-off transaction holds the row", () => {
  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))("%s: the change waits, sees the row handed off, leaves it unchanged, and reports it as in flight", async (_name, scenario) => {
    const { id, change } = await scenario.prepare();
    const inside = deferred();
    const proceed = deferred();
    const resolver = fakeResolver({
      onResolve: async () => {
        inside.resolve();
        await proceed.promise;
      },
    });
    const run = world.dispatcher({ resolver: resolver.resolver }).run();
    // The hand-off transaction has the delivery row locked and has not committed.
    await inside.promise;
    const changing = change(async () => undefined);
    await untilWaiting();
    proceed.resolve();
    const [report, outcome] = await Promise.all([run, changing]);

    // The hand-off committed first: the text is in flight, so the change stopped nothing and reports it.
    expect(outcome).toEqual({ stopped: 0, inFlight: 1 });
    const row = await world.rowOf(id);
    expect(row.state).toBe("submitted");
    expect(row.handed_off_at).toBeInstanceOf(Date);
    expect(world.provider.calls).toHaveLength(1);
    expect(report).toMatchObject({ handedOff: 1, submitted: 1 });
  });
});

// --- the pause ------------------------------------------------------------------------------------------------

describe("the pause", () => {
  it("committed first: the hand-off finds it, the row returns to queued with nothing counted, and the provider records no call", async () => {
    const ids = await world.seedTransactional(3);
    const store = decorated({
      async claim(db, input) {
        const result = await real.claim(db, input);
        // The pause commits after the rows are claimed and before the first hand-off.
        if (result.kind === "claimed" && result.rows.length > 0) await world.setPause(true);
        return result;
      },
    });

    const report = await world.dispatcher({ store }).run();

    expect(world.provider.calls).toHaveLength(0);
    expect(report).toMatchObject({ handedOff: 0, submitted: 0, stopped: 1 });
    for (const id of ids) {
      const row = await world.rowOf(id);
      expect([row.state, row.attempts, row.claimed_by, row.claim_token, row.handed_off_at], id).toEqual(["queued", 0, null, null, null]);
    }
    // While paused nothing is claimed, so a run after it does nothing either.
    expect((await world.dispatcher().run()).claimed).toBe(0);
    expect(world.provider.calls).toHaveLength(0);
    // After resume the dispatcher continues, and every row is sent once.
    await world.setPause(false);
    await world.dispatcher().run();
    expect(world.provider.calls).toHaveLength(3);
    expect(Object.values(await world.statesOf(ids))).toEqual(["submitted", "submitted", "submitted"]);
  });

  it("committed during an open hand-off lets that one text go, shown as in flight, and stops the rest of the batch", async () => {
    const ids = await world.seedTransactional(3);
    const inside = deferred();
    const proceed = deferred();
    let asks = 0;
    const resolver = fakeResolver({
      onResolve: async () => {
        asks += 1;
        if (asks === 1) {
          inside.resolve();
          await proceed.promise;
        }
      },
    });
    const run = world.dispatcher({ resolver: resolver.resolver }).run();
    await inside.promise;
    // The pause commits while the first hand-off transaction is open: it writes no delivery row, so it does not wait for it.
    await world.setPause(true);
    proceed.resolve();
    const report = await run;

    // That one text goes (the disclosed allowance); it is in flight, handed off and submitted.
    expect(world.provider.calls).toHaveLength(1);
    const first = await world.rowOf(ids[0]);
    expect([first.state, first.handed_off_at instanceof Date]).toEqual(["submitted", true]);
    expect(report).toMatchObject({ handedOff: 1, submitted: 1, stopped: 1 });
    // The next hand-off re-read the pause: the second row went back to the queue, and the third was never handed off.
    expect(await world.statesOf([ids[1], ids[2]])).toEqual({ [ids[1]]: "queued", [ids[2]]: "queued" });
    expect(world.resolver.asked).toHaveLength(0);
  });

  it("still sends the texts to on-call numbers, and only those", async () => {
    const resident = await world.seedTransactional(2);
    const alert = await world.seedAlert({ types: ["fire"], recipients: 2 });
    const [oncall] = await world.seedTransactional(1, { recipient_kind: "oncall", purpose: "oncall_alert", created_by_module: "ops" });
    await world.setPause(true);

    const report = await world.dispatcher().run();

    expect(world.provider.calls).toHaveLength(1);
    expect(await world.stateOf(oncall)).toBe("submitted");
    expect(report).toMatchObject({ submitted: 1, claimed: 1 });
    expect(Object.values(await world.statesOf([...resident, ...alert.ids]))).toEqual(Array(4).fill("queued"));
  });

  it("is checked before each claim: a pause set between two batches stops the next claim", async () => {
    const ids = await world.seedTransactional(8);
    let calls = 0;
    world.provider.answer(async () => {
      calls += 1;
      // The pause commits during the first batch's last send.
      if (calls === 4) await world.setPause(true);
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(calls) };
    });
    await world.dispatcher({ batchRows: 4 }).run();
    expect(world.provider.calls).toHaveLength(4);
    expect(Object.values(await world.statesOf(ids)).filter((state) => state === "queued")).toHaveLength(4);
  });
});
