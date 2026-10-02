/**
 * The building contact (S02.08): who residents can call about their building, entered by an Admin.
 * It is a published work or office line (the building agreed to publish it), not personal data: a role
 * from a fixed list and a North American phone number. No personal name is stored. The Hub owns it in the
 * pilot: residents see "Provided by the Hub, last updated {date}".
 *
 * The role is stored as a code and shown as a translated label. The phone number is stored as E.164
 * (+14165550123) and shown as (416) 555-0123.
 */

/** The roles an Admin can choose, as stored. The resident page and the staff form show each as a translated label. */
export const CONTACT_ROLES = ["superintendent", "building_management", "property_office"] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

/** The message key (in the `building.roles` group of the catalog) of each role's label. */
export const CONTACT_ROLE_LABEL_KEYS: Record<ContactRole, string> = {
  superintendent: "superintendent",
  building_management: "buildingManagement",
  property_office: "propertyOffice",
};

export const isContactRole = (value: unknown): value is ContactRole => typeof value === "string" && (CONTACT_ROLES as readonly string[]).includes(value);

/** The only owner in the pilot; the column stores it so the page can name it. */
export const CONTACT_OWNER = "hub";

/** 10 digits; an area code and an exchange never start with 0 or 1 (the database checks the same on the E.164 form). */
const PHONE_DIGITS = /^[2-9][0-9]{2}[2-9][0-9]{6}$/;
const PHONE_ALLOWED = /^[0-9 ().+-]+$/;
/** The stored form of a phone number. The database check `building_contact_phone_valid` is this same expression. */
export const STORED_PHONE = /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;

export type ContactError = "role_invalid" | "phone_invalid" | "role_without_phone" | "phone_without_role" | "not_work_number";

export type ContactCheck = { ok: true; contact: { role: ContactRole; phone: string } | null } | { ok: false; error: ContactError };

/**
 * The prototype's phone formatter (design/prototype/cvh/lib.js, `phone`): accepts any common format and gives it back as
 * (416) 555-0123. `ok` is false unless the input has 10 digits, or 11 with a leading 1.
 */
export function phone(input: unknown): { ok: boolean; digits: string; formatted: string | null } {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, digits, formatted: null };
  return { ok: true, digits, formatted: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` };
}

/**
 * The phone number as it is stored: +14165550123. A leading country code 1 is accepted ("+1 (416) 555-0123");
 * anything else that is not a ten-digit North American number is refused.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!PHONE_ALLOWED.test(trimmed)) return null;
  const { ok, digits } = phone(trimmed);
  if (!ok || !PHONE_DIGITS.test(digits)) return null;
  return `+1${digits}`;
}

/** A stored number as a resident or an Admin reads it: (416) 555-0123. */
export function displayPhone(stored: string): string {
  return phone(stored).formatted ?? stored;
}

/** The link that dials a stored number. */
export const telHref = (stored: string): string => `tel:${stored}`;

/**
 * Checks what the Admin chose and typed. Both fields empty removes the contact (`contact: null`); one without
 * the other is refused, so a building never has a role with no number or a number with no role. A contact is
 * saved only with the Admin's confirmation that the number is a work or office number the building agreed to publish.
 */
export function checkContact(roleInput: string, phoneInput: string, confirmed: boolean): ContactCheck {
  const role = roleInput.trim();
  const phoneTyped = phoneInput.trim();
  if (role === "" && phoneTyped === "") return { ok: true, contact: null };
  if (role === "") return { ok: false, error: "phone_without_role" };
  if (phoneTyped === "") return { ok: false, error: "role_without_phone" };
  if (!isContactRole(role)) return { ok: false, error: "role_invalid" };
  const stored = normalizePhone(phoneTyped);
  if (stored === null) return { ok: false, error: "phone_invalid" };
  if (!confirmed) return { ok: false, error: "not_work_number" };
  return { ok: true, contact: { role, phone: stored } };
}
