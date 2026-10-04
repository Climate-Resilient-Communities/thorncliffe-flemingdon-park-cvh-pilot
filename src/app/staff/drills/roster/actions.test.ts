import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../../session";

// The real guard runs (the role policy, then aal2 for a privileged action, then the setup gate); only what it reads from outside is
// stood in for: the session, the composition root of identity (where refusals are audited) and the assignments of an Ambassador.
const world = vi.hoisted(() => ({
  session: null as unknown,
  refuseByPolicy: vi.fn(async () => {}),
  refuseBelowAal2: vi.fn(async () => {}),
  refuseOutsideGate: vi.fn(async () => {}),
  refuseUnauthenticated: vi.fn(async () => {}),
  add: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("../../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../../../drills", () => ({ drillRoster: () => ({ add: world.add, edit: world.edit, remove: world.remove, list: vi.fn(), labelsOf: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { addDrillPhoneAction, editDrillPhoneAction, removeDrillPhoneAction } = await import("./actions");
const { guardSpecOf } = await import("../../guard");

const STAFF = "01900000-0000-7000-8000-0000000000a1";
const MEMBER = "01900000-0000-7000-8000-0000000000b1";
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
const formFor = (action: unknown) => {
  const form = new FormData();
  if (action === addDrillPhoneAction) {
    form.set("label", "Hub phone");
    form.set("number", "416-555-0123");
    form.set("lang", "ur");
  } else if (action === editDrillPhoneAction) {
    form.set("id", MEMBER);
    form.set("label", "Priya");
    form.set("number", "");
    form.set("lang", "hi");
  } else {
    form.set("id", MEMBER);
  }
  return form;
};
type Action = typeof addDrillPhoneAction;
const press = (action: Action) => action({ status: "idle" }, formFor(action));

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.add.mockResolvedValue({ kind: "added", id: MEMBER, label: "Hub phone", size: 1 });
  world.edit.mockResolvedValue({ kind: "edited", label: "Priya", size: 1 });
  world.remove.mockResolvedValue({ kind: "removed", label: "Hub phone", size: 0, skippedTexts: 0 });
});

describe("the add, edit and remove actions name the policy action drill.run, Admins at aal2", () => {
  it.each([
    ["add", addDrillPhoneAction],
    ["edit", editDrillPhoneAction],
    ["remove", removeDrillPhoneAction],
  ])("%s: the guard spec is the roster page's route, the hub gate and drill.run, privileged", (_name, action) => {
    expect(guardSpecOf(action)).toEqual({ route: "/staff/drills/roster", access: "hub", action: "drill.run", privileged: "drill.run" });
  });
});

describe("an Admin at aal2", () => {
  it("adds the label, number and language from the form, as themselves, and the page reads the roster again", async () => {
    const answer = await press(addDrillPhoneAction);

    expect(world.add).toHaveBeenCalledWith({ actorStaffId: STAFF, label: "Hub phone", number: "416-555-0123", lang: "ur" });
    expect(answer).toMatchObject({ status: "done", lines: ["Hub phone was added. The roster now has 1 phone."], at: expect.any(Number) });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/drills/roster");
  });

  it("changes the member the form names, as themselves", async () => {
    const answer = await press(editDrillPhoneAction);

    expect(world.edit).toHaveBeenCalledWith({ actorStaffId: STAFF, id: MEMBER, label: "Priya", number: "", lang: "hi" });
    expect(answer).toMatchObject({ status: "done", lines: ["Priya was changed."] });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/drills/roster");
  });

  it("removes the member the form names, as themselves", async () => {
    const answer = await press(removeDrillPhoneAction);

    expect(world.remove).toHaveBeenCalledWith({ actorStaffId: STAFF, id: MEMBER });
    expect(answer).toMatchObject({ status: "done", lines: ["Hub phone was removed. The roster is now empty."] });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/drills/roster");
  });
});

describe.each([
  ["add", addDrillPhoneAction],
  ["edit", editDrillPhoneAction],
  ["remove", removeDrillPhoneAction],
])("calling %s directly", (_name, action) => {
  const nothingChanged = () => {
    expect(world.add).not.toHaveBeenCalled();
    expect(world.edit).not.toHaveBeenCalled();
    expect(world.remove).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  };

  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director", "director", "aal1"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and changes nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    expect(await press(action)).toMatchObject({ status: "refused", message: "Only an Admin can change the drill roster." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/drills/roster", "drill.run", "forbidden");
    nothingChanged();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and changes nothing", async () => {
    world.session = signedIn("admin", "aal1");

    expect(await press(action)).toMatchObject({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to change the drill roster. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/drills/roster", "drill.run");
    nothingChanged();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    expect(await press(action)).toMatchObject({ status: "refused", message: "Finish setting up your account first." });
    expect(world.refuseOutsideGate).toHaveBeenCalledWith(STAFF, "/staff/drills/roster");
    nothingChanged();
  });

  it("with no session sends the caller to sign-in, audited as unauthenticated, and changes nothing", async () => {
    world.session = null;

    await expect(press(action)).rejects.toThrow("NEXT_REDIRECT /staff/sign-in");

    expect(world.refuseUnauthenticated).toHaveBeenCalledWith("drill.run", "/staff/drills/roster");
    nothingChanged();
  });
});
