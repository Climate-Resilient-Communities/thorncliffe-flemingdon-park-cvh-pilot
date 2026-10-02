import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readProviderCatalogue } from "../adapters/catalogueFiles";
import { catalogueTextId } from "../adapters/hash";
import { PROVIDER_ID } from "../domain/providerCatalogue";
import { inToronto } from "@/contracts/torontoBounds";
import { planProviders } from "./seedProviders";

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const plan = planProviders;

describe("the real data/catalogue files (S02.04)", () => {
  const input = readProviderCatalogue(path.join(ROOT, "data", "catalogue"));
  const real = plan(input);

  it("has no failing entry: 99 providers, 8 categories", () => {
    expect(real.failures).toEqual([]);
    expect(real.providers).toHaveLength(99);
    expect(real.categories.map((c) => c.name)).toEqual([
      "Support & Emergency Services",
      "Faith-Based Organizations",
      "Legal & Government Services",
      "Schools & Child Services",
      "Health & Wellness",
      "Public Spaces",
      "Community Resilience",
      "Non-Profits",
    ]);
  });

  it("stores a provider that is in several categories once, linked to each", () => {
    const ids = real.providers.map((p) => p.id);
    expect(new Set(ids).size).toBe(99);
    expect(real.providers.filter((p) => p.categoryIds.length > 1).length).toBe(20);
    expect(real.providers.reduce((sum, p) => sum + p.categoryIds.length, 0)).toBe(real.report.perCategory.reduce((sum, c) => sum + c.providers, 0));
  });

  it("gives every provider an id the audit trail accepts as a subject, and coordinates in Toronto", () => {
    for (const p of real.providers) {
      expect(PROVIDER_ID.test(p.id), p.id).toBe(true);
      expect(inToronto(p.location.lat, p.location.lng), p.id).toBe(true);
    }
  });

  it("loads no translation yet: the catalogue's translations are machine output with no review recorded", () => {
    expect(real.report.translations.loaded).toBe(0);
    expect(real.report.translations.unavailable.every((u) => u.reason === "machine")).toBe(true);
    expect(new Set(real.report.translations.unavailable.map((u) => u.lang))).toEqual(new Set(["ur", "ps", "tl", "prs", "gu", "ta", "el", "sk", "bn", "hi", "pa", "zh", "es", "fr"]));
  });

  it("finds each provider text's id in the translation files (the ids it computes are the ones the build wrote)", () => {
    const catalogueFile = JSON.parse(readFileSync(path.join(ROOT, "data", "catalogue", "providers.json"), "utf8")) as {
      providers: { services: { id: string; en: string }; emergencyRole: { id: string; en: string } | null }[];
    };
    for (const p of catalogueFile.providers) {
      expect(catalogueTextId(p.services.en)).toBe(p.services.id);
      if (p.emergencyRole) expect(catalogueTextId(p.emergencyRole.en)).toBe(p.emergencyRole.id);
    }
  });
});

describe("a catalogue where a language file is missing (S02.04)", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvh-providers-lang-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(ROOT, "data", "catalogue"), dir, { recursive: true });
  rmSync(path.join(dir, "translations", "ur.json"));

  it("reads the other languages and none for the missing one", () => {
    const input = readProviderCatalogue(dir);

    expect(Object.keys(input.translations)).not.toContain("ur");
    expect(Object.keys(input.translations)).toContain("fr");
  });

  it("still loads every provider, with no failing entry, and reports the language as not translated yet", () => {
    const missing = plan(readProviderCatalogue(dir));
    const real = plan(readProviderCatalogue(path.join(ROOT, "data", "catalogue")));

    expect(missing.failures).toEqual([]);
    expect(missing.providers).toHaveLength(99);
    expect(missing.report.translations.unavailable.filter((u) => u.lang === "ur").every((u) => u.reason === "not_translated")).toBe(true);
    expect(missing.report.translations.unavailable.some((u) => u.lang === "ur")).toBe(true);
    // Nothing else changes: the other languages report as they did.
    const others = (r: typeof real) => r.report.translations.unavailable.filter((u) => u.lang !== "ur");
    expect(others(missing)).toEqual(others(real));
    expect(missing.providers.map((p) => p.texts)).toEqual(real.providers.map((p) => p.texts));
  });
});
