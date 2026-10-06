// The rules of the check-in section the sign-up form and the edit page share (S08.05; E08 "Check-in request", "Changed location"). Pure.
//
// The section asks for one saved place as "where I live" (a building with a floor, among those the form saves), call or text, and the consent
// wording confirmed. On the edit page a request may already be held: its method alone can change without new consent, it can be withdrawn,
// and when its place is no longer among the places the page saves it is withdrawn (the resident asks again for the new floor, agreeing again).
import { CHECKIN_CONSENT_VERSION, type CheckinMethod, type CheckinRequestBody } from "@/contracts/checkin";

/** A "where I live" choice: a building the form saves and one of its floors there. */
export interface WhereOption {
  rsn: string;
  floorId: string;
  address: string;
  floorLabel: string;
}

/** The request the edit page found: where and how. */
export interface HeldRequest {
  rsn: string;
  floorId: string;
  method: CheckinMethod;
}

/** What the section holds while the resident fills it in. */
export interface CheckinDraft {
  /** Asking (the sign-up), or keeping the one held (the edit page: false is "Withdraw my check-in request"). */
  on: boolean;
  rsn: string | null;
  floorId: string | null;
  method: CheckinMethod | null;
  agreed: boolean;
}

export const NO_REQUEST: CheckinDraft = { on: false, rsn: null, floorId: null, method: null, agreed: false };

/** The section as the edit page opens it: the request held, as it is (its consent was given when it was made). */
export const draftOf = (held: HeldRequest | null): CheckinDraft => (held ? { on: true, rsn: held.rsn, floorId: held.floorId, method: held.method, agreed: false } : NO_REQUEST);

/** The building and floor pairs the form saves, in its order: the "where I live" choices (a building saved without a floor is none). */
export function whereOptions(places: readonly { rsn: string; floors: readonly string[] }[], buildings: readonly { rsn: string; address: string; floors: readonly { id: string; label: string }[] }[]): WhereOption[] {
  return places.flatMap((place) => {
    const building = buildings.find((b) => b.rsn === place.rsn);
    if (!building) return [];
    return building.floors.filter((floor) => place.floors.includes(floor.id)).map((floor) => ({ rsn: place.rsn, floorId: floor.id, address: building.address, floorLabel: floor.label }));
  });
}

const chosenAmong = (draft: CheckinDraft, options: readonly WhereOption[]) => options.some((o) => o.rsn === draft.rsn && o.floorId === draft.floorId);
const samePlace = (draft: CheckinDraft, held: HeldRequest | null) => held !== null && draft.rsn === held.rsn && draft.floorId === held.floorId;

/** The request held is on a place the page no longer saves ("Changed location"): it is withdrawn unless the resident asks again. */
export const moved = (held: HeldRequest | null, options: readonly WhereOption[]): boolean => held !== null && !options.some((o) => o.rsn === held.rsn && o.floorId === held.floorId);

/** Whether the consent wording must be confirmed: a new request, or one at another place than the one held (a method alone needs none). */
export const needsConsent = (draft: CheckinDraft, held: HeldRequest | null): boolean => draft.on && !samePlace(draft, held);

/** What the resident still has to do before sending, or null. A held request whose place went away is withdrawn, not a problem. */
export function problemOf(draft: CheckinDraft, held: HeldRequest | null, options: readonly WhereOption[]): "place" | "method" | "consent" | null {
  if (!draft.on) return null;
  if (!chosenAmong(draft, options)) return samePlace(draft, held) ? null : "place";
  if (draft.method === null) return "method";
  if (needsConsent(draft, held) && !draft.agreed) return "consent";
  return null;
}

/**
 * The request the form sends: one on a chosen place (with the consent version when it was asked), null to withdraw the one held, or undefined
 * when there is none to send (the sign-up without one, or the edit page with none held and none asked: the field is left out, as before
 * S08.05). Call it only when `problemOf` is null.
 */
export function requestBody(draft: CheckinDraft, held: HeldRequest | null, options: readonly WhereOption[], page: "signup" | "edit"): CheckinRequestBody | null | undefined {
  if (!draft.on || draft.rsn === null || draft.floorId === null || draft.method === null || !chosenAmong(draft, options)) return page === "edit" && held !== null ? null : undefined;
  return { rsn: draft.rsn, floor: draft.floorId, method: draft.method, consent_version: needsConsent(draft, held) ? CHECKIN_CONSENT_VERSION : null };
}
