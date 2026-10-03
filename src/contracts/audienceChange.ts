// What an update changes about who a thread is for (S05.01, AD-7): the places and groups it newly reaches ("Now also for: ...") and the ones it
// stops reaching ("No longer for: ..."), judged against the audience the thread has now, which is the audience of the entry that covers it. The
// approver reads both before approving; the new audience itself is stored on the update (`alert_entry.audience`) and is the one the matcher uses,
// so this is only the difference, which the screens put in words (the catalog's `staff.audience`). It lives with the matcher because the Hub's screens, which may
// not import a module's code, read it too.
//
// Reach is judged by the matcher's own rules (src/contracts/audience.ts#matches), with the pilot's one simplification: a neighbourhood covers
// every building in it, and a building listed without floors covers every floor of it. Groups narrow who is texted (every web reader still sees
// the alert): no group means no narrowing, and several groups are an alternative, so a longer list reaches more people. Pure.
import type { Audience } from "./audience";

/** The neighbourhood id of a building by rsn, null when the building is not known (the places module's, or the buildings a screen was given). */
export type NeighbourhoodOf = (rsn: string) => string | null;

/**
 * The places one side reaches and the other does not: whole neighbourhoods, the rest of a neighbourhood (some of its buildings are reached by both
 * sides, the others by one), and buildings (floors are floor ids, `null` for every floor).
 */
export interface PlacesDelta {
  neighbourhoodIds: string[];
  restOfNeighbourhoodIds: string[];
  buildings: { rsn: string; floors: string[] | null }[];
}

/**
 * The groups one side texts and the other does not. `outsideGroups` is the people who chose none of the groups the audience named: they were
 * left out by a list of groups and are reached once the list goes (or, the other way round, they are left out once a list comes).
 */
export interface GroupsDelta {
  groups: string[];
  outsideGroups: boolean;
}

export interface AudienceDelta {
  places: PlacesDelta;
  groups: GroupsDelta;
}

export interface AudienceChange {
  /** What the update newly reaches: "Now also for". */
  alsoFor: AudienceDelta;
  /** What the thread reached before and the update does not: "No longer for". */
  noLongerFor: AudienceDelta;
  /** True when either side is not empty. */
  changed: boolean;
}

const isEmptyDelta = (delta: AudienceDelta): boolean =>
  delta.places.neighbourhoodIds.length === 0 &&
  delta.places.restOfNeighbourhoodIds.length === 0 &&
  delta.places.buildings.length === 0 &&
  delta.groups.groups.length === 0 &&
  !delta.groups.outsideGroups;

/** What `next` reaches by place that `base` does not. */
function placesAdded(base: Audience, next: Audience, neighbourhoodOf: NeighbourhoodOf): PlacesDelta {
  if (next.scope === "neighbourhood") {
    // A list of buildings never covers a whole neighbourhood, so each neighbourhood of `next` is new unless `base` names it too; when `base` lists
    // buildings in it, what is new is the rest of the neighbourhood.
    const known = base.scope === "neighbourhood" ? base.neighbourhood_ids : [];
    const listed = new Set(base.scope === "buildings" ? base.buildings.map((building) => neighbourhoodOf(building.rsn)) : []);
    const fresh = next.neighbourhood_ids.filter((id) => !known.includes(id));
    return { neighbourhoodIds: fresh.filter((id) => !listed.has(id)), restOfNeighbourhoodIds: fresh.filter((id) => listed.has(id)), buildings: [] };
  }
  const buildings: PlacesDelta["buildings"] = [];
  for (const wanted of next.buildings) {
    if (base.scope === "neighbourhood") {
      const neighbourhood = neighbourhoodOf(wanted.rsn);
      if (neighbourhood !== null && base.neighbourhood_ids.includes(neighbourhood)) continue;
      buildings.push({ rsn: wanted.rsn, floors: wanted.floors === null ? null : [...wanted.floors] });
      continue;
    }
    const had = base.buildings.find((building) => building.rsn === wanted.rsn);
    if (had === undefined) buildings.push({ rsn: wanted.rsn, floors: wanted.floors === null ? null : [...wanted.floors] });
    else if (had.floors === null) continue;
    else if (wanted.floors === null) buildings.push({ rsn: wanted.rsn, floors: null });
    else {
      const extra = wanted.floors.filter((floor) => !had.floors!.includes(floor));
      if (extra.length > 0) buildings.push({ rsn: wanted.rsn, floors: extra });
    }
  }
  return { neighbourhoodIds: [], restOfNeighbourhoodIds: [], buildings };
}

/** What `next` texts by group that `base` does not. */
function groupsAdded(base: Audience, next: Audience): GroupsDelta {
  // No group on `next` reaches everyone; no group on `base` already did.
  if (next.groups.length === 0) return { groups: [], outsideGroups: base.groups.length > 0 };
  if (base.groups.length === 0) return { groups: [], outsideGroups: false };
  return { groups: next.groups.filter((group) => !base.groups.includes(group)), outsideGroups: false };
}

const added = (base: Audience, next: Audience, neighbourhoodOf: NeighbourhoodOf): AudienceDelta => ({
  places: placesAdded(base, next, neighbourhoodOf),
  groups: groupsAdded(base, next),
});

/**
 * The difference between the thread's audience now (`previous`) and the update's (`next`): what the update newly reaches, and what it no longer
 * reaches. Widening and narrowing are the same comparison the other way round, so an update that swaps one building for another has both.
 */
export function audienceChange(previous: Audience, next: Audience, neighbourhoodOf: NeighbourhoodOf): AudienceChange {
  const alsoFor = added(previous, next, neighbourhoodOf);
  const noLongerFor = added(next, previous, neighbourhoodOf);
  return { alsoFor, noLongerFor, changed: !isEmptyDelta(alsoFor) || !isEmptyDelta(noLongerFor) };
}

export { isEmptyDelta as isEmptyAudienceDelta };
