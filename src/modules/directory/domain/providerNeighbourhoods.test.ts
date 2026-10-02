import { describe, expect, it } from "vitest";
import { parseProviderNeighbourhoods } from "./providerNeighbourhoods";

const file = (change: Record<string, unknown> = {}) => ({
  reviewed: false,
  note: "Not yet reviewed.",
  rule: "M4H: TP.",
  providers: { M001: ["TP"], M002: ["FP", "TP"], M003: [] },
  ...change,
});

describe("parseProviderNeighbourhoods", () => {
  it("reads each provider's neighbourhoods, each once and in the order TP, FP, and says whether the Hub has reviewed the list", () => {
    const parsed = parseProviderNeighbourhoods(file({ providers: { M001: ["TP"], M002: ["FP", "TP", "FP"], M003: [] } }));

    expect(parsed.reviewed).toBe(false);
    expect(parsed.byProvider).toEqual({ M001: ["TP"], M002: ["TP", "FP"], M003: [] });
    expect(parseProviderNeighbourhoods(file({ reviewed: true })).reviewed).toBe(true);
  });

  it.each([
    ["a neighbourhood that is not one of the pilot's", { providers: { M001: ["XX"] } }, "providers.M001.0"],
    ["a provider id that is not an id", { providers: { nope: ["TP"] } }, "providers"],
    ["a neighbourhood that is not a list", { providers: { M001: "TP" } }, "providers.M001"],
    ["a reviewed that is not true or false", { reviewed: "yes" }, "reviewed"],
    ["no note", { note: undefined }, "note"],
    ["a field it does not know", { signed_off_by: "x" }, "(file)"],
  ])("refuses %s, and names where", (_name, change, where) => {
    expect(() => parseProviderNeighbourhoods(file(change))).toThrow(where);
  });

  it("refuses a file that is not an object", () => {
    expect(() => parseProviderNeighbourhoods(null)).toThrow("provider-neighbourhoods.json");
    expect(() => parseProviderNeighbourhoods([])).toThrow("provider-neighbourhoods.json");
  });
});
