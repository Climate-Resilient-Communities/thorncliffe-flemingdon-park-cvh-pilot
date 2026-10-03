import { describe, expect, it } from "vitest";
import type { Audience } from "./audience";
import { audienceChange, isEmptyAudienceDelta, type AudienceChange } from "./audienceChange";

const NEIGHBOURHOODS: Record<string, string> = { "100": "TP", "200": "TP", "300": "FP" };
const neighbourhoodOf = (rsn: string) => NEIGHBOURHOODS[rsn] ?? null;

const buildings = (list: [string, string[] | null][], groups: string[] = []): Audience => ({
  scope: "buildings",
  buildings: list.map(([rsn, floors]) => ({ rsn, floors })),
  groups: groups as Audience["groups"],
  types: ["power"],
});
const nbhd = (ids: string[], groups: string[] = []): Audience => ({ scope: "neighbourhood", neighbourhood_ids: ids, groups: groups as Audience["groups"], types: ["power"] });

const EMPTY = { places: { neighbourhoodIds: [], restOfNeighbourhoodIds: [], buildings: [] }, groups: { groups: [], outsideGroups: false } };
const change = (previous: Audience, next: Audience): AudienceChange => audienceChange(previous, next, neighbourhoodOf);

describe("an update that keeps the audience", () => {
  it("changes nothing, for a neighbourhood and for buildings, whatever order the lists were written in", () => {
    for (const audience of [nbhd(["TP"]), buildings([["100", null], ["200", ["f1", "f2"]]], ["seniors"])]) {
      const result = change(audience, JSON.parse(JSON.stringify(audience)));
      expect(result.changed).toBe(false);
      expect(result.alsoFor).toEqual(EMPTY);
      expect(result.noLongerFor).toEqual(EMPTY);
    }
  });
});

describe("an update that widens the audience (what the approver reads as Now also for)", () => {
  it("adds a neighbourhood to a neighbourhood", () => {
    const result = change(nbhd(["TP"]), nbhd(["FP", "TP"]));
    expect(result.changed).toBe(true);
    expect(result.alsoFor.places).toEqual({ neighbourhoodIds: ["FP"], restOfNeighbourhoodIds: [], buildings: [] });
    expect(result.noLongerFor).toEqual(EMPTY);
  });

  it("adds a building to buildings, and the buildings of the audience that were already there are not listed", () => {
    const result = change(buildings([["100", null]]), buildings([["100", null], ["300", null]]));
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "300", floors: null }]);
    expect(result.noLongerFor).toEqual(EMPTY);
  });

  it("adds floors of a building the thread already had floors of, and lists only the new floors", () => {
    const result = change(buildings([["100", ["f3", "f4"]]]), buildings([["100", ["f3", "f4", "f5", "f6"]]]));
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "100", floors: ["f5", "f6"] }]);
    expect(result.noLongerFor).toEqual(EMPTY);
  });

  it("widens some floors to the whole building", () => {
    const result = change(buildings([["100", ["f3"]]]), buildings([["100", null]]));
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "100", floors: null }]);
  });

  it("widens buildings to the neighbourhood that holds them: what is new is the rest of that neighbourhood, and a neighbourhood with none of them is new whole", () => {
    const result = change(buildings([["100", null]]), nbhd(["FP", "TP"]));
    expect(result.alsoFor.places).toEqual({ neighbourhoodIds: ["FP"], restOfNeighbourhoodIds: ["TP"], buildings: [] });
    expect(result.noLongerFor).toEqual(EMPTY);
  });

  it("widens a list of groups to everyone: the people who chose none of the groups are now reached", () => {
    const result = change(nbhd(["TP"], ["seniors"]), nbhd(["TP"]));
    expect(result.alsoFor.groups).toEqual({ groups: [], outsideGroups: true });
    expect(result.noLongerFor).toEqual(EMPTY);
  });

  it("adds a group to a list of groups, and a group already named is not listed", () => {
    const result = change(nbhd(["TP"], ["seniors"]), nbhd(["TP"], ["families", "seniors"]));
    expect(result.alsoFor.groups).toEqual({ groups: ["families"], outsideGroups: false });
    expect(result.noLongerFor).toEqual(EMPTY);
  });
});

describe("an update that narrows the audience (shown the same way, as No longer for)", () => {
  it("drops a neighbourhood from a neighbourhood", () => {
    const result = change(nbhd(["FP", "TP"]), nbhd(["TP"]));
    expect(result.noLongerFor.places).toEqual({ neighbourhoodIds: ["FP"], restOfNeighbourhoodIds: [], buildings: [] });
    expect(result.alsoFor).toEqual(EMPTY);
  });

  it("narrows a neighbourhood to buildings of it: what is dropped is the rest of the neighbourhood", () => {
    const result = change(nbhd(["TP"]), buildings([["100", null]]));
    expect(result.noLongerFor.places).toEqual({ neighbourhoodIds: [], restOfNeighbourhoodIds: ["TP"], buildings: [] });
    expect(result.alsoFor).toEqual(EMPTY);
  });

  it("narrows a neighbourhood to a building of another one: the whole neighbourhood is dropped and the building is added", () => {
    const result = change(nbhd(["TP"]), buildings([["300", null]]));
    expect(result.noLongerFor.places.neighbourhoodIds).toEqual(["TP"]);
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "300", floors: null }]);
  });

  it("drops a building, and floors of a building", () => {
    const result = change(buildings([["100", null], ["200", ["f1", "f2", "f3"]]]), buildings([["200", ["f1"]]]));
    expect(result.noLongerFor.places.buildings).toEqual([
      { rsn: "100", floors: null },
      { rsn: "200", floors: ["f2", "f3"] },
    ]);
    expect(result.alsoFor).toEqual(EMPTY);
  });

  it("narrows the whole building to some floors, and no group to a list of groups (the others are no longer texted)", () => {
    const floors = change(buildings([["100", null]]), buildings([["100", ["f3"]]]));
    expect(floors.noLongerFor.places.buildings).toEqual([{ rsn: "100", floors: null }]);
    const groups = change(nbhd(["TP"]), nbhd(["TP"], ["seniors"]));
    expect(groups.noLongerFor.groups).toEqual({ groups: [], outsideGroups: true });
    expect(groups.alsoFor).toEqual(EMPTY);
  });

  it("drops a group from a list of groups", () => {
    const result = change(nbhd(["TP"], ["families", "seniors"]), nbhd(["TP"], ["seniors"]));
    expect(result.noLongerFor.groups).toEqual({ groups: ["families"], outsideGroups: false });
  });
});

describe("an update that widens and narrows at once", () => {
  it("swaps one building for another: both are listed", () => {
    const result = change(buildings([["100", null]]), buildings([["300", null]]));
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "300", floors: null }]);
    expect(result.noLongerFor.places.buildings).toEqual([{ rsn: "100", floors: null }]);
    expect(result.changed).toBe(true);
  });

  it("widens the place and narrows the groups", () => {
    const result = change(nbhd(["TP"]), nbhd(["FP", "TP"], ["seniors"]));
    expect(result.alsoFor.places.neighbourhoodIds).toEqual(["FP"]);
    expect(result.noLongerFor.groups.outsideGroups).toBe(true);
  });
});

describe("a building the places module does not know", () => {
  it("is added as itself when the thread was for a neighbourhood", () => {
    const result = change(nbhd(["TP"]), buildings([["999", null]]));
    expect(result.alsoFor.places.buildings).toEqual([{ rsn: "999", floors: null }]);
  });
});

describe("isEmptyAudienceDelta", () => {
  it("says whether a side has nothing in it", () => {
    expect(isEmptyAudienceDelta(EMPTY)).toBe(true);
    expect(isEmptyAudienceDelta({ ...EMPTY, groups: { groups: [], outsideGroups: true } })).toBe(false);
    expect(isEmptyAudienceDelta({ ...EMPTY, places: { ...EMPTY.places, restOfNeighbourhoodIds: ["TP"] } })).toBe(false);
  });
});
