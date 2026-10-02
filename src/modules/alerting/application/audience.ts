// Choosing who an alert is for (S04.04, AD-7): the place picker's choice becomes the one Audience value, and
// an Audience is checked against the places that exist now. The matching rule itself is not here: it is
// src/contracts/audience.ts#matches, imported by everything that matches (the server's recipient query, the
// phone and SMS selection), and this module has no copy of it.
//
// A floor is named by its floor id. A floor range ("floors 4 to 6") is expanded at input, by the building's
// own order (`sort_order`), with identity's `expandFloorRange` (S01.14), so the audience stores the floors
// themselves and a floor added to the building later is not in it. A reversed range is refused, not turned round.
import { AUDIENCE_GROUPS, normaliseAudience, type Audience } from "../../../contracts/audience";
import type { DbExecutor } from "../../../platform/db";
import { expandFloorRange } from "../../identity";
import type { AlertRefusal } from "../domain/refusals";

/** A floor as the audience needs it: its id and its place in the building's order. */
export interface AudienceFloor {
  id: string;
  sortOrder: number;
}

/**
 * Port: the places an audience may name, read through the executor the caller gives (inside a transaction, the
 * transaction's). The composition root wires places' readers; tests give fakes.
 */
export interface AudiencePlaces {
  /** The floors of a building, lowest first; null when there is no building with that rsn. */
  floorsOf(executor: DbExecutor, rsn: string): Promise<readonly AudienceFloor[] | null>;
  /** The ids of the neighbourhoods an alert may be for. */
  neighbourhoodIds(executor: DbExecutor): Promise<readonly string[]>;
}

/** One building of the picker's choice: the whole building (`floors: null`), or the floors ticked and the ranges chosen. */
export interface BuildingChoice {
  rsn: string;
  floors: null | {
    /** Floor ids ticked one by one. */
    ids: readonly string[];
    /** Ranges "from this floor to that one", by floor id; both ends are required. */
    ranges: readonly { from: string; to: string }[];
  };
}

/** What the place picker (O-03) sends: a whole neighbourhood, or some buildings. */
export type PlaceChoice =
  | { scope: "neighbourhood"; neighbourhoodIds: readonly string[] }
  | { scope: "buildings"; buildings: readonly BuildingChoice[] };

export type Resolved<T> = { ok: true; value: T } | { ok: false; error: AlertRefusal };
const fail = (error: AlertRefusal): { ok: false; error: AlertRefusal } => ({ ok: false, error });

/** The groups a Coordinator may aim at, sorted and without repeats; a group nobody offers is refused. */
export function resolveGroups(groups: readonly string[]): Resolved<Audience["groups"]> {
  const offered: readonly string[] = AUDIENCE_GROUPS;
  if (groups.some((group) => !offered.includes(group))) return fail("GROUP_UNKNOWN");
  return { ok: true, value: AUDIENCE_GROUPS.filter((group) => groups.includes(group)).sort() };
}

/**
 * The Audience for a place choice, keeping the groups and types given. Floors come out sorted and without
 * repeats; an empty selection, a building or neighbourhood that is not there, a floor that is not in its
 * building and a reversed or half-given range are refused, each with its own reason. Every read goes through
 * `executor` (the use case's transaction).
 */
export async function resolvePlace(
  executor: DbExecutor,
  places: AudiencePlaces,
  choice: PlaceChoice,
  keep: { groups: Audience["groups"]; types: readonly string[] },
): Promise<Resolved<Audience>> {
  if (choice.scope === "neighbourhood") {
    if (choice.neighbourhoodIds.length === 0) return fail("AUDIENCE_EMPTY");
    const known = await places.neighbourhoodIds(executor);
    if (choice.neighbourhoodIds.some((id) => !known.includes(id))) return fail("NEIGHBOURHOOD_NOT_FOUND");
    return { ok: true, value: normaliseAudience({ scope: "neighbourhood", neighbourhood_ids: [...choice.neighbourhoodIds], groups: [...keep.groups], types: [...keep.types] }) };
  }
  if (choice.buildings.length === 0) return fail("AUDIENCE_EMPTY");
  const buildings: Extract<Audience, { scope: "buildings" }>["buildings"] = [];
  for (const wanted of choice.buildings) {
    const floors = await places.floorsOf(executor, wanted.rsn);
    if (floors === null) return fail("BUILDING_NOT_FOUND");
    if (wanted.floors === null) {
      buildings.push({ rsn: wanted.rsn, floors: null });
      continue;
    }
    const chosen = new Set<string>();
    for (const id of wanted.floors.ids) {
      if (!floors.some((floor) => floor.id === id)) return fail("FLOOR_NOT_IN_BUILDING");
      chosen.add(id);
    }
    for (const range of wanted.floors.ranges) {
      if (range.from === "" || range.to === "") return fail("FLOOR_RANGE_INCOMPLETE");
      const expanded = expandFloorRange(floors, range.from, range.to);
      if (expanded === "reversed") return fail("FLOOR_RANGE_REVERSED");
      if (expanded === "unknown_end") return fail("FLOOR_NOT_IN_BUILDING");
      for (const id of expanded) chosen.add(id);
    }
    if (chosen.size === 0) return fail("AUDIENCE_EMPTY");
    buildings.push({ rsn: wanted.rsn, floors: [...chosen] });
  }
  return { ok: true, value: normaliseAudience({ scope: "buildings", buildings, groups: [...keep.groups], types: [...keep.types] }) };
}

/**
 * Whether the places an audience names exist now: its neighbourhoods are the pilot's, its buildings are in the
 * register and each floor it lists is a floor of that building. Null when they do. Run inside the transaction
 * that saves or submits the entry, so a floor removed since the picker was open is caught.
 */
export async function placeRefusal(executor: DbExecutor, places: AudiencePlaces, audience: Audience): Promise<AlertRefusal | null> {
  if (audience.scope === "neighbourhood") {
    const known = await places.neighbourhoodIds(executor);
    return audience.neighbourhood_ids.every((id) => known.includes(id)) ? null : "NEIGHBOURHOOD_NOT_FOUND";
  }
  for (const wanted of audience.buildings) {
    const floors = await places.floorsOf(executor, wanted.rsn);
    if (floors === null) return "BUILDING_NOT_FOUND";
    if (wanted.floors?.some((id) => !floors.some((floor) => floor.id === id))) return "FLOOR_NOT_IN_BUILDING";
  }
  return null;
}
