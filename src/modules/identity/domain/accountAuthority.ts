import type { StaffRole } from "../../../contracts/staffRoles";
import type { StaffStatus } from "./staffAccount";

/** The staff member acting, as the rules need them. */
export interface Actor {
  id: string;
  role: StaffRole;
  status: StaffStatus;
}

/**
 * Who may create and manage accounts: an active Admin (AD-4: "accounts" is Admin-only).
 *
 * Seam for S01.12: this is the one place the account screens and actions ask, and it becomes
 * `can(actor.role, "accounts.manage", context)` from `identity/domain/policy.ts` there. It does not
 * check the session's authenticator level (`aal2`, S01.10) or the setup gates (S01.07); those
 * stories add them where the session is resolved.
 */
export function mayManageAccounts(actor: Actor): boolean {
  return actor.status === "active" && actor.role === "admin";
}
