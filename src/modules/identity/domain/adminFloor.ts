import type { StaffRole } from "../../../contracts/staffRoles";
import { err, ok, type Result } from "./result";

/** There are always at least this many usable Admins (S01.06, AD-4), except through recovery. */
export const MIN_USABLE_ADMINS = 2;

/** An account as the two-Admin rule sees it: its role, and whether it is a usable Admin now (isUsableAdmin). */
export interface AdminStanding {
  id: string;
  role: StaffRole;
  usable: boolean;
}

/** Refused with "There must always be at least two usable Admins". */
export type AdminFloorRefusal = "two_admin_rule";

export function usableAdminCount(accounts: readonly AdminStanding[]): number {
  return accounts.filter((account) => account.role === "admin" && account.usable).length;
}

/** True while fewer than two Admins are usable: the Hub shows every Admin the shortfall banner. */
export function hasAdminShortfall(accounts: readonly AdminStanding[]): boolean {
  return usableAdminCount(accounts) < MIN_USABLE_ADMINS;
}

/**
 * Suspending, removing or demoting an account (the changes an Admin chooses). Refused when the
 * account is an Admin and either it is usable and fewer than two usable Admins would be left, or
 * fewer than two are usable already: after the recovery exception left a shortfall, these changes
 * to any Admin stay refused until two are usable again. Accounts that are not Admins are never
 * held back by this rule.
 */
export function decideAdminChange(accounts: readonly AdminStanding[], targetId: string): Result<void, AdminFloorRefusal> {
  const target = accounts.find((account) => account.id === targetId);
  if (!target || target.role !== "admin") return ok(undefined);
  const usable = usableAdminCount(accounts);
  if (usable < MIN_USABLE_ADMINS) return err("two_admin_rule");
  if (target.usable && usable - 1 < MIN_USABLE_ADMINS) return err("two_admin_rule");
  return ok(undefined);
}

/**
 * The recovery exception (an Admin-issued password reset or authenticator reset) and the automatic
 * locks (failed sign-in, expired starting password) always go ahead. This says whether one on
 * `targetId` leaves fewer than two usable Admins, so its audit record carries `admin_shortfall: true`:
 * the target is an Admin and, with it no longer usable, fewer than two are.
 */
export function leavesAdminShortfall(accounts: readonly AdminStanding[], targetId: string): boolean {
  const target = accounts.find((account) => account.id === targetId);
  if (!target || target.role !== "admin") return false;
  const left = accounts.filter((account) => account.id !== targetId);
  return usableAdminCount(left) < MIN_USABLE_ADMINS;
}
