// What the sender's hand-off point reads about an alert delivery's entry and thread (S06.02, AD-8): the messaging module may not
// read alerting's tables (AD-2), so it asks through its AlertStandingReader port, which this adapter implements and the
// composition root (src/app/dispatch.ts) wires. It reads through the hand-off's own transaction and takes no lock: whatever
// must stop a send (a correction, a withdrawal, a discard, a close) writes the delivery rows itself under the delivery row's lock,
// which the hand-off holds (E06 definitions, "Hand-off point").
import { eq } from "drizzle-orm";
import type { AlertStanding, AlertStandingReader } from "../../messaging";
import { alert, alertEntry } from "./schema";

/**
 * The closing entry is the entry whose approval closed the thread: its approved `final`, or the withdrawal that left no
 * substantive entry. Its approval and the close are one transaction (E05: `closeAlert(alertId, reason, keepEntryId)` runs in the
 * approval's transaction), so the entry's `approved_at` and the thread's `closed_at` are the same `now()`. Until E05 records the
 * kept entry explicitly (S05.03), that equality is how the closing entry is told from every other entry of a closed thread;
 * S05.03 and S06.03 replace this with the recorded entry and keep this reader's test.
 */
export function isClosingEntry(row: { entryStatus: string; entryKind: string; approvedAt: Date | null; threadStatus: string; closedAt: Date | null }): boolean {
  return (
    row.threadStatus === "closed" &&
    row.entryStatus === "approved" &&
    (row.entryKind === "final" || row.entryKind === "withdrawal") &&
    row.approvedAt !== null &&
    row.closedAt !== null &&
    row.approvedAt.getTime() === row.closedAt.getTime()
  );
}

export const alertStandingReader: AlertStandingReader = {
  async standingOf(tx, entryId): Promise<AlertStanding | null> {
    const [row] = await tx
      .select({
        entryStatus: alertEntry.status,
        entryKind: alertEntry.kind,
        validUntil: alertEntry.validUntil,
        approvedAt: alertEntry.approvedAt,
        threadStatus: alert.status,
        closedAt: alert.closedAt,
        isDrill: alert.isDrill,
      })
      .from(alertEntry)
      .innerJoin(alert, eq(alert.id, alertEntry.alertId))
      .where(eq(alertEntry.id, entryId));
    if (!row) return null;
    return {
      entryStatus: row.entryStatus,
      entryKind: row.entryKind as AlertStanding["entryKind"],
      validUntil: row.validUntil,
      threadOpen: row.threadStatus === "open",
      isClosingEntry: isClosingEntry(row),
      isDrill: row.isDrill,
    };
  },
};
