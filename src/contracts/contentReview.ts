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
}

export interface TranslationFile {
  language?: string;
  texts: Record<string, TranslationRecord | null | undefined>;
}

/** SHA-256 hex of a UTF-8 string, as scripts/content_catalogue.py computes it. */
export type Hasher = (text: string) => string;

export const present = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

/** A "TODO(owner)" marker (any case, anywhere in the value) also stands in for something nobody has named yet. */
export const TODO_MARKER = /TODO\(/i;

export function isPlaceholder(value: string | null | undefined): boolean {
  return !present(value) || value.trim().toUpperCase().startsWith(PLACEHOLDER_PREFIX) || TODO_MARKER.test(value);
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
  | "lost_required";

export interface LoadedTranslation {
  text: string;
  provenance: Record<string, unknown>;
}

export type Evaluation = { loaded: LoadedTranslation } | { unavailable: UnavailableReason } | { blank: true };

/**
 * Whether one translation may be loaded: reviewed (reviewer and date), current (its source hash is the English's
 * now), complete, and, for zh-Hant, converted from a current, reviewed zh. `required` lists strings that, where the
 * English has them, the translation must keep (for the guides "911", for the terms STOP, 16 and the processors).
 */
export function evaluateTranslation(
  lang: Exclude<LangCode, "en">,
  key: string,
  english: string,
  translations: Partial<Record<LangCode, TranslationFile>>,
  hash: Hasher,
  required: readonly string[] = [],
): Evaluation {
  const record = translations[lang]?.texts[key];
  if (!record) return { unavailable: "not_translated" };
  if (!present(record.text)) return { blank: true };
  if (!present(record.model) || !present(record.sourceHash)) return { unavailable: "incomplete_record" };
  if (record.sourceHash !== hash(english)) return { unavailable: "stale" };
  if (record.status !== "reviewed") return { unavailable: "machine" };
  if (isPlaceholder(record.reviewer) || !isIsoDate(record.reviewedOn)) return { unavailable: "review_incomplete" };

  const provenance: Record<string, unknown> = {
    model: record.model,
    status: "reviewed",
    reviewer: record.reviewer,
    reviewedOn: record.reviewedOn,
    sourceHash: record.sourceHash,
  };
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
    const zhCurrent =
      zh && present(zh.text) && zh.sourceHash === hash(english) && zh.status === "reviewed" &&
      hash(zh.text) === conversion.fromTextHash;
    if (!zhCurrent) return { unavailable: "zh_changed_or_not_reviewed" };
    provenance.conversion = { ...conversion };
  }
  if (required.some((token) => english.includes(token) && !record.text!.includes(token))) {
    return { unavailable: "lost_required" };
  }
  return { loaded: { text: record.text, provenance } };
}
