// What a resident may read about a building (S02.08, FR-D4-P, NFR-N7): the register's facts with the day they
// last changed, the neighbourhood, whether the latest register no longer lists the building, and the contact the
// Hub entered. Nothing else leaves the database: not the coordinates, the floors, or who confirmed them (staff
// only). One indexed read by primary key, joined to the neighbourhood's name; the page that shows it is cached.
import { eq } from "drizzle-orm";
import type { Db } from "../../../platform/db";
import { building, neighbourhood } from "../adapters/schema";
import { contactOf, type BuildingContact } from "./floors";

export interface PublicBuilding {
  rsn: string;
  address: string;
  neighbourhoodName: string;
  /** Each fact is null when the register did not say: "not known". */
  storeys: number | null;
  elevators: number | null;
  emergencyPower: boolean | null;
  coolingRoom: boolean | null;
  airConditioning: string | null;
  barrierFreeEntrance: boolean | null;
  /** When any of the facts last changed. */
  factsUpdatedAt: Date;
  /** The latest register no longer lists the building: the page opens, with a note that the Hub is checking. */
  checkingDetails: boolean;
  contact: BuildingContact | null;
}

const RSN = /^[0-9]{1,9}$/;

/** The building a resident asks for by its register number; null when there is none (or the number is not one). */
export async function readPublicBuilding(db: Db, rsn: string): Promise<PublicBuilding | null> {
  if (!RSN.test(rsn)) return null;
  const [row] = await db
    .select({
      rsn: building.rsn,
      address: building.address,
      neighbourhoodName: neighbourhood.name,
      storeys: building.storeys,
      elevators: building.elevators,
      emergencyPower: building.emergencyPower,
      coolingRoom: building.coolingRoom,
      airConditioning: building.airConditioning,
      barrierFreeEntrance: building.barrierFreeEntrance,
      factsUpdatedAt: building.factsUpdatedAt,
      notInRegisterSince: building.notInRegisterSince,
      contactRole: building.contactRole,
      contactPhone: building.contactPhone,
      contactUpdatedAt: building.contactUpdatedAt,
    })
    .from(building)
    .innerJoin(neighbourhood, eq(neighbourhood.id, building.neighbourhoodId))
    .where(eq(building.rsn, rsn))
    .limit(1);
  if (!row) return null;
  return {
    rsn: row.rsn,
    address: row.address,
    neighbourhoodName: row.neighbourhoodName,
    storeys: row.storeys,
    elevators: row.elevators,
    emergencyPower: row.emergencyPower,
    coolingRoom: row.coolingRoom,
    airConditioning: row.airConditioning,
    barrierFreeEntrance: row.barrierFreeEntrance,
    factsUpdatedAt: row.factsUpdatedAt,
    checkingDetails: row.notInRegisterSince !== null,
    contact: contactOf(row),
  };
}
