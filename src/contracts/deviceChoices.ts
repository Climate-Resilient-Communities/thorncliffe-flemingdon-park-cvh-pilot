import { z } from "zod";
import { LangCodeSchema } from "./lang";

/** The one localStorage key that holds a resident's choices on their phone (AD-3). Never sent to the server. */
export const DEVICE_CHOICES_KEY = "cvh.choices";

// `{v: 1, …}`. Only what the stories built so far read is named; the schema is loose so that a field a later
// story adds (buildings, floors, groups, muted topics, basic mode) survives a write by an earlier one.
export const DeviceChoicesSchema = z.looseObject({
  v: z.literal(1),
  lang: LangCodeSchema.optional(),
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
