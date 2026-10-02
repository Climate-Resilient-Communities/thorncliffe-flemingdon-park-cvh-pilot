import { describe, expect, it } from "vitest";
import { floorControlsEnabled, initialRow, rowReducer, type RowEvent, type RowState } from "./buildingRowState";

const FLOORS = ["f0", "f1", "f2", "f3"];
const row = (change: Partial<Parameters<typeof initialRow>[0]> = {}) => initialRow({ checked: false, whole: true, floors: FLOORS.map((id) => ({ id, checked: false })), ...change });
const apply = (state: RowState, ...events: RowEvent[]) => events.reduce(rowReducer, state);

describe("a building of the place picker: what one control does to the others", () => {
  it("starts from the saved audience: whole or some floors, and a building with no floors listed only whole", () => {
    expect(row()).toMatchObject({ checked: false, whole: true });
    const some = row({ checked: true, whole: false, floors: FLOORS.map((id) => ({ id, checked: id === "f1" || id === "f2" })) });
    expect(some).toMatchObject({ checked: true, whole: false });
    expect([...some.floors]).toEqual(["f1", "f2"]);
    expect(row({ checked: true, whole: false, floors: [] }).whole).toBe(true);
  });

  it("choosing the whole building clears the ticked floors and the range, so they are not sent with it", () => {
    const picked = apply(row({ checked: true }), { type: "some" }, { type: "floor", id: "f1", checked: true }, { type: "floor", id: "f3", checked: true }, { type: "from", value: "f0" }, { type: "to", value: "f2" });
    expect([...picked.floors]).toEqual(["f1", "f3"]);
    expect(picked).toMatchObject({ from: "f0", to: "f2", whole: false });
    expect(floorControlsEnabled(picked)).toBe(true);

    const whole = rowReducer(picked, { type: "whole" });
    expect(whole.whole).toBe(true);
    expect(whole.checked).toBe(true);
    expect([...whole.floors]).toEqual([]);
    expect(whole.from).toBe("");
    expect(whole.to).toBe("");
    expect(floorControlsEnabled(whole)).toBe(false);
    // Going back to some floors does not bring the old ones back.
    expect([...rowReducer(whole, { type: "some" }).floors]).toEqual([]);
  });

  it("ticking a floor of a building that is not ticked ticks the building and chooses some floors", () => {
    const start = row();
    expect(start).toMatchObject({ checked: false, whole: true });
    const ticked = rowReducer(start, { type: "floor", id: "f2", checked: true });
    expect(ticked).toMatchObject({ checked: true, whole: false });
    expect([...ticked.floors]).toEqual(["f2"]);
    expect(floorControlsEnabled(ticked)).toBe(true);
  });

  it("choosing an end of the range of a building that is not ticked ticks the building and chooses some floors", () => {
    for (const end of ["from", "to"] as const) {
      const set = rowReducer(row(), { type: end, value: "f1" });
      expect(set, end).toMatchObject({ checked: true, whole: false, [end]: "f1" });
    }
  });

  it("unticking a floor, or clearing an end of the range, changes nothing else", () => {
    const state = apply(row({ checked: true }), { type: "floor", id: "f1", checked: true }, { type: "from", value: "f0" });
    expect(apply(state, { type: "floor", id: "f1", checked: false })).toMatchObject({ checked: true, whole: false, from: "f0" });
    expect(apply(row(), { type: "from", value: "" })).toMatchObject({ checked: false, whole: true, from: "" });
    expect(apply(row(), { type: "floor", id: "f1", checked: false })).toMatchObject({ checked: false, whole: true });
  });

  it("sends floors only for a ticked building with some floors chosen", () => {
    expect(floorControlsEnabled(row())).toBe(false);
    expect(floorControlsEnabled(row({ checked: true }))).toBe(false);
    expect(floorControlsEnabled(row({ checked: true, whole: false }))).toBe(true);
    // Unticking the building takes the floors out of the form again.
    expect(floorControlsEnabled(rowReducer(row({ checked: true, whole: false }), { type: "building", checked: false }))).toBe(false);
  });
});
