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
//  - the 911 number and every "when to call 911" text can never be missing or blank, in any
//    language: if one is, the whole run is refused (nothing is loaded).
//
// A null translation is not a blank 911: it means "English with translation.unavailable", so
// every language always resolves to a non-empty 911 text. A translation that is present but
// blank is the refusal, and a translation of a 911 text that does not contain "911" is not loaded.
import { createHash } from "node:crypto";
import { LANG_CODES, type LangCode } from "@/contracts/lang";

/** Languages with a translation file: every code except English, the source. */
export const TRANSLATED_LANGS = LANG_CODES.filter((lang) => lang !== "en") as Exclude<LangCode, "en">[];

/** Values starting with this (any case) stand in for an owner or reviewer nobody has named yet. */
export const PLACEHOLDER_PREFIX = "PLACEHOLDER";

export const GUIDE_SECTIONS = ["before", "during", "after"] as const;

// ---------------------------------------------------------------- file shapes (all fields may be missing)
export interface ReviewSource {
  reviewer?: string | null;
  date?: string | null;
}

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

export interface ContentInput {
  guides: GuideSource[];
  numbers: NumbersFile;
  translations: Partial<Record<LangCode, TranslationFile>>;
}

// ---------------------------------------------------------------- text keys and hashes
/** SHA-256 of the English text; scripts/content_catalogue.py computes the same value. */
export function sourceHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const present = (value: string | null | undefined): value is string => typeof value === "string" && value.trim() !== "";

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

// ---------------------------------------------------------------- checks
export function isPlaceholder(value: string | null | undefined): boolean {
  return !present(value) || value.trim().toUpperCase().startsWith(PLACEHOLDER_PREFIX);
}

/** A real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const same = (a: string, b: string) => a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();

interface Attribution {
  owner: string;
  lastUpdated: string;
  englishReviewer: string;
  englishReviewedOn: string;
}

/** The owner, last-updated date and English review of a guide or the numbers list, or why they are refused. */
function checkAttribution(source: {
  owner?: string | null;
  lastUpdated?: string | null;
  englishReview?: ReviewSource | null;
}): { ok: Attribution } | { reasons: string[] } {
  const reasons: string[] = [];
  const owner = source.owner;
  const review = source.englishReview;
  if (!present(owner)) reasons.push("no owner is named");
  else if (isPlaceholder(owner)) reasons.push("the owner is still a placeholder");
  if (!isIsoDate(source.lastUpdated)) reasons.push("no valid last-updated date");
  if (!review || (!present(review.reviewer) && !review.date)) reasons.push("no English review is recorded");
  else {
    if (!present(review.reviewer)) reasons.push("the English review has no reviewer");
    else if (isPlaceholder(review.reviewer)) reasons.push("the English reviewer is still a placeholder");
    else if (present(owner) && !isPlaceholder(owner) && !same(review.reviewer, owner)) {
      reasons.push("the English review was not completed by the owner");
    }
    if (!isIsoDate(review.date)) reasons.push("the English review has no valid date");
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
  | "lost_911";

export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  not_translated: "not translated yet",
  stale: "stale: the English changed since it was translated",
  machine: "machine translation, no review recorded",
  review_incomplete: "marked reviewed without a named reviewer and review date",
  incomplete_record: "translation record is missing its text, model or source hash",
  zh_changed_or_not_reviewed: "converted from a zh text that has changed or is not reviewed",
  lost_911: "does not contain 911",
};

export interface LoadedTranslation {
  text: string;
  provenance: Record<string, unknown>;
}

type Evaluation = { loaded: LoadedTranslation } | { unavailable: UnavailableReason } | { blank: true };

function evaluate(lang: Exclude<LangCode, "en">, key: string, english: string, input: ContentInput): Evaluation {
  const record = input.translations[lang]?.texts[key];
  if (!record) return { unavailable: "not_translated" };
  if (!present(record.text)) return { blank: true };
  if (!present(record.model) || !present(record.sourceHash)) return { unavailable: "incomplete_record" };
  if (record.sourceHash !== sourceHash(english)) return { unavailable: "stale" };
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
    const zh = input.translations.zh?.texts[key];
    if (
      conversion?.from !== "zh" ||
      !present(conversion.fromTextHash) ||
      !present(conversion.openccVersion) ||
      !present(conversion.config)
    ) {
      return { unavailable: "incomplete_record" };
    }
    const zhCurrent =
      zh && present(zh.text) && zh.sourceHash === sourceHash(english) && zh.status === "reviewed" &&
      sourceHash(zh.text) === conversion.fromTextHash;
    if (!zhCurrent) return { unavailable: "zh_changed_or_not_reviewed" };
    provenance.conversion = { ...conversion };
  }
  if (english.includes("911") && !record.text.includes("911")) return { unavailable: "lost_911" };
  return { loaded: { text: record.text, provenance } };
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
}

function planTexts(
  texts: Record<string, string>,
  keyOf: (key: string) => string,
  input: ContentInput,
  report: SeedReport,
  refusals: string[],
): PlannedTexts {
  const planned: PlannedTexts = { texts: {}, translations: {} };
  for (const [key, english] of Object.entries(texts)) {
    planned.texts[key] = { en: english };
    for (const lang of TRANSLATED_LANGS) {
      const result = evaluate(lang, keyOf(key), english, input);
      if ("loaded" in result) {
        planned.texts[key][lang] = result.loaded.text;
        (planned.translations[key] ??= {})[lang] = result.loaded.provenance;
        report.translations.loaded += 1;
      } else if ("blank" in result) {
        if (english.includes("911")) {
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
export function planSeed(input: ContentInput): SeedPlan {
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
  for (const guide of input.guides) {
    const reasons: string[] = [];
    const attribution = checkAttribution(guide);
    if ("reasons" in attribution) reasons.push(...attribution.reasons);
    const sectionsOk = GUIDE_SECTIONS.every((s) => (guide[s] ?? []).length > 0 && (guide[s] ?? []).every(present));
    if (!present(guide.title) || !sectionsOk) reasons.push("the title, or a before, during or after section, is empty");
    if (!Number.isInteger(guide.readMins) || (guide.readMins as number) <= 0) reasons.push("no reading time in minutes");
    if (reasons.length > 0 || "reasons" in attribution) {
      report.guides.push({ id: guide.id, loaded: false, reasons });
      continue;
    }
    const planned = planTexts(guideTexts(guide), (key) => guideKey(guide.id, key), input, report, refusals);
    guides.push({ id: guide.id, readMins: guide.readMins as number, ...attribution.ok, ...planned });
    report.guides.push({ id: guide.id, loaded: true, reasons: [] });
  }

  const numbers: PlannedNumber[] = [];
  const reasons: string[] = [];
  const attribution = checkAttribution(input.numbers);
  if ("reasons" in attribution) reasons.push(...attribution.reasons);
  const seen = new Set<string>();
  for (const number of input.numbers.numbers) {
    if (seen.has(number.id)) reasons.push(`number ${number.id} appears twice`);
    seen.add(number.id);
    if (!present(number.number)) reasons.push(`number ${number.id} has no phone number`);
    if (!present(number.label)) reasons.push(`number ${number.id} has no label`);
    if (!isIsoDate(number.lastChecked)) reasons.push(`number ${number.id} has no valid last-checked date`);
  }
  if (input.numbers.numbers.length === 0) reasons.push("the list has no numbers");
  if (reasons.length === 0 && "ok" in attribution) {
    input.numbers.numbers.forEach((number, index) => {
      const planned = planTexts(numberTexts(number), (key) => numberKey(number.id, key), input, report, refusals);
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
  return { guides, numbers, report, refusals };
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
