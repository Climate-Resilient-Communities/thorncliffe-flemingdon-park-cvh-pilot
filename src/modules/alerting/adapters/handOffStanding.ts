// What the sender's hand-off point reads about an alert delivery's entry and thread (S06.02, AD-8): the messaging module may not
// read alerting's tables (AD-2), so it asks through its AlertStandingReader port, which this adapter implements and the
// composition root (src/app/dispatch.ts) wires. It reads through the hand-off's own transaction and takes no lock: whatever
// must stop a send (a correction, a withdrawal, a discard, a close) writes the delivery rows itself under the delivery row's lock,
// which the hand-off holds (E06 definitions, "Hand-off point").
import { eq, sql, type SQL } from "drizzle-orm";
import type { AlertStanding, AlertStandingReader } from "../../messaging";
import { alert, alertEntry } from "./schema";

/**
 * The database's instant, moved by `skewMs` (0 in production, so it is exactly `now()`): the valid-until is judged by the database's
 * clock, as the lease, a claim's age and the `send_by` are, and never by an app server's. A test with a fake clock gives the difference.
 */
const dbNow = (skewMs: number): SQL => (skewMs === 0 ? sql`now()` : sql`(now() + ${Math.trunc(skewMs)}::double precision * interval '1 millisecond')`);

/**
 * The closing entry is the entry whose approval closed the thread: its approved `final`, or the withdrawal that left no substantive entry (or, once the
 * expire job exists, its system final). `closeAlert` records it as `alert.closing_entry_id` in the transaction that closes the thread (S05.03), and the
 * database accepts a close from the app only beside it, so a thread closed since then names it and nothing else is the closing entry of that thread: the
 * entry is it when it is that entry and still approved (or published by the system).
 *
 * A thread closed before the column existed (and a fixture written directly) records none: for those the closing entry is still told by the way its
 * approval and the close were one transaction, so that the entry's `approved_at` and the thread's `closed_at` are the same `now()`.
 */
export function isClosingEntry(row: {
  entryId?: string;
  entryStatus: string;
  entryKind: string;
  approvedAt: Date | null;
  threadStatus: string;
  closedAt: Date | null;
  closingEntryId?: string | null;
}): boolean {
  if (row.threadStatus !== "closed") return false;
  if (row.closingEntryId !== undefined && row.closingEntryId !== null) {
    return row.entryId === row.closingEntryId && (row.entryStatus === "approved" || row.entryStatus === "published_system") && (row.entryKind === "final" || row.entryKind === "withdrawal");
  }
  return (
    row.entryStatus === "approved" &&
    (row.entryKind === "final" || row.entryKind === "withdrawal") &&
    row.approvedAt !== null &&
    row.closedAt !== null &&
    row.approvedAt.getTime() === row.closedAt.getTime()
  );
}

export const alertStandingReader: AlertStandingReader = {
  async standingOf(tx, entryId, skewMs): Promise<AlertStanding | null> {
    const [row] = await tx
      .select({
        entryId: alertEntry.id,
        entryStatus: alertEntry.status,
        entryKind: alertEntry.kind,
        validUntilPassed: sql<boolean>`${alertEntry.validUntil} <= ${dbNow(skewMs)}`,
        approvedAt: alertEntry.approvedAt,
        threadStatus: alert.status,
        closedAt: alert.closedAt,
        closingEntryId: alert.closingEntryId,
        isDrill: alert.isDrill,
      })
      .from(alertEntry)
      .innerJoin(alert, eq(alert.id, alertEntry.alertId))
      .where(eq(alertEntry.id, entryId));
    if (!row) return null;
    return {
      entryStatus: row.entryStatus,
      entryKind: row.entryKind as AlertStanding["entryKind"],
      validUntilPassed: row.validUntilPassed,
      threadOpen: row.threadStatus === "open",
      isClosingEntry: isClosingEntry(row),
      isDrill: row.isDrill,
    };
  },
};
