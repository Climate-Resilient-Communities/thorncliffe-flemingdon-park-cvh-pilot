// The one way a thread closes (S05.02, AD-5 "Closing", AR-8): `closeAlert(tx, actor, { alertId, reason, keepEntryId? })`, called inside the use case that
// decides the thread is over, in that use case's own transaction and under the thread's lock (AD-18): the approval of a withdrawal that leaves no published,
// non-superseded substantive entry (`withdrawn`, S05.02), of a `final` (`resolved`, S05.03), and the expire job (`expired`, S05.04). Nothing else writes
// `alert.status = 'closed'`.
//
// Closing: discards every draft and pending entry that residents have not read (an entry that is web-published can only be superseded, never discarded),
// raises `feed_version` (a drill raises nothing), calls `cancelQueued` for every entry of the thread except `keepEntryId` (the final or the withdrawal being
// approved: its own texts stay sendable after the close), then closes the thread and records the kept entry as the one that closed it
// (`alert.closing_entry_id`, which the sender reads, S06.02). Every later change is refused with ALERT_CLOSED (the entry and thread triggers). The discards and
// the close are audited in the same transaction.
//
// Lock order (AD-18): alert, alert_entry, feed_version, then the delivery rows `cancelQueued` locks (then, S08.08, the round's `checkin` rows). This function
// locks the thread and then every entry of it before it touches `feed_version` or a delivery row, so called first in a transaction it is in order. A caller that
// has locked `feed_version` already (an approval raises it before it closes the thread) must have locked every entry of the thread before that (`approveEntry`
// does, for the entries it may close the thread with) and says so with `feedRaised`, so `feed_version` is raised once in the transaction. The database refuses
// the close of a thread, with the app's credentials, beside anything but the entry that closes it (db/migrations/20261004050000_alert_close.sql): `resolved`
// beside an approved `final`, `withdrawn` beside an approved withdrawal (or the system withdrawal of a discarded web-published post, S08.03), `expired` beside a
// system final (S05.04), each made in this same transaction.
//
// S08.08: the thread's check-in round ends with it, in the same transaction, after the delivery rows (AD-18: `checkin`, then `checkin_tally`): checkins'
// `closeRound` tallies every row of the round; `pending` and `done` rows become closed stubs, and a `not_reached` or `needs_help` row the Hub has not handled
// keeps its subscriber for the follow-up (E08 "Closed stub"). A drill thread has no round (S08.05's insert guard), so it finds nothing. A final's approval
// closes the thread before it captures the final's recipients, so it ends the round itself after the capture (`roundEndedByCaller`): AD-18's order is the
// recipient rows, then `checkin`.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DbTransaction } from "../../../platform/db";
import { closeRound, type RoundClosed } from "../../checkins";
import { alert, alertEntry, feedVersion } from "../adapters/schema";
import { requestTransition } from "../domain/lifecycle";
import type { EntryStatus } from "../domain/lifecycle";
import type { AlertAudit } from "./ports";
import { Refused } from "./refused";

export type ClosedReason = "resolved" | "expired" | "withdrawn";

export interface CloseAlertInput {
  alertId: string;
  reason: ClosedReason;
  /**
   * The entry whose deliveries are not cancelled and that is recorded as the one that closed the thread: the final being approved (`resolved`, required),
   * the withdrawal that leaves nothing (`withdrawn`, required), or the expire job's system final (`expired`): always required, as the database requires it. It must be an entry of this thread, approved
   * (or published by the system) and of the kind the reason needs: closing never keeps an entry that is not the closing one.
   */
  keepEntryId: string;
  /** The caller raised `feed_version` in this transaction already (an approval does, before it closes): closing then does not raise it again. */
  feedRaised?: boolean;
  /**
   * S08.08: the caller ends the thread's round itself, later in this transaction, with checkins' `closeRound`: a final's approval, which closes the thread
   * before it captures the final's recipients, does it after the capture (AD-18 takes the recipient rows before `checkin`). Otherwise the close ends it.
   */
  roundEndedByCaller?: boolean;
}

export interface CloseAlertDeps {
  audit: AlertAudit;
  /** messaging's `cancelQueued(entryIds, tx)`: stops the entries' texts that are not yet handed to the provider. */
  cancelQueued: (tx: DbTransaction, entryIds: readonly string[]) => Promise<void>;
  /** checkins' `closeRound(tx, alertId)` (S08.08): the round's rows tallied, in this transaction. The real one unless a test replaces it. */
  closeRound?: (tx: DbTransaction, alertId: string) => Promise<RoundClosed>;
}

export interface Closed {
  alertId: string;
  reason: ClosedReason;
  /** The drafts and pending entries the close discarded. */
  discarded: string[];
  /** The entries whose queued texts the close cancelled (every entry of the thread but the one kept). */
  cancelled: string[];
  /** The feed version after this close raised it; null for a drill (it raises nothing the web shows) or when the caller had raised it (`feedRaised`). */
  feedVersion: number | null;
  /** S08.08: the round's rows the close tallied, and how many of them it kept for the Hub's follow-up; null when the caller ends the round itself. */
  round: RoundClosed | null;
}

/** The kind and status the entry that closes a thread has, by the reason: the database's rule too. */
const CLOSING_ENTRY: Record<ClosedReason, { kind: string; status: readonly string[] }> = {
  resolved: { kind: "final", status: ["approved"] },
  // An approved withdrawal, or the system withdrawal that took the place of a web-published post that was discarded (S08.03).
  withdrawn: { kind: "withdrawal", status: ["approved", "published_system"] },
  expired: { kind: "final", status: ["published_system"] },
};

/** `closeAlert` bound to its seams. The staff member is the one whose use case closes the thread (the actor of the audit records). */
export function createCloseAlert(deps: CloseAlertDeps) {
  const endRound = deps.closeRound ?? ((tx: DbTransaction, alertId: string) => closeRound(tx, alertId));
  return async function closeAlert(tx: DbTransaction, actor: { staffId: string | null }, input: CloseAlertInput): Promise<Closed> {
    // The caller holds the thread's lock already; locking again costs nothing and keeps this function safe on its own.
    const [thread] = await tx.select().from(alert).where(eq(alert.id, input.alertId)).for("update");
    if (!thread) throw new Refused("ALERT_NOT_FOUND");
    if (thread.status !== "open") throw new Refused("ALERT_CLOSED");
    const entries = await tx.select().from(alertEntry).where(eq(alertEntry.alertId, thread.id)).for("update");
    // The entry whose texts are kept is an entry of this thread (one of another thread, or one that is not there, is refused) and is the entry that closes
    // it: a resolved thread is closed by its approved final, a withdrawn one by its approved withdrawal, an expired one by its system final. Anything else is
    // a caller's mistake, not a refusal a person can cause: the transaction rolls back.
    if (!input.keepEntryId) throw new Error(`closeAlert: closing as ${input.reason} always names the entry that closes the thread (keepEntryId)`);
    const kept = entries.find((entry) => entry.id === input.keepEntryId);
    if (!kept) throw new Refused("ENTRY_NOT_FOUND");
    if (kept.kind !== CLOSING_ENTRY[input.reason].kind || !CLOSING_ENTRY[input.reason].status.includes(kept.status)) {
      throw new Error(`closeAlert: a thread closed as ${input.reason} is closed by an ${CLOSING_ENTRY[input.reason].status.join(" or ")} ${CLOSING_ENTRY[input.reason].kind}, not a ${kept.status} ${kept.kind}`);
    }

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
        // Why (S08.02): the thread closed with it unread; an ambassador's post discarded so is not "declined" by the Hub.
        .set({ status: "discarded", discardReason: "by_close" })
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
          meta: { entry_id: entry.id, version: entry.version, from: entry.status as "draft" | "pending_approval", by_close: true, discard_reason: "by_close" },
        });
      }
    }

    // `feed_version` before the delivery rows (AD-18): a drill changes nothing the web shows, so it raises nothing. The thread leaves the feed, which is a change.
    let feedVersionNow: number | null = null;
    if (!thread.isDrill && input.feedRaised !== true) {
      const bumped = await tx.update(feedVersion).set({ version: sql`${feedVersion.version} + 1` }).where(eq(feedVersion.id, 1)).returning({ version: feedVersion.version });
      if (bumped.length !== 1) throw new Error("alerting: feed_version has no row");
      feedVersionNow = Number(bumped[0].version);
    }

    // Every entry but the one kept: the texts of what is superseded, discarded or still queued stop in this same transaction.
    const cancelled = entries.map((entry) => entry.id).filter((id) => id !== input.keepEntryId);
    await deps.cancelQueued(tx, cancelled);

    // The round ends with the thread (S08.08): its rows after the delivery rows, in AD-18's order (unless the caller ends it after its own capture).
    const round = input.roundEndedByCaller === true ? null : await endRound(tx, thread.id);

    await tx
      .update(alert)
      .set({ status: "closed", closedReason: input.reason, closedAt: sql`now()`, closingEntryId: input.keepEntryId ?? null })
      .where(eq(alert.id, thread.id));
    await deps.audit.record(tx, {
      action: "alert.closed",
      actorStaffId: actor.staffId,
      subjectType: "alert",
      subjectId: thread.id,
      isDrill: thread.isDrill,
      meta: { closed_as: input.reason, discarded: discarding.length, ...(input.keepEntryId ? { kept_entry_id: input.keepEntryId } : {}) },
    });
    return { alertId: thread.id, reason: input.reason, discarded: discarding.map((entry) => entry.id), cancelled, feedVersion: feedVersionNow, round };
  };
}

export type CloseAlert = ReturnType<typeof createCloseAlert>;
