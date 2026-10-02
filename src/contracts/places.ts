import { z } from "zod";

/** A building number from the register (`building.rsn`). */
export const RsnSchema = z.string().regex(/^[0-9]{1,9}$/);

/** A floor's stable id (`building_floor.id`): a rename keeps it. */
export const FloorIdSchema = z.uuid();

// Defined here and nowhere else: S02.03's building list (`src/contracts/buildingList.ts`) and device choices import them.
