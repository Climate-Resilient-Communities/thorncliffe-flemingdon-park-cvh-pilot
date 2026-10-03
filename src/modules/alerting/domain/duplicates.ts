// A possible duplicate (epic E04 S04.05, AD-5 Duplicates): a new thread that overlaps an open, non-drill thread in audience
// and in type. The approver is shown a "possible duplicate" link to that thread (S04.07); a duplicate is withdrawn with the
// reason "duplicate" (S05.02; merging is deferred to the MVP). Advisory: nothing is refused or hashed because of it.
//
// Two audiences overlap when some resident could be in both, by the one matcher's rules (AD-7, src/contracts/audience.ts):
//  - a neighbourhood overlaps a neighbourhood it shares an id with, and a building of that neighbourhood;
//  - buildings overlap when they share a building. Floors do not narrow this: a profile with no floor recorded matches
//    every floor of its building (AD-7), so two audiences for the same building reach that resident even for disjoint floors;
//  - groups narrow who is texted: two audiences that both name groups, and share none, reach no resident in common; an
//    audience with no group reaches everyone in its place.
// The types must share at least one. Pure.
import type { Audience } from "../../../contracts/audience";

/** The neighbourhood id of a building by rsn, null when the building is not known. */
export type NeighbourhoodOf = (rsn: string) => string | null;

function placesOverlap(a: Audience, b: Audience, neighbourhoodOf: NeighbourhoodOf): boolean {
  if (a.scope === "neighbourhood" && b.scope === "neighbourhood") return a.neighbourhood_ids.some((id) => b.neighbourhood_ids.includes(id));
  if (a.scope === "buildings" && b.scope === "buildings") return a.buildings.some((one) => b.buildings.some((other) => other.rsn === one.rsn));
  const [wide, narrow] = a.scope === "neighbourhood" ? [a, b] : [b, a];
  if (wide.scope !== "neighbourhood" || narrow.scope !== "buildings") return false;
  return narrow.buildings.some((building) => {
    const neighbourhood = neighbourhoodOf(building.rsn);
    return neighbourhood !== null && wide.neighbourhood_ids.includes(neighbourhood);
  });
}

function groupsOverlap(a: Audience, b: Audience): boolean {
  if (a.groups.length === 0 || b.groups.length === 0) return true;
  return a.groups.some((group) => b.groups.includes(group));
}

/** Whether two audiences (their types included) could reach the same resident. */
export function audiencesOverlap(a: Audience, b: Audience, neighbourhoodOf: NeighbourhoodOf): boolean {
  return a.types.some((type) => b.types.includes(type)) && groupsOverlap(a, b) && placesOverlap(a, b, neighbourhoodOf);
}

/** An entry of another open, non-drill thread that residents may already see or an approver is about to. */
export interface DuplicateCandidate {
  alertId: string;
  audience: Audience;
}

/**
 * The thread a new entry may duplicate: the first of the candidates (the caller lists them newest first) that overlaps it, or
 * null. A thread is never a duplicate of itself.
 */
export function possibleDuplicateOf(own: { alertId: string; audience: Audience }, candidates: readonly DuplicateCandidate[], neighbourhoodOf: NeighbourhoodOf): string | null {
  for (const candidate of candidates) {
    if (candidate.alertId === own.alertId) continue;
    if (audiencesOverlap(own.audience, candidate.audience, neighbourhoodOf)) return candidate.alertId;
  }
  return null;
}
