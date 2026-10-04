// Where an alert is, in words (S05.08): neighbourhood names, building addresses (the first few, then a count), nothing when nothing can be named.
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { PLACE_ADDRESSES_SHOWN, placeLine } from "./place";
import { translatorFor } from "./alert-test-helpers";

const t = translatorFor("en");
const addresses = new Map([
  ["1", "4 Milepost Pl"],
  ["2", "85-95 Thorncliffe Park Dr"],
  ["3", "10 Overlea Blvd"],
  ["4", "1 Gateway Blvd"],
  ["5", " "],
]);
const buildings = (...rsns: string[]): Audience => ({ scope: "buildings", buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["elevator"] });
const neighbourhoods = (...ids: string[]): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: [], types: ["power"] });

describe("the place of an alert", () => {
  it("is the neighbourhood's name, or the names of several in the language's way of listing", () => {
    expect(placeLine(neighbourhoods("TP"), new Map(), "en", t)).toBe("Thorncliffe Park");
    expect(placeLine(neighbourhoods("FP", "TP"), new Map(), "en", t)).toBe("Flemingdon Park and Thorncliffe Park");
  });

  it("leaves out a neighbourhood the catalog does not name, and is null when none is named", () => {
    expect(placeLine(neighbourhoods("TP", "ZZ"), new Map(), "en", t)).toBe("Thorncliffe Park");
    expect(placeLine(neighbourhoods("ZZ"), new Map(), "en", t)).toBeNull();
  });

  it("is the address of a building, or the addresses of a few", () => {
    expect(placeLine(buildings("1"), addresses, "en", t)).toBe("4 Milepost Pl");
    expect(placeLine(buildings("1", "2"), addresses, "en", t)).toBe("4 Milepost Pl and 85-95 Thorncliffe Park Dr");
    expect(placeLine(buildings("1", "2", "3"), addresses, "en", t)).toBe("4 Milepost Pl, 85-95 Thorncliffe Park Dr, and 10 Overlea Blvd");
  });

  it("names the first few and counts the rest", () => {
    expect(PLACE_ADDRESSES_SHOWN).toBe(3);
    expect(placeLine(buildings("1", "2", "3", "4"), addresses, "en", t)).toBe("4 Milepost Pl, 85-95 Thorncliffe Park Dr, 10 Overlea Blvd and 1 more");
    expect(placeLine(buildings("1", "2", "3", "4", "7", "8"), addresses, "en", t)).toBe("4 Milepost Pl, 85-95 Thorncliffe Park Dr, 10 Overlea Blvd and 3 more");
  });

  it("leaves out the address of a building the list does not know or that has none, still counting it, and is null when none can be named", () => {
    expect(placeLine(buildings("9", "1", "5"), addresses, "en", t)).toBe("4 Milepost Pl and 2 more");
    expect(placeLine(buildings("9"), addresses, "en", t)).toBeNull();
    expect(placeLine(buildings("1"), new Map(), "en", t)).toBeNull();
  });

  it("is written in the language's own way: the list's joining word and the count", () => {
    const fr = translatorFor("fr");
    expect(placeLine(buildings("1", "2"), addresses, "fr", fr)).toBe("4 Milepost Pl et 85-95 Thorncliffe Park Dr");
    expect(placeLine(buildings("1", "2", "3", "4"), addresses, "fr", fr)).toMatch(/ et 1 de plus$/);
  });
});
