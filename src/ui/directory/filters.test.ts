import { describe, expect, it } from "vitest";
import { buildListing } from "../../../e2e/resident/directory-fixture";
import { DirectoryListingV1, type ListingProvider } from "@/contracts/directory";
import { activeKeys, filterKeyId, filterProviders, isActive, listingSubcategories, listProviders, NO_FILTERS, removeFilter, setFilter, subcategoryId } from "./filters";

const providers: ListingProvider[] = DirectoryListingV1.parse(buildListing("en", 7)).providers;
const ids = (list: ListingProvider[]) => list.map((p) => p.id).sort();

describe("filterProviders", () => {
  it("lists everything with no filter on", () => {
    expect(ids(filterProviders(providers, NO_FILTERS))).toEqual(["P101", "P102", "P103", "P104", "P105"]);
  });

  it("takes the chosen categories as alternatives", () => {
    const food = setFilter(NO_FILTERS, { kind: "category", id: "food" }, true);
    expect(ids(filterProviders(providers, food))).toEqual(["P101"]);
    expect(ids(filterProviders(providers, setFilter(food, { kind: "category", id: "health" }, true)))).toEqual(["P101", "P102"]);
  });

  it("filters by the neighbourhoods the release lists for each provider", () => {
    expect(ids(filterProviders(providers, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true)))).toEqual(["P101", "P104"]);
    expect(ids(filterProviders(providers, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "FP" }, true)))).toEqual(["P102", "P105"]);
  });

  it("never reads the address: a provider at an M4H postal code that the list puts in neither neighbourhood is in neither", () => {
    const moved = providers.map((p) => (p.id === "P101" ? { ...p, neighbourhood_ids: [] } : p));

    expect(ids(filterProviders(moved, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true)))).toEqual(["P104"]);
    expect(moved.find((p) => p.id === "P101")!.locations[0].postal).toBe("M4H 1K2");
  });

  it("treats a provider of a listing from before neighbourhood_ids as in no neighbourhood", () => {
    const older = buildListing("en", 3) as { providers: Record<string, unknown>[] };
    older.providers.forEach((p) => delete p.neighbourhood_ids);
    const read = DirectoryListingV1.parse(older).providers;

    expect(ids(filterProviders(read, NO_FILTERS))).toHaveLength(5);
    expect(filterProviders(read, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true))).toEqual([]);
  });

  it("finds a provider the list puts in both neighbourhoods under either, and neighbourhoods chosen together are alternatives", () => {
    const both = providers.map((p) => (p.id === "P103" ? { ...p, neighbourhood_ids: ["TP", "FP"] as ("TP" | "FP")[] } : p));

    expect(ids(filterProviders(both, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true)))).toEqual(["P101", "P103", "P104"]);
    expect(ids(filterProviders(both, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "FP" }, true)))).toEqual(["P102", "P103", "P105"]);
    let both2 = setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true);
    both2 = setFilter(both2, { kind: "neighbourhood", id: "FP" }, true);
    expect(ids(filterProviders(providers, both2))).toEqual(["P101", "P102", "P104", "P105"]);
  });

  it("leaves a provider with no neighbourhood out when a neighbourhood is chosen, and in when none is", () => {
    expect(ids(filterProviders(providers, setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true)))).not.toContain("P103");
    expect(ids(filterProviders(providers, NO_FILTERS))).toContain("P103");
  });

  it("keeps only providers with an emergency role for Helps in an emergency", () => {
    expect(ids(filterProviders(providers, setFilter(NO_FILTERS, { kind: "emergency" }, true)))).toEqual(["P101", "P104"]);
  });

  it("takes the chosen subcategories as alternatives, matched on the English each stands for without case", () => {
    const legal = setFilter(NO_FILTERS, { kind: "subcategory", id: "legal services" }, true);
    expect(ids(filterProviders(providers, legal))).toEqual(["P103"]);
    expect(ids(filterProviders(providers, setFilter(legal, { kind: "subcategory", id: "health clinics" }, true)))).toEqual(["P102", "P103"]);
    // The match reads the English original, so it holds on the Urdu listing too.
    const urdu = DirectoryListingV1.parse(buildListing("ur", 7)).providers;
    expect(ids(filterProviders(urdu, setFilter(NO_FILTERS, { kind: "subcategory", id: "cooling spaces" }, true)))).toEqual(["P104"]);
  });

  it("a subcategory and a topic together all have to hold", () => {
    let state = setFilter(NO_FILTERS, { kind: "category", id: "community" }, true);
    state = setFilter(state, { kind: "subcategory", id: "newcomer supports" }, true);
    expect(ids(filterProviders(providers, state))).toEqual(["P105"]);
    expect(ids(filterProviders(providers, setFilter(state, { kind: "subcategory", id: "libraries" }, true)))).toEqual(["P104", "P105"]);
  });

  it("requires every filter that is on, and finds nothing for a combination no provider fits", () => {
    let state = setFilter(NO_FILTERS, { kind: "neighbourhood", id: "TP" }, true);
    state = setFilter(state, { kind: "emergency" }, true);
    expect(ids(filterProviders(providers, state))).toEqual(["P101", "P104"]);
    state = setFilter(state, { kind: "category", id: "health" }, true);
    expect(filterProviders(providers, state)).toEqual([]);
  });

  it("does not change the list it is given", () => {
    const before = providers.map((p) => p.id);
    filterProviders(providers, setFilter(NO_FILTERS, { kind: "emergency" }, true));
    expect(providers.map((p) => p.id)).toEqual(before);
  });
});

describe("filter state", () => {
  it("lists the filters that are on in a fixed order, each removable, and Clear all is the empty state", () => {
    let state = setFilter(NO_FILTERS, { kind: "emergency" }, true);
    state = setFilter(state, { kind: "neighbourhood", id: "FP" }, true);
    state = setFilter(state, { kind: "subcategory", id: "cooling spaces" }, true);
    state = setFilter(state, { kind: "category", id: "food" }, true);
    expect(activeKeys(state).map(filterKeyId)).toEqual(["category:food", "subcategory:cooling spaces", "neighbourhood:FP", "emergency"]);
    expect(isActive(state, { kind: "emergency" })).toBe(true);
    expect(isActive(state, { kind: "subcategory", id: "cooling spaces" })).toBe(true);
    expect(activeKeys(removeFilter(state, { kind: "subcategory", id: "cooling spaces" })).map(filterKeyId)).toEqual(["category:food", "neighbourhood:FP", "emergency"]);
    expect(activeKeys(NO_FILTERS)).toEqual([]);
  });

  it("turning a filter on twice keeps it once", () => {
    const twice = setFilter(setFilter(NO_FILTERS, { kind: "category", id: "food" }, true), { kind: "category", id: "food" }, true);
    expect(twice.categories).toEqual(["food"]);
  });
});

describe("listingSubcategories", () => {
  it("lists each subcategory of the release once, named across languages by the English it stands for, by name in the order of the language", () => {
    const listed = listingSubcategories(providers, "en");
    expect(listed.map((sub) => sub.id)).toEqual(["cooling spaces", "food collaboratives", "health clinics", "legal services", "libraries", "newcomer supports"]);
    expect(listed.map((sub) => sub.name.body)).toEqual(["Cooling Spaces", "Food Collaboratives", "Health Clinics", "Legal Services", "Libraries", "Newcomer Supports"]);
    const doubled = listingSubcategories([...providers, ...providers], "en");
    expect(doubled.map((sub) => sub.id)).toEqual(listed.map((sub) => sub.id));
  });

  it("carries the words of the page language, while the id stays the English", () => {
    const urdu = DirectoryListingV1.parse(buildListing("ur", 7)).providers;
    const cooling = listingSubcategories(urdu, "ur").find((sub) => sub.id === "cooling spaces")!;
    expect(cooling.name.body).toBe("ٹھنڈک کی جگہیں");
  });

  it("narrows the choices to the chosen topics, keeping a chosen subcategory listed so it can be taken back", () => {
    expect(listingSubcategories(providers, "en", ["food"]).map((sub) => sub.id)).toEqual(["food collaboratives"]);
    expect(listingSubcategories(providers, "en", ["food"], ["legal services"]).map((sub) => sub.id)).toEqual(["food collaboratives", "legal services"]);
    expect(listingSubcategories(providers, "en", [], ["legal services"]).map((sub) => sub.id)).toEqual(listingSubcategories(providers, "en").map((sub) => sub.id));
  });

  it("subcategoryId is the trimmed English without case, so a renamed translation keeps its filter", () => {
    const sub = providers.find((p) => p.id === "P104")!.subcategories[1];
    expect(subcategoryId(sub)).toBe("cooling spaces");
    expect(subcategoryId({ ...sub, original: { lang: "en", body: "  Cooling Spaces " } })).toBe("cooling spaces");
  });
});

describe("listProviders", () => {
  it("lists each provider once and by name", () => {
    const doubled = [...providers, { ...providers[0], name: "Zzz copy" }];
    const listed = listProviders(doubled, "en");
    expect(listed.map((p) => p.id)).toEqual(["P105", "P103", "P102", "P104", "P101"]);
    expect(new Set(listed.map((p) => p.id)).size).toBe(listed.length);
  });
});
