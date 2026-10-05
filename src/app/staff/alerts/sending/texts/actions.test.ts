import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../../../session";

// The real guard runs (the role policy, then aal2 for a privileged action, then the setup gate); only what it reads from outside is
// stood in for: the session, the composition root of identity (where refusals are audited) and the assignments of an Ambassador.
const world = vi.hoisted(() => ({
  session: null as unknown,
  refuseByPolicy: vi.fn(async () => {}),
  refuseBelowAal2: vi.fn(async () => {}),
  refuseOutsideGate: vi.fn(async () => {}),
  refuseUnauthenticated: vi.fn(async () => {}),
  resend: vi.fn(),
  startSending: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("../../../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../../../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../../../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../../../resendSeam", () => ({ resendService: () => ({ resend: world.resend }), startSending: world.startSending, logResendError: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { resendAllAction, resendTextAction } = await import("./actions");
const { guardSpecOf } = await import("../../../guard");

const STAFF = "01900000-0000-7000-8000-0000000000a1";
const ENTRY = "01900000-0000-7000-8000-00000000e177";
const TEXT = "01900000-0000-7000-8000-0000000abc01";
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
const formOf = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};
const pressOne = () => resendTextAction({ status: "idle" }, formOf({ entry: ENTRY, delivery: TEXT, seen: "failed" }));
const pressAll = () => resendAllAction({ status: "idle" }, formOf({ entry: ENTRY, lang: "en" }));

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.resend.mockResolvedValue({ kind: "resent", resent: 1, notResent: [], more: false, costCents: 4, overrun: null, resendN: 1 });
});

describe("the resend actions name the policy action delivery.resend, Admins at aal2", () => {
  it.each([resendTextAction, resendAllAction])("are the sending texts page's route, the hub gate and delivery.resend, privileged", (action) => {
    expect(guardSpecOf(action)).toEqual({ route: "/staff/alerts/sending/texts", access: "hub", action: "delivery.resend", privileged: "delivery.resend" });
  });
});

describe("an Admin at aal2", () => {
  it("resends one text as themselves, starts the sender, and the list reads the chains again", async () => {
    const answer = await pressOne();

    expect(world.resend).toHaveBeenCalledWith({ actorStaffId: STAFF, entryId: ENTRY, scope: "one", deliveryId: TEXT, seen: "failed", confirmedUnknown: false });
    expect(answer).toMatchObject({ status: "done", lines: ["The text was resent. It is in the queue and goes out in its usual order."], at: expect.any(Number) });
    expect(world.startSending).toHaveBeenCalledTimes(1);
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/alerts/sending/texts");
  });

  it("resends all the failed and undelivered texts of a language", async () => {
    world.resend.mockResolvedValue({ kind: "resent", resent: 7, notResent: [], more: false, costCents: 28, overrun: null, resendN: null });
    const answer = await pressAll();

    expect(world.resend).toHaveBeenCalledWith({ actorStaffId: STAFF, entryId: ENTRY, scope: "language", lang: "en" });
    expect(answer).toMatchObject({ status: "done", lines: ["7 texts were resent. They are in the queue and go out in their usual order."] });
  });

  it("is told when the use case refuses, and the sender is not started", async () => {
    world.resend.mockResolvedValue({ kind: "refused", reason: "resend_limit" });
    expect(await pressOne()).toMatchObject({ status: "refused", message: "This text has already been resent twice, which is the most. Nothing was resent." });
    expect(world.startSending).not.toHaveBeenCalled();
  });
});

describe("calling the resend actions directly", () => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director, even at aal2", "director", "aal2"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and resends nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    for (const press of [pressOne, pressAll]) {
      expect(await press()).toMatchObject({ status: "refused", message: "Only an Admin can resend texts." });
    }
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/alerts/sending/texts", "delivery.resend", "forbidden");
    expect(world.resend).not.toHaveBeenCalled();
    expect(world.startSending).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and resends nothing", async () => {
    world.session = signedIn("admin", "aal1");

    for (const press of [pressOne, pressAll]) {
      expect(await press()).toMatchObject({
        status: "refused",
        message: "An Admin must sign in with their authenticator code to resend texts. Sign in again and enter the code.",
      });
    }
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/alerts/sending/texts", "delivery.resend");
    expect(world.resend).not.toHaveBeenCalled();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    expect(await pressOne()).toMatchObject({ status: "refused", message: "Finish setting up your account first." });
    expect(world.refuseOutsideGate).toHaveBeenCalledWith(STAFF, "/staff/alerts/sending/texts");
    expect(world.resend).not.toHaveBeenCalled();
  });
});
