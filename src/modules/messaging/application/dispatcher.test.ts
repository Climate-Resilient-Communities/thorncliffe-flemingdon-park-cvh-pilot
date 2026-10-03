// The dispatcher's orchestration with an in-memory store and no database: what a run does, in what order, and what it never does
// (call the provider without a lease, for a row it does not hold, or at all under SMS_MODE=log). The real tables, the locks and the
// races are in test/db/dispatcher.db.test.ts and dispatcherRaces.db.test.ts; this file is for the paths the database cannot
// reach yet (a campaign text, which no row can be before S09.07) and for the order of calls.
import { describe, expect, it } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AlertStanding, UnknownCause } from "../domain/dispatchRules";
import type { DeliveryView, MessagingLog } from "./deliveryPorts";
import { createDispatcher } from "./dispatcher";
import {
  CampaignReaderNotWired,
  type DispatchStore,
  type DispatcherClock,
  type DispatcherDeps,
  type MessageSubmission,
  type MessageSubmitter,
  type MessagingOpsEvent,
  type StoppedState,
  type SweepResult,
} from "./dispatcherPorts";

const NOW = Date.parse("2026-10-03T15:00:00Z");
const TOKEN = "01900000-0000-7000-8000-00000000f001";
const SID = `SM${"0123456789abcdef".repeat(2)}`;
const tx = {} as DbTransaction;
const db = { transaction: async <T>(run: (transaction: DbTransaction) => Promise<T>) => run(tx) } as unknown as Db;

function view(over: Partial<DeliveryView> = {}): DeliveryView {
  return {
    id: "01900000-0000-7000-8000-0000000d0001",
    kind: "transactional",
    recipientKind: "subscriber",
    recipientId: "01900000-0000-7000-8000-0000000a0001",
    entryId: null,
    campaignId: null,
    createdByModule: "subscriptions",
    purpose: "menu_reply",
    lang: "en",
    body: "Reply 1 to change your building.",
    segments: 1,
    costEstimateCents: 2,
    idempotencyKey: "transactional:s:menu_reply:n",
    callbackRef: "01900000-0000-7000-8000-0000000c0001",
    state: "queued",
    attempts: 0,
    dueAt: new Date(NOW),
    sendBy: null,
    claimedAt: null,
    claimedBy: null,
    claimToken: null,
    handedOffAt: null,
    submittedAt: null,
    providerMessageId: null,
    providerErrorCode: null,
    completedAt: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...over,
  };
}

/** An in-memory outbox that behaves as the real store does for one run: it claims in the order given and records every change. */
function memoryStore(
  queued: DeliveryView[],
  flags: {
    leaseFree?: boolean;
    paused?: boolean;
    renewalKept?: boolean;
    leaseHeldAtHandOff?: boolean;
    claimLeaseLost?: boolean;
    sweepUnknown?: { row: DeliveryView; cause: UnknownCause }[];
    /** The sweep's `recordUnknown` fails for these rows (their transaction rolls back: reported in `failed`), and its `afterUnknown` for these (reported in `hookFailed`). */
    sweepRecordFails?: Set<string>;
    sweepHookFails?: Set<string>;
    sweepThrows?: boolean;
    requeueOrphansThrows?: boolean;
    /** Rows that appear when the first pass gives the lease up (an approval that lands while the holder makes its last, empty claim). */
    arriveAfterFirstRelease?: () => DeliveryView[];
    dueCheckThrows?: boolean;
  } = {},
) {
  const rows = new Map(queued.map((row) => [row.id, { ...row }]));
  let releases = 0;
  let requeues = 0;
  const calls: string[] = [];
  const outcomes: { id: string; kind: string }[] = [];
  const store: DispatchStore = {
    async acquireLease() {
      calls.push("acquireLease");
      return flags.leaseFree === false ? null : { token: TOKEN, paceBarrierMs: 0 };
    },
    async renewLease() {
      calls.push("renewLease");
      return flags.renewalKept !== false;
    },
    async releaseLease() {
      calls.push("releaseLease");
      if (releases === 0 && flags.arriveAfterFirstRelease) for (const row of flags.arriveAfterFirstRelease()) rows.set(row.id, { ...row });
      releases += 1;
    },
    async leaseHeld() {
      return flags.leaseHeldAtHandOff !== false;
    },
    async isPaused() {
      return flags.paused === true;
    },
    async requeueOrphans() {
      calls.push("requeueOrphans");
      requeues += 1;
      // Only the upkeep's own requeue (the first) fails: the one before each claim is part of the loop.
      if (flags.requeueOrphansThrows && requeues === 1) throw new Error("the database is down for +14165550123");
      return 0;
    },
    async hasDueRows() {
      calls.push("hasDueRows");
      if (flags.dueCheckThrows) throw new Error("the database is down");
      return [...rows.values()].some((row) => row.state === "queued");
    },
    async claim(_db, input) {
      calls.push("claim");
      if (flags.claimLeaseLost) return { kind: "lease_lost" };
      const taken = [...rows.values()].filter((row) => row.state === "queued").slice(0, input.maxRows);
      for (const row of taken) Object.assign(row, { state: "claimed", claimToken: input.token, claimedBy: input.workerId });
      return { kind: "claimed", rows: taken.map((row) => ({ ...row })) };
    },
    async sweep(_db, input) {
      calls.push("sweep");
      if (flags.sweepThrows) throw new Error("the sweep failed for +14165550123");
      // As the real store does: each row in a transaction of its own (a failure of its event leaves it for the next run), the hook in a savepoint.
      const result: SweepResult = { requeued: 0, unknown: [], failed: [], hookFailed: [] };
      for (const { row, cause } of flags.sweepUnknown ?? []) {
        try {
          if (flags.sweepRecordFails?.has(row.id)) throw new Error("ops_event is unavailable");
          await input.recordUnknown(tx, row, cause);
        } catch (error) {
          result.failed.push({ id: row.id, cause, error: (error as Error).name });
          continue;
        }
        result.unknown.push({ id: row.id, cause });
        try {
          if (flags.sweepHookFails?.has(row.id)) throw new Error("the spend_event insert failed");
          await input.afterUnknown?.(tx, row, cause);
        } catch (error) {
          result.hookFailed.push({ id: row.id, error: (error as Error).name });
        }
      }
      return result;
    },
    async releaseClaims() {
      calls.push("releaseClaims");
      let back = 0;
      for (const row of rows.values()) {
        if (row.state === "claimed" && row.handedOffAt === null) {
          Object.assign(row, { state: "queued", claimToken: null, claimedBy: null });
          back += 1;
        }
      }
      return back;
    },
    async lockForHandOff(_tx, id) {
      const row = rows.get(id);
      return row ? { row: { ...row }, sendByPassed: false } : null;
    },
    async stopBeforeHandOff(_tx, input: { id: string; to: StoppedState }) {
      calls.push(`stop:${input.to}`);
      const row = rows.get(input.id);
      if (!row) return false;
      row.state = input.to;
      return true;
    },
    async markHandedOff(_tx, input) {
      calls.push("handOff");
      const row = rows.get(input.id)!;
      row.handedOffAt = new Date(NOW);
      return true;
    },
    async recordOutcome(_tx, input) {
      outcomes.push({ id: input.id, kind: input.outcome.kind });
      const row = rows.get(input.id)!;
      row.state = input.outcome.kind === "submitted" ? "submitted" : input.outcome.kind === "requeue" ? "queued" : input.outcome.kind;
      return true;
    },
    async fillProviderId() {
      return "not_fillable";
    },
  };
  return { store, rows, calls, outcomes };
}

function clockOf(start = NOW): DispatcherClock & { sleeps: number[]; at(): number } {
  let time = start;
  const sleeps: number[] = [];
  return {
    now: () => new Date(time),
    at: () => time,
    async sleep(ms) {
      sleeps.push(ms);
      time += ms;
    },
    skewMs: () => 0,
    sleeps,
  };
}

const standing = (over: Partial<AlertStanding> = {}): AlertStanding => ({ entryStatus: "approved", entryKind: "ack", validUntilPassed: false, threadOpen: true, isClosingEntry: false, isDrill: false, ...over });

function setup(queued: DeliveryView[], flags: Parameters<typeof memoryStore>[1] = {}, over: Partial<DispatcherDeps> = {}) {
  const memory = memoryStore(queued, flags);
  const clock = clockOf();
  const lines: { level: string; evt: string; fields: Record<string, unknown> }[] = [];
  const log: MessagingLog = { info: (evt, fields) => void lines.push({ level: "info", evt, fields }), error: (evt, fields) => void lines.push({ level: "error", evt, fields }) };
  const sent: MessageSubmission[] = [];
  const submitter: MessageSubmitter = {
    async submit(submission) {
      sent.push(submission);
      return { kind: "accepted", httpStatus: 201, status: "queued", messageId: SID };
    },
  };
  const events: MessagingOpsEvent[] = [];
  const dispatcher = createDispatcher({
    db,
    store: memory.store,
    resolver: { resolve: async (_tx, recipient) => (recipient.id === null ? { found: false, reason: "recipient_gone" } : { found: true, number: "+14165550123" }) },
    alerts: { standingOf: async () => standing() },
    ops: { record: async (_executor, event) => void events.push(event) },
    log,
    clock,
    config: { mode: "live", submitter, messagingServiceSid: `MG${"1".repeat(32)}`, publicBaseUrl: "https://cvh.example" },
    workerId: () => "dispatch-test",
    ...over,
  });
  return { ...memory, clock, lines, sent, events, dispatcher };
}

describe("a run's order", () => {
  it("takes the lease first, sweeps, claims, sends, and gives the lease up last", async () => {
    const { dispatcher, calls, sent } = setup([view()]);
    const report = await dispatcher.run();
    expect(report).toMatchObject({ status: "ok", claimed: 1, submitted: 1 });
    expect(sent).toHaveLength(1);
    const order = calls.filter((call) => ["acquireLease", "sweep", "claim", "handOff", "releaseLease"].includes(call));
    expect(order.slice(0, 3)).toEqual(["acquireLease", "sweep", "claim"]);
    expect(order.at(-1)).toBe("releaseLease");
    expect(order.indexOf("handOff")).toBeGreaterThan(order.indexOf("claim"));
  });

  it("exits without claiming anything, or sweeping, when another dispatcher holds the lease", async () => {
    const { dispatcher, calls, sent, rows } = setup([view()], { leaseFree: false });
    const report = await dispatcher.run();
    expect(report).toMatchObject({ status: "lease_held", claimed: 0, submitted: 0 });
    expect(calls).toEqual(["acquireLease"]);
    expect(sent).toHaveLength(0);
    expect([...rows.values()][0].state).toBe("queued");
  });

  it("stops without calling the provider when its renewal finds the lease lost", async () => {
    const clock = clockOf();
    const { dispatcher, sent, calls } = setup([view()], { renewalKept: false }, { clock, leaseRenewAfterMs: 0 });
    const report = await dispatcher.run();
    expect(report.status).toBe("lease_lost");
    expect(sent).toHaveLength(0);
    expect(calls).not.toContain("handOff");
    // It still puts back what it claimed and gives up what is no longer its own.
    expect(calls.at(-1)).toBe("releaseLease");
  });

  it("stops without calling the provider when its claim finds the lease lost", async () => {
    const { dispatcher, sent, calls } = setup([view()], { claimLeaseLost: true });
    expect((await dispatcher.run()).status).toBe("lease_lost");
    expect(sent).toHaveLength(0);
    expect(calls).not.toContain("handOff");
  });

  it("stops without calling the provider when the hand-off finds the lease token changed", async () => {
    const { dispatcher, sent, rows } = setup([view()], { leaseHeldAtHandOff: false });
    expect((await dispatcher.run()).status).toBe("lease_lost");
    expect(sent).toHaveLength(0);
    expect([...rows.values()][0].handedOffAt).toBeNull();
  });

  it("claims nothing when its time is already up (the limit less the margin leaves nothing to send)", async () => {
    const { dispatcher, calls, sent } = setup([view()], {}, { runLimitMs: 10_000, marginMs: 10_000 });
    const report = await dispatcher.run();
    expect(report.claimed).toBe(0);
    expect(calls).not.toContain("claim");
    expect(sent).toHaveLength(0);
  });

  it("sends nothing past its time: a row that waits for the pace beyond the run's last instant is put back, not sent", async () => {
    // Three one-segment texts at 1 segment a second with 1.5 seconds to send in: the third comes after the end.
    const rows = [1, 2, 3].map((n) => view({ id: `01900000-0000-7000-8000-0000000d000${n}`, callbackRef: `01900000-0000-7000-8000-0000000c000${n}` }));
    const { dispatcher, sent, rows: after, clock } = setup(rows, {}, { segmentsPerSecond: 1, runLimitMs: 11_500, marginMs: 10_000 });
    const report = await dispatcher.run();
    expect(sent.length).toBeLessThanOrEqual(2);
    expect(clock.at() - NOW).toBeLessThanOrEqual(2_000);
    expect(report.claimed).toBeGreaterThanOrEqual(1);
    expect([...after.values()].filter((row) => row.state === "claimed")).toHaveLength(0);
  });
});

describe("the upkeep before sending never stops the sending", () => {
  const stale = (n: number) => view({ id: `01900000-0000-7000-8000-0000000d01${n}0`, state: "claimed", handedOffAt: new Date(NOW) });

  it("goes on to claim and send when the sweep throws, logging the error's name only", async () => {
    const { dispatcher, sent, lines } = setup([view()], { sweepThrows: true });
    const report = await dispatcher.run();
    expect(report).toMatchObject({ status: "ok", claimed: 1, submitted: 1 });
    expect(sent).toHaveLength(1);
    const failed = lines.filter((line) => line.evt === "dispatch.sweep_failed");
    expect(failed).toEqual([{ level: "error", evt: "dispatch.sweep_failed", fields: { step: "sweep", error: "Error" } }]);
    // No message of the error (it could quote a number) reaches the log.
    expect(JSON.stringify(lines)).not.toContain("5550123");
  });

  it("goes on to sweep, claim and send when the first requeue of an old holder's rows throws", async () => {
    const { dispatcher, sent, lines, calls } = setup([view()], { requeueOrphansThrows: true });
    const report = await dispatcher.run();
    expect(report).toMatchObject({ status: "ok", submitted: 1 });
    expect(sent).toHaveLength(1);
    expect(calls.indexOf("sweep")).toBeGreaterThan(calls.indexOf("requeueOrphans"));
    expect(lines.filter((line) => line.evt === "dispatch.sweep_failed")).toEqual([{ level: "error", evt: "dispatch.sweep_failed", fields: { step: "requeue_orphans", error: "Error" } }]);
    expect(JSON.stringify(lines)).not.toContain("5550123");
  });

  it("reports the rows the sweep could not settle and the spend hooks that failed, by id and error name, and still sends", async () => {
    const [a, b, c] = [1, 2, 3].map(stale);
    const seen: string[] = [];
    const { dispatcher, sent, lines, events } = setup([view()], { sweepUnknown: [{ row: a, cause: "no_outcome_after_hand_off" }, { row: b, cause: "no_outcome_after_hand_off" }, { row: c, cause: "no_outcome_after_hand_off" }], sweepRecordFails: new Set([a.id]), sweepHookFails: new Set([b.id]) }, {
      afterOutcome: async (_tx, delivery, outcome) => void seen.push(`${outcome}:${delivery.id}`),
    });
    const report = await dispatcher.run();
    expect(report.sweep).toEqual({ requeued: 0, unknown: 2, failed: 1 });
    expect(report.submitted).toBe(1);
    expect(sent).toHaveLength(1);
    expect(lines.find((line) => line.evt === "dispatch.sweep_row_failed")).toEqual({ level: "error", evt: "dispatch.sweep_row_failed", fields: { delivery_id: a.id, cause: "no_outcome_after_hand_off", error: "Error" } });
    expect(lines.find((line) => line.evt === "dispatch.sweep_spend_hook_failed")?.fields).toEqual({ delivery_id: b.id, error: "Error" });
    // The event of a row that could not be recorded is not written (its transaction rolled back); the other two are.
    expect(events.map((event) => event.kind === "delivery.unknown" && event.deliveryId)).toEqual([b.id, c.id]);
  });

  it("gives the store no spend hook when none is wired, and a hook that only counts a text handed off with no outcome", async () => {
    const withoutHook = memoryStore([]);
    let given: unknown = "unset";
    const original = withoutHook.store.sweep;
    withoutHook.store.sweep = async (db2, input) => ((given = input.afterUnknown), original(db2, input));
    const base = { db, store: withoutHook.store, resolver: { resolve: async () => ({ found: false as const, reason: "recipient_gone" as const }) }, alerts: { standingOf: async () => null }, ops: { record: async () => undefined }, log: { info: () => undefined, error: () => undefined }, clock: clockOf(), config: { mode: "log" as const }, workerId: () => "w" };
    await createDispatcher(base).run();
    expect(given).toBeUndefined();

    const seen: string[] = [];
    await createDispatcher({ ...base, afterOutcome: async (_tx, delivery, outcome) => void seen.push(`${outcome}:${delivery.id}`) }).run();
    const hook = given as NonNullable<Parameters<DispatchStore["sweep"]>[1]["afterUnknown"]>;
    await hook(tx, stale(1), "no_outcome_after_hand_off");
    await hook(tx, stale(2), "no_terminal_status");
    expect(seen).toEqual([`unknown:${stale(1).id}`]);
  });
});

describe("the holder looks once more after giving up the lease", () => {
  const late = () => view({ id: "01900000-0000-7000-8000-0000000d0777", callbackRef: "01900000-0000-7000-8000-0000000c0777" });

  it("takes the lease again and sends what arrived while it made its last, empty claim (the kick that found the lease held exited)", async () => {
    const { dispatcher, sent, calls, rows, lines } = setup([], { arriveAfterFirstRelease: () => [late()] });
    const report = await dispatcher.run();
    expect(report).toMatchObject({ status: "ok", claimed: 1, submitted: 1 });
    expect(sent).toHaveLength(1);
    expect(calls.filter((call) => call === "acquireLease")).toHaveLength(2);
    expect(calls.filter((call) => call === "releaseLease")).toHaveLength(2);
    // The upkeep ran once, in the first pass.
    expect(calls.filter((call) => call === "sweep")).toHaveLength(1);
    expect(rows.get(late().id)?.state).toBe("submitted");
    expect(lines.filter((line) => line.evt === "dispatch.run_finished")).toHaveLength(1);
  });

  it("looks only once: rows that keep arriving wait for the next run, and a row it cannot hand off is not tried again and again", async () => {
    let arrived = 0;
    const { dispatcher, calls } = setup([], { arriveAfterFirstRelease: () => (arrived += 1, [late()]) }, { campaigns: undefined });
    await dispatcher.run();
    expect(arrived).toBe(1);
    expect(calls.filter((call) => call === "acquireLease").length).toBeLessThanOrEqual(2);
    expect(calls.filter((call) => call === "hasDueRows")).toHaveLength(1);
  });

  it("does not look when nothing is due, when its time is up, or when the lease was lost", async () => {
    const quiet = setup([view()]);
    await quiet.dispatcher.run();
    expect(quiet.calls.filter((call) => call === "acquireLease")).toHaveLength(1);

    const lost = setup([view()], { renewalKept: false }, { leaseRenewAfterMs: 0 });
    await lost.dispatcher.run();
    expect(lost.calls).not.toContain("hasDueRows");

    const over = setup([view()], {}, { runLimitMs: 10_000, marginMs: 10_000 });
    await over.dispatcher.run();
    expect(over.calls).not.toContain("hasDueRows");
  });

  it("does not look after a pass in which a hand-off failed: that row goes back to the queue and is not tried again and again", async () => {
    const campaign = view({ kind: "campaign", campaignId: "01900000-0000-7000-8000-0000000b0001", purpose: "reconsent", createdByModule: "subscriptions", idempotencyKey: "campaign:c:reconsent:r" });
    const { dispatcher, calls, lines, rows } = setup([campaign]);
    await dispatcher.run();
    expect(lines.filter((line) => line.evt === "dispatch.hand_off_failed")).toHaveLength(1);
    expect(calls.filter((call) => call === "acquireLease")).toHaveLength(1);
    expect(calls).not.toContain("hasDueRows");
    expect([...rows.values()][0].state).toBe("queued");
  });

  it("does not look when another dispatcher holds the lease at the start (the first pass said lease_held)", async () => {
    const { dispatcher, calls } = setup([view()], { leaseFree: false });
    expect((await dispatcher.run()).status).toBe("lease_held");
    expect(calls).toEqual(["acquireLease"]);
  });

  it("keeps the run's status when another holder takes the lease first, and survives a failed look", async () => {
    const { dispatcher, calls, lines } = setup([], { arriveAfterFirstRelease: () => [late()], dueCheckThrows: true });
    const report = await dispatcher.run();
    expect(report.status).toBe("ok");
    expect(calls.filter((call) => call === "acquireLease")).toHaveLength(1);
    expect(lines.some((line) => line.evt === "dispatch.due_check_failed")).toBe(true);
  });
});

describe("a text that must not be sent after a 401", () => {
  const refused = (httpStatus: number): MessageSubmitter => ({ submit: async () => ({ kind: "rejected", httpStatus, errorCode: 20003, message: "Authenticate" }) });
  const rowsOf = (count: number) => Array.from({ length: count }, (_, n) => view({ id: `01900000-0000-7000-8000-0000000d02${n.toString().padStart(2, "0")}`, callbackRef: `01900000-0000-7000-8000-0000000c02${n.toString().padStart(2, "0")}` }));
  const config = (submitter: MessageSubmitter) => ({ mode: "live" as const, submitter, messagingServiceSid: `MG${"1".repeat(32)}`, publicBaseUrl: "https://cvh.example" });

  it("stops the run at the first 401: one text is refused, and the rest are put back untouched", async () => {
    const { dispatcher, rows, outcomes, events } = setup(rowsOf(6), {}, { config: config(refused(401)), batchRows: 6 });
    const report = await dispatcher.run();
    expect(report.status).toBe("provider_auth_failed");
    expect(outcomes).toHaveLength(1);
    expect([...rows.values()].filter((row) => row.state === "queued")).toHaveLength(5);
    expect(events.some((event) => event.kind === "dispatch.provider_auth_failed")).toBe(true);
  });

  it("stops at the third 403 in a row, not before", async () => {
    const { dispatcher, outcomes, rows } = setup(rowsOf(6), {}, { config: config(refused(403)), batchRows: 6 });
    const report = await dispatcher.run();
    expect(report.status).toBe("provider_auth_failed");
    expect(outcomes).toHaveLength(3);
    expect([...rows.values()].filter((row) => row.state === "queued")).toHaveLength(3);
  });
});

describe("a campaign text at the hand-off point", () => {
  const campaignRow = () => view({ kind: "campaign", campaignId: "01900000-0000-7000-8000-0000000b0001", purpose: "reconsent", createdByModule: "subscriptions", idempotencyKey: "campaign:c:reconsent:r" });

  it("fails loudly, sending nothing, when no campaign reader is wired (a campaign text is never sent unchecked)", async () => {
    const { dispatcher, sent, lines, rows } = setup([campaignRow()]);
    const report = await dispatcher.run();
    expect(sent).toHaveLength(0);
    expect(report.submitted).toBe(0);
    expect(lines.some((line) => line.evt === "dispatch.hand_off_failed" && line.fields.error === new CampaignReaderNotWired().name)).toBe(true);
    // The row is put back for another run, with nothing counted against it.
    expect([...rows.values()][0].state).toBe("queued");
  });

  it("skips a campaign text the reader says is no longer sendable (cancelled, or the recipient left the target state)", async () => {
    const { dispatcher, sent, rows } = setup([campaignRow()], {}, { campaigns: { sendable: async () => false } });
    const report = await dispatcher.run();
    expect(sent).toHaveLength(0);
    expect(report.stopped).toBe(1);
    expect([...rows.values()][0].state).toBe("skipped");
  });

  it("sends a campaign text the reader says is sendable, asking it for the campaign and the recipient", async () => {
    const asked: unknown[] = [];
    const { dispatcher, sent } = setup([campaignRow()], {}, { campaigns: { sendable: async (_tx, input) => (asked.push(input), true) } });
    await dispatcher.run();
    expect(sent).toHaveLength(1);
    expect(asked).toEqual([{ campaignId: "01900000-0000-7000-8000-0000000b0001", recipientId: "01900000-0000-7000-8000-0000000a0001" }]);
  });
});

describe("an alert text at the hand-off point", () => {
  const alertRow = () => view({ kind: "alert", entryId: "01900000-0000-7000-8000-0000000e0001", purpose: null, createdByModule: "alerting", idempotencyKey: "e:r:sms" });

  it("is cancelled when the entry's standing says so, and sent when it is fine", async () => {
    const cancelled = setup([alertRow()], {}, { alerts: { standingOf: async () => standing({ entryStatus: "superseded" }) } });
    expect((await cancelled.dispatcher.run()).stopped).toBe(1);
    expect(cancelled.sent).toHaveLength(0);
    expect([...cancelled.rows.values()][0].state).toBe("cancelled");

    const fine = setup([alertRow()]);
    await fine.dispatcher.run();
    expect(fine.sent).toHaveLength(1);
  });

  it("treats an entry that does not exist as cancelled", async () => {
    const { dispatcher, rows, sent } = setup([alertRow()], {}, { alerts: { standingOf: async () => null } });
    await dispatcher.run();
    expect(sent).toHaveLength(0);
    expect([...rows.values()][0].state).toBe("cancelled");
  });
});

describe("SMS_MODE=log", () => {
  it("has no provider to call, asks for no number and reads no credential: the row becomes skipped_env", async () => {
    let asked = 0;
    const { dispatcher, rows, lines } = setup([view()], {}, { config: { mode: "log" }, resolver: { resolve: async () => (asked += 1, { found: false, reason: "recipient_gone" }) } });
    const report = await dispatcher.run();
    expect(report).toMatchObject({ skippedEnv: 1, handedOff: 0, submitted: 0 });
    expect(asked).toBe(0);
    expect([...rows.values()][0].state).toBe("skipped_env");
    expect(lines.find((line) => line.evt === "dispatch.skipped_env")?.fields).toMatchObject({ body_length: 32, segments: 1 });
  });
});

describe("the spend seam (S06.08)", () => {
  it("is called in the transaction of an outcome the estimate is counted at (submitted and unknown), and not for a requeue or a failure", async () => {
    for (const [answer, expected] of [
      [{ kind: "accepted", httpStatus: 201, status: "queued", messageId: SID }, ["submitted"]],
      [{ kind: "no_answer", reason: "timeout" }, ["unknown"]],
      [{ kind: "not_sent", reason: "connection_refused" }, []],
      [{ kind: "rejected", httpStatus: 400, errorCode: 21211, message: null }, []],
    ] as const) {
      const seen: string[] = [];
      const submitter: MessageSubmitter = { submit: async () => answer };
      const { dispatcher } = setup([view()], {}, {
        config: { mode: "live", submitter, messagingServiceSid: `MG${"1".repeat(32)}`, publicBaseUrl: "https://cvh.example" },
        afterOutcome: async (_tx, delivery, outcome) => void seen.push(`${outcome}:${delivery.id}`),
      });
      await dispatcher.run();
      expect(seen.map((entry) => entry.split(":")[0]), JSON.stringify(answer)).toEqual(expected);
    }
  });

  it("counts a text the sweep makes unknown after a hand-off with no outcome, and not one that was already counted when it was submitted", async () => {
    const handedOff = view({ id: "01900000-0000-7000-8000-0000000d0101", state: "claimed", handedOffAt: new Date(NOW) });
    const submitted = view({ id: "01900000-0000-7000-8000-0000000d0102", state: "submitted" });
    const seen: string[] = [];
    const { dispatcher, events } = setup([], { sweepUnknown: [{ row: handedOff, cause: "no_outcome_after_hand_off" }, { row: submitted, cause: "no_terminal_status" }] }, {
      afterOutcome: async (_tx, delivery, outcome) => void seen.push(`${outcome}:${delivery.id}`),
    });
    const report = await dispatcher.run();
    expect(report.sweep).toEqual({ requeued: 0, unknown: 2, failed: 0 });
    // Both are recorded in ops_event; only the first is counted (the second was counted when it was submitted).
    expect(events.map((event) => event.kind === "delivery.unknown" && event.deliveryId)).toEqual([handedOff.id, submitted.id]);
    expect(seen).toEqual([`unknown:${handedOff.id}`]);
  });

  it("records an unknown in ops_event in the same transaction as the outcome", async () => {
    const submitter: MessageSubmitter = { submit: async () => ({ kind: "rejected", httpStatus: 503, errorCode: null, message: null }) };
    const { dispatcher, events } = setup([view()], {}, { config: { mode: "live", submitter, messagingServiceSid: `MG${"1".repeat(32)}`, publicBaseUrl: "https://cvh.example" } });
    await dispatcher.run();
    expect(events).toEqual([{ kind: "delivery.unknown", deliveryId: "01900000-0000-7000-8000-0000000d0001", detail: { cause: "server_error", http_status: 503 } }]);
  });
});
