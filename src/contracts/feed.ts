import { z } from "zod";
import { AudienceSchema, NEIGHBOURHOOD_ID } from "./audience";
import { RsnSchema } from "./places";
import { LangCodeSchema } from "./lang";

// FeedV1 (AD-17, AD-20): what `GET /api/feed?lang=` answers. The same for every visitor (AD-3): it names no resident,
// building choice or floor. It carries the open threads that have a web-published entry and, for every building and
// neighbourhood, the status derived from them (AD-19). The phone picks out its own buildings.

/** The derived status of a place (AD-19). Precedence: active > in_progress > resolved > none. */
export const PLACE_STATUSES = ["none", "active", "in_progress", "resolved"] as const;
export const PlaceStatusSchema = z.enum(PLACE_STATUSES);
export type PlaceStatus = z.infer<typeof PlaceStatusSchema>;

/** The text of an entry in one language, with how it was made (AD-20 `Translated`). */
export const TranslatedSchema = z.strictObject({
  lang: LangCodeSchema,
  body: z.string(),
  machine: z.boolean(),
  model: z.string().nullable(),
  status: z.enum(["source", "ok", "fallback_en", "script_converted"]),
  source_hash: z.string(),
});

export const FeedEntrySchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["ack", "update", "correction", "withdrawal", "final"]),
  /**
   * A correction or a withdrawal names the entry it replaces (S05.02): that entry is shown marked "Corrected", or "Withdrawn" with the reason, which is the
   * withdrawal's own text. No field was added for it: phones in the field parse this schema strictly (src/modules/alerting/domain/feedCompat.test.ts).
   */
  supersedes_id: z.uuid().optional(),
  phase: z.enum(["problem", "in_progress"]).optional(),
  verified: z.boolean(),
  attribution: z.strictObject({ role: z.string(), rsn: RsnSchema.optional() }),
  published_at: z.iso.datetime(),
  text: TranslatedSchema,
  original: z.strictObject({ lang: z.literal("en"), body: z.string() }),
});

/**
 * A thread. `entries` keeps every earlier entry (an update adds an entry and removes none; S05.01), each with its time (`published_at`) and phase. The
 * feed does not refuse an order: S04.08 builds the list oldest first, and a reader that wants the running story from the latest word back (R-07) calls
 * `entriesNewestFirst`. An ordering slip must never fail the whole feed's parse and take every alert away from residents while one is running.
 * `valid_until` is the valid-until of the entry that covers the thread, the latest published, non-superseded substantive one (S05.01: a later
 * update's choice replaces an earlier one's).
 */
export const FeedThreadSchema = z.strictObject({
  id: z.uuid(),
  slug: z.string().min(1),
  types: z.array(z.string()).min(1),
  audience: AudienceSchema,
  state: z.enum(["open", "closed"]),
  close_reason: z.string().optional(),
  valid_until: z.iso.datetime(),
  entries: z.array(FeedEntrySchema).min(1),
});

/** A thread's entries newest first by `published_at` (ties: the later id first), whatever order they arrive in; the input is not changed. */
export function entriesNewestFirst<T extends { id: string; published_at: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

const PlaceState = { status: PlaceStatusSchema, verified: z.boolean() };

export const FeedV1 = z.strictObject({
  v: z.literal(1),
  /** Increases with every change to what the web shows. A phone keeps the highest it has seen and discards a lower one. */
  feed_version: z.int().min(0),
  /** When the server built this answer (ISO 8601). */
  server_now: z.iso.datetime(),
  threads: z.array(FeedThreadSchema),
  places: z.strictObject({
    buildings: z.array(z.strictObject({ rsn: RsnSchema, ...PlaceState })),
    neighbourhoods: z.array(z.strictObject({ id: z.string().regex(NEIGHBOURHOOD_ID), ...PlaceState })),
  }),
});
export type FeedV1 = z.infer<typeof FeedV1>;
export type FeedThread = z.infer<typeof FeedThreadSchema>;

/**
 * The cache tag of the feed (AD-17). Every transaction that changes web-visible state must, after it commits, expire it
 * with `revalidateTag(FEED_TAG, { expire: 0 })` (as `src/app/staff/buildings/actions.ts` does for the building list), not
 * with `revalidateTag(FEED_TAG)`: in Next 16 that only marks the entry stale, and a stale entry is still served once while
 * a new one is built, so residents could read "No current alerts" after an alert was published.
 */
export const FEED_TAG = "feed";

/**
 * How long the edge may keep one answer (`s-maxage`), and how long the app's own data cache keeps one before it is read again: 15
 * seconds (AD-17). With the phone's own poll every 60 seconds (`FEED_POLL_MS`, src/ui/home/feed-poll.ts) a resident who has the page
 * open sees an approved alert within `FEED_VISIBILITY_BUDGET_MS`. test/feedVisibility.test.ts keeps the three in step, and
 * e2e/staff/feed-visibility.spec.ts measures it end to end with the clock controlled.
 */
export const FEED_EDGE_MAX_AGE_SECONDS = 15;

/**
 * The proposed engineering budget (S04.08; not a service guarantee) from an alert's approval to a resident with the page open,
 * visible and online reading it on their next successful poll: the edge's 15 seconds plus the poll's 60.
 */
export const FEED_VISIBILITY_BUDGET_MS = 75_000;

/** The URL a phone asks. The language is the page language: the one query value, the same for everyone who reads that language. */
export const feedPath = (lang: string): string => `/api/feed?lang=${encodeURIComponent(lang)}`;

/** The failure body for a request the feed cannot answer (AD-20: `{error:{code, message_key}}` is only for failures). */
export const FeedErrorV1 = z.strictObject({
  v: z.literal(1),
  /** `LANG_INVALID`: no language, or not one of ours. `query_invalid`: the language is fine but the query has more than `lang`. */
  error: z.strictObject({ code: z.enum(["LANG_INVALID", "query_invalid", "FEED_UNAVAILABLE"]), message_key: z.string() }),
});
