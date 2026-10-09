// The review rules that every offline-translated text shares (S02.09 guides and numbers, S07.01 terms):
// who must have reviewed the English, which translation may be loaded, what counts as a placeholder.
// Pure and browser-safe: the SHA-256 hasher is passed in. The guides keep their own 911 rules in
// src/modules/directory/domain/guideContent.ts; the terms keep theirs in subscriptions/domain/terms.ts.
import { LANG_CODES, type LangCode } from "./lang";
import { lostFacts } from "./translationFacts";

/** Languages with a translation file: every code except English, the source. */
export const TRANSLATED_LANGS = LANG_CODES.filter((lang) => lang !== "en") as Exclude<LangCode, "en">[];

/** Values starting with this (any case) stand in for an owner or reviewer nobody has named yet. */
export const PLACEHOLDER_PREFIX = "PLACEHOLDER";

export interface ReviewSource {
  reviewer?: string | null;
  date?: string | null;
  /** englishReviewHash of the English the owner reviewed (scripts/review_translations.py records it). */
  sourceHash?: string | null;
}

export interface TranslationRecord {
  source?: string;
  sourceHash?: string;
  text?: string | null;
  model?: string;
  status?: "machine" | "reviewed";
  reviewer?: string | null;
  reviewedOn?: string | null;
  translatedOn?: string;
  conversion?: {
    from?: string;
    fromTextHash?: string;
    openccVersion?: string;
    config?: string;
  };
  /**
   * The automated and machine checks a machine translation passed (MACHINE_CHECKS), recorded by the offline scripts.
   * Not evidence of accuracy and not a review: it never makes a text `reviewed`, and nothing loads because of it.
   */
  machineChecks?: string[];
}

/**
 * The checks a machine translation may record in `machineChecks` (AD-11 pilot change): the offline scripts' automated
 * checks (scripts/translate_catalogue.py, review_translations.py), a model's line-by-line reading, a back-translation,
 * and a correction by Claude. None is a person's review; together they are still not evidence of accuracy.
 */
export const MACHINE_CHECKS = ["automated", "line_review", "back_translation", "claude_correction"] as const;
export type MachineCheck = (typeof MACHINE_CHECKS)[number];

export interface TranslationFile {
  language?: string;
  texts: Record<string, TranslationRecord | null | undefined>;
}

/** SHA-256 hex of a UTF-8 string, as scripts/content_catalogue.py computes it. */
export type Hasher = (text: string) => string;

export const present = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

export function isPlaceholder(value: string | null | undefined): boolean {
  return !present(value) || value.trim().toUpperCase().startsWith(PLACEHOLDER_PREFIX);
}

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export const sameText = (a: string, b: string) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * What an English review covers: a hash over the English texts (key and text, in file order).
 * scripts/content_catalogue.py computes the same value.
 */
export function englishReviewHash(texts: Record<string, string>, hash: Hasher): string {
  return hash(JSON.stringify(Object.entries(texts)));
}

export interface Attribution {
  owner: string;
  lastUpdated: string;
  englishReviewer: string;
  englishReviewedOn: string;
}

/** The owner, last-updated date and English review of a text set, or why they are refused. */
export function checkAttribution(
  source: { owner?: string | null; lastUpdated?: string | null; englishReview?: ReviewSource | null },
  expectedHash: string,
  today: string,
): { ok: Attribution } | { reasons: string[] } {
  const reasons: string[] = [];
  const owner = source.owner;
  const review = source.englishReview;
  if (!present(owner)) reasons.push("no owner is named");
  else if (isPlaceholder(owner)) reasons.push("the owner is still a placeholder");
  if (!isIsoDate(source.lastUpdated)) reasons.push("no valid last-updated date");
  else if (source.lastUpdated > today) reasons.push("the last-updated date is in the future");
  if (!review || (!present(review.reviewer) && !review.date)) reasons.push("no English review is recorded");
  else {
    if (!present(review.reviewer)) reasons.push("the English review has no reviewer");
    else if (isPlaceholder(review.reviewer)) reasons.push("the English reviewer is still a placeholder");
    else if (present(owner) && !isPlaceholder(owner) && !sameText(review.reviewer, owner)) {
      reasons.push("the English review was not completed by the owner");
    }
    if (!isIsoDate(review.date)) reasons.push("the English review has no valid date");
    else {
      if (review.date > today) reasons.push("the English review date is in the future");
      if (isIsoDate(source.lastUpdated) && review.date < source.lastUpdated) {
        reasons.push("the English review is dated before the last update");
      }
    }
    if (reasons.length === 0) {
      if (!present(review.sourceHash)) reasons.push("the English review records no source hash (the English it reviewed)");
      else if (review.sourceHash !== expectedHash) reasons.push("the English changed since the owner reviewed it");
    }
  }
  if (reasons.length > 0) return { reasons };
  return {
    ok: {
      owner: owner as string,
      lastUpdated: source.lastUpdated as string,
      englishReviewer: (review as ReviewSource).reviewer as string,
      englishReviewedOn: (review as ReviewSource).date as string,
    },
  };
}

// ---------------------------------------------------------------- translations
export type UnavailableReason =
  | "not_translated"
  | "stale"
  | "machine"
  | "review_incomplete"
  | "incomplete_record"
  | "zh_changed_or_not_reviewed"
  | "lost_required"
  | "facts_changed"
  | "safety_critical";

export interface LoadedTranslation {
  text: string;
  provenance: Record<string, unknown>;
}

export type Evaluation = { loaded: LoadedTranslation } | { unavailable: UnavailableReason } | { blank: true };

export interface EvaluateOptions {
  /**
   * AD-11 pilot change (product owner, 2026-10-03): also load a current machine translation no person has reviewed, as
   * long as every fact of the English survives in it (lostFacts). Its provenance says `status: "machine"`, and it is shown
   * labelled with its English original one tap away. Only the directory's ordinary descriptions (`services`) ask for it.
   */
  allowMachine?: boolean;
  /**
   * The caller found the text safety-critical (decision 42: a provider with an emergency role or in "Support & Emergency
   * Services"): a machine translation of it is refused (`safety_critical`) even with allowMachine. A text whose English
   * names a crisis or emergency line (safetyCriticalTerms) is refused that way whatever the caller says.
   */
  safetyCritical?: boolean;
  /**
   * The product owner's pilot decision of 2026-10-09 (CATALOGUE_PILOT_MACHINE_TRANSLATIONS, src/platform/config/pilotTranslations.ts):
   * with allowMachine, a safety-critical text (`safetyCritical`, or English naming a crisis or emergency line) loads as a machine
   * translation too, instead of being refused `safety_critical`. The facts check (lostFacts) and the `required` strings (911) still apply,
   * and a stale translation still never loads.
   */
  allowSafetyCritical?: boolean;
}

// The facts an unreviewed machine translation must keep: translationFacts.ts.
export { lostFacts, toWesternDigits, weekdays } from "./translationFacts";

// ---------------------------------------------------------------- safety-critical English (crisis and emergency lines)
/**
 * Wording that marks an English text as safety-critical: it names a crisis or emergency line, or tells an emergency line
 * from a non-emergency one. Such a text never ships as an unreviewed machine translation (product owner, 2026-10-03): it
 * shows in English until a person has reviewed its translation. Read on the English source only, so no translation can
 * evade it. Deliberately not matched: "emergency" on its own ("Emergency Energy Fund", "emergency food", "emergency
 * shelter"), "urgent", "mental health" and "violence" (counselling programmes, not lines), and a "housing",
 * "affordability" or "climate" crisis.
 */
const SAFETY_CRITICAL: readonly [string, RegExp][] = [
  ["911", /\b911\b/],
  ["988", /\b988\b/],
  ["crisis", /\b(?<!(?:housing|affordability|climate|cost-of-living)\s)crisis\b/i],
  ["distress", /\bdistress\b/i],
  ["suicide", /\bsuicid\w*/i],
  ["helpline", /\bhelp[\s-]?lines?\b/i],
  ["hotline", /\bhot[\s-]?lines?\b/i],
  ["Kids Help Phone", /\bkids help phone\b/i],
  ["rape", /\brape\b/i],
  ["overdose", /\boverdos\w*/i],
  ["poison", /\bpoison (?:control|centre|center|information)\b/i],
  ["emergency line or department", /\bemergency (?:department|room|line|number)s?\b/i],
  ["non-emergency", /\bnon[\s-]?emergency\b/i],
];

/** Why an English text is safety-critical (the terms SAFETY_CRITICAL finds in it); empty when it is not. */
export function safetyCriticalTerms(english: string): string[] {
  return SAFETY_CRITICAL.filter(([, pattern]) => pattern.test(english)).map(([name]) => name);
}

/** The machine checks a record lists that are known (MACHINE_CHECKS), in that order; undefined when it lists none. */
function machineChecksOf(record: TranslationRecord): MachineCheck[] | undefined {
  if (!Array.isArray(record.machineChecks)) return undefined;
  const known = MACHINE_CHECKS.filter((check) => record.machineChecks!.includes(check));
  return known.length > 0 ? known : undefined;
}

/**
 * Whether one translation may be loaded: reviewed (reviewer and date), current (its source hash is the English's
 * now), complete, and, for zh-Hant, converted from a current, reviewed zh. `required` lists strings that, where the
 * English has them, the translation must keep (for the guides "911", for the terms STOP, 16 and the processors).
 *
 * With `allowMachine` (AD-11 pilot change) a current, complete machine translation no person has reviewed loads too,
 * with `status: "machine"` and no reviewer, unless its English is safety-critical (safetyCriticalTerms: a crisis or
 * emergency line; `safety_critical`, lifted by `allowSafetyCritical`, the pilot decision of 2026-10-09) or lostFacts finds
 * something (`facts_changed`, never lifted); for zh-Hant
 * the zh it was converted from may then be a machine translation as well. A record marked reviewed is held to the
 * review rules either way: a machine translation never passes as reviewed, whatever `machineChecks` it lists.
 */
export function evaluateTranslation(
  lang: Exclude<LangCode, "en">,
  key: string,
  english: string,
  translations: Partial<Record<LangCode, TranslationFile>>,
  hash: Hasher,
  required: readonly string[] = [],
  options: EvaluateOptions = {},
): Evaluation {
  const record = translations[lang]?.texts[key];
  if (!record) return { unavailable: "not_translated" };
  if (!present(record.text)) return { blank: true };
  if (!present(record.model) || !present(record.sourceHash)) return { unavailable: "incomplete_record" };
  if (record.sourceHash !== hash(english)) return { unavailable: "stale" };
  const machine = record.status !== "reviewed";
  if (machine && !options.allowMachine) return { unavailable: "machine" };
  if (!machine && (isPlaceholder(record.reviewer) || !isIsoDate(record.reviewedOn))) return { unavailable: "review_incomplete" };
  // Crisis and emergency lines keep human review, whatever the translation says (decided on the English).
  if (machine && !options.allowSafetyCritical && (options.safetyCritical || safetyCriticalTerms(english).length > 0)) {
    return { unavailable: "safety_critical" };
  }

  const provenance: Record<string, unknown> = machine
    ? { model: record.model, status: "machine", sourceHash: record.sourceHash }
    : {
        model: record.model,
        status: "reviewed",
        reviewer: record.reviewer,
        reviewedOn: record.reviewedOn,
        sourceHash: record.sourceHash,
      };
  const checks = machine ? machineChecksOf(record) : undefined;
  if (checks) provenance.machineChecks = checks;
  if (lang === "zh-Hant") {
    const conversion = record.conversion;
    const zh = translations.zh?.texts[key];
    if (
      conversion?.from !== "zh" ||
      !present(conversion.fromTextHash) ||
      !present(conversion.openccVersion) ||
      !present(conversion.config)
    ) {
      return { unavailable: "incomplete_record" };
    }
    // A reviewed conversion needs a reviewed zh; a machine one (allowed above) may come from a machine zh.
    const zhCurrent =
      zh && present(zh.text) && zh.sourceHash === hash(english) && (zh.status === "reviewed" || machine) &&
      hash(zh.text) === conversion.fromTextHash;
    if (!zhCurrent) return { unavailable: "zh_changed_or_not_reviewed" };
    provenance.conversion = { ...conversion };
  }
  if (required.some((token) => english.includes(token) && !record.text!.includes(token))) {
    return { unavailable: "lost_required" };
  }
  if (machine && lostFacts(english, record.text, lang).length > 0) return { unavailable: "facts_changed" };
  return { loaded: { text: record.text, provenance } };
}
