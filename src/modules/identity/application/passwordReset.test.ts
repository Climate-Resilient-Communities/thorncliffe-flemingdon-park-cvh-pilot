import { describe, expect, it, vi } from "vitest";
import type { Db, DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import { memoryIdentityProvider } from "../adapters/memoryIdentityProvider";
import type { BootstrapState } from "../domain/bootstrap";
import type { StaffAccount } from "../domain/staffAccount";
import { createPasswordResetService } from "./passwordReset";
import type { StaffStore } from "./ports";
import { createSessionRevocation } from "./sessionRevocation";

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const [A, B, C] = [1, 2, 3].map(id);
const NOW = new Date("2026-10-05T09:00:00Z");

const pepper = (password: string) => `peppered(${password})`;

function setup(accounts: Partial<StaffAccount>[], options: { bootstrap?: BootstrapState | null; shortfall?: boolean; noPepper?: boolean } = {}) {
  const bootstrap = options.bootstrap === undefined ? { firstAdminId: A, secondAdminId: B, completedAt: new Date(0) } : options.bootstrap;
  const idp = memoryIdentityProvider();
  const rows = new Map<string, StaffAccount>();
  for (const partial of accounts) {
    const authUserId = idp.plant(`${partial.username}@staff.cvh.invalid`, { password: "my own password" });
    rows.set(partial.id!, {
      authUserId,
      firstName: "Ann",
      lastName: "Okafor",
      email: "x@example.org",
      role: "admin",
      status: "active",
      mustChangePassword: false,
      startingPasswordIssuedAt: null,
      startingPasswordUsedAt: null,
      ...partial,
    } as StaffAccount);
  }
  const generations = new Map<string, number>();
  const steps: string[] = [];
  const store = {
    findById: async (_db, staffId) => (rows.has(staffId) ? { ...rows.get(staffId)! } : null),
    findByUsername: async (_db, username) => [...rows.values()].find((row) => row.username === username) ?? null,
    readBootstrap: async () => bootstrap,
    setLockTimeout: async () => void steps.push("lock_timeout"),
    lockAccount: async (_tx, staffId) => (steps.push("lock_account"), rows.has(staffId) ? { ...rows.get(staffId)! } : null),
    beginPasswordReset: async (_tx, staffId, at) => {
      const row = rows.get(staffId)!;
      if (row.status !== "active" && row.status !== "locked_pending_reissue") return false;
      Object.assign(row, { status: "locked_pending_reissue", mustChangePassword: true, startingPasswordIssuedAt: at, startingPasswordUsedAt: null });
      return true;
    },
    reissueStartingPassword: async (_tx, staffId, at) => {
      Object.assign(rows.get(staffId)!, { status: "active", startingPasswordIssuedAt: at, startingPasswordUsedAt: null });
      return true;
    },
    bumpSessionGeneration: async (_tx, staffId) => void generations.set(staffId, (generations.get(staffId) ?? 0) + 1),
  } as Partial<StaffStore> as StaffStore;
  const recorded: AuditEvent[] = [];
  const refused: AuditEvent[] = [];
  const audit = {
    record: async (_tx: DbTransaction, event: AuditEvent) => void recorded.push(event),
    recordRefusal: async (_db: Db, event: AuditEvent) => void refused.push(event),
  };
  const transactions: string[] = [];
  const db = {
    transaction: async (fn: (tx: DbTransaction) => Promise<unknown>) => {
      transactions.push("begin");
      return fn({} as DbTransaction);
    },
  } as unknown as Db;
  const log = { error: vi.fn(), warn: vi.fn() };
  const openSessions = new Map<string, number>([...rows.keys()].map((key) => [key, 2]));
  const revocation = createSessionRevocation({
    store,
    sessions: {
      revokeAll: async (_tx, staffId) => {
        const open = openSessions.get(staffId) ?? 0;
        openSessions.set(staffId, 0);
        return open;
      },
    },
    audit,
    now: () => NOW,
  });
  const recoveries: string[] = [];
  const service = createPasswordResetService({
    db,
    store,
    idp,
    audit,
    log,
    now: () => NOW,
    pepper: options.noPepper ? null : pepper,
    revocation,
    beginAdminRecovery: async (_tx, targetId) => {
      recoveries.push(targetId);
      steps.push("recovery");
      return { adminShortfall: rows.get(targetId)?.role === "admin" && options.shortfall === true };
    },
  });
  return { service, rows, idp, recorded, refused, generations, openSessions, recoveries, log, transactions, steps };
}

const admin = (n: string, username: string, extra: Partial<StaffAccount> = {}) => ({ id: n, username, ...extra });

describe("an Admin's Reset password (S01.08)", () => {
  it("issues a new starting password for 72 hours, ends every session and audits password.reset and session.revoked", async () => {
    const t = setup([admin(A, "admina"), admin(B, "adminb"), { id: C, username: "aokafor", role: "ambassador" }]);
    const before = t.rows.get(C)!.authUserId;

    const result = await t.service.resetPassword(A, " AOkafor ");

    expect(result).toEqual({ ok: true, value: { username: "aokafor", startingPassword: "cvh-ann-okafor" } });
    expect(t.rows.get(C)).toMatchObject({ status: "active", mustChangePassword: true, startingPasswordIssuedAt: NOW, startingPasswordUsedAt: null });
    // The provider stores the peppered starting password; its admin password update is its global sign-out.
    expect(t.idp.users.get(before)!.password).toBe("peppered(cvh-ann-okafor)");
    expect(t.openSessions.get(C)).toBe(0);
    // Once with the revocation, once when the reset finishes: a sign-in that checked the old password in between cannot keep its session.
    expect(t.generations.get(C)).toBe(2);
    expect(t.recorded).toEqual([
      { action: "password.reset", actorStaffId: A, subjectType: "staff_account", subjectId: C, meta: {} },
      { action: "session.revoked", actorStaffId: A, subjectType: "staff_account", subjectId: C, meta: { cause: "password_reset", sessions: 2 } },
    ]);
    expect(t.recoveries).toEqual([C]);
  });

  it("takes the account's lock under a lock timeout before changing it, like a password change and a re-issue", async () => {
    const t = setup([admin(A, "admina"), admin(B, "adminb"), { id: C, username: "aokafor", role: "ambassador" }]);

    expect((await t.service.resetPassword(A, "aokafor")).ok).toBe(true);

    // First transaction, then the second (which sets its own timeout).
    expect(t.steps).toEqual(["lock_timeout", "recovery", "lock_account", "lock_timeout"]);
  });

  it("resets an Admin's password as a recovery action, flagged admin_shortfall when it leaves fewer than two usable Admins", async () => {
    const t = setup([admin(A, "admina"), admin(B, "adminb")], { shortfall: true });

    expect((await t.service.resetPassword(A, "adminb")).ok).toBe(true);
    expect(t.recorded[0]).toMatchObject({ action: "password.reset", subjectId: B, meta: { admin_shortfall: true } });
    expect(t.rows.get(B)).toMatchObject({ status: "active", mustChangePassword: true });
  });

  it("refuses anyone but an active Admin, an Admin's own account, unknown usernames, suspended or removed accounts and bootstrap", async () => {
    const t = setup([
      admin(A, "admina"),
      admin(B, "adminb", { role: "coordinator" }),
      { id: C, username: "gone", role: "director", status: "suspended" },
    ]);
    expect(await t.service.resetPassword(B, "admina")).toEqual({ ok: false, error: "forbidden" });
    expect(await t.service.resetPassword(A, "admina")).toEqual({ ok: false, error: "self_action" });
    expect(await t.service.resetPassword(A, "nobody")).toEqual({ ok: false, error: "not_found" });
    expect(await t.service.resetPassword(A, "gone")).toEqual({ ok: false, error: "not_resettable" });
    expect(t.refused.map((event) => [event.action, event.meta])).toEqual([
      ["password.reset", { reason: "forbidden" }],
      ["password.reset", { reason: "self_action" }],
      ["password.reset", { reason: "not_found" }],
      ["password.reset", { reason: "conflict" }],
    ]);
    expect(t.recorded).toEqual([]);

    const bootstrapping = setup([admin(A, "admina"), admin(B, "adminb")], { bootstrap: { firstAdminId: A, secondAdminId: B, completedAt: null } });
    expect(await bootstrapping.service.resetPassword(A, "adminb")).toEqual({ ok: false, error: "bootstrap_incomplete" });
  });

  it("refuses and changes nothing when staff passwords are not configured (no pepper)", async () => {
    const t = setup([admin(A, "admina"), admin(B, "adminb")], { noPepper: true });

    expect(await t.service.resetPassword(A, "adminb")).toEqual({ ok: false, error: "passwords_not_configured" });
    expect(t.rows.get(B)).toMatchObject({ status: "active", mustChangePassword: false });
    expect(t.recorded).toEqual([]);
  });

  it("leaves the account locked with its sessions revoked when the provider does not take the new password", async () => {
    const t = setup([admin(A, "admina"), admin(B, "adminb"), { id: C, username: "aokafor", role: "ambassador" }]);
    t.idp.failNextPassword("unavailable");

    expect(await t.service.resetPassword(A, "aokafor")).toEqual({ ok: false, error: "provider_error" });

    expect(t.rows.get(C)).toMatchObject({ status: "locked_pending_reissue", mustChangePassword: true });
    expect(t.openSessions.get(C)).toBe(0);
    expect(t.recorded.map((event) => event.action)).toEqual(["password.reset", "session.revoked"]);
    expect(t.refused.at(-1)).toMatchObject({ action: "password.reset", meta: { reason: "provider_error" } });
    expect(t.log.error).toHaveBeenCalledWith("identity.password_reset_unfinished", { staff_id: C, provider: "unavailable" });
    // A second reset finishes it.
    expect((await t.service.resetPassword(A, "aokafor")).ok).toBe(true);
    expect(t.rows.get(C)).toMatchObject({ status: "active", mustChangePassword: true });
  });
});
