import { err, ok, type Result } from "./result";

/** The prefix of every starting password (epic E01 definitions). */
export const STARTING_PASSWORD_PREFIX = "cvh";

// Latin letters that Unicode decomposition does not reduce to a plain a to z letter, as a
// reader of the name would spell them (African and Azerbaijani orthographies included).
// The modifier letters used as apostrophes in names (Oʻzbek, Hausa ʼ, Arabic hamza and ayn
// transliterations) map to nothing, like the apostrophe. A letter missing here is not dropped
// silently: startingPasswordLetters reports it and the name is refused.
const LATIN_EXTRAS: Record<string, string> = {
  ß: "ss", ẞ: "ss", æ: "ae", Æ: "ae", œ: "oe", Œ: "oe", ø: "o", Ø: "o", đ: "d", Đ: "d", ð: "d", Ð: "d",
  þ: "th", Þ: "th", ł: "l", Ł: "l", ı: "i", ħ: "h", Ħ: "h", ŋ: "n", Ŋ: "n",
  ɔ: "o", Ɔ: "o", ɛ: "e", Ɛ: "e", ə: "e", Ə: "e", ǝ: "e", Ǝ: "e", ɖ: "d", Ɖ: "d", ɗ: "d", Ɗ: "d",
  ƙ: "k", Ƙ: "k", ĸ: "k", ɓ: "b", Ɓ: "b", ʋ: "v", Ʋ: "v", ƒ: "f", Ƒ: "f", ɡ: "g", ɣ: "g", Ɣ: "g",
  ɲ: "n", Ɲ: "n", ƴ: "y", Ƴ: "y", ƈ: "c", Ƈ: "c", ɨ: "i", Ɨ: "i", ʉ: "u", Ʉ: "u", ɑ: "a", Ɑ: "a",
  ʊ: "u", Ʊ: "u", ɩ: "i", Ɩ: "i", ŧ: "t", Ŧ: "t", ʒ: "z", Ʒ: "z", ɱ: "m",
  "ʼ": "", "ʻ": "", "ʽ": "", "ʾ": "", "ʿ": "",
};
const LATIN_EXTRA = new RegExp(`[${Object.keys(LATIN_EXTRAS).join("")}]`, "gu");

/** The name spelled with a to z where it can be (steps 1 to 3 of startingPasswordPart). */
function spelled(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(LATIN_EXTRA, (letter) => LATIN_EXTRAS[letter])
    .toLowerCase();
}

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
  return spelled(name).replace(/[^a-z]/g, "");
}

/** True when the name has a letter (any script) that startingPasswordPart would drop silently. */
function dropsALetter(name: string): boolean {
  return /(?![a-z])\p{L}/u.test(spelled(name));
}

/** The longest starting password, in UTF-8 bytes: bcrypt, which Supabase Auth uses, reads only the first 72. */
export const STARTING_PASSWORD_MAX_BYTES = 72;

export type StartingPasswordError =
  | "starting_password_empty"
  | "starting_password_unsupported_letter"
  | "starting_password_too_long";

/**
 * `cvh-<firstname>-<lastname>` (epic E01 definitions), each name reduced by startingPasswordPart.
 * Refused when either name reduces to nothing (for example only symbols, or only non-Latin letters),
 * when a name has a letter that cannot be spelled with a to z (never dropped silently), and when the
 * password would be longer than STARTING_PASSWORD_MAX_BYTES (the Admin shortens the name used).
 */
export function deriveStartingPassword(firstName: string, lastName: string): Result<string, StartingPasswordError> {
  const first = startingPasswordPart(firstName);
  const last = startingPasswordPart(lastName);
  if (first === "" || last === "") return err("starting_password_empty");
  if (dropsALetter(firstName) || dropsALetter(lastName)) return err("starting_password_unsupported_letter");
  const password = `${STARTING_PASSWORD_PREFIX}-${first}-${last}`;
  // The password is a to z and hyphens after the rules above, so bytes equal characters; measured in bytes anyway.
  if (new TextEncoder().encode(password).length > STARTING_PASSWORD_MAX_BYTES) return err("starting_password_too_long");
  return ok(password);
}
