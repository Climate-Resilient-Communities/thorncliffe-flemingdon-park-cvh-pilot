// The scope the role policy (S01.12) checks a staff member's call against: an Ambassador's
// assigned buildings and floors (AD-4). Read again on every call that needs it, so a reassignment
// or removal counts from the next request.
import type { PolicyAssignment } from "@/modules/identity";
import type { StaffSession } from "./session";

/**
 * The person's current assignments. Assignments arrive with S01.14 (`ambassador_assignment`), which
 * reads them here from the identity module; until then nobody has any, so every call whose rule
 * depends on an assigned building or floor is refused as out of scope (fail closed).
 */
export async function assignmentsOf(session: StaffSession): Promise<readonly PolicyAssignment[]> {
  void session;
  return [];
}
