import { eld } from "eld/medium";
import type { LangCode } from "@/contracts/lang";

export type QuestionLanguageConfidence =
  | "confident"
  | "romanized_or_mixed"
  | "ambiguous_arabic"
  | "unknown";

export interface QuestionLanguage {
  /** Language the question was written in; null unless confident. */
  lang: LangCode | null;
  confidence: QuestionLanguageConfidence;
  /** Language the results are shown in: `lang` when confident, otherwise the page language. */
  query_lang: LangCode;
}

// eld has no Pashto, so Pashto is told by its own letters (AD-10).
const PASHTO_LETTERS = /[ټډړږښګڼېۍ]/u;
const URDU_LETTERS = /[ٹڈڑںے]/u;

const LATIN_LANGS: Partial<Record<string, LangCode>> = { en: "en", es: "es", fr: "fr", tl: "tl", sk: "sk" };

// Scripts that stand for one launch language; eld must agree before the language is confident.
const SINGLE_LANGUAGE_SCRIPTS = [
  { test: /\p{Script=Devanagari}/u, eld: "hi", lang: "hi" },
  { test: /\p{Script=Bengali}/u, eld: "bn", lang: "bn" },
  { test: /\p{Script=Gurmukhi}/u, eld: "pa", lang: "pa" },
  { test: /\p{Script=Gujarati}/u, eld: "gu", lang: "gu" },
  { test: /\p{Script=Tamil}/u, eld: "ta", lang: "ta" },
  { test: /\p{Script=Greek}/u, eld: "el", lang: "el" },
  { test: /\p{Script=Han}/u, eld: "zh", lang: "zh" },
] as const;

const LATIN = /\p{Script=Latin}/u;
const ARABIC = /\p{Script=Arabic}/u;

// Romanized Urdu and Hindi words that eld can mistake for English; any one marks the question romanized.
const ROMANIZED_WORDS = new Set([
  "mujhe", "mujhko", "chahiye", "chahie", "nahi", "nahin", "kahan", "kahaan", "kya", "hai", "hain", "mein",
  "liye", "aur", "kaise", "mera", "meri", "hamare", "humein", "madad", "bachon", "bachche", "khana",
]);

function outcome(lang: LangCode | null, confidence: QuestionLanguageConfidence, pageLang: LangCode): QuestionLanguage {
  return { lang, confidence, query_lang: confidence === "confident" && lang ? lang : pageLang };
}

/** Pure: the language a question was written in; results follow it only when confident. */
export function detect(q: string, pageLang: LangCode): QuestionLanguage {
  const letters = q.match(/\p{L}/gu)?.join("") ?? "";
  if (!letters) return outcome(null, "unknown", pageLang);

  const scripts = [LATIN, ARABIC, ...SINGLE_LANGUAGE_SCRIPTS.map((s) => s.test)].filter((t) => t.test(letters));
  const unlisted = letters.replace(/\p{Script=Latin}|\p{Script=Arabic}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Tamil}|\p{Script=Greek}|\p{Script=Han}/gu, "");
  if (scripts.length === 0) return outcome(null, "unknown", pageLang);
  if (scripts.length > 1 || unlisted) return outcome(null, "romanized_or_mixed", pageLang);

  const detected = eld.detect(q);

  if (scripts[0] === LATIN) {
    const lang = LATIN_LANGS[detected.language];
    const words = q.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (lang && detected.isReliable() && !words.some((w) => ROMANIZED_WORDS.has(w))) {
      return outcome(lang, "confident", pageLang);
    }
    return outcome(null, "romanized_or_mixed", pageLang);
  }

  if (scripts[0] === ARABIC) {
    if (PASHTO_LETTERS.test(letters)) return outcome("ps", "confident", pageLang);
    if (URDU_LETTERS.test(letters)) return outcome("ur", "confident", pageLang);
    if (detected.language === "fa" && detected.isReliable()) return outcome("prs", "confident", pageLang);
    return outcome(null, "ambiguous_arabic", pageLang);
  }

  const script = SINGLE_LANGUAGE_SCRIPTS.find((s) => s.test === scripts[0]);
  if (script && detected.language === script.eld) return outcome(script.lang, "confident", pageLang);
  return outcome(null, "unknown", pageLang);
}
