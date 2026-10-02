import type { StaffRole } from "../../../contracts/staffRoles";
import type { StaffStatus } from "./staffAccount";

/**
 * What decides whether an Admin is usable (epic E01 definitions). Each fact comes from the story
 * that owns it:
 *  - role, status and mustChangePassword: staff_account (S01.05; S01.07 clears the flag when the
 *    person replaces the starting password; `locked_pending_reissue` is set by S01.07);
 *  - authenticatorEnrolled: an authenticator enrolled through the app (S01.10): the account's
 *    staff_account.factor_enrolled_at (which the two-Admin trigger also reads) and a verified TOTP
 *    factor in Supabase Auth, read through the IdentityProvider port;
 *  - signInLockedUntil: the failed-sign-in lock (S01.07), null when there is none.
 */
export interface AdminUsabilityFacts {
  role: StaffRole;
  status: StaffStatus;
  mustChangePassword: boolean;
  authenticatorEnrolled: boolean;
  signInLockedUntil: Date | null;
}

/**
 * A usable Admin: an Admin that is active (not suspended or removed, not `locked_pending_reissue`),
 * not under a failed-sign-in lock at `now`, has replaced its starting password and has an enrolled
 * authenticator.
 */
export function isUsableAdmin(facts: AdminUsabilityFacts, now: Date): boolean {
  return (
    facts.role === "admin" &&
    facts.status === "active" &&
    (facts.signInLockedUntil === null || facts.signInLockedUntil.getTime() <= now.getTime()) &&
    !facts.mustChangePassword &&
    facts.authenticatorEnrolled
  );
}
