import type { StaffRole } from "../../../contracts/staffRoles";
import { err, ok, type Result } from "./result";
import type { StaffStatus } from "./staffAccount";

/** The account changes an Admin chooses (S01.06): each can leave fewer usable Admins. */
export type StaffChange = { kind: "suspend" } | { kind: "remove" } | { kind: "change_role"; role: StaffRole };

/**
 *  - self_action: an Admin never suspends, removes or changes the role of their own account; another
 *    Admin does (as with resets, S01.11);
 *  - account_removed: a removed account stays removed and keeps its role (audit records point at it);
 *  - no_change: the account is already suspended, or already has that role.
 */
export type StaffChangeRefusal = "self_action" | "account_removed" | "no_change";

export interface ChangeTarget {
  id: string;
  role: StaffRole;
  status: StaffStatus;
}

export function decideStaffChange(actorId: string, target: ChangeTarget, change: StaffChange): Result<void, StaffChangeRefusal> {
  if (target.id === actorId) return err("self_action");
  if (target.status === "removed") return err("account_removed");
  if (change.kind === "suspend" && target.status === "suspended") return err("no_change");
  if (change.kind === "change_role" && change.role === target.role) return err("no_change");
  return ok(undefined);
}

/** True when the change takes an Admin away: suspends or removes it, or gives it another role. */
export function takesAwayAnAdmin(target: ChangeTarget, change: StaffChange): boolean {
  if (target.role !== "admin") return false;
  return change.kind !== "change_role" || change.role !== "admin";
}
