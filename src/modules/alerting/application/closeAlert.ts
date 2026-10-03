// The one way a thread closes (S05.02, AD-5 "Closing", AR-8): `closeAlert(tx, actor, { alertId, reason, keepEntryId? })`, called inside the use case that
// decides the thread is over, in that use case's own transaction and under the thread's lock (AD-18): the approval of a withdrawal that leaves no published,
// non-superseded substantive entry (`withdrawn`, S05.02), of a `final` (`resolved`, S05.03), and the expire job (`expired`, S05.04). Nothing else writes
// `alert.status = 'closed'`.
//
// Closing: discards every draft and pending entry that residents have not read (an entry that is web-published can only be superseded, never discarded),
// calls `cancelQueued` for every entry of the thread except `keepEntryId` (the final or the withdrawal being approved: its own texts stay sendable after the
// close), then closes the thread. Every later change is refused with ALERT_CLOSED (the entry and thread triggers). The discards and the close are audited in
// the same transaction.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import { alert, alertEntry } from "../adapters/schema";
import { requestTransition } from "../domain/lifecycle";
import type { EntryStatus } from "../domain/lifecycle";
import type { AlertAudit } from "./ports";
import { Refused } from "./refused";

export type ClosedReason = "resolved" | "expired" | "withdrawn";

export interface CloseAlertInput {
  alertId: string;
  reason: ClosedReason;
  /** The entry whose deliveries are not cancelled: the final being approved, or the withdrawal that leaves nothing. */
  keepEntryId?: string;
}

export interface CloseAlertDeps {
  audit: AlertAudit;
  /** messaging's `cancelQueued(entryIds, tx)`: stops the entries' texts that are not yet handed to the provider. */
  cancelQueued: (tx: DbTransaction, entryIds: readonly string[]) => Promise<void>;
}

export interface Closed {
  alertId: string;
  reason: ClosedReason;
  /** The drafts and pending entries the close discarded. */
  discarded: string[];
  /** The entries whose queued texts the close cancelled (every entry of the thread but the one kept). */
  cancelled: string[];
}

/** `closeAlert` bound to its seams. The staff member is the one whose use case closes the thread (the actor of the audit records). */
export function createCloseAlert(deps: CloseAlertDeps) {
  return async function closeAlert(tx: DbTransaction, actor: { staffId: string }, input: CloseAlertInput): Promise<Closed> {
    // The caller holds the thread's lock already; locking again costs nothing and keeps this function safe on its own.
    const [thread] = await tx.select().from(alert).where(eq(alert.id, input.alertId)).for("update");
    if (!thread) throw new Refused("ALERT_NOT_FOUND");
    if (thread.status !== "open") throw new Refused("ALERT_CLOSED");
    const entries = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id)).for("update");

    // Nothing that residents have not read stays behind a closed thread: its drafts and its entries waiting for approval are discarded. (A pending entry
    // that is web-published, E08's D-1 case, was read by residents and is never discarded: the entry trigger refuses it.)
    const discarding = entries.filter(
      (entry) => (entry.status === "draft" || entry.status === "pending_approval") && entry.webPublishedAt === null && entry.id !== input.keepEntryId,
    );
    for (const entry of discarding) {
      const decision = requestTransition({ from: entry.status as EntryStatus, to: "discarded", webPublished: false, threadOpen: true });
      if (!decision.ok) throw new Refused(decision.refusal);
    }
    if (discarding.length > 0) {
      await tx
        .update(alertEntry)
        .set({ status: "discarded" })
        .where(
          and(
            eq(alertEntry.alertId, thread.id),
            inArray(
              alertEntry.id,
              discarding.map((entry) => entry.id),
            ),
          ),
        );
      for (const entry of discarding) {
        await deps.audit.record(tx, {
          action: "entry.discarded",
          actorStaffId: actor.staffId,
          subjectType: "alert_entry",
          subjectId: entry.id,
          isDrill: thread.isDrill,
          meta: { entry_id: entry.id, version: entry.version, from: entry.status as "draft" | "pending_approval", by_close: true },
        });
      }
    }

    // Every entry but the one kept: the texts of what is superseded, discarded or still queued stop in this same transaction.
    const cancelled = entries.map((entry) => entry.id).filter((id) => id !== input.keepEntryId);
    await deps.cancelQueued(tx, cancelled);

    await tx.update(alert).set({ status: "closed", closedReason: input.reason, closedAt: sql`now()` }).where(eq(alert.id, thread.id));
    await deps.audit.record(tx, {
      action: "alert.closed",
      actorStaffId: actor.staffId,
      subjectType: "alert",
      subjectId: thread.id,
      isDrill: thread.isDrill,
      meta: { closed_as: input.reason, discarded: discarding.length, ...(input.keepEntryId ? { kept_entry_id: input.keepEntryId } : {}) },
    });
    return { alertId: thread.id, reason: input.reason, discarded: discarding.map((entry) => entry.id), cancelled };
  };
}

export type CloseAlert = ReturnType<typeof createCloseAlert>;
