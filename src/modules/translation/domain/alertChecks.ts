// The checks an alert's translation must pass before anyone sees it (S04.02, AD-10, D-4). Pure.
//
// A model's output passes only if it is not empty, is not the English handed back, is written in the expected script, has
// the letters that tell its language from a neighbour's, and, for the languages `eld` knows, `eld` reads it as that
// language (`prs` is checked as `fa`, which is how `eld` reports Dari). `eld` has no Pashto and reads Pashto as Persian, so
// Pashto is checked by script and letters alone: it must contain at least one Pashto marker letter, and neither Pashto nor
// Dari may contain a letter only Urdu uses (a model asked for Pashto may answer in Dari, or in Urdu). Dari also may not
// contain a Pashto marker letter: asked for Dari in the wrong words, North Small Translate gives Pashto, which `eld`
// reads as Persian too.
//
// What each language must pass (its `eld` code, script, marker letters and excluded letters) is a row of
// `translation_route`, config rather than code; how a check is applied is here. A change to either changes the result of a
// check, so the cache key carries a check version made of both (alertTranslator.ts#checkVersion): CHECK_LOGIC_VERSION and the
// `eld` version are bumped by hand when this file or `eld` changes, and the language's own check is part of the version.
import { eld } from "eld/medium";

/** The scripts a language's output may be required to be written in. */
export const CHECK_SCRIPTS = ["arabic", "devanagari", "bengali", "gurmukhi", "gujarati", "tamil", "greek", "han", "latin"] as const;
export type CheckScript = (typeof CHECK_SCRIPTS)[number];

const SCRIPT_LETTER: Record<CheckScript, RegExp> = {
  arabic: /^\p{Script=Arabic}$/u,
  devanagari: /^\p{Script=Devanagari}$/u,
  bengali: /^\p{Script=Bengali}$/u,
  gurmukhi: /^\p{Script=Gurmukhi}$/u,
  gujarati: /^\p{Script=Gujarati}$/u,
  tamil: /^\p{Script=Tamil}$/u,
  greek: /^\p{Script=Greek}$/u,
  han: /^\p{Script=Han}$/u,
  latin: /^\p{Script=Latin}$/u,
};

/**
 * The share of an output's letters that must be in the expected script, not counting words copied from the English (names
 * of places and organisations, "Hub", "911" stay as written). The offline catalogue script's threshold.
 */
export const MIN_SCRIPT_SHARE = 0.6;

/**
 * Bump when the rules below, or the normalising of a model's output before them, change in a way a language's own check (a route
 * row) does not show. Part of the cache's check version. 1: the checks below; 2: digits of every script are written 0-9 before
 * the check (D-13), so a text cached before is never reused.
 */
export const CHECK_LOGIC_VERSION = "2";

/** The `eld` version the checks were written against; src/modules/translation/domain/alertChecks.test.ts keeps it equal to the installed package. Part of the cache's check version. */
export const ELD_VERSION = "2.1.0";

/** What one language's output must pass: the columns of its `translation_route` rows. */
export interface LanguageCheck {
  /** The code `eld` must report, or null for a language `eld` does not know (Pashto). */
  eldCode: string | null;
  script: CheckScript;
  /** At least one of these letters must be in the output ("" for none required). */
  markerLetters: string;
  /** None of these letters may be in the output. */
  excludedLetters: string;
}

export type AlertCheckFailure = "empty" | "unchanged" | "wrong_script" | "excluded_letter" | "missing_marker" | "wrong_language";

/** The check as stable text: what its version is made from. */
export function canonicalCheck(check: LanguageCheck): string {
  return JSON.stringify([check.eldCode, check.script, [...check.markerLetters].sort(), [...check.excludedLetters].sort()]);
}

const WORD = /[\p{L}\p{M}\p{N}'’-]+/gu;
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const hasAny = (text: string, letters: string) => [...letters].some((letter) => text.includes(letter));

/** The share of the output's letters, outside words copied from the English, that are in the script: 0 when there are none. */
export function scriptShare(script: CheckScript, english: string, output: string): number {
  const copied = new Set((english.match(WORD) ?? []).map((word) => word.toLowerCase()));
  const expected = SCRIPT_LETTER[script];
  let letters = 0;
  let inScript = 0;
  for (const word of output.match(WORD) ?? []) {
    if (copied.has(word.toLowerCase())) continue;
    for (const char of word) {
      if (!/^\p{L}$/u.test(char)) continue;
      letters += 1;
      if (expected.test(char)) inScript += 1;
    }
  }
  return letters === 0 ? 0 : inScript / letters;
}

/**
 * Why a model's output for a language may not be used, or null when it may. `output` is already normalised
 * (normaliseTranslation). The first failure found is returned: the cheap checks first, `eld` last.
 */
export function checkAlertTranslation(check: LanguageCheck, english: string, output: string): AlertCheckFailure | null {
  if (output.trim() === "") return "empty";
  // The English handed back is not a translation, whatever else it passes.
  if (squash(output) === squash(english)) return "unchanged";
  if (scriptShare(check.script, english, output) < MIN_SCRIPT_SHARE) return "wrong_script";
  if (hasAny(output, check.excludedLetters)) return "excluded_letter";
  if (check.markerLetters !== "" && !hasAny(output, check.markerLetters)) return "missing_marker";
  if (check.eldCode !== null && eld.detect(output).language !== check.eldCode) return "wrong_language";
  return null;
}
