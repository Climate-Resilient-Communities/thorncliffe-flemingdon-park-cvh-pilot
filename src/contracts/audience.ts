// The one audience type and the one matcher (AD-7, AR-11, S04.04). Who an alert is for is this value; the
// server (the feed and the recipient query in `subscriptions`), the phone (ordering and highlighting) and
// SMS selection all decide "is this alert for this person" by calling `matches` below, never by a rule of
// their own. Pure and browser-safe: it imports only zod, reads no clock and touches no state.
//
// Floors are named by their stable floor id (`building_floor.id`), never by label or number: renaming or
// reordering a floor must not change who an alert reaches. (Pending owner decision 28; AD-7 says floor ids.)
import { z } from "zod";

/** The groups a resident can choose (R-26, `groups.<id>` in the string catalog) and a Coordinator can aim at. */
export const AUDIENCE_GROUPS = ["seniors", "newcomers", "families", "checkin"] as const;
export type AudienceGroup = (typeof AUDIENCE_GROUPS)[number];

/**
 * Types of disruption whose alerts ignore topic opt-outs: fire and evacuation (`disruption_type` id `fire`,
 * "Fire alarm or evacuation"). A safety default of AD-7: nobody mutes a fire alarm.
 */
export const SAFETY_OVERRIDE_TYPES: readonly string[] = ["fire"];

const NEIGHBOURHOOD_ID = /^[A-Z]{2,6}$/;
const RSN = /^[0-9]{1,9}$/;
const FLOOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TYPE_ID = /^[a-z][a-z_]{1,19}$/;

const NeighbourhoodIdSchema = z.string().regex(NEIGHBOURHOOD_ID);
const RsnSchema = z.string().regex(RSN);
const FloorIdSchema = z.string().regex(FLOOR_ID);
const TypeIdSchema = z.string().regex(TYPE_ID);
const GroupSchema = z.enum(AUDIENCE_GROUPS);

/** A building of the audience, by `rsn`: `floors` is null for the whole building, else its floor ids. */
const AudienceBuildingSchema = z.strictObject({
  rsn: RsnSchema,
  floors: z.array(FloorIdSchema).min(1).nullable(),
});

const Common = {
  /** Groups narrow who is texted; empty means no narrowing. Every web reader still sees the alert. */
  groups: z.array(GroupSchema),
  /** The disruption types of the entry (at least one): the topics a resident may have muted. */
  types: z.array(TypeIdSchema).min(1),
};

export const AudienceSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("neighbourhood"), neighbourhood_ids: z.array(NeighbourhoodIdSchema).min(1), ...Common }),
  z.strictObject({ scope: z.literal("buildings"), buildings: z.array(AudienceBuildingSchema).min(1), ...Common }),
]);

export type Audience = z.infer<typeof AudienceSchema>;
export type AudienceBuilding = z.infer<typeof AudienceBuildingSchema>;

/** Code-unit order: the same on every machine and in every locale, so a hash of the value never depends on either. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort(byText);

/**
 * The audience in its one stored form: lists sorted and without repeats (a building named twice is one
 * building with the union of its floors, and the whole building when either says so). Idempotent.
 * Does not check that the value is an Audience; parse first.
 */
export function normaliseAudience(audience: Audience): Audience {
  const groups = sortedUnique(audience.groups) as AudienceGroup[];
  const types = sortedUnique(audience.types);
  if (audience.scope === "neighbourhood") {
    return { scope: "neighbourhood", neighbourhood_ids: sortedUnique(audience.neighbourhood_ids), groups, types };
  }
  const merged = new Map<string, string[] | null>();
  for (const building of audience.buildings) {
    const seen = merged.get(building.rsn);
    if (seen === null || building.floors === null) merged.set(building.rsn, null);
    else merged.set(building.rsn, [...(seen ?? []), ...building.floors]);
  }
  const buildings = [...merged.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([rsn, floors]) => ({ rsn, floors: floors === null ? null : sortedUnique(floors) }));
  return { scope: "buildings", buildings, groups, types };
}

/**
 * The value as an Audience in its stored form, or null when it is not one: a value that does not parse, or
 * that parses but is not normalised (unsorted or repeated lists). The check refuses rather than repairs, so
 * the value hashed and frozen at submit is exactly the value somebody built.
 */
export function canonicalAudience(value: unknown): Audience | null {
  const parsed = AudienceSchema.safeParse(value);
  if (!parsed.success) return null;
  return JSON.stringify(normaliseAudience(parsed.data)) === JSON.stringify(parsed.data) ? parsed.data : null;
}

/** The buildings an audience names, by rsn, in its order; empty for a neighbourhood audience. */
export function audienceRsns(audience: Audience): string[] {
  return audience.scope === "buildings" ? audience.buildings.map((building) => building.rsn) : [];
}

/**
 * What the matcher needs to know about one person, however it was learned: a subscriber row (SMS), the
 * device's choices (the phone), or a test. Nothing else about a person is ever used.
 */
export interface AudienceProfile {
  /** The neighbourhood they live in (required to subscribe; the phone derives it from a chosen building). Null when not known. */
  neighbourhoodId: string | null;
  /**
   * The buildings they recorded, each with the floors they recorded in it (floor ids). A building with no
   * floors listed means no floor recorded there. Empty means no building recorded.
   */
  places: readonly { rsn: string; floors: readonly string[] }[];
  /** The groups they chose. */
  groups: readonly string[];
  /** The topics (disruption type ids) they muted. */
  mutedTopics: readonly string[];
}

/**
 * Whether an alert with this audience is for this person (AD-7). Every rule applies together:
 *  - topics: when every type of the alert is a topic the person muted, no, unless one of the types is a
 *    fire or evacuation (`SAFETY_OVERRIDE_TYPES`), which nobody can mute. An alert on several types still
 *    reaches someone who muted only some of them;
 *  - groups: when the audience names groups, the person must have chosen at least one of them; when it
 *    names none, groups play no part;
 *  - place: a neighbourhood audience is for everyone living there; a buildings audience is for a person who
 *    recorded one of its buildings and, when it lists floors in that building, one of those floors or no
 *    floor in it. A person with no building recorded is therefore reached by neighbourhood alerts only.
 *    Several places that match are one match: the answer is a single yes or no.
 * Pure: the arguments are read, never changed.
 */
export function matches(audience: Audience, profile: AudienceProfile): boolean {
  if (mutedEverything(audience.types, profile.mutedTopics)) return false;
  if (audience.groups.length > 0 && !audience.groups.some((group) => profile.groups.includes(group))) return false;
  if (audience.scope === "neighbourhood") {
    return profile.neighbourhoodId !== null && audience.neighbourhood_ids.includes(profile.neighbourhoodId);
  }
  return audience.buildings.some((wanted) =>
    profile.places.some(
      (place) => place.rsn === wanted.rsn && (wanted.floors === null || place.floors.length === 0 || place.floors.some((floor) => wanted.floors!.includes(floor))),
    ),
  );
}

/** True when the person muted every topic of the alert and none of them overrides a mute. */
function mutedEverything(types: readonly string[], muted: readonly string[]): boolean {
  if (types.some((type) => SAFETY_OVERRIDE_TYPES.includes(type))) return false;
  return types.length > 0 && types.every((type) => muted.includes(type));
}
