// The floors of a building as other modules read them (S01.14): identity's assignments refer to floors by
// id and may not import places (AD-2), so the composition root hands identity this reader as its port.
import { asc, eq, inArray } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { building, buildingFloor, disruptionType, neighbourhood } from "../adapters/schema";

/** A floor as an assignment needs it: the stable id, the label people see, and the place in the building's order. */
export interface FloorRecord {
  id: string;
  label: string;
  sortOrder: number;
}

/**
 * The floors of a building, lowest first, or null when there is no building with that rsn. With `lock`
 * the building's row is locked until the transaction ends, the lock every floor edit of this module
 * takes (floors.ts#lockBuilding), so an assignment and a floor removal on one building run one after the other.
 * `true` or "update" takes the same lock a floor edit takes; "share" is for a reader that must see the floors it
 * checks stay as they are until it commits (an alert's audience naming a floor, S04.04): it waits for a floor edit
 * in progress and makes the next one wait, and many such readers do not wait for one another.
 */
export async function floorsOfBuilding(executor: DbExecutor, rsn: string, options: { lock?: boolean | "update" | "share" } = {}): Promise<FloorRecord[] | null> {
  const found = executor.select({ rsn: building.rsn }).from(building).where(eq(building.rsn, rsn));
  const [row] = options.lock ? await found.for(options.lock === "share" ? "share" : "update") : await found;
  if (!row) return null;
  const floors = await executor.select().from(buildingFloor).where(eq(buildingFloor.rsn, rsn)).orderBy(asc(buildingFloor.sortOrder), asc(buildingFloor.label));
  return floors.map((floor) => ({ id: floor.id, label: floor.label, sortOrder: floor.sortOrder }));
}

/**
 * The ids of the neighbourhoods the pilot covers, sorted ("FP", "TP"), read through the executor given: what an
 * alert's neighbourhood audience may name (S04.04). alerting may not import the table, so it reads it here.
 */
export async function neighbourhoodIds(executor: DbExecutor): Promise<string[]> {
  const rows = await executor.select({ id: neighbourhood.id }).from(neighbourhood).orderBy(asc(neighbourhood.id));
  return rows.map((row) => row.id);
}

/**
 * The neighbourhood of each building given, by rsn (a building that does not exist is left out): what the possible-duplicate
 * check of an alert needs to compare a neighbourhood audience with a building one (S04.05). alerting may not import the table.
 */
export async function neighbourhoodsOfBuildings(executor: DbExecutor, rsns: readonly string[]): Promise<Map<string, string>> {
  if (rsns.length === 0) return new Map();
  const rows = await executor.select({ rsn: building.rsn, neighbourhoodId: building.neighbourhoodId }).from(building).where(inArray(building.rsn, [...rsns]));
  return new Map(rows.map((row) => [row.rsn, row.neighbourhoodId]));
}

/**
 * The address of each building given, by rsn, read through the executor given (a building that is not there is left out): what an ambassador's post names
 * in its texts, "Building ambassador, {building}" (S08.02). alerting may not import the table, so it reads it here.
 */
export async function addressesOfBuildings(executor: DbExecutor, rsns: readonly string[]): Promise<Map<string, string>> {
  if (rsns.length === 0) return new Map();
  const rows = await executor.select({ rsn: building.rsn, address: building.address }).from(building).where(inArray(building.rsn, [...rsns]));
  return new Map(rows.map((row) => [row.rsn, row.address]));
}

/**
 * What `disruption_type.direct` says of each type given, by id (a type that is not there is left out): whether an Ambassador's post of that type may appear on the
 * web at once (D-1, S08.03). true for the lower-risk types, false for fire and "Other", null where it is not decided. alerting may not import the table, so it reads it here.
 */
export async function directnessOfTypes(executor: DbExecutor, types: readonly string[]): Promise<Map<string, boolean | null>> {
  if (types.length === 0) return new Map();
  const rows = await executor.select({ id: disruptionType.id, direct: disruptionType.direct }).from(disruptionType).where(inArray(disruptionType.id, [...types]));
  return new Map(rows.map((row) => [row.id, row.direct]));
}
