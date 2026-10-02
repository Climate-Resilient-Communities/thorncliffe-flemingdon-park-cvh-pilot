import type { DbTransaction } from "../../../platform/db";
import { leavesAdminShortfall } from "../domain/adminFloor";
import type { IdentityProvider, StaffStore } from "./ports";
import { adminStandings, type SignInLockReader } from "./usability";

/** What a recovery action or an automatic lock learns before it changes an account (S01.06). */
export interface AdminRecovery {
  /** The change leaves fewer than two usable Admins: its audit record carries `admin_shortfall: true`. */
  adminShortfall: boolean;
}

/** The `meta` fields a recovery action or automatic lock adds to its audit record. */
export function adminShortfallMeta(recovery: AdminRecovery): { admin_shortfall?: true } {
  return recovery.adminShortfall ? { admin_shortfall: true } : {};
}

/** How long a transaction waits for a row lock held by another before it fails (S01.06). */
export const DEFAULT_LOCK_TIMEOUT_MS = 5000;

export interface AdminRecoveryDeps {
  store: StaffStore;
  idp: IdentityProvider;
  now: () => Date;
  lockTimeoutMs?: number;
  /** The failed-sign-in lock of a username (S01.07), a fact of isUsableAdmin, read in the caller's transaction. */
  signInLockedUntil: SignInLockReader;
}

/**
 * The recovery exception (S01.06), internal to the identity module: its own use cases call it
 * (the Admin-issued password reset, the authenticator reset, the automatic locks of S01.07) inside
 * their transaction, before they change the account. It is not part of the module's public
 * interface, so no other module can lift the two-Admin rule.
 *
 *  - when the account is not an Admin, it locks only that account and returns no shortfall: the
 *    change cannot reduce the Admins, and no Admin row is locked and the provider is not asked;
 *  - otherwise it locks the Admin rows and the account's, like every change to Admins, lets the
 *    transaction leave fewer than two usable Admins (the database trigger allows it) and says
 *    whether the change does, so the caller's audit record carries `adminShortfallMeta(result)`.
 *
 * It never refuses: blocking a recovery would stop the Admins recovering. Bootstrap never returns.
 */
export function createAdminRecovery(deps: AdminRecoveryDeps) {
  const { store } = deps;

  return {
    async beginAdminRecovery(tx: DbTransaction, targetId: string): Promise<AdminRecovery> {
      await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
      // Read first without a lock, so a non-Admin target never takes the Admin rows (and the lock
      // order stays "every Admin row, in id order" for everything that does).
      const seen = await store.findById(tx, targetId);
      if (!seen || seen.role !== "admin") {
        const locked = await store.lockAccount(tx, targetId);
        if (!locked || locked.role !== "admin") return { adminShortfall: false };
      }
      const locked = await store.lockAdminsAndAccount(tx, targetId);
      await store.permitAdminShortfall(tx);
      // Read in the caller's transaction: a second pool connection here deadlocks the pool when every
      // other connection waits for a lock this transaction holds (the sign-in throttle's).
      const standings = await adminStandings(deps, tx, locked, deps.now());
      return { adminShortfall: leavesAdminShortfall(standings, targetId) };
    },
  };
}

export type AdminRecoveryService = ReturnType<typeof createAdminRecovery>;
