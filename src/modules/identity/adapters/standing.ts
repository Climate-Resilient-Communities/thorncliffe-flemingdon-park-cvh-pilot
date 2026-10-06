import { eq } from "drizzle-orm";
import type { StaffRole } from "../../../contracts/staffRoles";
import type { DbExecutor } from "../../../platform/db";
import { normaliseUsername } from "../domain/newAccount";
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

/**
 * The name a staff member goes by in the Hub, their first and last name, for a screen that says who did something (who paused texts).
 * Null when there is no such account. A suspended or removed person keeps their name: the screen still says who paused.
 */
export async function readStaffName(executor: DbExecutor, staffId: string): Promise<string | null> {
  const [row] = await executor.select({ firstName: staffAccount.firstName, lastName: staffAccount.lastName }).from(staffAccount).where(eq(staffAccount.id, staffId));
  return row ? `${row.firstName} ${row.lastName}` : null;
}

/**
 * A staff member found by username, for a script IT runs on an Admin's behalf (S09.03, scripts/access-request: the Admin who handled a resident's access request
 * is the actor of its audit records): their id, role, status and name. Null when there is no such account. The username is matched as sign-in matches it, in
 * lower case ("JDoe" is "jdoe").
 */
export async function readStaffByUsername(executor: DbExecutor, username: string): Promise<{ id: string; role: StaffRole; status: StaffStatus; name: string } | null> {
  const [row] = await executor
    .select({ id: staffAccount.id, role: staffAccount.role, status: staffAccount.status, firstName: staffAccount.firstName, lastName: staffAccount.lastName })
    .from(staffAccount)
    .where(eq(staffAccount.username, normaliseUsername(username)));
  return row ? { id: row.id, role: row.role, status: row.status, name: `${row.firstName} ${row.lastName}` } : null;
}
