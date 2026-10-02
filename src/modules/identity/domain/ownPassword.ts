import { err, ok, type Result } from "./result";

/** The shortest own password (epic E01 definitions: "Own password"). Enforced by the app, never by Supabase's settings. */
export const OWN_PASSWORD_MIN_LENGTH = 10;
/**
 * The longest own password, in UTF-8 bytes: bcrypt's limit. Supabase Auth is given the password's
 * 64-character peppered form, but the rule is kept on what the person types.
 */
export const OWN_PASSWORD_MAX_BYTES = 72;

export type OwnPasswordError =
  | "password_too_short"
  | "password_too_long"
  | "password_contains_username"
  | "password_is_starting_password"
  | "password_mismatch";

/**
 * Checks a proposed own password (epic E01 definitions): at least 10 characters, at most 72 bytes
 * (bcrypt's limit), not containing the username (in any case) and not the starting password (in
 * any case). `confirm` must be the same text, so a typing mistake does not lock the person out.
 * Length counts characters (code points), so a password in any script is measured the same way.
 */
export function validateOwnPassword(
  input: { password: string; confirm: string },
  account: { username: string; startingPassword: string | null },
): Result<string, OwnPasswordError> {
  const { password } = input;
  if ([...password].length < OWN_PASSWORD_MIN_LENGTH) return err("password_too_short");
  if (new TextEncoder().encode(password).length > OWN_PASSWORD_MAX_BYTES) return err("password_too_long");
  const lower = password.toLowerCase();
  if (account.username !== "" && lower.includes(account.username.toLowerCase())) return err("password_contains_username");
  if (account.startingPassword !== null && lower === account.startingPassword.toLowerCase()) return err("password_is_starting_password");
  if (input.confirm !== password) return err("password_mismatch");
  return ok(password);
}
