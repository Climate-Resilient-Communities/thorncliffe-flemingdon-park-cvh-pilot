// The rules of the provider catalogue seed (S02.04): what may be loaded from
// data/catalogue/providers.json and translations/{lang}.json. Pure: it reads nothing and writes
// nothing; application/seedProviders.ts does the upsert.
//
// Rules (story S02.04, AD-11, AD-25):
//  - the file is checked as a whole against a zod schema before anything is loaded: a provider
//    with no `id`, an `id` used twice, coordinates outside Toronto, a category that is not in
//    `labels.categories` (and the other required fields) make the whole run refuse, and the
//    report lists every failing entry, not just the first;
//  - the English text, the contact details, the address and the categories come only from
//    providers.json; the translations that sit inside it are a copy made by
//    scripts/build_catalogue.py and are ignored. The seed reads translations/{lang}.json;
//  - a translation is loaded only when it is `reviewed` (reviewer and date), current (its
//    `source` is the English now) and complete, as for the guides (S02.09,
//    src/contracts/contentReview.ts); any other text shows in English with
//    translation.unavailable, and the report says how many and why;
//  - pilot change to AD-11 (product owner, 2026-10-03): a provider's ordinary description (`services`)
//    also loads when it is a current machine translation no person has reviewed, in every language
//    (Pashto included), as long as every phone number, postal code, email, web address, time and number
//    of the English is in it unchanged (lostFacts; else `facts_changed`, shown in English), and the English
//    names no crisis or emergency line (safetyCriticalTerms; else `safety_critical`, shown in English until a
//    person reviews it: product owner, 2026-10-03). Its provenance
//    says `status: "machine"` and never names a reviewer; the release ships it labelled "Machine-translated;
//    not reviewed by a person". `machineChecks` on a record is carried along but is not a review and
//    decides nothing. The emergency role, category and subcategory names stay reviewed-only;
//  - `lastConfirmed` in providers.json is ignored: the Hub's Admins own that date (and whether a
//    provider is published) in the database, so a re-run never changes either.
//
// zh-Hant is not read from the translation files: the directory release (S02.05) converts the
// reviewed zh text with OpenCC.
import { z } from "zod";
import type { LangCode } from "@/contracts/lang";
import {
  TRANSLATED_LANGS,
  evaluateTranslation,
  present,
  type Hasher,
  type TranslationFile,
  type TranslationRecord,
  type UnavailableReason,
} from "@/contracts/contentReview";
import { TORONTO_BOUNDS } from "@/contracts/torontoBounds";

/** The languages the provider translation files cover: every launch language but English and zh-Hant. */
export const PROVIDER_LANGS = TRANSLATED_LANGS.filter((lang) => lang !== "zh-Hant") as Exclude<LangCode, "en" | "zh-Hant">[];

/** A catalogue provider id: a letter and 3 to 6 digits (M001), the shape the audit trail accepts as a subject id. */
export const PROVIDER_ID = /^[A-Z][0-9]{3,6}$/;

// ---------------------------------------------------------------- file shapes
/** A record of translations/{lang}.json: scripts/translate_catalogue.py's, plus the review fields scripts/review_translations.py records. */
export interface ProviderTranslationRecord {
  source?: string;
  text?: string | null;
  model?: string;
  status?: "machine" | "reviewed";
  reviewer?: string | null;
  reviewedOn?: string | null;
  /** The machine checks it passed (MACHINE_CHECKS in contentReview.ts): not evidence of accuracy, never a review. */
  machineChecks?: string[];
}

export interface ProviderTranslationFile {
  language?: string;
  texts: Record<string, ProviderTranslationRecord | null | undefined>;
}

export interface ProviderCatalogueInput {
  /** providers.json, parsed but not checked. */
  catalogue: unknown;
  translations: Partial<Record<LangCode, ProviderTranslationFile>>;
}

// ---------------------------------------------------------------- the schema
// Every message below is shown after the field's path ("location.lat: is outside Toronto ...").
const text = () => z.string({ error: "is missing" }).refine((value) => present(value), { error: "is empty" });

const stringList = () => z.array(z.string({ error: "must be text" }), { error: "must be a list" });

const coordinate = (min: number, max: number) =>
  z
    .number({ error: "is missing or not a number" })
    .refine((value) => Number.isFinite(value), { error: "is not a number" })
    .refine((value) => value >= min && value <= max, { error: `is outside Toronto (${min} to ${max})` });

const localized = () => z.looseObject({ en: text() }, { error: "is missing" });

/** One provider of providers.json. Checks only the entry itself; the file-wide rules (duplicate ids, categories) are in planProviderCatalogue. */
export const providerEntrySchema = z.looseObject(
  {
    id: z.string({ error: "is missing" }).refine((value) => PROVIDER_ID.test(value), { error: "must be a letter and 3 to 6 digits, like M001" }),
    name: text(),
    categories: z.array(text(), { error: "must be a list" }).min(1, { error: "has no category" }),
    subcategories: z.array(text(), { error: "must be a list" }),
    address: z.looseObject(
      {
        street: text(),
        city: text(),
        postal: z.string({ error: "must be text or null" }).nullish(),
      },
      { error: "is missing" },
    ),
    location: z.looseObject(
      {
        lat: coordinate(TORONTO_BOUNDS.minLat, TORONTO_BOUNDS.maxLat),
        lng: coordinate(TORONTO_BOUNDS.minLng, TORONTO_BOUNDS.maxLng),
      },
      { error: "(the coordinates) is missing" },
    ),
    contact: z.looseObject(
      {
        phone: stringList().default([]),
        email: stringList().default([]),
        social: stringList().default([]),
        web: stringList().default([]),
      },
      { error: "is missing" },
    ),
    services: localized(),
    emergencyRole: localized().nullish(),
    sourceNotes: stringList().default([]),
  },
  { error: "is not an object" },
);

const labelSchema = z.looseObject({ id: text(), en: text() }, { error: "is not a label" });

const labelsSchema = z.looseObject(
  {
    categories: z.record(z.string(), labelSchema, { error: "is missing" }),
    subcategories: z.record(z.string(), labelSchema, { error: "is missing" }),
  },
  { error: "is missing" },
);

type ProviderEntry = z.infer<typeof providerEntrySchema>;

// ---------------------------------------------------------------- the plan
export interface PlannedCategory {
  id: string;
  name: string;
  sortOrder: number;
  /** language -> text, English first: the reviewed translations of the name. */
  labels: Record<string, string>;
  translations: Record<string, Record<string, unknown>>;
}

export interface PlannedSubcategory {
  name: string;
  labels: Record<string, string>;
}

export interface PlannedProvider {
  id: string;
  name: string;
  /** Ids of the provider's categories, in the file's order; the provider is stored once. */
  categoryIds: string[];
  subcategories: PlannedSubcategory[];
  location: { street: string; city: string; postal: string | null; lat: number; lng: number };
  contact: { phone: string[]; email: string[]; social: string[]; web: string[] };
  /** text key (`services`, `emergency_role`) -> language -> text. */
  texts: Record<string, Record<string, string>>;
  translations: Record<string, Record<string, Record<string, unknown>>>;
  /**
   * text key -> language -> why that translation was not loaded although the file has one (stale, machine, ...). A language
   * with no translation at all is not here. The directory release reports the stale ones from it (S02.05).
   */
  withheld: Record<string, Record<string, UnavailableReason>>;
  sourceNotes: string[];
}

export interface UnavailableCount {
  lang: Exclude<LangCode, "en">;
  reason: UnavailableReason;
  count: number;
}

export interface LoadedCount {
  lang: Exclude<LangCode, "en">;
  count: number;
}

export interface ProviderSeedReport {
  providers: number;
  categories: number;
  /** Providers each category holds, in label order. */
  perCategory: { name: string; providers: number }[];
  translations: {
    /** Reviewed, current translations loaded. */
    loaded: number;
    /** Unreviewed machine translations of descriptions loaded, shown labelled (AD-11 pilot change), by language. */
    machine: LoadedCount[];
    unavailable: UnavailableCount[];
  };
}

export interface ProviderSeedPlan {
  providers: PlannedProvider[];
  categories: PlannedCategory[];
  /** Every failing entry of the file, in file order. When non-empty nothing may be loaded. */
  failures: string[];
  report: ProviderSeedReport;
}

export interface PlanOptions {
  hash: Hasher;
  /** The id of an English text in the translation files: the first 12 hex digits of its SHA-1 (scripts/build_catalogue.py, text_id). */
  textId: (english: string) => string;
}

const emptyReport = (): ProviderSeedReport => ({ providers: 0, categories: 0, perCategory: [], translations: { loaded: 0, machine: [], unavailable: [] } });

/** The machine translations a report loaded, all languages together. */
export const machineLoaded = (report: ProviderSeedReport): number => report.translations.machine.reduce((sum, item) => sum + item.count, 0);

/** `providers[3] (M004)` or `providers[3]` when the entry has no readable id. */
function entryLabel(index: number, entry: unknown): string {
  const id = typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined;
  return typeof id === "string" && id !== "" ? `providers[${index}] (${id})` : `providers[${index}]`;
}

/** `location.lat: is outside Toronto (43.58 to 43.86)`. */
function describeIssue(issue: z.core.$ZodIssue, prefix = ""): string {
  const where = [prefix, ...issue.path.map(String)].filter(Boolean).join(".");
  return where === "" ? issue.message : `${where}: ${issue.message}`;
}

/** A translation file read as the guides' records are: the English a record translated (`source`) stands in for the source hash, so S02.09's rules apply as they are. */
function adapt(file: ProviderTranslationFile | undefined, hash: Hasher): TranslationFile | undefined {
  if (!file) return undefined;
  const texts: TranslationFile["texts"] = {};
  for (const [id, record] of Object.entries(file.texts ?? {})) {
    if (!record) {
      texts[id] = null;
      continue;
    }
    const adapted: TranslationRecord = { ...record };
    if (typeof record.source === "string" && present(record.source)) adapted.sourceHash = hash(record.source);
    texts[id] = adapted;
  }
  return { ...file, texts };
}

interface LoadedTexts {
  labels: Record<string, string>;
  provenance: Record<string, Record<string, unknown>>;
  /** language -> why a translation that exists was not loaded (never `not_translated`: that is the absence of one). */
  withheld: Record<string, UnavailableReason>;
}

interface Tallies {
  unavailable: Map<string, UnavailableCount>;
  machine: Map<string, LoadedCount>;
}

/**
 * Loads the reviewed, current translations of one English text, and with `allowMachine` (a provider's description, AD-11
 * pilot change) its current machine translations whose facts match the English; counts the ones it cannot load.
 */
function translate(
  english: string,
  translations: Partial<Record<LangCode, TranslationFile>>,
  options: PlanOptions,
  report: ProviderSeedReport,
  tallies: Tallies,
  allowMachine = false,
): LoadedTexts {
  const out: LoadedTexts = { labels: { en: english }, provenance: {}, withheld: {} };
  const key = options.textId(english);
  const { unavailable } = tallies;
  for (const lang of PROVIDER_LANGS) {
    const result = evaluateTranslation(lang, key, english, translations, options.hash, ["911"], { allowMachine });
    if ("loaded" in result) {
      out.labels[lang] = result.loaded.text;
      out.provenance[lang] = result.loaded.provenance;
      if (result.loaded.provenance.status === "machine") {
        const count = tallies.machine.get(lang) ?? { lang, count: 0 };
        count.count += 1;
        tallies.machine.set(lang, count);
      } else {
        report.translations.loaded += 1;
      }
      continue;
    }
    const reason: UnavailableReason = "blank" in result ? "incomplete_record" : result.unavailable;
    if (reason !== "not_translated") out.withheld[lang] = reason;
    const slot = `${lang}:${reason}`;
    const count = unavailable.get(slot) ?? { lang, reason, count: 0 };
    count.count += 1;
    unavailable.set(slot, count);
  }
  return out;
}

/**
 * What the seed may load from the files, or every reason it may not. Nothing is loaded unless
 * `failures` is empty.
 */
export function planProviderCatalogue(input: ProviderCatalogueInput, options: PlanOptions): ProviderSeedPlan {
  const failures: string[] = [];
  const report = emptyReport();
  const root = input.catalogue;
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return { providers: [], categories: [], failures: ["providers.json is not an object with `labels` and `providers`"], report };
  }
  const file = root as { labels?: unknown; providers?: unknown };

  const labels = labelsSchema.safeParse(file.labels);
  if (!labels.success) {
    for (const issue of labels.error.issues) failures.push(describeIssue(issue, "labels"));
  }
  if (!Array.isArray(file.providers)) failures.push("providers: is missing or not a list");
  else if (file.providers.length === 0) failures.push("providers: is empty");
  if (!labels.success || failures.length > 0) return { providers: [], categories: [], failures, report };

  const categoryLabels = labels.data.categories;
  const subcategoryLabels = labels.data.subcategories;
  const seenLabelIds = new Map<string, string>();
  for (const [name, label] of Object.entries(categoryLabels)) {
    const earlier = seenLabelIds.get(label.id);
    if (earlier !== undefined) failures.push(`labels.categories.${name}: id ${label.id} is also the id of "${earlier}"`);
    seenLabelIds.set(label.id, name);
    if (label.en !== name) failures.push(`labels.categories.${name}: the English name "${label.en}" is not the key`);
  }

  const entries = file.providers as unknown[];
  const idPositions = new Map<string, number[]>();
  entries.forEach((entry, index) => {
    const id = typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id !== "") idPositions.set(id, [...(idPositions.get(id) ?? []), index]);
  });

  const valid: ProviderEntry[] = [];
  entries.forEach((raw, index) => {
    const label = entryLabel(index, raw);
    const parsed = providerEntrySchema.safeParse(raw);
    const problems: string[] = [];
    if (!parsed.success) {
      for (const issue of parsed.error.issues) problems.push(describeIssue(issue));
    }
    const id = typeof raw === "object" && raw !== null ? (raw as { id?: unknown }).id : undefined;
    const positions = typeof id === "string" ? (idPositions.get(id) ?? []) : [];
    if (positions.length > 1) problems.push(`id ${id} is used ${positions.length} times (providers[${positions.join("], providers[")}])`);
    // The references are checked on the raw entry too, so one run lists a bad category next to a bad coordinate.
    const raws = (name: "categories" | "subcategories"): string[] => {
      const list = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[name] : undefined;
      return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string" && item !== "") : [];
    };
    const categoryNames = raws("categories");
    for (const category of categoryNames) {
      if (!Object.hasOwn(categoryLabels, category)) problems.push(`category "${category}" is not in labels.categories`);
    }
    for (const subcategory of raws("subcategories")) {
      if (!Object.hasOwn(subcategoryLabels, subcategory)) problems.push(`subcategory "${subcategory}" is not in labels.subcategories`);
    }
    if (new Set(categoryNames).size !== categoryNames.length) problems.push("categories: lists a category twice");
    for (const problem of problems) failures.push(`${label}: ${problem}`);
    if (problems.length === 0 && parsed.success) valid.push(parsed.data);
  });
  if (failures.length > 0) return { providers: [], categories: [], failures, report };

  // Everything checked: now the translations.
  const translations: Partial<Record<LangCode, TranslationFile>> = {};
  for (const lang of PROVIDER_LANGS) {
    const adapted = adapt(input.translations[lang], options.hash);
    if (adapted) translations[lang] = adapted;
  }
  const tallies: Tallies = { unavailable: new Map(), machine: new Map() };
  const translated = (english: string, allowMachine = false) => translate(english, translations, options, report, tallies, allowMachine);

  const categories: PlannedCategory[] = Object.entries(categoryLabels).map(([name, label], sortOrder) => {
    const loaded = translated(label.en);
    return { id: label.id, name, sortOrder, labels: loaded.labels, translations: loaded.provenance };
  });
  const subcategoryCache = new Map<string, PlannedSubcategory>();
  const subcategory = (name: string): PlannedSubcategory => {
    let planned = subcategoryCache.get(name);
    if (!planned) {
      planned = { name, labels: translated(subcategoryLabels[name].en).labels };
      subcategoryCache.set(name, planned);
    }
    return planned;
  };

  const providers: PlannedProvider[] = valid.map((entry) => {
    const texts: PlannedProvider["texts"] = {};
    const provenance: PlannedProvider["translations"] = {};
    const withheld: PlannedProvider["withheld"] = {};
    // The ordinary description may be an unreviewed machine translation (AD-11 pilot change); the emergency role may not.
    const services = translated(entry.services.en, true);
    texts.services = services.labels;
    if (Object.keys(services.provenance).length > 0) provenance.services = services.provenance;
    if (Object.keys(services.withheld).length > 0) withheld.services = services.withheld;
    if (entry.emergencyRole) {
      const role = translated(entry.emergencyRole.en);
      texts.emergency_role = role.labels;
      if (Object.keys(role.provenance).length > 0) provenance.emergency_role = role.provenance;
      if (Object.keys(role.withheld).length > 0) withheld.emergency_role = role.withheld;
    }
    return {
      id: entry.id,
      name: entry.name.trim(),
      categoryIds: entry.categories.map((name) => categoryLabels[name].id),
      subcategories: entry.subcategories.map(subcategory),
      location: {
        street: entry.address.street.trim(),
        city: entry.address.city.trim(),
        postal: present(entry.address.postal) ? entry.address.postal.trim() : null,
        lat: entry.location.lat,
        lng: entry.location.lng,
      },
      contact: { phone: entry.contact.phone, email: entry.contact.email, social: entry.contact.social, web: entry.contact.web },
      texts,
      translations: provenance,
      withheld,
      sourceNotes: entry.sourceNotes,
    };
  });

  report.providers = providers.length;
  report.categories = categories.length;
  report.perCategory = categories.map((category) => ({ name: category.name, providers: providers.filter((p) => p.categoryIds.includes(category.id)).length }));
  report.translations.unavailable = [...tallies.unavailable.values()];
  report.translations.machine = PROVIDER_LANGS.flatMap((lang) => tallies.machine.get(lang) ?? []);
  return { providers, categories, failures, report };
}

// ---------------------------------------------------------------- the report
export const UNAVAILABLE_TEXT: Record<UnavailableReason, string> = {
  not_translated: "not translated yet",
  stale: "stale: the English changed since it was translated",
  machine: "machine translation, no review recorded (only descriptions may load unreviewed)",
  review_incomplete: "marked reviewed without a named reviewer and review date",
  incomplete_record: "translation record is missing its text, model or source",
  zh_changed_or_not_reviewed: "converted from a zh text that has changed or is not reviewed",
  lost_required: "does not contain 911, which the English has",
  facts_changed: "machine translation that lost or changed a phone number, postal code, email, web address, time or number of the English",
  safety_critical: "machine translation of a text naming a crisis or emergency line (needs a person's review)",
};

/** The report as lines for the terminal and the CI log. */
export function formatProviderReport(report: ProviderSeedReport): string[] {
  const lines = [`Providers: ${report.providers} in ${report.categories} categories`];
  for (const category of report.perCategory) lines.push(`  ${category.name}: ${category.providers}`);
  lines.push(`Translations loaded (reviewed and current): ${report.translations.loaded}`);
  const machine = report.translations.machine;
  lines.push(
    `Machine translations of descriptions loaded, not reviewed, shown labelled: ${machineLoaded(report)}` +
      (machine.length > 0 ? ` (${machine.map((item) => `${item.lang} ${item.count}`).join(", ")})` : ""),
  );
  const byReason = new Map<UnavailableReason, { total: number; langs: Map<string, number> }>();
  for (const item of report.translations.unavailable) {
    const group = byReason.get(item.reason) ?? { total: 0, langs: new Map() };
    group.total += item.count;
    group.langs.set(item.lang, (group.langs.get(item.lang) ?? 0) + item.count);
    byReason.set(item.reason, group);
  }
  for (const [reason, group] of byReason) {
    const langs = [...group.langs].map(([lang, count]) => `${lang} ${count}`).join(", ");
    lines.push(`Not loaded, shown in English with translation.unavailable: ${group.total} ${UNAVAILABLE_TEXT[reason]} (${langs})`);
  }
  return lines;
}

/** Every failing entry as lines for the terminal. */
export function formatProviderFailures(failures: readonly string[]): string[] {
  return [`REFUSED, nothing loaded: ${failures.length} failing ${failures.length === 1 ? "entry" : "entries"}`, ...failures.map((failure) => `  - ${failure}`)];
}
