import { describe, expect, it } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import {
  MessagingControlInconsistent,
  MessagingControlMissing,
  createMessagingPause,
  statusOf,
  type PauseAudit,
  type PauseRow,
  type PauseStore,
} from "./messagingPause";

const ADMIN = "01900000-0000-7000-8000-0000000000a1";
const OTHER_ADMIN = "01900000-0000-7000-8000-0000000000a2";
const AT = new Date("2026-10-05T18:15:00Z");

const RUNNING: PauseRow = { paused: false, pausedBy: null, pausedAt: null, reason: null, handedOffAtPause: null };

/**
 * The pause on an in-memory switch and a database whose transaction undoes the switch when its body throws, so what a test sees is what a
 * transaction would leave behind. `calls` is the order of everything the use case did, inside or outside a transaction.
 */
function pauseWorld(initial: PauseRow | null = RUNNING, counts: { waiting?: number; handedOff?: number } = {}) {
  let row: PauseRow | null = initial === null ? null : { ...initial };
  const calls: string[] = [];
  const audits: { inTransaction: boolean; event: unknown }[] = [];
  let failAudit = false;
  let inTransaction = false;
  const tx = {} as DbTransaction;
  const db = {
    transaction: async (run: (tx: DbTransaction) => Promise<unknown>) => {
      const before = row === null ? null : { ...row };
      calls.push("begin");
      inTransaction = true;
      try {
        const result = await run(tx);
        calls.push("commit");
        return result;
      } catch (error) {
        row = before;
        calls.push("rollback");
        throw error;
      } finally {
        inTransaction = false;
      }
    },
  } as unknown as Db;
  const store: PauseStore = {
    async read() {
      return row === null ? null : { ...row };
    },
    async lock() {
      calls.push("lock");
      return row === null ? null : { ...row };
    },
    async countWaiting() {
      calls.push("count waiting");
      return counts.waiting ?? 0;
    },
    async countHandedOffOfHeld() {
      calls.push("count handed off");
      return counts.handedOff ?? 0;
    },
    async setPaused(_tx, { actorStaffId, reason, handedOff }) {
      calls.push("set paused");
      if (row === null || row.paused) return null;
      row = { paused: true, pausedBy: actorStaffId, pausedAt: AT, reason, handedOffAtPause: handedOff };
      return { ...row };
    },
    async setResumed() {
      calls.push("set resumed");
      if (row === null || !row.paused) return false;
      row = { ...RUNNING };
      return true;
    },
  };
  const audit: PauseAudit = {
    async record(_tx, event) {
      calls.push("audit");
      if (failAudit) throw new Error("the audit insert failed");
      audits.push({ inTransaction, event });
    },
    async recordRefusal(_db, event) {
      calls.push("audit refusal");
      audits.push({ inTransaction, event });
    },
  };
  const service = createMessagingPause({ db, store, audit });
  return {
    service,
    calls,
    audits,
    row: () => row,
    failAudits: () => void (failAudit = true),
  };
}

describe("pausing all texts", () => {
  it("records who, when (the database's time) and why, and the texts it holds and those already handed off, audited in the same transaction", async () => {
    const world = pauseWorld(RUNNING, { waiting: 12, handedOff: 3 });

    const outcome = await world.service.pause({ actorStaffId: ADMIN, reason: "Wrong alert sent to Thorncliffe Park" });

    expect(outcome).toEqual({
      kind: "paused",
      status: { paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Wrong alert sent to Thorncliffe Park", handedOffAtPause: 3 },
      waiting: 12,
      handedOff: 3,
    });
    expect(world.row()).toEqual({ paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Wrong alert sent to Thorncliffe Park", handedOffAtPause: 3 });
    // The row is locked first, the texts are counted, the switch is set and the audit record is written, all before the commit.
    expect(world.calls).toEqual(["begin", "lock", "count waiting", "count handed off", "set paused", "audit", "commit"]);
    expect(world.audits).toEqual([
      { inTransaction: true, event: { action: "sending.paused", actorStaffId: ADMIN, subjectType: "messaging_control", subjectId: "1", meta: { waiting: 12, handed_off: 3 } } },
    ]);
  });

  it("keeps the reason on one line, and the audit record never holds it", async () => {
    const world = pauseWorld();

    await world.service.pause({ actorStaffId: ADMIN, reason: "  Twilio is down.\n\nSee the status page.  " });

    expect(world.row()?.reason).toBe("Twilio is down. See the status page.");
    expect(JSON.stringify(world.audits)).not.toContain("Twilio");
  });

  it("is not made when it cannot be audited: the switch is as it was, and the caller is told by the error", async () => {
    const world = pauseWorld();
    world.failAudits();

    await expect(world.service.pause({ actorStaffId: ADMIN, reason: "Stop" })).rejects.toThrow("the audit insert failed");

    expect(world.row()).toEqual(RUNNING);
    expect(world.calls.at(-1)).toBe("rollback");
  });

  it.each([[""], ["   "], [undefined], [null], [42]])("is refused without a reason (%j): nothing is locked or changed, and the refusal is audited as a validation", async (reason) => {
    const world = pauseWorld();

    expect(await world.service.pause({ actorStaffId: ADMIN, reason })).toEqual({ kind: "refused", problem: "missing" });

    expect(world.row()).toEqual(RUNNING);
    expect(world.calls).toEqual(["audit refusal"]);
    expect(world.audits).toEqual([
      { inTransaction: false, event: { action: "sending.paused", actorStaffId: ADMIN, subjectType: "messaging_control", subjectId: "1", meta: { reason: "validation" } } },
    ]);
  });

  it("is refused with a reason of more than 500 characters", async () => {
    const world = pauseWorld();

    expect(await world.service.pause({ actorStaffId: ADMIN, reason: "a".repeat(501) })).toEqual({ kind: "refused", problem: "too_long" });

    expect(world.row()).toEqual(RUNNING);
  });

  it("changes nothing when texts are already paused: it says who paused and why, and audits a conflict, not a second pause", async () => {
    const world = pauseWorld({ paused: true, pausedBy: OTHER_ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: 7 });

    const outcome = await world.service.pause({ actorStaffId: ADMIN, reason: "Another reason" });

    expect(outcome).toEqual({ kind: "already_paused", status: { paused: true, pausedBy: OTHER_ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: 7 } });
    expect(world.row()).toMatchObject({ pausedBy: OTHER_ADMIN, reason: "Provider outage", handedOffAtPause: 7 });
    // Counted nothing, set nothing; the one record is the refusal, written after the transaction.
    expect(world.calls).toEqual(["begin", "lock", "commit", "audit refusal"]);
    expect(world.audits).toEqual([
      { inTransaction: false, event: { action: "sending.paused", actorStaffId: ADMIN, subjectType: "messaging_control", subjectId: "1", meta: { reason: "conflict" } } },
    ]);
  });

  it("fails when the switch has no row (a broken database: the sender already reads that as paused)", async () => {
    const world = pauseWorld(null);

    await expect(world.service.pause({ actorStaffId: ADMIN, reason: "Stop" })).rejects.toBeInstanceOf(MessagingControlMissing);
  });
});

describe("resuming texts", () => {
  const PAUSED: PauseRow = { paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: 2 };

  it("ends the pause, clears who, when and why, and audits it in the same transaction with the texts it lets go", async () => {
    const world = pauseWorld(PAUSED, { waiting: 40 });

    expect(await world.service.resume({ actorStaffId: OTHER_ADMIN })).toEqual({ kind: "resumed", waiting: 40 });

    expect(world.row()).toEqual(RUNNING);
    expect(world.calls).toEqual(["begin", "lock", "count waiting", "set resumed", "audit", "commit"]);
    expect(world.audits).toEqual([
      { inTransaction: true, event: { action: "sending.resumed", actorStaffId: OTHER_ADMIN, subjectType: "messaging_control", subjectId: "1", meta: { waiting: 40 } } },
    ]);
  });

  it("is not made when it cannot be audited: texts stay paused", async () => {
    const world = pauseWorld(PAUSED, { waiting: 1 });
    world.failAudits();

    await expect(world.service.resume({ actorStaffId: ADMIN })).rejects.toThrow("the audit insert failed");

    expect(world.row()).toEqual(PAUSED);
  });

  it("changes nothing when texts are not paused, and audits a conflict", async () => {
    const world = pauseWorld(RUNNING);

    expect(await world.service.resume({ actorStaffId: ADMIN })).toEqual({ kind: "not_paused" });

    expect(world.calls).toEqual(["begin", "lock", "commit", "audit refusal"]);
    expect(world.audits).toEqual([
      { inTransaction: false, event: { action: "sending.resumed", actorStaffId: ADMIN, subjectType: "messaging_control", subjectId: "1", meta: { reason: "conflict" } } },
    ]);
  });

  it("fails when the switch has no row", async () => {
    await expect(pauseWorld(null).service.resume({ actorStaffId: ADMIN })).rejects.toBeInstanceOf(MessagingControlMissing);
  });
});

describe("what the pause says now", () => {
  it("is not paused for a running switch", async () => {
    expect(await pauseWorld(RUNNING).service.status()).toEqual({ paused: false });
  });

  it("names who paused, when, why and how many texts had already gone to the provider", async () => {
    const world = pauseWorld({ paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: 5 });

    expect(await world.service.status()).toEqual({ paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: 5 });
  });

  it("keeps a pause set before the count existed, with no count", async () => {
    const world = pauseWorld({ paused: true, pausedBy: ADMIN, pausedAt: AT, reason: "Provider outage", handedOffAtPause: null });

    expect(await world.service.status()).toMatchObject({ paused: true, handedOffAtPause: null });
  });

  it("fails on a switch with no row, and on one that is on without saying who, when and why", async () => {
    await expect(pauseWorld(null).service.status()).rejects.toBeInstanceOf(MessagingControlMissing);
    expect(() => statusOf({ paused: true, pausedBy: null, pausedAt: null, reason: null, handedOffAtPause: null })).toThrow(MessagingControlInconsistent);
    expect(() => statusOf({ paused: true, pausedBy: ADMIN, pausedAt: AT, reason: null, handedOffAtPause: null })).toThrow(MessagingControlInconsistent);
  });
});
