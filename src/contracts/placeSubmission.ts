// The wire contract of the residents' place suggestions (PRD §6.3 "Community contributions and moderation queue", D9/E4, built after the
// pilot's signed scope by the product owner's decision of 2026-11-07; prototype R-17 to R-23, O-08 to O-10):
//
//  - POST /api/places/submissions: what the form sends, a new place (`add`, R-19 with R-20's location) or a correction of a listed one
//    (`correct`, R-22: only the fields the resident changed), and the one body every received suggestion gets: its reference code (R-21);
//  - GET /api/places/submissions/{ref}: what the Hub decided (R-23), read by the reference code alone.
//
// AD-3: residents have no identity, so nothing here names the person. The body carries the place and nothing of the resident's saved choices
// (no home building, no groups, no number); a correction says only what changed. The reference code is the only way back to a suggestion, and
// a code reads only the suggestion's own words and the Hub's pre-written reason. Pure and browser-safe: the form checks with the same rules.
import { z } from "zod";
import { LangCodeSchema } from "./lang";
import { RsnSchema } from "./places";
import { inToronto } from "./torontoBounds";

/** The contract version of the request and of both answers. */
export const PLACE_SUBMISSION_CONTRACT_VERSION = 1;

/** A request body longer than this is not a suggestion. */
export const PLACE_SUBMISSION_MAX_BODY_CHARS = 8_192;
/** R-19's limits: the name as the prototype's input allows it, "what happens there" in one sentence (its counter), a location line. */
export const PLACE_NAME_MAX_CHARS = 80;
export const PLACE_WHAT_MAX_CHARS = 140;
export const PLACE_WHERE_TEXT_MAX_CHARS = 100;
export const PLACE_PHONE_MAX_CHARS = 40;
export const PLACE_WEB_MAX_CHARS = 200;
export const PLACE_CATEGORY_MAX_CHARS = 100;
/** The longest name of the listed place a correction carries (catalogue names run longer than a resident's new one). */
export const PLACE_LISTED_NAME_MAX_CHARS = 200;

/** R-19's first question: an official service, or a community offer from neighbours (a dashed outline on the map). */
export const PLACE_TYPES = ["official", "offer"] as const;
export type PlaceType = (typeof PLACE_TYPES)[number];

/** R-19's optional questions, answered by choosing: "Not sure" is a choice, not a sentence. */
export const COST_ANSWERS = ["free", "low", "fee", "notSure"] as const;
export const YES_NO_ANSWERS = ["yes", "no", "notSure"] as const;
export type CostAnswer = (typeof COST_ANSWERS)[number];
export type YesNoAnswer = (typeof YES_NO_ANSWERS)[number];

/** What a correction (R-22) may change: each is one row of the screen, and only a changed row is sent. */
export const CORRECTION_FIELDS = ["name", "where", "phone", "web", "cost", "idRequired", "stepFree"] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

/** O-10's pre-written reasons (the prototype's D.declineReasons); each has its "why" and "what to change" in every language (R23.reasons). */
export const DECLINE_REASONS = ["advert", "noLocation", "duplicate", "unclear", "outOfArea", "notCommunity"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/** The longest note a Hub member keeps with a decline: for the Hub's own record, never shown to the person who sent it. */
export const DECLINE_NOTE_MAX_CHARS = 300;

/** A suggestion's state: waiting for the Hub, accepted (an Admin then adds it to the catalogue), or declined with a reason. */
export const SUBMISSION_STATUSES = ["pending", "accepted", "declined"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_KINDS = ["add", "correct"] as const;
export type SubmissionKind = (typeof SUBMISSION_KINDS)[number];

/**
 * The reference code a resident is given (R-21) and reads the Hub's decision with (R-23): eight characters from an alphabet without the ones
 * people mix up (0 and O, 1, I and L, U), shown as two groups of four. Forty bits: a code cannot be found by guessing, and the rate limit of the
 * status route makes trying slow as well.
 */
export const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const REF_PATTERN = /^[2-9A-HJKMNP-TV-Z]{4}-[2-9A-HJKMNP-TV-Z]{4}$/;
export const RefSchema = z.string().regex(REF_PATTERN);

/** A code as a person types it (lower case, spaces, no dash) in its one written form, or null when it cannot be one. */
export function normaliseRef(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 20) return null;
  const letters = input.toUpperCase().replace(/[\s-]/g, "");
  if (letters.length !== 8) return null;
  const ref = `${letters.slice(0, 4)}-${letters.slice(4)}`;
  return REF_PATTERN.test(ref) ? ref : null;
}

/** One line of free text: trimmed, no control characters or line breaks, within `max`. */
const line = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

const optionalLine = (max: number) =>
  z
    .string()
    .max(max * 2)
    .transform((value) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().max(max))
    .transform((value) => (value === "" ? null : value));

/**
 * Where the place is (R-20): a pin on the map (inside Toronto), one of the pilot's buildings (by the register's number, with where in it), or
 * a street address. The prototype's fourth way, a landmark, is not offered: the pilot has no reviewed list of landmarks.
 */
export const WhereSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("pin"),
    lat: z.number().finite(),
    lng: z.number().finite(),
  }),
  z.strictObject({ kind: z.literal("building"), rsn: RsnSchema, text: optionalLine(PLACE_WHERE_TEXT_MAX_CHARS).optional() }),
  z.strictObject({ kind: z.literal("address"), text: line(PLACE_WHERE_TEXT_MAX_CHARS) }),
]).refine((where) => where.kind !== "pin" || inToronto(where.lat, where.lng), { message: "pin_outside_toronto" });
export type Where = z.output<typeof WhereSchema>;

/** A location as it is stored and read back (the shape WhereSchema produces, without its input rules). */
export const WhereRecordSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("pin"), lat: z.number(), lng: z.number() }),
  z.strictObject({ kind: z.literal("building"), rsn: z.string(), text: z.string().nullable().optional() }),
  z.strictObject({ kind: z.literal("address"), text: z.string() }),
]);
export type WhereRecord = z.infer<typeof WhereRecordSchema>;

/**
 * The honeypot: a field the form hides from people (and from screen readers) that a script filling every input fills in. A request with
 * anything in it is answered like any other and stored nowhere (the handler), so the script learns nothing.
 */
const HoneypotSchema = z.string().max(200).optional();

const common = {
  v: z.literal(PLACE_SUBMISSION_CONTRACT_VERSION),
  /** The language of the page it was sent from: the Hub reads the words in it, and the decline reason is shown in it. */
  lang: LangCodeSchema,
  nickname: HoneypotSchema,
};

/** R-19: a place that is missing. Type, name, what happens there and where are needed; the rest is optional. */
export const AddPlaceRequestSchema = z.strictObject({
  ...common,
  kind: z.literal("add"),
  type: z.enum(PLACE_TYPES),
  name: line(PLACE_NAME_MAX_CHARS),
  what: line(PLACE_WHAT_MAX_CHARS),
  where: WhereSchema,
  /** The kind of place, as the release names a subcategory in English; absent for "Not sure". */
  category: optionalLine(PLACE_CATEGORY_MAX_CHARS).optional(),
  phone: optionalLine(PLACE_PHONE_MAX_CHARS).optional(),
  web: optionalLine(PLACE_WEB_MAX_CHARS).optional(),
  cost: z.enum(COST_ANSWERS).optional(),
  idRequired: z.enum(YES_NO_ANSWERS).optional(),
  stepFree: z.enum(YES_NO_ANSWERS).optional(),
  languages: z.array(LangCodeSchema).max(20).optional(),
});

/** R-22: what the resident changed on a listed place, and nothing else. */
export const CorrectionChangesSchema = z
  .strictObject({
    name: line(PLACE_NAME_MAX_CHARS).optional(),
    where: line(PLACE_WHERE_TEXT_MAX_CHARS).optional(),
    phone: line(PLACE_PHONE_MAX_CHARS).optional(),
    web: line(PLACE_WEB_MAX_CHARS).optional(),
    cost: z.enum(COST_ANSWERS).optional(),
    idRequired: z.enum(YES_NO_ANSWERS).optional(),
    stepFree: z.enum(YES_NO_ANSWERS).optional(),
  })
  .refine((changes) => Object.values(changes).some((value) => value !== undefined), { message: "nothing_changed" });
export type CorrectionChanges = z.output<typeof CorrectionChangesSchema>;

export const CorrectPlaceRequestSchema = z.strictObject({
  ...common,
  kind: z.literal("correct"),
  /** The listed provider's catalogue id (the release's), and its name as the resident saw it. */
  providerId: z.string().regex(/^[A-Z][0-9]{3,6}$/),
  providerName: line(PLACE_LISTED_NAME_MAX_CHARS),
  changes: CorrectionChangesSchema,
});

export const PlaceSubmissionRequestSchema = z.discriminatedUnion("kind", [AddPlaceRequestSchema, CorrectPlaceRequestSchema]);
/** The body as the form builds it. */
export type PlaceSubmissionRequestBody = z.input<typeof PlaceSubmissionRequestSchema>;
/** The body after the contract's checks: text trimmed, empty optional text as null. */
export type PlaceSubmissionRequest = z.output<typeof PlaceSubmissionRequestSchema>;
export type AddPlaceRequest = z.output<typeof AddPlaceRequestSchema>;
export type CorrectPlaceRequest = z.output<typeof CorrectPlaceRequestSchema>;

/** The answer to every received suggestion (HTTP 202), a honeypot's included. */
export const PlaceSubmissionReceivedSchema = z.strictObject({
  v: z.literal(PLACE_SUBMISSION_CONTRACT_VERSION),
  status: z.literal("received"),
  ref: RefSchema,
});
export type PlaceSubmissionReceived = z.infer<typeof PlaceSubmissionReceivedSchema>;

export const PLACE_SUBMISSION_ERROR_CODES = ["invalid_request", "rate_limited", "not_found", "submissions_unavailable"] as const;
export type PlaceSubmissionErrorCode = (typeof PLACE_SUBMISSION_ERROR_CODES)[number];
export const PLACE_SUBMISSION_ERROR_STATUS: Record<PlaceSubmissionErrorCode, 400 | 404 | 429 | 503> = {
  invalid_request: 400,
  rate_limited: 429,
  not_found: 404,
  submissions_unavailable: 503,
};

/** The failure body: the code, and the catalog key of the words the form shows for it. */
export function placeSubmissionErrorBody(code: PlaceSubmissionErrorCode) {
  return { error: { code, message_key: `places.errors.${code}` } } as const;
}

/** Checks a body; the first problem is reported as `invalid_request` (the form checks the same rules before sending, field by field). */
export function checkPlaceSubmission(raw: unknown): { ok: true; value: PlaceSubmissionRequest; honeypot: boolean } | { ok: false; code: "invalid_request" } {
  const parsed = PlaceSubmissionRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  return { ok: true, value: parsed.data, honeypot: (parsed.data.nickname ?? "").trim() !== "" };
}

/**
 * GET /api/places/submissions/{ref} (R-23): the suggestion's state, its own words (the name, the sentence and where, for "What you wrote"),
 * when it was sent and decided, and the decline reason's code. Never the Hub member, the Hub's note or anything about who sent it.
 */
export const PlaceSubmissionStatusSchema = z.strictObject({
  v: z.literal(PLACE_SUBMISSION_CONTRACT_VERSION),
  ref: RefSchema,
  kind: z.enum(SUBMISSION_KINDS),
  status: z.enum(SUBMISSION_STATUSES),
  name: z.string(),
  what: z.string().nullable(),
  /** Where the place is, for a new place; a correction's changed location line is `where_text`. */
  where: WhereRecordSchema.nullable(),
  where_text: z.string().nullable(),
  sent_at: z.string(),
  decided_at: z.string().nullable(),
  reason: z.enum(DECLINE_REASONS).nullable(),
});
export type PlaceSubmissionStatus = z.infer<typeof PlaceSubmissionStatusSchema>;
