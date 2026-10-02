// Wire contracts of staff sign-in and the setup sequence (S01.07, S01.10, AD-4, AD-20). Safe in client code.
import { z } from "zod";
import { STAFF_ROLES } from "./staffRoles";

/**
 * The setup sequence's gates (epic E01 definitions), in order. A signed-in staff member is at
 * exactly one: replacing the starting password, enrolling an authenticator (Admins and
 * Coordinators, S01.10), entering this sign-in's authenticator code (Admins and Coordinators who
 * have an authenticator, while the session is below `aal2`, S01.10), or the Hub. Each gate has one page.
 */
export const SETUP_GATES = ["choose_password", "enrol_authenticator", "authenticator_code", "hub"] as const;
export type SetupGate = (typeof SETUP_GATES)[number];

/** The page of each gate. Every other `/staff` page redirects here while the person is at that gate. */
export const GATE_PAGES: Record<SetupGate, string> = {
  choose_password: "/staff/setup/password",
  enrol_authenticator: "/staff/setup/authenticator",
  authenticator_code: "/staff/sign-in/code",
  hub: "/staff",
};

export const SIGN_IN_PAGE = "/staff/sign-in";

/**
 * The authenticator assurance level of a session (S01.10): `aal1` after the password, `aal2` once
 * an authenticator code was accepted through the app for this session.
 */
export const ASSURANCE_LEVELS = ["aal1", "aal2"] as const;
export type AssuranceLevel = (typeof ASSURANCE_LEVELS)[number];

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

/** `POST /api/staff/factor/verify`: the code an authenticator app shows (spaces are ignored). */
export const FactorCodeRequest = z.strictObject({
  code: z.string().max(20),
});
export type FactorCodeRequest = z.infer<typeof FactorCodeRequest>;

/**
 * `POST /api/staff/factor/enrol`: a new authenticator's secret, shown once. `uri` is the
 * `otpauth://` link the QR code holds; `qrCode` is the provider's picture of it (an SVG data URL),
 * or null when there is none (the in-memory fake).
 */
export const FactorEnrolment = z.strictObject({
  secret: z.string(),
  uri: z.string(),
  qrCode: z.string().nullable(),
});
export type FactorEnrolment = z.infer<typeof FactorEnrolment>;

/**
 * Error codes of the staff API (`{ error: code, message? }`). `setup_incomplete` is the 403 of
 * every `/api/staff` call outside the current setup gate, and `aal2_required` the 403 of a
 * privileged call from a session below `aal2` (S01.10), `forbidden` the 403 of a call the role
 * policy refuses, for the role or out of the person's scope (S01.12); none has a message: the code
 * is the contract.
 */
export const STAFF_API_ERRORS = [
  "unauthenticated",
  "setup_incomplete",
  "aal2_required",
  "forbidden",
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
  "code_invalid",
  "code_locked",
] as const;
export type StaffApiError = (typeof STAFF_API_ERRORS)[number];

/** `GET /api/staff/me`: who is signed in, which gate they are at and the session's level. Never the email address. */
export const StaffMe = z.strictObject({
  staffId: z.uuid(),
  username: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  role: z.enum(STAFF_ROLES),
  gate: z.enum(SETUP_GATES),
  aal: z.enum(ASSURANCE_LEVELS),
  next: z.string(),
});
export type StaffMe = z.infer<typeof StaffMe>;

/** The answer to a successful sign-in, password change or authenticator code: where to go next. */
export const StaffNext = z.strictObject({ next: z.string() });
export type StaffNext = z.infer<typeof StaffNext>;
