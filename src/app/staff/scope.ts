// The scope the role policy (S01.12) checks a staff member's call against: an Ambassador's
// assigned buildings and floors (AD-4). Read again on every call that needs it, so a reassignment
// or removal counts from the next request.
import type { PolicyAssignment } from "@/modules/identity";
import { assignments } from "./assignments";
import type { StaffSession } from "./session";

/**
 * The person's current assignments (S01.14's `ambassador_assignment`), read from the identity module
 * on each call. Nobody assigned, an assignment removed or a floor not listed means the call is
 * refused as out of scope (fail closed). Who covers a floor right now (an active Ambassador) is
 * `coversFloor`'s question, not this one: the guard has already refused a session of anyone else.
 */
export async function assignmentsOf(session: StaffSession): Promise<readonly PolicyAssignment[]> {
  return assignments().assignmentsOf(session.staffId);
}
