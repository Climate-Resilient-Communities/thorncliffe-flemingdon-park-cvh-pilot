// The review rules that every offline-translated text shares (S02.09 guides and numbers, S07.01 terms):
// who must have reviewed the English, which translation may be loaded, what counts as a placeholder.
// Pure and browser-safe: the SHA-256 hasher is passed in. The guides keep their own 911 rules in
// src/modules/directory/domain/guideContent.ts; the terms keep theirs in subscriptions/domain/terms.ts.
import { LANG_CODES, type LangCode } from "./lang";

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
  | "facts_changed";

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
}

// ---------------------------------------------------------------- facts a machine translation must keep
// The things a resident needs letter for letter, as scripts/review_translations.py (CRITICAL, missing_critical) and
// scripts/translate_catalogue.py (missing_numbers) check them offline.
const PHONE = /(?:\+?1[-\s])?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/gi;
const POSTAL = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const WEB = /\b(?:https?:\/\/|www\.)[^\s,;)]+|\b[\w-]+\.(?:ca|com|org|net)\b(?:\/[^\s,;)]*)?/gi;
const TIME = /\b\d{1,2}[:.]\d{2}\b/g;
const DIGITS = /\d+/g;

/** Any script's digits as 0-9 (the catalogue keeps Western digits, D-13, but a model may still write others). */
export function toWesternDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, (digit) => {
    const code = digit.codePointAt(0) as number;
    if (code >= 0x30 && code <= 0x39) return digit;
    // A run of decimal digits is made of blocks of ten, each starting at its zero: find the run's start.
    let start = code;
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;
    return String((code - start) % 10);
  });
}

const all = (pattern: RegExp, text: string) => [...text.matchAll(pattern)].map((match) => match[0]);
const digitsOnly = (text: string) => text.replace(/\D/g, "");
const squash = (text: string) => text.toLowerCase().replace(/\s+/g, "");

/**
 * The facts of the English a machine translation lost or changed: a phone number, postal code, email, web address or
 * time that is not in it as written, a group of digits (a number, a price, an address) it does not have, and a group
 * of digits it has that the English does not. An empty list means every fact survived. Contact details and addresses
 * are always shown from the catalogue's own fields; this keeps the description from contradicting them.
 */
export function lostFacts(english: string, translation: string): string[] {
  const text = toWesternDigits(translation);
  const flat = squash(text.replace(/[\u200e\u200f]/g, ""));
  const lost: string[] = [];
  const textDigits = digitsOnly(text);
  for (const phone of all(PHONE, english)) if (!textDigits.includes(digitsOnly(phone))) lost.push(`phone number ${phone}`);
  for (const postal of all(POSTAL, english)) if (!flat.includes(squash(postal))) lost.push(`postal code ${postal}`);
  for (const email of all(EMAIL, english)) {
    const item = email.replace(/\.$/, "");
    if (!flat.includes(squash(item))) lost.push(`email ${item}`);
  }
  for (const web of all(WEB, english)) {
    const item = web.replace(/\.$/, "");
    if (!flat.includes(squash(item))) lost.push(`web address ${item}`);
  }
  const times = new Set(all(TIME, text).map((time) => time.replace(".", ":")));
  for (const time of all(TIME, english)) if (!times.has(time.replace(".", ":"))) lost.push(`time ${time}`);
  const englishGroups = new Set(all(DIGITS, english));
  const textGroups = new Set(all(DIGITS, text));
  for (const group of englishGroups) if (!textGroups.has(group)) lost.push(`number ${group}`);
  for (const group of textGroups) if (!englishGroups.has(group)) lost.push(`number ${group} that the English does not have`);
  return [...new Set(lost)].sort();
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
 * with `status: "machine"` and no reviewer, as long as lostFacts finds nothing (else `facts_changed`); for zh-Hant
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
  if (machine && lostFacts(english, record.text).length > 0) return { unavailable: "facts_changed" };
  return { loaded: { text: record.text, provenance } };
}
