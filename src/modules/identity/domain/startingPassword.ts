import { err, ok, type Result } from "./result";

/** The prefix of every starting password (epic E01 definitions). */
export const STARTING_PASSWORD_PREFIX = "rvh";

// Latin letters that Unicode decomposition does not reduce to a plain a to z letter.
const LATIN_EXTRAS: Record<string, string> = {
  ß: "ss", ẞ: "ss", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ø: "o", Ø: "o", đ: "d", Đ: "d", ð: "d", Ð: "d",
  þ: "th", Þ: "th", ł: "l", Ł: "l", ı: "i", ħ: "h", Ħ: "h", ŋ: "n", Ŋ: "n",
};
const LATIN_EXTRA = new RegExp(`[${Object.keys(LATIN_EXTRAS).join("")}]`, "gu");

/**
 * One name as it appears in a starting password. The rule, in order:
 *  1. Unicode compatibility decomposition (NFKD), then every combining mark is dropped:
 *     accents and other diacritics are stripped ("José" → "jose", "Nguyễn" → "nguyen",
 *     full-width "Ａｎｎ" → "ann").
 *  2. Latin letters that do not decompose are spelled out (ß → ss, æ → ae, ø → o, ł → l,
 *     đ → d, þ → th, dotless ı → i).
 *  3. Lower case.
 *  4. Everything that is not a letter a to z is removed: spaces, apostrophes, hyphens, dots,
 *     digits ("O'Brien" → "obrien", "Mary Ann" → "maryann", "Al-Hassan" → "alhassan").
 *     Hyphens are removed too, since the password's own hyphens separate its parts.
 *
 * Names in a non-Latin script (Arabic, Bengali, Chinese, Greek, Tamil and so on) reduce to an
 * empty string: the app does not transliterate, because two people would not spell the result
 * the same way. The Admin enters the Latin spelling the person uses (for example on their ID),
 * and is told so when a name reduces to nothing.
 */
export function startingPasswordPart(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(LATIN_EXTRA, (letter) => LATIN_EXTRAS[letter])
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export type StartingPasswordError = "starting_password_empty";

/**
 * `rvh-<firstname>-<lastname>` (epic E01 definitions), each name reduced by startingPasswordPart.
 * Refused when either name reduces to nothing (for example only symbols, or only non-Latin letters).
 */
export function deriveStartingPassword(firstName: string, lastName: string): Result<string, StartingPasswordError> {
  const first = startingPasswordPart(firstName);
  const last = startingPasswordPart(lastName);
  if (first === "" || last === "") return err("starting_password_empty");
  return ok(`${STARTING_PASSWORD_PREFIX}-${first}-${last}`);
}
