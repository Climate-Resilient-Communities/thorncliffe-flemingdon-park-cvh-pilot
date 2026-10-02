// The rules of a directory release (S02.05, AD-11, AD-20): what goes into the listing file of each
// language, which translations may ship, and when a release may be made current. Pure: it reads
// nothing and writes nothing; application/publishDirectory.ts takes the snapshot and stores the files.
//
// Rules:
//  - a release has one listing file per language of LANG_CODES: the 14 launch languages besides
//    English, English, and zh-Hant. Each lists only the providers published at the moment of the
//    snapshot, each once, and the categories those providers are in;
//  - a text ships in a language only when S02.09's evaluateTranslation accepts it: reviewed (reviewer
//    and date), current (its recorded source hash is the hash of the English now), complete, and
//    keeping a 911 the English has. Any other text, and any text that is null in the catalogue, is
//    published as the English text with status `fallback_en` and the `translation.unavailable` notice;
//  - a translation whose recorded source hash no longer matches the English is stale: it is not
//    published, and the release report lists it by provider and language;
//  - zh-Hant is never read from the catalogue: it is converted from the reviewed zh text with OpenCC
//    (status `script_converted`), and only while that zh text is itself reviewed and current;
//  - every shipped text keeps its traceability: the English original, the hash of that English, the
//    model or conversion, and the review status;
//  - the files are deterministic: the same snapshot gives the same bytes.
import { z } from "zod";
import { TRANSLATION_UNAVAILABLE, DirectoryListingV1, type ListingText, type ListingProvider } from "@/contracts/directory";
import {
  evaluateTranslation,
  present,
  type Hasher,
  type TranslationFile,
  type TranslationRecord,
  type UnavailableReason,
} from "@/contracts/contentReview";
import { LANG_CODES, type LangCode } from "@/contracts/lang";

/** The listing files of a release, in the order they are written. */
export const RELEASE_LANGS: readonly LangCode[] = LANG_CODES;

/** Converts reviewed Simplified Chinese to Traditional with OpenCC and says which version and configuration did. */
export interface ZhHantConverter {
  convert(text: string): string;
  openccVersion: string;
  config: string;
}

// ---------------------------------------------------------------- the snapshot
export interface SnapshotProvider {
  id: string;
  name: string;
  subcategories: { name: string; labels: Record<string, string> }[];
  contact: { phone?: string[]; email?: string[]; social?: string[]; web?: string[] };
  /** text key (`services`, `emergency_role`) -> language -> text. */
  texts: Record<string, Record<string, string>>;
  /** text key -> language -> where the translation came from. */
  translations: Record<string, Record<string, Record<string, unknown>>>;
  /** YYYY-MM-DD; a published provider always has one. */
  lastConfirmed: string;
  locations: { street: string; city: string; postal: string | null; lat: number; lng: number }[];
  categoryIds: string[];
}

export interface SnapshotCategory {
  id: string;
  sortOrder: number;
  labels: Record<string, string>;
  /** language -> where the translation of the name came from. */
  translations: Record<string, Record<string, unknown>>;
}

export interface ReleaseInput {
  number: number;
  catalogueHash: string;
  providers: SnapshotProvider[];
  categories: SnapshotCategory[];
  hash: Hasher;
  zhHant: ZhHantConverter;
}

// ---------------------------------------------------------------- the plan
export interface StaleText {
  /** A provider id (`M001`), `category:<id>` or `subcategory:<name>`. */
  subject: string;
  /** `services`, `emergency_role` or `name`. */
  text: string;
  lang: Exclude<LangCode, "en">;
}

export interface UnavailableTexts {
  lang: Exclude<LangCode, "en">;
  reason: UnavailableReason;
  count: number;
}

export interface ReleaseReport {
  /** Translations withheld because the English changed since they were made: every one, by provider and language. */
  stale: StaleText[];
  /** Every text shown in English instead of a translation, by language and why. */
  unavailable: UnavailableTexts[];
}

export interface ReleaseCounts {
  providers: number;
  categories: number;
  languages: number;
  files: number;
  /** Texts published in a language other than English: reviewed translations and conversions. */
  translations: number;
  /** Texts published as English with translation.unavailable, the stale ones included. */
  fallbacks: number;
  stale: number;
}

export interface PlannedFile {
  lang: LangCode;
  /** The file's bytes as text (JSON). */
  body: string;
  sha256: string;
  bytes: number;
}

export interface ReleasePlan {
  files: PlannedFile[];
  counts: ReleaseCounts;
  report: ReleaseReport;
}

/** The snapshot cannot be turned into a release: a published provider with no English text, say. Retrying cannot fix it. */
export class ReleaseDataError extends Error {
  override name = "ReleaseDataError";
  constructor(readonly problems: string[]) {
    super(`The directory cannot be published: ${problems.join("; ")}`);
  }
}

// ---------------------------------------------------------------- one text
interface Tally {
  translations: number;
  fallbacks: number;
  stale: StaleText[];
  unavailable: Map<string, UnavailableTexts>;
}

const asRecord = (text: string | undefined, provenance: Record<string, unknown> | undefined): TranslationRecord | null => {
  if (text === undefined) return null;
  const read = (name: string) => (typeof provenance?.[name] === "string" ? (provenance[name] as string) : undefined);
  const status = read("status");
  return {
    text,
    model: read("model"),
    sourceHash: read("sourceHash"),
    status: status === "machine" || status === "reviewed" ? status : undefined,
    reviewer: read("reviewer"),
    reviewedOn: read("reviewedOn"),
  };
};

interface TextSources {
  /** language -> the text, as the catalogue holds it (English included). */
  labels: Record<string, string>;
  /** language -> where that translation came from; absent for texts that kept no provenance. */
  provenance: Record<string, Record<string, unknown>> | null;
}

/**
 * The listing text of one English text in one language, or the English standing in for it. `label` is
 * what the report calls the text.
 */
function listingText(
  lang: LangCode,
  english: string,
  sources: TextSources,
  subject: string,
  label: string,
  input: ReleaseInput,
  tally: Tally,
): ListingText {
  const { hash, zhHant } = input;
  const sourceHash = hash(english);
  const original = { lang: "en" as const, body: english };
  if (lang === "en") {
    return { lang, body: english, machine: false, model: null, status: "source", source_hash: sourceHash, original, review_status: "source", reviewed_on: null };
  }

  const key = "t";
  const provenanceOf = (code: string) => sources.provenance?.[code];
  // Subcategory names keep no provenance: the seed loaded only reviewed, current ones, so a label present is shipped as reviewed.
  const noProvenance = sources.provenance === null;
  const fileOf = (code: Exclude<LangCode, "en">, record: TranslationRecord | null): Partial<Record<LangCode, TranslationFile>> =>
    record ? { [code]: { texts: { [key]: record } } } : {};

  const fallback = (reason: UnavailableReason, stale: boolean): ListingText => {
    tally.fallbacks += 1;
    const slot = `${lang}:${reason}`;
    const entry = tally.unavailable.get(slot) ?? { lang: lang as Exclude<LangCode, "en">, reason, count: 0 };
    entry.count += 1;
    tally.unavailable.set(slot, entry);
    if (stale) tally.stale.push({ subject, text: label, lang: lang as Exclude<LangCode, "en"> });
    return {
      lang,
      body: english,
      machine: false,
      model: null,
      status: "fallback_en",
      source_hash: sourceHash,
      original,
      review_status: "none",
      reviewed_on: null,
      notice: TRANSLATION_UNAVAILABLE,
    };
  };
  const lost = (result: ReturnType<typeof evaluateTranslation>): UnavailableReason => ("unavailable" in result ? result.unavailable : "incomplete_record");

  if (lang === "zh-Hant") {
    const zhText = sources.labels.zh;
    const zhProvenance = provenanceOf("zh");
    if (!present(zhText)) return fallback("not_translated", false);
    const model = `opencc-js ${zhHant.openccVersion}`;
    const conversion = { from: "zh" as const, from_text_hash: hash(zhText), opencc_version: zhHant.openccVersion, config: zhHant.config };
    if (noProvenance) {
      // A subcategory name keeps no provenance: the seed loaded only a reviewed, current zh, so its conversion ships as reviewed.
      tally.translations += 1;
      return { lang, body: zhHant.convert(zhText), machine: true, model, status: "script_converted", source_hash: sourceHash, original, review_status: "reviewed", reviewed_on: null, conversion };
    }
    const zhRecord = asRecord(zhText, zhProvenance);
    if (!zhRecord) return fallback("not_translated", false);
    const converted: TranslationRecord = {
      ...zhRecord,
      text: zhHant.convert(zhText),
      model,
      conversion: { from: "zh", fromTextHash: hash(zhText), openccVersion: zhHant.openccVersion, config: zhHant.config },
    };
    const files = { ...fileOf("zh-Hant", converted), ...fileOf("zh", zhRecord) };
    const result = evaluateTranslation("zh-Hant", key, english, files, hash, ["911"]);
    if (!("loaded" in result)) {
      const zhResult = evaluateTranslation("zh", key, english, files, hash, ["911"]);
      const reason = lost(result);
      const zhStale = "unavailable" in zhResult && zhResult.unavailable === "stale";
      return fallback(reason, reason === "stale" || zhStale);
    }
    tally.translations += 1;
    return {
      lang,
      body: result.loaded.text,
      machine: true,
      model,
      status: "script_converted",
      source_hash: sourceHash,
      original,
      review_status: "reviewed",
      reviewed_on: zhRecord.reviewedOn ?? null,
      conversion,
    };
  }

  const text = sources.labels[lang];
  if (!present(text)) return fallback("not_translated", false);
  if (noProvenance) {
    tally.translations += 1;
    return { lang, body: text, machine: true, model: null, status: "ok", source_hash: sourceHash, original, review_status: "reviewed", reviewed_on: null };
  }
  const record = asRecord(text, provenanceOf(lang));
  const result = evaluateTranslation(lang as Exclude<LangCode, "en" | "zh-Hant">, key, english, fileOf(lang as Exclude<LangCode, "en">, record), hash, ["911"]);
  if (!("loaded" in result)) {
    const reason = lost(result);
    return fallback(reason, reason === "stale");
  }
  tally.translations += 1;
  const provenance = result.loaded.provenance as { model: string; reviewedOn: string; sourceHash: string };
  return {
    lang,
    body: result.loaded.text,
    machine: true,
    model: provenance.model,
    status: "ok",
    source_hash: provenance.sourceHash,
    original,
    review_status: "reviewed",
    reviewed_on: provenance.reviewedOn,
  };
}

// ---------------------------------------------------------------- one file
function listingFile(lang: LangCode, input: ReleaseInput, tally: Tally, problems: string[]): string {
  const categoriesUsed = new Set(input.providers.flatMap((p) => p.categoryIds));
  const categories = input.categories
    .filter((c) => categoriesUsed.has(c.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((c) => {
      const english = c.labels.en;
      if (!present(english)) {
        problems.push(`category ${c.id} has no English name`);
        return null;
      }
      return {
        id: c.id,
        sort_order: c.sortOrder,
        name: listingText(lang, english, { labels: c.labels, provenance: c.translations }, `category:${c.id}`, "name", input, tally),
      };
    })
    .filter((c): c is NonNullable<typeof c> => c !== null);

  const providers: ListingProvider[] = [];
  for (const p of [...input.providers].sort((a, b) => a.id.localeCompare(b.id))) {
    const services = p.texts.services?.en;
    if (!present(services)) {
      problems.push(`provider ${p.id} has no English services text`);
      continue;
    }
    const role = p.texts.emergency_role?.en;
    const text = (key: string, english: string) =>
      listingText(lang, english, { labels: p.texts[key], provenance: p.translations[key] ?? {} }, p.id, key, input, tally);
    providers.push({
      id: p.id,
      name: p.name,
      category_ids: p.categoryIds,
      subcategories: p.subcategories.map((s) => listingText(lang, s.name, { labels: { ...s.labels, en: s.name }, provenance: null }, `subcategory:${s.name}`, "name", input, tally)),
      locations: p.locations.map((l) => ({ street: l.street, city: l.city, postal: l.postal, lat: l.lat, lng: l.lng })),
      contact: { phone: p.contact.phone ?? [], email: p.contact.email ?? [], social: p.contact.social ?? [], web: p.contact.web ?? [] },
      services: text("services", services),
      emergency_role: present(role) ? text("emergency_role", role) : null,
      last_confirmed: p.lastConfirmed,
    });
  }
  const listing = { v: 1 as const, release_v: input.number, lang, catalogue_hash: input.catalogueHash, categories, providers };
  const checked = DirectoryListingV1.safeParse(listing);
  if (!checked.success) {
    problems.push(...checked.error.issues.map((issue) => `${lang}: ${issue.path.join(".")}: ${issue.message}`));
    return "";
  }
  return JSON.stringify(checked.data);
}

/**
 * The files of a release for a snapshot of the published providers, with its counts and report.
 * Throws ReleaseDataError when a file cannot be built (nothing is partly planned).
 */
export function planRelease(input: ReleaseInput): ReleasePlan {
  const problems: string[] = [];
  const files: PlannedFile[] = [];
  const counts: ReleaseCounts = {
    providers: input.providers.length,
    categories: new Set(input.providers.flatMap((p) => p.categoryIds)).size,
    languages: RELEASE_LANGS.length,
    files: RELEASE_LANGS.length,
    translations: 0,
    fallbacks: 0,
    stale: 0,
  };
  const report: ReleaseReport = { stale: [], unavailable: [] };
  const unavailable = new Map<string, UnavailableTexts>();
  for (const lang of RELEASE_LANGS) {
    const tally: Tally = { translations: 0, fallbacks: 0, stale: [], unavailable };
    const body = listingFile(lang, input, tally, problems);
    counts.translations += tally.translations;
    counts.fallbacks += tally.fallbacks;
    report.stale.push(...tally.stale);
    files.push({ lang, body, sha256: input.hash(body), bytes: Buffer.byteLength(body, "utf8") });
  }
  if (problems.length > 0) throw new ReleaseDataError([...new Set(problems)].slice(0, 20));
  counts.stale = report.stale.length;
  report.unavailable = [...unavailable.values()].sort((a, b) => a.lang.localeCompare(b.lang) || a.reason.localeCompare(b.reason));
  report.stale.sort((a, b) => a.subject.localeCompare(b.subject) || a.lang.localeCompare(b.lang) || a.text.localeCompare(b.text));
  return { files, counts, report };
}

// ---------------------------------------------------------------- search data (E03)
/** E03's search data of a release: built from the same listings, so it must name the same release and catalogue version. */
export interface ReleaseSearch {
  embedModel: string;
  vectorsPath: string;
  catalogueHash: string;
  releaseV: number;
}

export const ReleaseSearchSchema = z.strictObject({
  embedModel: z.string().min(1),
  vectorsPath: z.string().min(1),
  catalogueHash: z.string().regex(/^[0-9a-f]{64}$/),
  releaseV: z.number().int().positive(),
});

/** Whether a release may be made current with this search data (none is fine; mismatched data is not). */
export function checkReleaseSearch(release: { number: number; catalogueHash: string }, search: ReleaseSearch | null): { ok: true } | { ok: false; problem: "release" | "catalogue" } {
  if (search === null) return { ok: true };
  if (search.releaseV !== release.number) return { ok: false, problem: "release" };
  if (search.catalogueHash !== release.catalogueHash) return { ok: false, problem: "catalogue" };
  return { ok: true };
}
