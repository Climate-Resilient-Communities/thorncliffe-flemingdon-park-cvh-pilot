import { randomUUID } from "node:crypto";
import { and, asc, eq, exists, gt, inArray, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from "drizzle-orm";
import type { DispatchStore, LockedDelivery, SweepResult } from "../application/dispatcherPorts";
import type { UnknownCause } from "../domain/dispatchRules";
import { CLAIM_EXPIRY_MS, MAX_ATTEMPTS, SUBMITTED_EXPIRY_MS, takeWithinSegments } from "../domain/dispatchRules";
import { viewOf } from "./deliveryStore";
import { delivery, dispatcherLease, messagingControl } from "./schema";

/**
 * The database's instant, moved by `skewMs` (0 in production, so it is exactly `now()`: the database's clock decides every
 * lease, claim age, backoff and `send_by`, never an app server's). A test with a fake clock gives the difference between
 * its clock and the database's, so a stall of a minute is a jump and not a minute of waiting.
 */
const dbNow = (skewMs: number): SQL => (skewMs === 0 ? sql`now()` : sql`(now() + ${Math.trunc(skewMs)}::double precision * interval '1 millisecond')`);
const ahead = (skewMs: number, ms: number): SQL => sql`(${dbNow(skewMs)} + ${Math.trunc(ms)}::double precision * interval '1 millisecond')`;
const behind = (skewMs: number, ms: number): SQL => sql`(${dbNow(skewMs)} - ${Math.trunc(ms)}::double precision * interval '1 millisecond')`;

/** An error's name only: its message could quote data, and nothing here may keep it. */
const nameOf = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/** The row a run's token still holds: claimed by it and not yet handed off (what a stop before the hand-off may change). */
const claimedUnhanded = (id: string, token: string) =>
  and(eq(delivery.id, id), eq(delivery.state, "claimed"), eq(delivery.claimToken, token), isNull(delivery.handedOffAt));

/** The row a run's token handed to the provider and has not yet had an outcome for (what an outcome may change). */
const claimedAndHandedOff = (id: string, token: string) =>
  and(eq(delivery.id, id), eq(delivery.state, "claimed"), eq(delivery.claimToken, token), isNotNull(delivery.handedOffAt));

const leaseHeld: DispatchStore["leaseHeld"] = async (tx, token, skewMs) => {
  const held = await tx
    .select({ id: dispatcherLease.id })
    .from(dispatcherLease)
    .where(and(eq(dispatcherLease.id, 1), eq(dispatcherLease.token, token), gt(dispatcherLease.expiresAt, dbNow(skewMs))));
  return held.length === 1;
};

const isPaused: DispatchStore["isPaused"] = async (tx) => {
  const [control] = await tx.select({ paused: messagingControl.paused }).from(messagingControl).where(eq(messagingControl.id, 1));
  // No control row is a broken database: nothing the pause applies to is sent until it is repaired.
  return control === undefined ? true : control.paused;
};

/**
 * The sender lease and the claims with Drizzle. Every statement that matters is conditional and names the row's state and
 * the run's token, so it is safe whoever else is running: a replacement lease holder, a callback (S06.04), a cancellation
 * (S06.03), a recipient's deletion or a pause. Locks follow the E06 definitions: the claim takes the rows it claims `FOR UPDATE
 * SKIP LOCKED`, the hand-off takes its delivery row `FOR UPDATE` (and then asks the recipient's source, which locks an
 * `inbound_reply` row after it), and nothing here takes any other lock.
 */
export const drizzleDispatchStore: DispatchStore = {
  async acquireLease(db, { holder, ttlMs, skewMs }) {
    const token = randomUUID();
    const now = dbNow(skewMs);
    // One conditional update: of the runs that start at once, only the first finds the previous lease expired; the others wait
    // for its row lock, re-read the row (READ COMMITTED) and find it unexpired, so they update nothing.
    const taken = await db
      .update(dispatcherLease)
      .set({ token, holder, expiresAt: ahead(skewMs, ttlMs), renewedAt: now })
      .where(and(eq(dispatcherLease.id, 1), lte(dispatcherLease.expiresAt, now)))
      .returning({ barrierMs: sql<number>`greatest(0, floor(extract(epoch from (${dispatcherLease.pacedUntil} - ${now})) * 1000))::int` });
    if (taken.length === 0) return null;
    return { token, paceBarrierMs: Number(taken[0].barrierMs) };
  },

  async renewLease(db, { token, ttlMs, skewMs, paceDebtMs }) {
    const renewed = await db
      .update(dispatcherLease)
      .set({ expiresAt: ahead(skewMs, ttlMs), renewedAt: dbNow(skewMs), pacedUntil: ahead(skewMs, paceDebtMs) })
      .where(and(eq(dispatcherLease.id, 1), eq(dispatcherLease.token, token), gt(dispatcherLease.expiresAt, dbNow(skewMs))))
      .returning({ id: dispatcherLease.id });
    return renewed.length === 1;
  },

  async releaseLease(db, { token, skewMs, paceDebtMs }) {
    await db
      .update(dispatcherLease)
      .set({ expiresAt: dbNow(skewMs), pacedUntil: ahead(skewMs, paceDebtMs) })
      .where(and(eq(dispatcherLease.id, 1), eq(dispatcherLease.token, token)));
  },

  leaseHeld,

  isPaused,

  async requeueOrphans(db, { token, skewMs }) {
    // A claimed row of another token and no hand-off: its holder lost the lease, so nothing will hand it off. (A handed-off row
    // is left: its callback, or the 5-minute sweep, settles it, and it is never queued again.) The statement names this token's
    // lease, as every claim and hand-off does: a worker whose lease was taken is not the holder and puts nothing back.
    const holdsLease = exists(
      db
        .select({ one: sql`1` })
        .from(dispatcherLease)
        .where(and(eq(dispatcherLease.id, 1), eq(dispatcherLease.token, token), gt(dispatcherLease.expiresAt, dbNow(skewMs)))),
    );
    const back = await db
      .update(delivery)
      .set({ state: "queued" })
      .where(and(eq(delivery.state, "claimed"), isNull(delivery.handedOffAt), ne(delivery.claimToken, token), holdsLease))
      .returning({ id: delivery.id });
    return back.length;
  },

  async hasDueRows(db, { skewMs }) {
    // The rows a claim could take now: while paused only those to on-call numbers (a missing control row counts as paused, as in `isPaused`).
    const notPaused = sql`not coalesce((select ${messagingControl.paused} from ${messagingControl} where ${messagingControl.id} = 1), true)`;
    const [due] = await db
      .select({ id: delivery.id })
      .from(delivery)
      .where(and(eq(delivery.state, "queued"), lte(delivery.dueAt, dbNow(skewMs)), or(eq(delivery.recipientKind, "oncall"), notPaused)))
      .limit(1);
    return due !== undefined;
  },

  async claim(db, { token, workerId, skewMs, maxRows, maxSegments }) {
    return db.transaction(async (tx) => {
      // The claim names the lease it acts under: a holder that lost it claims nothing.
      if (!(await leaseHeld(tx, token, skewMs))) return { kind: "lease_lost" as const };
      const paused = await isPaused(tx);
      const candidates = await tx
        .select()
        .from(delivery)
        .where(and(eq(delivery.state, "queued"), lte(delivery.dueAt, dbNow(skewMs)), paused ? eq(delivery.recipientKind, "oncall") : undefined))
        .orderBy(asc(delivery.claimRank), asc(delivery.createdAt), asc(delivery.id))
        .limit(maxRows)
        .for("update", { skipLocked: true });
      const taken = takeWithinSegments(candidates, maxSegments);
      if (taken.length === 0) return { kind: "claimed" as const, rows: [] };
      const claimed = await tx
        .update(delivery)
        .set({ state: "claimed", claimedBy: workerId, claimToken: token })
        .where(inArray(delivery.id, taken.map((row) => row.id)))
        .returning();
      const byId = new Map(claimed.map((row) => [row.id, row]));
      return { kind: "claimed" as const, rows: taken.map((row) => viewOf(byId.get(row.id)!)) };
    });
  },

  async sweep(db, { skewMs, maxRows, recordUnknown, afterUnknown }) {
    // Claimed for 5 minutes and never handed off: nothing can have been sent, so it goes back to the queue (one statement, no hook).
    const requeued = await db
      .update(delivery)
      .set({ state: "queued" })
      .where(and(eq(delivery.state, "claimed"), isNull(delivery.handedOffAt), lt(delivery.claimedAt, behind(skewMs, CLAIM_EXPIRY_MS))))
      .returning({ id: delivery.id });

    // Handed off and no outcome in 5 minutes: the text may or may not have gone, so it is `unknown`, never queued again. Submitted and
    // no final status in 24 hours: `unknown` too. Each such row is settled in a transaction of its own (the change and its event), so
    // a row that cannot be settled rolls back alone and never holds up the others, or the sending that follows the sweep.
    const noOutcome = and(eq(delivery.state, "claimed"), isNotNull(delivery.handedOffAt), lt(delivery.handedOffAt, behind(skewMs, CLAIM_EXPIRY_MS)));
    const noStatus = and(eq(delivery.state, "submitted"), lt(delivery.submittedAt, behind(skewMs, SUBMITTED_EXPIRY_MS)));
    const expired = await db
      .select({ id: delivery.id, state: delivery.state })
      .from(delivery)
      .where(or(noOutcome, noStatus))
      .orderBy(asc(delivery.createdAt), asc(delivery.id))
      .limit(maxRows);

    const result: SweepResult = { requeued: requeued.length, unknown: [], failed: [], hookFailed: [] };
    for (const candidate of expired) {
      const cause: UnknownCause = candidate.state === "claimed" ? "no_outcome_after_hand_off" : "no_terminal_status";
      try {
        const settled = await db.transaction(async (tx): Promise<{ hookError: string | null } | null> => {
          // The same condition again, on the row as it is now: a callback or the run's own outcome write may have moved it since.
          const [row] = await tx
            .update(delivery)
            .set({ state: "unknown" })
            .where(and(eq(delivery.id, candidate.id), cause === "no_outcome_after_hand_off" ? noOutcome : noStatus))
            .returning();
          if (!row) return null;
          const view = viewOf(row);
          // The event is written in the transaction that made the row `unknown`, so none goes unseen: if it cannot be written, the row stays as it was.
          await recordUnknown(tx, view, cause);
          if (!afterUnknown) return { hookError: null };
          // The hook (the spend estimate, S06.08) runs in a savepoint: if it fails only its own writes are undone, and the row stays `unknown` with its event.
          try {
            await tx.transaction((savepoint) => afterUnknown(savepoint, view, cause));
            return { hookError: null };
          } catch (error) {
            return { hookError: nameOf(error) };
          }
        });
        if (settled === null) continue;
        result.unknown.push({ id: candidate.id, cause });
        if (settled.hookError !== null) result.hookFailed.push({ id: candidate.id, error: settled.hookError });
      } catch (error) {
        result.failed.push({ id: candidate.id, cause, error: nameOf(error) });
      }
    }
    return result;
  },

  async releaseClaims(db, { token }) {
    const back = await db
      .update(delivery)
      .set({ state: "queued" })
      .where(and(eq(delivery.state, "claimed"), eq(delivery.claimToken, token), isNull(delivery.handedOffAt)))
      .returning({ id: delivery.id });
    return back.length;
  },

  async lockForHandOff(tx, id, skewMs): Promise<LockedDelivery | null> {
    const [locked] = await tx
      .select({ row: delivery, sendByPassed: sql<boolean>`${delivery.sendBy} is not null and ${delivery.sendBy} <= ${dbNow(skewMs)}` })
      .from(delivery)
      .where(eq(delivery.id, id))
      .for("update");
    return locked ? { row: viewOf(locked.row), sendByPassed: locked.sendByPassed } : null;
  },

  async stopBeforeHandOff(tx, { id, token, to, errorCode }) {
    const stopped = await tx
      .update(delivery)
      .set(to === "failed" ? { state: to, providerErrorCode: errorCode ?? null } : { state: to })
      .where(claimedUnhanded(id, token))
      .returning({ id: delivery.id });
    return stopped.length === 1;
  },

  async markHandedOff(tx, { id, token }) {
    // The database stamps the instant (the trigger sets it to now() and allows it once, while the row is claimed).
    const marked = await tx.update(delivery).set({ handedOffAt: sql`now()` }).where(claimedUnhanded(id, token)).returning({ id: delivery.id });
    return marked.length === 1;
  },

  async recordOutcome(tx, { id, token, outcome, skewMs }) {
    const mine = claimedAndHandedOff(id, token);
    switch (outcome.kind) {
      case "submitted": {
        const done = await tx.update(delivery).set({ state: "submitted", providerMessageId: outcome.providerMessageId }).where(mine).returning({ id: delivery.id });
        return done.length === 1;
      }
      case "requeue": {
        // Back to the queue only because the provider did not take the text: one more attempt, due after the backoff. The
        // table stops at 3 attempts, and so does this condition.
        const done = await tx
          .update(delivery)
          .set({ state: "queued", attempts: sql`${delivery.attempts} + 1`, dueAt: ahead(skewMs, outcome.dueInMs) })
          .where(and(mine, lt(delivery.attempts, MAX_ATTEMPTS)))
          .returning({ id: delivery.id });
        return done.length === 1;
      }
      case "failed": {
        const done = await tx.update(delivery).set({ state: "failed", providerErrorCode: outcome.errorCode }).where(mine).returning({ id: delivery.id });
        return done.length === 1;
      }
      case "unknown": {
        const done = await tx.update(delivery).set({ state: "unknown" }).where(mine).returning({ id: delivery.id });
        return done.length === 1;
      }
    }
  },

  async fillProviderId(tx, { id, token, providerMessageId }) {
    const [row] = await tx
      .select({ providerMessageId: delivery.providerMessageId, claimToken: delivery.claimToken, state: delivery.state })
      .from(delivery)
      .where(eq(delivery.id, id));
    if (!row) return "not_fillable";
    if (row.providerMessageId === providerMessageId) return "same";
    if (row.providerMessageId !== null) return "different";
    // Only the row this run handed off, and only while it can still change: an `unknown` row (the sweep reached it first).
    if (row.claimToken !== token || row.state !== "unknown") return "not_fillable";
    const filled = await tx
      .update(delivery)
      .set({ providerMessageId })
      .where(and(eq(delivery.id, id), eq(delivery.state, "unknown"), eq(delivery.claimToken, token), isNull(delivery.providerMessageId)))
      .returning({ id: delivery.id });
    return filled.length === 1 ? "filled" : "not_fillable";
  },
};
