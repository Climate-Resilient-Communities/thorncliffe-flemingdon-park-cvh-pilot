import { z } from "zod";

/** A building number from the register (`building.rsn`). */
export const RsnSchema = z.string().regex(/^[0-9]{1,9}$/);

/** A floor's stable id (`building_floor.id`): a rename keeps it. */
export const FloorIdSchema = z.uuid();

// S02.03 (`src/contracts/buildingList.ts`) defines the same two schemas for the resident's building list. This
// file is where S04.04 takes them from until that story merges; S02.03 then re-exports or imports these, so there
// is one definition of what a floor id and an rsn look like.
