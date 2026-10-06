import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { decidePolicy } from "./policy";
import { PRIVILEGED_ACTIONS, REQUIRED_ASSURANCE, isPrivilegedAction, meetsAssurance } from "./assurance";

describe("assurance of privileged actions", () => {
  it("lists the spine's privileged actions: approve, send, correct, withdraw, drill, publish, cap, pause, account changes and building edits", () => {
    expect([...PRIVILEGED_ACTIONS].sort()).toEqual(
      ["accounts.manage", "alert.approve", "alert.correct", "alert.send", "alert.withdraw", "buildings.manage", "delivery.resend", "drill.run", "guide.publish", "oncall.manage", "provider.manage", "sending.pause", "spend.cap"].sort(),
    );
  });

  it.each(PRIVILEGED_ACTIONS)("runs %s at aal2 for Admin and Coordinator, who enrol an authenticator", (action) => {
    for (const role of ["admin", "coordinator"] as const) {
      expect(REQUIRED_ASSURANCE[action][role]).toBe("aal2");
      expect(meetsAssurance(role, "aal2", action)).toBe(true);
      expect(meetsAssurance(role, "aal1", action)).toBe(false);
    }
  });

  it("asks aal2 of no role that cannot reach it: Ambassador and Director sign in at aal1", () => {
    for (const action of PRIVILEGED_ACTIONS) {
      for (const role of ["ambassador", "director"] as const) {
        expect(REQUIRED_ASSURANCE[action][role]).toBe("aal1");
        expect(meetsAssurance(role, "aal1", action)).toBe(true);
      }
    }
  });

  it("has a level for every action and role", () => {
    for (const action of PRIVILEGED_ACTIONS) expect(Object.keys(REQUIRED_ASSURANCE[action]).sort()).toEqual([...STAFF_ROLES].sort());
  });

  it("leaves the Director to the policy: refused every privileged action whatever the level", () => {
    for (const action of PRIVILEGED_ACTIONS) expect(decidePolicy("director", action, { actorId: "d" })).toBe("forbidden");
  });

  it("knows the names", () => {
    expect(isPrivilegedAction("accounts.manage")).toBe(true);
    expect(isPrivilegedAction("checkin.record")).toBe(false);
  });
});
