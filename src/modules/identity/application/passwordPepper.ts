import { createHmac } from "node:crypto";

/**
 * The password pepper (S01.07). The identity provider never stores a staff member's password as
 * typed: it stores `hex(HMAC-SHA-256(STAFF_PASSWORD_PEPPER, password))`. Usernames and starting
 * passwords (`rvh-first-last`) can be guessed, and the provider accepts a password grant from
 * anyone holding the public key; without the server-only pepper that grant cannot be made with
 * the human password, so the only way to a session is the app's own sign-in (valid once, 72 hours,
 * throttled, audited). The app also binds every session it opens (staff_session).
 *
 * The peppered form is 64 hex characters, under bcrypt's 72-byte limit; the 72-byte rule still
 * applies to the human password (ownPassword.ts, newAccount.ts). Rotating the pepper makes every
 * stored password unusable: every password must then be re-issued.
 */
export type PasswordPepper = (password: string) => string;

/** The least key material accepted (env.ts checks the format; this only guards against a short key). */
export const PEPPER_MIN_LENGTH = 32;

/** The provider's form of a password under this pepper. */
export function pepperPassword(pepper: string, password: string): string {
  return createHmac("sha256", pepper).update(password, "utf8").digest("hex");
}

/** The pepper function, or null when no usable pepper is configured (every identity operation then refuses). */
export function passwordPepper(pepper: string | undefined): PasswordPepper | null {
  if (pepper === undefined || pepper.length < PEPPER_MIN_LENGTH) return null;
  return (password) => pepperPassword(pepper, password);
}

/** The operational log event of an identity operation refused because the pepper is not configured. */
export const PEPPER_NOT_CONFIGURED_EVENT = "identity.staff_passwords_not_configured";

/** The explanation that goes with it (and with the CLI's refusal). */
export const PEPPER_NOT_CONFIGURED_MESSAGE =
  "staff passwords are not configured: STAFF_PASSWORD_PEPPER is missing or too short (at least 32 random bytes, for example `openssl rand -hex 32`)";
