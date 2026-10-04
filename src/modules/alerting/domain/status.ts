// The status of a building or a neighbourhood (AD-19, AR-24, FR-D6), derived and never stored: `statusOf(place, threads)` is the only place it is computed. Pure: no
// I/O, no clock (the caller gives `now`, the feed's own `server_now`, so the 12-hour window of a resolved thread is measured by the server's clock, never a phone's).
//
// The status threads are the non-drill threads that are open, and those closed `resolved` in the last 12 hours (the caller reads them apart from the feed's list,
// which holds open threads only). A thread covers a place when its COVERING entry's audience does: the latest published, non-superseded substantive entry, so an
// update that narrows the audience from buildings A and B to A stops the thread covering B. Of the covering threads:
//   active       = open, covering entry phase `problem`
//   in_progress  = open, covering entry phase `in_progress`
//   resolved     = closed `resolved` less than 12 hours ago (counted from closing time)
//   none         = anything else; an expired or withdrawn thread never gives `resolved`
// Precedence active > in_progress > resolved > none. `verified` is true when at least one thread giving the winning status has a verified covering entry, and
// false only when every one of them rests on an unverified (D-1) entry; a place with no status claims nothing unverified (`NO_STATUS`).
import { audienceCoversBuilding, audienceCoversNeighbourhood, type Audience } from "../../../contracts/audience";
import { RESOLVED_WINDOW_MS, type PlaceStatus } from "../../../contracts/feed";
import { NO_STATUS, type PlaceState } from "./feed";
import type { EntryKind } from "./lifecycle";
import { isSubstantive } from "./thread";

/** How long after closing a thread closed `resolved` still gives its places the status `resolved` (the contract's, so a phone measures the same window). */
export { RESOLVED_WINDOW_MS };

/** What status reads of one published entry of a thread (from the resident views: `nondrill_alert_entry_v2`). */
export interface StatusEntry {
  id: string;
  kind: EntryKind;
  /** The entry's phase; an entry of a kind that carries none (a final, a withdrawal) is read as absent. */
  phase: string | null;
  verified: boolean;
  /** A later correction or withdrawal replaced it. */
  superseded: boolean;
  publishedAt: Date;
  /** Null when the stored audience does not parse: the entry still takes part in choosing the covering entry, but covers nothing. */
  audience: Audience | null;
}

/** A non-drill thread with its published entries, as the status reads it. */
export interface StatusThread {
  id: string;
  slug: string;
  state: "open" | "closed";
  /** How it closed (`resolved`, `expired`, `withdrawn`); null while open. */
  closeReason: string | null;
  closedAt: Date | null;
  entries: readonly StatusEntry[];
}

/** The place whose status is asked: a building (with its neighbourhood, through which a neighbourhood audience covers it) or a neighbourhood. */
export type StatusPlace = { kind: "building"; rsn: string; neighbourhoodId: string | null } | { kind: "neighbourhood"; id: string };

/** A place's status, with the slugs of the threads that give it (the threads behind it). */
export interface PlaceStatusResult extends PlaceState {
  threads: string[];
}

const RANK: Record<PlaceStatus, number> = { none: 0, resolved: 1, in_progress: 2, active: 3 };

const byTime = (a: StatusEntry, b: StatusEntry) => a.publishedAt.getTime() - b.publishedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The covering entry (AD-19): the latest published, non-superseded substantive entry; null when the thread has none. */
export function statusCoveringEntry(thread: StatusThread): StatusEntry | null {
  const live = thread.entries.filter((entry) => !entry.superseded && isSubstantive(entry.kind));
  return live.length === 0 ? null : [...live].sort(byTime).at(-1)!;
}

/** What one thread gives a place it covers; `none` when it gives nothing. */
function statusOfThread(thread: StatusThread, covering: StatusEntry, now: Date): PlaceStatus {
  if (thread.state === "open") {
    if (covering.phase === "problem") return "active";
    if (covering.phase === "in_progress") return "in_progress";
    return "none";
  }
  if (thread.closeReason !== "resolved" || thread.closedAt === null) return "none";
  // Counted from closing time: at exactly 12 hours it is over.
  return now.getTime() - thread.closedAt.getTime() < RESOLVED_WINDOW_MS ? "resolved" : "none";
}

/** The status of `place` over the status threads; `now` is the feed's `server_now`, a third argument to the epic's `statusOf(place, threads)` because the domain has no clock. A drill is never among the threads: the caller reads the resident views only (AD-6). */
export function statusOf(place: StatusPlace, threads: readonly StatusThread[], now: Date): PlaceStatusResult {
  let best: PlaceStatus = "none";
  let given: { slug: string; verified: boolean }[] = [];
  for (const thread of threads) {
    const covering = statusCoveringEntry(thread);
    if (covering === null) continue;
    const covers = covering.audience !== null && (place.kind === "building" ? audienceCoversBuilding(covering.audience, place) : audienceCoversNeighbourhood(covering.audience, place.id));
    if (!covers) continue;
    const status = statusOfThread(thread, covering, now);
    if (RANK[status] === 0 || RANK[status] < RANK[best]) continue;
    if (RANK[status] > RANK[best]) {
      best = status;
      given = [];
    }
    given.push({ slug: thread.slug, verified: covering.verified });
  }
  if (best === "none") return { ...NO_STATUS, threads: [] };
  return { status: best, verified: given.some((thread) => thread.verified), threads: given.map((thread) => thread.slug).sort() };
}

/** The status of every building and neighbourhood the feed lists. `neighbourhoodOf` gives a building's neighbourhood (one it does not know is covered by buildings audiences only). */
export function statusesOf(
  places: { buildings: readonly string[]; neighbourhoods: readonly string[]; neighbourhoodOf?: Readonly<Record<string, string>> },
  threads: readonly StatusThread[],
  now: Date,
): { buildings: Map<string, PlaceState>; neighbourhoods: Map<string, PlaceState> } {
  const state = ({ status, verified }: PlaceStatusResult): PlaceState => ({ status, verified });
  return {
    buildings: new Map(places.buildings.map((rsn) => [rsn, state(statusOf({ kind: "building", rsn, neighbourhoodId: places.neighbourhoodOf?.[rsn] ?? null }, threads, now))])),
    neighbourhoods: new Map(places.neighbourhoods.map((id) => [id, state(statusOf({ kind: "neighbourhood", id }, threads, now))])),
  };
}
