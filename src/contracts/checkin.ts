// The wire contract of a check-in request (S08.05, AD-12, AD-20; E08 definitions "Check-in request", "Personalised check-in responses"): what
// the sign-up form, the staff-assisted sign-up and the edit page send when a resident asks to be checked on, and what each answers about it.
// A request names one of the places the same request saves ("where I live", which must have a floor), call or text, and the version of the
// consent wording the resident confirmed. The answers about a request (whether it was saved, or the floor has no ambassador) are personal:
// they come only in the POST responses of those forms, which are never cached (no-store, never the service worker, no usage event). Pure and
// browser-safe.
import { z } from "zod";
import { FloorIdSchema, RsnSchema } from "./places";

/** How the resident wants to be checked on (R-33: a knock on the door, which needs a unit number, is not offered in the pilot). */
export const CHECKIN_METHODS = ["call", "text"] as const;
export type CheckinMethod = (typeof CHECKIN_METHODS)[number];

/**
 * The version of the consent wording the forms show (`checkin.consent*` in the catalog: that an ambassador on her floor will see her phone
 * number and floor, that a check-in is not an emergency service, and when to call 911). Change it with the wording: a request is saved only
 * with the version the server shows now, and recorded with it (`checkin_consent_version`).
 */
export const CHECKIN_CONSENT_VERSION = "2026-10-06.1";

/**
 * A request as a form sends it: the "where I live" building and floor (one of the places the same request saves), the method, and the
 * consent version the resident confirmed, or null when none was asked for (the edit page asks again only when the place changes: a change
 * of method alone needs no new consent).
 */
export const CheckinRequestSchema = z.strictObject({
  rsn: RsnSchema,
  floor: FloorIdSchema,
  method: z.enum(CHECKIN_METHODS),
  consent_version: z.string().max(40).nullable(),
});
export type CheckinRequestBody = z.infer<typeof CheckinRequestSchema>;

/** A request read from a form: the floor id lower case, as the places are. */
export interface CheckinRequestInput {
  rsn: string;
  floorId: string;
  method: CheckinMethod;
  consentVersion: string | null;
}

export const checkinRequestInput = (body: CheckinRequestBody): CheckinRequestInput => ({
  rsn: body.rsn,
  floorId: body.floor.toLowerCase(),
  method: body.method,
  consentVersion: body.consent_version,
});

/** Whether the request's place is one of the places it is sent with, with that floor ("one saved place", which must have a floor). */
export function isSavedPlace(request: { rsn: string; floorId: string }, places: readonly { rsn: string; floors: readonly string[] }[]): boolean {
  return places.some((place) => place.rsn === request.rsn && place.floors.includes(request.floorId));
}

/**
 * What became of a request, as a form's answer says it:
 *  - `requested`: saved (on the pending sign-up until YES, or on the subscriber); with the edit page, also when it replaced one for another floor;
 *  - `uncovered`: not saved, because no ambassador covers that floor yet ("Call the Hub at {number}"); the rest was saved;
 *  - `method_changed`: the same place, another method (no new consent needed);
 *  - `withdrawn`: the request was withdrawn (asked for, or because where the resident lives changed), and no new one was saved.
 */
export const CHECKIN_ANSWERS = ["requested", "uncovered", "method_changed", "withdrawn"] as const;
export type CheckinAnswer = (typeof CHECKIN_ANSWERS)[number];
export const CheckinAnswerSchema = z.enum(CHECKIN_ANSWERS);
