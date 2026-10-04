import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffRole } from "@/contracts/staffRoles";
import type { StaffSession } from "../../session";

// The real guard runs; only what it reads from outside is stood in for (the session, identity's audit seam, an Ambassador's assignments), and the alert use case
// the form calls, which the test reads to see that a thread is made as a drill, only by this action, and only after the guard.
const world = vi.hoisted(() => ({
  session: null as unknown,
  refuseByPolicy: vi.fn(async () => {}),
  refuseBelowAal2: vi.fn(async () => {}),
  refuseOutsideGate: vi.fn(async () => {}),
  refuseUnauthenticated: vi.fn(async () => {}),
  logDisruption: vi.fn(),
}));

vi.mock("../../session", () => ({ currentStaffSession: async () => world.session }));
vi.mock("../../scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("../../identity", () => ({
  identity: () => ({ refuseUnauthenticated: world.refuseUnauthenticated }),
  staffAuth: () => ({ refuseByPolicy: world.refuseByPolicy, refuseBelowAal2: world.refuseBelowAal2, refuseOutsideGate: world.refuseOutsideGate }),
}));
vi.mock("../../alerts", () => ({ alerting: () => ({ logDisruption: world.logDisruption }) }));
vi.mock("../../places", () => ({ buildings: () => ({ listFloorPlans: async () => [] }) }));
vi.mock("next/navigation", () => ({
  redirect: (location: string) => {
    throw new Error(`NEXT_REDIRECT ${location}`);
  },
}));

const { startDrillAction } = await import("./actions");
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

/** A complete "Start a drill" form (the one "Log a disruption" sends): one type, one whole building, and the time the first report reached the Hub (Toronto time). */
function startForm(): FormData {
  const form = new FormData();
  for (const [name, value] of [
    ["kind", "ack"],
    ["type", "elevator"],
    ["scope", "buildings"],
    ["building", "7001"],
    ["floors-7001", "all"],
    ["reported-date", "2026-10-04"],
    ["reported-time", "09:30"],
  ]) {
    form.append(name, value);
  }
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  world.session = signedIn("admin", "aal2");
  world.logDisruption.mockResolvedValue({ ok: true, value: { thread: { id: "01900000-0000-7000-8000-0000000000c1" }, entry: { id: "01900000-0000-7000-8000-0000000000d1" } } });
});

describe("the start action names the policy action drill.run, Admins at aal2", () => {
  it("is the start page's route, the hub gate and drill.run, privileged", () => {
    expect(guardSpecOf(startDrillAction)).toEqual({ route: "/staff/drills/start", access: "hub", action: "drill.run", privileged: "drill.run" });
  });
});

describe("an Admin at aal2 starting a drill", () => {
  it("makes the thread as a drill, as themselves, and goes on to the acknowledgement composer with the thread and its first entry", async () => {
    const form = startForm();
    await expect(startDrillAction({ status: "idle" }, form)).rejects.toThrow(`NEXT_REDIRECT /staff/alerts/ack?alert=01900000-0000-7000-8000-0000000000c1&entry=01900000-0000-7000-8000-0000000000d1`);

    expect(world.logDisruption).toHaveBeenCalledTimes(1);
    expect(world.logDisruption.mock.calls[0][0]).toEqual({ staffId: STAFF, aal: "aal2" });
    expect(world.logDisruption.mock.calls[0][1]).toMatchObject({ kind: "ack", isDrill: true, types: ["elevator"], place: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }] } });
  });

  it("is told what the use case refuses (a first report in the future), and nothing goes on", async () => {
    world.logDisruption.mockResolvedValue({ ok: false, error: "REPORTED_AT_INVALID" });
    const answer = await startDrillAction({ status: "idle" }, startForm());
    expect(answer).toMatchObject({ status: "refused", message: "The first report cannot be later than now." });
  });
});

describe("calling the start action directly", () => {
  it.each([
    ["an Ambassador", "ambassador", "aal1"],
    ["a Coordinator, even at aal2", "coordinator", "aal2"],
    ["a Director", "director", "aal1"],
  ] as const)("as %s is refused as forbidden, audited with the permission, and no thread is made", async (_who, role, aal) => {
    world.session = signedIn(role, aal);

    expect(await startDrillAction({ status: "idle" }, startForm())).toEqual({ status: "refused", message: "Only an Admin can start a drill." });
    expect(world.refuseByPolicy).toHaveBeenCalledWith(STAFF, "/staff/drills/start", "drill.run", "forbidden");
    expect(world.logDisruption).not.toHaveBeenCalled();
  });

  it("as an Admin without aal2 is refused, audited as below aal2, and no thread is made", async () => {
    world.session = signedIn("admin", "aal1");

    expect(await startDrillAction({ status: "idle" }, startForm())).toEqual({
      status: "refused",
      message: "An Admin must sign in with their authenticator code to start a drill. Sign in again and enter the code.",
    });
    expect(world.refuseBelowAal2).toHaveBeenCalledWith(STAFF, "/staff/drills/start", "drill.run");
    expect(world.logDisruption).not.toHaveBeenCalled();
  });

  it("as an Admin who has not finished sign-in is refused as setup incomplete", async () => {
    world.session = signedIn("admin", "aal1", "authenticator_code");

    expect(await startDrillAction({ status: "idle" }, startForm())).toEqual({ status: "refused", message: "Finish setting up your account first." });
    expect(world.logDisruption).not.toHaveBeenCalled();
  });

  it("with no session sends the caller to sign-in, audited as unauthenticated", async () => {
    world.session = null;

    await expect(startDrillAction({ status: "idle" }, startForm())).rejects.toThrow("NEXT_REDIRECT /staff/sign-in");

    expect(world.refuseUnauthenticated).toHaveBeenCalledWith("drill.run", "/staff/drills/start");
    expect(world.logDisruption).not.toHaveBeenCalled();
  });
});
