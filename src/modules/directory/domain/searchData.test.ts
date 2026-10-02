import { describe, expect, it } from "vitest";
import { LANG_CODES } from "@/contracts/lang";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SnapshotCategory, SnapshotProvider } from "./directoryRelease";
import {
  ReleaseSearchRecordSchema,
  SearchPlanSchema,
  VectorsFileSchema,
  embeddingConfigKey,
  estimateTokens,
  listingProviderIds,
  searchItems,
  searchPlan,
  searchTextOf,
  unknownEmergencyCategories,
  vectorsFileBody,
  vectorsProblems,
  type ListingIds,
  type VectorEntry,
} from "./searchData";

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const HASH = "a".repeat(64);
const CONFIG = { model: "embed-v4.0", inputType: "search_document", embeddingType: "float", dims: null };

const provider = (id: string, change: Partial<SnapshotProvider> = {}): SnapshotProvider => ({
  id,
  name: `Provider ${id}`,
  subcategories: [],
  contact: { phone: ["416-555-0100"], email: ["info@example.org"], web: ["https://example.org"] },
  texts: { services: { en: "Free legal help." } },
  translations: {},
  withheld: null,
  lastConfirmed: "2026-09-20",
  locations: [{ street: "1 Overlea Blvd", city: "East York", postal: "M4H 1C6", lat: 43.7, lng: -79.34 }],
  categoryIds: ["c-legal"],
  ...change,
});

const categories: SnapshotCategory[] = [
  { id: "c-health", sortOrder: 2, labels: { en: "Health", ur: "صحت" }, translations: {} },
  { id: "c-legal", sortOrder: 1, labels: { en: "Legal" }, translations: {} },
  { id: "c-emergency", sortOrder: 3, labels: { en: "Support & Emergency Services" }, translations: {} },
];

const entry = (id: string, dims = 3, textHash = HASH): VectorEntry => ({ id, text_hash: textHash, vector: Array.from({ length: dims }, (_, i) => i / 10) });
const listingsOf = (ids: string[]): ListingIds[] => LANG_CODES.map((lang) => ({ lang, ids }));
const release = { number: 4, catalogueHash: "b".repeat(64), embedModel: "embed-v4.0" };
const file = (providers: VectorEntry[], change: Record<string, unknown> = {}) =>
  VectorsFileSchema.parse({ v: 1, release_v: 4, catalogue_hash: "b".repeat(64), embed_model: "embed-v4.0", dims: 3, providers, ...change });

describe("the search text of a provider (S03.02)", () => {
  it("is the English name, categories, subcategories, services and emergency role, and nothing else", () => {
    const text = searchTextOf(
      provider("M001", {
        subcategories: [{ name: "Tenant rights", labels: { ur: "کرایہ دار" } }],
        texts: { services: { en: "Free legal help.", ur: "مفت قانونی مدد" }, emergency_role: { en: "Takes 911 referrals." } },
      }),
      ["Legal", "Support & Emergency Services"],
    );

    expect(text).toBe(
      "Provider M001\nCategories: Legal, Support & Emergency Services\nSubcategories: Tenant rights\nServices: Free legal help.\nEmergency role: Takes 911 referrals.",
    );
  });

  it("never holds contact details, addresses, notes or another language", () => {
    const text = searchTextOf(provider("M001", { texts: { services: { en: "Free legal help.", ur: "مفت قانونی مدد" } } }), ["Legal"]);

    for (const secret of ["416-555-0100", "info@example.org", "example.org", "Overlea", "M4H", "مفت"]) expect(text).not.toContain(secret);
  });

  it("scrubs phone numbers, emails, web addresses, postal codes and street addresses out of the services and the emergency role, and keeps the words and the short numbers", () => {
    const text = searchTextOf(
      provider("M001", {
        texts: {
          services: {
            en: "Free legal help at 101 Coxwell Ave, East York M4C 3B6 (call 416-808-5500 or (416) 425-2485 ext. 12, email info@example.org, see https://www.example.org/help or toronto.ca/legal). Call 911 in an emergency or 211 for services.",
          },
          emergency_role: { en: "Walk-ins at 16 Thorncliffe Park Drive; phone +1 833 250 2290." },
        },
      }),
      ["Legal"],
    );

    expect(text).toBe(
      "Provider M001\nCategories: Legal\nServices: Free legal help at, East York (call or, email, see or). Call 911 in an emergency or 211 for services.\nEmergency role: Walk-ins at; phone.",
    );
  });

  it("drops a line whose text is nothing but contact details", () => {
    expect(searchTextOf(provider("M001", { texts: { services: { en: "416-808-5500" }, emergency_role: { en: "info@example.org" } } }), [])).toBe("Provider M001");
  });

  it("leaves out the lines a provider has nothing for", () => {
    expect(searchTextOf(provider("M002", { texts: { services: { en: "Walk-in clinic." } } }), [])).toBe("Provider M002\nServices: Walk-in clinic.");
  });

  it("takes the categories in the catalogue's order, and the same snapshot always gives the same texts and hashes", () => {
    const providers = [provider("M002", { categoryIds: ["c-health", "c-legal"] }), provider("M001")];

    const first = searchItems(providers, categories, sha256Hex);
    const again = searchItems([...providers].reverse(), categories, sha256Hex);

    expect(first.map((item) => item.id)).toEqual(["M001", "M002"]);
    expect(first[1].text).toContain("Categories: Legal, Health");
    expect(again).toEqual(first);
    expect(first[0].textHash).toBe(sha256Hex(first[0].text));
    expect(first[0].textHash).not.toBe(first[1].textHash);
  });
});

describe("the emergency categories (S03.02)", () => {
  it("names the ones the catalogue does not have, so a typo cannot turn the 911 block off silently", () => {
    expect(unknownEmergencyCategories(["Support & Emergency Services"], categories)).toEqual([]);
    expect(unknownEmergencyCategories(["Support & Emergency Services", "Support and Emergency"], categories)).toEqual(["Support and Emergency"]);
  });
});

describe("the allowance estimate", () => {
  it("is an upper bound of about three bytes a token, per text", () => {
    expect(estimateTokens([])).toBe(0);
    expect(estimateTokens(["abc", "abcd"])).toBe(1 + 2);
    expect(estimateTokens(["مفت"])).toBe(2);
  });
});

describe("the real catalogue's search texts (S03.02)", () => {
  // Written apart from the scrubber on purpose, and looser: anything that looks like a way to reach a provider.
  const SUFFIX = "Ave|Avenue|St|Street|Rd|Road|Blvd|Boulevard|Dr|Drive|Cres|Crescent|Crt|Court|Ct|Pl|Place|Way|Lane|Ln|Pkwy|Parkway|Trail|Terrace|Gate|Gates|Circle|Cir|Hwy|Highway";
  const LOOKS_LIKE: Record<string, RegExp> = {
    phone: /\(?\d{3}\)?[\s.\-–]*\d{3}[\s.\-–]*\d{4}/,
    shortPhone: /\b\d{3}[-.]\d{4}\b/,
    email: /\S+@\S+|@/,
    url: /https?:|www\.|\b[a-z0-9-]+\.(?:ca|com|org|net|edu|gov|info)\b/i,
    street: new RegExp(String.raw`\b\d{1,6}[A-Za-z]?\s+(?:[A-Za-z0-9'’.-]+\s+){0,4}(?:${SUFFIX})\b`, "i"),
    postal: /\b[A-Z]\d[A-Z][ -]?\d[A-Z]\d\b/i,
  };

  it("hold no phone number, email, web address, postal code or street address, in any provider", () => {
    const file = JSON.parse(readFileSync(path.join(process.cwd(), "data", "catalogue", "providers.json"), "utf8")) as {
      providers: { id: string; name: string; subcategories: string[]; services: { en: string }; emergencyRole: { en: string } | null }[];
    };
    const providers = file.providers.map((entry) =>
      provider(entry.id, {
        name: entry.name,
        subcategories: entry.subcategories.map((name) => ({ name, labels: {} })),
        texts: { services: { en: entry.services.en }, ...(entry.emergencyRole ? { emergency_role: { en: entry.emergencyRole.en } } : {}) },
      }),
    );

    const items = searchItems(providers, categories, sha256Hex);

    expect(items).toHaveLength(file.providers.length);
    const leaks = items.flatMap((item) => Object.entries(LOOKS_LIKE).flatMap(([kind, pattern]) => (pattern.exec(item.text) ? [`${item.id} ${kind}: ${pattern.exec(item.text)?.[0]}`] : [])));
    expect(leaks).toEqual([]);
    // The scrub takes the details and not the sentence: the texts are still about the services.
    expect(items.every((item) => item.text.includes("Services:") || item.text.includes("Emergency role:"))).toBe(true);
    expect(items.find((item) => item.id === "M001")?.text).toMatch(/community policing/);
  });
});

describe("the embedding config", () => {
  it("is keyed by every part of it: model, input type, kind of numbers and dimension", () => {
    const base = embeddingConfigKey(CONFIG);

    expect(base).toBe("model=embed-v4.0;input_type=search_document;embedding_type=float;dims=default");
    expect(embeddingConfigKey({ ...CONFIG, model: "embed-multilingual-v3.0" })).not.toBe(base);
    expect(embeddingConfigKey({ ...CONFIG, inputType: "search_query" })).not.toBe(base);
    expect(embeddingConfigKey({ ...CONFIG, embeddingType: "int8" })).not.toBe(base);
    expect(embeddingConfigKey({ ...CONFIG, dims: 512 })).not.toBe(base);
    expect(embeddingConfigKey({ ...CONFIG })).toBe(base);
  });
});

describe("the plan staged with a release", () => {
  it("holds the model, threshold, emergency categories and the texts to embed, and reads back as written", () => {
    const items = searchItems([provider("M001")], categories, sha256Hex);

    const plan = searchPlan({ embedConfig: CONFIG, threshold: 0.3, emergencyCategories: ["Support & Emergency Services"], items });

    expect(SearchPlanSchema.parse(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
    expect(plan.items).toEqual([{ id: "M001", text: items[0].text, text_hash: items[0].textHash }]);
  });
});

describe("the vectors file", () => {
  it("is written in provider id order with its size, the release and the catalogue version", () => {
    const { body, dims } = vectorsFileBody({ releaseV: 4, catalogueHash: "b".repeat(64), embedModel: "embed-v4.0", entries: [entry("M002"), entry("M001")] });

    expect(dims).toBe(3);
    expect(VectorsFileSchema.parse(JSON.parse(body))).toMatchObject({ v: 1, release_v: 4, catalogue_hash: "b".repeat(64), embed_model: "embed-v4.0", dims: 3 });
    expect(JSON.parse(body).providers.map((p: VectorEntry) => p.id)).toEqual(["M001", "M002"]);
  });

  it("can be empty, for a release with no published providers", () => {
    const { body, dims } = vectorsFileBody({ releaseV: 1, catalogueHash: "b".repeat(64), embedModel: "embed-v4.0", entries: [] });

    expect(dims).toBe(0);
    expect(JSON.parse(body).providers).toEqual([]);
  });

  it("refuses vectors of different sizes, a provider twice and a field it does not know", () => {
    expect(() => vectorsFileBody({ releaseV: 4, catalogueHash: HASH, embedModel: "m", entries: [entry("M001", 3), entry("M002", 4)] })).toThrow();
    expect(() => vectorsFileBody({ releaseV: 4, catalogueHash: HASH, embedModel: "m", entries: [entry("M001"), entry("M001")] })).toThrow();
    expect(VectorsFileSchema.safeParse({ v: 1, release_v: 4, catalogue_hash: HASH, embed_model: "m", dims: 3, providers: [], extra: 1 }).success).toBe(false);
  });
});

describe("the search record of a release", () => {
  const record = {
    embed_model: "embed-v4.0",
    embed_config: { model: "embed-v4.0", input_type: "search_document", embedding_type: "float", dims: null },
    embed_config_key: "model=embed-v4.0;input_type=search_document;embedding_type=float;dims=default",
    vectors_path: "releases/4/vectors.json",
    catalogue_hash: "b".repeat(64),
    release_v: 4,
    vector_count: 99,
    dims: 1536,
    threshold: 0.3,
    emergency_categories: ["Support & Emergency Services"],
    sha256: HASH,
    bytes: 1_800_000,
    reused: 0,
    embedded: 99,
    stored_at: "2026-10-02T15:00:00.000Z",
  };

  it("records the model, vector count, catalogue_hash, threshold and emergency categories", () => {
    expect(ReleaseSearchRecordSchema.parse(record)).toEqual(record);
  });

  it("is not satisfied by the four-field record S02.05 wrote, or by an unknown field", () => {
    expect(ReleaseSearchRecordSchema.safeParse({ embed_model: "m", vectors_path: "p", catalogue_hash: HASH, release_v: 1 }).success).toBe(false);
    expect(ReleaseSearchRecordSchema.safeParse({ ...record, q: "x" }).success).toBe(false);
  });
});

describe("whether a vectors file may go live with a release", () => {
  it("may, when it names the release and catalogue version and covers exactly the providers of every listing", () => {
    expect(vectorsProblems(file([entry("M001"), entry("M002")]), release, listingsOf(["M001", "M002"]))).toEqual([]);
  });

  it("may not for another release number", () => {
    expect(vectorsProblems(file([entry("M001")], { release_v: 9 }), release, listingsOf(["M001"]))).toEqual(["release"]);
  });

  it("may not for another catalogue version", () => {
    expect(vectorsProblems(file([entry("M001")], { catalogue_hash: "c".repeat(64) }), release, listingsOf(["M001"]))).toEqual(["catalogue"]);
  });

  it("may not for another model than the one the release recorded", () => {
    expect(vectorsProblems(file([entry("M001")], { embed_model: "embed-v3.0" }), release, listingsOf(["M001"]))).toEqual(["model"]);
  });

  it("may not when a listing has a provider the vectors lack, or the vectors have one no listing has", () => {
    const problems = vectorsProblems(file([entry("M001"), entry("M009")]), release, listingsOf(["M001", "M002"]));

    expect(problems).toContain("en:missing:M002");
    expect(problems).toContain("en:extra:M009");
    expect(problems.length).toBeLessThanOrEqual(20);
  });

  it("may not when only one language's listing differs", () => {
    const listings = listingsOf(["M001"]).map((l) => (l.lang === "ta" ? { ...l, ids: ["M001", "M002"] } : l));

    expect(vectorsProblems(file([entry("M001")]), release, listings)).toEqual(["ta:missing:M002"]);
  });

  it("may not when a launch language has no listing to check against", () => {
    expect(vectorsProblems(file([entry("M001")]), release, listingsOf(["M001"]).filter((l) => l.lang !== "fr"))).toEqual(["fr:no_listing"]);
  });

  it("says no more than twenty things", () => {
    const ids = Array.from({ length: 40 }, (_, i) => `M${String(i + 1).padStart(3, "0")}`);

    expect(vectorsProblems(file([]), release, listingsOf(ids)).length).toBe(20);
  });
});

describe("the provider ids of a listing file", () => {
  it("reads them in file order, and refuses what is not a listing", () => {
    expect(listingProviderIds(JSON.stringify({ providers: [{ id: "M001" }, { id: "M002" }] }))).toEqual(["M001", "M002"]);
    expect(listingProviderIds("not json")).toBeNull();
    expect(listingProviderIds(JSON.stringify({ providers: "M001" }))).toBeNull();
    expect(listingProviderIds(JSON.stringify({ providers: [{ name: "x" }] }))).toBeNull();
  });
});
