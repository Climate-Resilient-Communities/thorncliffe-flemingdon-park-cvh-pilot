import { asc, eq } from "drizzle-orm";
import type { DbExecutor } from "../../../platform/db";
import { coversNow } from "../domain/coverage";
import type { PolicyAssignment } from "../domain/policy";
import { ambassadorAssignment, ambassadorAssignmentFloor, staffAccount } from "./schema";

/**
 * The one query for a person's current assignments (S01.14), as the role policy reads them: for each
 * building, its floors by id, or null for every floor. Only what counts now: an account that is not an
 * active Ambassador (`coversNow`) has no assignments, so it has no scope either. `assignmentsOf` and
 * `readStaffStanding` both come here. Pass the caller's executor (inside a transaction, its transaction).
 */
export async function readAssignments(executor: DbExecutor, staffId: string): Promise<PolicyAssignment[]> {
  const [person] = await executor.select({ role: staffAccount.role, status: staffAccount.status }).from(staffAccount).where(eq(staffAccount.id, staffId));
  if (!person || !coversNow(person)) return [];
  const rows = await executor.select().from(ambassadorAssignment).where(eq(ambassadorAssignment.staffId, staffId)).orderBy(asc(ambassadorAssignment.rsn));
  if (rows.length === 0) return [];
  const listed = await executor
    .select({ rsn: ambassadorAssignmentFloor.rsn, floorId: ambassadorAssignmentFloor.floorId })
    .from(ambassadorAssignmentFloor)
    .where(eq(ambassadorAssignmentFloor.staffId, staffId))
    .orderBy(asc(ambassadorAssignmentFloor.floorId));
  return rows.map((row) => ({
    rsn: row.rsn,
    floorIds: row.allFloors ? null : listed.filter((floor) => floor.rsn === row.rsn).map((floor) => floor.floorId),
  }));
}
