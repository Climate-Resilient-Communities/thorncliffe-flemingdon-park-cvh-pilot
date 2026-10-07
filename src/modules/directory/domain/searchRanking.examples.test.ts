// The ranking on questions residents asked the live search, with the similarities embed-v4.0 gave them against the real
// catalogue (the 2026-10-07 experiment's vectors: each question's 12 best providers, to three places; every other provider is
// put at 0.1, below anything the ranking can show) and the keyword index built from the real catalogue. Before the interim
// tuning, "where can I get food?", "food" and "I need food" showed nothing (no similarity reached 0.30), and a shelter among the
// results would have put the 911 block first.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildKeywordIndex, keywordBoosts } from "./searchKeywords";
import { DEFAULT_DIRECT_FLOOR, DEFAULT_DIRECT_GAP, DEFAULT_EMERGENCY_THRESHOLD, DEFAULT_EMERGENCY_TOP_THRESHOLD, DEFAULT_KEYWORD_WEIGHT, emergencyFirst, rankLegs } from "./searchRanking";

interface CatalogueProvider {
  id: string;
  name: string;
  categories: string[];
  subcategories: string[];
  services: { en: string | null } | null;
}
const catalogue = (JSON.parse(readFileSync(path.join(process.cwd(), "data/catalogue/providers.json"), "utf8")) as { providers: CatalogueProvider[] }).providers;
const index = buildKeywordIndex(catalogue.map((p) => ({ id: p.id, text: [p.name, ...p.categories, ...p.subcategories, p.services?.en ?? ""].join(" ") })));
const emergencyProviders = new Set(catalogue.filter((p) => p.categories.includes("Support & Emergency Services")).map((p) => p.id));
const SETTINGS = {
  threshold: 0.27,
  directFloor: DEFAULT_DIRECT_FLOOR,
  directGap: DEFAULT_DIRECT_GAP,
  emergencyThreshold: DEFAULT_EMERGENCY_THRESHOLD,
  emergencyTopThreshold: DEFAULT_EMERGENCY_TOP_THRESHOLD,
};

/** The direct leg of an English question: its best providers' similarities, every other provider at 0.1. */
function legOf(best: Record<string, number>): Map<string, number> {
  return new Map(catalogue.map((p) => [p.id, best[p.id] ?? 0.1]));
}

function ask(q: string, best: Record<string, number>) {
  const legs = [legOf(best)];
  return {
    results: rankLegs(legs, "hybrid", keywordBoosts(index, q, DEFAULT_KEYWORD_WEIGHT), SETTINGS),
    emergency: emergencyFirst(legs, emergencyProviders, SETTINGS),
  };
}

const SIMILARITIES: Record<string, Record<string, number>> = {
  "where can I get food?": { M008: 0.293, M007: 0.282, M071: 0.281, M075: 0.276, M010: 0.265, M073: 0.259, M058: 0.245, M078: 0.238, M072: 0.238, M074: 0.226, M047: 0.223, M040: 0.22 },
  food: { M073: 0.268, M078: 0.267, M071: 0.263, M075: 0.258, M007: 0.253, M074: 0.249, M008: 0.239, M070: 0.219, M092: 0.217, M072: 0.216, M010: 0.215, M076: 0.205 },
  "I need food": { M008: 0.291, M007: 0.268, M071: 0.259, M010: 0.224, M078: 0.215, M075: 0.209, M092: 0.208, M073: 0.203, M049: 0.198, M042: 0.196, M022: 0.19, M047: 0.187 },
  "where can I get food": { M008: 0.301, M007: 0.296, M071: 0.295, M075: 0.281, M073: 0.259, M072: 0.25, M010: 0.249, M078: 0.246, M074: 0.233, M040: 0.226, M058: 0.223, M079: 0.22 },
  "food bank": { M008: 0.444, M071: 0.409, M007: 0.4, M092: 0.32, M075: 0.315, M073: 0.307, M074: 0.302, M072: 0.301, M010: 0.294, M049: 0.288, M078: 0.285, M085: 0.253 },
  groceries: { M071: 0.311, M092: 0.29, M007: 0.285, M075: 0.27, M008: 0.25, M078: 0.236, M057: 0.234, M072: 0.23, M074: 0.23, M073: 0.224, M077: 0.217, M070: 0.209 },
  "how do I renew my passport": { M023: 0.26, M092: 0.229, M080: 0.211, M059: 0.191, M072: 0.18, M049: 0.174, M031: 0.167, M081: 0.163, M033: 0.157, M079: 0.157, M038: 0.155, M061: 0.154 },
  "best pizza delivery near me": { M007: 0.21, M071: 0.202, M087: 0.201, M004: 0.196, M001: 0.196, M002: 0.196, M003: 0.195, M005: 0.19, M006: 0.19, M072: 0.19, M028: 0.184, M047: 0.181 },
  "the kitchen is on fire": { M005: 0.263, M006: 0.263, M003: 0.259, M002: 0.258, M004: 0.255, M055: 0.2, M062: 0.173, M001: 0.168, M037: 0.156, M046: 0.153, M079: 0.152, M092: 0.152 },
  "someone just broke into my car, call the police": { M001: 0.258, M003: 0.222, M002: 0.221, M005: 0.209, M006: 0.209, M004: 0.209, M049: 0.199, M022: 0.185, M007: 0.175, M023: 0.174, M086: 0.172, M069: 0.171 },
};

/** The food bank, The Neighbourhood Organization and its food collaborative: the providers a food question wants first. */
const FOOD = ["M008", "M007", "M071"];

describe("the questions residents asked about food (all showed nothing or one result before the interim tuning)", () => {
  for (const q of ["where can I get food?", "food", "I need food", "where can I get food", "food bank", "groceries"]) {
    it(`"${q}" shows food providers, with a food provider in the first three, and no 911 block`, () => {
      const { results, emergency } = ask(q, SIMILARITIES[q]!);

      expect(results.length).toBeGreaterThanOrEqual(3);
      expect(results.slice(0, 3).some((r) => FOOD.includes(r.provider_id))).toBe(true);
      expect(emergency).toBe(false);
    });
  }

  it("lists the shelter Heyworth House for \"where can I get food?\" without putting the 911 block first", () => {
    const { results, emergency } = ask("where can I get food?", SIMILARITIES["where can I get food?"]!);

    expect(emergencyProviders.has("M010")).toBe(true);
    expect(results.map((r) => r.provider_id)).toContain("M010");
    expect(results[0]!.provider_id).toBe("M008");
    expect(emergency).toBe(false);
  });
});

describe("questions the directory cannot answer", () => {
  it("show nothing, and no 911 block", () => {
    for (const q of ["how do I renew my passport", "best pizza delivery near me"]) {
      expect(ask(q, SIMILARITIES[q]!), q).toEqual({ results: [], emergency: false });
    }
  });
});

describe("emergencies", () => {
  it("a fire or a break-in puts the 911 block first: an emergency provider is the best match, at 0.26", () => {
    expect(ask("the kitchen is on fire", SIMILARITIES["the kitchen is on fire"]!).emergency).toBe(true);
    expect(ask("someone just broke into my car, call the police", SIMILARITIES["someone just broke into my car, call the police"]!).emergency).toBe(true);
  });
});
