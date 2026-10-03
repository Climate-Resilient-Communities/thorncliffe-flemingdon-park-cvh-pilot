// The alerting read model of a running thread (S05.01): what residents can read of it, newest first, with each entry's time and phase, which entry covers
// it and the valid-until it gives the thread; and the open threads the Hub can add to. Every rule is `domain/thread.ts`; this reads the rows and applies them.
//
// Staff-side: it reads `alert` and `alert_entry` with the entries' English originals, for the screens that write to a thread. The resident reader (the feed and
// R-07, S04.08) reads only the non-drill view and applies the same rules to its own rows (`newestFirst`, `threadValidUntil`), which `FeedThreadSchema` checks.
import { desc, eq, inArray } from "drizzle-orm";
import type { Audience } from "../../../contracts/audience";
import type { DbExecutor } from "../../../platform/db";
import { alert, alertEntry } from "../adapters/schema";
import type { Phase, ValidUntilMode } from "../domain/content";
import type { EntryKind, EntryStatus } from "../domain/lifecycle";
import { coveringEntry, isAckOnly, isPublished, newestFirst, threadValidUntil, type ThreadEntryFacts } from "../domain/thread";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One entry residents can read: what the rules read of it and its English original. */
export interface ThreadEntrySummary extends ThreadEntryFacts {
  text: string;
  version: number;
  /** Always set: only published entries are listed. */
  webPublishedAt: Date;
}

/** The thread itself (the same fields as the lifecycle's `ThreadView`). */
export interface ThreadHead {
  id: string;
  slug: string;
  isDrill: boolean;
  reportedAt: Date;
  status: "open" | "closed";
}

export interface ThreadSummary {
  thread: ThreadHead;
  /** The entries residents can read, newest first: the order they are shown in, with `webPublishedAt` as each one's time and `phase` as where things stood. */
  entries: ThreadEntrySummary[];
  /** The latest published, non-superseded substantive entry; null while nothing substantive is published. */
  covering: ThreadEntrySummary | null;
  /** The covering entry's valid-until. */
  validUntil: Date | null;
  /** Every substantive entry residents can read is an acknowledgement: the next step is "Promote to full alert" (O-13). */
  ackOnly: boolean;
}

/** An open thread on the Hub's list of what is running, with what a person needs to add to it. */
export interface RunningThread {
  alertId: string;
  slug: string;
  isDrill: boolean;
  reportedAt: Date;
  types: readonly string[];
  /** Where things stood at the covering entry. */
  phase: Phase;
  validUntil: Date;
  /** When residents last read something new about it. */
  publishedAt: Date;
  coveringKind: EntryKind;
  /** The next step is "Promote to full alert" (O-13) rather than "Add an update" (O-14). */
  ackOnly: boolean;
  /** How many entries residents can read. */
  entries: number;
}

type EntryRow = typeof alertEntry.$inferSelect;
type ThreadRow = typeof alert.$inferSelect;

const headOf = (row: ThreadRow): ThreadHead => {
  if (row.slug === null) throw new Error("alerting: a thread has no slug");
  return { id: row.id, slug: row.slug, isDrill: row.isDrill, reportedAt: row.reportedAt, status: row.status as ThreadHead["status"] };
};

const summaryOf = (row: EntryRow): ThreadEntrySummary => ({
  id: row.id,
  kind: row.kind as EntryKind,
  status: row.status as EntryStatus,
  webPublishedAt: row.webPublishedAt as Date,
  phase: row.phase as Phase,
  validUntil: row.validUntil,
  validUntilMode: row.validUntilMode as ValidUntilMode,
  audience: row.audience as Audience,
  types: row.types,
  text: row.originalText,
  version: row.version,
});

/** The entries of these rows that residents can read, as summaries, newest first. */
export const publishedSummaries = (rows: readonly EntryRow[]): ThreadEntrySummary[] => newestFirst(rows.filter(isPublished).map(summaryOf));

/**
 * One thread as residents have read it so far. Read through `executor`, so a caller that already holds the thread's lock reads it in its own transaction.
 * Null when there is no such thread.
 */
export async function readThreadSummary(executor: DbExecutor, alertId: string): Promise<ThreadSummary | null> {
  if (!UUID.test(alertId)) return null;
  const [threadRow] = await executor.select().from(alert).where(eq(alert.id, alertId));
  if (!threadRow) return null;
  const rows = await executor.select().from(alertEntry).where(eq(alertEntry.alertId, alertId));
  const entries = publishedSummaries(rows);
  const covering = coveringEntry(entries);
  return { thread: headOf(threadRow), entries, covering: covering === null ? null : (covering as ThreadEntrySummary), validUntil: threadValidUntil(entries), ackOnly: isAckOnly(entries) };
}

/**
 * The open threads that have something substantive residents can read, newest news first: what the Hub can add an update to. A thread whose first entry is
 * still waiting for approval is not here (it has nothing to add to), and neither is a closed one: a closed thread offers no "Add an update".
 */
export async function readRunningThreads(executor: DbExecutor, limit = 100): Promise<RunningThread[]> {
  const threads = await executor.select().from(alert).where(eq(alert.status, "open")).orderBy(desc(alert.createdAt)).limit(limit);
  if (threads.length === 0) return [];
  const rows = await executor
    .select()
    .from(alertEntry)
    .where(inArray(alertEntry.alertId, threads.map((thread) => thread.id)));
  const running: RunningThread[] = [];
  for (const thread of threads) {
    const entries = publishedSummaries(rows.filter((row) => row.alertId === thread.id));
    const covering = coveringEntry(entries);
    if (covering === null) continue;
    running.push({
      alertId: thread.id,
      slug: headOf(thread).slug,
      isDrill: thread.isDrill,
      reportedAt: thread.reportedAt,
      types: covering.types,
      phase: covering.phase,
      validUntil: covering.validUntil,
      publishedAt: covering.webPublishedAt as Date,
      coveringKind: covering.kind,
      ackOnly: isAckOnly(entries),
      entries: entries.length,
    });
  }
  return running.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
}
