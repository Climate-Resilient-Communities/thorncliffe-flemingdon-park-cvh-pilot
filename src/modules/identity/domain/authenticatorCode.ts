/** Digits of an authenticator code (TOTP, RFC 6238, as Supabase Auth issues it). */
export const AUTHENTICATOR_CODE_DIGITS = 6;

/**
 * The code as typed, without the spaces some apps show in the middle ("123 456"); null when what
 * is left is not exactly six digits, so it is refused before the provider is asked.
 */
export function normaliseAuthenticatorCode(input: string): string | null {
  const code = input.replace(/\s+/g, "");
  return new RegExp(`^[0-9]{${AUTHENTICATOR_CODE_DIGITS}}$`).test(code) ? code : null;
}
