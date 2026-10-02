// The four staff roles (AD-4), shared by identity (accounts, policy) and audit (allow-listed meta).
export const STAFF_ROLES = ["ambassador", "coordinator", "director", "admin"] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}
