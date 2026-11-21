import { describe, expect, it } from "vitest";
import { CLOSEST_MAX, closestCatalogueOf, closestIdsOf, closestPrompt } from "./closestMatches";

const listing = {
  categories: [
    { id: "c1", name: { body: "Non-Profits" } },
    { id: "c2", name: { body: "Legal & Government Services" } },
  ],
  providers: [
    { id: "M007", name: "The Neighbourhood Organization (TNO)", category_ids: ["c1"], subcategories: [{ body: "Settlement" }], helps_with: ["can't pay my rent this month", "need help with my rent"] },
    { id: "M022", name: "Don Valley | Legal\nServices", category_ids: ["c2"], subcategories: [{ body: "Legal Services" }], helps_with: null },
  ],
};
const known = new Set(["M007", "M022", "M049"]);

describe("closest matches (session 2, #3)", () => {
  it("gives the model one line per provider: id, name, categories, subcategories and what it helps with, nothing else", () => {
    expect(closestCatalogueOf(listing).split("\n")).toEqual([
      "M007 | The Neighbourhood Organization (TNO) | Non-Profits | Settlement; can't pay my rent this month; need help with my rent",
      "M022 | Don Valley Legal Services | Legal & Government Services | Legal Services",
    ]);
  });

  it("sends the question and the list, asks for JSON, and says an empty answer beats a wrong one", () => {
    const prompt = closestPrompt('no puedo pagar "el alquiler"\n', closestCatalogueOf(listing));
    expect(prompt).toContain(`"no puedo pagar 'el alquiler'"`);
    expect(prompt).toContain("M007 | The Neighbourhood Organization");
    expect(prompt).toContain(`at most ${CLOSEST_MAX}`);
    expect(prompt).toMatch(/an empty answer is better than a wrong one/);
  });

  it("reads only the release's providers from the answer, in its order, without repeats, at most three", () => {
    expect(closestIdsOf('{"ids": ["M022", "M007"]}', known)).toEqual(["M022", "M007"]);
    expect(closestIdsOf('```json\n{"ids": ["M999", "M007", "M007"]}\n```', known)).toEqual(["M007"]);
    expect(closestIdsOf('{"ids": ["M007", "M022", "M049", "M007"]}', new Set([...known, "M050"]))).toEqual(["M007", "M022", "M049"]);
    expect(closestIdsOf('{"ids": []}', known)).toEqual([]);
  });

  it("reads nothing from a broken answer, prose that holds a JSON object, or ids of another type", () => {
    expect(closestIdsOf("{not json M007}", known)).toEqual([]);
    expect(closestIdsOf('{"ids": [7, null]}', known)).toEqual([]);
    expect(closestIdsOf("I think M007 could help.", known)).toEqual(["M007"]);
    expect(closestIdsOf("", known)).toEqual([]);
  });
});
