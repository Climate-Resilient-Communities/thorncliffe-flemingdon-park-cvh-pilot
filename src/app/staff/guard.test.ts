import { describe, expect, it, vi } from "vitest";
import type { StaffSession } from "./session";

// The guard's rule without I/O (decide): the session store and the composition root are not needed.
vi.mock("./identity", () => ({ identity: () => null, staffAuth: () => null }));
vi.mock("./scope", () => ({ assignmentsOf: async () => [] }));
vi.mock("./session", () => ({ currentStaffSession: async () => null }));

import { decide } from "./guard";

const ME = "01900000-0000-7000-8000-000000000001";
const session = (overrides: Partial<StaffSession> = {}): StaffSession => ({
  staffId: ME,
  sessionId: "01900000-0000-7000-8000-0000000000aa",
  username: "aokafor",
  firstName: "Ann",
  lastName: "Okafor",
  role: "ambassador",
  gate: "hub",
  aal: "aal1",
  ...overrides,
});

const OWN_PENDING = { entry: { authorId: ME, editorIds: [ME], status: "pending_approval" } };
const spec = (action: "alert.correct" | "alert.withdraw" | "alert.approve") => ({ access: "hub" as const, action });

describe("decide: the role policy, then the authenticator level of the roles that have one", () => {
  it.each(["alert.correct", "alert.withdraw"] as const)("lets an Ambassador at aal1 %s their own pending entry", (action) => {
    expect(decide(spec(action), session({ role: "ambassador", aal: "aal1" }), OWN_PENDING)).toEqual({ kind: "allow", session: expect.anything() });
  });

  it("still refuses an Ambassador another person's entry, as out of scope", () => {
    const decision = decide(spec("alert.correct"), session(), { entry: { authorId: "someone-else", editorIds: [], status: "pending_approval" } });
    expect(decision).toMatchObject({ kind: "denied", reason: "out_of_scope" });
  });

  it.each(["alert.correct", "alert.withdraw"] as const)("asks a Coordinator at aal1 for aal2 on %s", (action) => {
    expect(decide(spec(action), session({ role: "coordinator", aal: "aal1" }), OWN_PENDING)).toMatchObject({ kind: "aal_required", permission: action });
    expect(decide(spec(action), session({ role: "coordinator", aal: "aal2" }), OWN_PENDING).kind).toBe("allow");
  });

  it("asks an Admin at aal1 for aal2", () => {
    expect(decide({ access: "hub", action: "accounts.manage" as const }, session({ role: "admin", aal: "aal1" }))).toMatchObject({ kind: "aal_required" });
  });

  it("refuses a Director by the policy, at either level", () => {
    for (const aal of ["aal1", "aal2"] as const) {
      expect(decide(spec("alert.correct"), session({ role: "director", aal }), OWN_PENDING)).toMatchObject({ kind: "denied", reason: "forbidden" });
    }
  });
});
