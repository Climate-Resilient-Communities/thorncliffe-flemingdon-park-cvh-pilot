// The wire contract of the one-time web link (S07.06, AD-3, AD-13, AD-20): the page `/{lang}/subscription/{token}` and its three POSTs under
// `/api/subscription/`. The page itself is a shell with nothing personal in it; the choices load only through `view`, so a link-preview fetch
// of the page sees nothing and uses nothing. `change` and `delete` each use the link once. With the sign-up, these POSTs are the only resident
// requests that carry places and groups (AD-3's exception); none sets a cookie, none is cached, and the service worker never answers them.
// An expired or used link is a success body with `status: "expired"` (spine: expected outcomes are bodies with a status). Pure and browser-safe.
// S08.05 adds the check-in request: the view says what is asked for, a change may ask for one, change its method or withdraw it, and the
// answer says what became of it (these answers are personal: POST only, no-store, never the service worker, no usage event).
import { z } from "zod";
import { NEIGHBOURHOOD_ID, SAFETY_OVERRIDE_TYPES } from "./audience";
import { CHECKIN_CONSENT_VERSION, CHECKIN_METHODS, CheckinAnswerSchema, CheckinRequestSchema, checkinRequestInput, isSavedPlace, type CheckinRequestInput } from "./checkin";
import { LangCodeSchema } from "./lang";
import { FloorIdSchema, RsnSchema } from "./places";
import { SIGNUP_GROUPS, SIGNUP_MAX_FLOORS_PER_PLACE, SIGNUP_MAX_PLACES } from "./signup";

/** The contract version of every request and answer below. */
export const SUBSCRIPTION_EDIT_CONTRACT_VERSION = 1;

/** The path segment of the page (`/{lang}/subscription/{token}`) and the prefix of its API (`/api/subscription/`). */
export const SUBSCRIPTION_SEGMENT = "subscription";
export const SUBSCRIPTION_API = "/api/subscription";
export const SUBSCRIPTION_VIEW_PATH = `${SUBSCRIPTION_API}/view`;
export const SUBSCRIPTION_CHANGE_PATH = `${SUBSCRIPTION_API}/change`;
export const SUBSCRIPTION_DELETE_PATH = `${SUBSCRIPTION_API}/delete`;

/** A token: 32 random bytes in base64url, 43 characters (the link's last segment). Only its sha256 is stored. */
export const EDIT_TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const EditTokenSchema = z.string().regex(EDIT_TOKEN);

/** How long a link may be used after it is made (E07 "Edit link"). */
export const EDIT_LINK_TTL_MS = 30 * 60_000;

/** A request body longer than this is not one of these requests. */
export const SUBSCRIPTION_EDIT_MAX_BODY_CHARS = 32_768;

/** Whether a URL path is the edit page or its API, in any language: `/api/subscription` or below, or `/{2 or 3 letters}/subscription` or below. */
export function isSubscriptionPath(path: string): boolean {
  if (path === SUBSCRIPTION_API || path.startsWith(`${SUBSCRIPTION_API}/`)) return true;
  const [, first, second] = path.split("/");
  return /^[a-z]{2,3}$/.test(first ?? "") && second === SUBSCRIPTION_SEGMENT;
}

/** The page's path for a token in a language (the text gives it on the public origin). */
export const subscriptionPagePath = (lang: string, token: string) => `/${lang}/${SUBSCRIPTION_SEGMENT}/${token}`;

/**
 * The topics (disruption types, `x13` in the catalog) a subscriber may mute, in the order the page lists them: every type but fire and
 * evacuation (`SAFETY_OVERRIDE_TYPES`), which nobody can mute (AD-7).
 */
export const TOPIC_IDS = ["fire", "power", "water", "elevator", "flood", "heat", "smoke", "winter", "other"] as const;
export const MUTABLE_TOPICS = ["power", "water", "elevator", "flood", "heat", "smoke", "winter", "other"] as const;
export type MutableTopic = (typeof MUTABLE_TOPICS)[number];

/** Whether a topic may be muted: one of the types, and not one nobody can mute (subscriptionEdit.test.ts checks the list against both). */
export const isMutableTopic = (topic: string): topic is MutableTopic => (MUTABLE_TOPICS as readonly string[]).includes(topic) && !SAFETY_OVERRIDE_TYPES.includes(topic);

const EditLangSchema = LangCodeSchema.exclude(["zh-Hant"]);

const PlaceSchema = z.strictObject({
  rsn: RsnSchema,
  floors: z.array(FloorIdSchema).max(SIGNUP_MAX_FLOORS_PER_PLACE),
});

/** `view` and `delete`: the token only. */
export const EditTokenRequestSchema = z.strictObject({ v: z.literal(SUBSCRIPTION_EDIT_CONTRACT_VERSION), token: EditTokenSchema });
export type EditTokenRequest = z.infer<typeof EditTokenRequestSchema>;

/** `change`: the token and every choice as the page shows it when sent (the whole subscription, not a difference). */
export const EditChangeRequestSchema = z.strictObject({
  v: z.literal(SUBSCRIPTION_EDIT_CONTRACT_VERSION),
  token: EditTokenSchema,
  lang: EditLangSchema,
  neighbourhood: z.string().regex(NEIGHBOURHOOD_ID).nullable(),
  places: z.array(PlaceSchema).max(SIGNUP_MAX_PLACES),
  groups: z.array(z.enum(SIGNUP_GROUPS)).max(SIGNUP_GROUPS.length),
  muted_topics: z.array(z.enum(MUTABLE_TOPICS)).max(MUTABLE_TOPICS.length),
  /**
   * S08.05: the check-in request as the page leaves it: one on a place of `places` (the consent version when it is asked at a new place,
   * null for the same place with another method), null to have none (withdraw it), or left out to keep it as it is (withdrawn only if its
   * place is no longer saved).
   */
  checkin: CheckinRequestSchema.nullable().optional(),
});
export type EditChangeRequestBody = z.infer<typeof EditChangeRequestSchema>;

/** A change that passed every check the contract can make: places sorted and without repeats, groups and topics in their lists' order. */
export interface EditChange {
  token: string;
  lang: z.infer<typeof EditLangSchema>;
  neighbourhood: string;
  places: { rsn: string; floors: string[] }[];
  groups: (typeof SIGNUP_GROUPS)[number][];
  mutedTopics: MutableTopic[];
  /** S08.05: the request the page sends (undefined: none sent, kept as it is; null: none). */
  checkin?: CheckinRequestInput | null;
}

/** What the page shows of the subscription: no number but its last two digits. */
const SubscriptionViewSchema = z.strictObject({
  lang: EditLangSchema,
  neighbourhood: z.string().regex(NEIGHBOURHOOD_ID),
  places: z.array(PlaceSchema),
  /** The groups the page offers that the subscriber chose (`checkin` is E08's, kept as it is and not shown). */
  groups: z.array(z.enum(SIGNUP_GROUPS)),
  muted_topics: z.array(z.string()),
  phone_last2: z.string().regex(/^[0-9]{2}$/),
  /** S08.05: the check-in request, or null: its "where I live" building and floor, and the method. */
  checkin: z.strictObject({ rsn: RsnSchema, floor: FloorIdSchema, method: z.enum(CHECKIN_METHODS) }).nullable(),
});
export type SubscriptionView = z.infer<typeof SubscriptionViewSchema>;

export const EditViewBodySchema = z.strictObject({ v: z.literal(SUBSCRIPTION_EDIT_CONTRACT_VERSION), status: z.literal("ok"), subscription: SubscriptionViewSchema });
/** The link is unknown, used or run out, or its subscriber no longer receives texts: all the same answer. */
export const EditExpiredBodySchema = z.strictObject({ v: z.literal(SUBSCRIPTION_EDIT_CONTRACT_VERSION), status: z.literal("expired") });
/** S08.05: a change's answer also says what became of the check-in request, when the change touched one. */
export const EditDoneBodySchema = z.strictObject({
  v: z.literal(SUBSCRIPTION_EDIT_CONTRACT_VERSION),
  status: z.enum(["changed", "deleted"]),
  checkin: CheckinAnswerSchema.optional(),
});
export type EditViewBody = z.infer<typeof EditViewBodySchema>;
export type EditExpiredBody = z.infer<typeof EditExpiredBodySchema>;
export type EditDoneBody = z.infer<typeof EditDoneBodySchema>;

export const EDIT_EXPIRED: EditExpiredBody = { v: SUBSCRIPTION_EDIT_CONTRACT_VERSION, status: "expired" };

/** What a request can be refused with; the HTTP status of each is in SUBSCRIPTION_EDIT_ERROR_STATUS. A refused change uses nothing. */
export const SUBSCRIPTION_EDIT_ERROR_CODES = ["invalid_request", "neighbourhood_missing", "place_unknown", "checkin_consent_missing", "edit_unavailable"] as const;
export type SubscriptionEditErrorCode = (typeof SUBSCRIPTION_EDIT_ERROR_CODES)[number];

export const SUBSCRIPTION_EDIT_ERROR_STATUS: Record<SubscriptionEditErrorCode, 400 | 503> = {
  invalid_request: 400,
  neighbourhood_missing: 400,
  place_unknown: 400,
  checkin_consent_missing: 400,
  edit_unavailable: 503,
};

/** `{error: {code, message_key}}` (AD-20); the page shows the catalog string of `message_key` in its language. */
export const SubscriptionEditErrorSchema = z.strictObject({
  error: z.strictObject({ code: z.enum(SUBSCRIPTION_EDIT_ERROR_CODES), message_key: z.string().regex(/^subscriptionEdit\.error\.[a-z_]+$/) }),
});
export type SubscriptionEditError = z.infer<typeof SubscriptionEditErrorSchema>;
export const subscriptionEditErrorBody = (code: SubscriptionEditErrorCode): SubscriptionEditError => ({ error: { code, message_key: `subscriptionEdit.error.${code}` } });

export type EditCheck<T> = { ok: true; value: T } | { ok: false; code: SubscriptionEditErrorCode };

/** `view` or `delete`: a readable body with a token of the right shape. */
export function checkEditTokenRequest(raw: unknown): EditCheck<string> {
  const parsed = EditTokenRequestSchema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data.token } : { ok: false, code: "invalid_request" };
}

/** `change`: a readable body, then the neighbourhood. Whether the places and the neighbourhood exist is the server's to say. */
export function checkEditChangeRequest(raw: unknown): EditCheck<EditChange> {
  const parsed = EditChangeRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, code: "invalid_request" };
  const body = parsed.data;
  if (!body.neighbourhood) return { ok: false, code: "neighbourhood_missing" };
  const byRsn = new Map<string, Set<string>>();
  for (const place of body.places) {
    const floors = byRsn.get(place.rsn) ?? new Set<string>();
    for (const floor of place.floors) floors.add(floor.toLowerCase());
    byRsn.set(place.rsn, floors);
  }
  const places = [...byRsn.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([rsn, floors]) => ({ rsn, floors: [...floors].sort() }));
  // S08.05: a request is on one of the places sent, with its floor; a consent given is the wording shown now.
  const checkin = body.checkin ? checkinRequestInput(body.checkin) : body.checkin;
  if (checkin && (!isSavedPlace(checkin, places) || (checkin.consentVersion !== null && checkin.consentVersion !== CHECKIN_CONSENT_VERSION))) return { ok: false, code: "invalid_request" };
  return {
    ok: true,
    value: {
      token: body.token,
      lang: body.lang,
      neighbourhood: body.neighbourhood,
      places,
      groups: SIGNUP_GROUPS.filter((group) => body.groups.includes(group)),
      mutedTopics: MUTABLE_TOPICS.filter((topic) => body.muted_topics.includes(topic)),
      ...(checkin === undefined ? {} : { checkin }),
    },
  };
}
