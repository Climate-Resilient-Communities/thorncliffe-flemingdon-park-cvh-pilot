import { isStaffRole, type StaffRole } from "../../../contracts/staffRoles";
import type { Db } from "../../../platform/db";
import { mayManageAccounts } from "../domain/accountAuthority";
import { decideAdminChange, hasAdminShortfall } from "../domain/adminFloor";
import { bootstrapPhase, decideUnderBootstrap } from "../domain/bootstrap";
import type { IdentityRefusal } from "../domain/refusals";
import { err, ok, type Result } from "../domain/result";
import { decideStaffChange, takesAwayAnAdmin, type StaffChange } from "../domain/staffChange";
import { AUDIT_REASONS, type AuditWriter } from "./accounts";
import { DEFAULT_LOCK_TIMEOUT_MS } from "./adminRecovery";
import type { IdentityProvider, StaffStore } from "./ports";
import { adminStandings } from "./usability";

export interface StaffChangeDeps {
  db: Db;
  store: StaffStore;
  idp: IdentityProvider;
  audit: AuditWriter;
  now: () => Date;
  /** How long a change waits for a row lock before failing (default 5 s): Supabase is called while Admin rows are locked. */
  lockTimeoutMs?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The name of the error the database trigger raises (db/migrations/20261002120000_two_usable_admins.sql). */
const TWO_ADMIN_TRIGGER = "staff_account_two_usable_admins";

/** True when the error, or one it wraps (Drizzle wraps the driver's), is the trigger's refusal. */
function isTwoAdminTriggerError(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth += 1) {
    if ((current as { constraint_name?: unknown }).constraint_name === TWO_ADMIN_TRIGGER) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A refusal found inside the transaction, returned through it (nothing was written). */
class ChangeRefusal {
  constructor(
    readonly code: IdentityRefusal,
    readonly targetRole?: StaffRole,
  ) {}
}

/**
 * Suspending, removing and changing the role of staff accounts, under the two-Admin rule (S01.06):
 * any change that would leave fewer than two usable Admins is refused with "There must always be at
 * least two usable Admins" and audited as `refused`. The recovery exception and the automatic locks
 * go through the identity module's internal beginAdminRecovery (adminRecovery.ts) instead.
 */
export function createStaffChangeService(deps: StaffChangeDeps) {
  const { db, store, idp, audit } = deps;

  async function refuse(actorStaffId: string | null, targetId: string | null, change: StaffChange, code: IdentityRefusal, targetRole?: StaffRole) {
    const reason = AUDIT_REASONS[code];
    const subject = { actorStaffId, subjectType: "staff_account", subjectId: targetId };
    if (change.kind === "change_role") {
      const to = isStaffRole(change.role) ? change.role : undefined;
      await audit.recordRefusal(db, { action: "account.role_changed", ...subject, meta: { reason, ...(targetRole ? { from: targetRole } : {}), ...(to ? { to } : {}) } });
    } else {
      const action = change.kind === "suspend" ? "account.suspended" : "account.removed";
      await audit.recordRefusal(db, { action, ...subject, meta: { reason, ...(targetRole ? { role: targetRole } : {}) } });
    }
    return err(code);
  }

  async function refuseForbidden(actorStaffId: string | null) {
    await audit.recordRefusal(db, {
      action: "permission.denied",
      actorStaffId,
      subjectType: "staff_account",
      subjectId: actorStaffId,
      meta: { status: 403, permission: "accounts.manage", reason: "forbidden" },
    });
    return err("forbidden" as const);
  }

  async function applyChange(actorId: string, targetId: string, change: StaffChange): Promise<Result<void, IdentityRefusal>> {
    const actor = await store.findById(db, actorId);
    if (!actor || !mayManageAccounts(actor)) return refuseForbidden(actor ? actor.id : null);
    if (!UUID.test(targetId)) return refuse(actor.id, null, change, "not_found");
    if (change.kind === "change_role" && !isStaffRole(change.role)) return refuse(actor.id, targetId, change, "role_invalid");
    const gate = decideUnderBootstrap(await store.readBootstrap(db), actor.id, { kind: "other" });
    if (!gate.ok) return refuse(actor.id, targetId, change, gate.error);

    try {
      await db.transaction(async (tx) => {
        await store.setLockTimeout(tx, deps.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
        // Every Admin row and the target's are locked first; what is read after the lock is what
        // a concurrent change committed, so two changes never both count the same Admins.
        const locked = await store.lockAdminsAndAccount(tx, targetId);
        const current = await store.findById(tx, actor.id);
        if (!current || !mayManageAccounts(current)) throw new ChangeRefusal("forbidden");
        const target = locked.find((account) => account.id === targetId);
        if (!target) throw new ChangeRefusal("not_found");
        const decided = decideStaffChange(actor.id, target, change);
        if (!decided.ok) throw new ChangeRefusal(decided.error, target.role);
        if (takesAwayAnAdmin(target, change)) {
          const standings = await adminStandings(idp, locked.filter((account) => account.role === "admin"), deps.now());
          const floor = decideAdminChange(standings, target.id);
          if (!floor.ok) throw new ChangeRefusal(floor.error, target.role);
        }

        if (change.kind === "change_role") {
          await store.setRole(tx, target.id, change.role);
          await audit.record(tx, {
            action: "account.role_changed",
            actorStaffId: actor.id,
            subjectType: "staff_account",
            subjectId: target.id,
            meta: { from: target.role, to: change.role },
          });
        } else {
          await store.setStatus(tx, target.id, change.kind === "suspend" ? "suspended" : "removed");
          await audit.record(tx, {
            action: change.kind === "suspend" ? "account.suspended" : "account.removed",
            actorStaffId: actor.id,
            subjectType: "staff_account",
            subjectId: target.id,
            meta: { role: target.role },
          });
        }
      });
    } catch (error) {
      if (error instanceof ChangeRefusal) {
        if (error.code === "forbidden") return refuseForbidden(actor.id);
        return refuse(actor.id, targetId, change, error.code, error.targetRole);
      }
      // The database's own guard: only reached if the app's check and the trigger disagree.
      if (isTwoAdminTriggerError(error)) return refuse(actor.id, targetId, change, "two_admin_rule");
      throw error;
    }
    return ok(undefined);
  }

  return {
    /** An Admin suspends another account. Refused for an Admin when fewer than two usable Admins would be left. */
    suspendAccount(actorId: string, targetId: string) {
      return applyChange(actorId, targetId, { kind: "suspend" });
    },

    /** An Admin removes another account (it stays, marked removed). Refused for an Admin under the two-Admin rule. */
    removeAccount(actorId: string, targetId: string) {
      return applyChange(actorId, targetId, { kind: "remove" });
    },

    /** An Admin gives another account a new role. Demoting an Admin is refused under the two-Admin rule. */
    changeRole(actorId: string, targetId: string, role: string) {
      return applyChange(actorId, targetId, { kind: "change_role", role: role as StaffRole });
    },

    /**
     * Whether the Hub shows this staff member the "Fewer than two usable Admins" banner: they are an
     * active Admin, bootstrap has ended (during it, the bootstrap screens say what is missing) and
     * fewer than two Admins are usable.
     */
    async adminShortfallBanner(viewerId: string): Promise<boolean> {
      const viewer = await store.findById(db, viewerId);
      if (!viewer || !mayManageAccounts(viewer)) return false;
      if (bootstrapPhase(await store.readBootstrap(db)) !== "completed") return false;
      return hasAdminShortfall(await adminStandings(idp, await store.listAdmins(db), deps.now()));
    },
  };
}

export type StaffChangeService = ReturnType<typeof createStaffChangeService>;
