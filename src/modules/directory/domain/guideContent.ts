// The rules of the guides and essential numbers seed (S02.09): what may be loaded
// from data/catalogue/{guides,numbers}.json and translations/content/<lang>.json.
// Pure: it reads nothing and writes nothing; application/seedGuides.ts does the upsert.
//
// Rules (story S02.09):
//  - a guide needs a named owner, a last-updated date and an English review (reviewer and
//    date) by that owner, else that guide is refused; the numbers list needs the same, and
//    every number needs a last-checked date, else the whole list is refused;
//  - a translation is loaded only when it is `reviewed` (reviewer and date) and current, i.e.
//    its source hash matches the English now; any other text shows in English with
//    translation.unavailable and the report says why;
//  - the 911 number and every "when to call 911" text (the 911 keys, see is911Key) can never be
//    missing or blank, in any language: if one is, the whole run is refused (nothing is loaded);
//  - the English review is tied to the English it reviewed (a hash of the English texts) and
//    cannot be older than the last update or dated in the future, else it is refused.
//
// A null translation is not a blank 911: it means "English with translation.unavailable", so
// every language always resolves to a non-empty 911 text. A translation that is present but
// blank is the refusal, and a translation of a text with "911" in it that lost "911" is not loaded.
//
// Pure and browser-safe: the SHA-256 hasher and today's date are passed in (PlanOptions).
import type { LangCode } from "@/contracts/lang";
import {
  PLACEHOLDER_PREFIX,
  TRANSLATED_LANGS,
  checkAttribution,
  englishReviewHash,
  evaluateTranslation,
  isIsoDate,
  isPlaceholder,
  present,
  type Attribution,
  type LoadedTranslation,
  type Hasher,
  type ReviewSource,
  type TranslationFile,
  type TranslationRecord,
  type UnavailableReason as SharedUnavailableReason,
} from "@/contracts/contentReview";

// The review rules shared with the terms (S07.01) live in src/contracts/contentReview.ts.
export {
  PLACEHOLDER_PREFIX,
  TRANSLATED_LANGS,
  englishReviewHash,
  isIsoDate,
  isPlaceholder,
  type Hasher,
  type LoadedTranslation,
  type ReviewSource,
  type TranslationFile,
  type TranslationRecord,
};

export const GUIDE_SECTIONS = ["before", "during", "after"] as const;

// ---------------------------------------------------------------- file shapes (all fields may be missing)
export interface GuideSource {
  id: string;
  owner?: string | null;
  lastUpdated?: string | null;
  englishReview?: ReviewSource | null;
  readMins?: number | null;
  title?: string | null;
  when911?: string | null;
  before?: (string | null)[] | null;
  during?: (string | null)[] | null;
  after?: (string | null)[] | null;
}

export interface NumberSource {
  id: string;
  number?: string | null;
  emergency?: boolean | null;
  label?: string | null;
  when?: string | null;
  lastChecked?: string | null;
}

export interface NumbersFile {
  owner?: string | null;
  lastUpdated?: string | null;
  englishReview?: ReviewSource | null;
  numbers: NumberSource[];
}

export interface ContentInput {
  guides: GuideSource[];
  numbers: NumbersFile;
  translations: Partial<Record<LangCode, TranslationFile>>;
}

// ---------------------------------------------------------------- text keys and hashes
export interface PlanOptions {
  hash: Hasher;
  /** Today as YYYY-MM-DD; no date in the files may be later. */
  today: string;
}

/** Text keys of a guide, relative to the guide: title, when911, before.0 ... after.n. */
export function guideTexts(guide: GuideSource): Record<string, string> {
  const texts: Record<string, string> = {};
  if (present(guide.title)) texts.title = guide.title;
  if (present(guide.when911)) texts.when911 = guide.when911;
  for (const section of GUIDE_SECTIONS) {
    (guide[section] ?? []).forEach((line, index) => {
      if (present(line)) texts[`${section}.${index}`] = line;
    });
  }
  return texts;
}

/** Text keys of a number, relative to the number: label and, for 911, when. */
export function numberTexts(number: NumberSource): Record<string, string> {
  const texts: Record<string, string> = {};
  if (present(number.label)) texts.label = number.label;
  if (present(number.when)) texts.when = number.when;
  return texts;
}

/** The key a text has in the translation files (scripts/content_catalogue.py builds the same keys). */
export const guideKey = (id: string, key: string) => `guide.${id}.${key}`;
export const numberKey = (id: string, key: string) => `number.${id}.${key}`;

/** Every text of the guides and numbers with its translation-file key, in file order. */
export function contentTexts(input: Pick<ContentInput, "guides" | "numbers">): Record<string, string> {
  const texts: Record<string, string> = {};
  for (const guide of input.guides) {
    for (const [key, english] of Object.entries(guideTexts(guide))) texts[guideKey(guide.id, key)] = english;
  }
  for (const number of input.numbers.numbers) {
    for (const [key, english] of Object.entries(numberTexts(number))) texts[numberKey(number.id, key)] = english;
  }
  return texts;
}

/** The 911 texts, by key: the 911 number's own texts and every guide's "when to call 911". */
export function is911Key(key: string): boolean {
  return key.startsWith("number.911.") || (key.startsWith("guide.") && key.endsWith(".when911"));
}

// ---------------------------------------------------------------- checks
// ---------------------------------------------------------------- translations
export type UnavailableReason = Exclude<SharedUnavailableReason, "lost_required"> | "lost_911";

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  not_translated: "not translated yet",
  stale: "stale: the English changed since it was translated",
  machine: "machine translation, no review recorded",
  review_incomplete: "marked reviewed without a named reviewer and review date",
  incomplete_record: "translation record is missing its text, model or source hash",
  zh_changed_or_not_reviewed: "converted from a zh text that has changed or is not reviewed",
  lost_911: "does not contain 911",
};

type GuideEvaluation = { loaded: LoadedTranslation } | { unavailable: UnavailableReason } | { blank: true };

function evaluate(lang: Exclude<LangCode, "en">, key: string, english: string, input: ContentInput, hash: Hasher): GuideEvaluation {
  const result = evaluateTranslation(lang, key, english, input.translations, hash, ["911"]);
  if ("unavailable" in result && result.unavailable === "lost_required") return { unavailable: "lost_911" };
  return result as GuideEvaluation;
}

// ---------------------------------------------------------------- the plan
export interface PlannedTexts {
  texts: Record<string, Record<string, string>>;
  translations: Record<string, Record<string, Record<string, unknown>>>;
}

export interface PlannedGuide extends PlannedTexts, Attribution {
  id: string;
  readMins: number;
}

export interface PlannedNumber extends PlannedTexts, Attribution {
  id: string;
  sortOrder: number;
  number: string;
  emergency: boolean;
  lastChecked: string;
}

export interface UnavailableText {
  key: string;
  lang: Exclude<LangCode, "en">;
  reason: UnavailableReason;
}

export interface SeedReport {
  guides: { id: string; loaded: boolean; reasons: string[] }[];
  numbers: { loaded: boolean; reasons: string[] };
  translations: { loaded: number; unavailable: UnavailableText[] };
}

export interface SeedPlan {
  guides: PlannedGuide[];
  numbers: PlannedNumber[];
  report: SeedReport;
  /** Reasons the whole run is refused (911 rules); when non-empty nothing may be loaded. */
  refusals: string[];
  /** Every guide id in guides.json, refused or not: a guide row not in this list was removed from the file. */
  fileGuideIds: string[];
}

function planTexts(
  texts: Record<string, string>,
  keyOf: (key: string) => string,
  input: ContentInput,
  report: SeedReport,
  refusals: string[],
  hash: Hasher,
): PlannedTexts {
  const planned: PlannedTexts = { texts: {}, translations: {} };
  for (const [key, english] of Object.entries(texts)) {
    planned.texts[key] = { en: english };
    for (const lang of TRANSLATED_LANGS) {
      const result = evaluate(lang, keyOf(key), english, input, hash);
      if ("loaded" in result) {
        planned.texts[key][lang] = result.loaded.text;
        (planned.translations[key] ??= {})[lang] = result.loaded.provenance;
        report.translations.loaded += 1;
      } else if ("blank" in result) {
        if (is911Key(keyOf(key))) {
          refusals.push(`${keyOf(key)} is blank in ${lang}: a 911 text can never be empty in any language`);
        }
        report.translations.unavailable.push({ key: keyOf(key), lang, reason: "incomplete_record" });
      } else {
        report.translations.unavailable.push({ key: keyOf(key), lang, reason: result.unavailable });
      }
    }
  }
  return planned;
}

/** What the seed may load from the files, and why the rest is refused or shown in English. */
export function planSeed(input: ContentInput, { hash, today }: PlanOptions): SeedPlan {
  const report: SeedReport = {
    guides: [],
    numbers: { loaded: false, reasons: [] },
    translations: { loaded: 0, unavailable: [] },
  };
  const refusals: string[] = [];

  // 911 rules first: they refuse the run, whatever else is valid.
  const emergency = input.numbers.numbers.find((n) => n.id === "911");
  if (!emergency) refusals.push("numbers.json has no 911 number");
  else {
    if (emergency.number !== "911") refusals.push(`the 911 number is "${emergency.number ?? ""}", not 911`);
    if (emergency.emergency !== true) refusals.push("the 911 number is not marked as the emergency number");
    for (const field of ["label", "when"] as const) {
      if (!present(emergency[field])) refusals.push(`number.911.${field} (the 911 text) is empty in English`);
    }
  }
  for (const guide of input.guides) {
    if (!present(guide.when911)) refusals.push(`guide.${guide.id}.when911 ("when to call 911") is empty in English`);
  }

  const guides: PlannedGuide[] = [];
  const idCount = new Map<string, number>();
  for (const guide of input.guides) idCount.set(guide.id, (idCount.get(guide.id) ?? 0) + 1);
  for (const guide of input.guides) {
    const reasons: string[] = [];
    if ((idCount.get(guide.id) ?? 0) > 1) reasons.push(`guide ${guide.id} appears twice`);
    const texts = guideTexts(guide);
    const reviewed = Object.fromEntries(Object.entries(texts).map(([key, english]) => [guideKey(guide.id, key), english]));
    const attribution = checkAttribution(guide, englishReviewHash(reviewed, hash), today);
    if ("reasons" in attribution) reasons.push(...attribution.reasons);
    const sectionsOk = GUIDE_SECTIONS.every((s) => (guide[s] ?? []).length > 0 && (guide[s] ?? []).every(present));
    if (!present(guide.title) || !sectionsOk) reasons.push("the title, or a before, during or after section, is empty");
    if (!Number.isInteger(guide.readMins) || (guide.readMins as number) <= 0) reasons.push("no reading time in minutes");
    if (reasons.length > 0 || "reasons" in attribution) {
      report.guides.push({ id: guide.id, loaded: false, reasons });
      continue;
    }
    const planned = planTexts(texts, (key) => guideKey(guide.id, key), input, report, refusals, hash);
    guides.push({ id: guide.id, readMins: guide.readMins as number, ...attribution.ok, ...planned });
    report.guides.push({ id: guide.id, loaded: true, reasons: [] });
  }

  const numbers: PlannedNumber[] = [];
  const reasons: string[] = [];
  const numbersReviewed: Record<string, string> = {};
  for (const number of input.numbers.numbers) {
    for (const [key, english] of Object.entries(numberTexts(number))) numbersReviewed[numberKey(number.id, key)] = english;
  }
  const attribution = checkAttribution(input.numbers, englishReviewHash(numbersReviewed, hash), today);
  if ("reasons" in attribution) reasons.push(...attribution.reasons);
  const seen = new Set<string>();
  for (const number of input.numbers.numbers) {
    if (seen.has(number.id)) reasons.push(`number ${number.id} appears twice`);
    seen.add(number.id);
    if (!present(number.number)) reasons.push(`number ${number.id} has no phone number`);
    if (!present(number.label)) reasons.push(`number ${number.id} has no label`);
    if (!isIsoDate(number.lastChecked)) reasons.push(`number ${number.id} has no valid last-checked date`);
    else if (number.lastChecked > today) reasons.push(`number ${number.id} has a last-checked date in the future`);
  }
  if (input.numbers.numbers.length === 0) reasons.push("the list has no numbers");
  if (reasons.length === 0 && "ok" in attribution) {
    input.numbers.numbers.forEach((number, index) => {
      const planned = planTexts(numberTexts(number), (key) => numberKey(number.id, key), input, report, refusals, hash);
      numbers.push({
        id: number.id,
        sortOrder: index,
        number: number.number as string,
        emergency: number.emergency === true,
        lastChecked: number.lastChecked as string,
        ...attribution.ok,
        ...planned,
      });
    });
    report.numbers = { loaded: true, reasons: [] };
  } else {
    report.numbers = { loaded: false, reasons };
  }
  return { guides, numbers, report, refusals, fileGuideIds: input.guides.map((g) => g.id) };
}

/** The report as lines for the terminal and the CI log. */
export function formatSeedReport(report: SeedReport): string[] {
  const lines: string[] = [];
  const loaded = report.guides.filter((g) => g.loaded);
  lines.push(`Guides loaded: ${loaded.length} of ${report.guides.length}${loaded.length ? ` (${loaded.map((g) => g.id).join(", ")})` : ""}`);
  for (const guide of report.guides.filter((g) => !g.loaded)) {
    lines.push(`  REFUSED guide ${guide.id}: ${guide.reasons.join("; ")}`);
  }
  if (report.numbers.loaded) lines.push("Essential numbers loaded");
  else lines.push(`  REFUSED essential numbers: ${report.numbers.reasons.join("; ")}`);

  lines.push(`Translations loaded: ${report.translations.loaded}`);
  const notYet = report.translations.unavailable.filter((u) => u.reason === "not_translated");
  const others = report.translations.unavailable.filter((u) => u.reason !== "not_translated");
  const perLang = new Map<string, number>();
  for (const u of notYet) perLang.set(u.lang, (perLang.get(u.lang) ?? 0) + 1);
  if (notYet.length > 0) {
    lines.push(
      `Not translated yet (English with translation.unavailable): ${notYet.length} (${[...perLang].map(([l, n]) => `${l} ${n}`).join(", ")})`,
    );
  }
  if (others.length > 0) {
    lines.push(`Not loaded, shown in English with translation.unavailable: ${others.length}`);
    for (const u of others) lines.push(`  ${u.lang} ${u.key}: ${UNAVAILABLE_TEXT[u.reason]}`);
  }
  return lines;
}

// ---------------------------------------------------------------- the launch check
export interface LaunchGap {
  key: string;
  lang: Exclude<LangCode, "en">;
  reason: UnavailableReason;
}

/**
 * Every launch language x 911 key (`number.911.*`, `guide.*.when911`) that has no current,
 * reviewed translation. The seed still loads such a text in English with translation.unavailable
 * (owner decision 2026-10-02); launch is not ready until this list is empty.
 */
export function launchGaps(input: ContentInput, { hash }: Pick<PlanOptions, "hash">): LaunchGap[] {
  const gaps: LaunchGap[] = [];
  for (const [key, english] of Object.entries(contentTexts(input))) {
    if (!is911Key(key)) continue;
    for (const lang of TRANSLATED_LANGS) {
      const result = evaluate(lang, key, english, input, hash);
      if ("loaded" in result) continue;
      gaps.push({ key, lang, reason: "blank" in result ? "incomplete_record" : result.unavailable });
    }
  }
  return gaps;
}

/** The launch gaps as lines for the terminal; one line saying so when launch-ready. */
export function formatLaunchGaps(gaps: LaunchGap[]): string[] {
  if (gaps.length === 0) return ["Launch check passed: every launch language has a reviewed, current 911 translation"];
  return [
    `Launch check FAILED: ${gaps.length} 911 text(s) without a reviewed, current translation (shown in English with translation.unavailable)`,
    ...gaps.map((g) => `  ${g.lang} ${g.key}: ${UNAVAILABLE_TEXT[g.reason]}`),
  ];
}
