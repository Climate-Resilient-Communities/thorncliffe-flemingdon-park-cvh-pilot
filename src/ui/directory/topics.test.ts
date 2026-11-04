import { describe, expect, it } from "vitest";
import { buildListing } from "../../../e2e/resident/directory-fixture";
import { DirectoryListingV1 } from "@/contracts/directory";
import { filterProviders, NO_FILTERS } from "./filters";
import { inTopic, isTopicId, TOPICS, topicsOf } from "./topics";

const providers = DirectoryListingV1.parse(buildListing("en", 7)).providers;
const urdu = DirectoryListingV1.parse(buildListing("ur", 7)).providers;
const ids = (topic: string, list = providers) => filterProviders(list, { ...NO_FILTERS, topics: [topic] }).map((p) => p.id).sort();

describe("Find help's topics (R-09)", () => {
  it("are the prototype's ten, in its order", () => {
    expect(TOPICS.map((t) => t.id)).toEqual(["food", "housing", "health", "money", "settlement", "jobs", "children", "seniors", "legal", "mentalHealth"]);
    expect(isTopicId("food")).toBe(true);
    expect(isTopicId("b0e486b1a83e")).toBe(false);
  });

  it("take a provider by its subcategories' English, whatever the page language", () => {
    expect(ids("food")).toEqual(["P101"]);
    expect(ids("health")).toEqual(["P102"]);
    expect(ids("legal")).toEqual(["P103"]);
    expect(ids("settlement")).toEqual(["P105"]);
    expect(ids("food", urdu)).toEqual(["P101"]);
  });

  it("take a provider by id, and a topic with no provider in the release is not offered", () => {
    expect(inTopic("housing", { id: "M022", subcategories: [] })).toBe(true);
    expect(inTopic("housing", { id: "M999", subcategories: [] })).toBe(false);
    expect(inTopic("nope", { id: "M022", subcategories: [] })).toBe(false);
    expect(topicsOf(providers).map((t) => t.id)).toEqual(["food", "health", "settlement", "legal"]);
  });

  it("are alternatives, and hold with the other filters", () => {
    expect(filterProviders(providers, { ...NO_FILTERS, topics: ["food", "legal"] }).map((p) => p.id).sort()).toEqual(["P101", "P103"]);
    expect(filterProviders(providers, { ...NO_FILTERS, topics: ["food"], neighbourhoods: ["FP"] })).toEqual([]);
  });
});
