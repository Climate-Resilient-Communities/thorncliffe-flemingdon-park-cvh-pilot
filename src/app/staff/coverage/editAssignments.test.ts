import { describe, expect, it, vi } from "vitest";
import { assignFromForm, removeFromForm, savedLocation, type AssignDeps } from "./editAssignments";

const ADMIN = "01900000-0000-7000-8000-000000000001";
const NIA = "01900000-0000-7000-8000-0000000000a1";
const FLOOR_1 = "01900000-0000-7000-8000-0000000000f1";
const FLOOR_2 = "01900000-0000-7000-8000-0000000000f2";
const session = { staffId: ADMIN };

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) for (const one of Array.isArray(value) ? value : [value]) data.append(name, one);
  return data;
}

function deps(service: Partial<ReturnType<AssignDeps["assignments"]>>) {
  const full = { assign: vi.fn(), remove: vi.fn(), ...service };
  return { service: full, deps: { assignments: () => full } as AssignDeps };
}

// Without a session, or as anyone but an Admin, the guard refuses the action before this code runs:
// see test/db/permissions.db.test.ts, which calls the real actions.
describe("Assign (server action)", () => {
  it("assigns every floor of the judged building when the form says all floors and nothing else", async () => {
    const assign = vi.fn(async () => ({ ok: true as const, value: { staffId: NIA, rsn: "4154146", floorIds: null } }));
    const { deps: d } = deps({ assign });

    // The range's two selects are always sent, empty when nothing is chosen.
    const state = await assignFromForm(d, session, "4154146", form({ staffId: NIA, scope: "all", from: "", to: "" }));

    expect(assign).toHaveBeenCalledWith(ADMIN, { staffId: NIA, rsn: "4154146", floorIds: null });
    expect(state).toEqual({ status: "saved", location: "/staff/coverage?building=4154146&done=assigned" });
  });

  it.each([
    ["a floor ticked", { floorId: [FLOOR_1] }],
    ["a range", { from: FLOOR_1, to: FLOOR_2 }],
    ["one end of a range", { from: FLOOR_1 }],
    ["floors ticked and a range", { floorId: [FLOOR_1], from: FLOOR_1, to: FLOOR_2 }],
  ])("refuses 'all floors' sent with %s, instead of dropping what was picked, and calls nothing", async (_, extra) => {
    const { service, deps: d } = deps({});

    const state = await assignFromForm(d, session, "4154146", form({ staffId: NIA, scope: "all", ...extra }));

    expect(state).toEqual({ status: "refused", message: "You chose all floors but also picked floors or a range. Choose all floors on their own, or choose only the floors you pick." });
    expect(service.assign).not.toHaveBeenCalled();
  });

  it.each([
    ["no scope", {}],
    ["an empty scope", { scope: "" }],
    ["an unknown scope", { scope: "everything" }],
  ])("refuses %s: the scope is chosen, never assumed", async (_, extra) => {
    const { service, deps: d } = deps({});

    const state = await assignFromForm(d, session, "7", form({ staffId: NIA, floorId: [FLOOR_1], ...extra }));

    expect(state).toEqual({ status: "refused", message: "Choose which floors: all floors, or only the floors you pick." });
    expect(service.assign).not.toHaveBeenCalled();
  });

  it("assigns the floors ticked, by id, to the building the guard judged and not to one the form names", async () => {
    const assign = vi.fn(async () => ({ ok: true as const, value: { staffId: NIA, rsn: "4154146", floorIds: [FLOOR_1, FLOOR_2] } }));
    const { deps: d } = deps({ assign });

    await assignFromForm(d, session, "4154146", form({ rsn: "9999999", staffId: NIA, scope: "some", floorId: [FLOOR_1, FLOOR_2] }));

    expect(assign).toHaveBeenCalledWith(ADMIN, { staffId: NIA, rsn: "4154146", floorIds: [FLOOR_1, FLOOR_2] });
  });

  it("passes a range of floors, with the ticked floors, for the use case to expand by sort_order", async () => {
    const assign = vi.fn(async () => ({ ok: true as const, value: { staffId: NIA, rsn: "7", floorIds: [FLOOR_1] } }));
    const { deps: d } = deps({ assign });

    await assignFromForm(d, session, "7", form({ staffId: NIA, scope: "some", from: FLOOR_1, to: FLOOR_2 }));

    expect(assign).toHaveBeenCalledWith(ADMIN, { staffId: NIA, rsn: "7", floorIds: [], range: { from: FLOOR_1, to: FLOOR_2 } });
  });

  it("passes a half-chosen range on, so the use case refuses it", async () => {
    const assign = vi.fn(async () => ({ ok: false as const, error: "range_incomplete" as const }));
    const { deps: d } = deps({ assign });

    const state = await assignFromForm(d, session, "7", form({ staffId: NIA, scope: "some", from: FLOOR_1, to: "" }));

    expect(assign).toHaveBeenCalledWith(ADMIN, { staffId: NIA, rsn: "7", floorIds: [], range: { from: FLOOR_1, to: "" } });
    expect(state).toEqual({ status: "refused", message: "Choose both ends of the range of floors, or neither." });
  });

  it("asks for an ambassador when none is chosen, without calling the use case", async () => {
    const { service, deps: d } = deps({});
    expect(await assignFromForm(d, session, "7", form({ staffId: "", scope: "all" }))).toEqual({ status: "refused", message: "Choose an ambassador." });
    expect(await assignFromForm(d, session, "7", form({ scope: "all" }))).toEqual({ status: "refused", message: "Choose an ambassador." });
    expect(service.assign).not.toHaveBeenCalled();
  });

  it.each([
    ["building_not_found", "That building does not exist."],
    ["account_not_found", "That person does not exist. Reload the page."],
    ["not_ambassador", "Only an ambassador can be assigned to a building."],
    ["account_not_active", "That ambassador is not active, so they cannot be assigned."],
    ["no_floors", "Choose at least one floor, or choose all floors."],
    ["floor_not_in_building", "One of those floors is not a floor of this building. Reload the page."],
    ["range_reversed", "The range goes from a higher floor to a lower one. Put the lower floor first."],
    ["forbidden", "Only an Admin can assign ambassadors."],
  ] as const)("shows the reason it is refused (%s) and saves nothing", async (error, message) => {
    const { deps: d } = deps({ assign: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await assignFromForm(d, session, "7", form({ staffId: NIA, scope: "some" }))).toEqual({ status: "refused", message });
  });
});

describe("Remove an assignment (server action)", () => {
  it("asks first and removes nothing: the first submit returns the question, naming the person", async () => {
    const { service, deps: d } = deps({});

    const state = await removeFromForm(d, session, "7", form({ staffId: NIA, name: "Omar Farouk" }));

    expect(state).toEqual({ status: "confirm", message: "Remove Omar Farouk from this building? They stay an ambassador and stop covering it." });
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("does not remove on any confirm value but 1", async () => {
    const { service, deps: d } = deps({});
    for (const confirm of ["", "0", "yes", "true"]) expect((await removeFromForm(d, session, "7", form({ staffId: NIA, name: "Omar", confirm }))).status).toBe("confirm");
    expect(service.remove).not.toHaveBeenCalled();
  });

  it("removes the person's assignment to the judged building and goes back to it, once confirmed", async () => {
    const remove = vi.fn(async () => ({ ok: true as const, value: { staffId: NIA, rsn: "7" } }));
    const { deps: d } = deps({ remove });

    const state = await removeFromForm(d, session, "7", form({ rsn: "9", staffId: NIA, confirm: "1" }));

    expect(remove).toHaveBeenCalledWith(ADMIN, { staffId: NIA, rsn: "7" });
    expect(state).toEqual({ status: "saved", location: "/staff/coverage?building=7&done=removed" });
  });

  it("shows the reason when it is refused", async () => {
    const { deps: d } = deps({ remove: vi.fn(async () => ({ ok: false as const, error: "not_assigned" as const })) });
    expect(await removeFromForm(d, session, "7", form({ staffId: NIA, confirm: "1" }))).toEqual({ status: "refused", message: "That ambassador is not assigned to this building." });
  });
});

describe("savedLocation", () => {
  it("returns to the building with only what was done in the query", () => {
    expect(savedLocation("4154146", "assigned")).toBe("/staff/coverage?building=4154146&done=assigned");
    expect(savedLocation("4154146", "removed")).toBe("/staff/coverage?building=4154146&done=removed");
  });
});
