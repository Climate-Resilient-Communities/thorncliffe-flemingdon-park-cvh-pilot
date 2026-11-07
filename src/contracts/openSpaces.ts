import { z } from "zod";

/**
 * The spaces open for residents right now (`GET /api/spaces`, the partner space of 2026-11-07): each open or full space partners run at a place
 * of the directory, by that place's catalogue id, with what it is for and when someone last confirmed it. The same for every visitor and
 * cookie-free (AD-3): the phone matches it against the directory's places it already has, so the map's "Open as a space now" and the listing's
 * status are worked out on the phone. Nothing about the space's organisation, capacity or the people who confirmed it is sent.
 */
export const OPEN_SPACE_STATUSES = ["open", "full"] as const;
export const OPEN_SPACE_PURPOSES = ["cooling", "warming", "clean_air", "charging"] as const;

export const OpenSpacesSchema = z.object({
  v: z.literal(1),
  /** When the server read the spaces (ISO 8601). */
  generated_at: z.iso.datetime(),
  spaces: z.array(
    z.object({
      /** The directory's catalogue id of the place the space is at (M052). */
      provider_id: z.string().regex(/^[A-Z][0-9]{3,6}$/),
      status: z.enum(OPEN_SPACE_STATUSES),
      purpose: z.enum(OPEN_SPACE_PURPOSES),
      /** When someone last confirmed the space as shown (ISO 8601). */
      updated_at: z.iso.datetime(),
    }),
  ),
});

export type OpenSpaces = z.infer<typeof OpenSpacesSchema>;
export type OpenSpace = OpenSpaces["spaces"][number];
export type OpenSpacePurpose = OpenSpace["purpose"];

/** Where the phone asks. */
export const OPEN_SPACES_URL = "/api/spaces";

/** The cache tag of the list: a Hub change of a space revalidates it, so residents see the change at once. */
export const RESIDENT_SPACES_TAG = "resident-spaces";

/**
 * After this long without a confirmation an open space is shown as "Not confirmed" (the prototype's `unconfirmedAfterMins`; the partners
 * module's UNCONFIRMED_AFTER_MINUTES, which the Hub's board uses, is the same number: the route's test compares them).
 */
export const UNCONFIRMED_AFTER_MS = 240 * 60_000;

/** The catalogue key of a purpose's words (x09.purpose.*, translated in every language): the prototype's camelCase. */
export const PURPOSE_KEYS: Record<OpenSpacePurpose, string> = { cooling: "cooling", warming: "warming", clean_air: "cleanAir", charging: "charging" };
