import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/platform/hash";
import { LANG_CODES } from "./lang";
import { DirectoryListingV1, DirectoryManifestV1, ListingTextSchema, TRANSLATION_UNAVAILABLE, listingPath } from "./directory";

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
