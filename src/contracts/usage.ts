import { z } from "zod";
import { NeighbourhoodIdSchema } from "./directory";
import { LangCodeSchema } from "./lang";

// A usage event (S02.15, AR-26, FR-M1, FR-M3): the one message the phone may send about how the app is used, `{evt, lang, nbhd?}`.
// It is fixed and aggregate-only: it names what happened, in which page language and (when the page itself is about one) which of the
// two neighbourhoods, and nothing else. It never carries a building, a floor, a group, a device or session id, or any value that
// stays the same from one event to the next, and the server stores only a count per day for each combination (usage_count).
// The saved choices never reach it (AD-3): `nbhd` comes from the page being viewed, or, for an install, from the buildings chosen
// only when they are all in one neighbourhood (src/ui/usage/nbhd.ts).

/** What is counted: the app installed, and the directory, a listing, the map, a guide and the essential numbers opened. */
export const USAGE_EVENTS = ["install", "directory_view", "listing_view", "map_view", "guide_view", "numbers_view"] as const;
export const UsageEventNameSchema = z.enum(USAGE_EVENTS);
export type UsageEventName = z.infer<typeof UsageEventNameSchema>;

/** `strictObject`: an extra field is refused, not dropped, so a phone that sent something more is seen to be wrong. */
export const UsageEventSchema = z.strictObject({
  evt: UsageEventNameSchema,
  lang: LangCodeSchema,
  nbhd: NeighbourhoodIdSchema.optional(),
});
export type UsageEvent = z.infer<typeof UsageEventSchema>;

/** The most bytes a usage event may take (the largest valid one is under 60). A longer body is refused unread. */
export const USAGE_BODY_MAX_BYTES = 256;

/** Where the phone sends it. */
export const USAGE_PATH = "/api/metrics";
