import { describe, expect, it, vi } from "vitest";
import { addFloorFromForm, confirmFromForm, removeFloorFromForm, renameFloorFromForm, savedLocation, setContactFromForm, type EditDeps } from "./editFloors";

const ADMIN = "01900000-0000-7000-8000-000000000001";
const FLOOR = "01900000-0000-7000-8000-0000000000f1";
const session = { staffId: ADMIN };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

function deps(service: Partial<ReturnType<EditDeps["buildings"]>>) {
  const full = { addFloor: vi.fn(), renameFloor: vi.fn(), removeFloor: vi.fn(), confirmBuilding: vi.fn(), setContact: vi.fn(), ...service };
  return { service: full, deps: { buildings: () => full } as EditDeps };
}

// Without a session, or as anyone but an Admin, the guard refuses the action before this code runs:
// see test/db/permissions.db.test.ts, which calls the real actions.
describe("Add a floor (server action)", () => {
  it("passes the Admin, the building, the label as typed and the place, and goes back to the building", async () => {
    const addFloor = vi.fn(async () => ({ ok: true as const, value: { id: FLOOR, label: "G", confirmed: false } }));
    const { deps: d } = deps({ addFloor });

    const state = await addFloorFromForm(d, session, form({ rsn: "4154146", label: " G ", place: "bottom" }));

    expect(addFloor).toHaveBeenCalledWith(ADMIN, { rsn: "4154146", label: " G ", place: "bottom" });
    expect(state).toEqual({ status: "saved", location: "/staff/buildings?building=4154146&done=added&label=G" });
  });

  it("puts a floor at the top unless the form says the bottom", async () => {
    const addFloor = vi.fn(async () => ({ ok: true as const, value: { id: FLOOR, label: "R", confirmed: false } }));
    const { deps: d } = deps({ addFloor });
    await addFloorFromForm(d, session, form({ rsn: "1", label: "R", place: "sideways" }));
    expect(addFloor).toHaveBeenCalledWith(ADMIN, { rsn: "1", label: "R", place: "top" });
  });

  it.each([
    ["label_empty", "Enter a label for the floor."],
    ["label_too_long", "A label can have at most 8 characters."],
    ["label_characters", "Use only letters, digits, spaces and hyphens in a label, with at least one letter or digit."],
    ["label_duplicate", "This building already has a floor with that label. Labels count as the same when they differ only by capital letters or spaces."],
    ["building_not_found", "That building does not exist."],
  ] as const)("shows the reason a label is refused (%s) and keeps what was typed", async (error, message) => {
    const { deps: d } = deps({ addFloor: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await addFloorFromForm(d, session, form({ rsn: "1", label: "1.5 x", place: "bottom" }))).toEqual({ status: "refused", message, label: "1.5 x", place: "bottom" });
  });
});

describe("Rename (server action)", () => {
  it("renames the floor by id and says what it is now called", async () => {
    const renameFloor = vi.fn(async () => ({ ok: true as const, value: { id: FLOOR, label: "3A", confirmed: false, previousLabel: "3" } }));
    const { deps: d } = deps({ renameFloor });

    const state = await renameFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, label: "3A" }));

    expect(renameFloor).toHaveBeenCalledWith(ADMIN, { rsn: "7", floorId: FLOOR, label: "3A" });
    expect(state).toEqual({ status: "saved", location: "/staff/buildings?building=7&done=renamed&from=3&to=3A" });
  });

  it("refuses with the reason and shows the label again", async () => {
    const { deps: d } = deps({ renameFloor: vi.fn(async () => ({ ok: false as const, error: "no_change" as const })) });
    expect(await renameFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, label: "3" }))).toEqual({
      status: "refused",
      message: "Nothing to change: the floor already has that label.",
      label: "3",
    });
  });
});

describe("Remove (server action)", () => {
  it("only asks on the first submit: nothing is removed without confirm=1", async () => {
    const removeFloor = vi.fn();
    const { deps: d } = deps({ removeFloor });

    expect(await removeFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, label: "13" }))).toEqual({ status: "confirm", message: "Remove floor 13? This cannot be undone." });
    expect(await removeFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, label: "13", confirm: "0" }))).toMatchObject({ status: "confirm" });
    expect(await removeFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, label: "13", confirm: "yes" }))).toMatchObject({ status: "confirm" });
    expect(removeFloor).not.toHaveBeenCalled();
  });

  it("removes the floor and goes back to the building", async () => {
    const removeFloor = vi.fn(async () => ({ ok: true as const, value: { id: FLOOR, label: "13", confirmed: true } }));
    const { deps: d } = deps({ removeFloor });

    expect(await removeFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, confirm: "1" }))).toEqual({ status: "saved", location: "/staff/buildings?building=7&done=removed&label=13" });
    expect(removeFloor).toHaveBeenCalledWith(ADMIN, { rsn: "7", floorId: FLOOR });
  });

  it('refuses a floor with ambassadors with "Reassign or remove the ambassadors on this floor first" and lists them', async () => {
    const { deps: d } = deps({
      removeFloor: vi.fn(async () => ({
        ok: false as const,
        error: "floor_has_assignments" as const,
        ambassadors: [
          { staffId: "a", name: "Nia Mensah" },
          { staffId: "b", name: "Omar Farouk" },
        ],
      })),
    });

    expect(await removeFloorFromForm(d, session, form({ rsn: "7", floorId: FLOOR, confirm: "1" }))).toEqual({
      status: "refused",
      message: "Reassign or remove the ambassadors on this floor first",
      detail: "Ambassadors on this floor: Nia Mensah, Omar Farouk",
    });
  });
});

describe("Mark building confirmed (server action)", () => {
  it("confirms the building and says how many floors", async () => {
    const confirmBuilding = vi.fn(async () => ({ ok: true as const, value: { floors: 14, confirmedAt: new Date() } }));
    const { deps: d } = deps({ confirmBuilding });

    expect(await confirmFromForm(d, session, form({ rsn: "7" }))).toEqual({ status: "saved", location: "/staff/buildings?building=7&done=confirmed&n=14" });
    expect(confirmBuilding).toHaveBeenCalledWith(ADMIN, { rsn: "7" });
  });

  it.each([
    ["already_confirmed", "This building is already confirmed."],
    ["no_floors", "Add at least one floor before confirming the building."],
  ] as const)("refuses with the reason (%s)", async (error, message) => {
    const { deps: d } = deps({ confirmBuilding: vi.fn(async () => ({ ok: false as const, error })) });
    expect(await confirmFromForm(d, session, form({ rsn: "7" }))).toEqual({ status: "refused", message });
  });
});

describe("Save contact (server action)", () => {
  it("passes the role and number as typed and goes back to the building", async () => {
    const setContact = vi.fn(async () => ({ ok: true as const, value: { contact: { role: "Superintendent", phone: "416-555-0123", owner: "hub" as const, updatedAt: new Date() } } }));
    const { deps: d } = deps({ setContact });

    const state = await setContactFromForm(d, session, form({ rsn: "7", role: " Superintendent ", phone: "(416) 555-0123" }));

    expect(setContact).toHaveBeenCalledWith(ADMIN, { rsn: "7", role: " Superintendent ", phone: "(416) 555-0123" });
    expect(state).toEqual({ status: "saved", location: "/staff/buildings?building=7&done=contact" });
  });

  it("says the contact was removed when both fields were emptied", async () => {
    const { deps: d } = deps({ setContact: vi.fn(async () => ({ ok: true as const, value: { contact: null } })) });
    expect(await setContactFromForm(d, session, form({ rsn: "7", role: "", phone: "" }))).toEqual({ status: "saved", location: "/staff/buildings?building=7&done=contactRemoved" });
  });

  it.each([
    ["role_too_long", "A role can have at most 40 characters."],
    ["role_characters", "Use letters, digits and spaces in a role, with at least one letter. A few marks are allowed: . , ' & / -"],
    ["phone_invalid", "Enter a 10-digit phone number, like 416 555 0123."],
    ["role_without_phone", "Enter a phone number for this role, or empty both fields to remove the contact."],
    ["phone_without_role", "Enter a role for this number, or empty both fields to remove the contact."],
    ["no_change", "Nothing to change: the contact is already saved like this."],
    ["building_not_found", "That building does not exist."],
  ] as const)("shows the reason (%s) and keeps what was typed", async (error, message) => {
    const { deps: d } = deps({ setContact: vi.fn(async () => ({ ok: false as const, error })) });
    expect(await setContactFromForm(d, session, form({ rsn: "7", role: "Super", phone: "555" }))).toEqual({ status: "refused", message, contact: { role: "Super", phone: "555" } });
  });
});

describe("the page a saved change goes back to", () => {
  it("is the building's, with what was done in the query", () => {
    expect(savedLocation("12", { done: "added", label: "P 1" })).toBe("/staff/buildings?building=12&done=added&label=P+1");
  });
});
