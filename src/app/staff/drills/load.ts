// What the Drills page reads (S06.05): the recent drill threads (alerting), what became of each one's texts per roster member and language (messaging, drill threads
// only) and the roster's labels and size (subscriptions), put together for the page. Counts, ids and labels: no number is read here (the roster's `list` masks its
// numbers inside the module). Server only.
import { drillResultsReader, drillRoster, drillThreads } from "../../drills";
import { drillView, drillsView, type DrillsView } from "./view";

/** The most drills the page lists: the recent ones, newest first. */
export const RECENT_DRILLS = 10;

export interface DrillsReads {
  threads: ReturnType<typeof drillThreads>;
  roster: Pick<ReturnType<typeof drillRoster>, "size" | "labelsOf">;
  results: ReturnType<typeof drillResultsReader>;
}

const defaults = (): DrillsReads => ({ threads: drillThreads(), roster: drillRoster(), results: drillResultsReader() });

export async function loadDrills(reads: DrillsReads = defaults()): Promise<DrillsView> {
  const [threads, rosterSize] = await Promise.all([reads.threads.recent(RECENT_DRILLS), reads.roster.size()]);
  const results = await Promise.all(threads.map((thread) => reads.results.forAlert(thread.id)));
  // Labels only, for the members the results name: the page never reads a number (not even to mask it).
  const ids = [...new Set(results.flatMap((rows) => rows.flatMap((row) => (row.recipientId === null ? [] : [row.recipientId]))))];
  const labels = await reads.roster.labelsOf(ids);
  return drillsView({ rosterSize, drills: threads.map((thread, at) => drillView(thread, results[at], labels)) });
}
