import { describe, expect, it } from "vitest";
import type { BuildingList } from "@/contracts/buildingList";
import type { DeviceChoices } from "@/contracts/deviceChoices";
import { reconcileChoices } from "./reconcile";

const F1 = "0198a000-0000-7000-8000-000000000001";
const F2 = "0198a000-0000-7000-8000-000000000002";
const F3 = "0198a000-0000-7000-8000-000000000003";
const GONE = "0198a000-0000-7000-8000-0000000000ff";

const list: BuildingList = {
  v: 1,
  buildings: [
    { rsn: "100", address: "1 Test St", neighbourhoodId: "TP", neighbourhood: "Thorncliffe Park", floors: [{ id: F1, label: "1" }, { id: F2, label: "2" }] },
    { rsn: "200", address: "2 Test St", neighbourhoodId: "FP", neighbourhood: "Flemingdon Park", floors: [{ id: F3, label: "G" }] },
  ],
};

describe("reconcileChoices", () => {
  it("returns the same object when everything saved is still listed", () => {
    const choices: DeviceChoices = { v: 1, lang: "ur", buildings: ["100", "200"], floors: [F1, F3] };

    expect(reconcileChoices(choices, list)).toBe(choices);
  });

  it("drops a building that is no longer listed and says how many, keeping everything else", () => {
    const choices: DeviceChoices = { v: 1, lang: "ur", groups: ["seniors"], buildings: ["100", "999"], floors: [F1], basic: true };

    expect(reconcileChoices(choices, list)).toEqual({ v: 1, lang: "ur", groups: ["seniors"], buildings: ["100"], floors: [F1], basic: true, removed: { buildings: 1, floors: 0 } });
  });

  it("drops a floor that no longer exists and keeps the building", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["100"], floors: [F1, GONE] };

    expect(reconcileChoices(choices, list)).toEqual({ v: 1, buildings: ["100"], floors: [F1], removed: { buildings: 0, floors: 1 } });
  });

  it("drops the floors of a building that went, and counts both", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["999"], floors: [GONE] };

    expect(reconcileChoices(choices, list)).toEqual({ v: 1, buildings: [], floors: [], removed: { buildings: 1, floors: 1 } });
  });

  it("adds to what R-34 has not shown yet", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["999"], removed: { buildings: 2, floors: 1 } };

    expect(reconcileChoices(choices, list).removed).toEqual({ buildings: 3, floors: 1 });
  });

  it("drops a floor whose building the resident did not choose without counting it", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["100"], floors: [F1, F3] };

    expect(reconcileChoices(choices, list)).toEqual({ v: 1, buildings: ["100"], floors: [F1] });
  });

  it("removes repeated entries without counting them", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["100", "100"], floors: [F1, F1] };

    expect(reconcileChoices(choices, list)).toEqual({ v: 1, buildings: ["100"], floors: [F1] });
  });

  it("leaves choices without buildings or floors alone", () => {
    const choices: DeviceChoices = { v: 1, lang: "en" };

    expect(reconcileChoices(choices, list)).toBe(choices);
  });

  it("never reads an empty list as every building gone", () => {
    const choices: DeviceChoices = { v: 1, buildings: ["100"], floors: [F1] };

    expect(reconcileChoices(choices, { v: 1, buildings: [] })).toBe(choices);
  });
});
