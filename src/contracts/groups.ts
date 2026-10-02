import { z } from "zod";

/**
 * The groups a resident can choose (R-26, `groups.<id>` in the string catalog) and a Coordinator can aim an alert at
 * (O-04, `staff.audience.groupNames.<id>`): the one list, in the order R-26 shows them. Residents choose; nothing is inferred.
 * S04.04 defines it here; S02.03's device choices (`src/contracts/deviceChoices.ts`) hold a copy until that story merges
 * and then imports this one.
 */
export const GROUPS = ["seniors", "newcomers", "families", "checkin"] as const;
export const GroupSchema = z.enum(GROUPS);
export type Group = z.infer<typeof GroupSchema>;
