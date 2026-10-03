// The wire contracts of the directory release (S02.05, AD-11, AD-20): the manifest the phone reads
// first and the listing file of each language. Shared by the publish job that writes them, the
// routes that serve them and the resident client that reads them; contract tests validate both
// sides against these schemas. Pure and browser-safe.
//
// Versions: the `v` of a body is the version of its contract (1). The release number is
// `release_v` (as SearchV1 names it) and is the {v} segment of /api/directory/{v}/{lang}.json.
import { z } from "zod";
import { LANG_CODES, LangCodeSchema } from "./lang";

/** The catalog string a listing shows beside English text that stands in for a missing or unpublished translation. */
export const TRANSLATION_UNAVAILABLE = "translation.unavailable";

/** The conversion that made a zh-Hant text from the reviewed zh one (OpenCC, recorded beside the text). */
export const ConversionSchema = z.strictObject({
  from: z.literal("zh"),
  /** sha256 of the zh text that was converted. */
  from_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  opencc_version: z.string().min(1),
  config: z.string().min(1),
});

/**
 * One text of a listing, in the shape of AD-20's `Translated`, with what a release keeps of its
 * traceability: the English original, the hash of that English, the model or conversion that made
 * the text, and its review status. `fallback_en` carries the English text, `notice` names the catalog
 * string the client shows beside it, and nothing else about the translation is claimed.
 */
export const ListingTextSchema = z.strictObject({
  lang: LangCodeSchema,
  body: z.string().min(1),
  /** True for text a model translated (reviewed by a person afterwards), and for text converted from it. */
  machine: z.boolean(),
  /** The translation model, or the conversion's name for zh-Hant; null for English and for the English fallback. */
  model: z.string().min(1).nullable(),
  status: z.enum(["source", "ok", "fallback_en", "script_converted"]),
  /** sha256 of the English text this one stands for. */
  source_hash: z.string().regex(/^[0-9a-f]{64}$/),
  original: z.strictObject({ lang: z.literal("en"), body: z.string().min(1) }),
  /** `reviewed` for a translation or conversion a person reviewed; `source` for the English; `none` for a fallback. */
  review_status: z.enum(["reviewed", "source", "none"]),
  reviewed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  conversion: ConversionSchema.optional(),
  notice: z.literal(TRANSLATION_UNAVAILABLE).optional(),
});
export type ListingText = z.infer<typeof ListingTextSchema>;

const ContactSchema = z.strictObject({
  phone: z.array(z.string()),
  email: z.array(z.string()),
  social: z.array(z.string()),
  web: z.array(z.string()),
});

/**
 * The pilot's two neighbourhoods, by the ids the building list uses (Thorncliffe Park, Flemingdon Park). The release says
 * which a provider is in (`neighbourhood_ids` of the listing file); a phone never works it out from an address.
 */
export const NEIGHBOURHOOD_IDS = ["TP", "FP"] as const;
export const NeighbourhoodIdSchema = z.enum(NEIGHBOURHOOD_IDS);
export type NeighbourhoodId = z.infer<typeof NeighbourhoodIdSchema>;

export const ListingProviderSchema = z.strictObject({
  id: z.string().regex(/^[A-Z][0-9]{3,6}$/),
  name: z.string().min(1),
  /** Ids of the listing's categories this provider is in. */
  category_ids: z.array(z.string().min(1)),
  /**
   * The neighbourhoods this provider is in, from the Hub's reviewed list (data/catalogue/provider-neighbourhoods.json);
   * empty for a provider in neither. The directory's neighbourhood filter reads this and nothing else. Release files written
   * before this field existed lack it: they are read with `[]` (the publish job always writes it).
   */
  neighbourhood_ids: z.array(NeighbourhoodIdSchema).default([]),
  subcategories: z.array(ListingTextSchema),
  locations: z.array(
    z.strictObject({
      street: z.string(),
      city: z.string(),
      postal: z.string().nullable(),
      lat: z.number(),
      lng: z.number(),
    }),
  ),
  contact: ContactSchema,
  services: ListingTextSchema,
  emergency_role: ListingTextSchema.nullable(),
  /** The Hub's last-confirmed date, YYYY-MM-DD. */
  last_confirmed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type ListingProvider = z.infer<typeof ListingProviderSchema>;

export const ListingCategorySchema = z.strictObject({
  id: z.string().min(1),
  sort_order: z.number().int(),
  name: ListingTextSchema,
});

/**
 * `/api/directory/{release}/{lang}.json`: every published provider of one release, in one language.
 *
 * A release file is kept as published, so every release still current must parse. A field added to the listing MUST be
 * optional (with a default) when read, or `v` must be bumped: a required field breaks every older release (it made every
 * search answer 503 while release 3 was current). test/fixtures/directory/listing-before-neighbourhoods.json guards this.
 */
export const DirectoryListingV1 = z.strictObject({
  v: z.literal(1),
  release_v: z.number().int().positive(),
  lang: LangCodeSchema,
  catalogue_hash: z.string().regex(/^[0-9a-f]{64}$/),
  categories: z.array(ListingCategorySchema),
  providers: z.array(ListingProviderSchema),
});
export type DirectoryListingV1 = z.infer<typeof DirectoryListingV1>;

/** What a release says about its search data: none until E03 writes it (AD-20, changed in S02.05). */
export const ManifestSearchSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("unavailable") }),
  z.strictObject({
    status: z.literal("available"),
    embed_model: z.string().min(1),
    vectors_path: z.string().min(1),
  }),
]);
export type ManifestSearch = z.infer<typeof ManifestSearchSchema>;

/**
 * `/api/directory/manifest` (never cached): the current release. `search` replaces the spine's earlier `embed_model`
 * field: a release without search data says `{status: "unavailable"}` and the client shows browsing only.
 */
export const DirectoryManifestV1 = z.strictObject({
  v: z.literal(1),
  release_v: z.number().int().positive(),
  published_at: z.iso.datetime(),
  catalogue_hash: z.string().regex(/^[0-9a-f]{64}$/),
  search: ManifestSearchSchema,
  /** Language -> the same-origin path of that language's listing file in this release. */
  files: z.record(LangCodeSchema, z.string().regex(/^\/api\/directory\/[1-9][0-9]*\/[A-Za-z-]+\.json$/)).refine(
    (files) => LANG_CODES.every((lang) => typeof files[lang] === "string"),
    { error: "a file for every language" },
  ),
});
export type DirectoryManifestV1 = z.infer<typeof DirectoryManifestV1>;

/** The body of a failure of the directory routes: `{error: {code, message_key}}` (AD-20). */
export const DirectoryErrorV1 = z.strictObject({
  v: z.literal(1),
  error: z.strictObject({ code: z.enum(["no_release", "not_found", "unavailable"]), message_key: z.string().min(1) }),
});

/** The path of one language's listing file, as the manifest and the route both spell it. */
export function listingPath(release: number, lang: string): string {
  return `/api/directory/${release}/${lang}.json`;
}
