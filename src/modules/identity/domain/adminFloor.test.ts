import { describe, expect, it } from "vitest";
import { decideAdminChange, hasAdminShortfall, leavesAdminShortfall, usableAdminCount, type AdminStanding } from "./adminFloor";

const admin = (id: string, usable = true): AdminStanding => ({ id, role: "admin", usable });
const coordinator = (id: string): AdminStanding => ({ id, role: "coordinator", usable: false });

describe("the two-Admin rule (S01.06)", () => {
  it("counts only usable Admins", () => {
    expect(usableAdminCount([admin("a"), admin("b", false), coordinator("c")])).toBe(1);
  });

  it("refuses to take away either of exactly two usable Admins", () => {
    const accounts = [admin("a"), admin("b")];

    expect(decideAdminChange(accounts, "a")).toEqual({ ok: false, error: "two_admin_rule" });
    expect(decideAdminChange(accounts, "b")).toEqual({ ok: false, error: "two_admin_rule" });
  });

  it("allows taking away one of three usable Admins", () => {
    expect(decideAdminChange([admin("a"), admin("b"), admin("c")], "a")).toEqual({ ok: true, value: undefined });
  });

  it("allows taking away an Admin that is not usable while two others are", () => {
    expect(decideAdminChange([admin("a"), admin("b"), admin("c", false)], "c")).toEqual({ ok: true, value: undefined });
  });

  it("refuses every change to any Admin while fewer than two are usable, even one that is not usable", () => {
    const shortfall = [admin("a"), admin("b", false), admin("c", false)];

    for (const id of ["a", "b", "c"]) expect(decideAdminChange(shortfall, id), id).toEqual({ ok: false, error: "two_admin_rule" });
  });

  it("never holds back a change to an account that is not an Admin, shortfall or not", () => {
    expect(decideAdminChange([admin("a"), coordinator("c")], "c")).toEqual({ ok: true, value: undefined });
    expect(decideAdminChange([admin("a"), admin("b")], "unknown")).toEqual({ ok: true, value: undefined });
  });

  it("says when a recovery or automatic lock on an Admin leaves fewer than two usable Admins", () => {
    expect(leavesAdminShortfall([admin("a"), admin("b")], "a")).toBe(true);
    expect(leavesAdminShortfall([admin("a"), admin("b"), admin("c")], "a")).toBe(false);
    expect(leavesAdminShortfall([admin("a"), admin("b"), admin("c", false)], "c")).toBe(false);
    expect(leavesAdminShortfall([admin("a"), admin("b", false)], "b")).toBe(true);
  });

  it("never flags a recovery on an account that is not an Admin", () => {
    expect(leavesAdminShortfall([admin("a"), coordinator("c")], "c")).toBe(false);
  });

  it("shows the shortfall while fewer than two Admins are usable", () => {
    expect(hasAdminShortfall([admin("a"), admin("b", false)])).toBe(true);
    expect(hasAdminShortfall([admin("a"), admin("b")])).toBe(false);
    expect(hasAdminShortfall([])).toBe(true);
  });
});
