import type { BuildingList } from "@/contracts/buildingList";
import type { FeedV1, PlaceStatus } from "@/contracts/feed";

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

export interface BuildingRow {
  rsn: string;
  /** From the building list; absent while it loads or when the list could not be read. */
  address?: string;
  neighbourhoodId?: string;
  shown: Shown;
}

export interface NeighbourhoodRow {
  id: string;
  shown: Shown;
}

export interface HomeRows {
  buildings: BuildingRow[];
  neighbourhoods: NeighbourhoodRow[];
}

function shownOf(place: { status: PlaceStatus; verified: boolean } | undefined, view: FeedView): Shown {
  if (view.feed) return place ? { kind: "status", status: place.status, verified: place.verified } : { kind: "unknown" };
  return view.failed ? { kind: "unknown" } : { kind: "checking" };
}

/**
 * The rows of home. Each chosen building comes first, in the order the resident chose them; then the neighbourhoods:
 * those of the chosen buildings, or every neighbourhood when nothing is chosen (or the list is not there to say which).
 */
export function homeRows(input: { chosen: readonly string[]; list: BuildingList | null; view: FeedView }): HomeRows {
  const { chosen, list, view } = input;
  const buildings = chosen.map((rsn): BuildingRow => {
    const listed = list?.buildings.find((building) => building.rsn === rsn);
    return {
      rsn,
      address: listed?.address,
      neighbourhoodId: listed?.neighbourhoodId,
      shown: shownOf(view.feed?.places.buildings.find((place) => place.rsn === rsn), view),
    };
  });

  const own = list ? [...new Set(buildings.flatMap((row) => (row.neighbourhoodId ? [row.neighbourhoodId] : [])))] : [];
  const everyone = view.feed ? view.feed.places.neighbourhoods.map(({ id }) => id) : [...PILOT_NEIGHBOURHOODS];
  const ids = chosen.length > 0 && own.length > 0 ? own : everyone;
  return {
    buildings,
    neighbourhoods: ids.map((id) => ({ id, shown: shownOf(view.feed?.places.neighbourhoods.find((place) => place.id === id), view) })),
  };
}
