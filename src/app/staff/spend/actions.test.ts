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
  set: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../spendSeam", () => ({ spendCap: () => ({ set: world.set, read: vi.fn() }), logSpendError: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { setCapAction } = await import("./actions");
const { guardSpecOf } = await import("../guard");

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
const capForm = () => {
  const form = new FormData();
  form.set("cap", "250.50");
  return form;
};
const press = () => setCapAction({ status: "idle" }, capForm());

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.set.mockResolvedValue({ kind: "set", capCents: 25_050, previousCents: null });
});

describe("the save action names the policy action spend.cap, Admins at aal2", () => {
  it("is the Hub's spend page route, the hub gate and spend.cap, privileged", () => {
    expect(guardSpecOf(setCapAction)).toEqual({ route: "/staff/spend", access: "hub", action: "spend.cap", privileged: "spend.cap" });
  });
});

describe("an Admin at aal2", () => {
  it("sets the cap from the form, as themselves, and the page reads it again", async () => {
    const answer = await press();

    expect(world.set).toHaveBeenCalledWith({ actorStaffId: STAFF, amount: "250.50" });
    expect(answer).toMatchObject({ status: "done", lines: ["The monthly cap is now CAD 250.50."], at: expect.any(Number) });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/spend");
  });

  it("is told so, and nothing is revalidated away from the truth, when the use case refuses the amount", async () => {
    world.set.mockResolvedValue({ kind: "refused", problem: "too_large" });
    expect(await press()).toMatchObject({ status: "refused", message: "The cap can be at most $100,000." });
  });
});

describe("calling the save action directly", () => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director, who sees spend read-only, even at aal2", "director", "aal2"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and changes nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    const answer = await press();

    expect(answer).toMatchObject({ status: "refused", message: "Only an Admin can change the monthly cap." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/spend", "spend.cap", "forbidden");
    expect(world.set).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and changes nothing", async () => {
    world.session = signedIn("admin", "aal1");

    const answer = await press();

    expect(answer).toMatchObject({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to change the monthly cap. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/spend", "spend.cap");
    expect(world.set).not.toHaveBeenCalled();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    const answer = await press();

    expect(answer).toMatchObject({ status: "refused", message: "Finish setting up your account first." });
    expect(world.refuseOutsideGate).toHaveBeenCalledWith(STAFF, "/staff/spend");
    expect(world.set).not.toHaveBeenCalled();
  });
});
