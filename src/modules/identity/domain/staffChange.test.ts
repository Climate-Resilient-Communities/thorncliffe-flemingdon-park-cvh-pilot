import { describe, expect, it } from "vitest";
import { decideStaffChange, takesAwayAnAdmin, type ChangeTarget } from "./staffChange";

const target = (overrides: Partial<ChangeTarget> = {}): ChangeTarget => ({ id: "t", role: "admin", status: "active", ...overrides });

describe("account changes (S01.06)", () => {
  it("allows suspending, removing and changing the role of another account", () => {
    for (const change of [{ kind: "suspend" }, { kind: "remove" }, { kind: "change_role", role: "director" }] as const) {
      expect(decideStaffChange("actor", target(), change), change.kind).toEqual({ ok: true, value: undefined });
    }
  });

  it("refuses changes to the actor's own account", () => {
    expect(decideStaffChange("t", target(), { kind: "suspend" })).toEqual({ ok: false, error: "self_action" });
  });

  it("refuses changes to a removed account", () => {
    expect(decideStaffChange("actor", target({ status: "removed" }), { kind: "change_role", role: "director" })).toEqual({ ok: false, error: "account_removed" });
    expect(decideStaffChange("actor", target({ status: "removed" }), { kind: "remove" })).toEqual({ ok: false, error: "account_removed" });
  });

  it("refuses a change that changes nothing", () => {
    expect(decideStaffChange("actor", target({ status: "suspended" }), { kind: "suspend" })).toEqual({ ok: false, error: "no_change" });
    expect(decideStaffChange("actor", target(), { kind: "change_role", role: "admin" })).toEqual({ ok: false, error: "no_change" });
  });

  it("allows removing a suspended account and suspending one locked pending re-issue", () => {
    expect(decideStaffChange("actor", target({ status: "suspended" }), { kind: "remove" }).ok).toBe(true);
    expect(decideStaffChange("actor", target({ status: "locked_pending_reissue" }), { kind: "suspend" }).ok).toBe(true);
  });

  it("knows which changes take an Admin away", () => {
    expect(takesAwayAnAdmin(target(), { kind: "suspend" })).toBe(true);
    expect(takesAwayAnAdmin(target(), { kind: "remove" })).toBe(true);
    expect(takesAwayAnAdmin(target(), { kind: "change_role", role: "coordinator" })).toBe(true);
    expect(takesAwayAnAdmin(target({ role: "coordinator" }), { kind: "change_role", role: "admin" })).toBe(false);
    expect(takesAwayAnAdmin(target({ role: "director" }), { kind: "suspend" })).toBe(false);
  });
});
