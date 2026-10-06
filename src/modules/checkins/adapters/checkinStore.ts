// The statements of the check-in rows (S08.05, AD-12, AD-18). Every one runs in the caller's transaction; none reads or writes a phone number.
// The tally is the migration's trigger's: a row made adds one `requested`, a row tallied adds its outcome, in the same statement.
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { CheckinMethod } from "../../../contracts/checkin";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { escalationStore } from "./escalationStore";
import { checkin } from "./schema";

/** A row a round gets: the requester, the place and the method. `round_ref` is the database's random UUID (version 4). */
export interface NewCheckinRow {
  id: string;
  alertId: string;
  subscriberId: string;
  rsn: string;
  floorId: string;
  method: CheckinMethod;
}

/** A row that still names its subscriber, as a resident's access request reads it back (S09.03): never a round_ref, never anyone else. */
export interface SubscriberCheckinRow {
  createdAt: Date;
  alertId: string;
  rsn: string;
  floorId: string;
  method: string;
  status: string;
  /** Recorded when the row was tallied (a row kept after a close for the Hub's follow-up, S08.08); null while it is live. */
  outcome: string | null;
  /** S08.08: the row's escalations (not reached, needs help): when the Hub was told, and when and how it handled them (the Admin's note). */
  escalations: { status: "not_reached" | "needs_help"; createdAt: Date; handledAt: Date | null; handledNote: string | null }[];
}

export const checkinStore = {
  /**
   * The rows that name the subscriber: live, or kept after a close for the Hub's follow-up (a closed stub names no one), oldest first. Read
   * without a lock (the access request's read-only lookup).
   */
  async subscriberRows(executor: DbExecutor, subscriberId: string): Promise<SubscriberCheckinRow[]> {
    const rows = await executor
      .select({
        roundRef: checkin.roundRef,
        createdAt: checkin.createdAt,
        alertId: checkin.alertId,
        rsn: checkin.rsn,
        floorId: checkin.floorId,
        method: checkin.method,
        status: checkin.status,
        outcome: checkin.outcome,
      })
      .from(checkin)
      .where(and(eq(checkin.subscriberId, subscriberId), isNull(checkin.closedAt)))
      .orderBy(asc(checkin.createdAt), asc(checkin.id));
    // S08.08: the escalations of those rows (by `round_ref`, which stays here: the reader never shows it).
    const escalations = rows.length === 0 ? new Map() : await escalationStore.ofSubscriberRows(executor, subscriberId);
    // A row that names its subscriber has its method (`checkin_live_or_stub`).
    return rows.map(({ roundRef, ...row }) => ({ ...row, method: row.method ?? "", escalations: escalations.get(roundRef) ?? [] }));
  },

  /**
   * The threads of the subscriber's rows that still name them: the live rows only (a withdrawal), or also the rows kept after a close for the
   * Hub's follow-up (`withKept`: a deletion leaves nothing). Read without a lock: the request lock order locks these threads first.
   */
  async threadsOf(executor: DbExecutor, subscriberId: string, options: { withKept: boolean }): Promise<string[]> {
    const rows = await executor
      .selectDistinct({ alertId: checkin.alertId })
      .from(checkin)
      .where(and(eq(checkin.subscriberId, subscriberId), isNull(checkin.closedAt), options.withKept ? undefined : isNull(checkin.talliedAt)));
    return rows.map((row) => row.alertId);
  },

  /**
   * The subscriber's rows leave their rounds (E08 "Closed stub", "Round tally"): the rows are locked first, in id order (AD-18: `checkin`, then
   * `checkin_tally`), then each untallied one is tallied once (its latest mark, else `withdrawn`) and every one becomes a closed stub with no
   * subscriber and no method. A withdrawal takes the live rows; a deletion (`withKept`) also the rows kept for the Hub's follow-up, which were
   * tallied at the close and add nothing now. A row an approval added after the caller read the threads is taken too: under the subscriber's
   * lock no other row can appear. Returns how many rows were closed.
   */
  async leaveRounds(tx: DbTransaction, subscriberId: string, options: { withKept: boolean }): Promise<number> {
    const which = and(eq(checkin.subscriberId, subscriberId), isNull(checkin.closedAt), options.withKept ? undefined : isNull(checkin.talliedAt));
    const locked = await tx.select({ id: checkin.id }).from(checkin).where(which).orderBy(asc(checkin.id)).for("update");
    if (locked.length === 0) return 0;
    const closed = await tx
      .update(checkin)
      .set({
        outcome: sql`coalesce(${checkin.outcome}, case when ${checkin.status} = 'pending' then 'withdrawn' else ${checkin.status} end)`,
        talliedAt: sql`coalesce(${checkin.talliedAt}, now())`,
        subscriberId: null,
        method: null,
        closedAt: sql`now()`,
      })
      .where(and(inArray(checkin.id, locked.map((row) => row.id)), isNull(checkin.closedAt)))
      .returning({ id: checkin.id });
    return closed.length;
  },

  /** A change of method only: the request's live rows take the new method (E08 "Changed location": a change of method only updates its open rows). */
  async setMethod(tx: DbTransaction, subscriberId: string, method: CheckinMethod): Promise<void> {
    await tx
      .update(checkin)
      .set({ method })
      .where(and(eq(checkin.subscriberId, subscriberId), isNull(checkin.closedAt), isNull(checkin.talliedAt)));
  },

  /** Adds rows to rounds, one per thread and requester: a requester who already has a row in that thread keeps it as it is. Returns how many were added. */
  async insertRows(tx: DbTransaction, rows: readonly NewCheckinRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const added = await tx
      .insert(checkin)
      .values(rows.map((row) => ({ ...row })))
      .onConflictDoNothing({ target: [checkin.alertId, checkin.subscriberId] })
      .returning({ id: checkin.id });
    return added.length;
  },
};

export type CheckinStore = typeof checkinStore;
