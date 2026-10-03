// What a resident's phone needs of the places module (S02.03): the pilot buildings with their neighbourhood and
// floors, to choose from on R-35 and to check saved choices against. The same list for every visitor; nothing
// here knows who is asking, and nothing about the register's facts or an Admin's confirmation is exposed.
import { asc, eq } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { building, buildingFloor, neighbourhood } from "../adapters/schema";

export interface ResidentFloor {
  id: string;
  label: string;
}

export interface ResidentBuilding {
  rsn: string;
  address: string;
  neighbourhoodId: string;
  neighbourhood: string;
  /** The register's point, for the building's pin on the map (S02.07). */
  lat: number;
  lng: number;
  /** Lowest first. */
  floors: ResidentFloor[];
}

export function createResidentBuildings(deps: { db: Db }) {
  const { db } = deps;
  return {
    /**
     * Only the ids: every building's register number and every neighbourhood's id, for the public alert feed, which lists
     * the status of each place (AD-19) without anything else about it.
     */
    async placeIds(): Promise<{ buildings: string[]; neighbourhoods: string[] }> {
      const [buildings, neighbourhoods] = await Promise.all([
        db.select({ rsn: building.rsn }).from(building).orderBy(asc(building.rsn)),
        db.select({ id: neighbourhood.id }).from(neighbourhood).orderBy(asc(neighbourhood.id)),
      ]);
      return { buildings: buildings.map((row) => row.rsn), neighbourhoods: neighbourhoods.map((row) => row.id) };
    },

    /**
     * Every building by neighbourhood and address, each with its floors. A building flagged `not_in_register_since` is
     * still listed: S02.08 still opens its page, so a resident's saved choice for it stays valid.
     */
    async list(): Promise<ResidentBuilding[]> {
      const rows = await db
        .select({ rsn: building.rsn, address: building.address, neighbourhoodId: building.neighbourhoodId, neighbourhood: neighbourhood.name, lat: building.latitude, lng: building.longitude })
        .from(building)
        .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
        .orderBy(asc(neighbourhood.name), asc(building.address), asc(building.rsn));
      const floors = await db
        .select({ id: buildingFloor.id, rsn: buildingFloor.rsn, label: buildingFloor.label })
        .from(buildingFloor)
        .orderBy(asc(buildingFloor.sortOrder), asc(buildingFloor.label));
      const byBuilding = new Map<string, ResidentFloor[]>();
      for (const { rsn, ...floor } of floors) byBuilding.set(rsn, [...(byBuilding.get(rsn) ?? []), floor]);
      return rows.map((row) => ({ ...row, floors: byBuilding.get(row.rsn) ?? [] }));
    },
  };
}

export type ResidentBuildings = ReturnType<typeof createResidentBuildings>;
