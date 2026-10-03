// The translated-question leg's rules (S03.05, AD-10, AD-11). Pure.
//
// A resident's question is translated to English, for search only, when it is written in a language the embedding model
// does not list (Pashto; Dari only as Persian), in Latin letters but not confidently a Latin launch language (romanized or
// mixed), or in Arabic script without the letters that tell Urdu, Pashto and Dari apart. Which model translates each of
// those is config (`search_question_route`), not code. The translation is checked before it is used: it must be English
// (`eld`, plus "no letters of another script"), and not far longer than the question (a translation model that answers the
// question instead of translating it writes much more). The question and its translation are never stored, cached or logged.
import { eld } from "eld/medium";
import type { LangCode } from "@/contracts/lang";

/** The questions that also search through English: Pashto, Dari, romanized or mixed, and ambiguous Arabic script. */
export const QUESTION_SOURCES = ["ps", "prs", "romanized_or_mixed", "ambiguous_arabic"] as const;
export type QuestionSource = (typeof QUESTION_SOURCES)[number];

/** `search_question_route`: the model that translates each kind of question to English; null switches the leg off for it. */
export type QuestionRoute = Readonly<Record<QuestionSource, string | null>>;

/** The language a question of this kind is translated from, or null when the model has to tell (romanized, mixed, ambiguous). */
export function sourceLanguage(source: QuestionSource): LangCode | null {
  return source === "ps" || source === "prs" ? source : null;
}

/** The kind of usage a question's translation is counted under in spend_event. */
export const TRANSLATE_SPEND_KIND = "translate";

/**
 * How far below the best language `eld` may score English and the text still count as English. Single English words are
 * near ties in eld ("doctor": ca 0.78, en 0.78; "dentist": et 0.70, en 0.61), and a translation of a short question is
 * often one or two words; a text in another language scores English far lower ("Necesito un abogado": es 0.82, en 0.36).
 */
export const ENGLISH_MARGIN = 0.12;

/** A translation longer than this is an answer, not a translation (characters, for a question of `length` characters). */
export function maxTranslationLength(length: number): number {
  return 3 * length + 40;
}

export type TranslationCheckFailure = "empty" | "too_long" | "not_english";

/** The model's output, without the quotation marks or surrounding space it sometimes adds. */
export function normaliseTranslation(output: string): string {
  let text = output.trim();
  const pairs: [string, string][] = [['"', '"'], ["“", "”"], ["'", "'"], ["«", "»"]];
  for (const [open, close] of pairs) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) text = text.slice(open.length, -close.length).trim();
  }
  return text;
}

const LETTERS = /\p{L}/gu;
const LATIN = /^\p{Script=Latin}$/u;
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Whether `eld` reads the text as English: English is its best language, or within ENGLISH_MARGIN of it. */
export function isEnglish(text: string): boolean {
  const letters = text.match(LETTERS) ?? [];
  if (letters.length === 0 || !letters.every((letter) => LATIN.test(letter))) return false;
  const scores = eld.detect(text).getScores();
  const english = scores.en ?? 0;
  if (english <= 0) return false;
  const best = Math.max(...Object.values(scores));
  return english >= best - ENGLISH_MARGIN;
}

/** Why a translation of `question` may not be used, or null when it may. `output` is already normalised. */
export function checkTranslation(question: string, output: string): TranslationCheckFailure | null {
  if (output === "") return "empty";
  if (output.length > maxTranslationLength(question.length)) return "too_long";
  // A romanized question handed back unchanged is not a translation, even when it happens to look English to eld.
  if (squash(output) === squash(question)) return "not_english";
  return isEnglish(output) ? null : "not_english";
}

/** What a call is counted as when the vendor did not say: about one token per three bytes of the question. */
export function estimateTranslationTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}
