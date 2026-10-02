import { z } from "zod";
import { FloorIdSchema, RsnSchema } from "./buildingList";
import { LangCodeSchema } from "./lang";

/** The one localStorage key that holds a resident's choices on their phone (AD-3). Never sent to the server. */
export const DEVICE_CHOICES_KEY = "cvh.choices";

/** The groups R-26 offers, in the order it shows them (`groups.<id>` in the string catalog). Residents choose; nothing is inferred. */
export const GROUPS = ["seniors", "newcomers", "families", "checkin"] as const;
export const GroupSchema = z.enum(GROUPS);
export type Group = z.infer<typeof GroupSchema>;

// `{v: 1, …}`. The schema is loose so that a field a later story adds (muted topics, basic mode) survives a write by an
// earlier one. A named field that has the wrong type fails the whole value, which then counts as no choices.
export const DeviceChoicesSchema = z.looseObject({
  v: z.literal(1),
  lang: LangCodeSchema.optional(),
  /** The first-run steps (R-01, R-26, R-35) were gone through, or skipped, once. */
  welcomed: z.boolean().optional(),
  groups: z.array(GroupSchema).optional(),
  /** Buildings by `rsn`, as many as the resident likes. */
  buildings: z.array(RsnSchema).optional(),
  /** Floors by floor id, each in one of the chosen buildings. A unit number is never asked or stored. */
  floors: z.array(FloorIdSchema).optional(),
  /** What the phone dropped because it is no longer in the building list, until the resident has read R-34's note. */
  removed: z.object({ buildings: z.number().int().min(0), floors: z.number().int().min(0) }).optional(),
});

export type DeviceChoices = z.infer<typeof DeviceChoicesSchema>;

/** The saved choices, or null for a missing, unreadable or invalid value: the same as "no choices". */
export function parseDeviceChoices(raw: string | null | undefined): DeviceChoices | null {
  if (!raw) return null;
  try {
    const parsed = DeviceChoicesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
