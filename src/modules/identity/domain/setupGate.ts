import type { SetupGate } from "../../../contracts/staffAuth";
import type { StaffRole } from "../../../contracts/staffRoles";

/** Roles that must confirm sign-in with an authenticator (AD-4, S01.10). */
export const AUTHENTICATOR_ROLES: readonly StaffRole[] = ["admin", "coordinator"];

/**
 * The setup gate a signed-in staff member is at (epic E01 definitions, "Setup sequence"):
 * (1) replace the starting password, if one is in use; (2) enrol an authenticator, if the role is
 * Admin or Coordinator and none is enrolled (S01.10 builds the enrolment); (3) the Hub.
 */
export function setupGate(facts: { mustChangePassword: boolean; role: StaffRole; authenticatorEnrolled: boolean }): SetupGate {
  if (facts.mustChangePassword) return "choose_password";
  if (AUTHENTICATOR_ROLES.includes(facts.role) && !facts.authenticatorEnrolled) return "enrol_authenticator";
  return "hub";
}
