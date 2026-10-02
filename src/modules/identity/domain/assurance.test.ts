import { describe, expect, it } from "vitest";
import { PRIVILEGED_ACTIONS, REQUIRED_ASSURANCE, isPrivilegedAction, meetsAssurance } from "./assurance";

describe("assurance of privileged actions", () => {
  it("lists the spine's privileged actions: approve, send, correct, withdraw, drill, publish, cap, pause, account changes and building edits", () => {
    expect([...PRIVILEGED_ACTIONS].sort()).toEqual(
      ["accounts.manage", "alert.approve", "alert.correct", "alert.send", "alert.withdraw", "buildings.manage", "drill.run", "guide.publish", "sending.pause", "spend.cap"].sort(),
    );
  });

  it.each(PRIVILEGED_ACTIONS)("runs %s only at aal2", (action) => {
    expect(REQUIRED_ASSURANCE[action]).toBe("aal2");
    expect(meetsAssurance("aal2", action)).toBe(true);
    expect(meetsAssurance("aal1", action)).toBe(false);
  });

  it("knows the names", () => {
    expect(isPrivilegedAction("accounts.manage")).toBe(true);
    expect(isPrivilegedAction("checkin.record")).toBe(false);
  });
});
