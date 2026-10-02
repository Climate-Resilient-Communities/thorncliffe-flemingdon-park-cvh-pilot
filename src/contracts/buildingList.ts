import { z } from "zod";

/** A building number from the register (`building.rsn`). */
export const RsnSchema = z.string().regex(/^[0-9]{1,9}$/);

/** A floor's stable id (`building_floor.id`): a rename keeps it. */
export const FloorIdSchema = z.uuid();

/**
 * The building list a resident's phone keeps (`GET /api/buildings`): the pilot buildings and their floors, the same for
 * every visitor. Residents pick from it on R-35 and the phone checks its saved choices against it (S02.03). It carries
 * only what a resident needs: no facts, no confirmation state, nothing about who chose what.
 */
export const BuildingListSchema = z.object({
  v: z.literal(1),
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

export type BuildingList = z.infer<typeof BuildingListSchema>;
export type ListedBuilding = BuildingList["buildings"][number];
