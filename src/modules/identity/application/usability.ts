import type { DbExecutor } from "../../../platform/db";
import type { AdminStanding } from "../domain/adminFloor";
import type { StaffAccount } from "../domain/staffAccount";
import { isUsableAdmin } from "../domain/usableAdmin";
import type { IdentityProvider } from "./ports";

/**
 * The failed-sign-in lock of a username (S01.07's sign_in_lock): its end while in force, else null.
 * Read through `executor`: inside a transaction that is the transaction itself, never the pool. A
 * read on a second pool connection while the transaction holds a lock others wait for (the
 * throttle's advisory lock) exhausts the pool and deadlocks it.
 */
export type SignInLockReader = (executor: DbExecutor, username: string) => Promise<Date | null>;

/** Where the facts of isUsableAdmin live beyond the account's own row. */
export interface UsabilitySources {
  /** The authenticator (Supabase Auth). */
  idp: IdentityProvider;
  /** The failed-sign-in lock of a username, read through the given executor. */
  signInLockedUntil: SignInLockReader;
}

/**
 * Whether the account has an authenticator the app enrolled (S01.10): the app's own record on
 * staff_account and a verified factor at the provider, both. The provider is asked only when the
 * record is there; an authenticator added at the provider directly, outside the app, never counts.
 */
export async function hasEnrolledAuthenticator(idp: IdentityProvider, account: Pick<StaffAccount, "authUserId" | "factorEnrolledAt">): Promise<boolean> {
  return account.factorEnrolledAt !== null && (await idp.hasVerifiedAuthenticator(account.authUserId));
}

/** How usability is counted. */
export interface UsabilityOptions {
  /**
   * Leave the failed-sign-in lock out of the count. The Hub's account changes (suspend, remove,
   * demote) use it: the lock is temporary and anyone can cause it with wrong passwords, so it must
   * not decide whether an Admin may be suspended. Every other fact still counts. The database's
   * two-Admin trigger does not see sign-in locks either.
   */
  ignoreSignInLock?: boolean;
}

/**
 * Whether the account is a usable Admin at `now`, gathering each fact from where it lives
 * (isUsableAdmin lists them). The identity provider is asked about the authenticator only when
 * the account's own row could make it usable. Database facts are read through `executor`: the
 * caller's transaction when there is one.
 *
 * This is the one place the facts are gathered.
 */
export async function isAccountUsableAdmin(
  sources: UsabilitySources,
  executor: DbExecutor,
  account: StaffAccount,
  now: Date,
  options: UsabilityOptions = {},
): Promise<boolean> {
  if (account.role !== "admin" || account.status !== "active" || account.mustChangePassword || account.factorEnrolledAt === null) return false;
  return isUsableAdmin(
    {
      role: account.role,
      status: account.status,
      mustChangePassword: account.mustChangePassword,
      authenticatorEnrolled: await hasEnrolledAuthenticator(sources.idp, account),
      signInLockedUntil: options.ignoreSignInLock ? null : await sources.signInLockedUntil(executor, account.username),
    },
    now,
  );
}

/** The accounts as the two-Admin rule sees them, with database facts read through `executor`. */
export async function adminStandings(
  sources: UsabilitySources,
  executor: DbExecutor,
  accounts: readonly StaffAccount[],
  now: Date,
  options: UsabilityOptions = {},
): Promise<AdminStanding[]> {
  return Promise.all(
    accounts.map(async (account) => ({ id: account.id, role: account.role, usable: await isAccountUsableAdmin(sources, executor, account, now, options) })),
  );
}
