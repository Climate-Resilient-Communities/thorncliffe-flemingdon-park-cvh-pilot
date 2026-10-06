// The wire contract of POST /api/signup (S07.02, AD-3, AD-20, AD-22): what the sign-up form sends, the one body every accepted sign-up gets,
// and the failure body. This POST is the one resident request that carries places and groups (AD-3's exception, with the edit-link POSTs of
// S07.06); it sets no cookie and is never cached. Pure and browser-safe: the form checks a number with the same rule as the server.
import { z } from "zod";
import { isCanadianAreaCode } from "./canadianAreaCodes";
import { CHECKIN_CONSENT_VERSION, CheckinRequestSchema, checkinRequestInput, isSavedPlace, type CheckinRequestInput } from "./checkin";
import { toAsciiDigits } from "./digits";
import { NEIGHBOURHOOD_ID } from "./audience";
import { GroupSchema } from "./groups";
import { LangCodeSchema } from "./lang";
import { FloorIdSchema, RsnSchema } from "./places";

/** The contract version of the request and of the accepted body. */
export const SIGNUP_CONTRACT_VERSION = 1;

/**
 * The groups the web form offers. The device's `checkin` group is not one: a check-in request is the form's own `checkin` (S08.05), with the
 * consent and the coverage check it needs.
 */
export const SIGNUP_GROUPS = ["seniors", "newcomers", "families"] as const;

/** How many buildings one sign-up may name (the pilot has 43), and floors per building. */
export const SIGNUP_MAX_PLACES = 60;
export const SIGNUP_MAX_FLOORS_PER_PLACE = 200;
/** A typed number is at most this long, whatever its spacing. */
export const SIGNUP_PHONE_MAX_CHARS = 40;
/** A request body longer than this is not a sign-up. */
export const SIGNUP_MAX_BODY_CHARS = 32_768;

/** The invisible direction marks a right-to-left keyboard can put around digits (LRM, RLM, ALM and the embedding and isolate controls). */
const DIRECTION_MARKS = /[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/g;

/**
 * A number as typed, read as a Canadian number: E.164 `+1` and ten digits whose area code is on the Canadian list (canadianAreaCodes.ts)
 * and whose area code and exchange both start with 2 to 9 (the numbering plan's rule). Spaces, dots, dashes and brackets are allowed, and a
 * leading `+1` or `1`; letters or other characters are not. Digits in any script (Urdu's ۴۱۶, Bengali's, full-width ４１６...) are read as
 * 0-9 (toAsciiDigits), full-width punctuation as its ASCII form (NFKC), and direction marks are ignored. Null for anything else.
 */
export function canadianNumber(input: unknown): string | null {
  if (typeof input !== "string" || input.length > SIGNUP_PHONE_MAX_CHARS) return null;
  const text = toAsciiDigits(input.normalize("NFKC")).replace(DIRECTION_MARKS, "").trim();
  if (!/^\+?[0-9\s().-]+$/.test(text)) return null;
  let digits = text.replace(/\D/g, "");
  if (text.startsWith("+") && !digits.startsWith("1")) return null;
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(digits)) return null;
  if (!isCanadianAreaCode(digits.slice(0, 3))) return null;
  return `+1${digits}`;
}

const SignupLangSchema = LangCodeSchema.exclude(["zh-Hant"]);

const SignupPlaceSchema = z.strictObject({
  rsn: RsnSchema,
  floors: z.array(FloorIdSchema).max(SIGNUP_MAX_FLOORS_PER_PLACE),
});

/**
 * The body the form sends. The answers a resident can leave out or get wrong (`neighbourhood` null or missing, `terms_agreed` and
 * `age_confirmed` false, a number that is not Canadian) are part of the shape, so they are refused with their own reason rather than as an
 * unreadable request.
 */
export const SignupRequestSchema = z.strictObject({
  v: z.literal(SIGNUP_CONTRACT_VERSION),
  phone: z.string().max(SIGNUP_PHONE_MAX_CHARS),
  lang: SignupLangSchema,
  neighbourhood: z.string().regex(NEIGHBOURHOOD_ID).nullable().optional(),
  places: z.array(SignupPlaceSchema).max(SIGNUP_MAX_PLACES),
  groups: z.array(z.enum(SIGNUP_GROUPS)).max(SIGNUP_GROUPS.length),
  consent_version: z.string().max(40),
  terms_agreed: z.boolean(),
  age_confirmed: z.boolean(),
  /** S08.05: an optional check-in request on one of the places above (E08 "Request during sign-up"); kept until YES if its floor is covered. */
  checkin: CheckinRequestSchema.optional(),
});
export type SignupRequestBody = z.infer<typeof SignupRequestSchema>;

/** A request that passed every check the contract can make: the number in E.164, the places sorted and without repeats. */
export interface SignupRequest {
  phone: string;
  lang: z.infer<typeof SignupLangSchema>;
  neighbourhood: string;
  places: { rsn: string; floors: string[] }[];
  groups: z.infer<typeof GroupSchema>[];
  consentVersion: string;
  /** S08.05: the check-in request, with the consent confirmed, on one of `places`; null or absent when none was asked for. */
  checkin?: (CheckinRequestInput & { consentVersion: string }) | null;
}

/** What a sign-up can be refused with; the HTTP status of each is in SIGNUP_ERROR_STATUS. */
export const SIGNUP_ERROR_CODES = [
  "invalid_request",
  "phone_not_canadian",
  "neighbourhood_missing",
  "terms_not_agreed",
  "age_not_confirmed",
  "terms_changed",
  "place_unknown",
  "checkin_consent_missing",
  "rate_limited",
  "signup_unavailable",
  /** S09.07: sign-ups are paused from the start of the end-of-pilot campaign until an Admin reopens them for the MVP. */
  "signups_paused",
] as const;
export type SignupErrorCode = (typeof SIGNUP_ERROR_CODES)[number];

export const SIGNUP_ERROR_STATUS: Record<SignupErrorCode, 400 | 409 | 429 | 503> = {
  invalid_request: 400,
  phone_not_canadian: 400,
  neighbourhood_missing: 400,
  terms_not_agreed: 400,
  age_not_confirmed: 400,
  terms_changed: 409,
  place_unknown: 400,
  checkin_consent_missing: 400,
  rate_limited: 429,
  signup_unavailable: 503,
  signups_paused: 409,
};

/** The body of a refused sign-up: `{error: {code, message_key}}` (AD-20); the page shows the catalog string of `message_key` in its language. */
export const SignupErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(SIGNUP_ERROR_CODES), message_key: z.string().regex(/^signup\.error\.[a-z_]+$/) }),
});
export type SignupError = z.infer<typeof SignupErrorSchema>;

export const signupErrorBody = (code: SignupErrorCode): SignupError => ({ error: { code, message_key: `signup.error.${code}` } });

/**
 * The one body of every accepted sign-up, whether the number is new, already has a pending sign-up or is already subscribed: nothing in the
 * answer tells them apart (AD-22). HTTP 202. S08.05: a sign-up with a check-in request also says whether its floor is covered (`requested`,
 * saved until YES) or not (`uncovered`: "No ambassador covers your floor yet"), which depends on the floor alone, never on the number.
 */
export const SignupAcceptedSchema = z.strictObject({
  v: z.literal(SIGNUP_CONTRACT_VERSION),
  status: z.literal("accepted"),
  checkin: z.enum(["requested", "uncovered"]).optional(),
});
export type SignupAccepted = z.infer<typeof SignupAcceptedSchema>;
export const SIGNUP_ACCEPTED: SignupAccepted = { v: SIGNUP_CONTRACT_VERSION, status: "accepted" };

export type SignupCheck = { ok: true; value: SignupRequest } | { ok: false; code: SignupErrorCode };

/**
 * The checks the contract makes, in the order the form shows them: a readable request, then the number, the neighbourhood, the terms and the
 * age statement. Whether the terms version is the current one, and whether the places exist, are the server's to say.
 */
export function checkSignupRequest(raw: unknown): SignupCheck {
  const parsed = SignupRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  const body = parsed.data;
  const phone = canadianNumber(body.phone);
  if (phone === null) return { ok: false, code: "phone_not_canadian" };
  if (!body.neighbourhood) return { ok: false, code: "neighbourhood_missing" };
  if (!body.terms_agreed) return { ok: false, code: "terms_not_agreed" };
  if (!body.age_confirmed) return { ok: false, code: "age_not_confirmed" };
  const byRsn = new Map<string, Set<string>>();
  for (const place of body.places) {
    const floors = byRsn.get(place.rsn) ?? new Set<string>();
    for (const floor of place.floors) floors.add(floor.toLowerCase());
    byRsn.set(place.rsn, floors);
  }
  const places = [...byRsn.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([rsn, floors]) => ({ rsn, floors: [...floors].sort() }));
  const groups = SIGNUP_GROUPS.filter((group) => body.groups.includes(group));
  // S08.05: a check-in request is on one of the places sent, with its floor, and comes with the consent shown now.
  let checkin: SignupRequest["checkin"];
  if (body.checkin) {
    const request = checkinRequestInput(body.checkin);
    if (!isSavedPlace(request, places)) return { ok: false, code: "invalid_request" };
    if (request.consentVersion === null) return { ok: false, code: "checkin_consent_missing" };
    if (request.consentVersion !== CHECKIN_CONSENT_VERSION) return { ok: false, code: "invalid_request" };
    checkin = { ...request, consentVersion: request.consentVersion };
  }
  return { ok: true, value: { phone, lang: body.lang, neighbourhood: body.neighbourhood, places, groups, consentVersion: body.consent_version, ...(checkin ? { checkin } : {}) } };
}

/**
 * The neighbourhood the form starts with: the one every saved building is in, when there is exactly one; none when no building is saved, or
 * when the saved buildings are in both neighbourhoods (the resident then chooses, with no default). `neighbourhoodOf` gives a building's
 * neighbourhood id from the building list, or undefined for a building the list does not have: then not every saved building is known to be
 * in one neighbourhood, and none is chosen.
 */
export function presetNeighbourhood(buildings: readonly string[], neighbourhoodOf: (rsn: string) => string | undefined): string | null {
  const ids = buildings.map(neighbourhoodOf);
  if (ids.length === 0 || ids.some((id) => id === undefined)) return null;
  const distinct = new Set(ids);
  return distinct.size === 1 ? [...distinct][0]! : null;
}
