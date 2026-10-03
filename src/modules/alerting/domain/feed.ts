// The public feed's shape (AD-17, AD-20) as a pure function: the web-published threads and the derived status of every
// place, assembled into FeedV1. What the threads and statuses ARE is not decided here: S04.08 supplies them (from the
// approved, web-published, non-drill entries) and S05.06 derives the statuses (AD-19, `statusOf`). Until then the
// source is empty, so every place is `none`.
import type { FeedThread, FeedV1, PlaceStatus } from "../../../contracts/feed";

export interface PlaceState {
  status: PlaceStatus;
  /** AD-19: false only when every thread giving the status rests on an unverified entry. */
  verified: boolean;
}

/** A place with nothing affecting it. Nothing is claimed that could be unverified, so it counts as verified. */
export const NO_STATUS: PlaceState = { status: "none", verified: true };

export interface FeedParts {
  feedVersion: number;
  now: Date;
  threads: readonly FeedThread[];
  /** Every building (register number) and neighbourhood (id) there is: the feed lists all of them, so a phone finds its own. */
  places: { buildings: readonly string[]; neighbourhoods: readonly string[] };
  /** The derived status of a place; a place the map does not name is `none`. */
  statuses: { buildings: ReadonlyMap<string, PlaceState>; neighbourhoods: ReadonlyMap<string, PlaceState> };
}

export function buildFeed(parts: FeedParts): FeedV1 {
  const { statuses } = parts;
  return {
    v: 1,
    feed_version: parts.feedVersion,
    server_now: parts.now.toISOString(),
    threads: [...parts.threads],
    places: {
      buildings: parts.places.buildings.map((rsn) => ({ rsn, ...(statuses.buildings.get(rsn) ?? NO_STATUS) })),
      neighbourhoods: parts.places.neighbourhoods.map((id) => ({ id, ...(statuses.neighbourhoods.get(id) ?? NO_STATUS) })),
    },
  };
}
