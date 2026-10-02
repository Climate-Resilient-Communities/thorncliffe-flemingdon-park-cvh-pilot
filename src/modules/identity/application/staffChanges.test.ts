import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { memoryIdentityProvider } from "../adapters/memoryIdentityProvider";
import type { BootstrapState } from "../domain/bootstrap";
import type { StaffAccount } from "../domain/staffAccount";
import type { StaffStore } from "./ports";
import { adminShortfallMeta, createStaffChangeService } from "./staffChanges";

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C, D] = [1, 2, 3, 4].map(id);
const TX = { tx: true } as unknown as DbTransaction;

/** A store over plain objects: enough of StaffStore for these use cases. */
function setup(accounts: Partial<StaffAccount>[], bootstrap: BootstrapState | null = { firstAdminId: A, secondAdminId: B, completedAt: new Date() }) {
  const idp = memoryIdentityProvider();
  const rows = new Map<string, StaffAccount>();
  for (const partial of accounts) {
    const authUserId = `auth-${partial.id}`;
    rows.set(partial.id!, {
      authUserId,
      username: "x",
      firstName: "X",
      lastName: "Y",
      email: "x@example.org",
      role: "admin",
      status: "active",
      mustChangePassword: false,
      startingPasswordIssuedAt: null,
      ...partial,
    } as StaffAccount);
    idp.users.set(authUserId, { login: "x", password: "x", authenticatorEnrolled: true });
  }
  const permitted = vi.fn(async () => {});
  const store = {
    findById: async (_db, staffId) => (rows.has(staffId) ? { ...rows.get(staffId)! } : null),
    readBootstrap: async () => bootstrap,
    listAdmins: async () => [...rows.values()].filter((row) => row.role === "admin"),
    lockAdminsAndAccount: async (_tx, staffId) => [...rows.values()].filter((row) => row.role === "admin" || row.id === staffId).map((row) => ({ ...row })),
    permitAdminShortfall: permitted,
    setStatus: async (_tx, staffId, status) => void (rows.get(staffId)!.status = status),
    setRole: async (_tx, staffId, role) => void (rows.get(staffId)!.role = role),
  } as Partial<StaffStore> as StaffStore;
  const recorded: AuditEvent[] = [];
  const refused: AuditEvent[] = [];
  const audit = {
    record: async (_tx: DbTransaction, event: AuditEvent) => void recorded.push(event),
    recordRefusal: async (_db: Db, event: AuditEvent) => void refused.push(event),
  };
  const db = { transaction: async (fn: (tx: DbTransaction) => Promise<unknown>) => fn(TX) } as unknown as Db;
  const service = createStaffChangeService({ db, store, idp, audit, now: () => new Date() });
  return { service, rows, idp, recorded, refused, permitted };
}

const RULE = { ok: false, error: "two_admin_rule" };

describe("suspend, remove and change role under the two-Admin rule", () => {
  it.each([
    ["suspend", (s: ReturnType<typeof setup>["service"]) => s.suspendAccount(A, B), "account.suspended", { reason: "two_admin_rule", role: "admin" }],
    ["remove", (s: ReturnType<typeof setup>["service"]) => s.removeAccount(A, B), "account.removed", { reason: "two_admin_rule", role: "admin" }],
    ["demote", (s: ReturnType<typeof setup>["service"]) => s.changeRole(A, B, "coordinator"), "account.role_changed", { reason: "two_admin_rule", from: "admin", to: "coordinator" }],
  ])("refuses to %s either of exactly two usable Admins, audited as refused", async (_, run, action, meta) => {
    const { service, rows, recorded, refused } = setup([{ id: A }, { id: B }]);

    expect(await run(service)).toEqual(RULE);
    expect(rows.get(B)).toMatchObject({ role: "admin", status: "active" });
    expect(recorded).toEqual([]);
    expect(refused).toEqual([{ action, actorStaffId: A, subjectType: "staff_account", subjectId: B, meta }]);
  });

  it("suspends one of three usable Admins and audits it", async () => {
    const { service, rows, recorded } = setup([{ id: A }, { id: B }, { id: C }]);

    expect(await service.suspendAccount(A, C)).toEqual({ ok: true, value: undefined });
    expect(rows.get(C)!.status).toBe("suspended");
    expect(recorded).toEqual([{ action: "account.suspended", actorStaffId: A, subjectType: "staff_account", subjectId: C, meta: { role: "admin" } }]);
  });

  it("counts an Admin without an authenticator as not usable", async () => {
    const { service, idp } = setup([{ id: A }, { id: B }, { id: C }]);
    idp.users.get(`auth-${C}`)!.authenticatorEnrolled = false;

    expect(await service.changeRole(A, B, "director")).toEqual(RULE);
    expect(await service.removeAccount(A, C)).toEqual({ ok: true, value: undefined });
  });

  it("refuses changes to any Admin during a shortfall, and lets everything else continue", async () => {
    const { service, rows } = setup([{ id: A }, { id: B, mustChangePassword: true }, { id: C, role: "coordinator" }, { id: D, role: "ambassador" }]);

    expect(await service.suspendAccount(A, B)).toEqual(RULE);
    expect(await service.changeRole(A, D, "director")).toEqual({ ok: true, value: undefined });
    expect(await service.suspendAccount(A, D)).toEqual({ ok: true, value: undefined });
    // Restoring a second Admin is how the shortfall ends.
    expect(await service.changeRole(A, C, "admin")).toEqual({ ok: true, value: undefined });
    expect(rows.get(C)!.role).toBe("admin");
  });

  it("refuses an Admin's change to their own account", async () => {
    const { service, refused } = setup([{ id: A }, { id: B }, { id: C }]);

    expect(await service.suspendAccount(A, A)).toEqual({ ok: false, error: "self_action" });
    expect(refused[0]).toMatchObject({ action: "account.suspended", meta: { reason: "self_action", role: "admin" } });
  });

  it("refuses anyone but an active Admin, as permission.denied", async () => {
    const { service, refused } = setup([{ id: A, role: "coordinator" }, { id: B }, { id: C }]);

    expect(await service.removeAccount(A, B)).toEqual({ ok: false, error: "forbidden" });
    expect(refused).toEqual([
      { action: "permission.denied", actorStaffId: A, subjectType: "staff_account", subjectId: A, meta: { status: 403, permission: "accounts.manage", reason: "forbidden" } },
    ]);
  });

  it("refuses during bootstrap", async () => {
    const { service } = setup([{ id: A }, { id: B }, { id: C, role: "director" }], { firstAdminId: A, secondAdminId: B, completedAt: null });

    expect(await service.suspendAccount(A, C)).toEqual({ ok: false, error: "bootstrap_incomplete" });
  });

  it("refuses an unknown account, an id that is not one and a role that does not exist", async () => {
    const { service, refused } = setup([{ id: A }, { id: B }]);

    expect(await service.suspendAccount(A, D)).toEqual({ ok: false, error: "not_found" });
    expect(await service.suspendAccount(A, "jdoe")).toEqual({ ok: false, error: "not_found" });
    expect(await service.changeRole(A, B, "owner")).toEqual({ ok: false, error: "role_invalid" });
    expect(refused.map((event) => event.subjectId)).toEqual([D, null, B]);
    expect(refused[2].meta).toEqual({ reason: "validation" });
  });

  it("refuses a change that changes nothing, and any change to a removed account", async () => {
    const { service } = setup([{ id: A }, { id: B }, { id: C, role: "director", status: "suspended" }, { id: D, role: "director", status: "removed" }]);

    expect(await service.suspendAccount(A, C)).toEqual({ ok: false, error: "no_change" });
    expect(await service.changeRole(A, D, "coordinator")).toEqual({ ok: false, error: "account_removed" });
  });
});

describe("the recovery exception", () => {
  it("never refuses, permits the shortfall in the database, and says when it leaves fewer than two usable Admins", async () => {
    const { service, permitted } = setup([{ id: A }, { id: B }]);

    const recovery = await service.beginAdminRecovery(TX, B);

    expect(recovery).toEqual({ adminShortfall: true });
    expect(permitted).toHaveBeenCalledWith(TX);
    expect(adminShortfallMeta(recovery)).toEqual({ admin_shortfall: true });
  });

  it("carries no flag when two usable Admins remain, or when the account is not an Admin", async () => {
    const { service } = setup([{ id: A }, { id: B }, { id: C }, { id: D, role: "coordinator" }]);

    expect(adminShortfallMeta(await service.beginAdminRecovery(TX, C))).toEqual({});
    expect(adminShortfallMeta(await service.beginAdminRecovery(TX, D))).toEqual({});
  });
});

describe("the shortfall banner", () => {
  it("shows to every active Admin while fewer than two are usable, after bootstrap only", async () => {
    const shortfall = setup([{ id: A }, { id: B, mustChangePassword: true }, { id: C, role: "coordinator" }]);
    expect(await shortfall.service.adminShortfallBanner(A)).toBe(true);
    expect(await shortfall.service.adminShortfallBanner(B)).toBe(true);
    expect(await shortfall.service.adminShortfallBanner(C)).toBe(false);

    const enough = setup([{ id: A }, { id: B }]);
    expect(await enough.service.adminShortfallBanner(A)).toBe(false);

    const bootstrapping = setup([{ id: A }, { id: B, mustChangePassword: true }], { firstAdminId: A, secondAdminId: B, completedAt: null });
    expect(await bootstrapping.service.adminShortfallBanner(A)).toBe(false);
  });
});
