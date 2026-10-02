import { describe, expect, it } from "vitest";
import { neighbourhoodName, neighbourhoodsOf } from "./neighbourhood";

const at = (postal: string | null) => ({ locations: [{ street: "1 Main St", city: "Toronto", postal, lat: 43.7, lng: -79.3 }] });

describe("neighbourhoodsOf", () => {
  it.each([
    ["M4H 1K2", ["TP"]],
    ["m4h1k2", ["TP"]],
    ["M3C 1H9", ["FP"]],
    ["M4C 2L3", []],
    [null, []],
    ["", []],
  ])("puts a provider at postal code %s in %j", (postal, expected) => {
    expect(neighbourhoodsOf(at(postal))).toEqual(expected);
  });

  it("gives every neighbourhood a provider with addresses in both", () => {
    const both = { locations: [...at("M4H 1K2").locations, ...at("M3C 1H9").locations] };
    expect(neighbourhoodsOf(both).sort()).toEqual(["FP", "TP"]);
  });

  it("names the neighbourhoods in English, as the building page does", () => {
    expect(neighbourhoodName("TP")).toBe("Thorncliffe Park");
    expect(neighbourhoodName("FP")).toBe("Flemingdon Park");
  });
});
