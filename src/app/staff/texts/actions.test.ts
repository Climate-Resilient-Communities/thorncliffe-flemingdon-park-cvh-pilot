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
  pause: vi.fn(),
  resume: vi.fn(),
  startSending: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../messagingPause", () => ({
  messagingPause: () => ({ pause: world.pause, resume: world.resume, status: vi.fn() }),
  pausedByName: async () => "Priya Sharma",
  startSending: world.startSending,
  logPauseError: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: world.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { pauseTextsAction, resumeTextsAction } = await import("./actions");
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
const pauseForm = (reason = "Wrong alert sent") => {
  const form = new FormData();
  form.set("reason", reason);
  return form;
};
const press = (action: typeof pauseTextsAction | typeof resumeTextsAction, form = pauseForm()) => action({ status: "idle" }, form);

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.pause.mockResolvedValue({ kind: "paused", status: { paused: true, pausedBy: STAFF, pausedAt: new Date(), reason: "x", handedOffAtPause: 0 }, waiting: 2, handedOff: 0 });
  world.resume.mockResolvedValue({ kind: "resumed", waiting: 2 });
});

describe("the pause and resume actions name the policy action sending.pause, Admins at aal2", () => {
  it.each([
    ["pause", pauseTextsAction],
    ["resume", resumeTextsAction],
  ])("%s: the guard spec is the Hub's page route, the hub gate and sending.pause, privileged", (_name, action) => {
    expect(guardSpecOf(action)).toEqual({ route: "/staff/texts", access: "hub", action: "sending.pause", privileged: "sending.pause" });
  });
});

describe("an Admin at aal2", () => {
  it("pauses with the reason from the form, as themselves, and the page and banner read the switch again", async () => {
    const answer = await press(pauseTextsAction, pauseForm("Provider outage"));

    expect(world.pause).toHaveBeenCalledWith({ actorStaffId: STAFF, reason: "Provider outage" });
    expect(answer).toMatchObject({ status: "done", lines: ["Texts are paused.", "2 texts are waiting and will go out when you resume."], at: expect.any(Number) });
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/texts");
  });

  it("resumes as themselves, and starts a dispatcher run", async () => {
    const answer = await press(resumeTextsAction);

    expect(world.resume).toHaveBeenCalledWith({ actorStaffId: STAFF });
    expect(answer).toMatchObject({ status: "done", lines: ["Texts resumed. 2 texts were waiting and now go out in order."] });
    expect(world.startSending).toHaveBeenCalledTimes(1);
    expect(world.revalidatePath).toHaveBeenCalledWith("/staff/texts");
  });
});

describe.each([
  ["pause", pauseTextsAction],
  ["resume", resumeTextsAction],
])("calling %s directly", (_name, action) => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director", "director", "aal1"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and changes nothing", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    const answer = await press(action);

    expect(answer).toMatchObject({ status: "refused", message: "Only an Admin can pause or resume texts." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/texts", "sending.pause", "forbidden");
    expect(world.pause).not.toHaveBeenCalled();
    expect(world.resume).not.toHaveBeenCalled();
    expect(world.startSending).not.toHaveBeenCalled();
    expect(world.revalidatePath).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and changes nothing", async () => {
    world.session = signedIn("admin", "aal1");

    const answer = await press(action);

    expect(answer).toMatchObject({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to pause or resume texts. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/texts", "sending.pause");
    expect(world.pause).not.toHaveBeenCalled();
    expect(world.resume).not.toHaveBeenCalled();
    expect(world.startSending).not.toHaveBeenCalled();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    const answer = await press(action);

    expect(answer).toMatchObject({ status: "refused", message: "Finish setting up your account first." });
    expect(world.refuseOutsideGate).toHaveBeenCalledWith(STAFF, "/staff/texts");
    expect(world.pause).not.toHaveBeenCalled();
    expect(world.resume).not.toHaveBeenCalled();
  });

  it("with no session sends the caller to sign-in, audited as unauthenticated, and changes nothing", async () => {
    world.session = null;

    await expect(press(action)).rejects.toThrow("NEXT_REDIRECT /staff/sign-in");

    expect(world.refuseUnauthenticated).toHaveBeenCalledWith("sending.pause", "/staff/texts");
    expect(world.pause).not.toHaveBeenCalled();
    expect(world.resume).not.toHaveBeenCalled();
  });
});
