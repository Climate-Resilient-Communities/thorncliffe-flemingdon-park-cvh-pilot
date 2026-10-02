import { beforeEach, describe, expect, it, vi } from "vitest";

// The guard is tested on its own (test/staff-guard.test.ts); here it only hands the action a session. What is under
// test is what the actions do after the floor and building code answers: a saved change expires the resident list.
vi.mock("../guard", () => ({
  staffAction:
    (_spec: unknown, act: (session: { staffId: string }, ...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      act({ staffId: "staff-1" }, ...args),
}));
vi.mock("../places", () => ({ buildings: () => ({}) }));

const edits = vi.hoisted(() => ({ answer: { status: "idle" } as { status: string; location?: string; message?: string } }));
vi.mock("./editFloors", () => ({
  addFloorFromForm: async () => edits.answer,
  renameFloorFromForm: async () => edits.answer,
  removeFloorFromForm: async () => edits.answer,
  confirmFromForm: async () => edits.answer,
}));

const revalidateTag = vi.hoisted(() => vi.fn());
vi.mock("next/cache", () => ({ revalidateTag, updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { addFloorAction, confirmBuildingAction, removeFloorAction, renameFloorAction } = await import("./actions");

const ACTIONS = { addFloorAction, renameFloorAction, removeFloorAction, confirmBuildingAction } as const;
const call = (action: (typeof ACTIONS)[keyof typeof ACTIONS]) => (action as unknown as (previous: unknown, form: FormData) => Promise<unknown>)({ status: "idle" }, new FormData());

beforeEach(() => {
  revalidateTag.mockClear();
});

describe.each(Object.entries(ACTIONS))("%s", (_name, action) => {
  it("expires the resident building list after a saved change, before going back to the building", async () => {
    edits.answer = { status: "saved", location: "/staff/buildings?building=100" };

    await expect(call(action)).rejects.toThrow("NEXT_REDIRECT /staff/buildings?building=100");

    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("resident-buildings", { expire: 0 });
  });

  it.each([
    ["a refusal", { status: "refused", message: "No." }],
    ["a question to confirm", { status: "confirm", message: "Sure?" }],
  ])("leaves the list alone after %s", async (_case, answer) => {
    edits.answer = answer;

    expect(await call(action)).toEqual(answer);

    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
