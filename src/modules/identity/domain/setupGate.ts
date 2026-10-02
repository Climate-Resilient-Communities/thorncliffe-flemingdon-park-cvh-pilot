import type { AssuranceLevel, SetupGate } from "../../../contracts/staffAuth";
import type { StaffRole } from "../../../contracts/staffRoles";

/** Roles that must confirm sign-in with an authenticator (AD-4, S01.10). Ambassadors and Directors sign in at `aal1`. */
export const AUTHENTICATOR_ROLES: readonly StaffRole[] = ["admin", "coordinator"];

/** True for a role that must enrol an authenticator and enter its code at every sign-in. */
export function needsAuthenticator(role: StaffRole): boolean {
  return AUTHENTICATOR_ROLES.includes(role);
}

/**
 * The setup gate a signed-in staff member is at (epic E01 definitions, "Setup sequence"):
 * (1) replace the starting password, if one is in use; (2) enrol an authenticator, if the role is
 * Admin or Coordinator and none is enrolled; then, for those roles, enter this sign-in's
 * authenticator code until the session is `aal2` (S01.10); (3) the Hub.
 *
 * `authenticatorEnrolled` is the app's own record (staff_account.factor_enrolled_at) and a verified
 * factor at the provider, both; `aal` is the session's level as the app bound it (staff_session).
 */
export function setupGate(facts: { mustChangePassword: boolean; role: StaffRole; authenticatorEnrolled: boolean; aal: AssuranceLevel }): SetupGate {
  if (facts.mustChangePassword) return "choose_password";
  if (!needsAuthenticator(facts.role)) return "hub";
  if (!facts.authenticatorEnrolled) return "enrol_authenticator";
  if (facts.aal !== "aal2") return "authenticator_code";
  return "hub";
}
