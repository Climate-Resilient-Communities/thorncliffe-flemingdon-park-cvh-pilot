import { eq } from "drizzle-orm";
import type { StaffRole } from "../../../contracts/staffRoles";
import type { DbExecutor } from "../../../platform/db";
import type { PolicyAssignment } from "../domain/policy";
import type { StaffStatus } from "../domain/staffAccount";
import { readAssignments } from "./assignmentRead";
import { staffAccount } from "./schema";

/**
 * A staff member as the role policy needs them at the moment a use case asks (AD-4, S01.12): their
 * role, whether the account is still usable (`active`) and, for an Ambassador, their assignments.
 * Other modules judge "who may do this" from this, never from what a request or an old session said.
 */
export interface StaffStanding {
  role: StaffRole;
  status: StaffStatus;
  assignments: readonly PolicyAssignment[];
}

/**
 * The current standing of a staff member, read through the executor the caller is in (inside a
 * transaction, its transaction). Null when there is no such account.
 *
 * An Ambassador's `assignments` are their current `ambassador_assignment` rows (S01.14, `readAssignments`),
 * read through the same executor, so an approval sees them inside its own transaction. Only an active
 * Ambassador has any; for everyone else the list is empty.
 */
export async function readStaffStanding(executor: DbExecutor, staffId: string): Promise<StaffStanding | null> {
  const [row] = await executor.select({ role: staffAccount.role, status: staffAccount.status }).from(staffAccount).where(eq(staffAccount.id, staffId));
  if (!row) return null;
  return { role: row.role, status: row.status, assignments: await readAssignments(executor, staffId) };
}
