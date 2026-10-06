// The rules of a check-in request and of who is in a round (S08.05, AD-12; E08 definitions "Check-in request", "Changed location", "Round",
// "Request lock order"). Pure: no I/O, no clock.
import { matches, type Audience } from "../../../contracts/audience";
import type { CheckinMethod } from "../../../contracts/checkin";

/** A request as it is held: the "where I live" building and floor, the method and the consent version confirmed. */
export interface CheckinRequest {
  method: CheckinMethod;
  rsn: string;
  floorId: string;
  consentVersion: string;
}

/** A place a request can be on: a building and one floor in it. */
export interface RequestPlace {
  rsn: string;
  floorId: string;
}

/** One saved place as the callers pass the places that replace the saved ones: a building, and one floor or none. */
export interface SavedPlace {
  rsn: string;
  floorId: string | null;
}

export const samePlace = (a: RequestPlace, b: RequestPlace): boolean => a.rsn === b.rsn && a.floorId === b.floorId;

/** Whether the request's place is still among these places, with its floor (else "where I live" changed: E08 "Changed location"). */
export const placeKept = (request: RequestPlace, places: readonly SavedPlace[]): boolean =>
  places.some((place) => place.rsn === request.rsn && place.floorId === request.floorId);

/**
 * Whether a round's thread is for the requester (E08 "Round"): the "where I live" place matches the audience of the thread's latest approved,
 * non-superseded substantive entry by the one matcher (`matches`, AD-7), the place alone deciding: a neighbourhood audience covers every
 * building of its neighbourhoods, a buildings audience its buildings (and, when it lists floors, those floors). The audience's groups and the
 * resident's muted topics play no part: a check-in is asked for where she lives, whatever texts she chose.
 */
export function roundMatches(audience: Audience, place: RequestPlace & { neighbourhoodId: string }): boolean {
  return matches({ ...audience, groups: [] }, { neighbourhoodIds: [place.neighbourhoodId], places: [{ rsn: place.rsn, floors: [place.floorId] }], groups: [], mutedTopics: [] });
}

/**
 * Whether a round's audience names this building at all (a neighbourhood audience: the building's neighbourhood; a buildings audience: the building,
 * on any floor): the threads an assignment saved on the building may add its requesters to, each requester then matched by `roundMatches`.
 */
export function roundNamesBuilding(audience: Audience, rsn: string, neighbourhoodId: string): boolean {
  return audience.scope === "neighbourhood" ? audience.neighbourhood_ids.includes(neighbourhoodId) : audience.buildings.some((building) => building.rsn === rsn);
}

/** Whether a thread of these types is a round's: one of its types is a round type (`disruption_type.checkin`). */
export const isRoundThread = (types: readonly string[], roundTypes: readonly string[]): boolean => types.some((type) => roundTypes.includes(type));

/** Code-unit order (lower-case UUIDs sort as Postgres sorts uuid): the order rows are locked in, the same in every transaction. */
export const lockOrder = (ids: Iterable<string>): string[] => [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** What a page's change asks of a request: none sent (kept as it is), none (withdraw it), or one. */
export type WantedRequest = undefined | null | { rsn: string; floorId: string; method: CheckinMethod; consentVersion: string | null };

/** What to do with a request, decided from the request held and what the change asks. */
export interface RequestPlan {
  /** Withdraw the request held (its open rows tallied and closed, the request cleared). */
  withdraw: boolean;
  /** Ask for this one (after the coverage check), with the consent version confirmed. */
  ask: CheckinRequest | null;
  /** The same place, another method: the request and its open rows change method only. */
  method: CheckinMethod | null;
}

export type RequestPlanRefusal = "consent_missing";

/**
 * The plan for a change of the edit page (E08 "Check-in request", "Changed location"): the places that will replace the saved ones, and the
 * request the page sends (or none). Asking at a place other than the one held (or with none held) needs the consent confirmed again; the
 * same place with another method does not. With no request sent, the one held is withdrawn only when its place is no longer saved. The
 * caller has checked that a request sent is on one of the new places.
 */
export function planRequestChange(held: CheckinRequest | null, places: readonly SavedPlace[], wanted: WantedRequest): RequestPlan | RequestPlanRefusal {
  if (wanted === undefined) return { withdraw: held !== null && !placeKept(held, places), ask: null, method: null };
  if (wanted === null) return { withdraw: held !== null, ask: null, method: null };
  if (held !== null && samePlace(held, wanted)) return { withdraw: false, ask: null, method: wanted.method === held.method ? null : wanted.method };
  if (wanted.consentVersion === null) return "consent_missing";
  return { withdraw: held !== null, ask: { method: wanted.method, rsn: wanted.rsn, floorId: wanted.floorId, consentVersion: wanted.consentVersion }, method: null };
}
