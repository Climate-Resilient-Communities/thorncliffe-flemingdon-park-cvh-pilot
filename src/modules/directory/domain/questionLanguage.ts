// eld/medium is ESM-only. Never call eld's global setters (setLanguageSubset, dynamicLangSubset): they are shared state.
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
// ھ and ہ are Urdu markers too: Dari and Pashto do not use them (owner decision 2026-10-02).
const URDU_LETTERS = /[ٹڈڑںےھہ]/u;

const LATIN_LANGS = ["en", "es", "fr", "tl", "sk"] as const satisfies readonly LangCode[];

/**
 * How far the best Latin launch language must score above the runner-up (eld scores run 0 to 1) before a
 * short question is trusted when it is neither English nor the page language. The smallest correct gap in
 * the fixtures is "médico" (es 0.775, fr 0.671, gap 0.104) and the next ("comida", 0.158) is larger; the
 * near ties that must not be trusted ("doctor", "dentist", "free wifi", gaps under 0.06) fall to the page language.
 */
export const LATIN_LEAD_MARGIN = 0.1;

// Scripts that stand for exactly one launch language, so the script alone makes it confident.
// Han is only reached without kana; kana makes the question mixed (it is Japanese, not Chinese).
const SINGLE_LANGUAGE_SCRIPTS = [
  { test: /\p{Script=Bengali}/u, lang: "bn" },
  { test: /\p{Script=Gurmukhi}/u, lang: "pa" },
  { test: /\p{Script=Gujarati}/u, lang: "gu" },
  { test: /\p{Script=Tamil}/u, lang: "ta" },
  { test: /\p{Script=Greek}/u, lang: "el" },
  { test: /\p{Script=Han}/u, lang: "zh" },
] as const;

// Devanagari also writes Marathi, Nepali and others, so eld must agree before it is Hindi.
const DEVANAGARI = /\p{Script=Devanagari}/u;

const LATIN = /\p{Script=Latin}/u;
const ARABIC = /\p{Script=Arabic}/u;

// Romanized South Asian words eld can mistake for English. Any one of these marks the question romanized.
const ROMANIZED_WORDS = new Set([
  "mujhe", "mujhko", "chahiye", "chahie", "nahi", "nahin", "kahan", "kahaan", "kya", "hain", "liye", "aur",
  "kaise", "mera", "meri", "hamare", "humein", "madad", "bachon", "bachche", "khana",
  "kithe", "kidhar", "milda", "milega", "chahida", "chahidi", "mainu", "sanu", "tusi", "dorkar", "joiye",
  "venum", "bhai", "yaar", "ami",
]);

// Words that are also ordinary in a launch language ("chow mein", Tagalog "hai"): one alone is not evidence
// when eld is reliable, so they count only with a second marker or when eld is unreliable.
const AMBIGUOUS_ROMANIZED_WORDS = new Set(["hai", "mein"]);

function outcome(lang: LangCode | null, confidence: QuestionLanguageConfidence, pageLang: LangCode): QuestionLanguage {
  if (confidence !== "confident" || !lang) return { lang: null, confidence, query_lang: pageLang };
  return { lang, confidence, query_lang: lang === "zh" && pageLang === "zh-Hant" ? "zh-Hant" : lang };
}

type LatinLang = (typeof LATIN_LANGS)[number];

/** The Latin launch language a marker-free question is written in, or null when it cannot be told apart. */
function latinLanguage(detected: ReturnType<typeof eld.detect>, pageLang: LangCode): LatinLang | null {
  const scores = detected.getScores();
  const ranked = LATIN_LANGS.map((lang) => ({ lang, score: scores[lang] ?? 0 })).sort((a, b) => b.score - a.score);
  const [best, runnerUp] = ranked;
  if (best.score === 0) return null;
  const leads = best.score - runnerUp.score >= LATIN_LEAD_MARGIN;
  const reliableTop = detected.isReliable() && LATIN_LANGS.find((l) => l === detected.language);
  if (reliableTop) {
    const top = ranked.find((r) => r.lang === reliableTop)!;
    const others = ranked.filter((r) => r.lang !== top.lang);
    return top.lang === "en" || top.lang === pageLang || top.score - others[0].score >= LATIN_LEAD_MARGIN ? top.lang : null;
  }
  if (best.lang === pageLang || leads) return best.lang;
  // A near tie that includes the page language goes to the page language.
  const page = ranked.find((r) => r.lang === pageLang);
  return page && best.score - page.score < LATIN_LEAD_MARGIN ? page.lang : null;
}

type NativeScript = typeof DEVANAGARI | typeof ARABIC | (typeof SINGLE_LANGUAGE_SCRIPTS)[number]["test"];

/** The launch language a text in one non-Latin script is written in, or null when it is not confident. */
function nativeLanguage(text: string, script: NativeScript): LangCode | null {
  if (script === DEVANAGARI) return eld.detect(text).language === "hi" ? "hi" : null;
  const single = SINGLE_LANGUAGE_SCRIPTS.find((s) => s.test === script);
  if (single) return single.lang;
  // Arabic script.
  const letters = text.match(/\p{L}/gu)?.join("") ?? "";
  if (PASHTO_LETTERS.test(letters)) {
    // AD-10: Urdu letters must be absent from Pashto, so both together cannot be told.
    return URDU_LETTERS.test(letters) ? null : "ps";
  }
  if (URDU_LETTERS.test(letters)) return "ur";
  const detected = eld.detect(text);
  return detected.language === "fa" && detected.isReliable() ? "prs" : null;
}

/** Pure: the language a question was written in; results follow it only when confident. */
export function detect(q: string, pageLang: LangCode): QuestionLanguage {
  const letters = q.match(/\p{L}/gu)?.join("") ?? "";
  if (!letters) return outcome(null, "unknown", pageLang);

  const scripts = [LATIN, ARABIC, DEVANAGARI, ...SINGLE_LANGUAGE_SCRIPTS.map((s) => s.test)].filter((t) => t.test(letters));
  const unlisted = letters.replace(/\p{Script=Latin}|\p{Script=Arabic}|\p{Script=Devanagari}|\p{Script=Bengali}|\p{Script=Gurmukhi}|\p{Script=Gujarati}|\p{Script=Tamil}|\p{Script=Greek}|\p{Script=Han}/gu, "");
  if (scripts.length === 0) return outcome(null, "unknown", pageLang);
  if (unlisted) return outcome(null, "romanized_or_mixed", pageLang);

  // Native script mixed with Latin words: judge the native part alone (owner decision 2026-10-02).
  // Two or more non-Latin scripts stay mixed.
  const native = scripts.filter((t) => t !== LATIN);
  if (scripts.includes(LATIN) && native.length > 0) {
    if (native.length > 1) return outcome(null, "romanized_or_mixed", pageLang);
    const lang = nativeLanguage(q.replace(/\p{Script=Latin}/gu, " "), native[0] as NativeScript);
    return lang ? outcome(lang, "confident", pageLang) : outcome(null, "romanized_or_mixed", pageLang);
  }
  if (scripts.length > 1) return outcome(null, "romanized_or_mixed", pageLang);

  if (scripts[0] !== LATIN) {
    const lang = nativeLanguage(q, scripts[0] as NativeScript);
    if (lang) return outcome(lang, "confident", pageLang);
    return outcome(null, scripts[0] === DEVANAGARI ? "unknown" : "ambiguous_arabic", pageLang);
  }

  // Latin script.
  const detected = eld.detect(q);
  const words = q.toLowerCase().match(/\p{L}+/gu) ?? [];
  const strong = words.filter((w) => ROMANIZED_WORDS.has(w)).length;
  const weak = words.filter((w) => AMBIGUOUS_ROMANIZED_WORDS.has(w)).length;
  if (strong > 0 || weak >= 2 || (weak === 1 && !detected.isReliable())) {
    return outcome(null, "romanized_or_mixed", pageLang);
  }
  const lang = latinLanguage(detected, pageLang);
  return lang ? outcome(lang, "confident", pageLang) : outcome(null, "romanized_or_mixed", pageLang);
}
