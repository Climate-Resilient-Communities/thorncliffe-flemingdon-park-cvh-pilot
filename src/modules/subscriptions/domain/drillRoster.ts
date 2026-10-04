// The drill roster's rules (S06.05, AD-6, AD-13): what a label, a number and a language may be. Pure: no I/O, no clock. The number is personal data;
// nothing here logs it, and an error never quotes it.
import { LANG_CODES, type LangCode } from "../../../contracts/lang";

/** The longest label, in characters. */
export const DRILL_LABEL_MAX_CHARS = 40;
/** The most phones on the roster: it is for the staff who rehearse, and a drill texts each of them, so the cost of one drill is bounded. */
export const DRILL_ROSTER_MAX = 20;

/** Why a change is refused before anything is written (a code; the screen turns it into words). */
export type DrillRosterRefusal = "label_missing" | "label_too_long" | "number_invalid" | "number_duplicate" | "language_invalid" | "roster_full" | "not_found";

/** A label as stored: leading and trailing space removed, runs of spaces made one, a control character taken out (it becomes a space); refused when empty or over the limit. */
export function parseRosterLabel(input: unknown): { ok: true; label: string } | { ok: false; problem: "label_missing" | "label_too_long" } {
  if (typeof input !== "string") return { ok: false, problem: "label_missing" };
  const label = input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (label === "") return { ok: false, problem: "label_missing" };
  if ([...label].length > DRILL_LABEL_MAX_CHARS) return { ok: false, problem: "label_too_long" };
  return { ok: true, label };
}

/**
 * A Canadian (+1) number as E.164, from the ways a person writes one: `416-555-0123`, `(416) 555 0123`, `1 416 555 0123`, `+1 416 555 0123`.
 * The area code and the exchange start with 2 to 9 (the North American numbering plan). Null for anything else; the input is never echoed.
 */
export function parseRosterNumber(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 40) return null;
  if (!/^[+\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits.length === 10 ? digits : null;
  if (national === null || !/^[2-9][0-9]{2}[2-9][0-9]{6}$/.test(national)) return null;
  // A plus sign is only the country code's: "+4165550123" is not a Canadian number.
  if (input.includes("+") && !/^\s*\+\s*1/.test(input)) return null;
  return `+1${national}`;
}

/** The language of a roster member: one of the pilot's language codes, as sent; null for anything else. */
export function parseRosterLang(input: unknown): LangCode | null {
  return typeof input === "string" && (LANG_CODES as readonly string[]).includes(input) ? (input as LangCode) : null;
}

/**
 * The language of the text a roster member gets, and so the language they are counted under: their own where the entry has a frozen text message in it,
 * the English one where it has none (a language with no text message of its own, such as zh-Hant, gets the English text), as the approval does for
 * every recipient (alerting's `alertTextsOf`).
 */
export function bodyLangOf(memberLang: LangCode, frozenLangs: readonly string[]): LangCode {
  return (frozenLangs as readonly string[]).includes(memberLang) ? memberLang : "en";
}
