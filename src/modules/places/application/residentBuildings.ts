// What a resident's phone needs of the places module (S02.03): the pilot buildings with their neighbourhood and
// floors, to choose from on R-35 and to check saved choices against. The same list for every visitor; nothing
// here knows who is asking, and nothing about the register's facts or an Admin's confirmation is exposed.
import { asc, eq, isNull } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { building, buildingFloor, neighbourhood } from "../adapters/schema";
import { byNeighbourhoodAndAddress } from "./floors";

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
    async placeIds(): Promise<{ buildings: string[]; neighbourhoods: string[]; neighbourhoodOf: Record<string, string> }> {
      const [buildings, neighbourhoods] = await Promise.all([
        db.select({ rsn: building.rsn, neighbourhoodId: building.neighbourhoodId }).from(building).where(isNull(building.mergedInto)).orderBy(asc(building.rsn)),
        db.select({ id: neighbourhood.id }).from(neighbourhood).orderBy(asc(neighbourhood.id)),
      ]);
      return {
        buildings: buildings.map((row) => row.rsn),
        neighbourhoods: neighbourhoods.map((row) => row.id),
        // Each building's neighbourhood, so a neighbourhood audience covers the buildings in it when the feed derives status (AD-19, S05.06).
        neighbourhoodOf: Object.fromEntries(buildings.map((row) => [row.rsn, row.neighbourhoodId])),
      };
    },

    /**
     * Every building by neighbourhood and address (street, then number: UAT F-7), each with its floors. A building flagged `not_in_register_since` is
     * still listed: S02.08 still opens its page, so a resident's saved choice for it stays valid. A building merged into another by the buildings
     * seed (UAT F-5) is not: it is the same building as the one listed.
     */
    async list(): Promise<ResidentBuilding[]> {
      const rows = (
        await db
          .select({ rsn: building.rsn, address: building.address, neighbourhoodId: building.neighbourhoodId, neighbourhood: neighbourhood.name, lat: building.latitude, lng: building.longitude })
          .from(building)
          .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
          .where(isNull(building.mergedInto))
      ).sort((a, b) => byNeighbourhoodAndAddress({ ...a, neighbourhoodName: a.neighbourhood }, { ...b, neighbourhoodName: b.neighbourhood }));
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
