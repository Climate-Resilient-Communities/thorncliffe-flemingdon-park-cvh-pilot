import { describe, expect, it } from "vitest";
import { filterProviders, matchesSearch, providerCounts, providersHref, readProviderQuery } from "./filters";

const row = (id: string, name: string, change: { published?: boolean; inCatalogue?: boolean; lastConfirmed?: string | null } = {}) => ({
  id,
  name,
  published: false,
  inCatalogue: true,
  lastConfirmed: null as string | null,
  ...change,
});

const ROWS = [
  row("M001", "Thorncliffe Neighbourhood Office", { published: true, lastConfirmed: "2026-10-02" }),
  row("M002", "Flemingdon Health Centre", { lastConfirmed: "2026-09-20" }),
  row("M003", "East York Food Bank"),
  row("M004", "Café Communautaire"),
  row("M099", "Closed Community Kitchen", { inCatalogue: false, lastConfirmed: "2026-08-15" }),
];

describe("the Providers page's query", () => {
  it("reads the filter and the search, and falls back to All for anything else", () => {
    expect(readProviderQuery({})).toEqual({ filter: "all", q: "" });
    expect(readProviderQuery({ filter: "confirm", q: "  food  " })).toEqual({ filter: "confirm", q: "food" });
    expect(readProviderQuery({ filter: ["hidden", "all"], q: ["bank", "x"] })).toEqual({ filter: "hidden", q: "bank" });
    expect(readProviderQuery({ filter: "deleted" }).filter).toBe("all");
    expect(readProviderQuery({ q: "x".repeat(500) }).q).toHaveLength(100);
  });

  it("links each tab and the search without the defaults, keeping the other part", () => {
    expect(providersHref({ filter: "all", q: "" })).toBe("/staff/providers");
    expect(providersHref({ filter: "confirm", q: "" })).toBe("/staff/providers?filter=confirm");
    expect(providersHref({ filter: "hidden", q: "food bank" })).toBe("/staff/providers?filter=hidden&q=food+bank");
    expect(providersHref({ filter: "all", q: "M00&1" })).toBe("/staff/providers?q=M00%261");
  });
});

describe("the filter tabs", () => {
  it("counts All, To confirm (in the catalogue, no date) and Hidden (in the catalogue, not published)", () => {
    expect(providerCounts(ROWS, "")).toEqual({ all: 5, confirm: 2, hidden: 3 });
  });

  it("shows under each tab only its rows, in their order; a provider out of the catalogue only under All", () => {
    const ids = (filter: "all" | "confirm" | "hidden") => filterProviders(ROWS, { filter, q: "" }).map((r) => r.id);

    expect(ids("all")).toEqual(["M001", "M002", "M003", "M004", "M099"]);
    expect(ids("confirm")).toEqual(["M003", "M004"]);
    expect(ids("hidden")).toEqual(["M002", "M003", "M004"]);
  });

  it("counts over what the search finds", () => {
    expect(providerCounts(ROWS, "comm")).toEqual({ all: 2, confirm: 1, hidden: 1 });
  });
});

describe("the search by name or code", () => {
  it("finds a part of the name, whatever its case or accents, or a part of the code", () => {
    expect(matchesSearch(ROWS[2], "food")).toBe(true);
    expect(matchesSearch(ROWS[2], "FOOD  bank")).toBe(true);
    expect(matchesSearch(ROWS[3], "cafe")).toBe(true);
    expect(matchesSearch(ROWS[0], "m001")).toBe(true);
    expect(matchesSearch(ROWS[0], "food")).toBe(false);
    expect(matchesSearch(ROWS[0], "")).toBe(true);
  });

  it("combines with the tab", () => {
    expect(filterProviders(ROWS, { filter: "hidden", q: "M00" }).map((r) => r.id)).toEqual(["M002", "M003", "M004"]);
    expect(filterProviders(ROWS, { filter: "confirm", q: "health" })).toEqual([]);
  });
});
