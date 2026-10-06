// The statements of a round's close and of the escalations after they are made (S08.08, AD-12, AD-18). Each runs in the caller's executor; none reads or
// writes a phone number (the resident's number is composed by the app from subscriptions, by the subscriber id read here). The tally is S08.05's trigger's:
// a close only sets each row's outcome and `tallied_at`, and a row kept for the Hub's follow-up is counted then, once.
//
// Locks (AD-18): a close holds its thread (`alert`), its entries, `feed_version` and the delivery rows its `cancelQueued` took, and then locks the thread's
// rows here (`checkin`, in id order; `checkin_tally` follows in the trigger). The handling of an escalation locks the one `checkin` row it is about and
// then the escalation, the order a mark takes them in (the row, then its escalation's insert): never a thread or a subscriber, so it cannot deadlock with
// an approval, a close, a withdrawal or a deletion.
import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import type { EscalationStatus } from "../domain/escalations";
import { checkin, checkinEscalation } from "./schema";

/** An escalation as the Hub's list and its page read it: never the subscriber, the method or a number. */
export interface EscalationRow {
  id: string;
  status: EscalationStatus;
  alertId: string;
  rsn: string;
  floorId: string;
  raisedBy: string;
  late: boolean;
  createdAt: Date;
  handledAt: Date | null;
  handledBy: string | null;
  handledNote: string | null;
}

/**
 * The check-in row an escalation is about, as its page needs it: whether it still names its subscriber (live in its round, or kept after the close for the
 * follow-up), and then who and how. Read without a lock: the page shows it as it is.
 */
export type EscalatedRow = { linked: true; subscriberId: string; method: "call" | "text"; kept: boolean } | { linked: false };

/** What a close did to its thread's rows: how many it tallied, and how many of them it kept for the Hub's follow-up. */
export interface RoundClosed {
  tallied: number;
  kept: number;
}

const columns = {
  id: checkinEscalation.id,
  status: checkinEscalation.status,
  alertId: checkinEscalation.alertId,
  rsn: checkinEscalation.rsn,
  floorId: checkinEscalation.floorId,
  raisedBy: checkinEscalation.raisedBy,
  late: checkinEscalation.late,
  createdAt: checkinEscalation.createdAt,
  handledAt: checkinEscalation.handledAt,
  handledBy: checkinEscalation.handledBy,
  handledNote: checkinEscalation.handledNote,
};

// The table's check allows only these two.
const rowOf = (row: Omit<EscalationRow, "status"> & { status: string }): EscalationRow => ({ ...row, status: row.status === "needs_help" ? "needs_help" : "not_reached" });

/** An escalation the Hub has not handled, for the row's `round_ref` (any status). */
const openEscalationOf = (roundRef: typeof checkin.roundRef) =>
  sql`exists (select 1 from ${checkinEscalation} e where e.round_ref = ${roundRef} and e.handled_at is null)`;

export const escalationStore = {
  /**
   * The thread's rows leave their round at its close (E08 "Closed stub", "Round tally"): locked in id order, each live row is tallied (its latest mark, else
   * `unmarked`); a `not_reached` or `needs_help` row with an escalation the Hub has not handled keeps its subscriber and method for the follow-up (tallied,
   * not closed), every other row becomes a closed stub. The rule is domain/escalations.ts' `keptAtClose`. A row that left its round before (withdrawn,
   * deleted, kept by an earlier close: the thread closes once) is not touched.
   */
  async closeThreadRows(tx: DbTransaction, alertId: string): Promise<RoundClosed> {
    const live = and(eq(checkin.alertId, alertId), isNull(checkin.closedAt), isNull(checkin.talliedAt));
    const locked = await tx.select({ id: checkin.id }).from(checkin).where(live).orderBy(asc(checkin.id)).for("update");
    if (locked.length === 0) return { tallied: 0, kept: 0 };
    const kept = sql`(${checkin.status} in ('not_reached', 'needs_help') and ${openEscalationOf(checkin.roundRef)})`;
    const rows = await tx
      .update(checkin)
      .set({
        outcome: sql`case when ${checkin.status} = 'pending' then 'unmarked' else ${checkin.status} end`,
        talliedAt: sql`now()`,
        subscriberId: sql`case when ${kept} then ${checkin.subscriberId} end`,
        method: sql`case when ${kept} then ${checkin.method} end`,
        closedAt: sql`case when ${kept} then null else now() end`,
      })
      .where(live)
      .returning({ closed: checkin.closedAt });
    return { tallied: rows.length, kept: rows.filter((row) => row.closed === null).length };
  },

  /** The open escalations (oldest first is the caller's to choose: newest first here), and those handled since `handledSince`, newest first; at most `limit`. */
  async list(executor: DbExecutor, options: { handledSince: Date; limit: number }): Promise<EscalationRow[]> {
    const rows = await executor
      .select(columns)
      .from(checkinEscalation)
      .where(or(isNull(checkinEscalation.handledAt), gte(checkinEscalation.handledAt, options.handledSince)))
      .orderBy(sql`${checkinEscalation.handledAt} is not null`, desc(checkinEscalation.createdAt), desc(checkinEscalation.id))
      .limit(options.limit);
    return rows.map(rowOf);
  },

  /** One escalation; null when there is none with that id. */
  async get(executor: DbExecutor, id: string): Promise<EscalationRow | null> {
    const [row] = await executor.select(columns).from(checkinEscalation).where(eq(checkinEscalation.id, id));
    return row ? rowOf(row) : null;
  },

  /** The `round_ref` of an escalation, read without a lock (to lock its row first); null when there is none. */
  async roundRefOf(executor: DbExecutor, id: string): Promise<string | null> {
    const [row] = await executor.select({ roundRef: checkinEscalation.roundRef }).from(checkinEscalation).where(eq(checkinEscalation.id, id));
    return row?.roundRef ?? null;
  },

  /** The row an escalation is about, by its `round_ref`, read without a lock. */
  async escalatedRow(executor: DbExecutor, id: string): Promise<EscalatedRow> {
    const [row] = await executor
      .select({ subscriberId: checkin.subscriberId, method: checkin.method, talliedAt: checkin.talliedAt })
      .from(checkin)
      .innerJoin(checkinEscalation, eq(checkinEscalation.roundRef, checkin.roundRef))
      .where(eq(checkinEscalation.id, id));
    if (!row || row.subscriberId === null || row.method === null) return { linked: false };
    return { linked: true, subscriberId: row.subscriberId, method: row.method === "text" ? "text" : "call", kept: row.talliedAt !== null };
  },

  /** The row with that `round_ref`, locked FOR UPDATE (the row only): whether it is kept for the follow-up (tallied, not closed). Null when there is none. */
  async lockRow(tx: DbTransaction, roundRef: string): Promise<{ kept: boolean } | null> {
    const [row] = await tx
      .select({ kept: sql<boolean>`(${checkin.talliedAt} is not null and ${checkin.closedAt} is null)` })
      .from(checkin)
      .where(eq(checkin.roundRef, roundRef))
      .for("update");
    return row ?? null;
  },

  /** The escalation, locked FOR UPDATE; null when there is none. */
  async lockEscalation(tx: DbTransaction, id: string): Promise<EscalationRow | null> {
    const [row] = await tx.select(columns).from(checkinEscalation).where(eq(checkinEscalation.id, id)).for("update");
    return row ? rowOf(row) : null;
  },

  /** Marks it handled, by the database's clock, unless it is (the caller holds its lock). */
  async markHandled(tx: DbTransaction, id: string, handled: { by: string; note: string }): Promise<boolean> {
    const done = await tx
      .update(checkinEscalation)
      .set({ handledAt: sql`now()`, handledBy: handled.by, handledNote: handled.note })
      .where(and(eq(checkinEscalation.id, id), isNull(checkinEscalation.handledAt)))
      .returning({ id: checkinEscalation.id });
    return done.length === 1;
  },

  /**
   * A kept row whose every escalation the Hub has handled becomes a closed stub now (E08 "Closed stub": it keeps its subscriber "until an Admin marks them
   * handled"), without being tallied again. A live row (its round still open) is left as it is: its close tallies it. Returns whether the row closed.
   */
  async closeKeptIfHandled(tx: DbTransaction, roundRef: string): Promise<boolean> {
    const closed = await tx
      .update(checkin)
      .set({ subscriberId: null, method: null, closedAt: sql`now()` })
      .where(and(eq(checkin.roundRef, roundRef), isNull(checkin.closedAt), sql`${checkin.talliedAt} is not null`, sql`not ${openEscalationOf(checkin.roundRef)}`))
      .returning({ id: checkin.id });
    return closed.length === 1;
  },

  /**
   * The escalations of the rows that still name the subscriber (live, or kept for the follow-up), for a resident's access request (S09.03): their status, when,
   * and whether and how the Hub handled them. Keyed by `round_ref`, which the caller never shows.
   */
  async ofSubscriberRows(executor: DbExecutor, subscriberId: string): Promise<Map<string, Pick<EscalationRow, "status" | "createdAt" | "handledAt" | "handledNote">[]>> {
    const rows = await executor
      .select({ roundRef: checkinEscalation.roundRef, status: checkinEscalation.status, createdAt: checkinEscalation.createdAt, handledAt: checkinEscalation.handledAt, handledNote: checkinEscalation.handledNote })
      .from(checkinEscalation)
      .innerJoin(checkin, eq(checkin.roundRef, checkinEscalation.roundRef))
      .where(and(eq(checkin.subscriberId, subscriberId), isNull(checkin.closedAt)))
      .orderBy(asc(checkinEscalation.createdAt), asc(checkinEscalation.id));
    const byRef = new Map<string, Pick<EscalationRow, "status" | "createdAt" | "handledAt" | "handledNote">[]>();
    for (const row of rows) {
      const list = byRef.get(row.roundRef) ?? [];
      list.push({ status: row.status === "needs_help" ? "needs_help" : "not_reached", createdAt: row.createdAt, handledAt: row.handledAt, handledNote: row.handledNote });
      byRef.set(row.roundRef, list);
    }
    return byRef;
  },
};

export type EscalationStore = typeof escalationStore;
