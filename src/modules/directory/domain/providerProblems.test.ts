import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildKeywordIndex, keywordBoosts } from "./searchKeywords";
import { parseProviderProblems } from "./providerProblems";

const catalogue = path.join(process.cwd(), "data", "catalogue");
const read = (file: string) => JSON.parse(readFileSync(path.join(catalogue, file), "utf8")) as unknown;
const providers = (read("providers.json") as { providers: { id: string; name: string; categories: string[]; services: { en: string } }[] }).providers;
/** SEARCH_EMERGENCY_CATEGORIES' default: the category whose providers set the 911 block. */
const EMERGENCY_CATEGORY = "Support & Emergency Services";

describe("provider-problems.json (resident testing, session 2, #3)", () => {
  const { reviewed, byProvider } = parseProviderProblems(read("provider-problems.json"));

  it("names every provider of the catalogue, with lines for each one outside the emergency category, and says it is not yet reviewed by the Hub", () => {
    expect(Object.keys(byProvider).sort()).toEqual(providers.map((p) => p.id).sort());
    for (const p of providers) {
      if (p.categories.includes(EMERGENCY_CATEGORY)) continue;
      expect(byProvider[p.id]!.length, p.id).toBeGreaterThan(0);
    }
    expect(reviewed).toBe(false);
  });

  it("gives the emergency category's providers no lines: the 911 block is decided by how close a question is to them (search test set run 4)", () => {
    const emergency = providers.filter((p) => p.categories.includes(EMERGENCY_CATEGORY));
    expect(emergency.length).toBeGreaterThan(0);
    for (const p of emergency) expect(byProvider[p.id], p.id).toEqual([]);
  });

  it("holds no contact details, and no line that would send a resident to a place in an emergency (911 is the crisis phrases' job)", () => {
    for (const [id, lines] of Object.entries(byProvider)) {
      for (const line of lines) {
        expect(line, id).not.toMatch(/\d{3}[-. ]\d{3}|@|https?:|www\./);
        expect(line, id).not.toMatch(/\b911\b|crisis|danger|emergency help|in an emergency/i);
      }
    }
  });

  it("lets a resident's own words reach the right listing: rent help finds The Neighbourhood Organization's rent bank", () => {
    const index = buildKeywordIndex(providers.map((p) => ({ id: p.id, text: [p.name, p.services.en, ...(byProvider[p.id] ?? [])].join(" ") })));
    const boosts = [...keywordBoosts(index, "I can't pay my rent this month", 0.15).entries()].sort((a, b) => b[1] - a[1]);
    expect(boosts.slice(0, 2).map(([id]) => id).sort()).toEqual(["M007", "M049"]);
  });

  it("refuses a file that is not in shape, naming what is wrong", () => {
    expect(() => parseProviderProblems({ reviewed: false, note: "n", notes: {}, providers: { M001: [""] } })).toThrow(/provider-problems.json: providers.M001/);
    expect(() => parseProviderProblems({ reviewed: false, note: "n", providers: {} })).toThrow(/notes/);
  });
});
