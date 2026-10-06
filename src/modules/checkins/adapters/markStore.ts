// The statements of the round page and its marks (S08.07, AD-12, AD-18). Each runs in the caller's executor; none reads or writes a phone number (the
// round's contacts are composed by the app from subscriptions). A mark changes one `checkin` row, under that row's lock and no other: it never waits for
// a thread or a subscriber while holding it, so it cannot deadlock with an approval, a withdrawal, a deletion or a close (which lock the thread first and
// the row later). The tally is not touched: the row's latest mark becomes its outcome when it leaves the round (S08.05's trigger).
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import type { MarkStatus, RowStatus } from "../../../contracts/checkinRound";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { MARK_IDS_KEPT, STUB_LIFETIME_HOURS, type MarkTarget } from "../domain/marks";
import { checkin, checkinEscalation } from "./schema";

/** A live row of a round as the round page is made from it: never shown as such (the app keeps the subscriber's id to itself). */
export interface LiveRoundRow {
  roundRef: string;
  alertId: string;
  subscriberId: string;
  rsn: string;
  floorId: string;
  method: "call" | "text";
  status: RowStatus;
}

/** The row a mark names, under its lock: where it is, and what decideMark needs. */
export interface MarkRow extends MarkTarget {
  alertId: string;
  rsn: string;
  floorId: string;
}

/** An escalation as a mark makes it (E08 "Escalation"): never the subscriber, the method or a number. */
export interface NewEscalation {
  id: string;
  roundRef: string;
  status: "not_reached" | "needs_help";
  alertId: string;
  rsn: string;
  floorId: string;
  raisedBy: string;
  late: boolean;
}

export const markStore = {
  /**
   * The live rows (they name their subscriber and are not tallied), oldest first: the rows of the open rounds (a closed thread's rows are tallied
   * by its close, S08.08). Read without a lock: the page shows them as they are.
   */
  async liveRows(executor: DbExecutor): Promise<LiveRoundRow[]> {
    const rows = await executor
      .select({
        roundRef: checkin.roundRef,
        alertId: checkin.alertId,
        subscriberId: checkin.subscriberId,
        rsn: checkin.rsn,
        floorId: checkin.floorId,
        method: checkin.method,
        status: checkin.status,
      })
      .from(checkin)
      .where(and(isNotNull(checkin.subscriberId), isNull(checkin.closedAt), isNull(checkin.talliedAt)))
      .orderBy(asc(checkin.createdAt), asc(checkin.id));
    // A live row names its subscriber and method (`checkin_live_or_stub`); its status is one of the checked four.
    return rows.map((row) => ({ ...row, subscriberId: row.subscriberId ?? "", method: row.method === "text" ? "text" : "call", status: row.status as RowStatus }));
  },

  /** Where the row a mark names is, read without a lock (the guard's facts: the building and floor); null when there is no such row. */
  async placeOf(executor: DbExecutor, roundRef: string): Promise<{ rsn: string; floorId: string } | null> {
    const [row] = await executor.select({ rsn: checkin.rsn, floorId: checkin.floorId }).from(checkin).where(eq(checkin.roundRef, roundRef));
    return row ?? null;
  },

  /**
   * The row a mark names, locked FOR UPDATE (the row only: AD-18's `checkin`), with whether it is live and, for a stub, whether it closed more than
   * STUB_LIFETIME_HOURS ago by the database's clock. Null when there is no such row (never was, or purged).
   */
  async lockForMark(tx: DbTransaction, roundRef: string): Promise<MarkRow | null> {
    const [row] = await tx
      .select({
        alertId: checkin.alertId,
        rsn: checkin.rsn,
        floorId: checkin.floorId,
        live: sql<boolean>`(${checkin.subscriberId} is not null and ${checkin.talliedAt} is null and ${checkin.closedAt} is null)`,
        expired: sql<boolean>`coalesce(${checkin.closedAt} <= now() - make_interval(hours => ${STUB_LIFETIME_HOURS}), false)`,
        markIds: checkin.markIds,
      })
      .from(checkin)
      .where(eq(checkin.roundRef, roundRef))
      .for("update");
    return row ?? null;
  },

  /** The mark becomes the live row's latest (a later mark replaces an earlier one), and its id is kept with the latest MARK_IDS_KEPT. */
  async applyMark(tx: DbTransaction, roundRef: string, mark: { id: string; status: MarkStatus }): Promise<void> {
    await tx
      .update(checkin)
      .set({
        status: mark.status,
        markIds: sql`(array_append(${checkin.markIds}, ${mark.id}::uuid))[greatest(cardinality(${checkin.markIds}) - ${MARK_IDS_KEPT - 2}, 1):]`,
      })
      .where(and(eq(checkin.roundRef, roundRef), isNull(checkin.talliedAt), isNull(checkin.closedAt)));
  },

  /** An escalation, unless one exists for that `round_ref` and status (unique): whether this one was made. */
  async raiseEscalation(tx: DbTransaction, escalation: NewEscalation): Promise<boolean> {
    const made = await tx.insert(checkinEscalation).values(escalation).onConflictDoNothing({ target: [checkinEscalation.roundRef, checkinEscalation.status] }).returning({ id: checkinEscalation.id });
    return made.length > 0;
  },
};

export type MarkStore = typeof markStore;
