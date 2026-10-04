import { describe, expect, it } from "vitest";
import type { BuildingList } from "@/contracts/buildingList";
import { installNeighbourhood, singleNeighbourhood } from "./nbhd";

const building = (rsn: string, neighbourhoodId: string) => ({ rsn, address: `${rsn} Road`, neighbourhoodId, neighbourhood: neighbourhoodId, floors: [] });
const LIST = {
  v: 1,
  generated_at: "2026-10-05T12:00:00.000Z",
  buildings: [building("100", "TP"), building("101", "TP"), building("200", "FP"), building("300", "ZZ")],
} as unknown as BuildingList;

describe("installNeighbourhood (S02.15)", () => {
  it("is the neighbourhood when every chosen building is in the same one", () => {
    expect(installNeighbourhood(["100"], LIST)).toBe("TP");
    expect(installNeighbourhood(["100", "101"], LIST)).toBe("TP");
    expect(installNeighbourhood(["200"], LIST)).toBe("FP");
  });

  it("is left out when the buildings are in both, when none is chosen, when the list is missing or a building is not in it", () => {
    expect(installNeighbourhood(["100", "200"], LIST)).toBeUndefined();
    expect(installNeighbourhood([], LIST)).toBeUndefined();
    expect(installNeighbourhood(undefined, LIST)).toBeUndefined();
    expect(installNeighbourhood(["100"], null)).toBeUndefined();
    expect(installNeighbourhood(["100", "999"], LIST)).toBeUndefined();
    expect(installNeighbourhood(["300"], LIST)).toBeUndefined();
  });
});

describe("singleNeighbourhood", () => {
  it("is the one neighbourhood a filter names, and none for no filter or both", () => {
    expect(singleNeighbourhood(["TP"])).toBe("TP");
    expect(singleNeighbourhood(["FP", "FP"])).toBe("FP");
    expect(singleNeighbourhood([])).toBeUndefined();
    expect(singleNeighbourhood(["TP", "FP"])).toBeUndefined();
  });
});
