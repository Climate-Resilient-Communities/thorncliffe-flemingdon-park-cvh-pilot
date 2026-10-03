import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import { LANG_CODES } from "./lang";
import { DirectoryListingV1, DirectoryManifestV1, ListingProviderSchema, ListingTextSchema, TRANSLATION_UNAVAILABLE, listingPath } from "./directory";

const HASH = "a".repeat(64);
const files = Object.fromEntries(LANG_CODES.map((lang) => [lang, listingPath(4, lang)]));
const manifest = () => ({ v: 1, release_v: 4, published_at: "2026-10-02T15:00:00.000Z", catalogue_hash: HASH, search: { status: "unavailable" }, files });

const text = (change: Record<string, unknown> = {}) => ({
  lang: "ur",
  body: "مفت",
  machine: true,
  model: "command-a-translate",
  status: "ok",
  source_hash: sha256Hex("Free"),
  original: { lang: "en", body: "Free" },
  review_status: "reviewed",
  reviewed_on: "2026-09-01",
  ...change,
});

describe("DirectoryManifestV1", () => {
  it("accepts the manifest of a release without search data: search is unavailable and every language has a path", () => {
    expect(DirectoryManifestV1.parse(manifest())).toMatchObject({ v: 1, release_v: 4, search: { status: "unavailable" } });
  });

  it("accepts search data: available with the embedding model and the vectors path (it replaces embed_model, AD-20)", () => {
    const withSearch = { ...manifest(), search: { status: "available", embed_model: "embed-multilingual-v3.0", vectors_path: "releases/4/vectors.bin" } };

    expect(DirectoryManifestV1.parse(withSearch).search).toEqual({ status: "available", embed_model: "embed-multilingual-v3.0", vectors_path: "releases/4/vectors.bin" });
  });

  it.each([
    ["the old embed_model field", { embed_model: "embed" }],
    ["a missing search field", { search: undefined }],
    ["available search with no model", { search: { status: "available", vectors_path: "x" } }],
    ["unavailable search carrying a model", { search: { status: "unavailable", embed_model: "x" } }],
    ["a version that is not 1", { v: 2 }],
    ["a release that is 0", { release_v: 0 }],
    ["a published_at that is not a time", { published_at: "yesterday" }],
    ["a catalogue hash that is not a sha256", { catalogue_hash: "abc" }],
    ["a language missing from files", { files: { ...files, fr: undefined } }],
    ["a path outside /api/directory", { files: { ...files, fr: "https://cdn.example.com/fr.json" } }],
    ["a field it does not know", { signed_url: "x" }],
  ])("rejects %s", (_name, change) => {
    expect(DirectoryManifestV1.safeParse({ ...manifest(), ...change }).success).toBe(false);
  });
});

describe("ListingTextSchema", () => {
  it("accepts a translation with its traceability fields", () => {
    expect(ListingTextSchema.parse(text())).toMatchObject({ status: "ok", original: { lang: "en", body: "Free" }, review_status: "reviewed" });
  });

  it("accepts English with translation.unavailable, and a zh-Hant text with its conversion", () => {
    expect(ListingTextSchema.parse(text({ lang: "fr", body: "Free", machine: false, model: null, status: "fallback_en", review_status: "none", reviewed_on: null, notice: TRANSLATION_UNAVAILABLE })).notice).toBe("translation.unavailable");
    const converted = text({
      lang: "zh-Hant",
      status: "script_converted",
      model: "opencc-js 1.4.2",
      conversion: { from: "zh", from_text_hash: HASH, opencc_version: "1.4.2", config: "s2twp" },
    });
    expect(ListingTextSchema.parse(converted).conversion?.from).toBe("zh");
  });

  it.each([
    ["no English original", { original: undefined }],
    ["an original in another language", { original: { lang: "fr", body: "x" } }],
    ["a status that is not one of the four", { status: "pending" }],
    ["an empty body", { body: "" }],
    ["a notice that is not the catalog string", { notice: "unavailable" }],
    ["a source hash that is not a sha256", { source_hash: "x" }],
  ])("rejects %s", (_name, change) => {
    expect(ListingTextSchema.safeParse(text(change)).success).toBe(false);
  });
});

describe("DirectoryListingV1", () => {
  it("rejects a file that names no release, or a language it is not", () => {
    const listing = { v: 1, release_v: 4, lang: "en", catalogue_hash: HASH, categories: [], providers: [] };

    expect(DirectoryListingV1.safeParse(listing).success).toBe(true);
    expect(DirectoryListingV1.safeParse({ ...listing, release_v: undefined }).success).toBe(false);
    expect(DirectoryListingV1.safeParse({ ...listing, lang: "xx" }).success).toBe(false);
  });
});

describe("ListingProviderSchema neighbourhood_ids", () => {
  const provider = (change: Record<string, unknown> = {}) => ({
    id: "M001",
    name: "A provider",
    category_ids: [],
    neighbourhood_ids: ["TP"],
    subcategories: [],
    locations: [],
    contact: { phone: [], email: [], social: [], web: [] },
    services: text({ lang: "en", machine: false, model: null, status: "source", review_status: "source", reviewed_on: null }),
    emergency_role: null,
    last_confirmed: "2026-09-01",
    ...change,
  });

  it.each([[["TP"]], [["FP"]], [["TP", "FP"]], [[]]])("accepts %j", (ids) => {
    expect(ListingProviderSchema.parse(provider({ neighbourhood_ids: ids })).neighbourhood_ids).toEqual(ids);
  });

  it("reads a provider of a file made before this field as in no neighbourhood", () => {
    const { neighbourhood_ids: _omitted, ...older } = provider();
    expect(ListingProviderSchema.parse(older).neighbourhood_ids).toEqual([]);
  });

  it.each([
    ["a neighbourhood that is not one of the pilot's", { neighbourhood_ids: ["XX"] }],
    ["a lower-case id", { neighbourhood_ids: ["tp"] }],
    ["a string instead of a list", { neighbourhood_ids: "TP" }],
  ])("rejects %s", (_name, change) => {
    expect(ListingProviderSchema.safeParse(provider(change)).success).toBe(false);
  });
});

// A release file is kept as it was published, so every release still current must parse with today's schema. Each file here
// is shaped like a listing of an earlier version; adding a required field to DirectoryListingV1 fails this (make it optional on
// read, or bump `v`).
describe("DirectoryListingV1 reads the listings of earlier versions", () => {
  const dir = path.join(process.cwd(), "test/fixtures/directory");
  const fixtures = readdirSync(dir).filter((f) => f.endsWith(".json"));

  it("has fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it.each(fixtures)("parses %s", (file) => {
    const parsed = DirectoryListingV1.safeParse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    expect(parsed.error?.issues).toBeUndefined();
  });

  it("reads the providers of the listing before neighbourhoods as in no neighbourhood", () => {
    const listing = DirectoryListingV1.parse(JSON.parse(readFileSync(path.join(dir, "listing-before-neighbourhoods.json"), "utf8")));
    expect(listing.providers.map((p) => p.neighbourhood_ids)).toEqual([[]]);
  });
});
