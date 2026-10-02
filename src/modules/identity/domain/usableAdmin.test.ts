import { describe, expect, it } from "vitest";
import { isUsableAdmin, type AdminUsabilityFacts } from "./usableAdmin";

const NOW = new Date("2026-10-02T12:00:00Z");

const usable: AdminUsabilityFacts = {
  role: "admin",
  status: "active",
  mustChangePassword: false,
  authenticatorEnrolled: true,
  signInLockedUntil: null,
};

describe("usable Admin", () => {
  it("is an active, unlocked Admin who replaced the starting password and enrolled an authenticator", () => {
    expect(isUsableAdmin(usable, NOW)).toBe(true);
  });

  it.each<[string, Partial<AdminUsabilityFacts>]>([
    ["still on the starting password", { mustChangePassword: true }],
    ["no authenticator enrolled", { authenticatorEnrolled: false }],
    ["neither step done", { mustChangePassword: true, authenticatorEnrolled: false }],
    ["suspended", { status: "suspended" }],
    ["removed", { status: "removed" }],
    ["locked until an Admin re-issues the starting password", { status: "locked_pending_reissue" }],
    ["under a failed-sign-in lock", { signInLockedUntil: new Date("2026-10-02T12:10:00Z") }],
    ["not an Admin", { role: "coordinator" }],
  ])("is not usable when %s", (_, change) => {
    expect(isUsableAdmin({ ...usable, ...change }, NOW)).toBe(false);
  });

  it("is usable again once a failed-sign-in lock has run out", () => {
    expect(isUsableAdmin({ ...usable, signInLockedUntil: new Date("2026-10-02T12:00:00Z") }, NOW)).toBe(true);
  });
});
