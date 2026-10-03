// The prototype's phone formatter, shared by the places module (building contacts, S02.08) and the resident directory
// (S02.06), which formats numbers in the browser. Pure and browser-safe.

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

/** A stored number as a resident or an Admin reads it: (416) 555-0123. */
export function displayPhone(stored: string): string {
  return phone(stored).formatted ?? stored;
}
