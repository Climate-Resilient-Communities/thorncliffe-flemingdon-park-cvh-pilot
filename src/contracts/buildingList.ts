import { z } from "zod";
import { FloorIdSchema, RsnSchema } from "./places";

/**
 * The building list a resident's phone keeps (`GET /api/buildings`): the pilot buildings and their floors, the same for
 * every visitor. Residents pick from it on R-35 and the phone checks its saved choices against it (S02.03). It carries
 * only what a resident needs: no facts, no confirmation state, nothing about who chose what.
 */
export const BuildingListSchema = z.object({
  v: z.literal(1),
  /** When the server read the list from the database (ISO 8601). The phone prunes its choices only with a list generated no earlier than its last write. */
  generated_at: z.iso.datetime(),
  buildings: z.array(
    z.object({
      rsn: RsnSchema,
      address: z.string(),
      neighbourhoodId: z.string(),
      neighbourhood: z.string(),
      /** Lowest first. */
      floors: z.array(z.object({ id: FloorIdSchema, label: z.string() })),
    }),
  ),
});

/** The cache tag of the list: the staff actions that change a building or floor revalidate it, so the change shows at once. */
export const RESIDENT_BUILDINGS_TAG = "resident-buildings";

export type BuildingList = z.infer<typeof BuildingListSchema>;
export type ListedBuilding = BuildingList["buildings"][number];
