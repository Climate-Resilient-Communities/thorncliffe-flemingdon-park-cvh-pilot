import type { AdminStanding } from "../domain/adminFloor";
import type { StaffAccount } from "../domain/staffAccount";
import { isUsableAdmin } from "../domain/usableAdmin";
import type { IdentityProvider } from "./ports";

/** Where the facts of isUsableAdmin live beyond the account's own row. */
export interface UsabilitySources {
  /** The authenticator (Supabase Auth). */
  idp: IdentityProvider;
  /** The failed-sign-in lock of a username (S01.07's sign_in_lock): its end while in force, else null. */
  signInLockedUntil: (username: string) => Promise<Date | null>;
}

/**
 * Whether the account is a usable Admin at `now`, gathering each fact from where it lives
 * (isUsableAdmin lists them). The identity provider is asked about the authenticator only when
 * the account's own row could make it usable.
 *
 * This is the one place the facts are gathered.
 */
export async function isAccountUsableAdmin(sources: UsabilitySources, account: StaffAccount, now: Date): Promise<boolean> {
  if (account.role !== "admin" || account.status !== "active" || account.mustChangePassword) return false;
  return isUsableAdmin(
    {
      role: account.role,
      status: account.status,
      mustChangePassword: account.mustChangePassword,
      authenticatorEnrolled: await sources.idp.hasVerifiedAuthenticator(account.authUserId),
      signInLockedUntil: await sources.signInLockedUntil(account.username),
    },
    now,
  );
}

/** The accounts as the two-Admin rule sees them. */
export async function adminStandings(sources: UsabilitySources, accounts: readonly StaffAccount[], now: Date): Promise<AdminStanding[]> {
  return Promise.all(
    accounts.map(async (account) => ({ id: account.id, role: account.role, usable: await isAccountUsableAdmin(sources, account, now) })),
  );
}
