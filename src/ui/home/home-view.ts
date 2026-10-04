import type { BuildingList } from "@/contracts/buildingList";
import { audienceCoversBuilding, audienceCoversNeighbourhood } from "@/contracts/audience";
import { RESOLVED_WINDOW_MS, type ArchiveThread, type FeedThread, type FeedV1, type PlaceStatus } from "@/contracts/feed";

// What home shows for each place, worked out from the phone's choices, the building list and the feed. Pure: the
// component only draws it. The server's feed lists every place and knows nobody's choices (AD-3); the phone picks its
// own buildings out of it here.

/** The pilot's neighbourhoods, for the view before the feed or the building list has answered. */
export const PILOT_NEIGHBOURHOODS = ["TP", "FP"] as const;

/**
 * What a place shows. `checking`: the feed has not answered yet. `unknown`: it could not be read, or does not know the
 * place. Neither is ever shown as "no alerts": a screen that cannot tell must say so.
 */
export type Shown = { kind: "checking" } | { kind: "unknown" } | { kind: "status"; status: PlaceStatus; verified: boolean };

export interface FeedView {
  feed: FeedV1 | null;
  failed: boolean;
}

/** A thread behind a place's status (S05.06): the link to it, and its types, whose words are its name. */
export interface ThreadBehind {
  slug: string;
  types: readonly string[];
}

export interface BuildingRow {
  rsn: string;
  /** From the building list; absent while it loads or when the list could not be read. */
  address?: string;
  neighbourhoodId?: string;
  shown: Shown;
  behind: ThreadBehind[];
}

export interface NeighbourhoodRow {
  id: string;
  shown: Shown;
  behind: ThreadBehind[];
}

export interface HomeRows {
  buildings: BuildingRow[];
  neighbourhoods: NeighbourhoodRow[];
}

export function shownOf(place: { status: PlaceStatus; verified: boolean } | undefined, view: FeedView): Shown {
  if (view.feed) return place ? { kind: "status", status: place.status, verified: place.verified } : { kind: "unknown" };
  return view.failed ? { kind: "unknown" } : { kind: "checking" };
}

/** The phase of a thread's covering entry (AD-19): the latest entry that is substantive, not replaced by a correction or withdrawal, and has a phase. */
function coveringPhase(thread: FeedThread): string | null {
  const replaced = new Set(thread.entries.flatMap((entry) => (entry.supersedes_id ? [entry.supersedes_id] : [])));
  const live = thread.entries.filter((entry) => entry.kind !== "withdrawal" && !replaced.has(entry.id));
  const latest = [...live].sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at) || (a.id < b.id ? -1 : 1)).at(-1);
  return latest?.phase ?? null;
}

export type BehindPlace = { kind: "building"; rsn: string; neighbourhoodId: string | null } | { kind: "neighbourhood"; id: string };

/** The threads that closed, as the archive's first page names them, with the clock they were read by: what a `resolved` status is traced to (S05.07). */
export interface ClosedThreads {
  threads: readonly ArchiveThread[];
  serverNow: Date;
}

/**
 * The threads behind a `resolved` status (S05.07): the feed does not name them (its list holds open threads only, and FeedV1 cannot grow a field the phones in the field
 * would refuse), so they are found in the archive's newest threads, by the server's own rule (AD-19): closed `resolved` less than 12 hours before the archive's `server_now`,
 * and covering the place by the thread's audience (an archive thread's `audience` is its covering entry's, as the status reads it).
 */
export function resolvedBehind(place: BehindPlace, closed: ClosedThreads | null): ThreadBehind[] {
  if (!closed) return [];
  return closed.threads
    .filter(
      (thread) =>
        thread.close_reason === "resolved" &&
        closed.serverNow.getTime() - Date.parse(thread.closed_at) < RESOLVED_WINDOW_MS &&
        (place.kind === "building" ? audienceCoversBuilding(thread.audience, place) : audienceCoversNeighbourhood(thread.audience, place.id)),
    )
    .map((thread) => ({ slug: thread.slug, types: thread.types }));
}

/**
 * The threads behind a place's status, from the feed's open threads: those whose audience covers the place and whose covering entry's phase gives the status
 * (`problem` for active, `in_progress` for in progress). `resolved` has none here: a thread closed `resolved` is not in the feed's list (the status is derived from
 * threads the list does not hold), so the feed names no address for it. Uses the same coverage rules as the server's `statusOf` (contracts/audience.ts).
 */
export function threadsBehind(place: BehindPlace, status: PlaceStatus, threads: readonly FeedThread[]): ThreadBehind[] {
  const phase = status === "active" ? "problem" : status === "in_progress" ? "in_progress" : null;
  if (phase === null) return [];
  return threads
    .filter((thread) => thread.state === "open" && (place.kind === "building" ? audienceCoversBuilding(thread.audience, place) : audienceCoversNeighbourhood(thread.audience, place.id)) && coveringPhase(thread) === phase)
    .map((thread) => ({ slug: thread.slug, types: thread.types }));
}

export function behindOf(shown: Shown, feed: FeedV1 | null, place: BehindPlace, closed: ClosedThreads | null = null): ThreadBehind[] {
  if (!feed || shown.kind !== "status") return [];
  return shown.status === "resolved" ? resolvedBehind(place, closed) : threadsBehind(place, shown.status, feed.threads);
}

/**
 * The rows of home. Each chosen building comes first, in the order the resident chose them; then the neighbourhoods:
 * those of the chosen buildings, or every neighbourhood when nothing is chosen (or the list is not there to say which).
 */
export function homeRows(input: { chosen: readonly string[]; list: BuildingList | null; view: FeedView; closed?: ClosedThreads | null }): HomeRows {
  const { chosen, list, view, closed = null } = input;
  const buildings = chosen.map((rsn): BuildingRow => {
    const listed = list?.buildings.find((building) => building.rsn === rsn);
    const shown = shownOf(view.feed?.places.buildings.find((place) => place.rsn === rsn), view);
    return {
      rsn,
      address: listed?.address,
      neighbourhoodId: listed?.neighbourhoodId,
      shown,
      behind: behindOf(shown, view.feed, { kind: "building", rsn, neighbourhoodId: listed?.neighbourhoodId ?? null }, closed),
    };
  });

  const own = list ? [...new Set(buildings.flatMap((row) => (row.neighbourhoodId ? [row.neighbourhoodId] : [])))] : [];
  const everyone = view.feed ? view.feed.places.neighbourhoods.map(({ id }) => id) : [...PILOT_NEIGHBOURHOODS];
  const ids = chosen.length > 0 && own.length > 0 ? own : everyone;
  return {
    buildings,
    neighbourhoods: ids.map((id) => {
      const shown = shownOf(view.feed?.places.neighbourhoods.find((place) => place.id === id), view);
      return { id, shown, behind: behindOf(shown, view.feed, { kind: "neighbourhood", id }, closed) };
    }),
  };
}
