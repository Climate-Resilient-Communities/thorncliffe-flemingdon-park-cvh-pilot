// Wire contracts of staff sign-in and the setup sequence (S01.07, AD-4, AD-20). Safe in client code.
import { z } from "zod";
import { STAFF_ROLES } from "./staffRoles";

/**
 * The setup sequence's gates (epic E01 definitions), in order. A signed-in staff member is at
 * exactly one: replacing the starting password, enrolling an authenticator (Admins and
 * Coordinators, S01.10), or the Hub. Each gate has one page.
 */
export const SETUP_GATES = ["choose_password", "enrol_authenticator", "hub"] as const;
export type SetupGate = (typeof SETUP_GATES)[number];

/** The page of each gate. Every other `/staff` page redirects here while the person is at that gate. */
export const GATE_PAGES: Record<SetupGate, string> = {
  choose_password: "/staff/setup/password",
  enrol_authenticator: "/staff/setup/authenticator",
  hub: "/staff",
};

export const SIGN_IN_PAGE = "/staff/sign-in";

/** Inputs are bounded so a huge body is refused before anything is hashed or sent on. */
export const SignInRequest = z.strictObject({
  username: z.string().max(200),
  password: z.string().max(1000),
});
export type SignInRequest = z.infer<typeof SignInRequest>;

export const PasswordRequest = z.strictObject({
  password: z.string().max(1000),
  confirm: z.string().max(1000),
});
export type PasswordRequest = z.infer<typeof PasswordRequest>;

/**
 * Error codes of the staff API (`{ error: code, message? }`). `setup_incomplete` is the 403 of
 * every `/api/staff` call outside the current setup gate (no message: the code is the contract).
 */
export const STAFF_API_ERRORS = [
  "unauthenticated",
  "setup_incomplete",
  "bad_request",
  "unsupported_media_type",
  "forbidden_origin",
  "sign_in_failed",
  "starting_password_expired",
  "unavailable",
  "password_too_short",
  "password_too_long",
  "password_contains_username",
  "password_is_starting_password",
  "password_mismatch",
  "password_rejected",
] as const;
export type StaffApiError = (typeof STAFF_API_ERRORS)[number];

/** `GET /api/staff/me`: who is signed in and which gate they are at. Never the email address. */
export const StaffMe = z.strictObject({
  staffId: z.uuid(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(STAFF_ROLES),
  gate: z.enum(SETUP_GATES),
  next: z.string(),
});
export type StaffMe = z.infer<typeof StaffMe>;

/** The answer to a successful sign-in or password change: where to go next. */
export const StaffNext = z.strictObject({ next: z.string() });
export type StaffNext = z.infer<typeof StaffNext>;
