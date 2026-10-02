/**
 * The building contact (S02.08): who residents can call about their building, entered by an Admin.
 * A role ("Superintendent", "Building management") and a North American phone number; no personal
 * name is stored. The Hub owns it in the pilot: residents see "Provided by the Hub, last updated {date}".
 */

export const CONTACT_ROLE_MAX_LENGTH = 40;
/** The only owner in the pilot; the column stores it so the page can name it. */
export const CONTACT_OWNER = "hub";

/** Letters of any script, digits, spaces and a few marks that appear in a role ("Super / caretaker", "Owner's office"). */
const ROLE_ALLOWED = /^[\p{L}\p{N} '’&/.,-]+$/u;
const ROLE_NEEDS_LETTER = /\p{L}/u;
/** 10 digits; an area code and an exchange never start with 0 or 1 (the database checks the same). */
const PHONE_DIGITS = /^[2-9][0-9]{2}[2-9][0-9]{6}$/;
const PHONE_ALLOWED = /^[0-9 ().+-]+$/;

export type ContactError = "role_empty" | "role_too_long" | "role_characters" | "phone_empty" | "phone_invalid" | "role_without_phone" | "phone_without_role";

export type ContactCheck = { ok: true; contact: { role: string; phone: string } | null } | { ok: false; error: ContactError };

/** The role as it is stored: white space at either end dropped, runs of spaces inside made one. */
export const trimContactRole = (input: string): string => input.trim().replace(/\s+/g, " ");

/**
 * The phone number as it is stored and shown: 416-555-0123. A leading country code 1 is accepted
 * ("+1 (416) 555-0123") and dropped; anything else that is not ten digits is refused.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!PHONE_ALLOWED.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!PHONE_DIGITS.test(digits)) return null;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** The number to put after `tel:`. */
export const telHref = (phone: string): string => `tel:+1${phone.replaceAll("-", "")}`;

/**
 * Checks what the Admin typed. Both fields empty removes the contact (`contact: null`); one without
 * the other is refused, so a building never has a role with no number or a number with no role.
 */
export function checkContact(roleInput: string, phoneInput: string): ContactCheck {
  const role = trimContactRole(roleInput);
  const phoneTyped = phoneInput.trim();
  if (role === "" && phoneTyped === "") return { ok: true, contact: null };
  if (role === "") return { ok: false, error: "phone_without_role" };
  if (phoneTyped === "") return { ok: false, error: "role_without_phone" };
  if ([...role].length > CONTACT_ROLE_MAX_LENGTH) return { ok: false, error: "role_too_long" };
  if (!ROLE_ALLOWED.test(role) || !ROLE_NEEDS_LETTER.test(role)) return { ok: false, error: "role_characters" };
  const phone = normalizePhone(phoneTyped);
  if (phone === null) return { ok: false, error: "phone_invalid" };
  return { ok: true, contact: { role, phone } };
}
