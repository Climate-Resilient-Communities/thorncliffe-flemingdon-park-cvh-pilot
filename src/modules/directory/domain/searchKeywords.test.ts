import { describe, expect, it } from "vitest";
import type { DirectoryListingV1 } from "@/contracts/directory";
import { KEYWORD_SATURATION, bm25Scores, buildKeywordIndex, keywordBoosts, keywordDocumentsOf, keywordTokens } from "./searchKeywords";

describe("keywordTokens", () => {
  it("lower-cases, keeps runs of a to z, drops stop words and one-letter words, and takes a plural off", () => {
    expect(keywordTokens("Where can I get FOOD for my kids?")).toEqual(["food", "kid"]);
    expect(keywordTokens("groceries, libraries; classes")).toEqual(["grocery", "library", "classe"]);
    expect(keywordTokens("bus is free")).toEqual(["bus", "free"]); // a word of three letters keeps its s
  });

  it("reads no word of another script", () => {
    expect(keywordTokens("کھانا کہاں ملے گا")).toEqual([]);
    expect(keywordTokens("食物银行")).toEqual([]);
  });
});

describe("BM25 and the boost", () => {
  const index = buildKeywordIndex([
    { id: "A", text: "Flemingdon Food Bank Food Collaboratives free groceries every week" },
    { id: "B", text: "Public Library books computers and free classes for children and adults" },
    { id: "C", text: "Fire Station Support & Emergency Services" },
  ]);

  it("scores only the providers that hold a word of the question, more for a rarer word and for more of it", () => {
    const scores = bm25Scores(index, "free food");

    expect([...scores.keys()].sort()).toEqual(["A", "B"]);
    expect(scores.get("A")!).toBeGreaterThan(scores.get("B")!);
  });

  it("is the same every time, whatever order the question's words come in", () => {
    expect(bm25Scores(index, "food free")).toEqual(bm25Scores(index, "free food"));
    expect(bm25Scores(index, "food food")).toEqual(bm25Scores(index, "food"));
  });

  it("is empty for a question with no English word, or none the providers hold", () => {
    expect(bm25Scores(index, "کھانا")).toEqual(new Map());
    expect(bm25Scores(index, "where can I get it")).toEqual(new Map());
    expect(bm25Scores(buildKeywordIndex([]), "food")).toEqual(new Map());
  });

  it("boosts by weight × bm25 / (bm25 + 4): always below the weight, and nothing at weight 0", () => {
    const scores = bm25Scores(index, "food bank groceries");
    const boosts = keywordBoosts(index, "food bank groceries", 0.15);

    const a = scores.get("A")!;
    expect(boosts.get("A")).toBeCloseTo((0.15 * a) / (a + KEYWORD_SATURATION), 12);
    expect(boosts.get("A")!).toBeLessThan(0.15);
    expect(keywordBoosts(index, "food bank groceries", 0)).toEqual(new Map());
  });
});

describe("keywordDocumentsOf (the release's English listing)", () => {
  const text = (body: string) => ({ lang: "en" as const, body, machine: false, model: null, status: "source" as const, source_hash: "0".repeat(64), original: { lang: "en" as const, body }, review_status: "source" as const, reviewed_on: null });

  it("reads each provider's name, its categories' names, its subcategories and its services, and nothing else", () => {
    const listing: DirectoryListingV1 = {
      v: 1,
      release_v: 3,
      lang: "en",
      catalogue_hash: "0".repeat(64),
      categories: [{ id: "c1", sort_order: 1, name: text("Non-Profits") }],
      providers: [
        {
          id: "M008",
          name: "Flemingdon Food Bank",
          category_ids: ["c1"],
          neighbourhood_ids: [],
          subcategories: [text("Food Collaboratives")],
          locations: [{ street: "10 Gateway Blvd", city: "Toronto", postal: null, lat: 0, lng: 0 }],
          contact: { phone: ["416-555-0100"], email: [], social: [], web: [] },
          services: text("Free groceries."),
          emergency_role: text("Call 911."),
          last_confirmed: "2026-10-01",
        },
      ],
    };

    expect(keywordDocumentsOf(listing)).toEqual([{ id: "M008", text: "Flemingdon Food Bank Non-Profits Food Collaboratives Free groceries." }]);
  });
});
