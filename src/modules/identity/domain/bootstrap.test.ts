import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../contracts/staffRoles";
import { bootstrapCompletes, bootstrapPhase, decideUnderBootstrap, type BootstrapState, type StaffIntent } from "./bootstrap";

const FIRST = "01900000-0000-7000-8000-000000000001";
const SECOND = "01900000-0000-7000-8000-000000000002";
const OTHER = "01900000-0000-7000-8000-000000000003";

const pending: BootstrapState = { firstAdminId: FIRST, secondAdminId: null, completedAt: null };
const withSecond: BootstrapState = { ...pending, secondAdminId: SECOND };
const completed: BootstrapState = { ...withSecond, completedAt: new Date("2026-10-02T12:00:00Z") };

const ownSetup: StaffIntent = { kind: "complete_own_setup" };
const create = (role: (typeof STAFF_ROLES)[number]): StaffIntent => ({ kind: "create_account", role });
const refused = { ok: false, error: "bootstrap_incomplete" };

describe("bootstrap phase", () => {
  it("has not started before the first Admin, is in progress until completed, then stays completed", () => {
    expect(bootstrapPhase(null)).toBe("not_started");
    expect(bootstrapPhase(pending)).toBe("in_progress");
    expect(bootstrapPhase(withSecond)).toBe("in_progress");
    expect(bootstrapPhase(completed)).toBe("completed");
  });
});

describe("during bootstrap", () => {
  it("lets the first Admin complete their own setup and create one second Admin", () => {
    expect(decideUnderBootstrap(pending, FIRST, ownSetup)).toEqual({ ok: true, value: "allowed" });
    expect(decideUnderBootstrap(pending, FIRST, create("admin"))).toEqual({ ok: true, value: "creates_second_admin" });
  });

  it.each(["ambassador", "coordinator", "director"] as const)("refuses the first Admin a %s account", (role) => {
    expect(decideUnderBootstrap(pending, FIRST, create(role))).toEqual(refused);
  });

  it("refuses the first Admin a third account once the second Admin exists", () => {
    for (const role of STAFF_ROLES) expect(decideUnderBootstrap(withSecond, FIRST, create(role))).toEqual(refused);
  });

  it("refuses the first Admin anything else", () => {
    expect(decideUnderBootstrap(pending, FIRST, { kind: "other" })).toEqual(refused);
  });

  it("lets the second Admin only complete their own setup, without waiting for the first", () => {
    expect(decideUnderBootstrap(withSecond, SECOND, ownSetup)).toEqual({ ok: true, value: "allowed" });
    expect(decideUnderBootstrap(withSecond, SECOND, { kind: "other" })).toEqual(refused);
    for (const role of STAFF_ROLES) expect(decideUnderBootstrap(withSecond, SECOND, create(role))).toEqual(refused);
  });

  it("refuses anyone else account creation", () => {
    expect(decideUnderBootstrap(pending, OTHER, create("admin"))).toEqual(refused);
  });

  it("refuses everything but own setup before bootstrap has started (fail closed)", () => {
    expect(decideUnderBootstrap(null, OTHER, create("admin"))).toEqual(refused);
    expect(decideUnderBootstrap(null, OTHER, { kind: "other" })).toEqual(refused);
  });
});

describe("after bootstrap", () => {
  it("restricts nothing", () => {
    for (const intent of [ownSetup, { kind: "other" } as const, ...STAFF_ROLES.map(create)]) {
      expect(decideUnderBootstrap(completed, FIRST, intent)).toEqual({ ok: true, value: "allowed" });
      expect(decideUnderBootstrap(completed, OTHER, intent)).toEqual({ ok: true, value: "allowed" });
    }
  });
});

describe("bootstrap completes", () => {
  it("when both pending Admins are usable, whichever finished last", () => {
    expect(bootstrapCompletes(withSecond, { firstAdmin: true, secondAdmin: true })).toBe(true);
  });

  it("not while either is still setting up", () => {
    expect(bootstrapCompletes(withSecond, { firstAdmin: true, secondAdmin: false })).toBe(false);
    expect(bootstrapCompletes(withSecond, { firstAdmin: false, secondAdmin: true })).toBe(false);
  });

  it("not before the second Admin exists", () => {
    expect(bootstrapCompletes(pending, { firstAdmin: true, secondAdmin: true })).toBe(false);
    expect(bootstrapCompletes(null, { firstAdmin: true, secondAdmin: true })).toBe(false);
  });

  it("only once: a completed bootstrap never completes again, and never returns when Admins become unusable", () => {
    expect(bootstrapCompletes(completed, { firstAdmin: true, secondAdmin: true })).toBe(false);
    expect(bootstrapPhase(completed)).toBe("completed");
    expect(decideUnderBootstrap(completed, FIRST, create("coordinator"))).toEqual({ ok: true, value: "allowed" });
  });
});
