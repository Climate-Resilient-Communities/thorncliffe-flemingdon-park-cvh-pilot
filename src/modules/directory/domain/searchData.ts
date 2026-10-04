// The search data of a release (S03.02, AD-11, AD-15, FR-D2-Q): what is embedded for each published provider, the
// vectors file written beside the listing files, and the rules that decide whether that file may go live with the
// release. Pure: it embeds nothing and stores nothing; application/releaseSearch.ts does, and
// application/publishDirectory.ts asks it before a release is made current.
//
// Rules:
//  - the search text of a provider is its English name, its categories, its subcategories, its day-to-day services and
//    its emergency role, nothing else. The contact block, the address fields and the source notes are never read, and the
//    free text of the services and the emergency role is scrubbed of phone numbers, emails, web addresses, postal codes
//    and street addresses before it is hashed and embedded (scrubContactDetails), because a vector search matches
//    meaning and those details are noise to it and personal data to the vendor;
//  - a vector is a pure function of (embedding config, search text), so it is keyed by the hash of the text: the same
//    text under the same config (model, input type, kind of numbers, dimension) is embedded once, however many releases
//    carry it;
//  - the vectors file names the release and the catalogue version it was made for, the model and the size of its
//    vectors, and lists exactly the providers of the release's listing files, each once, with the hash of the text it was
//    made from;
//  - a release may be made current with search data only if the file names that release and that catalogue version and
//    covers exactly the providers in every listing file. Anything else refuses the release (search_mismatch).
import { z } from "zod";
import { present, type Hasher } from "@/contracts/contentReview";
import { LANG_CODES } from "@/contracts/lang";
import type { SnapshotCategory, SnapshotProvider } from "./directoryRelease";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ProviderId = z.string().regex(/^[A-Z][0-9]{3,6}$/);

// ---------------------------------------------------------------- what is embedded
export interface SearchItem {
  id: string;
  /** What the model reads. */
  text: string;
  /** sha256 of `text`: the key a vector is reused by. */
  textHash: string;
}

// ---------------------------------------------------------------- contact details in free text
const STREET_SUFFIX =
  "(?:Avenue|Ave|Street|St|Road|Rd|Boulevard|Blvd|Drive|Dr|Crescent|Cres|Court|Crt|Ct|Place|Pl|Way|Lane|Ln|Parkway|Pkwy|Trail|Terrace|Gates|Gate|Circle|Cir|Square|Highway|Hwy|Mews|Grove|Gardens|Heights)";
const TAIL = String.raw`[^\s<>"')\]]`;

// Applied in this order: an email before the web address it contains, a web address before anything made of digits, and a
// phone number before a street address.
const CONTACT_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  new RegExp(String.raw`\b(?:https?:\/\/|www\.)${TAIL}+`, "gi"),
  new RegExp(String.raw`\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:ca|com|org|net|edu|gov|info|ngo|coop|app|io)\b(?:\/${TAIL}*)?`, "gi"),
  // 416-808-5500, (416) 425-2485, an unclosed "(416-421-0792", +1 833 250 2290, with an extension.
  /(?<!\d)(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)?|\d{3})[\s.)–-]*\d{3}[\s.–-]*\d{4}(?!\d)(?:\s*(?:ext\.?|extension|x)\s*\d{1,6})?/gi,
  /(?<![\d.])\d{3}[-.]\d{4}(?!\d)/g,
  /(?<!\d)1?\d{10}(?!\d)/g,
  /\b[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d\b/g,
  // 101 Coxwell Ave, 16 Thorncliffe Park Drive, 1313 Woodbine Ave E: a number, up to four capitalised words, a street word.
  new RegExp(String.raw`\b\d{1,6}[A-Za-z]?(?:-\d{1,6})?\s+(?:[A-Z0-9][\w'’.-]*\s+){0,4}${STREET_SUFFIX}\b\.?(?:\s+(?:East|West|North|South|E|W|N|S)\b\.?)?`, "g"),
];

/**
 * The text with its phone numbers, email addresses, web addresses, postal codes and street addresses taken out. Short
 * service numbers (911, 211, 311) stay: they are what the text is about, not how to reach a provider.
 */
export function scrubContactDetails(text: string): string {
  let out = text;
  for (const pattern of CONTACT_PATTERNS) out = out.replace(pattern, " ");
  return out
    .replace(/\(\s*[,;/|]*\s*\)/g, " ")
    .replace(/[ \t]+([,.;:!?)])/g, "$1")
    .replace(/\([ \t]+/g, "(")
    .replace(/([,;])(?:[ \t]*[,;])+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/** The English text of one provider that search matches a question against. */
export function searchTextOf(provider: SnapshotProvider, categoryNames: readonly string[]): string {
  const lines = [provider.name];
  if (categoryNames.length > 0) lines.push(`Categories: ${categoryNames.join(", ")}`);
  const subcategories = provider.subcategories.map((s) => s.name).filter(present);
  if (subcategories.length > 0) lines.push(`Subcategories: ${subcategories.join(", ")}`);
  const services = provider.texts.services?.en;
  if (present(services) && scrubContactDetails(services) !== "") lines.push(`Services: ${scrubContactDetails(services)}`);
  const role = provider.texts.emergency_role?.en;
  if (present(role) && scrubContactDetails(role) !== "") lines.push(`Emergency role: ${scrubContactDetails(role)}`);
  return lines.join("\n");
}

/** The search items of a snapshot, one per provider, in provider id order (the order of the vectors file). */
export function searchItems(providers: readonly SnapshotProvider[], categories: readonly SnapshotCategory[], hash: Hasher): SearchItem[] {
  const order = new Map(categories.map((c) => [c.id, c] as const));
  return [...providers]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((provider) => {
      const names = provider.categoryIds
        .map((id) => order.get(id))
        .filter((c): c is SnapshotCategory => c !== undefined)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
        .map((c) => c.labels.en)
        .filter(present);
      const text = searchTextOf(provider, names);
      return { id: provider.id, text, textHash: hash(text) };
    });
}

/** The emergency categories (by their English names) that no category of the snapshot has: a typo in the setting would silently turn the 911 block off. */
export function unknownEmergencyCategories(names: readonly string[], categories: readonly SnapshotCategory[]): string[] {
  const known = new Set(categories.map((c) => c.labels.en));
  return names.filter((name) => !known.has(name));
}

/** A rough upper bound of the tokens of some texts (three bytes to a token), used to check the allowance before a call. */
export function estimateTokens(texts: readonly string[]): number {
  const encoder = new TextEncoder();
  return texts.reduce((sum, text) => sum + Math.ceil(encoder.encode(text).length / 3), 0);
}

// ---------------------------------------------------------------- the embedding config
/** What makes one embedding of a text different from another: the model, the input type, the kind of numbers and their count. */
export interface EmbeddingConfig {
  model: string;
  /** How the vendor is told what the text is for (documents are embedded as `search_document`). */
  inputType: string;
  /** The kind of numbers asked for (`float`). */
  embeddingType: string;
  /** The number of numbers in a vector when the config fixes it, or null when the model's own default applies. */
  dims: number | null;
}

/** An embedding config as a release records it. */
export const EmbeddingConfigRecordSchema = z.strictObject({
  model: z.string().min(1),
  input_type: z.string().min(1),
  embedding_type: z.string().min(1),
  dims: z.number().int().positive().nullable(),
});

export const embeddingConfigRecord = (config: EmbeddingConfig) => ({
  model: config.model,
  input_type: config.inputType,
  embedding_type: config.embeddingType,
  dims: config.dims,
});

/**
 * The key a vector is reused by, besides its text: every part of the config. A vector of one model, input type, kind of
 * numbers or dimension is no use to another, so a release copies from an earlier one only when the keys are equal.
 */
export function embeddingConfigKey(config: EmbeddingConfig): string {
  return `model=${config.model};input_type=${config.inputType};embedding_type=${config.embeddingType};dims=${config.dims ?? "default"}`;
}

// ---------------------------------------------------------------- the plan staged with the release
/** What the claim stages, from the one snapshot of the release: a resumed job embeds exactly these texts, whatever the providers look like now. */
export const SearchPlanSchema = z.strictObject({
  embed_model: z.string().min(1),
  embed_config: EmbeddingConfigRecordSchema,
  embed_config_key: z.string().min(1),
  threshold: z.number().min(0).max(1),
  emergency_categories: z.array(z.string().min(1)),
  items: z.array(z.strictObject({ id: ProviderId, text: z.string().min(1), text_hash: Sha256 })),
});
export type SearchPlan = z.infer<typeof SearchPlanSchema>;

export function searchPlan(input: { embedConfig: EmbeddingConfig; threshold: number; emergencyCategories: readonly string[]; items: readonly SearchItem[] }): SearchPlan {
  return {
    embed_model: input.embedConfig.model,
    embed_config: embeddingConfigRecord(input.embedConfig),
    embed_config_key: embeddingConfigKey(input.embedConfig),
    threshold: input.threshold,
    emergency_categories: [...input.emergencyCategories],
    items: input.items.map((item) => ({ id: item.id, text: item.text, text_hash: item.textHash })),
  };
}

// ---------------------------------------------------------------- the vectors file
const VectorSchema = z.array(z.number());

export const VectorEntrySchema = z.strictObject({ id: ProviderId, text_hash: Sha256, vector: VectorSchema });
export type VectorEntry = z.infer<typeof VectorEntrySchema>;

/** The embeddings made in one call, staged until the vectors file is assembled. */
export const VectorChunkSchema = z.array(VectorEntrySchema);

/**
 * `releases/{n}/vectors.json`: private to the server, never served to a phone (the routes serve only the listing files).
 * `release_v` and `catalogue_hash` are those of the listing files it was made with.
 */
export const VectorsFileSchema = z
  .strictObject({
    v: z.literal(1),
    release_v: z.number().int().positive(),
    catalogue_hash: Sha256,
    embed_model: z.string().min(1),
    /** The number of numbers in each vector (0 only for a release with no providers). */
    dims: z.number().int().min(0),
    providers: z.array(VectorEntrySchema),
  })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.providers.forEach((entry, index) => {
      if (entry.vector.length !== file.dims) ctx.addIssue({ code: "custom", path: ["providers", index, "vector"], message: "every vector has dims numbers" });
      if (seen.has(entry.id)) ctx.addIssue({ code: "custom", path: ["providers", index, "id"], message: "each provider once" });
      seen.add(entry.id);
    });
  });
export type VectorsFile = z.infer<typeof VectorsFileSchema>;

/** The entries in the order both vectors files keep them: by provider id. */
export const sortedVectorEntries = (entries: readonly VectorEntry[]): VectorEntry[] => [...entries].sort((a, b) => a.id.localeCompare(b.id));

export function vectorsFileBody(input: { releaseV: number; catalogueHash: string; embedModel: string; entries: readonly VectorEntry[] }): { body: string; dims: number } {
  const entries = sortedVectorEntries(input.entries);
  const dims = entries[0]?.vector.length ?? 0;
  const file: VectorsFile = { v: 1, release_v: input.releaseV, catalogue_hash: input.catalogueHash, embed_model: input.embedModel, dims, providers: entries };
  return { body: JSON.stringify(VectorsFileSchema.parse(file)), dims };
}

/**
 * What a release closed as failed keeps in its `search` column (the staged text is cleared on closing, the paid vectors are
 * not): the chunks it had embedded, under the embedding config key they were made with, so the next release can copy them
 * instead of paying for them again. Never mistaken for a release's record (that one has other fields, and a failed
 * release is never served).
 */
export const KeptSearchSchema = z.strictObject({
  kept: z.strictObject({ embed_config_key: z.string().min(1), entries: VectorChunkSchema }),
});
export type KeptSearch = z.infer<typeof KeptSearchSchema>;

/** The `search` record of a release: what the manifest and the search route read, and what the release keeps of its vectors. */
export const ReleaseSearchRecordSchema = z.strictObject({
  embed_model: z.string().min(1),
  /** The whole embedding config and its key: what a later release compares before it copies any of these vectors. */
  embed_config: EmbeddingConfigRecordSchema,
  embed_config_key: z.string().min(1),
  vectors_path: z.string().min(1),
  catalogue_hash: Sha256,
  release_v: z.number().int().positive(),
  vector_count: z.number().int().min(0),
  dims: z.number().int().min(0),
  threshold: z.number().min(0).max(1),
  emergency_categories: z.array(z.string().min(1)),
  sha256: Sha256,
  bytes: z.number().int().min(0),
  /** The compact binary form of the same vectors, when the release has one (releases published before it do not). */
  binary: z.strictObject({ path: z.string().min(1), sha256: Sha256, bytes: z.number().int().min(0) }).optional(),
  /** How many of the vectors were copied from an earlier release, and how many were embedded for this one. */
  reused: z.number().int().min(0),
  embedded: z.number().int().min(0),
  stored_at: z.iso.datetime(),
});
export type ReleaseSearchRecord = z.infer<typeof ReleaseSearchRecordSchema>;

// ---------------------------------------------------------------- may it go live
export interface ListingIds {
  lang: string;
  /** The provider ids of one listing file, as they stand in it. */
  ids: readonly string[];
}

/** The ids of the providers in a listing file's text, or null when it is not a listing. */
export function listingProviderIds(body: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(body);
    const providers = (parsed as { providers?: unknown }).providers;
    if (!Array.isArray(providers)) return null;
    const ids = providers.map((p) => (p as { id?: unknown }).id);
    return ids.every((id): id is string => typeof id === "string") ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Why a vectors file may not go live with a release, as short codes (ids and codes only, never text): another release
 * number, another catalogue version, another model than the one recorded, and any provider the listing files have that
 * the vectors lack (or the reverse), in any language. Empty when it may.
 */
export function vectorsProblems(
  file: VectorsFile,
  release: { number: number; catalogueHash: string; embedModel: string },
  listings: readonly ListingIds[],
): string[] {
  const problems: string[] = [];
  if (file.release_v !== release.number) problems.push("release");
  if (file.catalogue_hash !== release.catalogueHash) problems.push("catalogue");
  if (file.embed_model !== release.embedModel) problems.push("model");
  const covered = new Set(file.providers.map((p) => p.id));
  for (const listing of listings) {
    const listed = new Set(listing.ids);
    for (const id of listed) if (!covered.has(id)) problems.push(`${listing.lang}:missing:${id}`);
    for (const id of covered) if (!listed.has(id)) problems.push(`${listing.lang}:extra:${id}`);
    if (listed.size !== listing.ids.length) problems.push(`${listing.lang}:repeated`);
  }
  // Every launch language has a listing: a release checked against fewer would not be checked against them all.
  const languages = new Set(listings.map((l) => l.lang));
  for (const lang of LANG_CODES) if (!languages.has(lang)) problems.push(`${lang}:no_listing`);
  return [...new Set(problems)].slice(0, 20);
}
