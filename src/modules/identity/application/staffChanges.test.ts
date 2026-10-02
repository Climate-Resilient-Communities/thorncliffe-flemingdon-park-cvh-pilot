import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { memoryIdentityProvider } from "../adapters/memoryIdentityProvider";
import type { BootstrapState } from "../domain/bootstrap";
import type { StaffAccount } from "../domain/staffAccount";
import type { StaffStore } from "./ports";
import { adminShortfallMeta, createAdminRecovery } from "./adminRecovery";
import { createSessionRevocation } from "./sessionRevocation";
import { createStaffChangeService } from "./staffChanges";

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
  const lockedAdmins = vi.fn();
  const lockedAccount = vi.fn();
  const lockTimeouts: number[] = [];
  const store = {
    findById: async (_db, staffId) => (rows.has(staffId) ? { ...rows.get(staffId)! } : null),
    readBootstrap: async () => bootstrap,
    listAdmins: async () => [...rows.values()].filter((row) => row.role === "admin"),
    lockAccount: async (_tx, staffId) => {
      lockedAccount(staffId);
      return rows.has(staffId) ? { ...rows.get(staffId)! } : null;
    },
    setLockTimeout: async (_tx, ms) => void lockTimeouts.push(ms),
    lockAdminsAndAccount: async (_tx, staffId) => {
      lockedAdmins(staffId);
      return [...rows.values()].filter((row) => row.role === "admin" || row.id === staffId).map((row) => ({ ...row }));
    },
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
  // Open sessions per account (staff_session) and each account's revocation count.
  const openSessions = new Map<string, number>([...rows.keys()].map((key) => [key, 2]));
  const generations = new Map<string, number>();
  const revokedIn: unknown[] = [];
  const revocation = createSessionRevocation({
    store: { bumpSessionGeneration: async (_tx, staffId) => void generations.set(staffId, (generations.get(staffId) ?? 0) + 1) },
    sessions: {
      revokeAll: async (tx, staffId) => {
        revokedIn.push(tx);
        const open = openSessions.get(staffId) ?? 0;
        openSessions.set(staffId, 0);
        return open;
      },
    },
    audit,
    now: () => new Date(),
  });
  const deps = { db, store, idp, audit, now: () => new Date(), lockTimeoutMs: 4321, signInLockedUntil: async () => null, revocation };
  const service = createStaffChangeService(deps);
  const { beginAdminRecovery } = createAdminRecovery(deps);
  return { service, beginAdminRecovery, rows, idp, recorded, refused, permitted, lockedAdmins, lockedAccount, lockTimeouts, openSessions, generations, revokedIn };
}

const RULE = { ok: false, error: "two_admin_rule" };

describe("suspend, remove and change role under the two-Admin rule", () => {
  it.each([
    ["suspend", (s: ReturnType<typeof setup>["service"]) => s.suspendAccount(A, B), "account.suspended", { reason: "two_admin_rule", role: "admin" }],
    ["remove", (s: ReturnType<typeof setup>["service"]) => s.removeAccount(A, B), "account.removed", { reason: "two_admin_rule", role: "admin" }],
    ["demote", (s: ReturnType<typeof setup>["service"]) => s.changeRole(A, B, "coordinator"), "account.role_changed", { reason: "two_admin_rule", from: "admin", to: "coordinator" }],
  ])("refuses to %s either of exactly two usable Admins, audited as refused", async (_, run, action, meta) => {
    const { service, rows, recorded, refused, revokedIn } = setup([{ id: A }, { id: B }]);

    expect(await run(service)).toEqual(RULE);
    expect(rows.get(B)).toMatchObject({ role: "admin", status: "active" });
    expect(recorded).toEqual([]);
    expect(revokedIn).toEqual([]);
    expect(refused).toEqual([{ action, actorStaffId: A, subjectType: "staff_account", subjectId: B, meta }]);
  });

  it("suspends one of three usable Admins and audits it", async () => {
    const { service, rows, recorded } = setup([{ id: A }, { id: B }, { id: C }]);

    expect(await service.suspendAccount(A, C)).toEqual({ ok: true, value: undefined });
    expect(rows.get(C)!.status).toBe("suspended");
    expect(recorded).toEqual([
      { action: "account.suspended", actorStaffId: A, subjectType: "staff_account", subjectId: C, meta: { role: "admin" } },
      { action: "session.revoked", actorStaffId: A, subjectType: "staff_account", subjectId: C, meta: { cause: "suspended", sessions: 2 } },
    ]);
  });

  it("counts an Admin without an authenticator as not usable", async () => {
    const { service, idp } = setup([{ id: A }, { id: B }, { id: C }]);
    idp.users.get(`auth-${C}`)!.authenticatorEnrolled = false;

    expect(await service.changeRole(A, B, "director")).toEqual(RULE);
    expect(await service.removeAccount(A, C)).toEqual({ ok: true, value: undefined });
  });

  it.each([
    ["suspension", (s: ReturnType<typeof setup>["service"]) => s.suspendAccount(A, D), "suspended"],
    ["removal", (s: ReturnType<typeof setup>["service"]) => s.removeAccount(A, D), "removed"],
    ["role change", (s: ReturnType<typeof setup>["service"]) => s.changeRole(A, D, "coordinator"), "role_changed"],
  ])("ends every session of the account on a %s, in the change's transaction (S01.08)", async (_, run, cause) => {
    const { service, recorded, openSessions, generations, revokedIn } = setup([{ id: A }, { id: B }, { id: D, role: "ambassador" }]);

    expect(await run(service)).toEqual({ ok: true, value: undefined });

    expect(openSessions.get(D)).toBe(0);
    expect(generations.get(D)).toBe(1);
    expect(revokedIn).toEqual([TX]);
    expect(recorded.at(-1)).toEqual({ action: "session.revoked", actorStaffId: A, subjectType: "staff_account", subjectId: D, meta: { cause, sessions: 2 } });
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

describe("the recovery exception (internal to the identity module)", () => {
  it("is not part of the service the module hands out", () => {
    const { service } = setup([{ id: A }, { id: B }]);

    expect(service).not.toHaveProperty("beginAdminRecovery");
  });

  it("never refuses, permits the shortfall in the database, and says when it leaves fewer than two usable Admins", async () => {
    const { beginAdminRecovery, permitted, lockedAdmins, lockTimeouts } = setup([{ id: A }, { id: B }]);

    const recovery = await beginAdminRecovery(TX, B);

    expect(recovery).toEqual({ adminShortfall: true });
    expect(permitted).toHaveBeenCalledWith(TX);
    expect(lockedAdmins).toHaveBeenCalledWith(B);
    expect(lockTimeouts).toEqual([4321]);
    expect(adminShortfallMeta(recovery)).toEqual({ admin_shortfall: true });
  });

  it("carries no flag when two usable Admins remain", async () => {
    const { beginAdminRecovery } = setup([{ id: A }, { id: B }, { id: C }]);

    expect(adminShortfallMeta(await beginAdminRecovery(TX, C))).toEqual({});
  });

  it("locks only a non-Admin target: no Admin row is locked, the provider is not called, nothing is permitted", async () => {
    const { beginAdminRecovery, idp, permitted, lockedAdmins, lockedAccount } = setup([{ id: A }, { id: B }, { id: D, role: "coordinator" }]);
    idp.delay(60_000); // would hang the test if the provider were asked

    const recovery = await beginAdminRecovery(TX, D);

    expect(recovery).toEqual({ adminShortfall: false });
    expect(adminShortfallMeta(recovery)).toEqual({});
    expect(lockedAccount).toHaveBeenCalledWith(D);
    expect(lockedAdmins).not.toHaveBeenCalled();
    expect(permitted).not.toHaveBeenCalled();
  });

  it("also returns early for an account that does not exist", async () => {
    const { beginAdminRecovery, lockedAdmins } = setup([{ id: A }, { id: B }]);

    expect(await beginAdminRecovery(TX, D)).toEqual({ adminShortfall: false });
    expect(lockedAdmins).not.toHaveBeenCalled();
  });
});

describe("a slow identity provider while Admin rows are locked (S01.06)", () => {
  it("fails the change within the provider's timeout, writes nothing and audits nothing", async () => {
    const { service, idp, rows, recorded } = setup([{ id: A }, { id: B }, { id: C }]);
    idp.delay(30); // a Supabase call that times out after 30 ms
    const started = Date.now();

    await expect(service.suspendAccount(A, C)).rejects.toThrow("identity provider timed out");

    expect(Date.now() - started).toBeLessThan(1000);
    expect(rows.get(C)!.status).toBe("active");
    expect(recorded).toEqual([]);
  });

  it("fails the banner check the same way, for the layout to give up on it", async () => {
    const { service, idp } = setup([{ id: A }, { id: B }]);
    idp.delay(30);

    await expect(service.adminShortfallBanner(A)).rejects.toThrow("identity provider timed out");
  });

  it("asks the database to give up on a row lock after the configured time", async () => {
    const { service, lockTimeouts } = setup([{ id: A }, { id: B }, { id: C }]);

    await service.suspendAccount(A, C);

    expect(lockTimeouts).toEqual([4321]);
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
