import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../../session";

// S08.06: "Save round types". The real guard runs (the role policy, then aal2 for a privileged action, then the setup gate); only what it reads from outside
// is stood in for: the session, the composition root of identity (where refusals are audited), the assignments of an Ambassador, and places' round types.
const world = vi.hoisted(() => ({
  session: null as unknown,
  refuseByPolicy: vi.fn(async () => {}),
  refuseBelowAal2: vi.fn(async () => {}),
  refuseOutsideGate: vi.fn(async () => {}),
  refuseUnauthenticated: vi.fn(async () => {}),
  set: vi.fn(),
  logError: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("../../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../../places", () => ({ roundTypes: () => ({ set: world.set, list: vi.fn() }), logPlacesError: world.logError }));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { setRoundTypesAction } = await import("./actions");
const { guardSpecOf } = await import("../../guard");

const STAFF = "01900000-0000-7000-8000-0000000000a1";
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
const typesForm = (types: string[], confirmed: boolean) => {
  const form = new FormData();
  for (const type of types) form.append("type", type);
  if (confirmed) form.append("confirmResidentTexts", "yes");
  return form;
};
/** A press with the confirmation box ticked (the residents' texts name heat and power: leaving one unticked needs it). */
const press = (...types: string[]) => setRoundTypesAction({ status: "idle" }, typesForm(types, true));
const pressUnconfirmed = (...types: string[]) => setRoundTypesAction({ status: "idle" }, typesForm(types, false));
const CONFIRM_NEEDED = "Nothing changed. Heat or Power is unticked, so the residents' check-in texts would be inaccurate. Tick the box to confirm, then save again.";

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.set.mockResolvedValue({ ok: true, value: { roundTypes: ["heat"], previous: ["heat", "power"] } });
});

describe("the save action names the policy action checkins.round_types, Admins at aal2", () => {
  it("is the coverage page's route, the hub gate and checkins.round_types, privileged", () => {
    expect(guardSpecOf(setRoundTypesAction)).toEqual({ route: "/staff/coverage", access: "hub", action: "checkins.round_types", privileged: "checkins.round_types" });
  });
});

describe("an Admin at aal2", () => {
  it("makes the ticked types the round types, as themselves, says so by name, and the page reads them again", async () => {
    const answer = await press("heat");

    expect(world.set).toHaveBeenCalledWith(STAFF, ["heat"]);
    expect(answer).toMatchObject({ status: "done", line: "Saved. Types that start a round from the next approval: Heat.", at: expect.any(Number) });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/coverage");
  });

  it("may tick none: no alert starts a round from the next approval", async () => {
    world.set.mockResolvedValue({ ok: true, value: { roundTypes: [], previous: ["heat"] } });
    expect(await press()).toMatchObject({ status: "done", line: "Saved. From the next approval, no alert starts a check-in round." });
    expect(world.set).toHaveBeenCalledWith(STAFF, []);
  });

  it.each([[["heat"]], [["power", "water"]], [[]]])("is refused, nothing changed and nothing asked, when %j leaves Heat or Power unticked without the confirmation", async (types) => {
    expect(await pressUnconfirmed(...types)).toMatchObject({ status: "refused", message: CONFIRM_NEEDED });
    expect(world.set).not.toHaveBeenCalled();
  });

  it("needs no confirmation while Heat and Power both stay ticked", async () => {
    world.set.mockResolvedValue({ ok: true, value: { roundTypes: ["heat", "power", "water"], previous: ["heat", "power"] } });
    expect(await pressUnconfirmed("heat", "power", "water")).toMatchObject({ status: "done", line: "Saved. Types that start a round from the next approval: Heat, Power, Water." });
    expect(world.set).toHaveBeenCalledWith(STAFF, ["heat", "power", "water"]);
  });

  it.each([
    ["unknown_type", "One of those is not a type of disruption. Reload the page and try again."],
    ["no_change", "Nothing to change: those are the round types already."],
  ] as const)("is told in words when the use case refuses (%s)", async (error, message) => {
    world.set.mockResolvedValue({ ok: false, error });
    expect(await press("heat")).toMatchObject({ status: "refused", message });
  });

  it("is told nothing changed when the change fails, and the failure is logged by the error's name only", async () => {
    world.set.mockRejectedValue(new TypeError("connection reset"));
    expect(await press("heat")).toMatchObject({ status: "refused", message: "Nothing changed. Try again. If it fails again, tell IT." });
    expect(world.logError).toHaveBeenCalledWith("round_types.set_failed", { error: "TypeError" });
  });
});

describe("calling the save action directly", () => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, who reads the round types, even at aal2", "coordinator", "aal2"],
    ["a Director, who reads the round types, even at aal2", "director", "aal2"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and changes nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    const answer = await press("heat");

    expect(answer).toMatchObject({ status: "refused", message: "Only an Admin can change which types start a round." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/coverage", "checkins.round_types", "forbidden");
    expect(world.set).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and changes nothing", async () => {
    world.session = signedIn("admin", "aal1");

    const answer = await press("heat");

    expect(answer).toMatchObject({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to change which types start a round. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/coverage", "checkins.round_types");
    expect(world.set).not.toHaveBeenCalled();
  });
});
