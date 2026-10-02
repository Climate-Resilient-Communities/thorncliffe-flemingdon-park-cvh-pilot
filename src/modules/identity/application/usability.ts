import type { AdminStanding } from "../domain/adminFloor";
import type { StaffAccount } from "../domain/staffAccount";
import { isUsableAdmin } from "../domain/usableAdmin";
import type { IdentityProvider } from "./ports";

/**
 * Whether the account is a usable Admin at `now`, gathering each fact from where it lives
 * (isUsableAdmin lists them). The identity provider is asked about the authenticator only when
 * the account's own row could make it usable.
 *
 * This is the one place the facts are gathered: S01.07 supplies the failed-sign-in lock here.
 */
export async function isAccountUsableAdmin(idp: IdentityProvider, account: StaffAccount, now: Date): Promise<boolean> {
  if (account.role !== "admin" || account.status !== "active" || account.mustChangePassword) return false;
  return isUsableAdmin(
    {
      role: account.role,
      status: account.status,
      mustChangePassword: account.mustChangePassword,
      authenticatorEnrolled: await idp.hasVerifiedAuthenticator(account.authUserId),
      signInLockedUntil: null,
    },
    now,
  );
}

/** The accounts as the two-Admin rule sees them. */
export async function adminStandings(idp: IdentityProvider, accounts: readonly StaffAccount[], now: Date): Promise<AdminStanding[]> {
  return Promise.all(
    accounts.map(async (account) => ({ id: account.id, role: account.role, usable: await isAccountUsableAdmin(idp, account, now) })),
  );
}
