import type { StaffRole } from "../../../contracts/staffRoles";

/**
 * An account's status (AD-4). Every staff request rejects unless it is `active`.
 * `locked_pending_reissue`: the starting password expired unused (S01.07) until an Admin re-issues it.
 */
export const STAFF_STATUSES = ["active", "locked_pending_reissue", "suspended", "removed"] as const;

export type StaffStatus = (typeof STAFF_STATUSES)[number];

/** A staff account as the rules need it. The email is a contact detail only; nothing is ever sent to it. */
export interface StaffAccount {
  id: string;
  authUserId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  role: StaffRole;
  status: StaffStatus;
  mustChangePassword: boolean;
  startingPasswordIssuedAt: Date | null;
}
