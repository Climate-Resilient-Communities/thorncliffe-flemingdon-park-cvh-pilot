// The drill threads the Hub reviews (S06.05, FR-A17, FR-M4): the recent threads whose `is_drill` is true, newest first, each with the kinds and states of its
// entries, so the drill view can show what was rehearsed (an alert, an update, a correction, a final) next to the counts messaging holds. Staff only: a
// resident reads the `nondrill_` views and never reaches this file. Read-only; nothing here changes a thread.
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { alert, alertEntry } from "../adapters/schema";

export interface DrillEntrySummary {
  id: string;
  kind: string;
  status: string;
  approvedAt: Date | null;
}

export interface DrillThreadSummary {
  id: string;
  reportedAt: Date;
  status: "open" | "closed";
  closedReason: string | null;
  /** The disruption types of the thread's entries, each once, in a fixed order. */
  types: string[];
  /** The thread's entries, oldest first, without the ones discarded. */
  entries: DrillEntrySummary[];
}

export interface DrillThreads {
  /** The newest drill threads, at most `limit`. */
  recent(limit: number): Promise<DrillThreadSummary[]>;
}

export function createDrillThreads(deps: { db: Db }): DrillThreads {
  return {
    async recent(limit) {
      const threads = await deps.db
        .select({ id: alert.id, reportedAt: alert.reportedAt, status: alert.status, closedReason: alert.closedReason })
        .from(alert)
        .where(eq(alert.isDrill, true))
        .orderBy(desc(alert.reportedAt), desc(alert.id))
        .limit(Math.max(1, Math.min(limit, 100)));
      if (threads.length === 0) return [];
      const entries = await deps.db
        .select({ id: alertEntry.id, alertId: alertEntry.alertId, kind: alertEntry.kind, status: alertEntry.status, approvedAt: alertEntry.approvedAt, types: alertEntry.types })
        .from(alertEntry)
        .where(and(inArray(alertEntry.alertId, threads.map((thread) => thread.id)), ne(alertEntry.status, "discarded")))
        .orderBy(alertEntry.createdAt, alertEntry.id);
      return threads.map((thread): DrillThreadSummary => {
        const own = entries.filter((entry) => entry.alertId === thread.id);
        return {
          id: thread.id,
          reportedAt: thread.reportedAt,
          status: thread.status as "open" | "closed",
          closedReason: thread.closedReason,
          types: [...new Set(own.flatMap((entry) => entry.types))].sort(),
          entries: own.map((entry) => ({ id: entry.id, kind: entry.kind, status: entry.status, approvedAt: entry.approvedAt })),
        };
      });
    },
  };
}
