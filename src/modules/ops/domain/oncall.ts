// The on-call roster's rules (S06.07, AD-13): what a label and a number may be. Pure: no I/O, no clock. The number is personal data; nothing
// here logs it, and an error message never quotes it.

/** The longest label, in characters. */
export const ONCALL_LABEL_MAX_CHARS = 40;
/** The most numbers on the roster: it is for a few Admins, and a text goes to each, so the cost of one alert is bounded. */
export const ONCALL_MAX_NUMBERS = 10;

/**
 * Why an entry is refused before anything is written (a code; the screen turns it into words). S08.08: `not_admin`, an on-duty entry for an account that is not
 * an active Admin with an authenticator; `not_on_duty`, clearing the on-duty entry when none is set.
 */
export type OncallRefusal = "label_missing" | "label_too_long" | "number_invalid" | "number_duplicate" | "roster_full" | "not_found" | "not_admin" | "not_on_duty";

/** A label as stored: leading and trailing space removed, runs of spaces made one, a control character taken out (it becomes a space); refused when empty or over the limit. */
export function parseOncallLabel(input: unknown): { ok: true; label: string } | { ok: false; problem: "label_missing" | "label_too_long" } {
  if (typeof input !== "string") return { ok: false, problem: "label_missing" };
  const label = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (label === "") return { ok: false, problem: "label_missing" };
  if ([...label].length > ONCALL_LABEL_MAX_CHARS) return { ok: false, problem: "label_too_long" };
  return { ok: true, label };
}

/**
 * A Canadian (+1) number as E.164, from the ways a person writes one: `416-555-0123`, `(416) 555 0123`, `1 416 555 0123`, `+1 416 555 0123`.
 * The area code and the exchange start with 2 to 9 (the North American numbering plan).
 * Null for anything else; the input is never echoed.
 */
export function parseOncallNumber(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  if (!/^[+\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (national === null || !/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(national)) return null;
  // A plus sign is only the country code's: "+4165550123" is not a Canadian number.
  if (input.includes("+") && !/^\s*\+\s*1/.test(input)) return null;
  return `+1${national}`;
}
