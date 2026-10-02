import { eq } from "drizzle-orm";
import type { StaffRole } from "../../../contracts/staffRoles";
import type { DbExecutor } from "../../../platform/db";
import type { PolicyAssignment } from "../domain/policy";
import type { StaffStatus } from "../domain/staffAccount";
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
 * Until S01.14 (`ambassador_assignment`) nobody has assignments, so an Ambassador covers nothing and
 * the policy's `assigned_building` rule denies; S01.14 reads the table here.
 *
 * TODO(S01.14): fill `assignments` from S01.14's assignment query (the Ambassador's current
 * `ambassador_assignment` rows, as `PolicyAssignment`s) in this same executor and transaction. It is a
 * separate change, made after S01.14 merges; until then every Ambassador is out of scope for
 * building-level alerts, which fails closed.
 */
export async function readStaffStanding(executor: DbExecutor, staffId: string): Promise<StaffStanding | null> {
  const [row] = await executor.select({ role: staffAccount.role, status: staffAccount.status }).from(staffAccount).where(eq(staffAccount.id, staffId));
  if (!row) return null;
  return { role: row.role, status: row.status, assignments: [] };
}
