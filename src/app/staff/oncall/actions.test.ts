import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../session";

// The real guard runs (the role policy, then aal2 for a privileged action, then the setup gate); only what it reads from outside is
// stood in for: the session, the composition root of identity (where refusals are audited) and the assignments of an Ambassador.
const world = vi.hoisted(() => ({
  session: null as unknown,
  refuseByPolicy: vi.fn(async () => {}),
  refuseBelowAal2: vi.fn(async () => {}),
  refuseOutsideGate: vi.fn(async () => {}),
  refuseUnauthenticated: vi.fn(async () => {}),
  add: vi.fn(),
  remove: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../../oncall", () => ({ oncallRoster: () => ({ add: world.add, remove: world.remove, list: vi.fn(), hasNumber: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { addOncallAction, removeOncallAction } = await import("./actions");
const { guardSpecOf } = await import("../guard");

const STAFF = "01900000-0000-7000-8000-0000000000a1";
const ENTRY = "01900000-0000-7000-8000-0000000000b1";
const signedIn = (role: StaffRole, aal: "aal1" | "aal2", gate: StaffSession["gate"] = "hub"): StaffSession => ({
  staffId: STAFF,
  sessionId: "01900000-0000-7000-8000-0000000000aa",
  username: "aokafor",
  firstName: "Ann",
  lastName: "Okafor",
  role,
  gate,
  aal,
});
const addForm = () => {
  const form = new FormData();
  form.set("label", "IT lead");
  form.set("number", "416-555-0123");
  return form;
};
const removeForm = () => {
  const form = new FormData();
  form.set("id", ENTRY);
  return form;
};
const press = (action: typeof addOncallAction | typeof removeOncallAction) => action({ status: "idle" }, action === addOncallAction ? addForm() : removeForm());

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.add.mockResolvedValue({ kind: "added", id: ENTRY, label: "IT lead", size: 1 });
  world.remove.mockResolvedValue({ kind: "removed", label: "IT lead", size: 0, skippedTexts: 0 });
});

describe("the add and remove actions name the policy action oncall.manage, Admins at aal2", () => {
  it.each([
    ["add", addOncallAction],
    ["remove", removeOncallAction],
  ])("%s: the guard spec is the Hub's page route, the hub gate and oncall.manage, privileged", (_name, action) => {
    expect(guardSpecOf(action)).toEqual({ route: "/staff/oncall", access: "hub", action: "oncall.manage", privileged: "oncall.manage" });
  });
});

describe("an Admin at aal2", () => {
  it("adds the label and number from the form, as themselves, and the page reads the roster again", async () => {
    const answer = await press(addOncallAction);

    expect(world.add).toHaveBeenCalledWith({ actorStaffId: STAFF, label: "IT lead", number: "416-555-0123" });
    expect(answer).toMatchObject({ status: "done", lines: ["IT lead was added. The list now has 1 number."], at: expect.any(Number) });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/oncall");
  });

  it("removes the entry the form names, as themselves", async () => {
    const answer = await press(removeOncallAction);

    expect(world.remove).toHaveBeenCalledWith({ actorStaffId: STAFF, id: ENTRY });
    expect(answer).toMatchObject({ status: "done", lines: ["IT lead was removed. The list is now empty."] });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/oncall");
  });
});

describe.each([
  ["add", addOncallAction],
  ["remove", removeOncallAction],
])("calling %s directly", (_name, action) => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director", "director", "aal1"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and changes nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    const answer = await press(action);

    expect(answer).toMatchObject({ status: "refused", message: "Only an Admin can change the on-call numbers." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/oncall", "oncall.manage", "forbidden");
    expect(world.add).not.toHaveBeenCalled();
    expect(world.remove).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and changes nothing", async () => {
    world.session = signedIn("admin", "aal1");

    const answer = await press(action);

    expect(answer).toMatchObject({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to change the on-call numbers. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/oncall", "oncall.manage");
    expect(world.add).not.toHaveBeenCalled();
    expect(world.remove).not.toHaveBeenCalled();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    const answer = await press(action);

    expect(answer).toMatchObject({ status: "refused", message: "Finish setting up your account first." });
    expect(world.refuseOutsideGate).toHaveBeenCalledWith(STAFF, "/staff/oncall");
    expect(world.add).not.toHaveBeenCalled();
    expect(world.remove).not.toHaveBeenCalled();
  });

  it("with no session sends the caller to sign-in, audited as unauthenticated, and changes nothing", async () => {
    world.session = null;

    await expect(press(action)).rejects.toThrow("NEXT_REDIRECT /staff/sign-in");

    expect(world.refuseUnauthenticated).toHaveBeenCalledWith("oncall.manage", "/staff/oncall");
    expect(world.add).not.toHaveBeenCalled();
    expect(world.remove).not.toHaveBeenCalled();
  });
});
