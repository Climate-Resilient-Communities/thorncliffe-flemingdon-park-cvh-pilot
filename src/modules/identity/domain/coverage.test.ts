import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { assignmentCovers, coversNow, expandFloorRange, floorCoverage } from "./coverage";
import { STAFF_STATUSES } from "./staffAccount";

// Floors G, M, 2, 3 in the building's own order; the label order (G, M, 2, 3) is not the sort order of the ids.
const G = { id: "floor-g", sortOrder: 0 };
const M = { id: "floor-m", sortOrder: 5 };
const F2 = { id: "floor-2", sortOrder: 10 };
const F3 = { id: "floor-3", sortOrder: 15 };
const FLOORS = [F3, G, F2, M];

describe("assignmentCovers", () => {
  it("covers every floor of its building when it lists none (all floors), and no floor of another building", () => {
    expect(assignmentCovers({ rsn: "7001", floorIds: null }, "7001", "any-floor")).toBe(true);
    expect(assignmentCovers({ rsn: "7001", floorIds: null }, "7002", "any-floor")).toBe(false);
  });

  it("covers a listed floor by its id, and only that", () => {
    const listed = { rsn: "7001", floorIds: ["floor-2", "floor-3"] };
    expect(assignmentCovers(listed, "7001", "floor-2")).toBe(true);
    expect(assignmentCovers(listed, "7001", "floor-g")).toBe(false);
    expect(assignmentCovers(listed, "7002", "floor-2")).toBe(false);
  });

  it("covers nothing when the list is empty", () => {
    expect(assignmentCovers({ rsn: "7001", floorIds: [] }, "7001", "floor-2")).toBe(false);
  });
});

describe("coversNow", () => {
  it("is true only for an active Ambassador", () => {
    for (const role of STAFF_ROLES) {
      for (const status of STAFF_STATUSES) {
        expect(coversNow({ role, status }), `${role} ${status}`).toBe(role === "ambassador" && status === "active");
      }
    }
  });
});

describe("expandFloorRange", () => {
  it("gives the floors from one to the other by sort_order, ends included, lowest first", () => {
    expect(expandFloorRange(FLOORS, "floor-g", "floor-2")).toEqual(["floor-g", "floor-m", "floor-2"]);
    expect(expandFloorRange(FLOORS, "floor-m", "floor-3")).toEqual(["floor-m", "floor-2", "floor-3"]);
  });

  it("takes the ends in either order", () => {
    expect(expandFloorRange(FLOORS, "floor-3", "floor-m")).toEqual(["floor-m", "floor-2", "floor-3"]);
  });

  it("is one floor when both ends are the same floor", () => {
    expect(expandFloorRange(FLOORS, "floor-2", "floor-2")).toEqual(["floor-2"]);
  });

  it("goes by sort_order and not by label or by the order the floors are given in", () => {
    // Labels would put "3" before "G"; sort_order puts G lowest.
    expect(expandFloorRange([F3, G], "floor-g", "floor-3")).toEqual(["floor-g", "floor-3"]);
  });

  it("is null when an end is not one of the building's floors", () => {
    expect(expandFloorRange(FLOORS, "floor-g", "floor-other")).toBeNull();
    expect(expandFloorRange(FLOORS, "", "floor-2")).toBeNull();
    expect(expandFloorRange([], "floor-g", "floor-2")).toBeNull();
  });
});

describe("floorCoverage", () => {
  it("marks each floor covered or not, with who covers it", () => {
    const covering = [
      { staffId: "nia", floorIds: ["floor-g", "floor-m"] },
      { staffId: "omar", floorIds: null },
    ];
    expect(floorCoverage([G, M, F2], covering)).toEqual([
      { floorId: "floor-g", covered: true, staffIds: ["nia", "omar"] },
      { floorId: "floor-m", covered: true, staffIds: ["nia", "omar"] },
      { floorId: "floor-2", covered: true, staffIds: ["omar"] },
    ]);
  });

  it("leaves a floor uncovered when nobody lists it", () => {
    expect(floorCoverage([G, F2], [{ staffId: "nia", floorIds: ["floor-g"] }])).toEqual([
      { floorId: "floor-g", covered: true, staffIds: ["nia"] },
      { floorId: "floor-2", covered: false, staffIds: [] },
    ]);
  });

  it("leaves every floor uncovered when nobody is assigned, and has no floors for a building without any", () => {
    expect(floorCoverage([G, F2], []).map((floor) => floor.covered)).toEqual([false, false]);
    expect(floorCoverage([], [{ staffId: "nia", floorIds: null }])).toEqual([]);
  });
});
