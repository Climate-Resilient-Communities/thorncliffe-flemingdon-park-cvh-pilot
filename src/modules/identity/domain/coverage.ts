import type { StaffRole } from "../../../contracts/staffRoles";
import type { StaffStatus } from "./staffAccount";

/**
 * Coverage (S01.14, AR-16, AD-12): which floors an Ambassador's assignments reach, and which floors have
 * somebody. Floors are named by their stable id, never by label, so renaming a floor keeps it covered.
 * An assignment lists floor ids, or `null` for every floor of the building (floors added later too).
 */

/** One assignment: a building, and its floors by id, or null for all of them. */
export interface AssignedFloors {
  rsn: string;
  floorIds: readonly string[] | null;
}

/** A floor as coverage needs it. `sortOrder` orders the floors of a building, lowest first. */
export interface FloorRef {
  id: string;
  sortOrder: number;
}

/** True when the assignment reaches the floor of the building. It never reaches another building. */
export function assignmentCovers(assignment: AssignedFloors, rsn: string, floorId: string): boolean {
  return assignment.rsn === rsn && (assignment.floorIds === null || assignment.floorIds.includes(floorId));
}

/**
 * Whether an account covers anything at all: only an active Ambassador does. A suspended, locked
 * (`locked_pending_reissue`) or removed account, or one whose role is no longer Ambassador, keeps its
 * assignment rows but covers nothing, so a return to active covers again without being reassigned.
 */
export function coversNow(account: { role: StaffRole; status: StaffStatus }): boolean {
  return account.role === "ambassador" && account.status === "active";
}

/**
 * The floor ids from one floor to another, inclusive, in the building's own order (`sortOrder`): the
 * order of the floors is the Admin's, so "G to 3" covers whatever the building lists between them
 * ("G", "1", "2", "3" or "G", "M", "3"). The result is in the building's order, lowest first, and is
 * the floors as they are now: a floor added later is not part of it. `"unknown_end"` when an end is
 * not one of the building's floors; `"reversed"` when the first end is above the second (a reversed
 * range is refused, not turned round, as the audience picker does, S04.04).
 */
export function expandFloorRange(floors: readonly FloorRef[], fromId: string, toId: string): string[] | "unknown_end" | "reversed" {
  const from = floors.find((floor) => floor.id === fromId);
  const to = floors.find((floor) => floor.id === toId);
  if (!from || !to) return "unknown_end";
  if (from.sortOrder > to.sortOrder) return "reversed";
  return [...floors]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .filter((floor) => floor.sortOrder >= from.sortOrder && floor.sortOrder <= to.sortOrder)
    .map((floor) => floor.id);
}

/** Who covers one floor of a building, and whether anyone does. */
export interface FloorCoverage {
  floorId: string;
  covered: boolean;
  /** The ids of the covering staff, in the order given. */
  staffIds: string[];
}

/**
 * Each floor of a building (as given) with the staff covering it. `covering` is the building's
 * assignments of accounts that cover now (coversNow); the caller filters.
 */
export function floorCoverage(floors: readonly FloorRef[], covering: readonly { staffId: string; floorIds: readonly string[] | null }[]): FloorCoverage[] {
  return floors.map((floor) => {
    const staffIds = covering.filter((assignment) => assignment.floorIds === null || assignment.floorIds.includes(floor.id)).map((assignment) => assignment.staffId);
    return { floorId: floor.id, covered: staffIds.length > 0, staffIds };
  });
}
