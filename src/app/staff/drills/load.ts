// What the Drills page reads (S06.05): the recent drill threads (alerting), what became of each one's texts per roster member and language (messaging, drill threads
// only) and the roster's labels and size (subscriptions), put together for the page. Counts, ids and labels: no number is read here (the roster's `list` masks its
// numbers inside the module). Server only.
import { drillResultsReader, drillRoster, drillThreads } from "../../drills";
import { drillView, drillsView, type DrillsView } from "./view";

/** The most drills the page lists: the recent ones, newest first. */
export const RECENT_DRILLS = 10;

export interface DrillsReads {
  threads: ReturnType<typeof drillThreads>;
  roster: Pick<ReturnType<typeof drillRoster>, "list">;
  results: ReturnType<typeof drillResultsReader>;
}

const defaults = (): DrillsReads => ({ threads: drillThreads(), roster: drillRoster(), results: drillResultsReader() });

export async function loadDrills(reads: DrillsReads = defaults()): Promise<DrillsView> {
  const [threads, members] = await Promise.all([reads.threads.recent(RECENT_DRILLS), reads.roster.list()]);
  const labels = new Map(members.map((member) => [member.id, member.label]));
  const drills = await Promise.all(threads.map(async (thread) => drillView(thread, await reads.results.forAlert(thread.id), labels)));
  return drillsView({ rosterSize: members.length, drills });
}
