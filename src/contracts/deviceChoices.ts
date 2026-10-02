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
// earlier one. Each named field is checked on its own when the value is read (parseDeviceChoices): a field with the
// wrong type is dropped, and the rest of the value is kept.
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
  /** When (ms since 1970, the phone's clock) the choices were last written. A building list generated before it is never used to prune. */
  savedAt: z.number().min(0).optional(),
});

export type DeviceChoices = z.infer<typeof DeviceChoicesSchema>;

const FIELD_SCHEMAS = Object.entries(DeviceChoicesSchema.shape).filter(([name]) => name !== "v");

/**
 * The saved choices, or null for a missing, unreadable or invalid value: the same as "no choices" (a first visit).
 * "Invalid" means text that is not JSON, not an object, or not version 1. Past that, each field is read on its own: a field
 * with the wrong type is dropped and the others are kept, so one bad field does not wipe the language and everything else.
 * A group nobody offers is filtered out of `groups`; fields this story does not know pass through.
 */
export function parseDeviceChoices(raw: string | null | undefined): DeviceChoices | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) || (value as { v?: unknown }).v !== 1) return null;
  const choices: Record<string, unknown> = { ...(value as Record<string, unknown>) };
  for (const [name, schema] of FIELD_SCHEMAS) {
    if (!(name in choices)) continue;
    const input = name === "groups" && Array.isArray(choices.groups) ? choices.groups.filter((group) => GroupSchema.safeParse(group).success) : choices[name];
    const parsed = schema.safeParse(input);
    if (parsed.success) choices[name] = parsed.data;
    else delete choices[name];
  }
  return choices as DeviceChoices;
}
