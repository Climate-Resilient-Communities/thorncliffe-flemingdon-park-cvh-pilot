import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  formatProviderFailures,
  formatProviderReport,
  planProviderCatalogue,
  type ProviderCatalogueInput,
  type ProviderTranslationRecord,
} from "./providerCatalogue";
import { TORONTO_BOUNDS, inToronto } from "@/contracts/torontoBounds";

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const sourceHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const catalogueTextId = (text: string) => createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);
const options = { hash: sourceHash, textId: catalogueTextId };
const plan = (input: ProviderCatalogueInput) => planProviderCatalogue(input, options);

const label = (en: string) => ({ id: catalogueTextId(en), en });
const LABELS = {
  categories: { "Health & Wellness": label("Health & Wellness"), "Non-Profits": label("Non-Profits") },
  subcategories: { "Health Clinics": label("Health Clinics"), "Newcomer Supports": label("Newcomer Supports") },
};

function provider(id: string, change: Record<string, unknown> = {}) {
  return {
    id,
    name: `Provider ${id}`,
    categories: ["Health & Wellness"],
    subcategories: ["Health Clinics"],
    address: { street: "1 Overlea Blvd", city: "East York", postal: "M4H 1C6" },
    location: { lat: 43.7, lng: -79.34 },
    contact: { phone: ["416-555-0100"], email: [], social: [], web: ["https://example.org/"] },
    services: { id: "x", en: `Services of ${id}` },
    emergencyRole: null,
    sourceNotes: [],
    lastConfirmed: null,
    ...change,
  };
}

function catalogue(providers: unknown[], labels: unknown = LABELS) {
  return { meta: {}, labels, providers };
}

const reviewed = (english: string, text: string, change: Partial<ProviderTranslationRecord> = {}): ProviderTranslationRecord => ({
  source: english,
  text,
  model: "command-a-translate-08-2025",
  status: "reviewed",
  reviewer: "Wei Chen",
  reviewedOn: "2026-11-02",
  ...change,
});

const translation = (english: string, record: ProviderTranslationRecord) => ({ texts: { [catalogueTextId(english)]: record } });

describe("planProviderCatalogue: a valid catalogue", () => {
  it("plans each provider once, with its categories, location, contact and the English text", () => {
    const result = plan({
      catalogue: catalogue([provider("M001", { categories: ["Health & Wellness", "Non-Profits"], emergencyRole: { id: "y", en: "Call 911." } }), provider("M002")]),
      translations: {},
    });

    expect(result.failures).toEqual([]);
    expect(result.providers.map((p) => p.id)).toEqual(["M001", "M002"]);
    expect(result.providers[0]).toMatchObject({
      name: "Provider M001",
      categoryIds: [LABELS.categories["Health & Wellness"].id, LABELS.categories["Non-Profits"].id],
      location: { street: "1 Overlea Blvd", city: "East York", postal: "M4H 1C6", lat: 43.7, lng: -79.34 },
      contact: { phone: ["416-555-0100"], web: ["https://example.org/"] },
      texts: { services: { en: "Services of M001" }, emergency_role: { en: "Call 911." } },
    });
    expect(result.providers[1].texts).toEqual({ services: { en: "Services of M002" } });
    expect(result.categories.map((c) => [c.name, c.sortOrder])).toEqual([
      ["Health & Wellness", 0],
      ["Non-Profits", 1],
    ]);
    expect(result.report.perCategory).toEqual([
      { name: "Health & Wellness", providers: 2 },
      { name: "Non-Profits", providers: 1 },
    ]);
  });

  it("ignores lastConfirmed in the file: the Admins own that date", () => {
    const result = plan({ catalogue: catalogue([provider("M001", { lastConfirmed: "2026-01-01" })]), translations: {} });

    expect(result.failures).toEqual([]);
    expect(JSON.stringify(result.providers)).not.toContain("2026-01-01");
  });

  it("treats a missing postal code as null and keeps research notes for staff", () => {
    const result = plan({ catalogue: catalogue([provider("M001", { address: { street: "1 Main St", city: "East York", postal: null }, sourceNotes: ["page would not load"] })]), translations: {} });

    expect(result.providers[0].location.postal).toBeNull();
    expect(result.providers[0].sourceNotes).toEqual(["page would not load"]);
  });
});

describe("planProviderCatalogue: failures load nothing and list every failing entry", () => {
  it.each([
    ["a missing id", provider("M001", { id: undefined }), "providers[0]: id: is missing"],
    ["an empty id", provider("M001", { id: "" }), "providers[0]: id: must be a letter and 3 to 6 digits"],
    ["an id of the wrong shape", provider("m1"), "providers[0] (m1): id: must be a letter and 3 to 6 digits"],
    ["a latitude outside Toronto", provider("M001", { location: { lat: 44.5, lng: -79.34 } }), "providers[0] (M001): location.lat: is outside Toronto (43.58 to 43.86)"],
    ["a longitude outside Toronto", provider("M001", { location: { lat: 43.7, lng: -80.1 } }), "providers[0] (M001): location.lng: is outside Toronto (-79.64 to -79.11)"],
    ["missing coordinates", provider("M001", { location: undefined }), "providers[0] (M001): location: (the coordinates) is missing"],
    ["coordinates that are not numbers", provider("M001", { location: { lat: "43.7", lng: -79.3 } }), "location.lat: is missing or not a number"],
    ["a category that is not in labels", provider("M001", { categories: ["Spaceships"] }), 'providers[0] (M001): category "Spaceships" is not in labels.categories'],
    ["no category", provider("M001", { categories: [] }), "providers[0] (M001): categories: has no category"],
    ["a subcategory that is not in labels", provider("M001", { subcategories: ["Moon bases"] }), 'subcategory "Moon bases" is not in labels.subcategories'],
    ["a category twice", provider("M001", { categories: ["Non-Profits", "Non-Profits"] }), "categories: lists a category twice"],
    ["a blank name", provider("M001", { name: "  " }), "providers[0] (M001): name: is empty"],
    ["no English text", provider("M001", { services: { id: "x", en: "" } }), "providers[0] (M001): services.en: is empty"],
    ["no street", provider("M001", { address: { street: "", city: "East York" } }), "providers[0] (M001): address.street: is empty"],
  ])("refuses %s", (_, entry, failure) => {
    const result = plan({ catalogue: catalogue([entry]), translations: {} });

    expect(result.providers).toEqual([]);
    expect(result.categories).toEqual([]);
    expect(result.failures.join("\n")).toContain(failure);
  });

  it("names every provider that is used twice, at each position", () => {
    const result = plan({ catalogue: catalogue([provider("M001"), provider("M002"), provider("M001"), provider("M001")]), translations: {} });

    expect(result.providers).toEqual([]);
    expect(result.failures).toEqual([
      "providers[0] (M001): id M001 is used 3 times (providers[0], providers[2], providers[3])",
      "providers[2] (M001): id M001 is used 3 times (providers[0], providers[2], providers[3])",
      "providers[3] (M001): id M001 is used 3 times (providers[0], providers[2], providers[3])",
    ]);
  });

  it("lists every failing entry, not just the first, and also the valid ones are not loaded", () => {
    const result = plan({
      catalogue: catalogue([
        provider("M001"),
        provider("M002", { id: undefined }),
        provider("M003", { categories: ["Spaceships"], location: { lat: 10, lng: 10 } }),
        provider("M004"),
        provider("M004"),
      ]),
      translations: {},
    });

    expect(result.providers).toEqual([]);
    expect(result.failures).toEqual([
      "providers[1]: id: is missing",
      "providers[2] (M003): location.lat: is outside Toronto (43.58 to 43.86)",
      "providers[2] (M003): location.lng: is outside Toronto (-79.64 to -79.11)",
      'providers[2] (M003): category "Spaceships" is not in labels.categories',
      "providers[3] (M004): id M004 is used 2 times (providers[3], providers[4])",
      "providers[4] (M004): id M004 is used 2 times (providers[3], providers[4])",
    ]);
  });

  it("refuses a file that is not a catalogue", () => {
    expect(plan({ catalogue: null, translations: {} }).failures).toEqual(["providers.json is not an object with `labels` and `providers`"]);
    expect(plan({ catalogue: { labels: LABELS }, translations: {} }).failures).toEqual(["providers: is missing or not a list"]);
    expect(plan({ catalogue: { labels: LABELS, providers: [] }, translations: {} }).failures).toEqual(["providers: is empty"]);
    expect(plan({ catalogue: { providers: [provider("M001")] }, translations: {} }).failures).toEqual(["labels: is missing"]);
  });

  it("refuses two categories with the same id", () => {
    const labels = { ...LABELS, categories: { A: { id: "same", en: "A" }, B: { id: "same", en: "B" } } };
    const result = plan({ catalogue: catalogue([provider("M001", { categories: ["A"] })], labels), translations: {} });

    expect(result.failures).toEqual(['labels.categories.B: id same is also the id of "A"']);
  });

  it("formats the failures one per line", () => {
    expect(formatProviderFailures(["a", "b"])).toEqual(["REFUSED, nothing loaded: 2 failing entries", "  - a", "  - b"]);
    expect(formatProviderFailures(["a"])[0]).toBe("REFUSED, nothing loaded: 1 failing entry");
  });
});

describe("planProviderCatalogue: translations (reviewed and current only, as S02.09)", () => {
  const SERVICES = "Services of M001";

  it("loads a reviewed, current translation of a provider text, a category and a subcategory, with where it came from", () => {
    const result = plan({
      catalogue: catalogue([provider("M001")]),
      translations: {
        ur: {
          texts: {
            ...translation(SERVICES, reviewed(SERVICES, "خدمات")).texts,
            ...translation("Health & Wellness", reviewed("Health & Wellness", "صحت")).texts,
            ...translation("Health Clinics", reviewed("Health Clinics", "کلینک")).texts,
          },
        },
      },
    });

    expect(result.providers[0].texts.services).toEqual({ en: SERVICES, ur: "خدمات" });
    expect(result.providers[0].translations.services.ur).toEqual({
      model: "command-a-translate-08-2025",
      status: "reviewed",
      reviewer: "Wei Chen",
      reviewedOn: "2026-11-02",
      sourceHash: sourceHash(SERVICES),
    });
    expect(result.categories[0].labels).toEqual({ en: "Health & Wellness", ur: "صحت" });
    expect(result.providers[0].subcategories).toEqual([{ name: "Health Clinics", labels: { en: "Health Clinics", ur: "کلینک" } }]);
    expect(result.report.translations.loaded).toBe(3);
  });

  it.each([
    ["a reviewed translation of English that has changed since", reviewed("Older services text", "x"), "stale"],
    ["a reviewed record with a placeholder reviewer", reviewed(SERVICES, "x", { reviewer: "PLACEHOLDER reviewer" }), "review_incomplete"],
    ["a reviewed record with no review date", reviewed(SERVICES, "x", { reviewedOn: null }), "review_incomplete"],
    ["a record with no text", reviewed(SERVICES, ""), "incomplete_record"],
    ["a record with no model", reviewed(SERVICES, "x", { model: "" }), "incomplete_record"],
    ["a record that does not say what it translated", reviewed(SERVICES, "x", { source: undefined }), "incomplete_record"],
  ])("does not load %s: the text stays English, and the report says why", (_, record, reason) => {
    const result = plan({ catalogue: catalogue([provider("M001")]), translations: { ur: { texts: { [catalogueTextId(SERVICES)]: record } } } });

    expect(result.failures).toEqual([]);
    expect(result.providers[0].texts.services).toEqual({ en: SERVICES });
    expect(result.providers[0].translations).toEqual({});
    expect(result.report.translations.loaded).toBe(0);
    expect(result.report.translations.unavailable).toContainEqual({ lang: "ur", reason, count: 1 });
  });

  it("counts a null translation, like a missing one, as not translated yet (the text, 2 categories and a subcategory here)", () => {
    const result = plan({ catalogue: catalogue([provider("M001")]), translations: { ur: { texts: { [catalogueTextId(SERVICES)]: null } } } });

    expect(result.report.translations.unavailable).toContainEqual({ lang: "ur", reason: "not_translated", count: 4 });
  });

  it("does not load a translation that lost 911 where the English has it", () => {
    const english = "Call 911 for emergencies.";
    const result = plan({
      catalogue: catalogue([provider("M001", { services: { id: "x", en: english } })]),
      translations: { es: translation(english, reviewed(english, "Llame a emergencias.")) },
    });

    expect(result.providers[0].texts.services).toEqual({ en: english });
    expect(result.report.translations.unavailable).toContainEqual({ lang: "es", reason: "lost_required", count: 1 });
  });

  it("reads no zh-Hant file: the release converts reviewed zh (S02.05)", () => {
    const result = plan({
      catalogue: catalogue([provider("M001")]),
      translations: { "zh-Hant": translation(SERVICES, reviewed(SERVICES, "服務")) },
    });

    expect(result.providers[0].texts.services).toEqual({ en: SERVICES });
    expect(result.report.translations.unavailable.some((u) => u.lang === "zh-Hant")).toBe(false);
  });

  it("reports the counts per reason and language", () => {
    const result = plan({ catalogue: catalogue([provider("M001")]), translations: { ur: translation("Health Clinics", { source: "Health Clinics", text: "x", model: "m" }) } });
    const lines = formatProviderReport(result.report);

    expect(lines[0]).toBe("Providers: 1 in 2 categories");
    expect(lines).toContain("Translations loaded (reviewed and current): 0");
    expect(lines).toContain("Machine translations of descriptions loaded, not reviewed, shown labelled: 0");
    expect(lines.join("\n")).toMatch(/machine translation, no review recorded \(only descriptions may load unreviewed\) \(ur 1\)/);
    expect(lines.join("\n")).toMatch(/not translated yet/);
  });
});

describe("planProviderCatalogue: unreviewed machine translations of descriptions (AD-11 pilot change, 2026-10-03)", () => {
  const SERVICES = "Free drop-in at 1 Overlea Blvd, M4H 1C6: Mon-Fri 9:30-4:30, call 416-555-0100 or see example.org.";
  const ROLE = "Warm room during cold alerts. Call 911 in danger.";
  const machine = (english: string, text: string, change: Partial<ProviderTranslationRecord> = {}): ProviderTranslationRecord => ({
    source: english,
    text,
    model: "north-small-translate-09-2026",
    ...change,
  });
  const PS = "په 1 Overlea Blvd, M4H 1C6 کې وړیا: Mon-Fri 9:30-4:30، 416-555-0100 ته زنګ ووهئ یا example.org وګورئ.";
  const one = (records: Partial<Record<string, ProviderTranslationRecord>>, change: Record<string, unknown> = {}) =>
    plan({
      catalogue: catalogue([provider("M001", { services: { id: "x", en: SERVICES }, ...change })]),
      translations: Object.fromEntries(Object.entries(records).map(([lang, record]) => [lang, translation(SERVICES, record!)])),
    });

  it("loads a current machine translation of a description, in Pashto too, as `machine` with no reviewer, and the report counts it apart", () => {
    const result = one({ ps: machine(SERVICES, PS), fr: machine(SERVICES, "Accueil gratuit au 1 Overlea Blvd, M4H 1C6 : lun-ven 9:30-4:30, appelez le 416-555-0100 ou voyez example.org.") });

    expect(result.providers[0].texts.services).toMatchObject({ en: SERVICES, ps: PS });
    expect(result.providers[0].translations.services.ps).toEqual({ model: "north-small-translate-09-2026", status: "machine", sourceHash: sourceHash(SERVICES) });
    expect(result.providers[0].withheld).toEqual({});
    expect(result.report.translations.loaded).toBe(0);
    expect(result.report.translations.machine).toEqual([
      { lang: "ps", count: 1 },
      { lang: "fr", count: 1 },
    ]);
    expect(formatProviderReport(result.report)).toContain("Machine translations of descriptions loaded, not reviewed, shown labelled: 2 (ps 1, fr 1)");
  });

  it("keeps a reviewed translation reviewed: counted as reviewed, not as machine", () => {
    const result = one({ ps: reviewed(SERVICES, PS) });

    expect(result.providers[0].translations.services.ps).toMatchObject({ status: "reviewed", reviewer: "Wei Chen" });
    expect(result.report.translations.loaded).toBe(1);
    expect(result.report.translations.machine).toEqual([]);
  });

  it("does not load a stale machine translation: the English changed since, so the English shows", () => {
    const result = one({ ps: machine("Free drop-in, older text.", PS) });

    expect(result.providers[0].texts.services).toEqual({ en: SERVICES });
    expect(result.providers[0].withheld).toEqual({ services: { ps: "stale" } });
    expect(result.report.translations.unavailable).toContainEqual({ lang: "ps", reason: "stale", count: 1 });
  });

  it.each([
    ["a changed phone number", PS.replace("416-555-0100", "416-555-0101")],
    ["a dropped phone number", PS.replace("416-555-0100", "")],
    ["a changed postal code", PS.replace("M4H 1C6", "M4H 1C9")],
    ["a changed web address", PS.replace("example.org", "example.com")],
    ["a changed time", PS.replace("9:30", "9:00")],
    ["a changed street number", PS.replace("1 Overlea", "11 Overlea")],
    ["a number the English does not have", `${PS} 24`],
  ])("does not load a machine translation with %s: the English shows (facts_changed)", (_, text) => {
    const result = one({ ps: machine(SERVICES, text) });

    expect(result.providers[0].texts.services).toEqual({ en: SERVICES });
    expect(result.providers[0].translations).toEqual({});
    expect(result.providers[0].withheld).toEqual({ services: { ps: "facts_changed" } });
    expect(result.report.translations.machine).toEqual([]);
    expect(result.report.translations.unavailable).toContainEqual({ lang: "ps", reason: "facts_changed", count: 1 });
  });

  it("does not load an emergency role, a category or a subcategory name unless reviewed, however good the machine text", () => {
    const result = plan({
      catalogue: catalogue([provider("M001", { emergencyRole: { id: "y", en: ROLE } })]),
      translations: {
        ps: {
          texts: {
            ...translation(ROLE, machine(ROLE, "د سړو خبرتیاوو پر مهال تود ځای. په خطر کې 911 ته زنګ ووهئ.")).texts,
            ...translation("Health & Wellness", machine("Health & Wellness", "روغتیا")).texts,
            ...translation("Health Clinics", machine("Health Clinics", "کلینیکونه")).texts,
          },
        },
      },
    });

    expect(result.providers[0].texts.emergency_role).toEqual({ en: ROLE });
    expect(result.providers[0].withheld.emergency_role).toEqual({ ps: "machine" });
    expect(result.categories[0].labels).toEqual({ en: "Health & Wellness" });
    expect(result.providers[0].subcategories[0].labels).toEqual({ en: "Health Clinics" });
    expect(result.report.translations.unavailable).toContainEqual({ lang: "ps", reason: "machine", count: 3 });
  });

  it("carries machineChecks along but never as a review: no reviewer, no date, status machine", () => {
    const result = one({ ps: machine(SERVICES, PS, { machineChecks: ["automated", "back_translation", "made up"] }) });

    expect(result.providers[0].translations.services.ps).toEqual({
      model: "north-small-translate-09-2026",
      status: "machine",
      sourceHash: sourceHash(SERVICES),
      machineChecks: ["automated", "back_translation"],
    });
  });

  it("does not take a record marked reviewed with machine checks but no reviewer as reviewed or as machine", () => {
    const result = one({ ps: machine(SERVICES, PS, { status: "reviewed", machineChecks: ["automated", "line_review", "back_translation", "claude_correction"] }) });

    expect(result.providers[0].texts.services).toEqual({ en: SERVICES });
    expect(result.report.translations.unavailable).toContainEqual({ lang: "ps", reason: "review_incomplete", count: 1 });
  });

  it("still requires 911 where the English has it", () => {
    const english = "Call 911 in an emergency; otherwise 416-555-0100.";
    const result = plan({
      catalogue: catalogue([provider("M001", { services: { id: "x", en: english } })]),
      translations: { es: translation(english, machine(english, "Llame al 416-555-0100.")) },
    });

    expect(result.providers[0].texts.services).toEqual({ en: english });
    expect(result.report.translations.unavailable).toContainEqual({ lang: "es", reason: "lost_required", count: 1 });
  });
});

describe("the Toronto bounding box", () => {
  it("accepts the Hub's neighbourhood and refuses points outside the box", () => {
    expect(inToronto(43.7, -79.34)).toBe(true);
    expect(inToronto(TORONTO_BOUNDS.minLat, TORONTO_BOUNDS.minLng)).toBe(true);
    expect(inToronto(45.4, -75.7)).toBe(false);
    expect(inToronto(43.7, -80.5)).toBe(false);
    expect(inToronto(Number.NaN, -79.3)).toBe(false);
  });

  it("is the box the provider_location check constraint states", () => {
    const sql = readFileSync(path.join(ROOT, "db", "migrations", "20261002200000_provider_catalogue.sql"), "utf8");
    const { minLat, maxLat, minLng, maxLng } = TORONTO_BOUNDS;

    expect(sql).toContain(`lat between ${minLat} and ${maxLat} and lng between ${minLng} and ${maxLng}`);
  });
});
